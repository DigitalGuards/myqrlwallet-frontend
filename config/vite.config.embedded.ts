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
 * Every endpoint this build is configured to talk to, so connect-src matches
 * the deployment. A v3-profile build reaches a
 * different RPC, API and explorer, and would otherwise ship a CSP that blocks
 * its own traffic.
 */
const resolveConnectUrls = (mode: string): string[] => {
  const env = loadEnv(mode, projectRoot, 'VITE_')
  if ((env['VITE_WALLET_PROFILE'] ?? '') === 'v3-private') {
    const deployment = v3Deployment(env)
    return [deployment.network.url, deployment.serverUrl, deployment.network.explorer]
  }
  // Same defaults as src/config/networks.ts. The embedded document is always a
  // production build, so the DEVELOPMENT endpoints are deliberately excluded.
  return [
    env['VITE_RPC_URL_PRODUCTION'] || 'https://qrlwallet.com/api/qrl-rpc',
    env['VITE_SERVER_URL_PRODUCTION'] || 'https://qrlwallet.com/api',
    env['VITE_EXPLORER_URL_PRODUCTION'] || 'https://zondscan.com',
  ]
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
      const rewritten = insertIntoHead(
        html
          .replace(
            /<meta\b[^>]*http-equiv\s*=\s*["']?Content-Security-Policy["']?[^>]*>/i,
            embeddedMeta
          )
          .replace(
            /[ \t]*<link\b(?=[^>]*\brel\s*=\s*["']?(?:icon|apple-touch-icon|manifest|preload|preconnect|dns-prefetch|canonical)\b)[^>]*>\n?/gi,
            ''
          ),
        `    <script>${EMBEDDED_FLAG_SCRIPT}</script>\n`
      )
      if (!rewritten.includes(embeddedMeta)) {
        throw new Error('embedded build: the Content-Security-Policy meta was not replaced')
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
const assertSelfContained = (html: string, csp: string) => {
  const violations = findEmbeddedHtmlViolations(html)

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
  connectUrls: string[]
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
      connectUrls,
      csp,
      // Hashed over the script text exactly as written between the newlines
      // that follow `<script ...>` and precede `</script>`.
      appScriptSha256: sha256Hex(appScript),
      appScriptBytes: Buffer.byteLength(appScript),
    }
    html = insertIntoHead(
      html,
      `    <script type="application/json" id="${BUILD_INFO_ID}">${JSON.stringify(buildInfo)}</script>\n`
    )

    assertSelfContained(html, csp)

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
  const base = await baseConfigFactory(env)
  const connectUrls = resolveConnectUrls(env.mode)
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
    // Nothing from public/ is copied: every runtime reference to it is turned
    // into a data: URI above, and a copied file could only be fetched remotely.
    publicDir: false,
    plugins: [
      inlineWorkerImports(),
      ...((base.plugins ?? []) as PluginOption[]),
      inlinePublicAssetLiterals(),
      rewriteEmbeddedHtml(csp),
      emitSingleFile(path.join(projectRoot, EMBEDDED_OUT_DIR), csp, connectUrls),
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
