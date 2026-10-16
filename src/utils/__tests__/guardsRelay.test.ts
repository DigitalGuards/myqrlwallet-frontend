/** @jest-environment jsdom */

import { TextEncoder } from 'node:util';
import { RelayChannelNotJoinedError, SocketClient } from '@/services/dappConnect/SocketClient';
import { isCallable } from '../guards';
import {
  browserErrorCases,
  errorShapedCases,
  foreignErrorCases,
} from './errorFixtures';

const mockListeners = new Map<string, (...args: unknown[]) => unknown>();
const mockSocket = {
  connected: true,
  io: { engine: { transport: { name: 'websocket' } } },
  on(event: string, listener: unknown) {
    if (!isCallable(listener)) throw new Error('Expected socket listener');
    mockListeners.set(event, listener);
  },
  removeAllListeners: jest.fn(),
  disconnect: jest.fn(),
  emit: jest.fn(
    (_event: string, _payload: unknown, _ack?: (response: unknown) => void) => undefined
  ),
};

jest.mock('socket.io-client', () => ({ io: () => mockSocket }));
jest.mock('@/utils/nativeApp', () => ({ logToNative: () => undefined }));

const clients: SocketClient[] = [];
const joinAck = {
  success: true,
  bufferedMessages: [],
  channelPublicKey: null,
  terminated: false,
  participants: ['dapp'],
};
const outbound = { id: 'channel', clientType: 'wallet' as const, message: 'sealed' };
const failureCases = [
  ...foreignErrorCases,
  ...browserErrorCases,
  ...errorShapedCases,
  { name: 'local Error', create: () => new Error('transport failed') },
  { name: 'string', create: () => 'transport failed' },
  { name: 'null', create: () => null },
  { name: 'undefined', create: () => undefined },
  { name: 'false', create: () => false },
  { name: 'zero', create: () => 0 },
  { name: 'bigint', create: () => 1n },
  { name: 'symbol', create: () => Symbol('failure') },
  { name: 'function', create: () => () => undefined },
];

beforeAll(() => {
  Object.defineProperty(globalThis, 'TextEncoder', { configurable: true, value: TextEncoder });
});

beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  mockSocket.emit.mockReset();
  mockSocket.connected = true;
  mockListeners.clear();
});

afterEach(() => {
  for (const client of clients.splice(0)) client.disconnect();
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
  document.body.replaceChildren();
});

async function connectedClient() {
  const events = {
    onMessage: jest.fn(),
    onConnected: jest.fn(),
    onDisconnected: jest.fn(),
    onReconnected: jest.fn(),
    onParticipantsChanged: jest.fn(),
  };
  const client = new SocketClient('https://relay.example', events);
  clients.push(client);
  await client.connect();
  return { client, events };
}

function acknowledgeJoin(): void {
  mockSocket.emit.mockImplementation((_event, _payload, ack) => {
    ack?.(joinAck);
    return undefined;
  });
}

function failEmission(failure: unknown): void {
  mockSocket.emit.mockImplementation(() => {
    throw failure;
  });
}

it.each(foreignErrorCases)('preserves $name diagnostics through relay failures', async ({ create, message }) => {
  const { client } = await connectedClient();
  failEmission(create());
  await expect(client.joinChannel('channel')).rejects.toMatchObject({ message });

  acknowledgeJoin();
  await client.joinChannel('channel');
  failEmission(create());
  await expect(client.sendMessage(outbound)).rejects.toMatchObject({ message });
});

// Class: caught transport failures must reject through every normalization caller.
describe.each(failureCases)('$name', ({ create }) => {
  it(
    'rejects a join emission failure and blocks sending until a successful acknowledgement',
    async () => {
      const { client } = await connectedClient();
      failEmission(create());
      const joining = expect(client.joinChannel('channel')).rejects.toBeInstanceOf(Error);
      expect(client.isJoined()).toBe(false);
      await jest.advanceTimersByTimeAsync(0);
      await joining;
      expect(client.isJoined()).toBe(false);
      await expect(client.sendMessage(outbound)).rejects.toBeInstanceOf(RelayChannelNotJoinedError);
      expect(mockSocket.emit.mock.calls.map(([event]) => event)).toEqual(['join_channel']);

      acknowledgeJoin();
      await client.joinChannel('channel');
      expect(client.isJoined()).toBe(true);
      mockSocket.emit.mockImplementation((_event, _payload, ack) => {
        ack?.({ success: true });
        return undefined;
      });
      await expect(client.sendMessage(outbound)).resolves.toBeUndefined();
    }
  );

  it(
    'rejects a send emission failure with a local Error',
    async () => {
      const { client } = await connectedClient();
      acknowledgeJoin();
      await client.joinChannel('channel');
      failEmission(create());
      await expect(client.sendMessage(outbound)).rejects.toBeInstanceOf(Error);
      expect(client.isJoined()).toBe(true);
    }
  );
});

describe.each([...foreignErrorCases, ...browserErrorCases, ...errorShapedCases])(
  'rejoin failure: $name',
  ({ create }) => {
    it(
      'keeps membership false after an emission failure and recovers on the existing retry',
      async () => {
        const { client, events } = await connectedClient();
        acknowledgeJoin();
        await client.joinChannel('channel');
        mockSocket.emit.mockClear();
        mockListeners.get('disconnect')?.('transport close');
        failEmission(create());
        mockListeners.get('connect')?.();
        await jest.advanceTimersByTimeAsync(0);
        expect(client.isJoined()).toBe(false);
        expect(events.onReconnected).not.toHaveBeenCalled();
        expect(events.onMessage).not.toHaveBeenCalled();
        await expect(client.sendMessage(outbound)).rejects.toBeInstanceOf(
          RelayChannelNotJoinedError
        );
        expect(mockSocket.emit.mock.calls.map(([event]) => event)).toEqual(['join_channel']);

        acknowledgeJoin();
        await jest.advanceTimersToNextTimerAsync();
        expect(client.isJoined()).toBe(true);
        expect(events.onReconnected).toHaveBeenCalledTimes(1);
      }
    );
  }
);
