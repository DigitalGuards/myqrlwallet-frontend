/**
 * Unit tests for the wallet-side PQP3 qrlconnect:// URI parser.
 *
 * This parser is the single hostile-input choke point for dApp-connect
 * ingress (QR scan, mobile deep link, desktop protocol handler, desktop
 * paste). Fixtures are built the same way the SDK's generator builds real
 * URIs: URLSearchParams over base45(PQP3 || cid || fp || cap), optional sibling
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
  CAP_LEN,
  BLOB_LEN,
} from '../qrUri';
import { base45Encode } from '../base45';

const MAGIC = [0x50, 0x51, 0x50, 0x33]; // "PQP3"
const PQP1_MAGIC = [0x50, 0x51, 0x50, 0x31]; // "PQP1"
const PQP2_MAGIC = [0x50, 0x51, 0x50, 0x32]; // "PQP2"

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

function makeCap(fill = 0xa7): Uint8Array {
  const cap = new Uint8Array(CAP_LEN);
  cap.fill(fill);
  return cap;
}

function makeBlob(
  cid: Uint8Array,
  fp: Uint8Array,
  cap: Uint8Array = makeCap(),
  magic: number[] = MAGIC
): Uint8Array {
  const blob = new Uint8Array(4 + cid.length + fp.length + cap.length);
  blob.set(magic, 0);
  blob.set(cid, 4);
  blob.set(fp, 4 + cid.length);
  blob.set(cap, 4 + cid.length + fp.length);
  return blob;
}

/** Build a URI exactly like the SDK generator does (URLSearchParams-encoded). */
function makeUri(blob: Uint8Array, relayUrl?: string): string {
  const params = new URLSearchParams({ q: base45Encode(blob) });
  if (relayUrl) params.set('r', relayUrl);
  return `qrlconnect://?${params.toString()}`;
}

