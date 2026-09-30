/**
 * @jest-environment jsdom
 *
 * Manual reconnect after a server-initiated disconnect.
 *
 * socket.io gives up permanently on `io server disconnect`, and the relay uses
 * exactly that for its rate limits, its per-IP and global caps and its
 * backpressure paths. Without a retry the channel sits in RECONNECTING until
 * the page reloads; without a bound the retry hammers a relay that is already
 * shedding load.
 */
import { beforeEach, afterEach, describe, expect, it, jest } from "@jest/globals";

const listeners = new Map<string, (...args: unknown[]) => void>();
const mockConnect = jest.fn();
const mockSocket = {
  connected: false,
  active: false,
  on(event: string, handler: (...args: unknown[]) => void) {
    listeners.set(event, handler);
    return this;
  },
  removeAllListeners: jest.fn(),
  disconnect: jest.fn(),
  connect: () => mockConnect(),
  emit: jest.fn(),
  io: { engine: { transport: { name: "websocket" } } },
};

jest.mock("@/utils/nativeApp", () => ({
  logToNative: () => undefined,
  isInNativeApp: () => false,
}));

import {
  SocketClient,
  _setSocketIoLoaderForTests,
} from "@/services/dappConnect/SocketClient";

/** The socket is created behind a dynamic import; let it land. */
async function started(client: SocketClient): Promise<void> {
  void client.connect().catch(() => undefined);
  for (let turn = 0; turn < 10 && !listeners.has("disconnect"); turn += 1) {
    await Promise.resolve();
  }
}

const handlers = () => ({
  onMessage: jest.fn(),
  onConnected: jest.fn(),
  onDisconnected: jest.fn(),
  onReconnected: jest.fn(),
  onReconnectAbandoned: jest.fn(),
  onParticipantsChanged: jest.fn(),
});

const serverDisconnect = () => listeners.get("disconnect")?.("io server disconnect");

beforeEach(() => {
  jest.clearAllMocks();
  listeners.clear();
  mockSocket.connected = false;
  mockSocket.active = false;
  _setSocketIoLoaderForTests(() =>
    Promise.resolve({ io: () => mockSocket as never }),
  );
});

afterEach(() => {
  jest.useRealTimers();
  _setSocketIoLoaderForTests();
});

describe("server-initiated disconnects", () => {
  it("retries, then gives up and says so", async () => {
    const events = handlers();
    const client = new SocketClient("https://relay.example", events);
    await started(client);
    jest.useFakeTimers();

    // The relay refuses inside its own connection handler, so every cycle is
    // connect followed by an immediate server disconnect. An earlier version
    // reset the budget on `connect`, which made the give-up unreachable and
    // turned this into an endless retry.
    let cyclesBeforeGivingUp = 0;
    for (let cycle = 0; cycle < 12; cycle += 1) {
      if (events.onReconnectAbandoned.mock.calls.length > 0) break;
      cyclesBeforeGivingUp += 1;
      listeners.get("connect")?.();
      serverDisconnect();
      jest.advanceTimersByTime(120_000);
    }

    // Bounded: it gives up within its budget instead of retrying forever at
    // a fixed interval against a relay that is shedding load.
    expect(events.onReconnectAbandoned).toHaveBeenCalled();
    expect(cyclesBeforeGivingUp).toBeLessThanOrEqual(5);
    expect(mockConnect.mock.calls.length).toBeLessThanOrEqual(4);
  });

  it("backs off further each time, with jitter", async () => {
    const events = handlers();
    const client = new SocketClient("https://relay.example", events);
    await started(client);

    // Fake timers first, so the scheduled retry never actually runs; the spy
    // only needs to record the delay it was asked for.
    jest.useFakeTimers();
    const timeout = jest.spyOn(globalThis, "setTimeout");

    serverDisconnect();

    const scheduled = timeout.mock.calls[0];
    const first = typeof scheduled?.[1] === "number" ? scheduled[1] : 0;
    timeout.mockRestore();

    // Jitter is half to one and a half of the nominal delay, so the window is
    // wide rather than a fixed 1 Hz drumbeat that many phones behind one
    // carrier NAT would keep in lockstep.
    expect(first).toBeGreaterThanOrEqual(500);
    expect(first).toBeLessThanOrEqual(1_500);
  });

  it("ignores an ordinary transport drop, which socket.io retries itself", async () => {
    const events = handlers();
    const client = new SocketClient("https://relay.example", events);
    await started(client);
    jest.useFakeTimers();

    listeners.get("disconnect")?.("transport close");
    jest.advanceTimersByTime(60_000);

    expect(mockConnect).not.toHaveBeenCalled();
    expect(events.onReconnectAbandoned).not.toHaveBeenCalled();
  });

  it("reports that it can still come back while a retry is pending", async () => {
    const events = handlers();
    const client = new SocketClient("https://relay.example", events);
    await started(client);

    mockSocket.connected = false;
    mockSocket.active = false;
    serverDisconnect();

    // A retry is scheduled, so held messages are still worth keeping.
    expect(client.willReconnect()).toBe(true);
  });
});
