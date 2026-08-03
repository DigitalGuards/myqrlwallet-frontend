jest.mock('@/utils/nativeApp', () => ({
  isInNativeApp: jest.fn(() => false),
  notifySeedStored: jest.fn(),
}));

jest.mock('@/utils/storage/storage', () => ({
  __esModule: true,
  default: {
    migrateEncryptedSeed: jest.fn(),
    getAllEncryptedSeeds: jest.fn(),
  },
}));

jest.mock('../walletEncryption', () => ({
  WalletEncryptionUtil: {
    decryptSeedWithPinVersioned: jest.fn(),
    encryptSeedWithPin: jest.fn(),
  },
}));

const mockGetAddressStr = jest.fn();
const mockZeroize = jest.fn();

jest.mock('@theqrl/wallet.js', () => ({
  newWalletFromExtendedSeed: jest.fn(() => ({
    getAddressStr: mockGetAddressStr,
    zeroize: mockZeroize,
  })),
}));

jest.mock('@theqrl/web3', () => ({
  utils: {
    toChecksumAddress: jest.fn((address: string) => address),
  },
}));

import { decryptStoredSeedWithPin } from '../storedSeed';
import { isInNativeApp, notifySeedStored } from '@/utils/nativeApp';
import StorageUtil from '@/utils/storage/storage';
import { WalletEncryptionUtil } from '../walletEncryption';
import { walletMutations } from '@/utils/nativeWalletMutation';

const mockNotifySeedStored = notifySeedStored as jest.MockedFunction<typeof notifySeedStored>;
const mockIsInNativeApp = isInNativeApp as jest.MockedFunction<typeof isInNativeApp>;
const mockMigrateEncryptedSeed = StorageUtil.migrateEncryptedSeed as jest.MockedFunction<
  typeof StorageUtil.migrateEncryptedSeed
>;
const mockGetAllEncryptedSeeds = StorageUtil.getAllEncryptedSeeds as jest.MockedFunction<
  typeof StorageUtil.getAllEncryptedSeeds
>;
const mockDecryptVersioned =
  WalletEncryptionUtil.decryptSeedWithPinVersioned as jest.MockedFunction<
    typeof WalletEncryptionUtil.decryptSeedWithPinVersioned
  >;
const mockEncryptSeed = WalletEncryptionUtil.encryptSeedWithPin as jest.MockedFunction<
  typeof WalletEncryptionUtil.encryptSeedWithPin
>;

const SEED = { mnemonic: 'word '.repeat(23) + 'word', hexSeed: 'ab'.repeat(48) };
const ADDRESS = 'Q6153d37Fa4DA7193E6219DCBd2bBe62Fa12905b1';
const OTHER_ADDRESS = 'QcfEC0CbEe560cbD6ED89580204AF71448F1fb8c5';

