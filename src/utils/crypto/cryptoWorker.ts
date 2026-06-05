/**
 * Web Worker for the one genuinely CPU-bound crypto op that still blocks the
 * main thread: MLDSA87 wallet expansion from a mnemonic (deriveHexSeed,
 * 50-300 ms of pure JS).
 *
 * Seed encryption/decryption no longer runs here: it moved to the main thread
 * (WebCrypto AES-256-GCM via walletEncryption.ts), which is async and
 * non-blocking, so it never froze the UI the way crypto-js PBKDF2 did.
 */

import { MLDSA87 } from '@theqrl/wallet.js';

// Error codes for crypto operations (shared with the main-thread client).
export const CryptoErrorCode = {
  INCORRECT_PIN: 'INCORRECT_PIN',
  INVALID_DATA: 'INVALID_DATA',
  OUTDATED_FORMAT: 'OUTDATED_FORMAT',
  UNKNOWN: 'UNKNOWN',
} as const;

export type CryptoErrorCode = typeof CryptoErrorCode[keyof typeof CryptoErrorCode];

export type CryptoWorkerMessage =
  | { type: 'deriveHexSeed'; mnemonic: string };

export type CryptoWorkerResponse =
  | { type: 'deriveHexSeed'; success: true; hexSeed: string }
  | { type: 'error'; success: false; code: CryptoErrorCode; error: string };

// Message type with optional requestId for matching concurrent requests
type MessageWithRequestId = CryptoWorkerMessage & { requestId?: number };

// Worker message handler
self.onmessage = (event: MessageEvent<MessageWithRequestId>) => {
  const { requestId, ...message } = event.data;

  try {
    switch (message.type) {
      case 'deriveHexSeed': {
        // MLDSA87 wallet expansion (50-300 ms on mobile). Returns the
        // extended seed in hex form; the main thread feeds it into
        // signTransaction() like before.
        const wallet = MLDSA87.newWalletFromMnemonic(message.mnemonic.trim());
        const hexSeed = wallet.getHexExtendedSeed();
        self.postMessage({ type: 'deriveHexSeed', success: true, hexSeed, requestId });
        break;
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    self.postMessage({ type: 'error', success: false, code: CryptoErrorCode.UNKNOWN, error: errorMessage, requestId });
  }
};
