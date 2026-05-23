/**
 * Per-scheme domain-separation tags + version strings.
 *
 * The tag bytes are mixed into both:
 *   1. The SHAKE256 preimage that produces the signed digest (so the digest
 *      itself commits to which scheme is in use), and
 *   2. The ML-DSA-87 `ctx` parameter (so the signature verifier rejects
 *      cross-scheme replay even if a digest collision were ever found).
 *
 * Both stay well under FIPS 204's 255-byte ctx cap.
 */
export const SCHEME_VERSION_MSG = 'QRL-SIGN-MSG-v1';
export const SCHEME_VERSION_TYPED = 'QRL-SIGN-TYPED-v1';

export const SCHEME_TAG_MSG: Uint8Array = new TextEncoder().encode(SCHEME_VERSION_MSG);
export const SCHEME_TAG_TYPED: Uint8Array = new TextEncoder().encode(SCHEME_VERSION_TYPED);

/** SHAKE256 output length used throughout the signing module (NIST L5-matched). */
export const DIGEST_LEN = 64;
