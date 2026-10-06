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
  RelayChannelNotJoinedError,
  SocketClient,
  SocketNotConnectedError,
  _setSocketIoLoaderForTests,
  rejoinBudgetFloorMs,
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

/** Answer the last `message` frame that is still waiting on its ack. */
function ackMessage(response: unknown): boolean {
  for (let index = emits.length - 1; index >= 0; index -= 1) {
    const entry = emits[index];
    if (entry && entry[0] === "message" && entry[2]) {
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

    // Delivery hangs off onReconnected, so it must not fire on the socket's
    // `connect`: at that moment the relay has not taken the channel back and a
    // frame would be refused.
    expect(events.onReconnected).not.toHaveBeenCalled();

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

  it("treats a relay frame refusal as a lost membership and goes back for it", async () => {
    // The relay's view can disagree with the client's: a relay restart, or a
    // stale participant it evicted. It decides both membership refusals before
    // it routes, buffers or sequences anything, so the caller can hold the
    // frame. Reading the refusal as an ambiguous acknowledgement is what
    // retired the pairing with a counter already spent.
    const events = handlers();
    const client = await pairedClient(events);

    const send = client.sendMessage({
      id: "channel-1",
      clientType: "wallet",
      message: "sealed",
    });
    expect(emits.some(([event]) => event === "message")).toBe(true);
    ackMessage({ success: false, error: "Sender not in channel" });

    // Typed, so the caller holds the frame instead of failing closed.
    await expect(send).rejects.toBeInstanceOf(RelayChannelNotJoinedError);
    await expect(send).rejects.toBeInstanceOf(SocketNotConnectedError);
    expect(client.isJoined()).toBe(false);

    // And it goes and gets the channel back on its own, because a successful
    // rejoin is the only thing that puts the parked frame back on the wire.
    await settle();
    expect(joinCount()).toBe(1);
    expect(client.willReconnect()).toBe(true);

    ackJoin(JOIN_OK);
    await settle();
    expect(client.isJoined()).toBe(true);
    expect(events.onReconnected).toHaveBeenCalledTimes(1);
  });

  it("keeps failing closed on an acknowledgement that may have been delivered", async () => {
    // A replay rejection can mean an earlier copy did land, and the relay
    // decides "Counterparty transport unavailable" after routing. Neither is
    // safe to retry, so both stay ordinary errors and the caller tombstones.
    const client = await pairedClient(handlers());

    for (const error of [
      "Duplicate or out-of-order message (replay rejected)",
      "Counterparty transport unavailable",
    ]) {
      const send = client.sendMessage({
        id: "channel-1",
        clientType: "wallet",
        message: "sealed",
      });
      ackMessage({ success: false, error });
      await expect(send).rejects.not.toBeInstanceOf(SocketNotConnectedError);
      expect(client.isJoined()).toBe(true);
    }
  });

  it("ignores a rejoin that was lost with the transport it went out on", async () => {
    // Two flaps. The first rejoin's acknowledgement dies with its transport, so
    // socket.io drops it and the promise only rejects on its own ten-second
    // timeout, by which time a later rejoin has succeeded. Nothing about the
    // socket identity distinguishes them across a socket.io reconnect, so that
    // stale timeout used to schedule another rejoin on a socket that was
    // already a member. A run of those spends the relay's per-IP join budget of
    // 30 a minute, and the refusal that follows abandoned a working channel:
    // the live connection was dropped, held answers discarded and the
    // on-screen approval closed.
    const events = handlers();
    const client = await pairedClient(events);
    jest.useFakeTimers();

    // Flap one: the rejoin goes out and its acknowledgement never comes.
    mockSocket.connected = false;
    listeners.get("disconnect")?.("transport close");
    mockSocket.connected = true;
    fireConnect();
    await settle();
    expect(joinCount()).toBe(1);

    // Flap two, then a rejoin that lands.
    mockSocket.connected = false;
    listeners.get("disconnect")?.("transport close");
    mockSocket.connected = true;
    fireConnect();
    await settle();
    expect(joinCount()).toBe(2);
    ackJoin(JOIN_OK);
    await settle();
    expect(client.isJoined()).toBe(true);
    expect(events.onReconnected).toHaveBeenCalledTimes(1);

    // Now the first rejoin finally times out.
    jest.advanceTimersByTime(30_000);
    await settle();

    // No further joins, and the healthy membership is untouched.
    expect(joinCount()).toBe(2);
    expect(client.isJoined()).toBe(true);
    expect(events.onRejoinAbandoned).not.toHaveBeenCalled();
    expect(events.onReconnected).toHaveBeenCalledTimes(1);

    // And it stays that way: a timer waking up later still finds a member.
    jest.advanceTimersByTime(300_000);
    await settle();
    expect(joinCount()).toBe(2);
    expect(client.isJoined()).toBe(true);
    expect(events.onRejoinAbandoned).not.toHaveBeenCalled();
  });

  it("ignores a stale rejoin failure even while no membership is held", async () => {
    // The generation check on its own. The later rejoin is still waiting on its
    // acknowledgement here, so the socket is not a member and the
    // already-joined guard cannot help: only the generation tells a failure
    // from a dead transport apart from one about this connection. Without it
    // the stale failure schedules a third join while the second is in flight.
    const events = handlers();
    const client = await pairedClient(events);
    jest.useFakeTimers();
    // Pin the retry delay so the window between the two acknowledgement
    // timeouts is exact.
    const random = jest.spyOn(Math, "random").mockReturnValue(0);

    mockSocket.connected = false;
    listeners.get("disconnect")?.("transport close");
    mockSocket.connected = true;
    fireConnect();
    await settle();
    expect(joinCount()).toBe(1);

    // Seven seconds later the transport flaps again, so the first join has
    // three seconds of its ten-second timeout left and the second is fresh.
    jest.advanceTimersByTime(7_000);
    await settle();
    mockSocket.connected = false;
    listeners.get("disconnect")?.("transport close");
    mockSocket.connected = true;
    fireConnect();
    await settle();
    expect(joinCount()).toBe(2);

    // The first join times out. Membership is still false, and the second join
    // is still outstanding.
    jest.advanceTimersByTime(3_500);
    await settle();
    expect(client.isJoined()).toBe(false);
    expect(joinCount()).toBe(2);

    // Long enough for a retry the stale failure would have scheduled (3.75 s at
    // this jitter), and still short of the second join's own timeout.
    jest.advanceTimersByTime(4_000);
    await settle();
    expect(joinCount()).toBe(2);
    expect(events.onRejoinAbandoned).not.toHaveBeenCalled();

    // And the live attempt still completes normally.
    ackJoin(JOIN_OK);
    await settle();
    random.mockRestore();
    expect(client.isJoined()).toBe(true);
    expect(events.onReconnected).toHaveBeenCalledTimes(1);
  });

  it("keeps retrying for longer than the relay refuses", async () => {
    // The relay refuses a rejoin for up to 45 s while a stale wallet
    // participant holds the slot, and for up to 60 s inside its join
    // rate-limit window. A budget that can expire sooner retires a pairing that
    // was about to work, and on web and desktop the only retry after that is a
    // reload. This is the floor at the narrowest jitter, so it holds for every
    // draw and not merely on average.
    expect(rejoinBudgetFloorMs()).toBeGreaterThanOrEqual(90_000);

    // Measured end to end, with the jitter pinned at its minimum: the same
    // floor has to survive the scheduling, not just the arithmetic.
    const events = handlers();
    const client = await pairedClient(events);
    jest.useFakeTimers();
    const random = jest.spyOn(Math, "random").mockReturnValue(0);

    mockSocket.connected = false;
    listeners.get("disconnect")?.("transport close");
    mockSocket.connected = true;
    fireConnect();
    await settle();

    let elapsed = 0;
    let joins = 0;
    for (let tick = 0; tick < 400; tick += 1) {
      if (events.onRejoinAbandoned.mock.calls.length > 0) break;
      if (ackJoin({ success: false, error: "Join rate limit exceeded" })) {
        joins += 1;
        await settle();
        continue;
      }
      jest.advanceTimersByTime(1_000);
      elapsed += 1_000;
      await settle();
    }
    random.mockRestore();

    expect(events.onRejoinAbandoned).toHaveBeenCalledTimes(1);
    expect(elapsed).toBeGreaterThanOrEqual(90_000);
    // Low enough not to feed the relay's per-IP limit of 30 joins a minute,
    // which is shared behind carrier NAT: the budget grows by waiting, not by
    // knocking more often.
    expect(joins).toBeLessThanOrEqual(7);
    expect(client.isJoined()).toBe(false);
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

describe("liveness probe and forced reconnect", () => {
  const pingEmit = (): Emit | undefined =>
    emits.find(([event]) => event === "ping");

  it("probe resolves true only when the relay answers the ping", async () => {
    const client = await pairedClient(handlers());
    const probing = client.probe();
    // The mock records `ping`'s acknowledgement in the payload slot.
    const ack = pingEmit()?.[1];
    if (typeof ack !== "function") throw new Error("ping sent no ack");
    ack({ type: "pong", timestamp: 1 });
    await expect(probing).resolves.toBe(true);
  });

  it("probe resolves false when the relay stays silent", async () => {
    const client = await pairedClient(handlers());
    jest.useFakeTimers();
    const probing = client.probe(500);
    jest.advanceTimersByTime(500);
    await expect(probing).resolves.toBe(false);
  });

  it("probe resolves false without emitting when the socket is down", async () => {
    const client = await pairedClient(handlers());
    mockSocket.connected = false;
    listeners.get("disconnect")?.("transport close");
    await expect(client.probe()).resolves.toBe(false);
    expect(pingEmit()).toBeUndefined();
  });

  it("forceReconnect drops the transport and the rejoin reports the roster", async () => {
    const events = handlers();
    const client = await pairedClient(events);

    client.forceReconnect();
    expect(mockSocket.disconnect).toHaveBeenCalledTimes(1);
    expect(mockSocket.connect).toHaveBeenCalledTimes(1);

    mockSocket.connected = false;
    listeners.get("disconnect")?.("io client disconnect");
    mockSocket.connected = true;
    fireConnect();
    await settle();
    ackJoin({ ...JOIN_OK, participants: ["dapp"] });
    await settle();
    expect(events.onReconnected).toHaveBeenCalledWith(["dapp"]);
  });

  it("treats a malformed roster as unknown", async () => {
    const events = handlers();
    const client = await pairedClient(events);
    mockSocket.connected = false;
    listeners.get("disconnect")?.("transport close");
    mockSocket.connected = true;
    fireConnect();
    await settle();
    ackJoin({ ...JOIN_OK, participants: ["dapp", 7] });
    await settle();
    expect(client.isJoined()).toBe(true);
    expect(events.onReconnected).toHaveBeenCalledWith(null);
  });
});
