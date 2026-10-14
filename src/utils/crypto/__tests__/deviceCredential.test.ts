import { IDBFactory } from 'fake-indexeddb';
import { profileStorageKey } from '@/config/runtimeProfile';

async function credentialDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(profileStorageKey('myqrlwallet-device-credentials'), 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('credentials');
    };
    request.onsuccess = () => { resolve(request.result); };
    request.onerror = () => { reject(request.error ?? new Error('Credential request failed')); };
  });
}

async function storeCredential(database: IDBDatabase, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('credentials', 'readwrite');
    transaction.objectStore('credentials').put(value, 'wallet-seed-device-key-v1');
    transaction.oncomplete = () => { resolve(); };
    transaction.onabort = () => { reject(transaction.error ?? new Error('Credential transaction failed')); };
  });
}

async function readCredential(database: IDBDatabase): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const request: IDBRequest<unknown> = database.transaction('credentials')
      .objectStore('credentials').get('wallet-seed-device-key-v1');
    request.onsuccess = () => { resolve(request.result); };
    request.onerror = () => { reject(request.error ?? new Error('Credential request failed')); };
  });
}

jest.mock('@/utils/nativeApp', () => ({
  isInNativeApp: () => false,
  requestNativeDeviceCredential: jest.fn(),
}));

describe('browser device credential persistence', () => {
  beforeEach(() => {
    jest.resetModules();
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      value: new IDBFactory(),
    });
  });

  it('persists a non-extractable AES key before returning it', async () => {
    const { getDeviceEncryptionKey } = await import('../deviceCredential');
    const key = await getDeviceEncryptionKey(true);
    expect(key.type).toBe('secret');
    expect(key.extractable).toBe(false);
    expect(key.algorithm.name).toBe('AES-GCM');
    await expect(crypto.subtle.exportKey('raw', key)).rejects.toThrow();
  });

  it('loads the same key after a module/page lifecycle instead of replacing it', async () => {
    const firstModule = await import('../deviceCredential');
    const firstKey = await firstModule.getDeviceEncryptionKey(true);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = new TextEncoder().encode('device-bound');
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, firstKey, plaintext);

    jest.resetModules();
    const secondModule = await import('../deviceCredential');
    const restoredKey = await secondModule.getDeviceEncryptionKey(false);
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      restoredKey,
      ciphertext,
    );
    expect(new TextDecoder().decode(decrypted)).toBe('device-bound');
  });

  it('never creates a replacement key during decryption', async () => {
    const { DeviceCredentialUnavailableError, getDeviceEncryptionKey } = await import(
      '../deviceCredential'
    );
    await expect(getDeviceEncryptionKey(false)).rejects.toBeInstanceOf(
      DeviceCredentialUnavailableError,
    );
  });

  it.each([
    null,
    {},
    { type: 'secret', extractable: false, algorithm: { name: 'AES-GCM' } },
    { type: 'secret', extractable: false, algorithm: { name: 'AES-GCM' }, usages: ['encrypt', 'decrypt'] },
    { type: 'secret', extractable: false, algorithm: { name: 'AES-GCM' }, usages: 'encrypt,decrypt' },
  ])('rejects malformed stored credentials without overwriting them: %j', async value => {
    const database = await credentialDatabase();
    await storeCredential(database, value);
    const { DeviceCredentialUnavailableError, getDeviceEncryptionKey } = await import('../deviceCredential');
    const generate = jest.spyOn(crypto.subtle, 'generateKey');
    try {
      await expect(getDeviceEncryptionKey(false)).rejects.toBeInstanceOf(DeviceCredentialUnavailableError);
      await expect(getDeviceEncryptionKey(true)).rejects.toThrow('corrupt or has an unsupported format');
      expect(generate).not.toHaveBeenCalled();
      await expect(readCredential(database)).resolves.toEqual(value);
    } finally {
      generate.mockRestore();
      database.close();
    }
  });

  it('reloads a repaired credential after a rejected read', async () => {
    const database = await credentialDatabase();
    await storeCredential(database, {});
    const { getDeviceEncryptionKey } = await import('../deviceCredential');
    await expect(getDeviceEncryptionKey(false)).rejects.toThrow('corrupt');
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    await storeCredential(database, key);
    const restored = await getDeviceEncryptionKey(false);
    const iv = new Uint8Array(12);
    const plaintext = new TextEncoder().encode('repaired');
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
    const result = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, restored, ciphertext);
    expect(new Uint8Array(result)).toEqual(plaintext);
    database.close();
  });

  it('removes the key during an explicit browser wallet wipe', async () => {
    const firstModule = await import('../deviceCredential');
    await firstModule.getDeviceEncryptionKey(true);
    await firstModule.clearDeviceCredential();

    jest.resetModules();
    const secondModule = await import('../deviceCredential');
    await expect(secondModule.getDeviceEncryptionKey(false)).rejects.toBeInstanceOf(
      secondModule.DeviceCredentialUnavailableError,
    );
  });
});
