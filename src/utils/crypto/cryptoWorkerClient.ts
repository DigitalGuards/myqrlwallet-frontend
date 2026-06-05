/**
 * Async crypto API for the wallet.
 *
 * - Seed encrypt/decrypt/reEncrypt run on the MAIN THREAD via WebCrypto
 *   (walletEncryption.ts). WebCrypto's PBKDF2/AES-GCM is async and runs off the
 *   JS thread inside the browser, so it does not block the UI and needs no
 *   worker. These wrappers map the WebCrypto error types onto the
 *   CryptoOperationError contract existing callers rely on.
 * - deriveHexSeed (MLDSA87 mnemonic expansion) is pure JS and DOES block, so it
 *   still runs in the Web Worker via a small worker pool.
 */

import type { CryptoWorkerMessage, CryptoWorkerResponse, CryptoErrorCode } from './cryptoWorker';
import { CryptoErrorCode as CryptoErrorCodes } from './cryptoWorker';
import {
  WalletEncryptionUtil,
  PinDecryptionError,
  OutdatedWalletFormatError,
} from './walletEncryption';

// Vite worker import syntax
import CryptoWorker from './cryptoWorker?worker';

// Re-export error codes for consumers
export { CryptoErrorCode } from './cryptoWorker';

/**
 * Custom error class that carries an error code for programmatic handling.
 */
export class CryptoOperationError extends Error {
  constructor(public code: CryptoErrorCode, message: string) {
    super(message);
    this.name = 'CryptoOperationError';
  }
}

/**
 * Map the main-thread WebCrypto error types onto CryptoOperationError so the
 * async API keeps its existing contract (callers such as the native bridge's
 * CHANGE_PIN check `code === INCORRECT_PIN`).
 */
function toCryptoOperationError(error: unknown): CryptoOperationError {
  if (error instanceof OutdatedWalletFormatError) {
    return new CryptoOperationError(CryptoErrorCodes.OUTDATED_FORMAT, error.message);
  }
  if (error instanceof PinDecryptionError) {
    return new CryptoOperationError(CryptoErrorCodes.INCORRECT_PIN, 'Incorrect PIN');
  }
  const message = error instanceof Error ? error.message : 'Unknown crypto error';
  return new CryptoOperationError(CryptoErrorCodes.UNKNOWN, message);
}

/**
 * Encrypt a seed with PIN (WebCrypto AES-256-GCM, main thread, non-blocking).
 */
export async function encryptSeedAsync(
  mnemonic: string,
  hexSeed: string,
  pin: string
): Promise<string> {
  try {
    return await WalletEncryptionUtil.encryptSeedWithPin(mnemonic, hexSeed, pin);
  } catch (error) {
    throw toCryptoOperationError(error);
  }
}

/**
 * Decrypt a seed with PIN (WebCrypto AES-256-GCM, main thread, non-blocking).
 */
export async function decryptSeedAsync(
  encryptedData: string,
  pin: string
): Promise<{ mnemonic: string; hexSeed: string }> {
  try {
    return await WalletEncryptionUtil.decryptSeedWithPin(encryptedData, pin);
  } catch (error) {
    throw toCryptoOperationError(error);
  }
}

/**
 * Re-encrypt a seed with a new PIN (WebCrypto, main thread, non-blocking).
 */
export async function reEncryptSeedAsync(
  encryptedSeed: string,
  oldPin: string,
  newPin: string
): Promise<string> {
  try {
    return await WalletEncryptionUtil.reEncryptSeed(encryptedSeed, oldPin, newPin);
  } catch (error) {
    throw toCryptoOperationError(error);
  }
}

// === Worker Pool (deriveHexSeed only) ===
const MAX_WORKERS = Math.min(navigator.hardwareConcurrency || 2, 4);
const WORKER_IDLE_TIMEOUT_MS = 30000; // 30 seconds

