/**
 * Client interface for the crypto Web Worker.
 * Provides async functions that run PBKDF2 off the main thread.
 */

import type { CryptoWorkerMessage, CryptoWorkerResponse } from './cryptoWorker';

// Vite worker import syntax
import CryptoWorker from './cryptoWorker?worker';

let workerInstance: Worker | null = null;
let requestIdCounter = 0;

function getWorker(): Worker {
  if (!workerInstance) {
    workerInstance = new CryptoWorker();
  }
  return workerInstance;
}

// Response type with requestId for matching concurrent requests
type WorkerResponseWithId = CryptoWorkerResponse & { requestId: number };

/**
 * Send a message to the worker and wait for response.
 * Uses request IDs to correctly match responses when multiple concurrent requests are made.
 */
function postToWorker<T extends CryptoWorkerResponse['type']>(
  message: CryptoWorkerMessage
): Promise<Extract<CryptoWorkerResponse, { type: T; success: true }>> {
  return new Promise((resolve, reject) => {
    const worker = getWorker();
    const requestId = ++requestIdCounter;

    const handler = (event: MessageEvent<WorkerResponseWithId>) => {
      // Only process if this response matches our request ID
      if (event.data.requestId !== requestId) return;

      worker.removeEventListener('message', handler);
      worker.removeEventListener('error', errorHandler);

      const { requestId: _reqId, ...response } = event.data;
      if (response.success) {
        resolve(response as Extract<CryptoWorkerResponse, { type: T; success: true }>);
      } else {
        reject(new Error((response as { error: string }).error));
      }
    };

    const errorHandler = (error: ErrorEvent) => {
      worker.removeEventListener('message', handler);
      worker.removeEventListener('error', errorHandler);
      reject(new Error(error.message || 'Worker error'));
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
 * Terminate the worker when no longer needed.
 */
export function terminateCryptoWorker(): void {
  if (workerInstance) {
    workerInstance.terminate();
    workerInstance = null;
  }
}
