/**
 * Stateless verifiers for both signing schemes. The wallet exercises these
 * in its own unit tests; the SDK mirrors them so dApps can re-verify a
 * response without round-tripping back through the relay.
 */

import * as mldsa from '@theqrl/mldsa87';
import { SCHEME_TAG_MSG, SCHEME_TAG_TYPED } from './ctx';
import { computeMessageDigest } from './messageDigest';
import { computeTypedDataDigest, type TypedDataPayload } from './typedData';
import { hexToBytes } from './bytes';

function bytesOrHex(v: Uint8Array | string): Uint8Array {
  if (v instanceof Uint8Array) return v;
  if (typeof v === 'string') return hexToBytes(v);
  throw new Error('expected Uint8Array or 0x-hex string');
}

export interface VerifyMessageParams {
  signature: Uint8Array | string;
  publicKey: Uint8Array | string;
  /** 0x-hex bytes that were originally signed. */
  messageBytes: Uint8Array | string;
}

export function verifyMessage({ signature, publicKey, messageBytes }: VerifyMessageParams): boolean {
  try {
    const sig = bytesOrHex(signature);
    const pk = bytesOrHex(publicKey);
    const msg = bytesOrHex(messageBytes);
    const digest = computeMessageDigest(msg);
    return mldsa.cryptoSignVerify(sig, digest, pk, SCHEME_TAG_MSG);
  } catch {
    return false;
  }
}

export interface VerifyTypedDataParams {
  signature: Uint8Array | string;
  publicKey: Uint8Array | string;
  payload: TypedDataPayload;
}

export function verifyTypedData({ signature, publicKey, payload }: VerifyTypedDataParams): boolean {
  try {
    const sig = bytesOrHex(signature);
    const pk = bytesOrHex(publicKey);
    const digest = computeTypedDataDigest(payload);
    return mldsa.cryptoSignVerify(sig, digest, pk, SCHEME_TAG_TYPED);
  } catch {
    return false;
  }
}
