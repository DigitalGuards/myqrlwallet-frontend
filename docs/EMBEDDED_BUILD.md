# Embedded build: the wallet the mobile app ships inside itself

`npm run build:embedded` produces two files in `dist-embedded/`:

| File | What it is |
| --- | --- |
| `index.html` | the entire wallet as one self-contained document (~3.2 MB) |
| `index.html.sha256` | `sha256sum` line for that document |

The mobile app bundles the document and hands it to its WebView with

```js
source={{ html, baseUrl: "https://qrlwallet.com/" }}
```

so the wallet runs on the qrlwallet.com origin (localStorage, IndexedDB and
relay CORS behave exactly as on the live site) while every byte of executable
code comes from the signed app binary. A compromise of the qrlwallet.com web
server can no longer push wallet code to app users; it can still serve API
responses, which the wallet already treats as untrusted input.

## What "self-contained" means

The output has no `<script src=>`, no `<link>` that fetches anything, and no
`/assets/` reference. Concretely:

- one inline `<script type="module" id="qrl-embedded-app">` holds the whole
  app, with dynamic imports inlined so nothing is chunk-loaded at runtime
- one inline `<style>` holds the whole stylesheet
- fonts and images are `data:` URIs
- the crypto Web Worker is bundled and constructed from a Blob
  (Vite `?worker&inline`)
- favicons, the web manifest, preloads, `dns-prefetch`, `preconnect` and the
  canonical link are stripped; each was a request to the origin

Two checks enforce this. The build itself refuses to emit anything else
(`config/vite.config.embedded.ts`), and `npm run check:embedded` re-reads the
artifact from disk afterwards with no shared code
(`scripts/check-embedded-output.mjs`). CI runs both.

## Reproducibility

The document contains no content hashes and no build-machine state, and the
recorded build time comes from `SOURCE_DATE_EPOCH` when set, otherwise from the
HEAD commit's own timestamp. Two builds of the same commit with the same
dependency tree therefore produce byte-identical HTML, so the digest in a
release can be reproduced from source:

```bash
git checkout <commit>
npm ci --legacy-peer-deps
npm run build:embedded
sha256sum -c dist-embedded/index.html.sha256
```

A build from a dirty working tree records its commit with a `-dirty` suffix, so
provenance is never claimed for bytes that cannot be reproduced.

## Build info

The document carries its own provenance in `<head>`:

```html
<script type="application/json" id="qrl-embedded-build-info">
{"product":"myqrlwallet-embedded","commit":"...","builtAt":"...",
 "appScriptSha256":"...","appScriptBytes":...}
</script>
```

`appScriptSha256` is the sha256 of the inline application script exactly as
shipped, so an auditor can hash the script they can read in the same file and
compare, without rebuilding.

## Content-Security-Policy

The document ships a meta CSP with no remote script source at all:

```
default-src 'none';
script-src 'unsafe-inline' 'wasm-unsafe-eval';
script-src-attr 'none';
style-src 'unsafe-inline';
font-src data:;
media-src data: blob:;
worker-src blob:;
object-src 'none'; frame-src 'none'; child-src 'none';
base-uri 'none'; form-action 'none'; manifest-src 'none';
img-src data: blob: https:;
connect-src https://qrlwallet.com https://zondscan.com wss://qrlwallet.com
```

Notes:

- `'unsafe-inline'` in `script-src` is how a static file permits its own inline
  script; there is no nonce to hand a document shipped inside an app binary.
  The property that matters is that no remote script source is allowed.
- `'wasm-unsafe-eval'` is required by `src/utils/crypto/argon2.ts`, which drives
  hash-wasm. `'unsafe-eval'` is deliberately absent: the bundle contains no
  `eval()` and no `new Function()`.
- `img-src` allows remote https images because token logos and NFT artwork come
  from URLs the wallet does not control. It is the one deliberately broad
  directive; an image cannot exfiltrate wallet state beyond the URL it is
  fetched with, and `connect-src` stays locked down.
- `connect-src` is generated from the endpoints the build was configured with
  (`src/config/embeddedBuild.ts`), so a `VITE_WALLET_PROFILE=v3-private` build
  gets its own RPC, API and explorer origins.
  The relay allowlist tracks `DEFAULT_RELAY_URL`; a test fails if they drift.
- A dApp may name a custom relay in its pairing URI (`r=<url>`). Under this
  policy only the relays listed at build time can be reached, and pairing with
  any other one fails closed. That is a deliberate narrowing for the app build.
- `frame-ancestors` is not listed: a meta CSP cannot set it. The WebView is not
  frameable, and the live site sets it at the nginx layer.

## Embedded-mode behaviour

The build writes `window.__QRL_EMBEDDED__ = true` into `<head>` ahead of the app
script. `src/utils/embeddedRuntime.ts` is the single place that reads it.

- **Routing** uses `createHashRouter`, like the desktop shell. A pushState to
  `/transfer` would make a reload fetch that path from the live server.
- **Logout** does not call `window.location.reload()`. The document is served
  by no origin, so a reload would fetch the live site and replace the audited
  bundle. It drops the active account in place instead, which is the same reset
  the native `CLEAR_WALLET` path performs.
- **Links to site files** (`security.txt`, the PGP key) are absolute
  `https://qrlwallet.com/...` URLs, so they open the live site in a browser.
  A root-relative link would resolve against a document that has no server
  behind it.

The native bridge is untouched: `window.ReactNativeWebView` postMessage and the
injected scripts work exactly as they do against the hosted wallet.

## Releasing a document for the app to pin

Push a tag matching `embedded-v*`. The `Embedded build` workflow builds, checks,
and attaches `index.html` and `index.html.sha256` to a GitHub release, which
gives the app a stable URL plus the digest it should verify.

Every pull request and every push to `main` or `dev` uploads the same two files
as a workflow artifact, so a change to the embedded output is reviewable before
it is tagged.

## Flags

| Variable | Effect |
| --- | --- |
| `EMBED_VIDEO=1` | inline the decorative home-screen video as a `data:` URI. Off by default: it is decorative, the component degrades to opacity 0 when its source fails, and inlining it nearly doubles the document. |
| `SOURCE_DATE_EPOCH` | Unix seconds recorded as the build time, in place of the commit timestamp. |
