/**
 * Read side of the QRL browser-extension backup format
 * ("qrl-wallet-backup-YYYY-MM-DD.json", exported from the extension's
 * Settings > Data screen; same envelope as upstream theQRL/qrl-web3-wallet).
 *
 * File shape:
 *   { version: "0.1.1", exportedAt, keystores: Keystore[], accounts, activeChain }
 * where each keystore is the @theqrl/web3-qrl-accounts v1 keystore:
 *   { version: 1, id, address, crypto: { ciphertext, cipherparams: { iv },
 *     cipher: "aes-256-gcm", kdf: "argon2id", kdfparams: { m, t, p, dklen, salt } } }
 *
 * Crypto contract (mirrors the extension's keystoreCrypto.ts exactly):
 * - password: NFC-normalized, raw UTF-8 bytes into Argon2id
 * - Argon2id(m KiB, t iterations, p lanes) -> dklen-byte AES key
 * - AES-256-GCM, 12-byte IV, 16-byte tag APPENDED inside ciphertext hex;
 *   the GCM tag is the sole integrity / wrong-password check (no separate MAC)
 * - plaintext: the raw 51-byte extended seed of one account
 *
 * kdfparams are honored per keystore within the same bounds the extension
 * enforces, because backups can contain older keystores written with weaker
 * params (the extension only re-encrypts them on unlock).
 */
import { deriveArgon2id } from './argon2';

export class KeystoreFormatError extends Error {
  constructor(message: string = 'Invalid keystore backup file.') {
    super(message);
    this.name = 'KeystoreFormatError';
  }
}

export class KeystoreDecryptError extends Error {
  constructor(
    message: string = 'Failed to decrypt keystore. Invalid password or corrupted data.',
  ) {
    super(message);
    this.name = 'KeystoreDecryptError';
  }
}

export interface KeystoreKdfParams {
  m: number;
  t: number;
  p: number;
  dklen: number;
  salt: string;
}

export interface EncryptedKeystore {
  version: number;
  id?: string;
  address?: string;
  crypto: {
    ciphertext: string;
    cipherparams: { iv: string };
    cipher: string;
    kdf: string;
    kdfparams: KeystoreKdfParams;
  };
}

// Operational import ceiling: accept historical weaker files, but never more
// work than the extension's current production writer emits. The upstream
// format permits much larger values (up to 1 GiB / t=50 / p=16); honoring
// those from an untrusted file would turn WASM allocation failure plus the JS
// fallback into a memory/CPU denial of service. Deliberate tradeoff: unusually
// over-hardened custom backups must be re-exported with production parameters.
const KDF_PARAM_BOUNDS = {
  m: { min: 4096, max: 262144 },
  t: { min: 2, max: 8 },
  p: { min: 1, max: 1 },
  dklen: { min: 32, max: 32 },
} as const;

// Current extended-seed length (3-byte descriptor + 48-byte seed). Will grow
// to 64 when the QIP-55 relaunch lands; both sides change together.
const SEED_BYTES = 51;
const IV_BYTES = 12;
const GCM_TAG_BYTES = 16;
// argon2 implementations reject salts under 8 bytes; catching it at parse
// time keeps a bad file from burning a KDF attempt (and, on the WASM path,
// from being mistaken for WASM unavailability). Mirrors the extension.
const MIN_SALT_BYTES = 8;
const MAX_SALT_BYTES = 64;
const MAX_KEYSTORES_PER_BACKUP = 10;
const MAX_METADATA_STRING_LENGTH = 129;
const MAX_KEYSTORE_PASSWORD_LENGTH = 1024;

function isHex(value: string): boolean {
  return value.length % 2 === 0 && !/[^0-9a-fA-F]/.test(value);
}

function hexToBytes(hex: string, label: string): Uint8Array<ArrayBuffer> {
  if (typeof hex !== 'string' || !isHex(hex)) {
    throw new KeystoreFormatError(`Invalid hex in keystore ${label}.`);
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += (bytes[i] ?? 0).toString(16).padStart(2, '0');
  }
  return hex;
}

function inBounds(value: unknown, bounds: { min: number; max: number }): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= bounds.min &&
    value <= bounds.max
  );
}

