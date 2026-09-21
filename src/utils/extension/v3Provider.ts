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
