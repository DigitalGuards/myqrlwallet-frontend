import {
  isValidAddress as isValidWalletAddress,
  toChecksumAddress,
} from '@theqrl/wallet.js';

/** Wallet.js 6 QIP-55 primitives kept inside the crypto boundary. */
export const isValidWalletQrlAddress = (address: string): boolean =>
  isValidWalletAddress(address);

export const checksumWalletQrlAddress = (address: string): string =>
  toChecksumAddress(address);
