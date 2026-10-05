declare const __QRL_WALLET_PROFILE__: string | undefined;
declare const __QRL_NATIVE_NETWORK__:
  | { chainId: string; genesisHash: string }
  | null
  | undefined;

export const IS_V3_PROFILE =
  typeof __QRL_WALLET_PROFILE__ !== "undefined" &&
  __QRL_WALLET_PROFILE__ === "v3-private";

export const V3_UNSUPPORTED_SIGNER_MESSAGE =
  "Testnet v3 supports this web wallet and updated MyQRLWallet mobile, desktop and extension releases. Older native apps are not yet qualified.";

/**
 * The capability object the native app injects, or null outside it.
 *
 * Compatibility metadata only, and it is app-supplied, so every field is read
 * defensively. The single reader, because more than one thing on the page needs
 * a field out of it.
 */
export function readNativeCapabilities(): Record<string, unknown> | null {
  if (typeof window === "undefined") return null;
  try {
    const bridge = window.ReactNativeWebView;
    if (typeof bridge?.postMessage !== "function") return null;
    const json = bridge.injectedObjectJson?.();
    if (typeof json !== "string" || json.length > 4096) return null;
    const injected: unknown = JSON.parse(json);
    if (!injected || typeof injected !== "object" || Array.isArray(injected))
      return null;
    const capabilities = (injected as Record<string, unknown>)[
      "qrlWalletCapabilities"
    ];
    if (
      !capabilities ||
      typeof capabilities !== "object" ||
      Array.isArray(capabilities)
    )
      return null;
    return capabilities as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Compatibility metadata only. Native document binding and authentication still apply. */
export function isQualifiedV3NativeContext(): boolean {
  if (
    typeof window === "undefined" ||
    typeof __QRL_NATIVE_NETWORK__ === "undefined"
  )
    return false;
  const expected = __QRL_NATIVE_NETWORK__;
  if (!expected || !expected.chainId || !expected.genesisHash) return false;
  try {
    if (window.top !== window || !navigator.userAgent.includes("MyQRLWallet"))
      return false;
    const record = readNativeCapabilities();
    if (record === null) return false;
    return (
      record["bridgeVersion"] === 1 &&
      record["addressScheme"] === "qip55-64" &&
      record["networkProfile"] === "v3-private" &&
      record["chainId"] === expected.chainId &&
      record["genesisHash"] === expected.genesisHash
    );
  } catch {
    return false;
  }
}

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
      (!!window.ReactNativeWebView && !isQualifiedV3NativeContext()) ||
      (typeof navigator !== "undefined" &&
        navigator.userAgent.includes("MyQRLWallet") &&
        window.qrlWallet?.addressScheme !== "qip55-64" &&
        !isQualifiedV3NativeContext()))
  );
}

export function assertV3BrowserContext(): void {
  if (isUnsupportedV3Context()) throw new Error(V3_UNSUPPORTED_SIGNER_MESSAGE);
}

export function assertSupportedAccountSource(source: string): void {
  assertV3BrowserContext();
  if (
    IS_V3_PROFILE &&
    source !== "seed" &&
    source !== "extension" &&
    source !== "mobile"
  )
    throw new Error(V3_UNSUPPORTED_SIGNER_MESSAGE);
}
