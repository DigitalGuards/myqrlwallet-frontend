import type { Web3BaseWalletAccount } from '@theqrl/web3';
import { isInNativeApp, shareContent } from '@/utils/nativeApp';
import { isDesktop } from '@/desktop/bridge';
import {
  DeviceCredentialUnavailableError,
  getDeviceEncryptionKey,
} from './deviceCredential';

/**
 * Defense-in-depth: on desktop the seed lives only in the isolated signer, so
 * any renderer code path that tries to materialise or re-encrypt seed material
 * is a bug. These primitives throw loudly instead of leaking. The web build
 * (isDesktop === false) is unaffected.
 */
const DESKTOP_SEED_GUARD_MESSAGE =
  'desktop: key material lives in the signer, not the renderer';

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
// pin_v5 nests PIN encryption inside independent device-key encryption. pin_v4
// remains readable only so an existing wallet can migrate after a successful
// PIN unlock; new ciphertext is never written without the device factor.
const PIN_VERSION = 'pin_v5';
const LEGACY_PIN_VERSION = 'pin_v4';
const DEVICE_KEY_VERSION = 'device_v1';
const PBKDF2_ITERATIONS = 600000; // OWASP 2023 recommended minimum
const SALT_BYTES = 16;
const IV_BYTES = 12; // 96-bit nonce, the AES-GCM standard
const MAX_SEED_CIPHERTEXT_HEX_LENGTH = 32 * 1024;
const MAX_PIN_BLOB_JSON_LENGTH = 64 * 1024;
const MAX_MNEMONIC_LENGTH = 4096;
const MAX_HEX_SEED_LENGTH = 512;

// File-picker callers enforce this before File.text(); direct decrypt callers
// still receive the field-level bounds below.
export const MAX_WALLET_FILE_BYTES = 1024 * 1024;
export const MAX_WALLET_PASSWORD_LENGTH = 1024;

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

export { DeviceCredentialUnavailableError } from './deviceCredential';

export interface VersionedSeedDecryption {
  seed: { mnemonic: string; hexSeed: string };
  version: typeof PIN_VERSION | typeof LEGACY_PIN_VERSION;
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

function isExactHex(value: unknown, byteLength: number): value is string {
  return (
    typeof value === 'string' &&
    value.length === byteLength * 2 &&
    /^[0-9a-f]+$/i.test(value)
  );
}

function isBoundedCiphertext(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 32 &&
    value.length <= MAX_SEED_CIPHERTEXT_HEX_LENGTH &&
    value.length % 2 === 0 &&
    /^[0-9a-f]+$/i.test(value)
  );
}

function parseSeedJson(json: string): { mnemonic: string; hexSeed: string } {
  const parsed = JSON.parse(json) as unknown;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid seed payload');
  }
  const seed = parsed as Record<string, unknown>;
  const mnemonic = seed['mnemonic'];
  const hexSeed = seed['hexSeed'];
  if (
    typeof mnemonic !== 'string' ||
    mnemonic.length === 0 ||
    mnemonic.length > MAX_MNEMONIC_LENGTH ||
    typeof hexSeed !== 'string' ||
    hexSeed.length === 0 ||
    hexSeed.length > MAX_HEX_SEED_LENGTH
  ) {
    throw new Error('Invalid seed payload');
  }
  const seedHex = hexSeed.startsWith('0x') ? hexSeed.slice(2) : hexSeed;
  if (seedHex.length === 0 || seedHex.length % 2 !== 0 || /[^0-9a-f]/i.test(seedHex)) {
    throw new Error('Invalid seed payload');
  }
  return { mnemonic, hexSeed };
}

function assertWalletPasswordInput(password: string): void {
  if (
    typeof password !== 'string' ||
    password.length === 0 ||
    password.length > MAX_WALLET_PASSWORD_LENGTH
  ) {
    throw new Error('Invalid wallet password');
  }
}

