/**
 * Mnemonic conversion utilities for QRL wallets.
 *
 * These functions convert between binary seeds and QRL mnemonic word phrases.
 * The encoding uses a 4096-word list where each word represents 12 bits (1.5 bytes).
 *
 * Note: This implementation is compatible with @theqrl/wallet.js v0.1.x mnemonic format
 * (48-byte seeds producing 32-word mnemonics).
 */

import { WordList } from "./wordlist";
import { Buffer } from "buffer";
import Web3 from "@theqrl/web3";

const web3 = new Web3(
  new Web3.providers.HttpProvider(
    (import.meta.env?.VITE_NODE_ENV === "production"
      ? `${import.meta.env?.VITE_RPC_URL_PRODUCTION}/mainnet`
      : `${import.meta.env?.VITE_RPC_URL_DEVELOPMENT}/testnet`) ||
      "http://testnet.zond.network:8545"
  )
);

// Build word lookup table for efficient mnemonic decoding
const WORD_LOOKUP: Record<string, number> = WordList.reduce(
  (acc, word, i) => {
    acc[word] = i;
    return acc;
  },
  {} as Record<string, number>
);

/**
 * Convert binary seed to mnemonic words.
 * Each 3 nibbles (12 bits) maps to one word from the 4096-word list.
 *
 * @param input - Binary seed (must be a multiple of 3 bytes, typically 48 bytes)
 * @returns Space-separated mnemonic words
 */
function binToMnemonic(input: Uint8Array): string {
  if (input.length % 3 !== 0) {
    throw new Error("byte count needs to be a multiple of 3");
  }

  const words: string[] = [];
  for (let nibble = 0; nibble < input.length * 2; nibble += 3) {
    const p = nibble >> 1;
    const b1 = input[p];
    const b2 = p + 1 < input.length ? input[p + 1] : 0;
    const idx =
      nibble % 2 === 0 ? (b1 << 4) + (b2 >> 4) : ((b1 & 0x0f) << 8) + b2;
    words.push(WordList[idx]);
  }

  return words.join(" ");
}

/**
 * Convert mnemonic words to binary seed.
 *
 * @param mnemonic - Space-separated mnemonic words
 * @returns Binary seed as Uint8Array
 */
function mnemonicToBin(mnemonic: string): Uint8Array {
  const mnemonicWords = mnemonic.trim().split(/\s+/);
  const wordCount = mnemonicWords.length;

  if (wordCount % 2 !== 0) {
    throw new Error("word count must be even");
  }

  const result = new Uint8Array((wordCount * 15) / 10);
  let current = 0;
  let buffering = 0;
  let resultIndex = 0;

  for (const w of mnemonicWords) {
    const value = WORD_LOOKUP[w];
    if (value === undefined) {
      throw new Error("invalid word in mnemonic");
    }

    buffering += 3;
    current = (current << 12) + value;

    while (buffering > 2) {
      const shift = 4 * (buffering - 2);
      const mask = (1 << shift) - 1;
      const tmp = current >> shift;
      buffering -= 2;
      current &= mask;
      result[resultIndex] = tmp;
      resultIndex++;
    }
  }

  if (buffering > 0) {
    result[resultIndex] = current & 0xff;
  }

  return result;
}

/**
 * Convert a hex seed to mnemonic words.
 *
 * @param hexSeed - Hex-encoded seed (with or without 0x prefix)
 * @returns Mnemonic word phrase (32 words for 48-byte seed)
 */
export const getMnemonicFromHexSeed = (hexSeed?: string) => {
  if (!hexSeed) return "";
  const trimmedHexSeed = hexSeed.trim();
  if (!trimmedHexSeed) return "";
  const hexSeedBin = Buffer.from(trimmedHexSeed.substring(2), "hex");
  return binToMnemonic(hexSeedBin);
};

/**
 * Convert mnemonic words to hex seed.
 *
 * @param mnemonic - Space-separated mnemonic words
 * @returns Hex-encoded seed with 0x prefix
 */
export const getHexSeedFromMnemonic = (mnemonic?: string) => {
  if (!mnemonic) return "";
  const trimmedMnemonic = mnemonic.trim();
  if (!trimmedMnemonic) return "";
  const seedBin = mnemonicToBin(trimmedMnemonic);

  if (seedBin.length !== 48) {
    throw new Error("unexpected mnemonic output size");
  }

  return "0x".concat(Buffer.from(seedBin).toString("hex"));
};

/**
 * Derive a wallet address from mnemonic words.
 *
 * @param mnemonic - Space-separated mnemonic words
 * @returns Zond wallet address
 */
export const getAddressFromMnemonic = (mnemonic?: string) => {
  if (!mnemonic) return "";
  const trimmedMnemonic = mnemonic.trim();
  if (!trimmedMnemonic) return "";
  const seedBin = mnemonicToBin(trimmedMnemonic);
  const account = web3.zond.accounts.seedToAccount(seedBin);
  return account.address;
};
