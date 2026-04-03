import { MLDSA87, ExtendedSeed } from "@theqrl/wallet.js";
import { Buffer } from "buffer";
import Web3 from "@theqrl/web3";

const web3 = new Web3(new Web3.providers.HttpProvider((import.meta.env?.VITE_NODE_ENV === "production" ? `${import.meta.env?.VITE_RPC_URL_PRODUCTION}/mainnet` : `${import.meta.env?.VITE_RPC_URL_DEVELOPMENT}/testnet`) || "http://testnet.qrl.network:8545"));

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

export const getAddressFromMnemonic = (mnemonic?: string) => {
  if (!mnemonic) return "";
  const trimmedMnemonic = mnemonic.trim();
  if (!trimmedMnemonic) return "";
  const wallet = MLDSA87.newWalletFromMnemonic(trimmedMnemonic);
  const hexSeed = wallet.getHexExtendedSeed();
  const account = web3.qrl.accounts.seedToAccount(hexSeed);
  return account.address;
};
