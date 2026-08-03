const mockGetAddressStr = jest.fn();
const mockZeroize = jest.fn();

jest.mock('@theqrl/wallet.js', () => ({
  newWalletFromExtendedSeed: jest.fn(() => ({
    getAddressStr: mockGetAddressStr,
    zeroize: mockZeroize,
  })),
}));

jest.mock('@theqrl/web3', () => ({
  utils: { toChecksumAddress: jest.fn((address: string) => address) },
}));

import { deriveCanonicalAddressFromHexSeed } from '../seedIdentity';

const ADDRESS = 'Q6153d37Fa4DA7193E6219DCBd2bBe62Fa12905b1';

describe('seed identity derivation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAddressStr.mockReturnValue(`${ADDRESS}${'a'.repeat(88)}`);
  });

  it('returns the deployed Q+40 identity and zeroizes the expanded wallet', () => {
    expect(deriveCanonicalAddressFromHexSeed('ab'.repeat(51))).toBe(ADDRESS);
    expect(mockZeroize).toHaveBeenCalledTimes(1);
  });

  it('zeroizes even when the derived identity is malformed', () => {
    mockGetAddressStr.mockReturnValue('Qshort');
    expect(() => deriveCanonicalAddressFromHexSeed('ab'.repeat(51))).toThrow(
      /Invalid decrypted seed identity/,
    );
    expect(mockZeroize).toHaveBeenCalledTimes(1);
  });
});
