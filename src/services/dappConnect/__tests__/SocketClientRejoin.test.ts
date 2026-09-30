/**
 * @jest-environment jsdom
 *
 * Channel membership, and what happens when the relay refuses to give it back.
 *
 * A reconnected socket is `connected` a whole relay round trip before its
 * rejoin is acknowledged, and a refused rejoin leaves it connected and never a
 * member. The relay answers a frame from a non-member with
 * "Sender not in channel", which the service reads as an ambiguous
 * acknowledgement and then retires the pairing, having already spent an AEAD
 * counter. So membership has to be its own question, and a refusal has to be
 * retried: both refusals the relay issues (a stale wallet participant inside
 * the ping window, and the one-minute join rate limit) are transient.
 */
import { beforeEach, afterEach, describe, expect, it, jest } from "@jest/globals";

type Handler = (...args: unknown[]) => void;
const listeners = new Map<string, Handler>();
type Emit = [string, unknown, ((response: unknown) => void)?];
const emits: Emit[] = [];

const onceListeners = new Map<string, Set<Handler>>();
const mockSocket = {
  connected: false,
  active: true,
  on(event: string, handler: Handler) {
    listeners.set(event, handler);
    return this;
  },
  once(event: string, handler: Handler) {
    const set = onceListeners.get(event) ?? new Set<Handler>();
    set.add(handler);
    onceListeners.set(event, set);
    return this;
  },
  off(event: string, handler: Handler) {
    onceListeners.get(event)?.delete(handler);
    return this;
  },
  removeAllListeners: jest.fn(),
  disconnect: jest.fn(),
  connect: jest.fn(),
  emit: (event: string, payload: unknown, ack?: (response: unknown) => void) => {
    emits.push([event, payload, ack]);
  },
  io: { engine: { transport: { name: "websocket" } } },
};

jest.mock("@/utils/nativeApp", () => ({
  logToNative: () => undefined,
  isInNativeApp: () => false,
}));

import {
  SocketClient,
  SocketNotConnectedError,
  _setSocketIoLoaderForTests,
} from "@/services/dappConnect/SocketClient";

const handlers = () => ({
  onMessage: jest.fn(),
  onConnected: jest.fn(),
  onDisconnected: jest.fn(),
  onReconnected: jest.fn(),
  onReconnectAbandoned: jest.fn(),
  onRejoinAbandoned: jest.fn(),
  onParticipantsChanged: jest.fn(),
  onTerminated: jest.fn(),
});

const JOIN_OK = {
  success: true,
  bufferedMessages: [],
  channelPublicKey: null,
  terminated: false,
};

/** Fire `connect` for both the persistent listener and any one-shot waiters. */
function fireConnect(): void {
  listeners.get("connect")?.();
  const waiting = [...(onceListeners.get("connect") ?? [])];
  onceListeners.get("connect")?.clear();
  for (const handler of waiting) handler();
}

/** Answer the last join_channel that is still waiting on an acknowledgement. */
function ackJoin(response: unknown): boolean {
  for (let index = emits.length - 1; index >= 0; index -= 1) {
    const entry = emits[index];
    if (entry && entry[0] === "join_channel" && entry[2]) {
      const ack = entry[2];
      entry[2] = undefined;
      ack(response);
      return true;
    }
  }
  return false;
}

function joinCount(): number {
  return emits.filter(([event]) => event === "join_channel").length;
}

/** Let the dynamic socket.io import and any queued microtasks land. */
async function settle(turns = 12): Promise<void> {
  for (let turn = 0; turn < turns; turn += 1) await Promise.resolve();
}

/** A client that has connected and completed its first join. */
async function pairedClient(events: ReturnType<typeof handlers>): Promise<SocketClient> {
  const client = new SocketClient("https://relay.example", events);
  const connecting = client.connect();
  await settle();
  mockSocket.connected = true;
  fireConnect();
  await connecting;
  const joining = client.joinChannel("channel-1");
  await settle();
  ackJoin(JOIN_OK);
  await joining;
  emits.length = 0;
  return client;
}

beforeEach(() => {
  jest.clearAllMocks();
  listeners.clear();
  onceListeners.clear();
  emits.length = 0;
  mockSocket.connected = false;
  mockSocket.active = true;
  _setSocketIoLoaderForTests(() => Promise.resolve({ io: () => mockSocket as never }));
});

