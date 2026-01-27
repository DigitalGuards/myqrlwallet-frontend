import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import path from 'path'
import nodePolyfills from 'rollup-plugin-node-polyfills'
import { createRequire } from 'module'
import tailwindcss from '@tailwindcss/postcss'

const require = createRequire(import.meta.url)

export default defineConfig({
  plugins: [react()],
  css: {
    postcss: {
      plugins: [tailwindcss()],
    },
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
    },
    sourcemap: true,
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
})