function validateKeystore(candidate: unknown, index: number): EncryptedKeystore {
  const label = `keystore #${index + 1}`;
  if (!candidate || typeof candidate !== 'object') {
    throw new KeystoreFormatError(`Invalid ${label}: not an object.`);
  }
  const ks = candidate as Record<string, unknown>;
  if (ks['version'] !== 1) {
    throw new KeystoreFormatError(`Unsupported ${label} version (expected 1).`);
  }
  const cryptoField = ks['crypto'];
  if (!cryptoField || typeof cryptoField !== 'object') {
    throw new KeystoreFormatError(`Invalid ${label}: missing crypto section.`);
  }
  const c = cryptoField as Record<string, unknown>;
  if (c['cipher'] !== 'aes-256-gcm') {
    throw new KeystoreFormatError(`Unsupported cipher in ${label} (expected aes-256-gcm).`);
  }
  if (c['kdf'] !== 'argon2id') {
    throw new KeystoreFormatError(`Unsupported KDF in ${label} (expected argon2id).`);
  }
  const cipherparams = c['cipherparams'];
  if (!cipherparams || typeof cipherparams !== 'object') {
    throw new KeystoreFormatError(`Invalid ${label}: missing cipherparams.`);
  }
  const iv = (cipherparams as Record<string, unknown>)['iv'];
  if (typeof iv !== 'string' || !isHex(iv) || iv.length !== IV_BYTES * 2) {
    throw new KeystoreFormatError(`Invalid IV in ${label} (expected 12 bytes of hex).`);
  }
  // Exactly one seed + the GCM tag: wrong-era (e.g. future 64-byte QIP-55)
  // or corrupt files fail here at selection time, not after a correct
  // password. Mirrors the extension's importer.
  const ciphertext = c['ciphertext'];
  if (
    typeof ciphertext !== 'string' ||
    !isHex(ciphertext) ||
    ciphertext.length !== (SEED_BYTES + GCM_TAG_BYTES) * 2
  ) {
    throw new KeystoreFormatError(`Invalid ciphertext in ${label}.`);
  }
  const kdfparams = c['kdfparams'];
  if (!kdfparams || typeof kdfparams !== 'object') {
    throw new KeystoreFormatError(`Invalid ${label}: missing kdfparams.`);
  }
  const kp = kdfparams as Record<string, unknown>;
  if (
    !inBounds(kp['m'], KDF_PARAM_BOUNDS.m) ||
    !inBounds(kp['t'], KDF_PARAM_BOUNDS.t) ||
    !inBounds(kp['p'], KDF_PARAM_BOUNDS.p) ||
    !inBounds(kp['dklen'], KDF_PARAM_BOUNDS.dklen)
  ) {
    throw new KeystoreFormatError(
      `KDF parameters in ${label} are outside the accepted bounds.`,
    );
  }
  const salt = kp['salt'];
  if (
    typeof salt !== 'string' ||
    !isHex(salt) ||
    salt.length < MIN_SALT_BYTES * 2 ||
    salt.length > MAX_SALT_BYTES * 2
  ) {
    throw new KeystoreFormatError(`Invalid salt in ${label}.`);
  }
  const id = ks['id'];
  const address = ks['address'];
  if (
    (id !== undefined &&
      (typeof id !== 'string' || id.length > MAX_METADATA_STRING_LENGTH)) ||
    (address !== undefined &&
      (typeof address !== 'string' || address.length > MAX_METADATA_STRING_LENGTH))
  ) {
    throw new KeystoreFormatError(`Invalid metadata in ${label}.`);
  }
  return {
    version: 1,
    id,
    address,
    crypto: {
      ciphertext,
      cipherparams: { iv },
      cipher: 'aes-256-gcm',
      kdf: 'argon2id',
      kdfparams: {
        m: kp['m'],
        t: kp['t'],
        p: kp['p'],
        dklen: kp['dklen'],
        salt,
      },
    },
  };
}

/**
 * Cheap shape test used for file-format routing: does this parsed JSON look
 * like an extension backup envelope (or a single bare keystore) rather than
 * the web wallet's own v2 file?
 */
export function looksLikeKeystoreBackup(parsed: unknown): boolean {
  if (!parsed || typeof parsed !== 'object') return false;
  const obj = parsed as Record<string, unknown>;
  if (Array.isArray(obj['keystores'])) return true;
  return obj['version'] === 1 && typeof obj['crypto'] === 'object' && obj['crypto'] !== null;
}

/**
 * Validate an extension backup envelope (or a single bare keystore object)
 * and return its keystores. Throws KeystoreFormatError with a field-level
 * message on any structural problem.
 */
export function parseKeystoreBackup(parsed: unknown): EncryptedKeystore[] {
  if (!parsed || typeof parsed !== 'object') {
    throw new KeystoreFormatError();
  }
  const obj = parsed as Record<string, unknown>;
  const rawList = Array.isArray(obj['keystores']) ? obj['keystores'] : [obj];
  if (rawList.length === 0) {
    throw new KeystoreFormatError('The backup file contains no keystores.');
  }
  if (rawList.length > MAX_KEYSTORES_PER_BACKUP) {
    throw new KeystoreFormatError(
      `The backup file contains more than ${MAX_KEYSTORES_PER_BACKUP} keystores.`,
    );
  }
  return rawList.map((entry, i) => validateKeystore(entry, i));
}

/**
 * Decrypt one keystore with the wallet password it was exported under and
 * return the extended seed as 0x-prefixed hex. Wrong password and tampering
 * are indistinguishable by design (GCM tag failure -> KeystoreDecryptError).
 */
export async function decryptKeystoreToHexSeed(
  keystore: EncryptedKeystore,
  password: string,
): Promise<string> {
  if (!password || password.length > MAX_KEYSTORE_PASSWORD_LENGTH) {
    throw new KeystoreDecryptError('Password is required.');
  }
  // Defense-in-depth for callers that bypass parseKeystoreBackup: AES-256-GCM
  // requires the production writer's exact 32-byte derived key.
  if (keystore.crypto.kdfparams.dklen !== 32) {
    throw new KeystoreFormatError(
      'Unsupported derived-key length (only dklen 32 / AES-256 is supported).',
    );
  }
  // Match the extension: NFC-normalize, then raw UTF-8 bytes into the KDF.
  const passwordBytes = new TextEncoder().encode(password.normalize('NFC'));
  const { kdfparams } = keystore.crypto;
  const salt = hexToBytes(kdfparams.salt, 'salt');
  const iv = hexToBytes(keystore.crypto.cipherparams.iv, 'IV');
  const ciphertext = hexToBytes(keystore.crypto.ciphertext, 'ciphertext');

  const derivedKey = await deriveArgon2id(passwordBytes, salt, kdfparams);
  const aesKey = await crypto.subtle.importKey(
    'raw',
    derivedKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );

  let seedBytes: Uint8Array;
  try {
    seedBytes = new Uint8Array(
      await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, ciphertext),
    );
  } catch {
    throw new KeystoreDecryptError();
  }

  if (seedBytes.length !== SEED_BYTES) {
    throw new KeystoreFormatError(
      `Decrypted seed has an unsupported length (${seedBytes.length} bytes; expected ${SEED_BYTES}).`,
    );
  }
  return `0x${bytesToHex(seedBytes)}`;
}
