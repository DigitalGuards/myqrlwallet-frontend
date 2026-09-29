/**
 * Embedded single-file build (architecture spike).
 *
 * Goal: produce ONE self-contained `dist-embedded/index.html` that the mobile
 * app ships inside its own bundle and hands to a WebView via
 * `source={{ html, baseUrl: "https://qrlwallet.com/" }}`. The wallet then runs
 * on the qrlwallet.com origin (so localStorage / IndexedDB / relay CORS keep
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
 *   - no <script src=>, no <link href=> to a file, no /assets/ reference
 *
 * Flags:
 *   EMBED_VIDEO=1  also inline the 1.4 MB decorative home-screen video as a
 *                  data: URI. Off by default: the video is decorative, the
 *                  component already degrades to opacity 0 when its source
 *                  fails, and inlining it nearly doubles the HTML.
 */
import { defineConfig, type Plugin, type PluginOption } from 'vite'
import path from 'path'
import fs from 'fs'
import baseConfigFactory from './vite.config'

const projectRoot = path.resolve(__dirname, '..')
const publicDir = path.join(projectRoot, 'public')

const EMBED_VIDEO = process.env.EMBED_VIDEO === '1'
const EMBEDDED_OUT_DIR = 'dist-embedded'

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
    if (!source.endsWith('?worker')) return null
    return this.resolve(`${source}&inline`, importer, options)
  },
})

/**
 * `publicDir` is disabled for this build, so anything referenced by a literal
 * absolute path (`"/tree.svg"`, `"/qrl-video-dark.mp4"`) would resolve against
 * the WebView baseUrl and be fetched from the live server. Replace those
 * literals with data: URIs. Each entry is asserted to exist so a renamed asset
 * fails the build instead of silently going remote.
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

// Remote script sources are impossible here: the only script in the document
// is the inline one this build writes. 'unsafe-inline' covers it (there is no
// nonce to hand a static file). 'wasm-unsafe-eval' is required because
// src/utils/crypto/argon2.ts calls hash-wasm, which does
// WebAssembly.compile/instantiate; the built bundle contains no eval() and no
// new Function(), so 'unsafe-eval' is deliberately left out.
// connect-src: qrlwallet.com serves the RPC proxy, the tx-history/token/NFT/
// IPFS API and the dApp relay (socket.io: https for polling, wss for the
// upgrade); zondscan.com is the explorer API.
const EMBEDDED_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'wasm-unsafe-eval'",
  "script-src-attr 'none'",
  "style-src 'unsafe-inline'",
  "img-src data: https:",
  "media-src data: blob:",
  "font-src data:",
  "worker-src blob:",
  "connect-src https://qrlwallet.com wss://qrlwallet.com https://zondscan.com",
  "object-src 'none'",
  "frame-src 'none'",
  "child-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "manifest-src 'none'",
].join('; ')

/**
 * Rewrite index.html for the embedded target:
 *   - swap the CSP meta for the embedded one
 *   - drop every <link> that would fetch from the origin (favicons, manifest,
 *     preloads). They are cosmetic in a WebView and each one is a live request
 *     to the server this spike is trying to stop depending on.
 *   - drop the canonical / dns-prefetch / preconnect hints.
 */
const rewriteEmbeddedHtml = (): Plugin => ({
  name: 'embedded-rewrite-html',
  enforce: 'post',
  transformIndexHtml: {
    order: 'post',
    handler(html: string) {
      return html
        .replace(
          /<meta\s+http-equiv="Content-Security-Policy"[\s\S]*?\/>/,
          `<meta http-equiv="Content-Security-Policy" content="${EMBEDDED_CSP}" />`
        )
        .replace(/[ \t]*<link\s+rel="(?:icon|apple-touch-icon|manifest|preload|preconnect|dns-prefetch|canonical)"[\s\S]*?\/>\n?/g, '')
    },
  },
})

/**
 * Fold every emitted JS and CSS asset into index.html and delete it from the
 * output directory, so `dist-embedded/` contains exactly one file.
 *
 * This runs on disk in `closeBundle` rather than on the rolldown bundle object
 * in `generateBundle`: deleting entries from that object does not remove the
 * files rolldown has already scheduled for writing.
 */
const emitSingleFile = (outDir: string): Plugin => ({
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

    html = html.replace(
      /[ \t]*<script[^>]*\ssrc="([^"]+)"[^>]*><\/script>/g,
      (match, href: string) => {
        const filePath = resolveHref(href)
        if (!filePath) return match
        consumed.add(filePath)
        // `</script>` inside a string literal would end the inline script tag.
        const code = fs.readFileSync(filePath, 'utf8').split('</script').join('<\\/script')
        return `<script type="module">\n${code}\n</script>`
      }
    )

    html = html.replace(
      /[ \t]*<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g,
      (match, href: string) => {
        const filePath = resolveHref(href)
        if (!filePath) return match
        consumed.add(filePath)
        return `<style>\n${fs.readFileSync(filePath, 'utf8')}\n</style>`
      }
    )

    fs.writeFileSync(htmlPath, html)
    for (const filePath of consumed) fs.rmSync(filePath)

    // Anything still on disk beside the HTML would be a remote fetch at
    // runtime. Fail loudly rather than ship a half-embedded build.
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
  },
})

export default defineConfig(async (env) => {
  const base = await baseConfigFactory(env)

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
      rewriteEmbeddedHtml(),
      emitSingleFile(path.join(projectRoot, EMBEDDED_OUT_DIR)),
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
