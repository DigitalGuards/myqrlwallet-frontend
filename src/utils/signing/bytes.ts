/**
 * Local hex/bytes utilities for the signing module.
 *
 * Kept module-local so the byte-for-byte SDK port can be a literal copy
 * without dragging in extra @theqrl/web3 surface.
 */

export function hexToBytes(hex: string): Uint8Array {
  if (typeof hex !== 'string') throw new Error('hex must be a string');
  if (!/^0x([0-9a-fA-F]{2})*$/.test(hex)) {
    throw new Error('hex must be 0x-prefixed even-length');
  }
  const n = (hex.length - 2) / 2;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = parseInt(hex.slice(2 + i * 2, 4 + i * 2), 16);
  }
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  if (!(bytes instanceof Uint8Array)) {
    throw new Error('bytes must be a Uint8Array');
  }
  let s = '0x';
  for (const v of bytes) s += v.toString(16).padStart(2, '0');
  return s;
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  return concatBytesArr(parts);
}

/**
 * Array-form concat for callers that build a dynamically-sized list of
 * chunks (e.g. typed-data array encoders, hashStruct). Avoids passing
 * thousands of arguments through `...spread`, which can blow the JS
 * engine's max-arguments limit and crash on adversarial inputs.
 */
export function concatBytesArr(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}
