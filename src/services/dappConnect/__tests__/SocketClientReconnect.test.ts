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

  it("backs off further each time", async () => {
    const events = handlers();
    const client = new SocketClient("https://relay.example", events);
    await started(client);

    // Fake timers, so each scheduled retry can be run on demand and the spy
    // records the delay every cycle was asked for.
    jest.useFakeTimers();
    const timeout = jest.spyOn(globalThis, "setTimeout");

    const delays: number[] = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      timeout.mockClear();
      serverDisconnect();
      const calls = timeout.mock.calls;
      const scheduled = calls[calls.length - 1];
      const delay = typeof scheduled?.[1] === "number" ? scheduled[1] : 0;
      delays.push(delay);
      // Run the retry so the next disconnect schedules the following cycle.
      jest.advanceTimersByTime(delay);
    }
    timeout.mockRestore();

    // Each cycle doubles the nominal delay, and jitter only moves it within
    // half to one and a half of that. A relay that keeps refusing is given
    // increasing room instead of a fixed 1 Hz drumbeat: by the fourth try the
    // wait cannot be mistaken for the first.
    expect(delays[0]).toBeGreaterThanOrEqual(500);
    expect(delays[0]).toBeLessThanOrEqual(1_500);
    expect(delays[1]).toBeLessThanOrEqual(3_000);
    expect(delays[2]).toBeGreaterThanOrEqual(2_000);
    expect(delays[3]).toBeGreaterThanOrEqual(4_000);
    expect(delays[3]).toBeLessThanOrEqual(12_000);
  });

  it("spreads the retry with jitter instead of a fixed delay", async () => {
    // Same nominal delay, two different random draws: the scheduled waits
    // have to differ, or every phone behind one carrier NAT retries in
    // lockstep and keeps tripping the relay's per-IP connect limit together.
    const delayForRandom = async (value: number): Promise<number> => {
      listeners.clear();
      mockSocket.connected = false;
      mockSocket.active = false;
      const client = new SocketClient("https://relay.example", handlers());
      await started(client);

      jest.useFakeTimers();
      const random = jest.spyOn(Math, "random").mockReturnValue(value);
      const timeout = jest.spyOn(globalThis, "setTimeout");
      serverDisconnect();
      const calls = timeout.mock.calls;
      const scheduled = calls[calls.length - 1];
      timeout.mockRestore();
      random.mockRestore();
      jest.useRealTimers();
      return typeof scheduled?.[1] === "number" ? scheduled[1] : 0;
    };

    expect(await delayForRandom(0)).toBe(500);
    expect(await delayForRandom(0.999)).toBe(1_499);
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
