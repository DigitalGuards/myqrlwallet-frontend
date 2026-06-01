import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import path from 'path'
import nodePolyfills from 'rollup-plugin-node-polyfills'
import { createRequire } from 'module'
import tailwindcss from '@tailwindcss/postcss'

const require = createRequire(import.meta.url)

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    // Remove vendor-qrl-crypto from <link rel="modulepreload"> — it's a
    // lazy dynamic import so preloading it competes with critical-path
    // resources (react-dom, main index) without helping first paint.
    {
      name: 'strip-crypto-preload',
      transformIndexHtml(html: string) {
        return html.replace(
          /<link rel="modulepreload"[^>]*vendor-qrl-crypto[^>]*>\n?/g,
          ''
        );
      },
    },
  ],
  css: {
    postcss: {
      plugins: [tailwindcss()],
    },
  },
  esbuild: {
    drop: mode === 'production' ? ['console', 'debugger'] : [],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '../src'),
      'stream': 'rollup-plugin-node-polyfills/polyfills/stream',
      'buffer': 'rollup-plugin-node-polyfills/polyfills/buffer-es6',
      'events': 'rollup-plugin-node-polyfills/polyfills/events',
      'util': 'rollup-plugin-node-polyfills/polyfills/util',
      'process': 'rollup-plugin-node-polyfills/polyfills/process-es6',
    },
  },
  build: {
    rollupOptions: {
      plugins: [nodePolyfills()],
      output: {
        // Split vendor code into separate chunks so the wallet's first paint
        // doesn't have to parse the entire dependency graph before becoming
        // interactive. Previously everything below shipped in a single
        // ~1.2 MB entry chunk, which was 4–8 s of main-thread blocking on
        // mid-range mobile devices. Now the largest single chunk is the
        // QRL post-quantum crypto package, which the rest of the app can
        // load in parallel.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('@radix-ui')) return 'vendor-radix'
          // Keep ALL post-quantum crypto together. @noble/post-quantum is
          // the underlying ML-DSA implementation pulled in by @theqrl/web3;
          // listing it explicitly stops it from leaking into the main index
          // chunk if anything ever imports it directly.
          if (
            id.includes('@theqrl/web3') ||
            id.includes('@theqrl/wallet.js') ||
            id.includes('@noble/post-quantum')
          )
            return 'vendor-qrl-crypto'
          if (id.includes('node_modules/ethers/')) return 'vendor-ethers'
          if (id.includes('node_modules/mobx') || id.includes('mobx-react-lite')) return 'vendor-mobx'
          if (id.includes('node_modules/socket.io-client')) return 'vendor-socket-io'
          if (id.includes('node_modules/react-dom/')) return 'vendor-react-dom'
          if (id.includes('node_modules/react/')) return 'vendor-react'
          return undefined
        },
      },
    },
    // Don't ship sourcemaps to production — they expose the full
    // un-minified store / RPC paths to anyone who guesses the .map URL.
    sourcemap: mode !== 'production',
    commonjsOptions: {
      include: /node_modules/,
      transformMixedEsModules: true,
      defaultIsModuleExports(id) {
        try {
          const module = require(id)
          if (module?.default) {
            return false
          }
          return 'auto'
        } catch {
          return 'auto'
        }
      },
    },
  },
  optimizeDeps: {
    esbuildOptions: {
      define: {
        global: 'globalThis',
      },
    },
    include: ['buffer', 'process', 'events', 'util', 'cross-fetch', '@theqrl/web3-providers-http'],
  },
}))
