import { shake256 } from '@noble/hashes/sha3.js';
import { SCHEME_TAG_MSG, DIGEST_LEN } from './ctx';
import { concatBytes } from './bytes';

/**
 * Pure SHAKE256 digest for `qrl_signMessage` v1.
 *
 *   digest = SHAKE256("QRL-SIGN-MSG-v1" || messageBytes, 64)
 *
 * The scheme tag is committed into the preimage so a signature produced for
 * this scheme cannot be re-interpreted as belonging to typed-data signing
 * (or vice versa) even if the `ctx` parameter were ever stripped.
 */
export function computeMessageDigest(messageBytes: Uint8Array): Uint8Array {
  if (!(messageBytes instanceof Uint8Array)) {
    throw new Error('messageBytes must be a Uint8Array');
  }
  return shake256(concatBytes(SCHEME_TAG_MSG, messageBytes), { dkLen: DIGEST_LEN });
}