describe('parseConnectionURI', () => {
  it('parses a valid PQP3 URI (round-trips cid, fp, and cap)', async () => {
    const cid = makeCid();
    const fp = makeFp();
    const cap = makeCap();
    const parsed = await parseConnectionURI(makeUri(makeBlob(cid, fp, cap)));
    expect(Array.from(parsed.cid)).toEqual(Array.from(cid));
    expect(Array.from(parsed.fp)).toEqual(Array.from(fp));
    expect(Array.from(parsed.cap)).toEqual(Array.from(cap));
    expect(parsed.relayUrl).toBeUndefined();
  });

  it('returns the r= relay param verbatim', async () => {
    const uri = makeUri(makeBlob(makeCid(), makeFp()), 'https://dev.qrlwallet.com');
    const parsed = await parseConnectionURI(uri);
    expect(parsed.relayUrl).toBe('https://dev.qrlwallet.com/');
  });

  it('rejects mixed-case schemes outside the canonical wire format', async () => {
    const uri = makeUri(makeBlob(makeCid(), makeFp())).replace(/^qrlconnect/, 'QRLCONNECT');
    await expect(parseConnectionURI(uri)).rejects.toThrow('not a qrlconnect URI');
  });

  it('rejects a relay-smuggling shape with an unknown sibling parameter', async () => {
    const base = makeUri(makeBlob(makeCid(), makeFp()));
    const uri = `${base}&x=?&r=https://evil.example`;
    await expect(parseConnectionURI(uri)).rejects.toThrow('unknown query parameter');
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
    await expect(parseConnectionURI(`qrlconnect:q=${q}`)).rejects.toThrow(
      'not a qrlconnect URI'
    );
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

  it('rejects a legacy PQP2 blob rather than silently downgrading', async () => {
    const blob = new Uint8Array(4 + CID_LEN + FP_LEN);
    blob.set(PQP2_MAGIC, 0);
    await expect(parseConnectionURI(makeUri(blob))).rejects.toThrow('legacy PQP2 URI');
  });

  it('rejects an 84-byte blob with the wrong magic', async () => {
    const blob = makeBlob(makeCid(), makeFp(), makeCap(), [0x41, 0x42, 0x43, 0x44]);
    await expect(parseConnectionURI(makeUri(blob))).rejects.toThrow('bad PQP3 magic');
  });

  it('rejects oversized URIs before Base45 decoding', async () => {
    await expect(parseConnectionURI(`qrlconnect://?q=${'A'.repeat(4097)}`)).rejects.toThrow(
      'URI exceeds 4096 characters'
    );
  });

  it('rejects duplicate q and r parameters', async () => {
    const q = base45Encode(makeBlob(makeCid(), makeFp()));
    await expect(parseConnectionURI(`qrlconnect://?q=${q}&q=${q}`)).rejects.toThrow(
      'duplicate q parameter'
    );
    await expect(
      parseConnectionURI(`qrlconnect://?q=${q}&r=https://one.example&r=https://two.example`)
    ).rejects.toThrow('duplicate r parameter');
  });

  it.each([
    'javascript:alert(1)',
    'wss://relay.example',
    'https://user:password@relay.example',
    'http://relay.example',
    'https://relay.example/?cap=secret',
    'https://relay.example/#fragment',
    '',
  ])('rejects an unsafe relay URL %s', async (relayUrl) => {
    const q = base45Encode(makeBlob(makeCid(), makeFp()));
    const uri = `qrlconnect://?${new URLSearchParams({ q, r: relayUrl }).toString()}`;
    await expect(parseConnectionURI(uri)).rejects.toThrow('invalid relay URL');
  });

  it.each([
    ['http://localhost:8787', 'http://localhost:8787/'],
    ['http://relay.localhost:8787', 'http://relay.localhost:8787/'],
    ['http://127.0.0.1:8787', 'http://127.0.0.1:8787/'],
    ['http://[::1]:8787', 'http://[::1]:8787/'],
  ])('allows an explicit loopback relay URL', async (relayUrl, canonical) => {
    const parsed = await parseConnectionURI(
      makeUri(makeBlob(makeCid(), makeFp()), relayUrl),
    );
    expect(parsed.relayUrl).toBe(canonical);
  });
});

describe('computeFingerprint', () => {
  it('matches SHA-256("pq-fp/v3" || cid || pk || cap)', async () => {
    const cid = makeCid();
    const pk = new Uint8Array(64).fill(0x77);
    const cap = makeCap();
    const label = new TextEncoder().encode('pq-fp/v3');
    const buf = new Uint8Array(label.length + cid.length + pk.length + cap.length);
    buf.set(label, 0);
    buf.set(cid, label.length);
    buf.set(pk, label.length + cid.length);
    buf.set(cap, label.length + cid.length + pk.length);
    const expected = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', buf));

    const fp = await computeFingerprint(cid, pk, cap);
    expect(fp).toHaveLength(FP_LEN);
    expect(fingerprintEquals(fp, expected)).toBe(true);
  });

  it('rejects a wrong-length cid', async () => {
    await expect(
      computeFingerprint(new Uint8Array(3), new Uint8Array(4), makeCap())
    ).rejects.toThrow(`cid must be ${CID_LEN} bytes`);
  });

  it('rejects a wrong-length capability', async () => {
    await expect(
      computeFingerprint(makeCid(), new Uint8Array(4), new Uint8Array(CAP_LEN - 1))
    ).rejects.toThrow(`cap must be ${CAP_LEN} bytes`);
  });

  it('changes when only the bearer capability changes', async () => {
    const cid = makeCid();
    const pk = new Uint8Array(64).fill(0x77);
    const first = await computeFingerprint(cid, pk, makeCap(0x11));
    const second = await computeFingerprint(cid, pk, makeCap(0x22));
    expect(fingerprintEquals(first, second)).toBe(false);
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
  const cid = '00112233-4455-6677-8899-aabbccddeeff';

  it('returns the cid from a wake link', () => {
    expect(parseWakeURI(`qrlconnect://?wake=${cid}`)).toBe(cid);
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

  it('rejects oversized, duplicate, and malformed wake identifiers', () => {
    expect(parseWakeURI(`qrlconnect://?wake=${'a'.repeat(4097)}`)).toBeNull();
    expect(parseWakeURI(`qrlconnect://?wake=${cid}&wake=${cid}`)).toBeNull();
    expect(parseWakeURI('qrlconnect://?wake=not-a-channel-id')).toBeNull();
    expect(parseWakeURI(`QRLCONNECT://?wake=${cid}`)).toBeNull();
    expect(parseWakeURI(`qrlconnect://?wake=${cid.toUpperCase()}`)).toBeNull();
  });
});