describe('decryptStoredSeedWithPin migration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAddressStr.mockReturnValue(`${ADDRESS}${'a'.repeat(88)}`);
    mockIsInNativeApp.mockReturnValue(false);
    mockDecryptVersioned.mockResolvedValue({ seed: SEED, version: 'pin_v4' });
    mockEncryptSeed.mockResolvedValue('{"version":"pin_v5"}');
    mockMigrateEncryptedSeed.mockResolvedValue({
      address: ADDRESS,
      encryptedSeed: '{"version":"pin_v5"}',
      lastAccessed: 1,
      revision: 1,
    });
    mockNotifySeedStored.mockResolvedValue({
      revision: 1,
      ciphertextHash: 'ab'.repeat(32),
    });
    mockGetAllEncryptedSeeds.mockResolvedValue([]);
  });

  it('replaces pin_v4 with pin_v5 using compare-and-swap', async () => {
    await expect(
      decryptStoredSeedWithPin('qrl', ADDRESS, 'legacy-blob', '123456'),
    ).resolves.toEqual(SEED);

    expect(mockMigrateEncryptedSeed).toHaveBeenCalledWith(
      'qrl',
      ADDRESS,
      'legacy-blob',
      '{"version":"pin_v5"}',
      expect.anything(),
    );
    expect(mockZeroize).toHaveBeenCalledTimes(1);
  });

  it('syncs a completed migration back to native restore storage', async () => {
    mockIsInNativeApp.mockReturnValue(true);
    await decryptStoredSeedWithPin('qrl', ADDRESS, 'legacy-blob', '123456');
    expect(mockNotifySeedStored).toHaveBeenCalledWith({
      address: ADDRESS,
      blockchain: 'qrl',
      encryptedSeed: '{"version":"pin_v5"}',
      revision: 1,
    });
  });

  it('leaves the legacy blob usable when device-key creation or storage fails', async () => {
    const warning = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockEncryptSeed.mockRejectedValue(new Error('secure store unavailable'));

    await expect(
      decryptStoredSeedWithPin('qrl', ADDRESS, 'legacy-blob', '123456'),
    ).resolves.toEqual(SEED);
    expect(mockMigrateEncryptedSeed).not.toHaveBeenCalled();
    expect(mockNotifySeedStored).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining('Deferred pin_v4 migration'),
      'secure store unavailable',
    );
    warning.mockRestore();
  });

  it('does not overwrite or back up when a concurrent write wins the CAS', async () => {
    mockIsInNativeApp.mockReturnValue(true);
    mockMigrateEncryptedSeed.mockResolvedValue(null);
    await decryptStoredSeedWithPin('qrl', ADDRESS, 'legacy-blob', '123456');
    expect(mockNotifySeedStored).not.toHaveBeenCalled();
  });

  it('does not rewrite an already-v5 seed', async () => {
    mockDecryptVersioned.mockResolvedValue({ seed: SEED, version: 'pin_v5' });
    await expect(
      decryptStoredSeedWithPin('qrl', ADDRESS, 'v5-blob', '123456'),
    ).resolves.toEqual(SEED);
    expect(mockEncryptSeed).not.toHaveBeenCalled();
  });

  it('retries an unacknowledged native v5 backup on the next unlock', async () => {
    const warning = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockIsInNativeApp.mockReturnValue(true);
    mockNotifySeedStored
      .mockRejectedValueOnce(new Error('native disk full'))
      .mockResolvedValueOnce({ revision: 1, ciphertextHash: 'ab'.repeat(32) });

    await expect(
      decryptStoredSeedWithPin('qrl', ADDRESS, 'legacy-blob', '123456'),
    ).resolves.toEqual(SEED);

    mockDecryptVersioned.mockResolvedValue({ seed: SEED, version: 'pin_v5' });
    mockGetAllEncryptedSeeds.mockResolvedValue([
      {
        address: ADDRESS,
        encryptedSeed: '{"version":"pin_v5"}',
        lastAccessed: 2,
        revision: 1,
      },
    ]);
    await expect(
      decryptStoredSeedWithPin('qrl', ADDRESS, '{"version":"pin_v5"}', '123456'),
    ).resolves.toEqual(SEED);

    expect(mockNotifySeedStored).toHaveBeenCalledTimes(2);
    expect(mockNotifySeedStored).toHaveBeenLastCalledWith({
      address: ADDRESS,
      blockchain: 'qrl',
      encryptedSeed: '{"version":"pin_v5"}',
      revision: 1,
    });
    warning.mockRestore();
  });

  it('rejects a valid ciphertext copied into another account slot before migration or backup', async () => {
    mockIsInNativeApp.mockReturnValue(true);
    mockGetAddressStr.mockReturnValue(`${OTHER_ADDRESS}${'b'.repeat(88)}`);

    await expect(
      decryptStoredSeedWithPin('qrl', ADDRESS, 'swapped-valid-blob', '123456'),
    ).rejects.toThrow(/stored seed does not match this account/);

    expect(mockEncryptSeed).not.toHaveBeenCalled();
    expect(mockMigrateEncryptedSeed).not.toHaveBeenCalled();
    expect(mockNotifySeedStored).not.toHaveBeenCalled();
    expect(mockZeroize).toHaveBeenCalledTimes(1);
  });

  it('never returns a decrypt that completes after the wallet was cleared', async () => {
    let finishDecrypt: ((value: { seed: typeof SEED; version: 'pin_v5' }) => void) | undefined;
    mockDecryptVersioned.mockReturnValue(
      new Promise((resolve) => {
        finishDecrypt = resolve;
      }),
    );

    const unlock = decryptStoredSeedWithPin('qrl', ADDRESS, 'v5-blob', '123456');
    await Promise.resolve();
    await walletMutations.clear(() => undefined);
    finishDecrypt?.({ seed: SEED, version: 'pin_v5' });

    await expect(unlock).rejects.toThrow(/Wallet changed/);
    expect(mockEncryptSeed).not.toHaveBeenCalled();
    expect(mockMigrateEncryptedSeed).not.toHaveBeenCalled();
    expect(mockNotifySeedStored).not.toHaveBeenCalled();
    expect(mockGetAddressStr).not.toHaveBeenCalled();
  });
});
