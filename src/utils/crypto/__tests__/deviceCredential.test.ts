import { IDBFactory } from 'fake-indexeddb';

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
