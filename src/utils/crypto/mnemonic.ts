import { MLDSA87, ExtendedSeed } from "@theqrl/wallet.js";
import { Buffer } from "buffer";
import type { Web3QRLInterface } from "@theqrl/web3";
import { deriveHexSeedAsync } from "./cryptoWorkerClient";

export const getMnemonicFromHexSeed = (hexSeed?: string) => {
  if (!hexSeed) return "";
  const trimmedHexSeed = hexSeed.trim();
  if (!trimmedHexSeed) return "";
  const seedBytes = Buffer.from(trimmedHexSeed.substring(2), "hex");
  const extendedSeed = new ExtendedSeed(seedBytes);
  const wallet = MLDSA87.newWalletFromExtendedSeed(extendedSeed);
  return wallet.getMnemonic();
};

export const getHexSeedFromMnemonic = (mnemonic?: string) => {
  if (!mnemonic) return "";
  const trimmedMnemonic = mnemonic.trim();
  if (!trimmedMnemonic) return "";
  const wallet = MLDSA87.newWalletFromMnemonic(trimmedMnemonic);
  return wallet.getHexExtendedSeed();
};

export const getAddressFromMnemonic = (mnemonic: string | undefined, qrlInstance: Web3QRLInterface) => {
  if (!mnemonic) return "";
  const trimmedMnemonic = mnemonic.trim();
  if (!trimmedMnemonic) return "";
  const wallet = MLDSA87.newWalletFromMnemonic(trimmedMnemonic);
  const hexSeed = wallet.getHexExtendedSeed();
  const account = qrlInstance.accounts.seedToAccount(hexSeed);
  return account.address;
};

/**
 * Async sibling of getAddressFromMnemonic that runs the heavy MLDSA87
 * expansion in the crypto worker. The subsequent seedToAccount call
 * (deterministic mapping of hexSeed → address) is comparatively cheap
 * and stays on the main thread.
 */
export const getAddressFromMnemonicAsync = async (
  mnemonic: string | undefined,
  qrlInstance: Web3QRLInterface,
): Promise<string> => {
  if (!mnemonic) return "";
  const hexSeed = await deriveHexSeedAsync(mnemonic);
  if (!hexSeed) return "";
  return qrlInstance.accounts.seedToAccount(hexSeed).address;
};
