/**
 * v2 QR URI parser — wallet side.
 *
 * Only needs to parse, not generate. Reject legacy v1 URIs (channelId/pubKey
 * query params) with a clear error so the user sees "upgrade dApp" instead
 * of a mysterious crypto failure downstream.
 */

import { base45Decode } from './base45';

const MAGIC = new Uint8Array([0x50, 0x51, 0x50, 0x31]); // "PQP1"
export const CID_LEN = 16;
export const PK_LEN = 1184;
export const FP_LEN = 4;
export const BLOB_LEN = 4 + CID_LEN + PK_LEN + FP_LEN;

async function sha256First4(bytes: Uint8Array): Promise<Uint8Array> {
  const c = globalThis.crypto;
  if (!c || !c.subtle) {
    throw new Error('qrUri: WebCrypto SubtleCrypto is not available');
  }
  const digest = await c.subtle.digest(
    'SHA-256',
    bytes as unknown as BufferSource
  );
  return new Uint8Array(digest).slice(0, FP_LEN);
}

export interface ParsedURI {
  cid: Uint8Array;
  pk: Uint8Array;
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
    throw new Error(`qrUri: expected ${BLOB_LEN}-byte blob, got ${blob.length}`);
  }

  for (let i = 0; i < MAGIC.length; i++) {
    if (blob[i] !== MAGIC[i]) {
      throw new Error('qrUri: bad PQP1 magic');
    }
  }

  const cid = blob.slice(4, 4 + CID_LEN);
  const pk = blob.slice(4 + CID_LEN, 4 + CID_LEN + PK_LEN);
  const fp = blob.slice(BLOB_LEN - FP_LEN, BLOB_LEN);

  const expected = await sha256First4(pk);
  let diff = 0;
  for (let i = 0; i < FP_LEN; i++) diff |= fp[i] ^ expected[i];
  if (diff !== 0) {
    throw new Error('qrUri: fingerprint mismatch');
  }

  return { cid, pk };
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
