import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { RelayMessage } from "../types";

const mockEmit = jest.fn<(...args: unknown[]) => unknown>();
const mockParticipantsChanged = jest.fn();
const mockIo = jest.fn(() => mockSocket);
const mockSocket = {
  connected: true,
  on: jest.fn(),
  once: jest.fn(),
  off: jest.fn(),
  emit: mockEmit,
  disconnect: jest.fn(),
  io: { engine: { transport: { name: "websocket" } } },
};

jest.mock("socket.io-client", () => ({
  io: mockIo,
}));

import {
  _setSocketIoLoaderForTests,
  RELAY_ACK_TIMEOUT_MS,
  SocketClient,
} from "../SocketClient";

function makeClient(): SocketClient {
  return new SocketClient("https://relay.example", {
    onMessage: jest.fn(),
    onConnected: jest.fn(),
    onDisconnected: jest.fn(),
    onReconnected: jest.fn(),
    onParticipantsChanged: mockParticipantsChanged,
    onTerminated: jest.fn(),
  });
}

const outbound: RelayMessage = {
  id: "00112233-4455-6677-8899-aabbccddeeff",
  clientType: "wallet",
  message: "ciphertext",
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockSocket.connected = true;
  mockIo.mockImplementation(() => mockSocket);
});

afterEach(() => {
  _setSocketIoLoaderForTests();
  jest.useRealTimers();
});

