/**
 * Coverage for the WebCrypto (AES-256-GCM + PBKDF2-SHA256) seed/wallet
 * encryption in walletEncryption.ts, after the crypto-js -> WebCrypto migration.
 *
 * What it pins:
 * - pin_v5 seed blobs require both the PIN and an independent device key.
 * - Wrong PIN is rejected (GCM tag mismatch) with PinDecryptionError.
 * - Tampering the ciphertext is DETECTED (the property the old unauthenticated
 *   AES-CBC lacked): a one-nibble flip makes decrypt throw.
 * - An old (pre-WebCrypto) pin_v3 blob is rejected with OutdatedWalletFormatError
 *   so the UI can prompt a re-import rather than a misleading "wrong PIN".
 * - The password-based wallet file round-trips and rejects the wrong password.
 *
 * Runs natively on WebCrypto (jest's node env exposes globalThis.crypto.subtle),
 * so it is fast and needs no crypto-js.
 *
 * nativeApp is mocked: walletEncryption imports it for download/share helpers
 * (unused by the functions under test) and it touches window/navigator, which
 * are absent in jest's node environment.
 */

jest.mock('@/utils/nativeApp', () => ({
  isInNativeApp: () => false,
  shareContent: jest.fn(),
}));

jest.mock('../deviceCredential', () => {
  class DeviceCredentialUnavailableError extends Error {
    constructor(message: string = 'Device credential unavailable') {
      super(message);
      this.name = 'DeviceCredentialUnavailableError';
    }
  }
  return {
    DeviceCredentialUnavailableError,
    getDeviceEncryptionKey: jest.fn(),
  };
});

import {
  WalletEncryptionUtil,
  PinDecryptionError,
  OutdatedWalletFormatError,
  DeviceCredentialUnavailableError,
  type EncryptedWallet,
  type WalletData,
} from '../walletEncryption';
import { getDeviceEncryptionKey } from '../deviceCredential';

const mockGetDeviceEncryptionKey = getDeviceEncryptionKey as jest.MockedFunction<
  typeof getDeviceEncryptionKey
>;

const MNEMONIC =
  'absorb absurd abuse access accident account accuse achieve acid acoustic acquire across';
const HEX_SEED = '0x' + 'ab'.repeat(48);
const PIN = '123456';
const PASSWORD = 'Str0ng!Passw0rd';

let deviceKey: CryptoKey;
let otherDeviceKey: CryptoKey;

async function makePinV4(pin: string = PIN): Promise<string> {
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const baseKey = await crypto.subtle.importKey('raw', encoder.encode(pin), 'PBKDF2', false, [
    'deriveKey',
  ]);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 600000 },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      encoder.encode(JSON.stringify({ mnemonic: MNEMONIC, hexSeed: HEX_SEED })),
    ),
  );
  const toHex = (bytes: Uint8Array) =>
    Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return JSON.stringify({
    version: 'pin_v4',
    salt: toHex(salt),
    iv: toHex(iv),
    encryptedData: toHex(ciphertext),
    timestamp: Date.now(),
  });
}

beforeAll(async () => {
  deviceKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
  otherDeviceKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
});

beforeEach(() => {
  mockGetDeviceEncryptionKey.mockReset();
  mockGetDeviceEncryptionKey.mockResolvedValue(deviceKey);
});

