import {
  canonicalChainId,
  verifyNetworkIdentity,
  type NetworkConfig,
} from "@/config/deploymentProfile";
import { IS_V3_PROFILE } from "@/config/runtimeProfile";
import type { ExtensionProvider } from "@/stores/qrlStore";

const qualifiedProviders = new WeakSet<ExtensionProvider>();
const pendingQualifications = new WeakMap<
  ExtensionProvider,
  { networkId: string; promise: Promise<void> }
>();

/**
 * The network the wallet has selected. Signers are qualified against it when
 * the caller does not name the network itself.
 */
export async function selectedV3Network(): Promise<NetworkConfig> {
  // Loaded on demand like @/config, so modules that only import this file do
  // not pull the network configuration in at load time.
  const [{ QRL_PROVIDER }, { StorageUtil }] = await Promise.all([
    import("@/config"),
    import("@/utils/storage"),
  ]);
  const selected = await StorageUtil.getBlockChain();
  const network = Object.entries(QRL_PROVIDER).find(
    ([id]) => id === selected,
  )?.[1];
  if (!network)
    throw new Error("Network identity has not been verified");
  return network;
}

export function assertQualifiedV3Provider(
  provider: ExtensionProvider | null,
): void {
  if (IS_V3_PROFILE && (!provider || !qualifiedProviders.has(provider))) {
    throw new Error(
      "This extension is not yet qualified for this network. Connect an updated MyQRLWallet extension.",
    );
  }
}

export async function qualifyV3Provider(
  provider: ExtensionProvider,
  network?: NetworkConfig,
): Promise<void> {
  if (!IS_V3_PROFILE) return;
  const target = network ?? (await selectedV3Network());
  const pending = pendingQualifications.get(provider);
  if (pending && pending.networkId === target.id) return pending.promise;

  // Fee estimation and Send can verify the same recovered provider together.
  // Keep the last successful qualification until the shared check settles.
  const verification = verifyV3Provider(provider, target).then(
    () => {
      qualifiedProviders.add(provider);
    },
    (error: unknown) => {
      qualifiedProviders.delete(provider);
      throw error instanceof Error
        ? error
        : new Error("Extension qualification failed");
    },
  );
  const entry = { networkId: target.id, promise: verification };
  pendingQualifications.set(provider, entry);
  try {
    await verification;
  } finally {
    if (pendingQualifications.get(provider) === entry)
      pendingQualifications.delete(provider);
  }
}

async function verifyV3Provider(
  provider: ExtensionProvider,
  network: NetworkConfig,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let capabilities: unknown;
  try {
    capabilities = await Promise.race([
      provider.request({ method: "qrl_walletCapabilities" }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error("Extension capability verification timed out"));
        }, 10000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
  if (
    !network.expectedChainId ||
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
      "This extension is not yet qualified for the configured network.",
    );
  }
  await verifyNetworkIdentity(provider, network);
}

// When each paired phone last proved its network, and which network that was.
const qualifiedMobileProviders = new WeakMap<
  ExtensionProvider,
  { at: number; networkId: string }
>();

/** A successful network check is reused this long before re-verifying. */
export const V3_MOBILE_QUALIFICATION_TTL_MS = 60_000;

export const V3_UNQUALIFIED_MOBILE_MESSAGE =
  "This MyQRLWallet app is not yet qualified for this network. Update the app and pair again.";

export const V3_MOBILE_UNRESPONSIVE_MESSAGE =
  "Your phone did not respond. Open MyQRLWallet on your phone and try again.";

export function isQualifiedV3MobileProvider(
  provider: ExtensionProvider | null,
): boolean {
  return (
    !IS_V3_PROFILE || (!!provider && qualifiedMobileProviders.has(provider))
  );
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
 * This is the phone's own attestation over the encrypted pairing: it keeps
 * outdated or misconfigured apps out, and every transaction still carries
 * the pinned chain id for the phone to sign.
 *
 * A timeout means the phone was unreachable (backgrounded, asleep). It keeps
 * any earlier qualification and throws V3_MOBILE_UNRESPONSIVE_MESSAGE; only a
 * definitive chain or genesis mismatch revokes it.
 */
export async function qualifyV3MobileProvider(
  provider: ExtensionProvider,
  network?: NetworkConfig,
): Promise<void> {
  if (!IS_V3_PROFILE) return;
  const target = network ?? (await selectedV3Network());
  const verified = qualifiedMobileProviders.get(provider);
  if (
    verified !== undefined &&
    verified.networkId === target.id &&
    Date.now() - verified.at < V3_MOBILE_QUALIFICATION_TTL_MS
  ) {
    return;
  }
  try {
    await verifyNetworkIdentity(provider, target);
  } catch (error) {
    if (error instanceof Error && /timed out/i.test(error.message)) {
      throw new Error(V3_MOBILE_UNRESPONSIVE_MESSAGE);
    }
    qualifiedMobileProviders.delete(provider);
    throw new Error(V3_UNQUALIFIED_MOBILE_MESSAGE);
  }
  qualifiedMobileProviders.set(provider, {
    at: Date.now(),
    networkId: target.id,
  });
}