describe("wallet relay acknowledgement boundary", () => {
  it("bounds a silent join acknowledgement", async () => {
    mockEmit.mockImplementation(() => undefined);
    const client = makeClient();
    await client.connect();

    const assertion = expect(client.joinChannel(outbound.id)).rejects.toThrow(
      "Relay join acknowledgement timeout",
    );
    await jest.advanceTimersByTimeAsync(RELAY_ACK_TIMEOUT_MS);
    await assertion;
  });

  it("bounds a silent send acknowledgement", async () => {
    mockEmit.mockImplementation(() => undefined);
    const client = makeClient();
    await client.connect();

    const assertion = expect(client.sendMessage(outbound)).rejects.toThrow(
      "Relay send acknowledgement timeout",
    );
    await jest.advanceTimersByTimeAsync(RELAY_ACK_TIMEOUT_MS);
    await assertion;
  });

  it("rejects oversized and malformed join buffers", async () => {
    const client = makeClient();
    await client.connect();
    const frame = {
      id: outbound.id,
      clientType: "dapp",
      message: "ciphertext",
    };
    mockEmit.mockImplementation((...args: unknown[]) => {
        const ack = args[2];
        if (typeof ack !== "function") throw new Error("Expected relay ack");
        ack({
          success: true,
          bufferedMessages: Array.from({ length: 51 }, () => frame),
          channelPublicKey: null,
          terminated: false,
        });
      });
    await expect(client.joinChannel(outbound.id)).rejects.toThrow(
      "too many buffered messages",
    );

    mockEmit.mockImplementation((...args: unknown[]) => {
        const ack = args[2];
        if (typeof ack !== "function") throw new Error("Expected relay ack");
        ack({
          success: true,
          bufferedMessages: [{ arbitrary: true }],
          channelPublicKey: null,
          terminated: false,
        });
      });
    await expect(client.joinChannel(outbound.id)).rejects.toThrow(
      "malformed buffered message",
    );
  });

  it("rejects an oversized buffered ciphertext at the socket boundary", async () => {
    const client = makeClient();
    await client.connect();
    mockEmit.mockImplementation((...args: unknown[]) => {
      const ack = args[2];
      if (typeof ack !== "function") throw new Error("Expected relay ack");
      ack({
        success: true,
        bufferedMessages: [
          {
            id: outbound.id,
            clientType: "dapp",
            message: "A".repeat(256 * 1024 + 1),
          },
        ],
        channelPublicKey: null,
        terminated: false,
      });
    });

    await expect(client.joinChannel(outbound.id)).rejects.toThrow(
      "malformed buffered message",
    );
  });

  it("forwards only exact dApp participant events", async () => {
    const client = makeClient();
    await client.connect();
    const calls = Object(mockSocket.on.mock.calls) as Array<
      [string, (data: unknown) => void]
    >;
    const listener = calls.find(([event]) => event === "participants_changed")?.[1];
    if (!listener) throw new Error("Expected participants_changed listener");

    for (const malformed of [
      null,
      {},
      { event: "unknown", clientType: "dapp" },
      { event: "join", clientType: "wallet" },
      { event: "close" },
    ]) {
      listener(malformed);
    }
    expect(mockParticipantsChanged).not.toHaveBeenCalled();

    listener({ event: "join", clientType: "dapp", ignored: "field" });
    listener({ event: "close", clientType: "dapp" });
    expect(mockParticipantsChanged.mock.calls).toEqual([
      [{ event: "join", clientType: "dapp" }],
      [{ event: "close", clientType: "dapp" }],
    ]);
  });

  it("single-flights connection until the existing socket actually connects", async () => {
    mockSocket.connected = false;
    let resolveConnect: () => void = () => {
      throw new Error("Expected a pending connect callback");
    };
    mockSocket.once.mockImplementation((event: unknown, callback: unknown) => {
      if (event === "connect" && typeof callback === "function") {
        resolveConnect = callback as () => void;
      }
      return mockSocket;
    });
    const client = makeClient();

    const first = client.connect();
    const second = client.connect();
    await Promise.resolve();
    await Promise.resolve();

    expect(mockIo).toHaveBeenCalledTimes(1);
    mockSocket.connected = true;
    resolveConnect();
    await Promise.all([first, second]);
    expect(mockIo).toHaveBeenCalledTimes(1);
  });

  it("cancels a connect while the dynamic socket import is still pending", async () => {
    let releaseImport: () => void = () => {
      throw new Error("Expected a pending socket import");
    };
    _setSocketIoLoaderForTests(
      () =>
        new Promise((resolve) => {
          releaseImport = () => resolve({ io: mockIo as never });
        }),
    );
    const client = makeClient();

    const pending = client.connect();
    await Promise.resolve();
    client.disconnect();
    releaseImport();

    await expect(pending).rejects.toThrow("Socket connection cancelled");
    expect(mockIo).not.toHaveBeenCalled();
    expect(client.isConnected()).toBe(false);
  });

  it("single-flights concurrent joins for the same channel", async () => {
    const client = makeClient();
    await client.connect();
    let acknowledge: (response: unknown) => void = () => {
      throw new Error("Expected a pending join acknowledgement");
    };
    mockEmit.mockImplementation((...args: unknown[]) => {
      if (args[0] === "join_channel" && typeof args[2] === "function") {
        acknowledge = args[2] as (response: unknown) => void;
      }
    });

    const first = client.joinChannel(outbound.id);
    const second = client.joinChannel(outbound.id);
    acknowledge({
      success: true,
      bufferedMessages: [],
      channelPublicKey: null,
      terminated: false,
    });

    await expect(first).resolves.toMatchObject({ terminated: false });
    await expect(second).resolves.toMatchObject({ terminated: false });
    expect(mockEmit).toHaveBeenCalledTimes(1);
  });

  it("requires an exact durable close acknowledgement", async () => {
    const client = makeClient();
    await client.connect();
    mockEmit.mockImplementation((...args: unknown[]) => {
      const ack = args[2];
      if (args[0] === "join_channel" && typeof ack === "function") {
        ack({
          success: true,
          bufferedMessages: [],
          channelPublicKey: null,
          terminated: false,
        });
      } else if (args[0] === "close_channel" && typeof ack === "function") {
        ack({ success: true, terminated: false });
      }
    });
    await client.joinChannel(outbound.id);
    await expect(client.closeChannel()).resolves.toBe(false);

    await client.joinChannel(outbound.id);
    mockEmit.mockImplementation((...args: unknown[]) => {
      const ack = args[2];
      if (args[0] === "close_channel" && typeof ack === "function") {
        ack({ success: true, terminated: true });
      } else if (args[0] === "join_channel" && typeof ack === "function") {
        ack({
          success: true,
          bufferedMessages: [],
          channelPublicKey: null,
          terminated: false,
        });
      }
    });
    await expect(client.closeChannel()).resolves.toBe(true);
  });
});
