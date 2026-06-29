/**
 * Low-level ML-DSA-87 signing wrapper used by both `qrl_signMessage` and
 * `qrl_signTypedData`. Caller pre-computes the SHAKE256 digest and the
 * scheme-specific `ctx` bytes; this module owns key derivation, randomized
 * signing, and the rich response shape.
 */

import * as mldsa from '@theqrl/mldsa87';
import { newWalletFromExtendedSeed } from '@theqrl/wallet.js';
import { utils as web3Utils } from '@theqrl/web3';
import {
  SCHEME_TAG_MSG,
  SCHEME_TAG_TYPED,
  SCHEME_VERSION_MSG,
  SCHEME_VERSION_TYPED,
} from './ctx';
import { computeMessageDigest } from './messageDigest';
import { computeTypedDataDigest, type TypedDataPayload } from './typedData';
import { bytesToHex, hexToBytes } from './bytes';
import { DEFAULT_ADDRESS_FORMAT } from '@/config/addressFormat';
import { isDesktop } from '@/desktop/bridge';

export interface SignWithSchemeParams {
  /** SHAKE256 digest (64 bytes) produced by the per-scheme hasher. */
  digest: Uint8Array;
  /** Per-scheme domain-separation `ctx` (well under FIPS 204's 255-byte cap). */
  ctx: Uint8Array;
  /** 40-byte hex extended seed (`0x...` or bare hex). */
  hexSeed: string;
  /**
   * FIPS 204 §3.4 hedged signing. Default true. Tests force `false` to lock
   * deterministic vectors; production callers should never set this to false.
   */
  randomized?: boolean;
}

export interface SignWithSchemeResult {
  signature: Uint8Array;
  publicKey: Uint8Array;
  signer: string;
}

function isHexFormat(s: string): boolean {
  return /^(0x)?[0-9a-fA-F]+$/.test(s);
}

function ensureHexSeed(hexSeed: string): string {
  if (typeof hexSeed !== 'string' || !isHexFormat(hexSeed)) {
    throw new Error('hexSeed must be a hex string');
  }
  return hexSeed.startsWith('0x') ? hexSeed : `0x${hexSeed}`;
}

function ensureDigest(digest: Uint8Array): Uint8Array {
  if (!(digest instanceof Uint8Array) || digest.length !== 64) {
    throw new Error('digest must be a 64-byte Uint8Array');
  }
  return digest;
}

/**
 * Shared signing core: derive ML-DSA-87 keypair from the hex seed, produce
 * a 4595-byte signature over `digest` with the per-scheme `ctx`, and return
 * everything a stateless verifier needs (signature, public key, signer).
 *
 * The wallet is zeroized on every exit path; callers should not retain the
 * secret key outside this function.
 */
export function signWithScheme({
  digest,
  ctx,
  hexSeed,
  randomized = true,
}: SignWithSchemeParams): SignWithSchemeResult {
  // Defense-in-depth: on desktop ML-DSA-87 signing happens only in the
  // isolated signer. The renderer must never derive the secret key from a
  // hex seed, so fail loudly if any path reaches here.
  if (isDesktop) {
    throw new Error('desktop: signing happens in the signer, not the renderer');
  }
  ensureDigest(digest);
  if (!(ctx instanceof Uint8Array) || ctx.length > 255) {
    throw new Error('ctx must be a Uint8Array under 256 bytes');
  }
  const seed = ensureHexSeed(hexSeed);
  const wallet = newWalletFromExtendedSeed(seed);
  try {
    const sigBuf = new Uint8Array(mldsa.CryptoBytes);
    mldsa.cryptoSignSignature(sigBuf, digest, wallet.sk, randomized, ctx);
    // wallet.js v3 getAddressStr() returns the 97-char full identity
    // (descriptor + ML-DSA-87 pubkey hash); the on-chain Q-address is the
    // leading slice of those bytes with EIP-55 checksum casing. seedToAccount
    // exposes the same value but via the nested wallet.js v2.0.2 dep, so we
    // derive it directly here to avoid the version skew. The slice bounds +
    // checksum scheme come from the address-format spec (Phase 1 replaces this
    // shim with a typed wallet.js API for the 64-byte format).
    const [sliceStart, sliceEnd] = DEFAULT_ADDRESS_FORMAT.identitySlice;
    const signer = web3Utils.toChecksumAddress(
      `Q${wallet.getAddressStr().slice(sliceStart, sliceEnd)}`,
    );
    return {
      signature: sigBuf,
      publicKey: new Uint8Array(wallet.pk),
      signer,
    };
  } finally {
    wallet.zeroize();
  }
}

/**
 * High-level `qrl_signMessage` entry point. The dApp always passes 0x-hex
 * bytes (Zod enforces that at the dispatch layer); the wallet decodes,
 * hashes, signs, and returns the rich response object directly.
 */
export interface SignMessageResult {
  signature: string;
  publicKey: string;
  signer: string;
  digest: string;
  schemeVersion: typeof SCHEME_VERSION_MSG;
}

export function signMessage(
  messageHex: string,
  hexSeed: string,
  opts?: { randomized?: boolean },
): SignMessageResult {
  const messageBytes = hexToBytes(messageHex);
  const digest = computeMessageDigest(messageBytes);
  const { signature, publicKey, signer } = signWithScheme({
    digest,
    ctx: SCHEME_TAG_MSG,
    hexSeed,
    randomized: opts?.randomized,
  });
  return {
    signature: bytesToHex(signature),
    publicKey: bytesToHex(publicKey),
    signer,
    digest: bytesToHex(digest),
    schemeVersion: SCHEME_VERSION_MSG,
  };
}

export interface SignTypedDataResult {
  signature: string;
  publicKey: string;
  signer: string;
  digest: string;
  schemeVersion: typeof SCHEME_VERSION_TYPED;
  domain: TypedDataPayload['domain'];
}

export function signTypedData(
  payload: TypedDataPayload,
  hexSeed: string,
  opts?: { randomized?: boolean },
): SignTypedDataResult {
  const digest = computeTypedDataDigest(payload);
  const { signature, publicKey, signer } = signWithScheme({
    digest,
    ctx: SCHEME_TAG_TYPED,
    hexSeed,
    randomized: opts?.randomized,
  });
  return {
    signature: bytesToHex(signature),
    publicKey: bytesToHex(publicKey),
    signer,
    digest: bytesToHex(digest),
    schemeVersion: SCHEME_VERSION_TYPED,
    domain: payload.domain,
  };
}
