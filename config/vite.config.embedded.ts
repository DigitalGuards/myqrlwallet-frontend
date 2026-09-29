/**
 * Embedded single-file build: the wallet the mobile app ships inside itself.
 *
 * Goal: produce ONE self-contained `dist-embedded/index.html` that the app
 * bundles and hands to its WebView via
 * `source={{ html, baseUrl: "https://qrlwallet.com/" }}`. The wallet then runs
 * on the qrlwallet.com origin (so localStorage, IndexedDB and relay CORS keep
 * working) while every byte of executable code comes from the signed app
 * binary. A compromise of the qrlwallet.com web server can no longer push
 * wallet code to app users.
 *
 * This config EXTENDS `vite.config.ts`. The normal web build and the desktop
 * build (`VITE_DESKTOP=1`) call the base config directly and are untouched by
 * anything here.
 *
 * What "self-contained" means concretely for the output:
 *   - one inline <script type="module"> holding the whole app (dynamic imports
 *     inlined, so no runtime chunk loading)
 *   - one inline <style> holding the whole stylesheet
 *   - fonts and images as data: URIs
 *   - the crypto Web Worker inlined (Vite `?worker&inline` -> blob worker)
 *   - no <script src=>, no fetching <link>, no /assets/ reference
 * `assertSelfContained()` fails the build if any of that stops holding.
 *
 * Reproducibility: the output carries no content hashes and no build machine
 * state, and the recorded build time comes from SOURCE_DATE_EPOCH or, failing
 * that, the HEAD commit's own timestamp. Two builds of the same commit with
 * the same dependency tree therefore produce byte-identical HTML, which is
 * what makes `index.html.sha256` worth pinning in the app.
 *
 * Flags:
 *   EMBED_VIDEO=1       also inline the 1.4 MB decorative home-screen video as
 *                       a data: URI. Off by default: the video is decorative,
 *                       the component already degrades to opacity 0 when its
 *                       source fails, and inlining it nearly doubles the HTML.
 *   SOURCE_DATE_EPOCH   Unix seconds recorded as the build time.
 */
import { defineConfig, loadEnv, type Plugin, type PluginOption } from 'vite'
import path from 'path'
import fs from 'fs'
import { createHash } from 'crypto'
import { execFileSync } from 'child_process'
import baseConfigFactory from './vite.config'
import {
  EMBEDDED_RELAY_URLS,
  buildEmbeddedCsp,
  findEmbeddedHtmlViolations,
  inlineWorkerSpecifier,
} from '../src/config/embeddedBuild'
import { v3Deployment } from '../src/config/deploymentProfile'
import {
  EMBEDDED_PROFILE_ENV,
  assertEmbeddedProfile,
  type EmbeddedResolvedProfile,
} from '../src/config/embeddedProfile'
import { EMBEDDED_FLAG_SCRIPT } from '../src/utils/embeddedRuntime'

const projectRoot = path.resolve(__dirname, '..')
const publicDir = path.join(projectRoot, 'public')

const EMBED_VIDEO = process.env.EMBED_VIDEO === '1'
const EMBEDDED_OUT_DIR = 'dist-embedded'
const APP_SCRIPT_ID = 'qrl-embedded-app'
const BUILD_INFO_ID = 'qrl-embedded-build-info'

const MIME_BY_EXT: Record<string, string> = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
}

const toDataUri = (absolutePath: string): string => {
  const ext = path.extname(absolutePath).toLowerCase()
  const mime = MIME_BY_EXT[ext] ?? 'application/octet-stream'
  // base64 for everything, including SVG: it is smaller than percent-encoding
  // for this content and contains no quote characters, so the result is safe to
  // substitute into a single-quoted, double-quoted or template string literal.
  const bytes = fs.readFileSync(absolutePath)
  return `data:${mime};base64,${bytes.toString('base64')}`
}

const sha256Hex = (value: string | Buffer): string =>
  createHash('sha256').update(value).digest('hex')