function parseEncryptedWalletEnvelope(encryptedWallet: unknown): EncryptedWallet {
  if (!encryptedWallet || typeof encryptedWallet !== 'object') {
    throw new Error('Invalid encrypted wallet format');
  }
  const envelope = encryptedWallet as Record<string, unknown>;
  if (
    envelope['version'] !== CURRENT_WALLET_VERSION ||
    typeof envelope['address'] !== 'string' ||
    envelope['address'].length > 129 ||
    !Number.isSafeInteger(envelope['timestamp']) ||
    (envelope['timestamp'] as number) < 0 ||
    !isExactHex(envelope['salt'], SALT_BYTES) ||
    !isExactHex(envelope['iv'], IV_BYTES) ||
    !isBoundedCiphertext(envelope['encryptedData'])
  ) {
    throw new Error('Invalid encrypted wallet format');
  }
  return {
    address: envelope['address'],
    encryptedData: envelope['encryptedData'],
    salt: envelope['salt'],
    iv: envelope['iv'],
    version: CURRENT_WALLET_VERSION,
    timestamp: envelope['timestamp'] as number,
  };
}

function deviceAdditionalData(timestamp: number): Uint8Array<ArrayBuffer> {
  return textEncoder.encode(`${PIN_VERSION}\u0000${DEVICE_KEY_VERSION}\u0000${timestamp}`);
}

async function encryptPinV5(plaintext: string, pin: string): Promise<string> {
  // The PBKDF2 envelope is itself concealed by the independent device key, so
  // a stolen localStorage/AsyncStorage blob exposes no verifier for offline
  // PIN guessing unless the attacker also obtains the device credential.
  const inner = await aesGcmEncrypt(plaintext, pin);
  const timestamp = Date.now();
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const deviceKey = await getDeviceEncryptionKey(true);
  const encryptedData = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv,
        additionalData: deviceAdditionalData(timestamp),
      },
      deviceKey,
      textEncoder.encode(JSON.stringify(inner)),
    ),
  );

  return JSON.stringify({
    encryptedData: bytesToHex(encryptedData),
    iv: bytesToHex(iv),
    version: PIN_VERSION,
    deviceKeyVersion: DEVICE_KEY_VERSION,
    timestamp,
  });
}

async function decryptPinV5(
  parsed: Record<string, unknown>,
  pin: string,
): Promise<{ mnemonic: string; hexSeed: string }> {
  if (
    parsed['deviceKeyVersion'] !== DEVICE_KEY_VERSION ||
    typeof parsed['timestamp'] !== 'number' ||
    !Number.isSafeInteger(parsed['timestamp']) ||
    parsed['timestamp'] < 0 ||
    !isExactHex(parsed['iv'], IV_BYTES) ||
    !isBoundedCiphertext(parsed['encryptedData'])
  ) {
    throw new PinDecryptionError('Invalid encrypted seed format.');
  }

  const deviceKey = await getDeviceEncryptionKey(false);
  let innerJson: string;
  try {
    const plaintext = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: hexToBytes(parsed['iv']),
        additionalData: deviceAdditionalData(parsed['timestamp']),
      },
      deviceKey,
      hexToBytes(parsed['encryptedData']),
    );
    innerJson = textDecoder.decode(plaintext);
  } catch (_error) {
    throw new DeviceCredentialUnavailableError(
      'This wallet is corrupted or is bound to a different device credential.',
    );
  }

  let inner: unknown;
  try {
    inner = JSON.parse(innerJson);
  } catch {
    throw new DeviceCredentialUnavailableError('The device-protected wallet envelope is corrupt.');
  }
  if (!inner || typeof inner !== 'object') {
    throw new DeviceCredentialUnavailableError('The device-protected wallet envelope is corrupt.');
  }
  const pinEnvelope = inner as Record<string, unknown>;
  if (
    !isExactHex(pinEnvelope['salt'], SALT_BYTES) ||
    !isExactHex(pinEnvelope['iv'], IV_BYTES) ||
    !isBoundedCiphertext(pinEnvelope['encryptedData'])
  ) {
    throw new DeviceCredentialUnavailableError('The device-protected wallet envelope is corrupt.');
  }

  try {
    const json = await aesGcmDecrypt(
      {
        salt: pinEnvelope['salt'],
        iv: pinEnvelope['iv'],
        encryptedData: pinEnvelope['encryptedData'],
      },
      pin,
    );
    return parseSeedJson(json);
  } catch (_error) {
    throw new PinDecryptionError();
  }
}

async function decryptPinV4(
  parsed: Record<string, unknown>,
  pin: string,
): Promise<{ mnemonic: string; hexSeed: string }> {
  if (
    !isExactHex(parsed['salt'], SALT_BYTES) ||
    !isExactHex(parsed['iv'], IV_BYTES) ||
    !isBoundedCiphertext(parsed['encryptedData'])
  ) {
    throw new PinDecryptionError('Invalid encrypted seed format.');
  }

  try {
    const json = await aesGcmDecrypt(
      {
        salt: parsed['salt'],
        iv: parsed['iv'],
        encryptedData: parsed['encryptedData'],
      },
      pin,
    );
    return parseSeedJson(json);
  } catch (_error) {
    throw new PinDecryptionError();
  }
}

