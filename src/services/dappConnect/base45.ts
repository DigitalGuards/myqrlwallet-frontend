/**
 * RFC 9285 Base45 codec (wallet side — mirror of SDK implementation).
 */

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

const DECODE: Int8Array = (() => {
  const table = new Int8Array(128).fill(-1);
  for (let i = 0; i < ALPHABET.length; i++) {
    table[ALPHABET.charCodeAt(i)] = i;
  }
  return table;
})();

/**
 * Char codes ≥128 are always invalid — looking them up on the 128-slot
 * Int8Array returns `undefined`, and `undefined < 0` is false, which
 * would let hostile input silently decode to zero bytes and bypass the
 * "invalid character" throw below.
 */
function decodeChar(charCode: number): number {
  if (charCode < 0 || charCode >= 128) return -1;
  // charCode is guaranteed in-bounds by the guard above; `?? -1` only
  // satisfies the index-access checker and never actually fires.
  return DECODE[charCode] ?? -1;
}

export function base45Encode(bytes: Uint8Array): string {
  const n = bytes.length;
  let out = '';
  let i = 0;
  // `i`/`i+1` are kept in-bounds by the loop condition, so the `?? 0`
  // fallbacks never fire; charAt() returns '' for any out-of-range index
  // (also impossible here since c0..c2 are mod-45 bounded).
  while (i + 2 <= n) {
    const v = ((bytes[i] ?? 0) << 8) | (bytes[i + 1] ?? 0);
    const c2 = Math.floor(v / 2025);
    const r = v - c2 * 2025;
    const c1 = Math.floor(r / 45);
    const c0 = r - c1 * 45;
    out += ALPHABET.charAt(c0) + ALPHABET.charAt(c1) + ALPHABET.charAt(c2);
    i += 2;
  }
  if (i < n) {
    const v = bytes[i] ?? 0;
    const c1 = Math.floor(v / 45);
    const c0 = v - c1 * 45;
    out += ALPHABET.charAt(c0) + ALPHABET.charAt(c1);
  }
  return out;
}

export function base45Decode(s: string): Uint8Array {
  const len = s.length;
  if (len === 0) return new Uint8Array(0);
  const full = Math.floor(len / 3);
  const tail = len - full * 3;
  if (tail !== 0 && tail !== 2) {
    throw new Error('base45: invalid input length');
  }
  const outLen = full * 2 + (tail === 2 ? 1 : 0);
  const out = new Uint8Array(outLen);
  for (let g = 0; g < full; g++) {
    const d0 = decodeChar(s.charCodeAt(g * 3));
    const d1 = decodeChar(s.charCodeAt(g * 3 + 1));
    const d2 = decodeChar(s.charCodeAt(g * 3 + 2));
    if (d0 < 0 || d1 < 0 || d2 < 0) {
      throw new Error('base45: invalid character');
    }
    const v = d0 + d1 * 45 + d2 * 2025;
    if (v > 0xffff) {
      throw new Error('base45: decoded group exceeds 0xFFFF');
    }
    out[g * 2] = (v >> 8) & 0xff;
    out[g * 2 + 1] = v & 0xff;
  }
  if (tail === 2) {
    const d0 = decodeChar(s.charCodeAt(full * 3));
    const d1 = decodeChar(s.charCodeAt(full * 3 + 1));
    if (d0 < 0 || d1 < 0) {
      throw new Error('base45: invalid character');
    }
    const v = d0 + d1 * 45;
    if (v > 0xff) {
      throw new Error('base45: decoded byte exceeds 0xFF');
    }
    out[outLen - 1] = v;
  }
  return out;
}
