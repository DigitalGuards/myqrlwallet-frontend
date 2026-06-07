import type { Web3BaseWalletAccount } from '@theqrl/web3';
import { isInNativeApp, shareContent } from '@/utils/nativeApp';

export interface WalletData {
  address: string;
  mnemonic: string;
  hexSeed: string;
}

export interface EncryptedWallet {
  address: string;
  encryptedData: string;
  salt: string;
  iv: string;
  version: string;
  timestamp: number;
}

// Extend Web3BaseWalletAccount to include mnemonic and hexSeed
export interface ExtendedWalletAccount extends Web3BaseWalletAccount {
  mnemonic?: string;
  hexSeed?: string;
}

// Bumped to v2 when the file format moved from crypto-js AES-CBC to WebCrypto
// AES-256-GCM. Used for both the encrypted and the plaintext wallet-file labels.
const CURRENT_WALLET_VERSION = 'v2';
// Current PIN/seed blob format: WebCrypto AES-256-GCM + PBKDF2-SHA256.
const PIN_VERSION = 'pin_v4';
const PBKDF2_ITERATIONS = 600000; // OWASP 2023 recommended minimum
const SALT_BYTES = 16;
const IV_BYTES = 12; // 96-bit nonce, the AES-GCM standard

/**
 * Custom error class for PIN decryption failures.
 * Allows reliable error type checking without fragile string matching.
 */
export class PinDecryptionError extends Error {
  constructor(message: string = 'Failed to decrypt seed. Invalid PIN.') {
    super(message);
    this.name = 'PinDecryptionError';
  }
}

/**
 * Thrown when a seed blob was written by an older (pre-WebCrypto) format and
 * cannot be decrypted. There is no migration path: the user must re-import.
 * Surfaced distinctly so the UI can say "re-import" instead of "wrong PIN".
 */
export class OutdatedWalletFormatError extends Error {
  constructor(
    message: string = 'This wallet was saved in an older format and must be re-imported.',
  ) {
    super(message);
    this.name = 'OutdatedWalletFormatError';
  }
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += (bytes[i] ?? 0).toString(16).padStart(2, '0');
  }
  return hex;
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  if (typeof hex !== 'string' || hex.length % 2 !== 0 || /[^0-9a-fA-F]/.test(hex)) {
    throw new Error('Invalid hex string');
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

interface AesGcmEnvelope {
  salt: string;
  iv: string;
  encryptedData: string;
}

/**
 * Derive a 256-bit AES-GCM key from a secret (PIN or password) via
 * PBKDF2-SHA256. Non-extractable; the browser runs the KDF off the JS thread.
 */
async function deriveAesGcmKey(secret: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { name: 'PBKDF2' },
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Authenticated-encrypt a UTF-8 string. Fresh random salt + nonce each call. */
async function aesGcmEncrypt(plaintext: string, secret: string): Promise<AesGcmEnvelope> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveAesGcmKey(secret, salt);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, textEncoder.encode(plaintext)),
  );
  return {
    salt: bytesToHex(salt),
    iv: bytesToHex(iv),
    encryptedData: bytesToHex(ciphertext),
  };
}

/**
 * Authenticated-decrypt. Throws if the GCM tag fails (wrong secret or tampered
 * ciphertext): unlike AES-CBC this is detected, not silently mis-decrypted.
 */
async function aesGcmDecrypt(envelope: AesGcmEnvelope, secret: string): Promise<string> {
  const salt = hexToBytes(envelope.salt);
  const iv = hexToBytes(envelope.iv);
  const key = await deriveAesGcmKey(secret, salt);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    hexToBytes(envelope.encryptedData),
  );
  return textDecoder.decode(plaintext);
}

export class WalletEncryptionUtil {
  static async encryptWallet(walletData: WalletData, password: string): Promise<EncryptedWallet> {
    const env = await aesGcmEncrypt(
      JSON.stringify({ mnemonic: walletData.mnemonic, hexSeed: walletData.hexSeed }),
      password,
    );
    return {
      address: walletData.address,
      encryptedData: env.encryptedData,
      salt: env.salt,
      iv: env.iv,
      version: CURRENT_WALLET_VERSION,
      timestamp: Date.now(),
    };
  }

  static async decryptWallet(
    encryptedWallet: EncryptedWallet,
    password: string,
  ): Promise<WalletData> {
    try {
      const json = await aesGcmDecrypt(
        {
          salt: encryptedWallet.salt,
          iv: encryptedWallet.iv,
          encryptedData: encryptedWallet.encryptedData,
        },
        password,
      );
      const decryptedData = JSON.parse(json);
      return {
        address: encryptedWallet.address,
        mnemonic: decryptedData.mnemonic,
        hexSeed: decryptedData.hexSeed,
      };
    } catch (_error) {
      throw new Error('Failed to decrypt wallet. Invalid password or corrupted data.');
    }
  }

