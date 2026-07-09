import { QRL_EXTENSION_RDNS } from "@/constants";
import type { AccountSource } from "@/utils/storage";
import type { ExtensionProvider } from "@/stores/qrlStore";
import { getErrorMessage, isProviderRpcError } from "@/utils/errors";

// EIP-6963 types (simplified)
export interface EIP6963ProviderInfo {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
}

export interface EIP6963ProviderDetail {
  info: EIP6963ProviderInfo;
  provider: ExtensionProvider;
}

interface EIP6963AnnounceProviderEvent extends CustomEvent {
  detail: EIP6963ProviderDetail;
}

/**
 * Whether an EIP-6963 announcement is a QRL wallet extension we can drive
 * over the qrl_* namespace. Both the upstream QRL Web3 Wallet and the
 * MyQRLWallet Extension fork qualify; neither exposes a window global, so
 * EIP-6963 is the only discovery channel.
 */
export const isQrlExtension = (info: Pick<EIP6963ProviderInfo, "rdns">): boolean =>
  (QRL_EXTENSION_RDNS as readonly string[]).includes(info.rdns);

/**
 * Collapse duplicate announcements. Keyed by rdns: a provider may announce
 * more than once (initial announce + the requestProvider re-announce), and
 * two entries sharing an rdns would be indistinguishable in a picker anyway.
 */
export function dedupeProviders(details: EIP6963ProviderDetail[]): EIP6963ProviderDetail[] {
  const seen = new Set<string>();
  const result: EIP6963ProviderDetail[] = [];
  for (const detail of details) {
    if (seen.has(detail.info.rdns)) continue;
    seen.add(detail.info.rdns);
    result.push(detail);
  }
  return result;
}

/**
 * Discover every installed QRL wallet extension via EIP-6963.
 *
 * Compliant providers re-announce synchronously while the requestProvider
 * event dispatches, so anything installed is normally collected immediately;
 * a short grace period then catches stragglers, and the long timeout only
 * applies when nothing announced at all.
 */
export function discoverQrlProviders(): Promise<EIP6963ProviderDetail[]> {
  return new Promise((resolve) => {
    const found: EIP6963ProviderDetail[] = [];
    const handleAnnounceProvider = (event: Event) => {
      const announceEvent = event as EIP6963AnnounceProviderEvent;
      if (announceEvent.detail?.info && isQrlExtension(announceEvent.detail.info)) {
        found.push(announceEvent.detail);
      }
    };

    window.addEventListener("eip6963:announceProvider", handleAnnounceProvider);
    window.dispatchEvent(new Event("eip6963:requestProvider"));

    const settle = () => {
      window.removeEventListener("eip6963:announceProvider", handleAnnounceProvider);
      resolve(dedupeProviders(found));
    };
    setTimeout(settle, found.length > 0 ? 100 : 1000);
  });
}

/**
 * Connect to a discovered extension: request account access (the extension
 * shows its own approval popup), make the first account active with the
 * 'extension' source, and store the provider for later request() calls.
 */
export async function connectWithProvider(
  detail: EIP6963ProviderDetail,
  setActiveAccount: (address: string, source?: AccountSource) => Promise<void>,
  setExtensionProvider: (provider: ExtensionProvider | null) => void
): Promise<string[] | null> {
  const provider = detail.provider;

  try {
    console.log(`Attempting to connect to ${detail.info.name} using qrl_requestAccounts...`);
    const accounts = await provider.request<string[]>({ method: 'qrl_requestAccounts' });

    if (accounts && accounts.length > 0) {
      const firstAccount = accounts[0];
      if (!firstAccount) return null; // length > 0 guarantees this; satisfies the index checker
      console.log("Connected to extension with accounts:", accounts);

      console.log(`Setting active account to: ${firstAccount}`);
      await setActiveAccount(firstAccount, 'extension');

      console.log("Setting extension provider in store.");
      setExtensionProvider(provider);

      return accounts;
    } else {
      console.warn("No accounts returned from extension.");
      setExtensionProvider(null); // Clear provider if no accounts approved
      return null;
    }
  } catch (error) {
    setExtensionProvider(null); // Clear provider on error
    // Handle errors, such as user rejection
    const code = isProviderRpcError(error) ? error.code : undefined;
    if (code === 4001) { // EIP-1193 user rejection error
      console.log('User rejected connection request.');
      alert('Connection request rejected.');
    } else if (code === -32601) {
      console.error("RPC Error: Method not found", error);
      alert(`RPC Error: ${getErrorMessage(error)}`);
    } else {
      console.error("Error connecting to extension:", error);
      alert(`Error connecting to extension: ${getErrorMessage(error)}`);
    }
    return null;
  }
}