describe('WalletEncryptionUtil PIN seed encryption (WebCrypto AES-GCM)', () => {
  it('writes pin_v5 and round-trips only after obtaining the device key', async () => {
    const blob = await WalletEncryptionUtil.encryptSeedWithPin(MNEMONIC, HEX_SEED, PIN);
    const parsed = JSON.parse(blob);
    expect(parsed.version).toBe('pin_v5');
    expect(parsed.deviceKeyVersion).toBe('device_v1');
    expect(parsed.salt).toBeUndefined();

    const out = await WalletEncryptionUtil.decryptSeedWithPin(blob, PIN);
    expect(out).toEqual({ mnemonic: MNEMONIC, hexSeed: HEX_SEED });
    expect(mockGetDeviceEncryptionKey).toHaveBeenNthCalledWith(1, true);
    expect(mockGetDeviceEncryptionKey).toHaveBeenNthCalledWith(2, false);
  });

  it('produces a fresh random device nonce and ciphertext per encryption', async () => {
    const a = JSON.parse(await WalletEncryptionUtil.encryptSeedWithPin(MNEMONIC, HEX_SEED, PIN));
    const b = JSON.parse(await WalletEncryptionUtil.encryptSeedWithPin(MNEMONIC, HEX_SEED, PIN));
    expect(a.iv).not.toEqual(b.iv);
    expect(a.encryptedData).not.toEqual(b.encryptedData);
  });

  it('throws PinDecryptionError on the wrong PIN', async () => {
    const blob = await WalletEncryptionUtil.encryptSeedWithPin(MNEMONIC, HEX_SEED, PIN);
    await expect(WalletEncryptionUtil.decryptSeedWithPin(blob, '654321')).rejects.toBeInstanceOf(
      PinDecryptionError,
    );
  });

  it('detects outer ciphertext tampering before treating the failure as a bad PIN', async () => {
    const parsed = JSON.parse(await WalletEncryptionUtil.encryptSeedWithPin(MNEMONIC, HEX_SEED, PIN));
    // Flip the first nibble of the ciphertext; GCM must reject on the tag check.
    parsed.encryptedData =
      (parsed.encryptedData[0] === '0' ? '1' : '0') + parsed.encryptedData.slice(1);
    await expect(
      WalletEncryptionUtil.decryptSeedWithPin(JSON.stringify(parsed), PIN),
    ).rejects.toBeInstanceOf(DeviceCredentialUnavailableError);
  });

  it('cannot open a v5 blob with a different device key', async () => {
    const blob = await WalletEncryptionUtil.encryptSeedWithPin(MNEMONIC, HEX_SEED, PIN);
    mockGetDeviceEncryptionKey.mockResolvedValue(otherDeviceKey);
    await expect(WalletEncryptionUtil.decryptSeedWithPin(blob, PIN)).rejects.toBeInstanceOf(
      DeviceCredentialUnavailableError,
    );
  });

  it('fails closed when durable device-key creation is unavailable', async () => {
    mockGetDeviceEncryptionKey.mockRejectedValue(new DeviceCredentialUnavailableError());
    await expect(
      WalletEncryptionUtil.encryptSeedWithPin(MNEMONIC, HEX_SEED, PIN),
    ).rejects.toBeInstanceOf(DeviceCredentialUnavailableError);
  });

  it('unlocks authenticated pin_v4 for explicit lazy migration', async () => {
    const legacy = await makePinV4();
    const decrypted = await WalletEncryptionUtil.decryptSeedWithPinVersioned(legacy, PIN);
    expect(decrypted).toEqual({
      seed: { mnemonic: MNEMONIC, hexSeed: HEX_SEED },
      version: 'pin_v4',
    });
    expect(mockGetDeviceEncryptionKey).not.toHaveBeenCalled();
  });

  it('re-encrypts pin_v4 as pin_v5 without changing the original on failure', async () => {
    const legacy = await makePinV4();
    mockGetDeviceEncryptionKey.mockRejectedValueOnce(new DeviceCredentialUnavailableError());
    await expect(WalletEncryptionUtil.reEncryptSeed(legacy, PIN, '654321')).rejects.toBeInstanceOf(
      DeviceCredentialUnavailableError,
    );
    expect(JSON.parse(legacy).version).toBe('pin_v4');

    mockGetDeviceEncryptionKey.mockResolvedValue(deviceKey);
    const migrated = await WalletEncryptionUtil.reEncryptSeed(legacy, PIN, '654321');
    expect(JSON.parse(migrated).version).toBe('pin_v5');
    await expect(WalletEncryptionUtil.decryptSeedWithPin(migrated, '654321')).resolves.toEqual({
      mnemonic: MNEMONIC,
      hexSeed: HEX_SEED,
    });
  });

  it('rejects an outdated pre-WebCrypto (pin_v3) blob with a distinct error', async () => {
    const legacy = JSON.stringify({
      version: 'pin_v3',
      salt: 'aa'.repeat(16),
      iv: 'bb'.repeat(16),
      encryptedData: 'deadbeefdeadbeef',
      timestamp: 0,
    });
    await expect(WalletEncryptionUtil.decryptSeedWithPin(legacy, PIN)).rejects.toBeInstanceOf(
      OutdatedWalletFormatError,
    );
  });

  it('rejects a malformed (non-JSON) blob with PinDecryptionError', async () => {
    await expect(
      WalletEncryptionUtil.decryptSeedWithPin('not-json', PIN),
    ).rejects.toBeInstanceOf(PinDecryptionError);
  });

  it('treats valid-JSON-but-not-an-object as corrupt (PinDecryptionError), not outdated', async () => {
    // "123" / "null" parse fine but have no .version; they are corrupt data, not
    // an old wallet format, so they must not surface as OutdatedWalletFormatError.
    await expect(
      WalletEncryptionUtil.decryptSeedWithPin('123', PIN),
    ).rejects.toBeInstanceOf(PinDecryptionError);
    await expect(
      WalletEncryptionUtil.decryptSeedWithPin('null', PIN),
    ).rejects.toBeInstanceOf(PinDecryptionError);
  });

  it('rejects a pin_v5 blob missing envelope fields as a format error', async () => {
    // Correctly versioned but corrupt (no iv/encryptedData): must be a
    // clear format error, not a misleading "Invalid PIN".
    const malformed = JSON.stringify({ version: 'pin_v5', timestamp: 0 });
    await expect(
      WalletEncryptionUtil.decryptSeedWithPin(malformed, PIN),
    ).rejects.toThrow(/Invalid encrypted seed format/);
  });

  it('rejects an oversized seed envelope before parsing or device-key access', async () => {
    await expect(
      WalletEncryptionUtil.decryptSeedWithPin('x'.repeat(64 * 1024 + 1), PIN),
    ).rejects.toBeInstanceOf(PinDecryptionError);
    expect(mockGetDeviceEncryptionKey).not.toHaveBeenCalled();
  });
});

