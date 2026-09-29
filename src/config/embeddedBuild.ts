/**
 * Pure helpers for the embedded (app-shipped) single-file build.
 *
 * This module is build-time only: `config/vite.config.embedded.ts` imports it,
 * no application module does, so none of it reaches the bundle. It lives under
 * `src/` so the repo's `tsc` run and eslint cover it and so jest can test it
 * (`config/` is checked by neither today).
 *
 * Everything here is deliberately free of `node:` imports and of filesystem or
 * process access, which is what makes it testable.
 */

/** Content-Security-Policy directives that never depend on configuration. */
const STATIC_CSP_DIRECTIVES: readonly string[] = [
  // Nothing loads by default. Every allowance below is deliberate.
  "default-src 'none'",
  // The only script in the document is the inline one this build writes plus
  // the one-line <head> flag. There is no nonce to hand a static file shipped
  // inside an app binary, so 'unsafe-inline' is how an inline script is
  // permitted. There is no remote script source at all, which is the property
  // that actually matters here.
  //
  // 'wasm-unsafe-eval' is required: src/utils/crypto/argon2.ts drives
  // hash-wasm, which calls WebAssembly.instantiate.
  //
  // 'unsafe-eval' is deliberately absent. The bundle does contain three
  // `Function(...)` call sites, none of which needs to succeed: a
  // `Function("return this")` globalThis polyfill that a browser never
  // reaches, a `Function("" + handler)` branch of the setImmediate polyfill
  // that is only taken for a string handler, and zod's JIT feature probe,
  // which is written as `try { Function(""); } catch { /* interpret */ }` and
  // falls back to its interpreted parser when the policy blocks it. The probe
  // logs one CSP violation the first time a schema is parsed; that is the
  // policy working.
  "script-src 'unsafe-inline' 'wasm-unsafe-eval'",
  // Inline event-handler attributes stay banned even though inline <script>
  // blocks are allowed.
  "script-src-attr 'none'",
  // One inline <style> holds the whole stylesheet, and React writes inline
  // style attributes.
  "style-src 'unsafe-inline'",
  // Fonts are inlined as data: URIs; nothing is fetched.
  "font-src data:",
  // The decorative home-screen video is a data: URI, and QR/canvas work
  // produces blob: URLs.
  "media-src data: blob:",
  // The crypto worker is constructed from a Blob (Vite `?worker&inline`).
  "worker-src blob:",
  "object-src 'none'",
  "frame-src 'none'",
  "child-src 'none'",
  // No <base> may retarget relative URLs, and no form may post anywhere.
  "base-uri 'none'",
  "form-action 'none'",
  "manifest-src 'none'",
];

/**
 * Images: token logos and NFT artwork come from URLs the wallet does not
 * control (contract metadata, IPFS gateways), so remote https images have to
 * be allowed. An image source cannot exfiltrate wallet state beyond the URL it
 * is fetched with, and connect-src stays locked down, so this is the one
 * deliberately broad directive.
 */
const IMG_SRC_DIRECTIVE = "img-src data: blob: https:";

/**
 * Relays the embedded document may reach.
 *
 * This must stay in step with `DEFAULT_RELAY_URL` in
 * `src/services/dappConnect/DAppConnectService.ts`; a test asserts it does.
 * The value is duplicated here because importing the service would drag the
 * whole dApp-connect stack into the build config.
 */
export const EMBEDDED_RELAY_URLS: readonly string[] = ["https://qrlwallet.com"];

/** The origin of an absolute http(s) URL, or null when it is not one. */
export function toHttpOrigin(value: string | undefined | null): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

/** The `wss://` origin matching an `https://` one, or null otherwise. */
export function toSecureWebSocketOrigin(
  value: string | undefined | null,
): string | null {
  const origin = toHttpOrigin(value);
  if (origin === null || !origin.startsWith("https://")) return null;
  return `wss://${origin.slice("https://".length)}`;
}

export interface EmbeddedCspInput {
  /** Absolute http(s) URLs the wallet calls: RPC proxy, API, explorer. */
  readonly connectUrls: readonly (string | undefined | null)[];
  /** Absolute https URLs of socket.io relays (both transports are allowed). */
  readonly relayUrls: readonly (string | undefined | null)[];
}

/**
 * Build the embedded document's CSP from the endpoints this build was
 * configured with, so a build for a different deployment profile cannot end up
 * with a connect-src that silently blocks its own RPC.
 *
 * The result is intentionally an allowlist of origins. A dApp may name a
 * custom relay in its pairing URI (`r=<url>`); under this policy only the
 * relays listed at build time can be reached, and pairing with any other one
 * fails closed. That is a deliberate narrowing for the app-shipped build.
 */
export function buildEmbeddedCsp(input: EmbeddedCspInput): string {
  const connect = new Set<string>();
  for (const url of input.connectUrls) {
    const origin = toHttpOrigin(url);
    if (origin !== null) connect.add(origin);
  }
  for (const url of input.relayUrls) {
    const origin = toHttpOrigin(url);
    if (origin !== null) connect.add(origin);
    const wss = toSecureWebSocketOrigin(url);
    if (wss !== null) connect.add(wss);
  }
  if (connect.size === 0) {
    throw new Error(
      "embedded build: refusing to emit a CSP with an empty connect-src",
    );
  }
  const sorted = [...connect].sort();
  return [
    ...STATIC_CSP_DIRECTIVES,
    IMG_SRC_DIRECTIVE,
    `connect-src ${sorted.join(" ")}`,
  ].join("; ");
}

