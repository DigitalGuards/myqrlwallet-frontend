/**
 * v3 QR URI parser - wallet side (PQP3).
 *
 * Blob layout: "PQP3" (4) || cid (16) || fp (32) || cap (32) = 84 B
 *
 *   fp = SHA-256("pq-fp/v3" || cid || pk || cap)  (full 32 bytes)
 *
 * The PK is uploaded by the dApp and fetched through the relay. The random
 * capability is delivered only through the out-of-band QR/deep-link URI and
 * is bound into both this public-key commitment and the key schedule. It must
 * never be sent to the relay.
 */

import { base45Decode } from './base45';

const MAGIC = new Uint8Array([0x50, 0x51, 0x50, 0x33]); // "PQP3"
const FP_LABEL = new TextEncoder().encode('pq-fp/v3');
const MAX_URI_LEN = 4096;

export const CID_LEN = 16;
export const FP_LEN = 32;
export const CAP_LEN = 32;
export const BLOB_LEN = 4 + CID_LEN + FP_LEN + CAP_LEN; // 84
const BASE45_BLOB_LEN = Math.ceil(BLOB_LEN / 2) * 3;

/**
 * Compute fp = SHA-256("pq-fp/v3" || cid || pk || cap). Used by the wallet
 * to verify the PK the relay served matches the capability-bound commitment
 * in the QR.
 */
export async function computeFingerprint(
  cid: Uint8Array,
  pk: Uint8Array,
  cap: Uint8Array
): Promise<Uint8Array> {
  if (cid.length !== CID_LEN) {
    throw new Error(`qrUri: cid must be ${CID_LEN} bytes`);
  }
  if (cap.length !== CAP_LEN) {
    throw new Error(`qrUri: cap must be ${CAP_LEN} bytes`);
  }
  const c = globalThis.crypto;
  if (!c || !c.subtle) {
    throw new Error('qrUri: WebCrypto SubtleCrypto is not available');
  }
  // Freshly allocated, so already ArrayBuffer-backed (Uint8Array<ArrayBuffer>),
  // which satisfies WebCrypto's BufferSource without any cast.
  const buf = new Uint8Array(FP_LABEL.length + cid.length + pk.length + cap.length);
  buf.set(FP_LABEL, 0);
  buf.set(cid, FP_LABEL.length);
  buf.set(pk, FP_LABEL.length + cid.length);
  buf.set(cap, FP_LABEL.length + cid.length + pk.length);
  try {
    return new Uint8Array(await c.subtle.digest('SHA-256', buf));
  } finally {
    buf.fill(0);
  }
}

/** Constant-time equality. Both arrays must be the same length. */
export function fingerprintEquals(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  // Equal lengths + bounded i mean both reads are always defined. Use a
  // compile-time `as number` (fully erased at runtime to `a[i] ^ b[i]`)
  // rather than `?? 0`, which would emit a conditional and break the
  // constant-time guarantee.
  for (let i = 0; i < a.length; i++) diff |= (a[i] as number) ^ (b[i] as number);
  return diff === 0;
}

export interface ParsedURI {
  cid: Uint8Array;
  fp: Uint8Array;
  /** Bearer capability. Callers must zeroize it once key derivation finishes. */
  cap: Uint8Array;
  relayUrl?: string;
}

const PQP1_MAGIC = new Uint8Array([0x50, 0x51, 0x50, 0x31]);
const PQP2_MAGIC = new Uint8Array([0x50, 0x51, 0x50, 0x32]);
const PQP1_BLOB_LEN = 1208;
const PQP1_BASE45_LEN = Math.ceil(PQP1_BLOB_LEN / 2) * 3;
const CID_STRING_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function startsWith(buf: Uint8Array, prefix: Uint8Array): boolean {
  if (buf.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (buf[i] !== prefix[i]) return false;
  }
  return true;
}

/**
 * Recognize a dApp "wake" link: `qrlconnect://?wake=<cid>`. The SDK deep-links
 * it to foreground the wallet app when a request is waiting for a wallet whose
 * socket is absent; it carries no pairing payload (sessions resume via
 * reconnectAll on APP_STATE active). Returns the cid string, or null when the
 * URI is not a wake link. A URI carrying `q` is always a pairing URI, never a
 * wake link.
 */
