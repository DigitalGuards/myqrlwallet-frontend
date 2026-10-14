import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { isRecord } from '@/utils/guards';
import type { NativeMessage } from '../nativeApp';

jest.mock('@/utils/embeddedRuntime', () => ({ HAS_NATIVE_BRIDGE: true }));

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
const postMessage = jest.fn<(message: string) => void>();
let events: EventTarget;

function setNavigator(value: unknown): void {
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value });
}

beforeEach(() => {
  jest.resetModules();
  postMessage.mockClear();
  events = new EventTarget();
  Object.assign(events, { ReactNativeWebView: { postMessage } });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: events });
  setNavigator({ userAgent: 'MyQRLWallet Macintosh' });
});

afterEach(() => {
  for (const [key, descriptor] of [
    ['window', originalWindow],
    ['navigator', originalNavigator],
  ] as const) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  jest.restoreAllMocks();
});

function receive(detail: unknown): void {
  events.dispatchEvent(new CustomEvent('nativeMessage', { detail }));
}

function postedPayload(): Record<string, unknown> {
  const wire = postMessage.mock.calls[0]?.[0];
  if (wire === undefined) throw new Error('Expected a native request');
  const message: unknown = JSON.parse(wire);
  if (!isRecord(message) || !isRecord(message['payload'])) {
    throw new Error('Expected a request payload');
  }
  return message['payload'];
}

describe('native message boundary', () => {
  it('accepts known messages for this document and rejects malformed envelopes and types', async () => {
    const native = await import('../nativeApp');
    const documentId = native.getCurrentNativeDocumentId();
    const callback = jest.fn<(message: NativeMessage) => void>();
    const unsubscribe = native.subscribeToNativeMessages(callback);
    const malformed: unknown[] = [
      null,
      undefined,
      true,
      'message',
      [],
      {},
      { payload: { documentId } },
      { type: 123, payload: { documentId } },
      { type: 'UNKNOWN_NATIVE_MESSAGE', payload: { documentId } },
      { type: 'APP_LOCKED' },
      { type: 'APP_LOCKED', payload: null },
      { type: 'APP_LOCKED', payload: [] },
      { type: 'APP_LOCKED', payload: { documentId: 'old document' } },
    ];
    for (const detail of malformed) {
      expect(native.isNativeMessageForCurrentDocument(detail)).toBe(false);
      receive(detail);
    }
    expect(callback).not.toHaveBeenCalled();
    const valid: NativeMessage = {
      type: 'APP_LOCKED',
      payload: { documentId, extra: 'preserved' },
    };
    expect(native.isNativeMessageForCurrentDocument(valid)).toBe(true);
    receive(valid);
    expect(callback).toHaveBeenCalledWith(valid);
    unsubscribe();
    receive(valid);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('keeps a credential request pending across malformed and stale replies', async () => {
    const native = await import('../nativeApp');
    const request = native.requestNativeDeviceCredential({ createIfMissing: false });
    const payload = postedPayload();
    receive(null);
    receive({ type: 'DEVICE_CREDENTIAL_RESPONSE', payload: [] });
    receive({ type: 'UNKNOWN_NATIVE_MESSAGE', payload: { ...payload, credential: 'ignored' } });
    receive({
      type: 'DEVICE_CREDENTIAL_RESPONSE',
      payload: {
        ...payload,
        documentId: 'old document',
        credential: 'ignored',
      },
    });
    receive({
      type: 'DEVICE_CREDENTIAL_RESPONSE',
      payload: { ...payload, credential: 'ab'.repeat(32) },
    });
    await expect(request).resolves.toBe('ab'.repeat(32));
  });

  it('rejects a malformed credential value on a correlated reply', async () => {
    const native = await import('../nativeApp');
    const request = native.requestNativeDeviceCredential({ createIfMissing: false });
    const rejection = expect(request).rejects.toThrow(
      'Native returned an invalid wallet credential response.'
    );
    receive({
      type: 'DEVICE_CREDENTIAL_RESPONSE',
      payload: { ...postedPayload(), credential: 123 },
    });
    await rejection;
  });
});

describe('optional browser capabilities', () => {
  it('preserves the missing touch capability fallback and detects a touch-capable iPad', async () => {
    const native = await import('../nativeApp');
    expect(native.nativeAppPlatform()).toBeNull();
    setNavigator({ userAgent: 'MyQRLWallet Macintosh', maxTouchPoints: 5 });
    expect(native.nativeAppPlatform()).toBe('ios');
  });

  it('reports an unavailable clipboard and returns false', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    setNavigator({ userAgent: 'browser' });
    const native = await import('../nativeApp');
    await expect(native.copyToClipboard('text')).resolves.toBe(false);
    expect(error).toHaveBeenCalledWith('Clipboard API is not available.');
  });

  it('awaits clipboard writes and reports their rejection with the original error', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const writeText = jest.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
    setNavigator({ userAgent: 'browser', clipboard: { writeText } });
    const native = await import('../nativeApp');
    await expect(native.copyToClipboard('text')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('text');
    const failure = new Error('clipboard denied');
    writeText.mockRejectedValue(failure);
    await expect(native.copyToClipboard('text')).resolves.toBe(false);
    expect(error).toHaveBeenCalledWith('Failed to copy text to clipboard:', failure);
  });
});
