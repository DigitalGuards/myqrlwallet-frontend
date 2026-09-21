declare const __QRL_WALLET_PROFILE__: string | undefined;

export const IS_V3_PROFILE =
  typeof __QRL_WALLET_PROFILE__ !== "undefined" &&
  __QRL_WALLET_PROFILE__ === "v3-private";

export const V3_UNSUPPORTED_SIGNER_MESSAGE =
  "Testnet v3 supports this web wallet and updated MyQRLWallet desktop and extension releases. Paired mobile wallets and older native apps are not yet qualified.";

export const profileStorageKey = (key: string): string =>
  IS_V3_PROFILE ? `qrlwallet:v3:${key}` : key;

export function historyNetwork(
  blockchain: string,
): "testnet" | "mainnet" | null {
  if (IS_V3_PROFILE) return blockchain === "TEST_NET_V3" ? "testnet" : null;
  if (blockchain === "TEST_NET") return "testnet";
  return blockchain === "MAIN_NET" ? "mainnet" : null;
}

export function isUnsupportedV3Context(): boolean {
  return (
    IS_V3_PROFILE &&
    typeof window !== "undefined" &&
    ((!!window.qrlWallet && window.qrlWallet.addressScheme !== "qip55-64") ||
      !!window.ReactNativeWebView ||
      (typeof navigator !== "undefined" &&
        navigator.userAgent.includes("MyQRLWallet") &&
        window.qrlWallet?.addressScheme !== "qip55-64"))
  );
}

export function assertV3BrowserContext(): void {
  if (isUnsupportedV3Context()) throw new Error(V3_UNSUPPORTED_SIGNER_MESSAGE);
}

export function assertSupportedAccountSource(source: string): void {
  assertV3BrowserContext();
  if (IS_V3_PROFILE && source !== "seed" && source !== "extension")
    throw new Error(V3_UNSUPPORTED_SIGNER_MESSAGE);
}
