const mockGetAddressStr = jest.fn();
const mockZeroize = jest.fn();

jest.mock('@theqrl/wallet.js', () => ({
  newWalletFromExtendedSeed: jest.fn(() => ({
    getAddressStr: mockGetAddressStr,
    zeroize: mockZeroize,
  })),
  toChecksumAddress: jest.fn((address: string) => address),
  isValidChecksumAddress: jest.fn((address: string) => /^Q[0-9a-fA-F]{128}$/.test(address)),
}));

import { deriveCanonicalAddressFromHexSeed } from '../seedIdentity';

const ADDRESS = `Q${'12'.repeat(64)}`;

describe('seed identity derivation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAddressStr.mockReturnValue(ADDRESS);
  });

  it('returns the complete QIP-55 identity and zeroizes the expanded wallet', () => {
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
