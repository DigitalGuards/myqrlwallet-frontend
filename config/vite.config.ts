import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react-swc'
import path from 'path'
import nodePolyfills from 'rollup-plugin-node-polyfills'
import { createRequire } from 'module'
import tailwindcss from '@tailwindcss/postcss'
import { v3Deployment } from '../src/config/deploymentProfile'

const require = createRequire(import.meta.url)
const resolveNodePolyfill = (name: string) =>
  require.resolve(`rollup-plugin-node-polyfills/polyfills/${name}`)
const localQrlRpcTarget = process.env.LOCAL_QRL_RPC_TARGET

const assertNoBrowserSeed = (mode: string) => {
  const publicEnv = loadEnv(mode, path.resolve(__dirname, '..'), 'VITE_')
  if (publicEnv.VITE_SEED) {
    throw new Error(
      'VITE_SEED is browser-visible. Remove it from the local environment before starting Vite.'
    )
  }
  const profile = publicEnv.VITE_WALLET_PROFILE || ''
  if (profile && profile !== 'v3-private') throw new Error('Unknown VITE_WALLET_PROFILE')
  const network = profile === 'v3-private' ? v3Deployment(publicEnv).network : null
  return { define: {
    __QRL_WALLET_PROFILE__: JSON.stringify(profile),
    __QRL_NATIVE_NETWORK__: JSON.stringify(network ? {
      chainId: network.expectedChainId,
      genesisHash: network.genesisHash,
    } : null),
  } }
}

export default defineConfig(({ mode }) => ({
  // Run the public-environment assertion before Vite consumes this config.
  ...assertNoBrowserSeed(mode),
  // Desktop (Electron) loads the bundle from disk via loadFile (file://), so
  // assets must be referenced relatively. Set VITE_DESKTOP=1 for that build
  // (see myqrlwallet-desktop/scripts/build-renderer.sh). Web builds keep '/'.
  base: process.env.VITE_DESKTOP === '1' ? './' : '/',
  plugins: [
    react(),
    // Remove vendor-qrl-crypto from <link rel="modulepreload">: it is a
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
  // The wallet's network helper appends /testnet or /mainnet to every RPC
  // base URL. A local gqrl JSON-RPC endpoint listens at /, so development
  // sessions can opt into this loopback-only path rewrite.
  server: localQrlRpcTarget
    ? {
        proxy: {
          '/local-qrl-rpc': {
            target: localQrlRpcTarget,
            changeOrigin: false,
            rewrite: (requestPath: string) =>
              requestPath.replace(/^\/local-qrl-rpc\/(?:testnet|mainnet)\/?$/, '/'),
          },
        },
      }
    : undefined,
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '../src'),
      'stream': resolveNodePolyfill('stream'),
      'buffer': resolveNodePolyfill('buffer-es6'),
      'events': resolveNodePolyfill('events'),
      'util': resolveNodePolyfill('util'),
      'process': resolveNodePolyfill('process-es6'),
    },
  },
  build: {
    rolldownOptions: {
      plugins: [nodePolyfills()],
      output: {
        minify: {
          compress: {
            dropConsole: mode === 'production',
            dropDebugger: mode === 'production',
          },
        },
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
    // Do not ship sourcemaps to production: they expose the full
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
