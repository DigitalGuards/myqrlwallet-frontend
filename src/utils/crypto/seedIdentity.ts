import { newWalletFromExtendedSeed } from '@theqrl/wallet.js';
import { utils as web3Utils } from '@theqrl/web3';

const EXACT_ACCOUNT_PATTERN = /^Q[0-9a-fA-F]{40}$/;

/** Derive the deployed Q+40 identity and zeroize expanded wallet key material. */
export function deriveCanonicalAddressFromHexSeed(hexSeed: string): string {
  const wallet = newWalletFromExtendedSeed(hexSeed);
  try {
    const fullAddress = wallet.getAddressStr();
    if (typeof fullAddress !== 'string' || fullAddress.length < 41) {
      throw new Error('Invalid decrypted seed identity');
    }
    const address = web3Utils.toChecksumAddress(`Q${fullAddress.slice(1, 41)}`);
    if (!EXACT_ACCOUNT_PATTERN.test(address)) {
      throw new Error('Invalid decrypted seed identity');
    }
    return address;
  } finally {
    wallet.zeroize();
  }
}