afterEach(() => {
  jest.useRealTimers();
  _setSocketIoLoaderForTests();
});

describe("relay channel membership", () => {
  it("is not claimed while the rejoin acknowledgement is outstanding", async () => {
    const events = handlers();
    const client = await pairedClient(events);
    expect(client.isJoined()).toBe(true);

    mockSocket.connected = false;
    listeners.get("disconnect")?.("transport close");
    expect(client.isJoined()).toBe(false);

    // The socket is back, the rejoin is on the wire, the acknowledgement is
    // not in yet. isConnected() says yes and membership says no.
    mockSocket.connected = true;
    fireConnect();
    await settle();
    expect(client.isConnected()).toBe(true);
    expect(client.isJoined()).toBe(false);
    // Still worth holding a message for: the rejoin may yet succeed.
    expect(client.willReconnect()).toBe(true);

    // A frame handed over in that window is refused before any emit, so no
    // counter is spent on a frame the relay would reject.
    await expect(
      client.sendMessage({ id: "channel-1", clientType: "wallet", message: "x" }),
    ).rejects.toBeInstanceOf(SocketNotConnectedError);
    expect(emits.some(([event]) => event === "message")).toBe(false);

    ackJoin(JOIN_OK);
    await settle();
    expect(client.isJoined()).toBe(true);
    expect(events.onReconnected).toHaveBeenCalledTimes(1);
  });

  it("retries a refused rejoin and reports membership once it lands", async () => {
    const events = handlers();
    const client = await pairedClient(events);
    jest.useFakeTimers();

    mockSocket.connected = false;
    listeners.get("disconnect")?.("transport close");
    mockSocket.connected = true;
    fireConnect();
    await settle();

    // "A wallet participant is already connected": the previous socket is
    // still registered inside the relay's ping window. Transient.
    ackJoin({ success: false, error: "A wallet participant is already connected" });
    await settle();
    expect(client.isJoined()).toBe(false);
    expect(events.onReconnected).not.toHaveBeenCalled();
    // A retry is queued, so a held message is still worth keeping.
    expect(client.willReconnect()).toBe(true);

    // Step forward only until the retry actually goes out, so its own
    // acknowledgement timeout cannot fire first and consume the attempt.
    const before = joinCount();
    for (let tick = 0; tick < 60 && joinCount() === before; tick += 1) {
      jest.advanceTimersByTime(1_000);
      await settle();
    }
    expect(joinCount()).toBeGreaterThan(before);

    ackJoin(JOIN_OK);
    await settle();
    expect(client.isJoined()).toBe(true);
    expect(events.onReconnected).toHaveBeenCalledTimes(1);
    expect(events.onRejoinAbandoned).not.toHaveBeenCalled();
  });

  it("gives up after a bounded number of refusals and says so", async () => {
    const events = handlers();
    const client = await pairedClient(events);
    jest.useFakeTimers();

    mockSocket.connected = false;
    listeners.get("disconnect")?.("transport close");
    mockSocket.connected = true;
    fireConnect();
    await settle();

    for (let attempt = 0; attempt < 10; attempt += 1) {
      if (events.onRejoinAbandoned.mock.calls.length > 0) break;
      if (!ackJoin({ success: false, error: "Join rate limit exceeded" })) break;
      await settle();
      jest.advanceTimersByTime(60_000);
      await settle();
    }

    expect(events.onRejoinAbandoned).toHaveBeenCalledTimes(1);
    expect(joinCount()).toBeLessThanOrEqual(8);
    // Connected, permanently outside the channel, no retry left: nothing
    // handed to this socket will ever be delivered, and callers must be able
    // to tell, otherwise an answer is held for a session that is not coming
    // back.
    expect(client.isJoined()).toBe(false);
    expect(client.willReconnect()).toBe(false);
  });

  it("drops membership on leave and on close", async () => {
    const events = handlers();
    const client = await pairedClient(events);
    void client.leaveChannel();
    expect(client.isJoined()).toBe(false);

    const second = await pairedClient(handlers());
    void second.closeChannel();
    expect(second.isJoined()).toBe(false);
  });
});