interface PooledWorker {
  worker: Worker;
  busy: boolean;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

// Pool of workers for parallel operations
let workerPool: PooledWorker[] = [];
let requestIdCounter = 0;

// Response type with requestId for matching concurrent requests
type WorkerResponseWithId = CryptoWorkerResponse & { requestId: number };

/**
 * Get or create a worker from the pool.
 * Returns an available worker or spawns a new one if pool isn't full.
 */
function acquireWorker(): PooledWorker {
  // Find an idle worker
  const idleWorker = workerPool.find(w => !w.busy);
  if (idleWorker) {
    if (idleWorker.idleTimer) {
      clearTimeout(idleWorker.idleTimer);
      idleWorker.idleTimer = null;
    }
    idleWorker.busy = true;
    return idleWorker;
  }

  // Spawn new worker if pool isn't full
  if (workerPool.length < MAX_WORKERS) {
    const pooledWorker: PooledWorker = {
      worker: new CryptoWorker(),
      busy: true,
      idleTimer: null,
    };
    workerPool.push(pooledWorker);
    return pooledWorker;
  }

  // Pool is full and all busy - shouldn't happen with proper await usage
  // Fall back to first worker (will queue behind current operation)
  workerPool[0].busy = true;
  return workerPool[0];
}

/**
 * Release a worker back to the pool.
 * Starts idle timer for cleanup.
 */
function releaseWorker(pooledWorker: PooledWorker): void {
  pooledWorker.busy = false;

  // Start idle timer for cleanup
  pooledWorker.idleTimer = setTimeout(() => {
    const index = workerPool.indexOf(pooledWorker);
    if (index !== -1 && !pooledWorker.busy) {
      pooledWorker.worker.terminate();
      workerPool.splice(index, 1);
    }
  }, WORKER_IDLE_TIMEOUT_MS);
}

/**
 * Send a message to a worker and wait for response.
 * Acquires a worker from the pool for parallel execution.
 */
function postToWorker<T extends CryptoWorkerResponse['type']>(
  message: CryptoWorkerMessage
): Promise<Extract<CryptoWorkerResponse, { type: T; success: true }>> {
  return new Promise((resolve, reject) => {
    const pooledWorker = acquireWorker();
    const { worker } = pooledWorker;
    const requestId = ++requestIdCounter;

    const handler = (event: MessageEvent<WorkerResponseWithId>) => {
      // Only process if this response matches our request ID
      if (event.data.requestId !== requestId) return;

      worker.removeEventListener('message', handler);
      worker.removeEventListener('error', errorHandler);
      releaseWorker(pooledWorker);

      const { requestId: _reqId, ...response } = event.data;
      if (response.success) {
        resolve(response as Extract<CryptoWorkerResponse, { type: T; success: true }>);
      } else {
        const errorResponse = response as { code: CryptoErrorCode; error: string };
        reject(new CryptoOperationError(errorResponse.code, errorResponse.error));
      }
    };

    const errorHandler = (error: ErrorEvent) => {
      worker.removeEventListener('message', handler);
      worker.removeEventListener('error', errorHandler);
      releaseWorker(pooledWorker);
      reject(new CryptoOperationError(CryptoErrorCodes.UNKNOWN, error.message || 'Worker error'));
    };

    worker.addEventListener('message', handler);
    worker.addEventListener('error', errorHandler);
    worker.postMessage({ ...message, requestId });
  });
}

/**
 * Derive the hex-encoded extended seed from a BIP39 mnemonic using the
 * Web Worker so the 50-300 ms MLDSA87 expansion runs off the main
 * thread. Equivalent output to the synchronous getHexSeedFromMnemonic
 * but doesn't block animations / signing UI during the derivation.
 *
 * Matches getHexSeedFromMnemonic's empty-input contract: returns "" for
 * undefined / empty / whitespace-only input without acquiring a worker.
 */
export async function deriveHexSeedAsync(mnemonic: string): Promise<string> {
  if (!mnemonic || !mnemonic.trim()) {
    return "";
  }
  const result = await postToWorker<'deriveHexSeed'>({
    type: 'deriveHexSeed',
    mnemonic,
  });
  return result.hexSeed;
}

/**
 * Terminate all workers in the pool.
 * Call when crypto operations are no longer needed.
 */
export function terminateCryptoWorker(): void {
  for (const pooledWorker of workerPool) {
    if (pooledWorker.idleTimer) {
      clearTimeout(pooledWorker.idleTimer);
    }
    pooledWorker.worker.terminate();
  }
  workerPool = [];
}
