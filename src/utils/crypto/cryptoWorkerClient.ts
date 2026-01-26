/**
 * Client interface for the crypto Web Worker.
 * Provides async functions that run PBKDF2 off the main thread.
 *
 * Uses a worker pool to enable true parallel execution when multiple
 * crypto operations are requested concurrently (e.g., PIN change for multiple seeds).
 */

import type { CryptoWorkerMessage, CryptoWorkerResponse, CryptoErrorCode } from './cryptoWorker';
import { CryptoErrorCode as CryptoErrorCodes } from './cryptoWorker';

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

// === Worker Pool Configuration ===
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
 * Encrypt a seed with PIN using Web Worker (non-blocking).
 */
export async function encryptSeedAsync(
  mnemonic: string,
  hexSeed: string,
  pin: string
): Promise<string> {
  const result = await postToWorker<'encrypt'>({
    type: 'encrypt',
    mnemonic,
    hexSeed,
    pin,
  });
  return result.encryptedSeed;
}

/**
 * Decrypt a seed with PIN using Web Worker (non-blocking).
 */
export async function decryptSeedAsync(
  encryptedData: string,
  pin: string
): Promise<{ mnemonic: string; hexSeed: string }> {
  const result = await postToWorker<'decrypt'>({
    type: 'decrypt',
    encryptedData,
    pin,
  });
  return { mnemonic: result.mnemonic, hexSeed: result.hexSeed };
}

/**
 * Re-encrypt a seed with a new PIN using Web Worker (non-blocking).
 */
export async function reEncryptSeedAsync(
  encryptedSeed: string,
  oldPin: string,
  newPin: string
): Promise<string> {
  const result = await postToWorker<'reEncrypt'>({
    type: 'reEncrypt',
    encryptedSeed,
    oldPin,
    newPin,
  });
  return result.encryptedSeed;
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