describe('WalletEncryptionUtil password wallet file (WebCrypto AES-GCM)', () => {
  const walletData: WalletData = {
    address: 'Q6153d37Fa4DA7193E6219DCBd2bBe62Fa12905b1',
    mnemonic: MNEMONIC,
    hexSeed: HEX_SEED,
  };

  it('writes version v2 and round-trips with the correct password', async () => {
    const encrypted: EncryptedWallet = await WalletEncryptionUtil.encryptWallet(walletData, PASSWORD);
    expect(encrypted.version).toBe('v2');
    expect(encrypted.address).toBe(walletData.address);

    const decrypted = await WalletEncryptionUtil.decryptWallet(encrypted, PASSWORD);
    expect(decrypted).toEqual(walletData);
  });

  it('rejects the wrong password', async () => {
    const encrypted = await WalletEncryptionUtil.encryptWallet(walletData, PASSWORD);
    await expect(WalletEncryptionUtil.decryptWallet(encrypted, 'Wr0ng!Passw0rd')).rejects.toThrow(
      /Failed to decrypt wallet/,
    );
  });

  it.each([
    ['wrong salt length', (wallet: EncryptedWallet) => { wallet.salt = 'aa'; }],
    ['wrong IV length', (wallet: EncryptedWallet) => { wallet.iv = 'bb'; }],
    ['non-hex ciphertext', (wallet: EncryptedWallet) => { wallet.encryptedData = 'zz'.repeat(16); }],
    ['oversized ciphertext', (wallet: EncryptedWallet) => {
      wallet.encryptedData = 'aa'.repeat(16 * 1024 + 1);
    }],
    ['wrong version', (wallet: EncryptedWallet) => { wallet.version = 'v3'; }],
  ])('rejects %s in the envelope before PBKDF2', async (_label, mutate) => {
    const encrypted = await WalletEncryptionUtil.encryptWallet(walletData, PASSWORD);
    mutate(encrypted);
    const importKey = jest.spyOn(crypto.subtle, 'importKey');

    await expect(WalletEncryptionUtil.decryptWallet(encrypted, PASSWORD)).rejects.toThrow(
      /Failed to decrypt wallet/,
    );
    expect(importKey).not.toHaveBeenCalled();
    importKey.mockRestore();
  });

  it('rejects an oversized password before PBKDF2', async () => {
    const encrypted = await WalletEncryptionUtil.encryptWallet(walletData, PASSWORD);
    const importKey = jest.spyOn(crypto.subtle, 'importKey');
    await expect(
      WalletEncryptionUtil.decryptWallet(encrypted, 'x'.repeat(1025)),
    ).rejects.toThrow(/Failed to decrypt wallet/);
    expect(importKey).not.toHaveBeenCalled();
    importKey.mockRestore();
  });
});
