/**
 * Turn off zod's JIT validator compilation, globally.
 *
 * zod v4 compiles a fast object validator with the `Function` constructor when
 * it believes eval is available, and it decides by probing:
 * `try { new Function(""); } catch { ... }` (zod/v4/core/util `allowsEval`).
 *
 * No deployment of this wallet allows that probe to succeed. The web build's
 * policy is `script-src 'self' 'wasm-unsafe-eval' 'sha256-...'` in
 * deploy/nginx.conf and in index.html, and the embedded document's policy is
 * script hashes plus 'wasm-unsafe-eval'. None of them carries 'unsafe-eval',
 * so the probe has always thrown and zod has always fallen back to its
 * interpreted parser. What the probe did produce was a CSP violation report on
 * the first schema parse, which is noise in the console and in any report-uri
 * collection, and which reads like a real finding to anyone auditing the
 * embedded document.
 *
 * Setting `jitless` states the fact instead of discovering it. In
 * zod/v4/core/schemas the flag is read as `const jit = !globalConfig.jitless`
 * and then `jit && allowsEval.value`, so with jitless the probe is never
 * evaluated at all. Validation behaviour is identical; only the compiled fast
 * path is skipped, and it was already unreachable.
 *
 * This has to run before any schema is created, because that `&&` is evaluated
 * when a schema's parser is built. `main.tsx` imports it first.
 */
import { config } from "zod";

config({ jitless: true });
