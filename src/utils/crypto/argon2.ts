/**
 * Argon2id key derivation for extension-keystore compatibility.
 *
 * Primary path is hash-wasm (WASM, roughly 10x faster; the browser extension
 * uses the same library so outputs are byte-identical by construction).
 * WASM compilation is blocked by a Content-Security-Policy without
 * 'wasm-unsafe-eval', so a pure-JS @noble/hashes implementation is kept as a
 * fallback; the parity test asserts both produce identical bytes.
 */
import { argon2id as argon2idWasm } from 'hash-wasm';
import { argon2id as argon2idJs } from '@noble/hashes/argon2.js';

export interface Argon2idParams {
  /** Memory cost in KiB */
  m: number;
  /** Iterations (time cost) */
  t: number;
  /** Parallelism lanes */
  p: number;
  /** Derived key length in bytes */
  dklen: number;
}

// Once WASM fails (CSP, unsupported engine) stop retrying it for the session.
let wasmUnavailable = false;

export async function deriveArgon2id(
  passwordBytes: Uint8Array,
  saltBytes: Uint8Array,
  params: Argon2idParams,
): Promise<Uint8Array<ArrayBuffer>> {
  if (!wasmUnavailable) {
    try {
      const derived = await argon2idWasm({
        password: passwordBytes,
        salt: saltBytes,
        iterations: params.t,
        memorySize: params.m,
        parallelism: params.p,
        hashLength: params.dklen,
        outputType: 'binary',
      });
      return new Uint8Array(derived);
    } catch {
      wasmUnavailable = true;
    }
  }
  const derived = argon2idJs(passwordBytes, saltBytes, {
    t: params.t,
    m: params.m,
    p: params.p,
    dkLen: params.dklen,
  });
  return new Uint8Array(derived);
}

/** Test seam: force/observe the fallback path. Not for production use. */
export function _setWasmUnavailableForTests(value: boolean): void {
  wasmUnavailable = value;
}
