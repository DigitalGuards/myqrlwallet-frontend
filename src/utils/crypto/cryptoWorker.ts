/**
 * Web Worker for CPU-intensive cryptographic operations.
 * Runs PBKDF2 key derivation off the main thread to keep UI responsive.
 */

import CryptoJS from 'crypto-js';

// Error codes for crypto operations
export const CryptoErrorCode = {
  INCORRECT_PIN: 'INCORRECT_PIN',
  INVALID_DATA: 'INVALID_DATA',
  UNKNOWN: 'UNKNOWN',
} as const;

export type CryptoErrorCode = typeof CryptoErrorCode[keyof typeof CryptoErrorCode];

export type CryptoWorkerMessage =
  | { type: 'encrypt'; mnemonic: string; hexSeed: string; pin: string }
  | { type: 'decrypt'; encryptedData: string; pin: string }
  | { type: 'reEncrypt'; encryptedSeed: string; oldPin: string; newPin: string };

export type CryptoWorkerResponse =
  | { type: 'encrypt'; success: true; encryptedSeed: string }
  | { type: 'decrypt'; success: true; mnemonic: string; hexSeed: string }
  | { type: 'reEncrypt'; success: true; encryptedSeed: string }
  | { type: 'error'; success: false; code: CryptoErrorCode; error: string };

// Version constants
const PIN_VERSION = 'pin_v3';
const ITERATIONS = 600000;

// Custom error class to carry error code
class CryptoError extends Error {
  constructor(public code: CryptoErrorCode, message: string) {
    super(message);
    this.name = 'CryptoError';
  }
}

function getIterations(_version: string | undefined): number {
  return ITERATIONS;
}

function encryptSeed(mnemonic: string, hexSeed: string, pin: string): string {
  const salt = CryptoJS.lib.WordArray.random(128 / 8);
  const iv = CryptoJS.lib.WordArray.random(128 / 8);

  const key = CryptoJS.PBKDF2(pin, salt, {
    keySize: 256 / 32,
    iterations: ITERATIONS,
  });

  const encrypted = CryptoJS.AES.encrypt(
    JSON.stringify({ mnemonic, hexSeed }),
    key,
    { iv }
  );

  return JSON.stringify({
    encryptedData: encrypted.toString(),
    salt: salt.toString(),
    iv: iv.toString(),
    version: PIN_VERSION,
    timestamp: Date.now(),
  });
}

function decryptSeed(encryptedData: string, pin: string): { mnemonic: string; hexSeed: string } {
  let parsed;
  try {
    parsed = JSON.parse(encryptedData);
  } catch {
    throw new CryptoError(CryptoErrorCode.INVALID_DATA, 'Invalid encrypted data format');
  }

  const salt = CryptoJS.enc.Hex.parse(parsed.salt);
  const iv = CryptoJS.enc.Hex.parse(parsed.iv);
  const iterations = getIterations(parsed.version);

  const key = CryptoJS.PBKDF2(pin, salt, {
    keySize: 256 / 32,
    iterations,
  });

  const decrypted = CryptoJS.AES.decrypt(parsed.encryptedData, key, { iv });

  // Convert to UTF-8 - wrong PIN produces garbage bytes that fail here
  let decryptedStr: string;
  try {
    decryptedStr = decrypted.toString(CryptoJS.enc.Utf8);
    if (!decryptedStr) {
      throw new Error('Empty result');
    }
  } catch {
    throw new CryptoError(CryptoErrorCode.INCORRECT_PIN, 'Incorrect PIN');
  }

  // Parse JSON - wrong PIN could produce valid UTF-8 but invalid JSON
  try {
    return JSON.parse(decryptedStr);
  } catch {
    throw new CryptoError(CryptoErrorCode.INCORRECT_PIN, 'Incorrect PIN');
  }
}

// Message type with optional requestId for matching concurrent requests
type MessageWithRequestId = CryptoWorkerMessage & { requestId?: number };

// Worker message handler
self.onmessage = (event: MessageEvent<MessageWithRequestId>) => {
  const { requestId, ...message } = event.data;

  try {
    switch (message.type) {
      case 'encrypt': {
        const encryptedSeed = encryptSeed(message.mnemonic, message.hexSeed, message.pin);
        self.postMessage({ type: 'encrypt', success: true, encryptedSeed, requestId });
        break;
      }

      case 'decrypt': {
        const { mnemonic, hexSeed } = decryptSeed(message.encryptedData, message.pin);
        self.postMessage({ type: 'decrypt', success: true, mnemonic, hexSeed, requestId });
        break;
      }

      case 'reEncrypt': {
        // Decrypt with old PIN, re-encrypt with new PIN
        const decrypted = decryptSeed(message.encryptedSeed, message.oldPin);
        const reEncrypted = encryptSeed(decrypted.mnemonic, decrypted.hexSeed, message.newPin);
        self.postMessage({ type: 'reEncrypt', success: true, encryptedSeed: reEncrypted, requestId });
        break;
      }
    }
  } catch (error) {
    if (error instanceof CryptoError) {
      self.postMessage({ type: 'error', success: false, code: error.code, error: error.message, requestId });
    } else {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      self.postMessage({ type: 'error', success: false, code: CryptoErrorCode.UNKNOWN, error: errorMessage, requestId });
    }
  }
};
