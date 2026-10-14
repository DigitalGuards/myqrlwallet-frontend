import { isRecord } from '@/utils/guards';
import {
  CryptoErrorCode,
  decryptKeystoreAsync,
  deriveHexSeedAsync,
  terminateCryptoWorker,
} from '../cryptoWorkerClient';
import type { EncryptedKeystore } from '../keystoreBackup';

jest.mock('../cryptoWorker', () => ({
  CryptoErrorCode: {
    INCORRECT_PIN: 'INCORRECT_PIN',
    INVALID_DATA: 'INVALID_DATA',
    OUTDATED_FORMAT: 'OUTDATED_FORMAT',
    DEVICE_CREDENTIAL_UNAVAILABLE: 'DEVICE_CREDENTIAL_UNAVAILABLE',
    DECRYPT_FAILED: 'DECRYPT_FAILED',
    UNKNOWN: 'UNKNOWN',
  },
}));
jest.mock(
  '../cryptoWorker?worker',
  () =>
    jest.fn(() => {
      const worker = new MockWorker();
      mockWorkers.push(worker);
      return worker;
    }),
  { virtual: true },
);
jest.mock('../walletEncryption', () => ({}));
jest.mock('../storedSeed', () => ({}));
jest.mock('@/desktop/bridge', () => ({ isDesktop: false }));

class MockWorker extends EventTarget {
  postMessage = jest.fn((_message: unknown) => {});
  terminate = jest.fn(() => {});

  reply(data: unknown): void {
    this.dispatchEvent(new MessageEvent('message', { data }));
  }
}

const mockWorkers: MockWorker[] = [];

function latestRequest() {
  const worker = mockWorkers[mockWorkers.length - 1];
  if (!worker) throw new Error('Expected a worker');
  const message = worker.postMessage.mock.calls[worker.postMessage.mock.calls.length - 1]?.[0];
  if (!isRecord(message) || typeof message['requestId'] !== 'number') {
    throw new Error('Expected a correlated request');
  }
  return { worker, requestId: message['requestId'] };
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  terminateCryptoWorker();
  mockWorkers.length = 0;
  jest.useRealTimers();
});

it('correlates concurrent derivations and ignores unrelated messages', async () => {
  const first = deriveHexSeedAsync('first mnemonic');
  const a = latestRequest();
  const second = deriveHexSeedAsync('second mnemonic');
  const b = latestRequest();
  a.worker.reply(null);
  a.worker.reply({
    requestId: a.requestId + 100,
    type: 'deriveHexSeed',
    success: true,
    hexSeed: 'wrong',
  });
  b.worker.reply({
    requestId: b.requestId,
    type: 'deriveHexSeed',
    success: true,
    hexSeed: 'second',
  });
  a.worker.reply({
    requestId: a.requestId,
    type: 'deriveHexSeed',
    success: true,
    hexSeed: 'first',
  });
  await expect(first).resolves.toBe('first');
  await expect(second).resolves.toBe('second');
});

it('preserves the keystore request and result', async () => {
  const keystore: EncryptedKeystore = {
    version: 1,
    crypto: {
      ciphertext: 'aa'.repeat(67),
      cipherparams: { iv: 'bb'.repeat(12) },
      cipher: 'aes-256-gcm',
      kdf: 'argon2id',
      kdfparams: { m: 4096, t: 2, p: 1, dklen: 32, salt: 'cc'.repeat(16) },
    },
  };
  const operation = decryptKeystoreAsync(keystore, 'password');
  const { worker, requestId } = latestRequest();
  expect(worker.postMessage).toHaveBeenCalledWith({
    type: 'decryptKeystore',
    keystore,
    password: 'password',
    requestId,
  });
  worker.reply({ requestId, type: 'decryptKeystore', success: true, hexSeed: 'seed' });
  await expect(operation).resolves.toBe('seed');
});

it.each(Object.values(CryptoErrorCode))(
  'preserves worker error %s and its message',
  async (code) => {
    const operation = deriveHexSeedAsync('mnemonic');
    const { worker, requestId } = latestRequest();
    worker.reply({ requestId, type: 'error', success: false, code, error: 'worker failure' });
    await expect(operation).rejects.toMatchObject({ code, message: 'worker failure' });
  },
);

it.each([
  { type: 'deriveHexSeed', success: true },
  { type: 'deriveHexSeed', success: true, hexSeed: 42 },
  { type: 'decryptKeystore', success: true, hexSeed: 'wrong operation' },
  { type: 'deriveHexSeed', success: 'true', hexSeed: 'seed' },
  { type: 'error', success: false, code: 'UNRECOGNIZED', error: 'failure' },
  { type: 'error', success: false, code: 'UNKNOWN', error: {} },
  { type: 'deriveHexSeed', success: false, code: 'UNKNOWN', error: 'failure' },
])('rejects malformed correlated replies and releases the worker: %j', async (response) => {
  const operation = deriveHexSeedAsync('mnemonic');
  const { worker, requestId } = latestRequest();
  worker.reply({ ...response, requestId });
  await expect(operation).rejects.toMatchObject({
    code: CryptoErrorCode.INVALID_DATA,
    message: 'Invalid crypto worker response',
  });
  const retry = deriveHexSeedAsync('retry');
  const next = latestRequest();
  expect(next.worker).toBe(worker);
  worker.reply({
    requestId: next.requestId,
    type: 'deriveHexSeed',
    success: true,
    hexSeed: 'seed',
  });
  await expect(retry).resolves.toBe('seed');
  jest.advanceTimersByTime(30000);
  expect(worker.terminate).toHaveBeenCalledTimes(1);
});
