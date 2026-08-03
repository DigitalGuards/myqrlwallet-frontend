/**
 * Web Worker for the genuinely CPU-bound crypto ops that would block the
 * main thread:
 * - MLDSA87 wallet expansion from a mnemonic (deriveHexSeed, 50-300 ms of
 *   pure JS)
 * - Argon2id keystore decryption for extension-backup imports
 *   (decryptKeystore; seconds on the WASM path, tens of seconds on the
 *   pure-JS fallback)
 *
 * Seed encryption/decryption no longer runs here: it moved to the main thread
 * (WebCrypto AES-256-GCM via walletEncryption.ts), which is async and
 * non-blocking, so it never froze the UI the way crypto-js PBKDF2 did.
 */

import { MLDSA87 } from '@theqrl/wallet.js';
import {
  decryptKeystoreToHexSeed,
  KeystoreDecryptError,
  KeystoreFormatError,
  type EncryptedKeystore,
} from './keystoreBackup';

// Error codes for crypto operations (shared with the main-thread client).
export const CryptoErrorCode = {
  INCORRECT_PIN: 'INCORRECT_PIN',
  INVALID_DATA: 'INVALID_DATA',
  OUTDATED_FORMAT: 'OUTDATED_FORMAT',
  DEVICE_CREDENTIAL_UNAVAILABLE: 'DEVICE_CREDENTIAL_UNAVAILABLE',
  DECRYPT_FAILED: 'DECRYPT_FAILED',
  UNKNOWN: 'UNKNOWN',
} as const;

export type CryptoErrorCode = typeof CryptoErrorCode[keyof typeof CryptoErrorCode];

export type CryptoWorkerMessage =
  | { type: 'deriveHexSeed'; mnemonic: string }
  | { type: 'decryptKeystore'; keystore: EncryptedKeystore; password: string };

export type CryptoWorkerResponse =
  | { type: 'deriveHexSeed'; success: true; hexSeed: string }
  | { type: 'decryptKeystore'; success: true; hexSeed: string }
  | { type: 'error'; success: false; code: CryptoErrorCode; error: string };

// Message type with optional requestId for matching concurrent requests
type MessageWithRequestId = CryptoWorkerMessage & { requestId?: number };

// Worker message handler
self.onmessage = async (event: MessageEvent<MessageWithRequestId>) => {
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
      case 'decryptKeystore': {
        // Argon2id (memory-hard, up to 256 MiB / 8 passes for extension
        // exports) + AES-GCM. Runs here so the main thread stays responsive.
        const hexSeed = await decryptKeystoreToHexSeed(message.keystore, message.password);
        self.postMessage({ type: 'decryptKeystore', success: true, hexSeed, requestId });
        break;
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const code =
      error instanceof KeystoreFormatError
        ? CryptoErrorCode.INVALID_DATA
        : error instanceof KeystoreDecryptError
          ? CryptoErrorCode.DECRYPT_FAILED
          : CryptoErrorCode.UNKNOWN;
    self.postMessage({ type: 'error', success: false, code, error: errorMessage, requestId });
  }
};
