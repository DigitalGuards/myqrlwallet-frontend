import { argon2id as argon2idWasm } from 'hash-wasm';
import { argon2id as argon2idJs } from '@noble/hashes/argon2.js';
import log from '@/utils/log';
import { deriveArgon2id } from '../argon2';

jest.mock('hash-wasm', () => ({ argon2id: jest.fn() }));
jest.mock('@noble/hashes/argon2.js', () => ({ argon2id: jest.fn() }));
jest.mock('@/utils/log', () => ({ __esModule: true, default: jest.fn() }));

it('reports fallback once, returns JS bytes, and retries WASM on every call', async () => {
  const failure = new Error('WASM unavailable');
  const fallbackBytes = new Uint8Array([1, 2, 3]);
  const wasmBytes = new Uint8Array([4, 5, 6]);
  jest
    .mocked(argon2idWasm)
    .mockRejectedValueOnce(failure)
    .mockRejectedValueOnce(failure)
    .mockResolvedValueOnce(wasmBytes);
  jest.mocked(argon2idJs).mockReturnValue(fallbackBytes);
  const password = new Uint8Array([7, 8]);
  const salt = new Uint8Array(16);
  const params = { m: 4096, t: 2, p: 1, dklen: 32 };

  await expect(deriveArgon2id(password, salt, params)).resolves.toEqual(fallbackBytes);
  await expect(deriveArgon2id(password, salt, params)).resolves.toEqual(fallbackBytes);
  await expect(deriveArgon2id(password, salt, params)).resolves.toEqual(wasmBytes);
  expect(argon2idWasm).toHaveBeenCalledTimes(3);
  expect(argon2idJs).toHaveBeenCalledTimes(2);
  expect(argon2idJs).toHaveBeenCalledWith(password, salt, { m: 4096, t: 2, p: 1, dkLen: 32 });
  expect(log).toHaveBeenCalledTimes(1);
  expect(log).toHaveBeenCalledWith(
    'argon2: hash-wasm failed, falling back to the slower pure-JS implementation: WASM unavailable',
  );
});
