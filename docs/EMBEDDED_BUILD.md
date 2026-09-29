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

Two checks enforce this, and both apply the same rule set. The build refuses to
emit anything else (`config/vite.config.embedded.ts`), and
`npm run check:embedded` re-reads the artifact from disk afterwards with no
shared code (`scripts/check-embedded-output.mjs`). CI runs both.

Both also assert the policy below is the one actually in the document. A CSP
rewrite that silently failed would leave `index.html`'s development policy,
which grants `default-src 'self'`; under the WebView baseUrl `'self'` is
qrlwallet.com, so that document would let the web server serve script again.

## Configuration: the profile is committed, not read from a server

The hosted builds get their `VITE_*` settings from a `.env` on the deployment
host. The embedded document is shipped inside the app, so it cannot depend on
that: a build from a clean checkout has no `.env` and the wallet silently runs
the default v2 profile. A device test of the first embedded document did
exactly this, sending `SEED_STORED` with blockchain `TEST_NET` while the native
app requires `TEST_NET_V3`, so PIN setup failed.

`src/config/embeddedProfile.ts` therefore commits the production profile, and
`config/vite.config.embedded.ts` applies it before the base config resolves the
environment. Every value is public configuration the live qrlwallet.com bundle
already publishes. Keys the application never reads are deliberately absent,
along with the DEVELOPMENT endpoints, because an unread value inlined into a
shipped document is published for no reason.

Three things keep it honest:

- `assertEmbeddedProfile` fails the build unless the resolved profile is
  `v3-private` on `TEST_NET_V3`, chain `0x301825` (3151909), genesis
  `0xd154...`.
- a second assertion checks those values are actually **in** the emitted
  document, which is the failure the device test hit: the build succeeded and
  the values never reached the bundle.
- `envExposureGuard` in the base config rejects any `VITE_` key whose name
  looks like a secret, so nothing sensitive can be added to the profile.

An environment variable set on the command line still wins, so a build can be
pointed elsewhere deliberately; the assertions then decide whether the result
is shippable.

## Reproducibility

The document contains no content hashes and no build-machine state, and the
recorded build time comes from `SOURCE_DATE_EPOCH` when set, otherwise from the
HEAD commit's own timestamp. Two builds produce byte-identical HTML when four
things match: the commit, the installed dependency tree (`npm ci` from the
committed lockfile), the `VITE_*` environment, and `EMBED_VIDEO`.

Since the profile is committed, a clean checkout needs no environment at all
and CI reproduces a developer's bytes. The environment still matters because a
machine that overrides a `VITE_*` value produces different bytes. The build
records
`connectUrls`, `csp` and `embedVideo` in the build-info block precisely so a
digest that differs for one of those reasons can be explained from the document
itself.

Given those, the digest in a release reproduces from source:

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
 "embedVideo":false,"profile":{"isV3Profile":true,"networkId":"TEST_NET_V3",
 "chainId":"0x301825","genesisHash":"0xd154..."},
 "connectUrls":[...],"csp":"...",
 "appScriptSha256":"...","appScriptBytes":...}
</script>
```

`appScriptSha256` covers the inline application script exactly as shipped: the
text between the newline after `<script type="module" id="qrl-embedded-app">`
and the newline before `</script>`. `npm run check:embedded` recomputes it from
the document and fails on a mismatch, so an auditor can verify the block
without rebuilding and without having to guess the framing.

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

- `'unsafe-inline'` rather than hashes, deliberately. The build knows the hash
  of every script it writes, but the native app injects its own scripts into
  this document and one of them carries a **per-load bridge token**, so its
  content differs on every launch and cannot be hashed at build time. Listing
  any hash makes the browser ignore `'unsafe-inline'` for scripts, which would
  block the app's injected scripts and break the bridge. A nonce needs a server
  to mint it, and there is none. What the policy has to prevent is remote
  script, and it does: `script-src` has no host source at all. Integrity of the
  inline code is covered by the document digest the app pins, which covers the
  whole document rather than one element.
- The CSP meta is the **first** thing in `<head>`, ahead of every inline
  script, because a meta policy governs only what follows it.
- `'wasm-unsafe-eval'` is required by `src/utils/crypto/argon2.ts`, which drives
  hash-wasm. `'unsafe-eval'` is deliberately absent. The bundle does contain
  three `Function(...)` call sites, none of which needs to succeed: a
  `Function("return this")` globalThis polyfill a browser never reaches, a
  `Function("" + handler)` branch of the setImmediate polyfill taken only for a
  string handler, and zod's JIT feature probe, written as
  `try { Function(""); } catch { /* interpret */ }`. The probe fails closed and
  zod falls back to its interpreted parser, logging one CSP violation the first
  time a schema is parsed. That is the policy working.
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
- **Nothing reloads the document.** `reloadDocument()` in
  `src/utils/embeddedShell.ts` is the single choke point, and
  `__QRL_EMBEDDED_BUILD__` is a build constant, so the minifier removes the
  reload branch rather than merely leaving it unreached. Dependency reload
  calls are stripped too (React Router keeps one in its route-module loader),
  and the build asserts the emitted document contains **no**
  `location.reload()` at all. The web and desktop bundles still contain theirs.

  `window.location.reload`, `.assign`, `.replace` and `location` itself are
  non-configurable own properties, so they cannot be replaced at run time:
  `Object.defineProperty` throws `Cannot redefine property`. This was measured
  in Chromium, not assumed. A page-side lock on third-party code is therefore
  not available, and the last line of defence is the **native shell refusing
  main-frame navigations after the initial load**.
- **External links go through the native bridge.** A capture-phase click
  listener, installed only in the embedded runtime, hands every external link
  to `openExternalUrl`, which sends `OPEN_URL` when the native app is present.
  One listener covers every link in the app, including ones added later, and
  root-relative hrefs too: under the WebView baseUrl those resolve to the live
  site and are just as much of an escape. `target="_blank"` would otherwise
  open in the same WebView on Android and strand the user.
- **Logout** drops the active account, the injected PIN and the cached device
  key in place. The saved PIN lockout counter is deliberately kept: clearing it
  would make logging out a way to reset the failed-attempt count.

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