/**
 * Rewrite a `?worker` import specifier to `?worker&inline`.
 *
 * `src/utils/crypto/cryptoWorkerClient.ts` imports `./cryptoWorker?worker`.
 * Plain `?worker` emits a separate .js file and constructs the worker from its
 * URL, which under the embedded baseUrl would be a fetch against the live
 * server. `?worker&inline` makes Vite bundle the worker into the main chunk
 * and construct it from a Blob. Returns null for specifiers to leave alone.
 */
export function inlineWorkerSpecifier(source: string): string | null {
  if (!source.endsWith("?worker")) return null;
  return `${source}&inline`;
}

/**
 * Remove the bodies of inline <script> and <style> elements so markup scans
 * cannot trip over minified JavaScript that happens to contain tag-like text
 * (React's own error messages build `<link rel=...>` strings, for example).
 */
function stripInlineBodies(html: string): string {
  return html
    .replace(/(<script\b[^>]*>)[\s\S]*?(<\/script\s*>)/gi, "$1$2")
    .replace(/(<style\b[^>]*>)[\s\S]*?(<\/style\s*>)/gi, "$1$2");
}

const ALLOWED_URL_SCHEMES = /^(?:https:|data:|mailto:|blob:|#)/i;

/**
 * Structural checks on the document's Content-Security-Policy.
 *
 * These deliberately assert no exact policy string, so they hold for any
 * deployment profile and catch the failure that matters: the build silently
 * keeping index.html's development policy, which grants `default-src 'self'`
 * and localhost. Under the WebView baseUrl `'self'` IS qrlwallet.com, so that
 * document would let the web server serve script again, which is the single
 * thing this build exists to prevent.
 */
export function findEmbeddedCspViolations(html: string): string[] {
  const markup = stripInlineBodies(html);
  const metas = [
    ...markup.matchAll(
      /<meta\b[^>]*http-equiv\s*=\s*["']?Content-Security-Policy["']?[^>]*>/gi,
    ),
  ].map((match) => match[0]);

  if (metas.length !== 1) {
    return [`expected exactly one CSP meta, found ${metas.length}`];
  }
  const meta = metas[0] ?? "";
  const violations: string[] = [];
  if (!/default-src\s+'none'/i.test(meta)) {
    violations.push("the CSP does not start from default-src 'none'");
  }
  for (const forbidden of ["'self'", "'unsafe-eval'", "http://", "ws://"]) {
    if (meta.includes(forbidden)) {
      violations.push(`the CSP still allows ${forbidden}`);
    }
  }
  if (!/script-src\s[^;"]*'unsafe-inline'/i.test(meta)) {
    violations.push("the CSP has no script-src for the inline application");
  }
  if (/script-src\s[^;"]*https:/i.test(meta)) {
    violations.push("the CSP allows a remote script source");
  }
  return violations;
}

/**
 * The inline stylesheet may reference nothing but data: URIs. A bare
 * `url(/tree.svg)` is invisible to the markup scan (style bodies are stripped)
 * and to the public-asset scan (which matches quoted literals), so it gets its
 * own pass.
 */
function findStyleViolations(html: string): string[] {
  const violations: string[] = [];
  for (const block of html.matchAll(
    /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi,
  )) {
    const css = block[1] ?? "";
    if (/@import/i.test(css)) violations.push("the stylesheet uses @import");
    // A quoted value is consumed whole, so a `url(#id)` reference nested
    // inside a percent-encoded data: SVG is skipped along with the data URI
    // that contains it. Matching `[^)]*` instead would stop at that inner
    // bracket and report the fragment as a remote fetch.
    for (const reference of css.matchAll(
      /url\(\s*(?:"([^"]*)"|'([^']*)'|([^"')\s]*))\s*\)/gi,
    )) {
      const value = (reference[1] ?? reference[2] ?? reference[3] ?? "").trim();
      if (value.length === 0 || /^(?:data:|#)/i.test(value)) continue;
      violations.push(`the stylesheet fetches ${value}`);
    }
  }
  return violations;
}

/**
 * Every way the emitted document could still reach the network for code or
 * assets. A non-empty result must fail the build: shipping a half-embedded
 * document would silently restore the dependency on the live web server that
 * this build exists to remove.
 */
export function findEmbeddedHtmlViolations(html: string): string[] {
  const markup = stripInlineBodies(html);
  const violations: string[] = [];

  for (const match of markup.matchAll(/<script\b[^>]*\bsrc\s*=/gi)) {
    violations.push(`<script> with a src attribute: ${match[0]}`);
  }

  for (const match of markup.matchAll(
    /<link\b[^>]*\brel\s*=\s*["']?(stylesheet|modulepreload|preload|prefetch|manifest|icon|apple-touch-icon)["']?[^>]*>/gi,
  )) {
    violations.push(`fetching <link>: ${match[0]}`);
  }

  // Unquoted attribute values are matched too. Vite does not minify HTML
  // today, so nothing produces them, and a scan that only understood quoted
  // values would wave through `<img src=/tree.svg>` if that ever changed.
  for (const match of markup.matchAll(
    /\b(?:src|href|srcset|poster)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi,
  )) {
    const value = match[1] ?? match[2] ?? match[3] ?? "";
    if (value.length === 0) continue;
    if (ALLOWED_URL_SCHEMES.test(value)) continue;
    violations.push(`document-relative URL: ${match[0]}`);
  }

  if (markup.includes("/assets/")) {
    violations.push("markup references /assets/");
  }

  violations.push(...findStyleViolations(html));
  violations.push(...findEmbeddedCspViolations(html));

  return violations;
}
