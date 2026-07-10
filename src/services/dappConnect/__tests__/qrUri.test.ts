/**
 * Unit tests for the wallet-side PQP2 qrlconnect:// URI parser.
 *
 * This parser is the single hostile-input choke point for dApp-connect
 * ingress (QR scan, mobile deep link, desktop protocol handler, desktop
 * paste). Fixtures are built the same way the SDK's generator builds real
 * URIs: URLSearchParams over base45(PQP2 || cid || fp), optional sibling
 * r= relay param.
 */

import { describe, it, expect } from '@jest/globals';
import {
  parseConnectionURI,
  parseWakeURI,
  computeFingerprint,
  fingerprintEquals,
  cidToString,
  cidFromString,
  CID_LEN,
  FP_LEN,
  BLOB_LEN,
} from '../qrUri';
import { base45Encode } from '../base45';

const MAGIC = [0x50, 0x51, 0x50, 0x32]; // "PQP2"
const PQP1_MAGIC = [0x50, 0x51, 0x50, 0x31]; // "PQP1"

function makeCid(fill = 0xab): Uint8Array {
  const cid = new Uint8Array(CID_LEN);
  cid.fill(fill);
  // Vary a few bytes so cidToString formatting is meaningfully exercised.
  cid[0] = 0x01;
  cid[CID_LEN - 1] = 0xfe;
  return cid;
}

function makeFp(fill = 0x5c): Uint8Array {
  const fp = new Uint8Array(FP_LEN);
  fp.fill(fill);
  return fp;
}

function makeBlob(cid: Uint8Array, fp: Uint8Array, magic: number[] = MAGIC): Uint8Array {
  const blob = new Uint8Array(4 + cid.length + fp.length);
  blob.set(magic, 0);
  blob.set(cid, 4);
  blob.set(fp, 4 + cid.length);
  return blob;
}

/** Build a URI exactly like the SDK generator does (URLSearchParams-encoded). */
function makeUri(blob: Uint8Array, relayUrl?: string): string {
  const params = new URLSearchParams({ q: base45Encode(blob) });
  if (relayUrl) params.set('r', relayUrl);
  return `qrlconnect://?${params.toString()}`;
}

describe('parseConnectionURI', () => {
  it('parses a valid PQP2 URI (round-trips cid and fp, no relay)', async () => {
    const cid = makeCid();
    const fp = makeFp();
    const parsed = await parseConnectionURI(makeUri(makeBlob(cid, fp)));
    expect(Array.from(parsed.cid)).toEqual(Array.from(cid));
    expect(Array.from(parsed.fp)).toEqual(Array.from(fp));
    expect(parsed.relayUrl).toBeUndefined();
  });

  it('returns the r= relay param verbatim', async () => {
    const uri = makeUri(makeBlob(makeCid(), makeFp()), 'https://dev.qrlwallet.com');
    const parsed = await parseConnectionURI(uri);
    expect(parsed.relayUrl).toBe('https://dev.qrlwallet.com');
  });

  it('accepts an uppercase scheme', async () => {
    const uri = makeUri(makeBlob(makeCid(), makeFp())).replace(/^qrlconnect/, 'QRLCONNECT');
    const parsed = await parseConnectionURI(uri);
    expect(parsed.cid).toHaveLength(CID_LEN);
  });

  it('sees an r= param hidden behind a second "?" (naive split-parsers do not)', async () => {
    // Regression guard for the consent-modal display fix: the modal must
    // derive the shown relay from THIS parser, because a URI like
    // qrlconnect://?q=..&x=?&r=<relay> defeats uri.split('?')[1]-style
    // parsing (r appears absent) while the WHATWG query used here (and by
    // the connect path) still resolves r. If the two disagreed, the user
    // would consent to a different relay than the wallet dials.
    const base = makeUri(makeBlob(makeCid(), makeFp()));
    const uri = `${base}&x=?&r=https://evil.example`;
    expect(base.split('?')[1]?.includes('r=')).toBe(false); // the naive read
    const parsed = await parseConnectionURI(uri);
    expect(parsed.relayUrl).toBe('https://evil.example'); // the real read
  });

  it('rejects a non-qrlconnect scheme', async () => {
    await expect(parseConnectionURI('https://qrlwallet.com/?q=abc')).rejects.toThrow(
      'not a qrlconnect URI'
    );
  });

  it('rejects an empty URI', async () => {
    await expect(parseConnectionURI('')).rejects.toThrow('empty URI');
  });

  it('rejects a scheme-only URI with no query (q lands in the path)', async () => {
    // "qrlconnect:q=..." has no "?": after the dummy-scheme swap the blob is
    // path, not query, so the parser must reject rather than loosely match.
    const q = base45Encode(makeBlob(makeCid(), makeFp()));
    await expect(parseConnectionURI(`qrlconnect:q=${q}`)).rejects.toThrow('missing q parameter');
  });

  it('rejects legacy v1 URIs by their channelId/pubKey params', async () => {
    await expect(
      parseConnectionURI('qrlconnect://?channelId=abc&pubKey=def')
    ).rejects.toThrow('legacy v1 URI');
  });

  it('rejects a q param that is not base45', async () => {
    await expect(parseConnectionURI('qrlconnect://?q=%7F%7F')).rejects.toThrow(
      'base45 decode failed'
    );
  });

  it('rejects a blob of the wrong length', async () => {
    const short = new Uint8Array(BLOB_LEN - 1).fill(1);
    await expect(parseConnectionURI(makeUri(short))).rejects.toThrow(
      `expected ${BLOB_LEN}-byte blob`
    );
  });

  it('gives the legacy hint for a PQP1-magic 1208-byte blob', async () => {
    const legacy = new Uint8Array(1208).fill(0x11);
    legacy.set(PQP1_MAGIC, 0);
    await expect(parseConnectionURI(makeUri(legacy))).rejects.toThrow('legacy PQP1 URI');
  });

  it('rejects a 52-byte blob with the wrong magic', async () => {
    const blob = makeBlob(makeCid(), makeFp(), [0x41, 0x42, 0x43, 0x44]);
    await expect(parseConnectionURI(makeUri(blob))).rejects.toThrow('bad PQP2 magic');
  });
});