export function parseWakeURI(uri: string): string | null {
  if (
    typeof uri !== 'string' ||
    uri.length === 0 ||
    uri.length > MAX_URI_LEN ||
    uri.trim() !== uri ||
    !/^qrlconnect:\/\/\?/.test(uri)
  ) {
    return null;
  }
  try {
    const swapped = new URL(uri.replace(/^qrlconnect:\/\//, 'https://qrlconnect/'));
    const params = swapped.searchParams;
    if (
      swapped.pathname !== '/' ||
      swapped.hash !== '' ||
      [...params.keys()].some((key) => key !== 'wake') ||
      params.getAll('q').length !== 0 ||
      params.getAll('wake').length !== 1 ||
      params.getAll('r').length !== 0
    ) {
      return null;
    }
    const wake = params.get('wake');
    return wake && CID_STRING_RE.test(wake) ? wake : null;
  } catch {
    return null;
  }
}

export function parseRelayUrl(value: string): string {
  if (value.length === 0 || value.length > 2048 || value.trim() !== value) {
    throw new Error('qrUri: invalid relay URL');
  }
  try {
    const parsed = new URL(value);
    const loopback =
      parsed.hostname === 'localhost' ||
      parsed.hostname.endsWith('.localhost') ||
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname === '[::1]';
    if (
      (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback)) ||
      parsed.username !== '' ||
      parsed.password !== '' ||
      parsed.hostname === '' ||
      parsed.search !== '' ||
      parsed.hash !== ''
    ) {
      throw new Error('invalid');
    }
    return parsed.toString();
  } catch {
    throw new Error('qrUri: invalid relay URL');
  }
}

export async function parseConnectionURI(uri: string): Promise<ParsedURI> {
  if (typeof uri !== 'string' || uri.length === 0) {
    throw new Error('qrUri: empty URI');
  }
  if (uri.length > MAX_URI_LEN) {
    throw new Error(`qrUri: URI exceeds ${MAX_URI_LEN} characters`);
  }
  if (uri.trim() !== uri) {
    throw new Error('qrUri: malformed URI');
  }
  if (!/^qrlconnect:\/\/\?/.test(uri)) {
    throw new Error('qrUri: not a qrlconnect URI');
  }
  // WHATWG URL parsing via a dummy-scheme swap so malformed input like
  // "qrlconnect:q=..." rejects cleanly instead of slipping through a
  // loose regex.
  let params: URLSearchParams;
  try {
    const swapped = new URL(uri.replace(/^qrlconnect:\/\//, 'https://qrlconnect/'));
    if (swapped.pathname !== '/' || swapped.hash !== '') {
      throw new Error('invalid URI shape');
    }
    params = swapped.searchParams;
  } catch {
    throw new Error('qrUri: malformed URI');
  }

  if (params.has('channelId') || params.has('pubKey')) {
    throw new Error(
      'qrUri: legacy v1 URI - this wallet requires a PQP3 dApp'
    );
  }

  if ([...params.keys()].some((key) => key !== 'q' && key !== 'r')) {
    throw new Error('qrUri: unknown query parameter');
  }

  if (params.getAll('q').length > 1) {
    throw new Error('qrUri: duplicate q parameter');
  }
  if (params.getAll('r').length > 1) {
    throw new Error('qrUri: duplicate r parameter');
  }

  const q = params.get('q');
  if (!q) {
    throw new Error('qrUri: missing q parameter');
  }
  if (q.length > BASE45_BLOB_LEN && q.length !== PQP1_BASE45_LEN) {
    throw new Error(
      `qrUri: PQP3 payload exceeds ${BASE45_BLOB_LEN} characters`
    );
  }

  let blob: Uint8Array;
  try {
    blob = base45Decode(q);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`qrUri: base45 decode failed: ${msg}`);
  }

  try {
    if (blob.length !== BLOB_LEN) {
      // Distinguish legacy blobs so the user sees a useful upgrade hint.
      if (blob.length === PQP1_BLOB_LEN && startsWith(blob, PQP1_MAGIC)) {
        throw new Error(
          'qrUri: legacy PQP1 URI - regenerate the QR with @qrlwallet/connect 4 or newer'
        );
      }
      if (blob.length === 52 && startsWith(blob, PQP2_MAGIC)) {
        throw new Error(
          'qrUri: legacy PQP2 URI - regenerate the QR with @qrlwallet/connect 4 or newer'
        );
      }
      throw new Error(`qrUri: expected ${BLOB_LEN}-byte blob, got ${blob.length}`);
    }

    if (!startsWith(blob, MAGIC)) {
      throw new Error('qrUri: bad PQP3 magic');
    }

    const rawRelayUrl = params.get('r');
    const relayUrl = rawRelayUrl === null ? undefined : parseRelayUrl(rawRelayUrl);
    const cid = blob.slice(4, 4 + CID_LEN);
    const fp = blob.slice(4 + CID_LEN, 4 + CID_LEN + FP_LEN);
    const cap = blob.slice(4 + CID_LEN + FP_LEN, BLOB_LEN);
    return { cid, fp, cap, relayUrl };
  } finally {
    blob.fill(0);
  }
}

export function cidToString(cid: Uint8Array): string {
  if (cid.length !== CID_LEN) {
    throw new Error(`cidToString: expected ${CID_LEN}-byte cid`);
  }
  let hex = '';
  for (let i = 0; i < CID_LEN; i++) {
    hex += (cid[i] ?? 0).toString(16).padStart(2, '0');
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
