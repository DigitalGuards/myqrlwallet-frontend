import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { KeyExchange, isPersistedSessionEncodingValid } from '../KeyExchange';
import {
  DIR_DAPP_TX,
  DIR_WALLET_TX,
  importRawAeadKey,
  kemKeygen,
  toBase64,
  zeroize,
} from '../PQCrypto';
import { computeFingerprint } from '../qrUri';
import { KeyExchangeMessageType } from '../types';

const persisted = {
  protocolVersion: 3,
  cid: toBase64(new Uint8Array(16)),
  kAeadRaw: toBase64(new Uint8Array(32)),
  htx: toBase64(new Uint8Array(32)),
  sendDir: toBase64(DIR_WALLET_TX),
  recvDir: toBase64(DIR_DAPP_TX),
  sendSeq: 7,
  recvSeq: 11,
};

const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
afterEach(() => {
  jest.restoreAllMocks();
  if (cryptoDescriptor) {
    Object.defineProperty(globalThis, 'crypto', cryptoDescriptor);
  } else {
    Reflect.deleteProperty(globalThis, 'crypto');
  }
});

describe('key exchange input boundaries', () => {
  it.each([
    null,
    undefined,
    [],
    Object.assign([], persisted),
    {},
    { ...persisted, protocolVersion: 2 },
    { ...persisted, sendSeq: '7' },
    { ...persisted, recvSeq: -1 },
    { ...persisted, sendSeq: Number.MAX_SAFE_INTEGER },
    { ...persisted, cid: null },
    { ...persisted, kAeadRaw: 'invalid' },
    { ...persisted, sendDir: persisted.recvDir },
  ])(
    'rejects malformed persisted state %# without changing its input',
    async (input) => {
      const before = JSON.stringify(input);
      expect(isPersistedSessionEncodingValid(input)).toBe(false);
      await expect(KeyExchange.sessionFromPersisted(input)).rejects.toThrow();
      expect(JSON.stringify(input)).toBe(before);
    },
  );

  it('restores the exact key, directions and counters from valid state', async () => {
    expect(isPersistedSessionEncodingValid(persisted)).toBe(true);
    const wallet = new KeyExchange(
      await KeyExchange.sessionFromPersisted(persisted),
    );
    expect(await wallet.exportPersisted()).toEqual(persisted);
  });

  it('retains validated counters when the input changes during key import', async () => {
    const key = await importRawAeadKey(new Uint8Array(32));
    let finishImport: (key: CryptoKey) => void = () => {
      throw new Error('Key import did not start');
    };
    jest.spyOn(globalThis.crypto.subtle, 'importKey').mockReturnValueOnce(
      new Promise<CryptoKey>((resolve) => {
        finishImport = resolve;
      }),
    );
    const input = { ...persisted };
    const restoring = KeyExchange.sessionFromPersisted(input);
    input.sendSeq = -1;
    input.recvSeq = Number.MAX_SAFE_INTEGER;
    finishImport(key);
    const restored = await restoring;
    expect(restored.sendSeq).toBe(persisted.sendSeq);
    expect(restored.recvSeq).toBe(persisted.recvSeq);
  });

  it.each([
    null,
    [],
    Object.assign([], {
      type: KeyExchangeMessageType.ACK,
      v: 3,
      c1: 'A'.repeat(40),
    }),
    { type: KeyExchangeMessageType.SYN, v: 3, c1: 'A'.repeat(40) },
    { type: KeyExchangeMessageType.ACK, v: '3', c1: 'A'.repeat(40) },
    { type: KeyExchangeMessageType.ACK, v: 3, c1: 0 },
  ])('retires provisional keys on a malformed ACK %#', async (input) => {
    const wallet = new KeyExchange();
    const { pk, sk } = kemKeygen();
    try {
      await wallet.receiveQR(new Uint8Array(16), pk, new Uint8Array(32));
      await expect(wallet.onAck(input)).rejects.toThrow(
        'ACK must use protocol v3',
      );
      expect(wallet.getSession()).toBeNull();
      expect(wallet.areKeysExchanged()).toBe(false);
    } finally {
      zeroize(sk);
    }
  });
});

it.each([undefined, {}])(
  'preserves the unavailable-WebCrypto errors for %p',
  async (crypto) => {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: crypto,
    });
    await expect(importRawAeadKey(new Uint8Array(32))).rejects.toThrow(
      'PQCrypto: WebCrypto SubtleCrypto is not available',
    );
    await expect(
      computeFingerprint(
        new Uint8Array(16),
        new Uint8Array(1184),
        new Uint8Array(32),
      ),
    ).rejects.toThrow('qrUri: WebCrypto SubtleCrypto is not available');
  },
);