export class WalletEncryptionUtil {
  static async encryptWallet(walletData: WalletData, password: string): Promise<EncryptedWallet> {
    assertWalletPasswordInput(password);
    parseSeedJson(JSON.stringify({ mnemonic: walletData.mnemonic, hexSeed: walletData.hexSeed }));
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
    // Deliberately NOT desktop-guarded: encrypted-file import is the desktop
    // recovery path (ImportAccount.tsx renders the tab there on purpose). The
    // secret comes from the user's own file and is handed to the signer
    // without persisting in the renderer, same exposure as typing a mnemonic.
    // The guard stays on every PIN/at-rest entry point below.
    try {
      assertWalletPasswordInput(password);
      const envelope = parseEncryptedWalletEnvelope(encryptedWallet);
      const json = await aesGcmDecrypt(
        {
          salt: envelope.salt,
          iv: envelope.iv,
          encryptedData: envelope.encryptedData,
        },
        password,
      );
      const decryptedData = parseSeedJson(json);
      return {
        address: envelope.address,
        mnemonic: decryptedData.mnemonic,
        hexSeed: decryptedData.hexSeed,
      };
    } catch (_error) {
      throw new Error('Failed to decrypt wallet. Invalid password or corrupted data.');
    }
  }

  /** Cheap, KDF-free validation used by wallet-file import routing. */
  static parseEncryptedWallet(encryptedWallet: unknown): EncryptedWallet {
    return parseEncryptedWalletEnvelope(encryptedWallet);
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

  // PIN + device-factor encryption for local at-rest seed storage.
  static async encryptSeedWithPin(mnemonic: string, hexSeed: string, pin: string): Promise<string> {
    if (isDesktop) {
      throw new Error(DESKTOP_SEED_GUARD_MESSAGE);
    }
    if (!this.validatePin(pin)) {
      throw new Error('Invalid PIN format');
    }

    return encryptPinV5(JSON.stringify({ mnemonic, hexSeed }), pin);
  }

  static async decryptSeedWithPinVersioned(
    encryptedData: string,
    pin: string,
  ): Promise<VersionedSeedDecryption> {
    if (isDesktop) {
      throw new Error(DESKTOP_SEED_GUARD_MESSAGE);
    }
    if (
      typeof encryptedData !== 'string' ||
      encryptedData.length === 0 ||
      encryptedData.length > MAX_PIN_BLOB_JSON_LENGTH ||
      !this.validatePin(pin)
    ) {
      throw new PinDecryptionError('Invalid encrypted seed format.');
    }
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

    if (parsed.version === PIN_VERSION) {
      return { seed: await decryptPinV5(parsed, pin), version: PIN_VERSION };
    }

    if (parsed.version === LEGACY_PIN_VERSION) {
      return { seed: await decryptPinV4(parsed, pin), version: LEGACY_PIN_VERSION };
    }

    // crypto-js pin_v3 and earlier remain unauthenticated and cannot safely be
    // migrated. Surface this distinctly so the UI asks for a seed re-import.
    throw new OutdatedWalletFormatError();
  }

  static async decryptSeedWithPin(
    encryptedData: string,
    pin: string,
  ): Promise<{ mnemonic: string; hexSeed: string }> {
    return (await this.decryptSeedWithPinVersioned(encryptedData, pin)).seed;
  }

  // Simple PIN validation (4-6 digits)
  static validatePin(pin: string): boolean {
    return /^\d{4,6}$/.test(pin);
  }

  // Re-encrypt a seed with a new PIN (for Change PIN feature)
  static async reEncryptSeed(encryptedSeed: string, oldPin: string, newPin: string): Promise<string> {
    if (isDesktop) {
      throw new Error(DESKTOP_SEED_GUARD_MESSAGE);
    }
    // Decrypt with old PIN (throws if oldPin is incorrect)
    const decrypted = await this.decryptSeedWithPin(encryptedSeed, oldPin);

    // Re-encrypt with new PIN
    return this.encryptSeedWithPin(decrypted.mnemonic, decrypted.hexSeed, newPin);
  }
}
