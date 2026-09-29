/// <reference types="vite/client" />


/**
 * React Native WebView bridge interface
 * Available when running inside the MyQRLWallet native app
 */
interface ReactNativeWebView {
  postMessage: (message: string) => void;
  injectedObjectJson?: () => string | null;
}

declare global {
  // Declared here, inside `declare global`, because this file is a module
  // (it ends with `export {}`): a top-level interface would stay local and
  // never merge with Vite's ImportMetaEnv. Every key the app reads must be
  // listed so it can be read with dot access, which is the only form Vite
  // replaces with that one key's value (see src/config/envGuard.ts).
  interface ImportMetaEnv {
    readonly VITE_APP_TITLE: string
    readonly VITE_QRNS_CHAIN_ID_TEST_NET?: string
    readonly VITE_QRNS_REGISTRY_TEST_NET?: string
    readonly VITE_QRNS_CHAIN_ID_MAIN_NET?: string
    readonly VITE_QRNS_REGISTRY_MAIN_NET?: string
    readonly VITE_CUSTOMERC20FACTORY_ADDRESS?: string
    readonly VITE_EXPLORER_URL_DEVELOPMENT?: string
    readonly VITE_EXPLORER_URL_PRODUCTION?: string
    readonly VITE_RPC_URL_DEVELOPMENT?: string
    readonly VITE_RPC_URL_PRODUCTION?: string
    readonly VITE_SERVER_URL_DEVELOPMENT?: string
    readonly VITE_SERVER_URL_PRODUCTION?: string
    readonly VITE_V3_CHAIN_ID?: string
    readonly VITE_V3_EXPLORER_URL?: string
    readonly VITE_V3_FACTORY_ADDRESS?: string
    readonly VITE_V3_GENESIS_HASH?: string
    readonly VITE_V3_QNS_REGISTRY?: string
    readonly VITE_V3_RPC_URL?: string
    readonly VITE_V3_SERVER_URL?: string
    readonly DEV: boolean
    readonly PROD: boolean
    readonly MODE: string
  }

  interface Window {
    ReactNativeWebView?: ReactNativeWebView;
  }
}

export {};
