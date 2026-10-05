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
/**
 * Typed data with 64-byte slots, one QRVM word per atomic value, so a QIP-55
 * address fits. A payload uses it exactly when an `address` type is
 * reachable from QRLDomain or the primary type; every other payload keeps
 * v1. See typedData.ts.
 */
export const SCHEME_VERSION_TYPED_V2 = 'QRL-SIGN-TYPED-v2';

export type TypedDataSchemeVersion =
  | typeof SCHEME_VERSION_TYPED
  | typeof SCHEME_VERSION_TYPED_V2;

export const SCHEME_TAG_MSG: Uint8Array = new TextEncoder().encode(SCHEME_VERSION_MSG);
export const SCHEME_TAG_TYPED: Uint8Array = new TextEncoder().encode(SCHEME_VERSION_TYPED);
export const SCHEME_TAG_TYPED_V2: Uint8Array = new TextEncoder().encode(SCHEME_VERSION_TYPED_V2);

/** SHAKE256 output length used throughout the signing module (NIST L5-matched). */
export const DIGEST_LEN = 64;
