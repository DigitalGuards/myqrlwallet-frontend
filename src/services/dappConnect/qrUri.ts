/**
 * v2 QR URI parser — wallet side (PQP2).
 *
 * Blob layout: "PQP2" (4) || cid (16) || fp (32) = 52 B
 *
 *   fp = SHA-256("pq-fp/v2" || cid || pk)  (full 32 bytes)
 *
 * The PK is NOT in the QR — it's uploaded by the dApp to the relay and
 * handed to the wallet via the join_channel ack. The fingerprint in the
 * QR is the out-of-band commitment; the wallet verifies
 * `SHA-256("pq-fp/v2" || cid || pk_from_relay) == fp` before trusting
 * the served PK. Full SHA-256 (2^128 security) rules out a malicious
 * relay finding a different PK' with a colliding fingerprint.
 */

import { base45Decode } from './base45';

const MAGIC = new Uint8Array([0x50, 0x51, 0x50, 0x32]); // "PQP2"
const FP_LABEL = new TextEncoder().encode('pq-fp/v2');

export const CID_LEN = 16;
export const FP_LEN = 32;
export const BLOB_LEN = 4 + CID_LEN + FP_LEN; // 52

function bs(u: Uint8Array): BufferSource {
  return u as unknown as BufferSource;
}

/**
 * Compute fp = SHA-256("pq-fp/v2" || cid || pk). Used by the wallet to
 * verify the PK the relay served matches the commitment in the QR.
 */
export async function computeFingerprint(
  cid: Uint8Array,
  pk: Uint8Array
): Promise<Uint8Array> {
  if (cid.length !== CID_LEN) {
    throw new Error(`qrUri: cid must be ${CID_LEN} bytes`);
  }
  const c = globalThis.crypto;
  if (!c || !c.subtle) {
    throw new Error('qrUri: WebCrypto SubtleCrypto is not available');
  }
  const buf = new Uint8Array(FP_LABEL.length + cid.length + pk.length);
  buf.set(FP_LABEL, 0);
  buf.set(cid, FP_LABEL.length);
  buf.set(pk, FP_LABEL.length + cid.length);
  const digest = await c.subtle.digest('SHA-256', bs(buf));
  return new Uint8Array(digest);
}

/** Constant-time equality. Both arrays must be the same length. */
export function fingerprintEquals(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export interface ParsedURI {
  cid: Uint8Array;
  fp: Uint8Array;
  relayUrl?: string;
}

export async function parseConnectionURI(uri: string): Promise<ParsedURI> {
  if (typeof uri !== 'string' || uri.length === 0) {
    throw new Error('qrUri: empty URI');
  }
  if (!/^qrlconnect:/i.test(uri)) {
    throw new Error('qrUri: not a qrlconnect URI');
  }
  const stripped = uri.replace(/^qrlconnect:\/?\/?\??/i, '');
  const params = new URLSearchParams(stripped);

  if (params.has('channelId') || params.has('pubKey')) {
    throw new Error(
      'qrUri: legacy v1 URI — this wallet requires a post-quantum (v2) dApp'
    );
  }

  const q = params.get('q');
  if (!q) {
    throw new Error('qrUri: missing q parameter');
  }

  let blob: Uint8Array;
  try {
    blob = base45Decode(q);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`qrUri: base45 decode failed: ${msg}`);
  }

  if (blob.length !== BLOB_LEN) {
    // Distinguish a PQP1 URI (1208-byte blob) so the user sees a useful
    // hint instead of a generic size mismatch.
    if (blob.length === 1208 && blob[3] === 0x31 /* '1' */) {
      throw new Error(
        'qrUri: legacy PQP1 URI — regenerate the QR with a v2.0+ dApp SDK'
      );
    }
    throw new Error(`qrUri: expected ${BLOB_LEN}-byte blob, got ${blob.length}`);
  }

  for (let i = 0; i < MAGIC.length; i++) {
    if (blob[i] !== MAGIC[i]) {
      throw new Error('qrUri: bad PQP2 magic');
    }
  }

  const cid = blob.slice(4, 4 + CID_LEN);
  const fp = blob.slice(4 + CID_LEN, 4 + CID_LEN + FP_LEN);
  const relayUrl = params.get('r') || undefined;
  return { cid, fp, relayUrl };
}

export function cidToString(cid: Uint8Array): string {
  if (cid.length !== CID_LEN) {
    throw new Error(`cidToString: expected ${CID_LEN}-byte cid`);
  }
  let hex = '';
  for (let i = 0; i < CID_LEN; i++) {
    hex += cid[i].toString(16).padStart(2, '0');
  }
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function cidFromString(s: string): Uint8Array {
  const hex = s.replace(/-/g, '');
  if (!/^[0-9a-f]{32}$/i.test(hex)) {
    throw new Error('cidFromString: not a 128-bit hex string');
  }
  const out = new Uint8Array(CID_LEN);
  for (let i = 0; i < CID_LEN; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
