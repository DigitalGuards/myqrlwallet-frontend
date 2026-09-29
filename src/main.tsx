import { Buffer } from 'buffer';
globalThis.Buffer = Buffer;

// Must run before the router mounts: RouteMonitor's restore-navigation would
// otherwise erase a #qrlconnect= pairing fragment (and leave the bearer URI
// in history) before the lazy web ingress loads.
import { captureQrlconnectFragment } from '@/services/dappConnect/fragmentCapture';
captureQrlconnectFragment();

// Must also run before the router mounts: in the app-shipped embedded build
// this intercepts external links so they open in the device browser instead of
// replacing the shipped wallet document. A no-op in every other build.
import { installEmbeddedShell } from '@/utils/embeddedShell';
installEmbeddedShell();

// Must be evaluated before './App.tsx': importing App constructs the MobX
// stores, and DAppConnectStore's constructor reads the persisted dApp sessions
// and starts reconnecting. This import clears those sessions first when the
// app signals an upgrade from the hosted wallet. A statement in this file's
// body would run after every import had been evaluated, which is too late.
import '@/utils/embeddedMigrationBoot'

import React from 'react'
import ReactDOM from 'react-dom/client'
import { HelmetProvider } from 'react-helmet-async'
import App from './App.tsx'
// Self-hosted variable fonts (CSP-safe, bundled by Vite): Sora = display,
// Instrument Sans = body, Inter = numeric (balances/amounts/fees),
// JetBrains Mono = data (addresses/hashes/seeds). Imported here, outside
// index.css, so Vite rewrites the woff2 asset URLs.
import '@fontsource-variable/sora/index.css'
import '@fontsource-variable/instrument-sans/index.css'
import '@fontsource-variable/inter/index.css'
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
