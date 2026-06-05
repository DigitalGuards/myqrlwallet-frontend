/**
 * Coverage for the WebCrypto (AES-256-GCM + PBKDF2-SHA256) seed/wallet
 * encryption in walletEncryption.ts, after the crypto-js -> WebCrypto migration.
 *
 * What it pins:
 * - pin_v4 seed blob round-trips with the correct PIN.
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

import {
  WalletEncryptionUtil,
  PinDecryptionError,
  OutdatedWalletFormatError,
  type EncryptedWallet,
  type WalletData,
} from '../walletEncryption';

const MNEMONIC =
  'absorb absurd abuse access accident account accuse achieve acid acoustic acquire across';
const HEX_SEED = '0x' + 'ab'.repeat(48);
const PIN = '123456';
const PASSWORD = 'Str0ng!Passw0rd';

describe('WalletEncryptionUtil PIN seed encryption (WebCrypto AES-GCM)', () => {
  it('writes pin_v4 and round-trips with the correct PIN', async () => {
    const blob = await WalletEncryptionUtil.encryptSeedWithPin(MNEMONIC, HEX_SEED, PIN);
    expect(JSON.parse(blob).version).toBe('pin_v4');

    const out = await WalletEncryptionUtil.decryptSeedWithPin(blob, PIN);
    expect(out).toEqual({ mnemonic: MNEMONIC, hexSeed: HEX_SEED });
  });

  it('produces a fresh random salt + iv per encryption', async () => {
    const a = JSON.parse(await WalletEncryptionUtil.encryptSeedWithPin(MNEMONIC, HEX_SEED, PIN));
    const b = JSON.parse(await WalletEncryptionUtil.encryptSeedWithPin(MNEMONIC, HEX_SEED, PIN));
    expect(a.salt).not.toEqual(b.salt);
    expect(a.iv).not.toEqual(b.iv);
    expect(a.encryptedData).not.toEqual(b.encryptedData);
  });

  it('throws PinDecryptionError on the wrong PIN', async () => {
    const blob = await WalletEncryptionUtil.encryptSeedWithPin(MNEMONIC, HEX_SEED, PIN);
    await expect(WalletEncryptionUtil.decryptSeedWithPin(blob, '654321')).rejects.toBeInstanceOf(
      PinDecryptionError,
    );
  });

  it('detects ciphertext tampering (AES-GCM authentication)', async () => {
    const parsed = JSON.parse(await WalletEncryptionUtil.encryptSeedWithPin(MNEMONIC, HEX_SEED, PIN));
    // Flip the first nibble of the ciphertext; GCM must reject on the tag check.
    parsed.encryptedData =
      (parsed.encryptedData[0] === '0' ? '1' : '0') + parsed.encryptedData.slice(1);
    await expect(
      WalletEncryptionUtil.decryptSeedWithPin(JSON.stringify(parsed), PIN),
    ).rejects.toBeInstanceOf(PinDecryptionError);
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
});
