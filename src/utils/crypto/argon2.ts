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

// Test seam only: forces the pure-JS path so both implementations get covered.
let forceJsForTests = false;
// Warn once per worker/module instance so the slow path is diagnosable
// without spamming the console on every retry.
let warnedWasmFallback = false;

export async function deriveArgon2id(
  passwordBytes: Uint8Array,
  saltBytes: Uint8Array,
  params: Argon2idParams,
): Promise<Uint8Array<ArrayBuffer>> {
  if (!forceJsForTests) {
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
    } catch (error) {
      // No permanent latch: a failure here can be transient (memory pressure
      // on a large-m keystore) or input-specific, so WASM is retried on the
      // next call; only genuinely unavailable WASM (e.g. CSP without
      // 'wasm-unsafe-eval') pays a cheap failed attempt each time. The
      // extension's reference implementation behaves the same way.
      if (!warnedWasmFallback) {
        warnedWasmFallback = true;
        console.warn(
          'argon2: hash-wasm failed, falling back to the slower pure-JS implementation',
          error,
        );
      }
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
  forceJsForTests = value;
}
