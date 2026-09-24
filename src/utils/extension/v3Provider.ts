import {
  canonicalChainId,
  verifyNetworkIdentity,
} from "@/config/deploymentProfile";
import { IS_V3_PROFILE } from "@/config/runtimeProfile";
import type { ExtensionProvider } from "@/stores/qrlStore";

const qualifiedProviders = new WeakSet<ExtensionProvider>();

export function assertQualifiedV3Provider(
  provider: ExtensionProvider | null,
): void {
  if (IS_V3_PROFILE && (!provider || !qualifiedProviders.has(provider))) {
    throw new Error(
      "This extension is not yet qualified for Testnet v3. Connect an updated MyQRLWallet extension.",
    );
  }
}

export async function qualifyV3Provider(
  provider: ExtensionProvider,
): Promise<void> {
  if (!IS_V3_PROFILE) return;
  qualifiedProviders.delete(provider);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let capabilities: unknown;
  try {
    capabilities = await Promise.race([
      provider.request<unknown>({ method: "qrl_walletCapabilities" }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(new Error("Extension capability verification timed out")),
          10000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
  const { QRL_PROVIDER } = await import("@/config");
  const network = QRL_PROVIDER.TEST_NET_V3;
  if (
    !capabilities ||
    typeof capabilities !== "object" ||
    !("addressScheme" in capabilities) ||
    capabilities.addressScheme !== "qip55-64" ||
    !("chainId" in capabilities) ||
    canonicalChainId(capabilities.chainId) !== network.expectedChainId ||
    !("genesisHash" in capabilities) ||
    typeof capabilities.genesisHash !== "string" ||
    capabilities.genesisHash.toLowerCase() !== network.genesisHash
  ) {
    throw new Error(
      "This extension is not yet qualified for the configured Testnet v3 network.",
    );
  }
  await verifyNetworkIdentity(provider, network);
  qualifiedProviders.add(provider);
}

const qualifiedMobileProviders = new WeakSet<ExtensionProvider>();

export const V3_UNQUALIFIED_MOBILE_MESSAGE =
  "This MyQRLWallet app is not yet qualified for Testnet v3. Update the app and pair again.";

export function isQualifiedV3MobileProvider(
  provider: ExtensionProvider | null,
): boolean {
  return !IS_V3_PROFILE || (!!provider && qualifiedMobileProviders.has(provider));
}

export function assertQualifiedV3MobileProvider(
  provider: ExtensionProvider | null,
): void {
  if (!isQualifiedV3MobileProvider(provider)) {
    throw new Error(V3_UNQUALIFIED_MOBILE_MESSAGE);
  }
}

/**
 * Qualify a paired mobile wallet for Testnet v3. The chain id and the genesis
 * block are both requested through the pairing, so the genesis hash is read
 * from the phone's own node: a wallet on another network cannot pass.
 * Callers still validate the paired account as a 64-byte QIP-55 address.
 */
export async function qualifyV3MobileProvider(
  provider: ExtensionProvider,
): Promise<void> {
  if (!IS_V3_PROFILE) return;
  qualifiedMobileProviders.delete(provider);
  const { QRL_PROVIDER } = await import("@/config");
  try {
    await verifyNetworkIdentity(provider, QRL_PROVIDER.TEST_NET_V3);
  } catch {
    throw new Error(V3_UNQUALIFIED_MOBILE_MESSAGE);
  }
  qualifiedMobileProviders.add(provider);
}
