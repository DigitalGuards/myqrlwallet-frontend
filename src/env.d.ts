/// <reference types="vite/client" />

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
