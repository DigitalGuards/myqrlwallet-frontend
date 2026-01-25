/**
 * Web Worker for CPU-intensive cryptographic operations.
 * Runs PBKDF2 key derivation off the main thread to keep UI responsive.
 */

import CryptoJS from 'crypto-js';

export type CryptoWorkerMessage =
  | { type: 'encrypt'; mnemonic: string; hexSeed: string; pin: string }
  | { type: 'decrypt'; encryptedData: string; pin: string }
  | { type: 'reEncrypt'; encryptedSeed: string; oldPin: string; newPin: string };

export type CryptoWorkerResponse =
  | { type: 'encrypt'; success: true; encryptedSeed: string }
  | { type: 'decrypt'; success: true; mnemonic: string; hexSeed: string }
  | { type: 'reEncrypt'; success: true; encryptedSeed: string }
  | { type: 'error'; success: false; error: string };

// Version constants
const PIN_VERSION = 'pin_v3';
const ITERATIONS_V3 = 600000;
const ITERATIONS_V2 = 100000;
const ITERATIONS_V1 = 5000;

function getIterations(version: string | undefined): number {
  if (version === 'pin_v3') return ITERATIONS_V3;
  if (version === 'pin_v2') return ITERATIONS_V2;
  return ITERATIONS_V1;
}

function encryptSeed(mnemonic: string, hexSeed: string, pin: string): string {
  const salt = CryptoJS.lib.WordArray.random(128 / 8);
  const iv = CryptoJS.lib.WordArray.random(128 / 8);

  const key = CryptoJS.PBKDF2(pin, salt, {
    keySize: 256 / 32,
    iterations: ITERATIONS_V3,
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
  const parsed = JSON.parse(encryptedData);
  const salt = CryptoJS.enc.Hex.parse(parsed.salt);
  const iv = CryptoJS.enc.Hex.parse(parsed.iv);
  const iterations = getIterations(parsed.version);

  const key = CryptoJS.PBKDF2(pin, salt, {
    keySize: 256 / 32,
    iterations,
  });

  const decrypted = CryptoJS.AES.decrypt(parsed.encryptedData, key, { iv });
  return JSON.parse(decrypted.toString(CryptoJS.enc.Utf8));
}

// Worker message handler
self.onmessage = (event: MessageEvent<CryptoWorkerMessage>) => {
  const message = event.data;

  try {
    switch (message.type) {
      case 'encrypt': {
        const encryptedSeed = encryptSeed(message.mnemonic, message.hexSeed, message.pin);
        self.postMessage({ type: 'encrypt', success: true, encryptedSeed } as CryptoWorkerResponse);
        break;
      }

      case 'decrypt': {
        const { mnemonic, hexSeed } = decryptSeed(message.encryptedData, message.pin);
        self.postMessage({ type: 'decrypt', success: true, mnemonic, hexSeed } as CryptoWorkerResponse);
        break;
      }

      case 'reEncrypt': {
        // Decrypt with old PIN, re-encrypt with new PIN
        const decrypted = decryptSeed(message.encryptedSeed, message.oldPin);
        const reEncrypted = encryptSeed(decrypted.mnemonic, decrypted.hexSeed, message.newPin);
        self.postMessage({ type: 'reEncrypt', success: true, encryptedSeed: reEncrypted } as CryptoWorkerResponse);
        break;
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    self.postMessage({ type: 'error', success: false, error: errorMessage } as CryptoWorkerResponse);
  }
};