describe('computeFingerprint', () => {
  it('matches SHA-256("pq-fp/v2" || cid || pk)', async () => {
    const cid = makeCid();
    const pk = new Uint8Array(64).fill(0x77);
    const label = new TextEncoder().encode('pq-fp/v2');
    const buf = new Uint8Array(label.length + cid.length + pk.length);
    buf.set(label, 0);
    buf.set(cid, label.length);
    buf.set(pk, label.length + cid.length);
    const expected = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', buf));

    const fp = await computeFingerprint(cid, pk);
    expect(fp).toHaveLength(FP_LEN);
    expect(fingerprintEquals(fp, expected)).toBe(true);
  });

  it('rejects a wrong-length cid', async () => {
    await expect(computeFingerprint(new Uint8Array(3), new Uint8Array(4))).rejects.toThrow(
      `cid must be ${CID_LEN} bytes`
    );
  });
});

describe('fingerprintEquals', () => {
  it('is true only for identical bytes', () => {
    const a = makeFp(0x01);
    const b = makeFp(0x01);
    expect(fingerprintEquals(a, b)).toBe(true);
    b[FP_LEN - 1] = 0x02;
    expect(fingerprintEquals(a, b)).toBe(false);
  });

  it('is false for different lengths', () => {
    expect(fingerprintEquals(new Uint8Array(4), new Uint8Array(5))).toBe(false);
  });
});

describe('cidToString / cidFromString', () => {
  it('formats as a uuid-shaped hex string and round-trips', () => {
    const cid = makeCid();
    const s = cidToString(cid);
    expect(s).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(Array.from(cidFromString(s))).toEqual(Array.from(cid));
  });

  it('cidToString rejects a wrong-length cid', () => {
    expect(() => cidToString(new Uint8Array(8))).toThrow(`expected ${CID_LEN}-byte cid`);
  });

  it('cidFromString rejects non-128-bit-hex input', () => {
    expect(() => cidFromString('zz')).toThrow('not a 128-bit hex string');
  });
});

describe('parseWakeURI', () => {
  it('returns the cid from a wake link', () => {
    expect(parseWakeURI('qrlconnect://?wake=abc-123')).toBe('abc-123');
  });

  it('returns null for a pairing URI (q present beats wake)', () => {
    expect(parseWakeURI('qrlconnect://?q=SOMEBLOB')).toBeNull();
    expect(parseWakeURI('qrlconnect://?q=SOMEBLOB&wake=abc')).toBeNull();
  });

  it('returns null for non-qrlconnect schemes and garbage', () => {
    expect(parseWakeURI('https://qrlwallet.com/?wake=abc')).toBeNull();
    expect(parseWakeURI('javascript:alert(1)')).toBeNull();
    expect(parseWakeURI('')).toBeNull();
    expect(parseWakeURI('qrlconnect://')).toBeNull();
  });
});
