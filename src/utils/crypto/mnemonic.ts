import { MLDSA87, ExtendedSeed, toChecksumAddress } from "@theqrl/wallet.js";
import { Buffer } from "buffer";
import type { Web3QRLInterface } from "@theqrl/web3";
import { deriveHexSeedAsync } from "./cryptoWorkerClient";
import { deriveCanonicalAddressFromHexSeed } from "./seedIdentity";

export const getMnemonicFromHexSeed = (hexSeed?: string) => {
  if (!hexSeed) return "";
  const trimmedHexSeed = hexSeed.trim();
  if (!trimmedHexSeed) return "";
  const seedBytes = Buffer.from(trimmedHexSeed.substring(2), "hex");
  const extendedSeed = new ExtendedSeed(seedBytes);
  const wallet = MLDSA87.newWalletFromExtendedSeed(extendedSeed);
  try {
    return wallet.getMnemonic();
  } finally {
    wallet.zeroize();
  }
};

export const getHexSeedFromMnemonic = (mnemonic?: string) => {
  if (!mnemonic) return "";
  const trimmedMnemonic = mnemonic.trim();
  if (!trimmedMnemonic) return "";
  const wallet = MLDSA87.newWalletFromMnemonic(trimmedMnemonic);
  try {
    return wallet.getHexExtendedSeed();
  } finally {
    wallet.zeroize();
  }
};

export const getAddressFromMnemonic = (
  mnemonic: string | undefined,
  _qrlInstance: Web3QRLInterface,
) => {
  if (!mnemonic) return "";
  const trimmedMnemonic = mnemonic.trim();
  if (!trimmedMnemonic) return "";
  const wallet = MLDSA87.newWalletFromMnemonic(trimmedMnemonic);
  try {
    return toChecksumAddress(wallet.getAddressStr());
  } finally {
    wallet.zeroize();
  }
};

/**
 * Async sibling of getAddressFromMnemonic that runs the heavy MLDSA87
 * expansion in the crypto worker. Address derivation uses wallet.js 6 so the
 * full QIP-55 identity survives independently of the installed web3 version.
 */
export const getAddressFromMnemonicAsync = async (
  mnemonic: string | undefined,
  _qrlInstance: Web3QRLInterface,
): Promise<string> => {
  if (!mnemonic) return "";
  const hexSeed = await deriveHexSeedAsync(mnemonic);
  if (!hexSeed) return "";
  return deriveCanonicalAddressFromHexSeed(hexSeed);
};
