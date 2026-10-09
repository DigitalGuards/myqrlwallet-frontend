import { QRL_EXTENSION_RDNS } from "@/constants";
import type { AccountSource } from "@/utils/storage";
import type { ExtensionProvider } from "@/stores/qrlStore";
import { getErrorMessage, isProviderRpcError } from "@/utils/errors";
import { qualifyV3Provider } from "./v3Provider";
import { isValidQrlAddress } from "@/utils/web3/address";

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

/**
 * Whether an EIP-6963 announcement is a QRL wallet extension we can drive
 * over the qrl_* namespace. Both the upstream QRL Web3 Wallet and the
 * MyQRLWallet Extension fork qualify; neither exposes a window global, so
 * EIP-6963 is the only discovery channel.
 */
export const isQrlExtension = (
  info: Pick<EIP6963ProviderInfo, "rdns">,
): boolean => QRL_EXTENSION_RDNS.some((rdns) => rdns === info.rdns);

function isProviderDetail(value: unknown): value is EIP6963ProviderDetail {
  if (typeof value !== "object" || value === null) return false;
  if (!("info" in value) || !("provider" in value)) return false;
  const { info, provider } = value;
  return (
    typeof info === "object" &&
    info !== null &&
    "uuid" in info &&
    typeof info.uuid === "string" &&
    "name" in info &&
    typeof info.name === "string" &&
    "icon" in info &&
    typeof info.icon === "string" &&
    "rdns" in info &&
    typeof info.rdns === "string" &&
    isQrlExtension({ rdns: info.rdns }) &&
    typeof provider === "object" &&
    provider !== null &&
    "request" in provider &&
    typeof provider.request === "function"
  );
}

function isAccountList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isValidQrlAddress);
}

/**
 * Collapse duplicate announcements. Keyed by rdns: a provider may announce
 * more than once (initial announce + the requestProvider re-announce), and
 * two entries sharing an rdns would be indistinguishable in a picker anyway.
 */
export function dedupeProviders(
  details: EIP6963ProviderDetail[],
): EIP6963ProviderDetail[] {
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
 * Request fresh announcements on every discovery, including after a reload.
 * Keep the full collection window for extensions that initialize later, and
 * repeat the request halfway through for listeners installed during startup.
 */
export function discoverQrlProviders(): Promise<EIP6963ProviderDetail[]> {
  return new Promise((resolve) => {
    if (typeof window === "undefined") {
      resolve([]);
      return;
    }
    const found: EIP6963ProviderDetail[] = [];
    const handleAnnounceProvider = (event: Event) => {
      if (event instanceof CustomEvent) {
        const detail: unknown = event.detail;
        if (isProviderDetail(detail)) found.push(detail);
      }
    };

    window.addEventListener("eip6963:announceProvider", handleAnnounceProvider);
    const request = () =>
      window.dispatchEvent(new Event("eip6963:requestProvider"));
    const retry = setTimeout(request, 500);

    const settle = () => {
      clearTimeout(retry);
      window.removeEventListener(
        "eip6963:announceProvider",
        handleAnnounceProvider,
      );
      resolve(dedupeProviders(found));
    };
    setTimeout(settle, 1000);
    request();
  });
}

/** Check the site's current permission without opening a connection prompt. */
export async function extensionAuthorizesAccount(
  provider: ExtensionProvider,
  address: string,
): Promise<boolean> {
  if (!isValidQrlAddress(address)) return false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const accounts: unknown = await Promise.race([
      provider.request({ method: "qrl_accounts" }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error("Extension account check timed out"));
        }, 10000);
      }),
    ]);
    return (
      isAccountList(accounts) &&
      accounts.some(
        (account) => account.toLowerCase() === address.toLowerCase(),
      )
    );
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Recover a live signer for the selected address using existing permission. */
export async function restoreExtensionProvider(
  address: string,
  current: ExtensionProvider | null = null,
): Promise<ExtensionProvider | null> {
  if (!isValidQrlAddress(address)) return null;
  if (current && (await extensionAuthorizesAccount(current, address)))
    return current;

  const details = await discoverQrlProviders();
  const candidates = await Promise.allSettled(
    details.map(async ({ provider }) => {
      if (
        provider === current ||
        !(await extensionAuthorizesAccount(provider, address))
      )
        return null;
      await qualifyV3Provider(provider);
      return provider;
    }),
  );
  const matches = new Set<ExtensionProvider>();
  let qualificationError: Error | undefined;
  for (const candidate of candidates) {
    if (candidate.status === "fulfilled") {
      if (candidate.value) matches.add(candidate.value);
    } else {
      const reason: unknown = candidate.reason;
      qualificationError ??=
        reason instanceof Error
          ? reason
          : new Error("Extension qualification failed");
    }
  }
  if (matches.size > 1) {
    throw new Error(
      "Multiple extensions authorize this account. Choose one with Connect Browser Extension.",
    );
  }
  if (matches.size === 0 && qualificationError) throw qualificationError;
  return matches.values().next().value ?? null;
}

/**
 * Connect to a discovered extension: request account access (the extension
 * shows its own approval surface), make the first account active with the
 * 'extension' source, and store the provider for later request() calls.
 */
export async function connectWithProvider(
  detail: EIP6963ProviderDetail,
  setActiveAccount: (address: string, source?: AccountSource) => Promise<void>,
  setExtensionProvider: (provider: ExtensionProvider | null) => void,
): Promise<string[] | null> {
  const provider = detail.provider;

  try {
    await qualifyV3Provider(provider);
    console.log(
      `Attempting to connect to ${detail.info.name} using qrl_requestAccounts...`,
    );
    const accounts: unknown = await provider.request({
      method: "qrl_requestAccounts",
    });
    if (!isAccountList(accounts)) {
      throw new Error("The extension returned an invalid account list");
    }

    if (accounts.length > 0) {
      const firstAccount = accounts[0];
      if (!firstAccount) return null; // length > 0 guarantees this; satisfies the index checker
      console.log("Connected to extension with accounts:", accounts);

      console.log(`Setting active account to: ${firstAccount}`);
      console.log("Setting extension provider in store.");
      setExtensionProvider(provider);
      await setActiveAccount(firstAccount, "extension");

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
    if (code === 4001) {
      // EIP-1193 user rejection error
      console.log("User rejected connection request.");
      alert("Connection request rejected.");
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
