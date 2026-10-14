import { beforeEach, expect, it, jest } from '@jest/globals';
import { isCallable } from '@/utils/guards';
import { SocketClient } from '../SocketClient';

const mockListeners = new Map<string, (...args: unknown[]) => unknown>();
const mockLogToNative = jest.fn();
const mockIo: { engine: unknown } = { engine: undefined };
const mockSocket = {
  connected: true,
  io: mockIo,
  on: (event: string, listener: unknown) => {
    if (!isCallable(listener)) throw new Error('Expected socket listener');
    mockListeners.set(event, listener);
  },
};

jest.mock('socket.io-client', () => ({ io: () => mockSocket }));
jest.mock('@/utils/nativeApp', () => ({
  logToNative: (message: string) => mockLogToNative(message),
}));

beforeEach(() => {
  mockListeners.clear();
  mockLogToNative.mockClear();
});

it.each([
  [undefined, 'unknown'],
  [{}, 'unknown'],
  [{ transport: null }, 'unknown'],
  [{ transport: { name: 42 } }, 'unknown'],
  [{ transport: { name: 'websocket' } }, 'websocket'],
])('reports the transport safely for %p', async (engine, expected) => {
  mockIo.engine = engine;
  const connected = jest.fn();
  const client = new SocketClient('https://relay.example', {
    onMessage: jest.fn(),
    onConnected: connected,
    onDisconnected: jest.fn(),
    onReconnected: jest.fn(),
    onParticipantsChanged: jest.fn(),
  });
  await client.connect();
  const listener = mockListeners.get('connect');
  if (!listener) throw new Error('Expected connect listener');
  listener();
  expect(connected).toHaveBeenCalledTimes(1);
  expect(mockLogToNative).toHaveBeenCalledWith(
    `[SocketClient] connected via ${expected}`,
  );
});
