/// <reference types="vite/client" />

/* eslint-disable @typescript-eslint/no-unused-vars */
interface ImportMetaEnv {
  readonly VITE_APP_TITLE: string
  readonly DEV: boolean
  readonly PROD: boolean
  readonly MODE: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
/* eslint-enable @typescript-eslint/no-unused-vars */

/**
 * React Native WebView bridge interface
 * Available when running inside the MyQRLWallet native app
 */
interface ReactNativeWebView {
  postMessage: (message: string) => void;
}

declare global {
  interface Window {
    ReactNativeWebView?: ReactNativeWebView;
  }
}

export {};