  static async downloadWallet(
    account: ExtendedWalletAccount | undefined,
    password?: string,
  ): Promise<void> {
    if (!account) {
      throw new Error('Account is required for wallet download');
    }

    if (!account.mnemonic || !account.hexSeed) {
      throw new Error('Account must have mnemonic and hexSeed for wallet download');
    }

    const walletData: WalletData = {
      address: account.address,
      mnemonic: account.mnemonic,
      hexSeed: account.hexSeed,
    };

    let fileContent: string;
    let fileName: string;

    if (password) {
      if (!this.validatePassword(password)) {
        throw new Error('Password does not meet security requirements');
      }
      // Encrypted wallet
      const encryptedWallet = await this.encryptWallet(walletData, password);
      fileContent = JSON.stringify(encryptedWallet, null, 2);
      fileName = `encrypted-wallet-${walletData.address}.json`;
    } else {
      // Unencrypted wallet (with warning in the file)
      const unencryptedContent = {
        warning: "WARNING: This is an unencrypted wallet file. Never share this file with anyone. Use this file at your own risk.",
        address: walletData.address,
        mnemonic: walletData.mnemonic,
        hexSeed: walletData.hexSeed,
        timestamp: Date.now(),
        version: CURRENT_WALLET_VERSION,
      };
      fileContent = JSON.stringify(unencryptedContent, null, 2);
      fileName = `wallet-${walletData.address}.json`;
    }

    // In native app, use share functionality instead of browser download
    if (isInNativeApp()) {
      shareContent({
        title: `QRL Wallet - ${walletData.address.substring(0, 10)}...`,
        text: fileContent,
      });
      return;
    }

    // Browser download
    const blob = new Blob([fileContent], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  static validatePassword(password: string): boolean {
    // Minimum requirements:
    // - At least 8 characters
    // - Contains at least one uppercase letter
    // - Contains at least one lowercase letter
    // - Contains at least one number
    // - Contains at least one special character
    const minLength = 8;
    const hasUpperCase = /[A-Z]/.test(password);
    const hasLowerCase = /[a-z]/.test(password);
    const hasNumbers = /\d/.test(password);
    const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(password);

    return (
      password.length >= minLength &&
      hasUpperCase &&
      hasLowerCase &&
      hasNumbers &&
      hasSpecialChar
    );
  }

  // PIN-based encryption for localStorage (WebCrypto AES-256-GCM + PBKDF2-SHA256)
  static async encryptSeedWithPin(mnemonic: string, hexSeed: string, pin: string): Promise<string> {
    if (!this.validatePin(pin)) {
      throw new Error('Invalid PIN format');
    }

    const env = await aesGcmEncrypt(JSON.stringify({ mnemonic, hexSeed }), pin);

    // Return format that can be stored in localStorage
    return JSON.stringify({
      encryptedData: env.encryptedData,
      salt: env.salt,
      iv: env.iv,
      version: PIN_VERSION,
      timestamp: Date.now(),
    });
  }

  static async decryptSeedWithPin(
    encryptedData: string,
    pin: string,
  ): Promise<{ mnemonic: string; hexSeed: string }> {
    let parsed;
    try {
      parsed = JSON.parse(encryptedData);
    } catch {
      throw new PinDecryptionError('Invalid encrypted seed format.');
    }

    // Valid JSON but not an object (e.g. "123" or "null") is corrupt data, not
    // an old format: report it as such rather than prompting a pointless
    // re-import.
    if (!parsed || typeof parsed !== 'object') {
      throw new PinDecryptionError('Invalid encrypted seed format.');
    }

    // No legacy migration. Only pin_v4 (WebCrypto AES-GCM) is supported; a blob
    // written by the old crypto-js format (pin_v3 and earlier) cannot be
    // decrypted and the user must re-import. Surface that distinctly so the UI
    // shows a re-import prompt rather than a misleading "incorrect PIN".
    if (parsed.version !== PIN_VERSION) {
      throw new OutdatedWalletFormatError();
    }

    // A pin_v4 blob missing its envelope fields is corrupt, not a wrong PIN:
    // report it as a format error rather than letting it surface as "Invalid PIN".
    if (
      typeof parsed.salt !== 'string' ||
      typeof parsed.iv !== 'string' ||
      typeof parsed.encryptedData !== 'string'
    ) {
      throw new PinDecryptionError('Invalid encrypted seed format.');
    }

    try {
      const json = await aesGcmDecrypt(
        { salt: parsed.salt, iv: parsed.iv, encryptedData: parsed.encryptedData },
        pin,
      );
      return JSON.parse(json);
    } catch (_error) {
      throw new PinDecryptionError();
    }
  }

  // Simple PIN validation (4-6 digits)
  static validatePin(pin: string): boolean {
    return /^\d{4,6}$/.test(pin);
  }

  // Re-encrypt a seed with a new PIN (for Change PIN feature)
  static async reEncryptSeed(encryptedSeed: string, oldPin: string, newPin: string): Promise<string> {
    // Decrypt with old PIN (throws if oldPin is incorrect)
    const decrypted = await this.decryptSeedWithPin(encryptedSeed, oldPin);

    // Re-encrypt with new PIN
    return this.encryptSeedWithPin(decrypted.mnemonic, decrypted.hexSeed, newPin);
  }
}
