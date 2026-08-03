import {
  isInNativeApp,
  requestNativeDeviceCredential,
} from '@/utils/nativeApp';

const DATABASE_NAME = 'myqrlwallet-device-credentials';
const DATABASE_VERSION = 1;
const STORE_NAME = 'credentials';
const DEVICE_KEY_ID = 'wallet-seed-device-key-v1';
const DEVICE_KEY_BYTES = 32;

/**
 * The PIN-encrypted seed cannot be opened because its independent device
 * credential is missing, unavailable, or does not match this device.
 *
 * Keep this distinct from PinDecryptionError: counting a missing Keychain or
 * IndexedDB entry as an incorrect PIN would lock users out for the wrong
 * reason and conceal the actual recovery problem.
 */
export class DeviceCredentialUnavailableError extends Error {
  constructor(
    message: string =
      'This wallet cannot be opened because its device security credential is unavailable.',
  ) {
    super(message);
    this.name = 'DeviceCredentialUnavailableError';
  }
}

let cachedDeviceKey: Promise<CryptoKey> | null = null;
let databasePromise: Promise<IDBDatabase> | null = null;

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  if (!new RegExp(`^[0-9a-f]{${DEVICE_KEY_BYTES * 2}}$`, 'i').test(hex)) {
    throw new DeviceCredentialUnavailableError('The native device credential is invalid.');
  }

  const bytes = new Uint8Array(DEVICE_KEY_BYTES);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function isUsableDeviceKey(value: unknown): value is CryptoKey {
  if (!value || typeof value !== 'object') return false;
  const key = value as CryptoKey;
  const algorithm = key.algorithm as KeyAlgorithm | undefined;
  return (
    key.type === 'secret' &&
    key.extractable === false &&
    algorithm?.name === 'AES-GCM' &&
    key.usages.includes('encrypt') &&
    key.usages.includes('decrypt')
  );
}

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;
  if (typeof indexedDB === 'undefined') {
    throw new DeviceCredentialUnavailableError(
      'Secure browser storage is unavailable. Wallet creation has been stopped.',
    );
  }

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      databasePromise = null;
      reject(
        new DeviceCredentialUnavailableError(
          'Secure browser storage could not be opened. Wallet creation has been stopped.',
        ),
      );
    };
    request.onblocked = () => {
      databasePromise = null;
      reject(
        new DeviceCredentialUnavailableError(
          'Secure browser storage is blocked by another wallet tab.',
        ),
      );
    };
  });

  return databasePromise;
}

function readStoredKey(database: IDBDatabase): Promise<CryptoKey | null> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const request = transaction.objectStore(STORE_NAME).get(DEVICE_KEY_ID);
    request.onsuccess = () => {
      if (request.result === undefined) {
        resolve(null);
        return;
      }
      if (!isUsableDeviceKey(request.result)) {
        reject(
          new DeviceCredentialUnavailableError(
            'The secure browser credential is corrupt or has an unsupported format.',
          ),
        );
        return;
      }
      resolve(request.result);
    };
    request.onerror = () => {
      reject(new DeviceCredentialUnavailableError('The secure browser credential could not be read.'));
    };
  });
}

/**
 * Add rather than put: concurrent wallet tabs must never overwrite one
 * another's device key. The losing tab reloads the winning key after the
 * unique-key constraint fires.
 */
function addStoredKey(database: IDBDatabase, key: CryptoKey): Promise<'added' | 'exists'> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    let outcome: 'added' | 'exists' | null = null;
    const request = transaction.objectStore(STORE_NAME).add(key, DEVICE_KEY_ID);

    request.onsuccess = () => {
      outcome = 'added';
    };
    request.onerror = (event) => {
      if (request.error?.name === 'ConstraintError') {
        event.preventDefault();
        event.stopPropagation();
        outcome = 'exists';
      }
    };
    transaction.oncomplete = () => {
      if (outcome) {
        resolve(outcome);
      } else {
        reject(
          new DeviceCredentialUnavailableError(
            'The secure browser credential was not durably stored.',
          ),
        );
      }
    };
    transaction.onerror = () => {
      reject(
        new DeviceCredentialUnavailableError(
          'The secure browser credential could not be durably stored.',
        ),
      );
    };
    transaction.onabort = () => {
      reject(
        new DeviceCredentialUnavailableError(
          'The secure browser credential write was interrupted.',
        ),
      );
    };
  });
}

async function getBrowserDeviceKey(createIfMissing: boolean): Promise<CryptoKey> {
  const database = await openDatabase();
  const existing = await readStoredKey(database);
  if (existing) return existing;
  if (!createIfMissing) {
    throw new DeviceCredentialUnavailableError();
  }

  const candidate = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
  const outcome = await addStoredKey(database, candidate);
  if (outcome === 'added') return candidate;

  const winner = await readStoredKey(database);
  if (!winner) {
    throw new DeviceCredentialUnavailableError(
      'Another wallet tab created a device credential, but it could not be loaded.',
    );
  }
  return winner;
}

async function getNativeDeviceKey(createIfMissing: boolean): Promise<CryptoKey> {
  // The candidate is generated by WebCrypto, then the native app either
  // returns its existing credential or confirms this candidate was written to
  // Keychain/Keystore. No v5 ciphertext is created before that confirmation.
  const candidateBytes = createIfMissing
    ? crypto.getRandomValues(new Uint8Array(DEVICE_KEY_BYTES))
    : null;
  const candidate = candidateBytes ? bytesToHex(candidateBytes) : undefined;

  let credential: string | null;
  try {
    credential = await requestNativeDeviceCredential({ createIfMissing, candidate });
  } catch (error) {
    if (error instanceof DeviceCredentialUnavailableError) throw error;
    const message = error instanceof Error ? error.message : 'Native secure storage failed.';
    throw new DeviceCredentialUnavailableError(message);
  } finally {
    candidateBytes?.fill(0);
  }

  if (!credential) {
    throw new DeviceCredentialUnavailableError();
  }

  const rawKey = hexToBytes(credential);
  try {
    return await crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, [
      'encrypt',
      'decrypt',
    ]);
  } finally {
    rawKey.fill(0);
  }
}

/**
 * Returns the independent AES device key. Encryption may create it; decryption
 * never does, because replacing a lost key would make an existing wallet
 * permanently undecryptable while concealing the real cause.
 */
export function getDeviceEncryptionKey(createIfMissing: boolean): Promise<CryptoKey> {
  if (!cachedDeviceKey) {
    cachedDeviceKey = (isInNativeApp()
      ? getNativeDeviceKey(createIfMissing)
      : getBrowserDeviceKey(createIfMissing)
    ).catch((error) => {
      cachedDeviceKey = null;
      throw error;
    });
  }
  return cachedDeviceKey;
}

/** Clear the browser credential after an explicit web-wallet wipe. */
export async function clearDeviceCredential(): Promise<void> {
  cachedDeviceKey = null;
  if (isInNativeApp() || typeof indexedDB === 'undefined') return;

  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).delete(DEVICE_KEY_ID);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(new DeviceCredentialUnavailableError('The browser device credential was not cleared.'));
    transaction.onabort = () =>
      reject(new DeviceCredentialUnavailableError('The browser device credential clear was interrupted.'));
  });
}
