import { Buffer } from 'buffer';
globalThis.Buffer = Buffer;

// Must run before the router mounts: RouteMonitor's restore-navigation would
// otherwise erase a #qrlconnect= pairing fragment (and leave the bearer URI
// in history) before the lazy web ingress loads.
import { captureQrlconnectFragment } from '@/services/dappConnect/fragmentCapture';
captureQrlconnectFragment();

import React from 'react'
import ReactDOM from 'react-dom/client'
import { HelmetProvider } from 'react-helmet-async'
import App from './App.tsx'
// Self-hosted variable fonts (CSP-safe, bundled by Vite): Sora = display,
// Instrument Sans = body, JetBrains Mono = data (addresses/amounts/seeds).
// Imported here, not in index.css, so Vite rewrites the woff2 asset URLs.
import '@fontsource-variable/sora/index.css'
import '@fontsource-variable/instrument-sans/index.css'
import '@fontsource-variable/jetbrains-mono/index.css'
import './index.css'

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Root element #root is missing from index.html')
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <HelmetProvider>
      <App />
    </HelmetProvider>
  </React.StrictMode>,
)