const git = (args: string[]): string | null => {
  try {
    return execFileSync('git', args, { cwd: projectRoot, encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}

/**
 * What commit this document was built from, and when.
 *
 * The timestamp is taken from SOURCE_DATE_EPOCH when set, otherwise from the
 * HEAD commit itself, so repeating a build of the same commit repeats the
 * bytes. A dirty working tree is recorded as such: the build is then not
 * reproducible from the commit alone, and the output says so.
 */
const resolveBuildProvenance = (): { commit: string; builtAt: string } => {
  const head = git(['rev-parse', 'HEAD'])
  const dirty = git(['status', '--porcelain']) !== ''
  const commit = head === null ? 'unknown' : dirty ? `${head}-dirty` : head

  const fromEnv = Number.parseInt(process.env.SOURCE_DATE_EPOCH ?? '', 10)
  const fromCommit = Number.parseInt(git(['log', '-1', '--format=%ct']) ?? '', 10)
  const seconds = Number.isFinite(fromEnv)
    ? fromEnv
    : Number.isFinite(fromCommit)
      ? fromCommit
      : Math.floor(Date.now() / 1000)

  return { commit, builtAt: new Date(seconds * 1000).toISOString() }
}

/**
 * `src/utils/crypto/cryptoWorkerClient.ts` imports `./cryptoWorker?worker`.
 * Vite's `?worker` emits a separate .js file and constructs the worker from
 * its URL, which would be a remote fetch under the embedded baseUrl. Rewriting
 * the specifier to `?worker&inline` makes Vite bundle the worker into the main
 * chunk and construct it from a Blob instead. Only this config does it, so the
 * web and desktop builds still get the separate worker file.
 */
const inlineWorkerImports = (): Plugin => ({
  name: 'embedded-inline-worker-imports',
  enforce: 'pre',
  async resolveId(source, importer, options) {
    const inlined = inlineWorkerSpecifier(source)
    if (inlined === null) return null
    return this.resolve(inlined, importer, options)
  },
})

/**
 * Remove `window.location.reload()` from dependency code.
 *
 * Our own reload is compiled out by the `__QRL_EMBEDDED_BUILD__` constant, but
 * a dependency's is not. React Router keeps one in its route-module loader: if
 * a lazy module fails to load it reloads the document, which in this build
 * would fetch the live site over the app-shipped wallet. That path is already
 * unreachable here (dynamic imports are inlined, so no module can fail to
 * load, and it belongs to framework mode which this app does not use), and
 * `window.location.reload` cannot be replaced at run time: it is a
 * non-configurable own property and `Object.defineProperty` throws. So it is
 * removed at build time instead, and `assertSelfContained` then requires the
 * emitted document to contain no reload call whatsoever.
 */
const stripDependencyReloads = (): Plugin => {
  let stripped = 0
  return {
    name: 'embedded-strip-dependency-reloads',
    transform(code, id) {
      if (!id.includes('node_modules')) return null
      if (!code.includes('location.reload(')) return null
      const next = code.replace(
        /(?:window|globalThis|self)?\.?location\.reload\(\s*\)/g,
        '(void 0)'
      )
      if (next === code) return null
      stripped += 1
      return { code: next, map: null }
    },
    buildEnd() {
      if (stripped === 0) {
        // Not fatal: a dependency upgrade may legitimately remove the call.
        // Said out loud so it is not mistaken for the plugin silently failing.
        console.log('embedded build: no dependency reload calls needed stripping')
      }
    },
  }
}

/**
 * `publicDir` is disabled for this build, so anything referenced by a literal
 * absolute path (`"/tree.svg"`, `"/qrl-video-dark.mp4"`) would resolve against
 * the WebView baseUrl and be fetched from the live server. Replace those
 * literals with data: URIs. Each entry is asserted to exist so a renamed asset
 * fails the build. A renamed one would otherwise go remote in silence.
 *
 * This is a `transform` hook, so it runs on the source before the minifier
 * rewrites string literals into backticks. Matching minified output instead
 * would be quote-style dependent and silently miss.
 */
const inlinePublicAssetLiterals = (): Plugin => {
  const replacements: Array<{ literal: string; value: string }> = []
  const add = (publicPath: string, value?: string) => {
    const absolutePath = path.join(publicDir, publicPath.replace(/^\//, ''))
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`embedded build: public asset ${publicPath} is missing`)
    }
    replacements.push({ literal: publicPath, value: value ?? toDataUri(absolutePath) })
  }
  add('/tree.svg')
  // `data:,` is a valid empty resource: the <video> fires `error`, the
  // component's handler leaves the layer at opacity 0, and nothing is fetched.
  add('/qrl-video-dark.mp4', EMBED_VIDEO ? undefined : 'data:,')

  return {
    name: 'embedded-inline-public-asset-literals',
    enforce: 'pre',
    transform(code, id) {
      if (!/\.(tsx?|jsx?|css)$/.test(id.split('?')[0] ?? '')) return null
      let next = code
      for (const { literal, value } of replacements) {
        for (const quote of ['"', "'", '`']) {
          next = next.split(`${quote}${literal}${quote}`).join(`${quote}${value}${quote}`)
        }
      }
      return next === code ? null : { code: next, map: null }
    },
  }
}

/**
 * Compile the embedded document with its own committed production profile.
 *
 * The hosted builds read a `.env` on the deployment host. A build from a clean
 * checkout has none, and the wallet then runs the default v2 profile: a device
 * test of the first embedded document sent `SEED_STORED` with blockchain
 * `TEST_NET` while the native app requires `TEST_NET_V3`, and PIN setup failed.
 * The app-shipped document cannot depend on a file that lives on a server, so
 * the profile is committed and applied here.
 *
 * These are written into `process.env` before the base config runs, because
 * that is where Vite reads VITE_ variables from when it resolves the
 * environment, which is also what produces the `__QRL_WALLET_PROFILE__` define
 * the runtime profile flag reads. An existing value is left alone so a build
 * can still be pointed somewhere else deliberately; `assertEmbeddedProfile`
 * then decides whether the result is shippable.
 */
const applyEmbeddedProfileEnv = (): void => {
  // A VITE_ variable already in the environment is a mismatch, not an
  // override. The document is shipped inside the app, so "build it against
  // something else" is never what is wanted here, and an injected
  // VITE_V3_RPC_URL would silently repoint the wallet's RPC.
  const conflicts: string[] = []
  for (const key of Object.keys(process.env)) {
    if (!key.startsWith('VITE_')) continue
    const expected = EMBEDDED_PROFILE_ENV[key]
    const actual = process.env[key]
    if (actual === undefined || actual === '') continue
    if (expected === undefined) {
      conflicts.push(`${key} is set but is not part of the embedded profile`)
    } else if (actual !== expected) {
      conflicts.push(`${key} is set to a value the embedded profile does not use`)
    }
  }
  if (conflicts.length > 0) {
    throw new Error(
      `embedded build: the environment would override the shipped profile:\n  ${conflicts.join('\n  ')}\n` +
        'Unset these and rebuild; the profile lives in src/config/embeddedProfile.ts.'
    )
  }
  for (const [key, value] of Object.entries(EMBEDDED_PROFILE_ENV)) {
    process.env[key] = value
  }
}

/**
 * Every endpoint this build is configured to talk to, so connect-src matches
 * the deployment. A v3-profile build reaches a
 * different RPC, API and explorer, and would otherwise ship a CSP that blocks
 * its own traffic.
 */
const resolveEmbeddedDeployment = (mode: string) => {
  const env = loadEnv(mode, projectRoot, 'VITE_')
  const isV3Profile = (env['VITE_WALLET_PROFILE'] ?? '') === 'v3-private'

  if (isV3Profile) {
    const deployment = v3Deployment(env)
    return {
      profile: {
        isV3Profile,
        networkId: deployment.network.id,
        chainId: deployment.network.expectedChainId ?? '',
        genesisHash: deployment.network.genesisHash ?? '',
        rpcUrl: deployment.network.url,
        serverUrl: deployment.serverUrl,
        explorerUrl: deployment.network.explorer,
      },
      connectUrls: [
        deployment.network.url,
        deployment.serverUrl,
        deployment.network.explorer,
      ],
    }
  }

  // Same defaults as src/config/networks.ts. The embedded document is always a
  // production build, so the DEVELOPMENT endpoints are deliberately excluded.
  // assertEmbeddedProfile rejects this branch: it is reached only when the
  // profile failed to apply, which is the v2 fallback the device test hit.
  return {
    profile: {
      isV3Profile,
      networkId: '',
      chainId: '',
      genesisHash: '',
      rpcUrl: '',
      serverUrl: '',
      explorerUrl: '',
    },
    connectUrls: [
      env['VITE_RPC_URL_PRODUCTION'] || 'https://qrlwallet.com/api/qrl-rpc',
      env['VITE_SERVER_URL_PRODUCTION'] || 'https://qrlwallet.com/api',
      env['VITE_EXPLORER_URL_PRODUCTION'] || 'https://zondscan.com',
    ],
  }
}

/**
 * Insert markup directly after the document's <head> open tag.
 *
 * Everything this build adds to <head> goes in here rather than before
 * `</head>`. Once the 2.6 MB application script is inlined, the document
 * contains raw tag-like text inside that script (the minified bundle really
 * does hold `<body>` and `<link` byte sequences), so anchoring on a closing
 * tag risks splicing markup into the middle of the code. `<head>` is the
 * first tag in the document and cannot be preceded by script content.
 */
const insertIntoHead = (html: string, markup: string): string => {
  const index = html.indexOf('<head>')
  if (index === -1) throw new Error('embedded build: index.html has no <head>')
  const at = index + '<head>'.length
  return `${html.slice(0, at)}\n${markup}${html.slice(at)}`
}

/**
 * Rewrite index.html for the embedded target:
 *   - swap the CSP meta for the embedded one, and fail if that did not happen.
 *     A silent miss would ship index.html's development policy, which grants
 *     `default-src 'self'`; under the WebView baseUrl `'self'` is
 *     qrlwallet.com, so the web server could serve script again.
 *   - set the embedded runtime flag before the app script, so the router picks
 *     hash routing before the first navigation
 *   - drop every <link> that would fetch from the origin (favicons, manifest,
 *     preloads, dns-prefetch, preconnect, canonical). They are cosmetic in a
 *     WebView and each one is a live request to the server this build exists
 *     to stop depending on.
 */
const rewriteEmbeddedHtml = (csp: string): Plugin => ({
  name: 'embedded-rewrite-html',
  enforce: 'post',
  transformIndexHtml: {
    order: 'post',
    handler(html: string) {
      const embeddedMeta = `<meta http-equiv="Content-Security-Policy" content="${csp}" />`
      // `<link\b[^>]*>` stops at the first `>`, so a tag written without the
      // self-closing slash cannot make the match run on to the next one and
      // delete everything in between. `rel` is matched anywhere in the tag.
      const stripped = html
        .replace(
          /[ \t]*<meta\b[^>]*http-equiv\s*=\s*["']?Content-Security-Policy["']?[^>]*>\n?/gi,
          ''
        )
        .replace(
          /[ \t]*<link\b(?=[^>]*\brel\s*=\s*["']?(?:icon|apple-touch-icon|manifest|preload|preconnect|dns-prefetch|canonical)\b)[^>]*>\n?/gi,
          ''
        )
      if (/Content-Security-Policy/i.test(stripped)) {
        throw new Error('embedded build: a Content-Security-Policy meta survived the rewrite')
      }
      // The policy goes in FIRST, so it precedes every inline script in the
      // document. A meta CSP governs only what follows it, so a flag script
      // placed above it would run unpoliced.
      const rewritten = insertIntoHead(
        stripped,
        `    ${embeddedMeta}\n    <script>${EMBEDDED_FLAG_SCRIPT}</script>\n`
      )
      if (!rewritten.includes(embeddedMeta)) {
        throw new Error('embedded build: the Content-Security-Policy meta was not written')
      }
      return rewritten
    },
  },
})

/**
 * Nothing in the emitted document may still reach the network for code or for
 * an asset, and nothing may still point at a file under public/ by its
 * root-relative path. Either would quietly reinstate the dependency on the
 * live web server, which is the whole thing this build removes, so both fail
 * the build loudly.
 *
 * The public-asset scan matches quoted string literals in the minified bundle,
 * so visible UI text that happens to read like a path (a link labelled
 * "/pgp-key.txt") also trips it. That is the intended trade: the check cannot
 * tell a fetched URL from a label, and erring towards a build failure is what
 * keeps it worth having. Write such labels without the leading slash.
 */
/**
 * The profile has to be IN the document, not merely resolved while building it.
 *
 * `assertEmbeddedProfile` checks what the config resolved. This checks what
 * actually shipped, which is the failure the device test hit: the build
 * succeeded and the document ran the default v2 profile because the values
 * never reached the bundle.
 */
const assertProfileInDocument = (
  html: string,
  profile: EmbeddedResolvedProfile
): string[] => {
  const missing: string[] = []
  for (const [label, needle] of [
    ['the v3 profile selector', 'v3-private'],
    ['the v3 network id', profile.networkId],
    ['the v3 chain id', profile.chainId],
    ['the v3 genesis hash', profile.genesisHash],
  ] as const) {
    if (needle.length === 0 || !html.includes(needle)) {
      missing.push(`the document does not carry ${label} (${needle || 'unset'})`)
    }
  }
  return missing
}

const assertSelfContained = (
  html: string,
  csp: string,
  profile: EmbeddedResolvedProfile
) => {
  const violations = findEmbeddedHtmlViolations(html)
  violations.push(...assertProfileInDocument(html, profile))

  // Nothing in the shipped document may reload it. Ours is compiled out by
  // __QRL_EMBEDDED_BUILD__ and dependencies' are stripped above, so any
  // remaining call is a regression, whoever introduced it.
  const reloadCalls = (html.match(/location\s*\.\s*reload\s*\(/g) ?? []).length
  if (reloadCalls > 0) {
    violations.push(
      `the document contains ${reloadCalls} location.reload() call(s); a reload would fetch the live site over the shipped wallet`
    )
  }

  // findEmbeddedHtmlViolations checks the policy structurally (one meta, no
  // 'self', no 'unsafe-eval', no remote script source). This pins it to the
  // exact policy this build generated, so a partially rewritten meta cannot
  // pass by looking plausible.
  if (!html.includes(`content="${csp}"`)) {
    violations.push('the emitted CSP is not the policy this build generated')
  }

  const walkPublic = (dir: string, prefix: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const relative = `${prefix}/${entry.name}`
      if (entry.isDirectory()) {
        walkPublic(path.join(dir, entry.name), relative)
        continue
      }
      for (const quote of ['"', "'", '`']) {
        if (html.includes(`${quote}${relative}${quote}`)) {
          violations.push(`bundle still references the public asset ${relative}`)
          break
        }
      }
    }
  }
  walkPublic(publicDir, '')

  if (violations.length > 0) {
    throw new Error(`embedded build is not self-contained:\n  ${violations.join('\n  ')}`)
  }
}

/**
 * Fold every emitted JS and CSS asset into index.html, record what was built,
 * and delete everything else from the output directory, so `dist-embedded/`
 * contains exactly `index.html` and its `index.html.sha256`.
 *
 * This runs on disk in `closeBundle`. Deleting entries from the rolldown bundle
 * object in `generateBundle` leaves the files rolldown has already scheduled
 * for writing.
 */
const emitSingleFile = (
  outDir: string,
  csp: string,
  connectUrls: string[],
  profile: EmbeddedResolvedProfile
): Plugin => ({
  name: 'embedded-single-file',
  enforce: 'post',
  closeBundle() {
    const htmlPath = path.join(outDir, 'index.html')
    if (!fs.existsSync(htmlPath)) throw new Error('embedded build: index.html was not emitted')

    let html = fs.readFileSync(htmlPath, 'utf8')
    const consumed = new Set<string>()

    const resolveHref = (href: string) => {
      if (/^[a-z]+:/i.test(href)) return null
      const filePath = path.join(outDir, href.replace(/^[./]*/, ''))
      return fs.existsSync(filePath) ? filePath : null
    }

    // modulepreload hints point at chunks that no longer exist once dynamic
    // imports are inlined.
    html = html.replace(/[ \t]*<link[^>]*rel="modulepreload"[^>]*>\n?/g, '')

    // Exactly one application script is expected. Two would leave
    // `appScriptSha256` describing only the last one, so the provenance block
    // would quietly cover a fraction of the shipped code.
    const inlinedScripts: string[] = []
    html = html.replace(
      /[ \t]*<script[^>]*\ssrc\s*=\s*["']([^"']+)["'][^>]*><\/script>/gi,
      (match, href: string) => {
        const filePath = resolveHref(href)
        if (!filePath) return match
        consumed.add(filePath)
        // `</script>` inside a string literal would end the inline script tag.
        const code = fs.readFileSync(filePath, 'utf8').split('</script').join('<\\/script')
        inlinedScripts.push(code)
        return `<script type="module" id="${APP_SCRIPT_ID}">\n${code}\n</script>`
      }
    )
    if (inlinedScripts.length !== 1) {
      throw new Error(
        `embedded build: expected exactly one application script, inlined ${inlinedScripts.length}`
      )
    }
    const appScript = inlinedScripts[0] ?? ''

    html = html.replace(
      /[ \t]*<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g,
      (match, href: string) => {
        const filePath = resolveHref(href)
        if (!filePath) return match
        consumed.add(filePath)
        const css = fs.readFileSync(filePath, 'utf8')
        // An inline <style> ends at the first `</style`, wherever it appears.
        if (/<\/style/i.test(css)) {
          throw new Error('embedded build: stylesheet contains a literal </style')
        }
        return `<style>\n${css}\n</style>`
      }
    )

    // Provenance, written last so it covers the script exactly as shipped. An
    // auditor can rebuild the commit, diff the bytes, and check this block
    // against the script it can read in the same file.
    //
    // `connectUrls` and `embedVideo` are recorded because the commit alone
    // does not fix the output: both come from the build environment, and a
    // digest that differs for one of these reasons should be explainable from
    // the document itself.
    const { commit, builtAt } = resolveBuildProvenance()
    const buildInfo = {
      product: 'myqrlwallet-embedded',
      commit,
      builtAt,
      embedVideo: EMBED_VIDEO,
      profile,
      connectUrls,
      csp,
      // Hashed over the script text exactly as written between the newlines
      // that follow `<script ...>` and precede `</script>`.
      appScriptSha256: sha256Hex(appScript),
      appScriptBytes: Buffer.byteLength(appScript),
    }
    // After the CSP meta, which insertIntoHead placed at the top of <head>.
    html = html.replace(
      `<script>${EMBEDDED_FLAG_SCRIPT}</script>\n`,
      `<script>${EMBEDDED_FLAG_SCRIPT}</script>\n` +
        `    <script type="application/json" id="${BUILD_INFO_ID}">${JSON.stringify(buildInfo)}</script>\n`
    )

    assertSelfContained(html, csp, profile)

    fs.writeFileSync(htmlPath, html)
    for (const filePath of consumed) fs.rmSync(filePath)

    // Anything still on disk beside the HTML would be a remote fetch at
    // runtime. Fail loudly.
    const leftovers: string[] = []
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (full !== htmlPath) leftovers.push(path.relative(outDir, full))
      }
    }
    walk(outDir)
    if (leftovers.length > 0) {
      throw new Error(`embedded build: assets not inlined: ${leftovers.join(', ')}`)
    }
    for (const entry of fs.readdirSync(outDir, { withFileTypes: true })) {
      if (entry.isDirectory()) fs.rmSync(path.join(outDir, entry.name), { recursive: true })
    }

    // The digest the app pins. `sha256sum -c index.html.sha256` verifies it.
    const digest = sha256Hex(fs.readFileSync(htmlPath))
    fs.writeFileSync(path.join(outDir, 'index.html.sha256'), `${digest}  index.html\n`)
    console.log(`\nembedded build: ${commit} @ ${builtAt}\nembedded sha256: ${digest}`)
  },
})

export default defineConfig(async (env) => {
  applyEmbeddedProfileEnv()
  const base = await baseConfigFactory(env)
  const { profile, connectUrls } = resolveEmbeddedDeployment(env.mode)
  // Fail here rather than ship a document that quietly runs the wrong network.
  assertEmbeddedProfile(profile)
  const csp = buildEmbeddedCsp({ connectUrls, relayUrls: EMBEDDED_RELAY_URLS })

  const rolldownOptions = {
    ...(base.build?.rolldownOptions ?? {}),
    output: {
      ...(base.build?.rolldownOptions?.output ?? {}),
      // One chunk for everything: no runtime chunk loading, so no code URL is
      // ever fetched. manualChunks is dropped because it is mutually exclusive
      // with this.
      codeSplitting: false,
      manualChunks: undefined,
    },
  }

  return {
    ...base,
    base: './',
    // Vite reads .env files from here. The directory holds none, so a stray
    // .env in the repository root cannot change what the app ships.
    envDir: path.join(projectRoot, 'config/embedded-env'),
    define: {
      ...(base.define ?? {}),
      // Lets the minifier drop the reload branch in src/utils/embeddedShell.ts
      // so the emitted document contains no window.location.reload() at all.
      __QRL_EMBEDDED_BUILD__: 'true',
    },
    // Nothing from public/ is copied: every runtime reference to it is turned
    // into a data: URI above, and a copied file could only be fetched remotely.
    publicDir: false,
    plugins: [
      inlineWorkerImports(),
      stripDependencyReloads(),
      ...((base.plugins ?? []) as PluginOption[]),
      inlinePublicAssetLiterals(),
      rewriteEmbeddedHtml(csp),
      emitSingleFile(path.join(projectRoot, EMBEDDED_OUT_DIR), csp, connectUrls, profile),
    ],
    build: {
      ...base.build,
      outDir: EMBEDDED_OUT_DIR,
      emptyOutDir: true,
      // Inline every asset (fonts, images) as a data: URI regardless of size.
      assetsInlineLimit: () => true,
      cssCodeSplit: false,
      modulePreload: false,
      sourcemap: false,
      reportCompressedSize: false,
      rolldownOptions,
    },
  }
})
