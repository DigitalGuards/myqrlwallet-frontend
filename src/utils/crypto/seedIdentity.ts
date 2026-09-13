import {
  isValidChecksumAddress,
  newWalletFromExtendedSeed,
  toChecksumAddress,
} from '@theqrl/wallet.js';

/** Derive the canonical QIP-55 identity and zeroize expanded wallet key material. */
export function deriveCanonicalAddressFromHexSeed(hexSeed: string): string {
  const wallet = newWalletFromExtendedSeed(hexSeed);
  try {
    const fullAddress = wallet.getAddressStr();
    const address = toChecksumAddress(fullAddress);
    if (!isValidChecksumAddress(address)) {
      throw new Error('Invalid decrypted seed identity');
    }
    return address;
  } catch {
    throw new Error('Invalid decrypted seed identity');
  } finally {
    wallet.zeroize();
  }
}
