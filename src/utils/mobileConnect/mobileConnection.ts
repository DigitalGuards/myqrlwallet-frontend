import type { QRLConnect } from "@qrlwallet/connect";
import type { ExtensionProvider } from "@/stores/qrlStore";
import type { AccountSource } from "@/utils/storage";
import { log } from "@/utils";

/**
 * dApp-side QRL Connect client: pairs this web wallet with the MyQRLWallet
 * mobile app over the relay, so the phone acts as a remote signer (the
 * inverse of src/services/dappConnect/, which is the WALLET side answering
 * incoming dApp sessions). Both roles run in the same page on separate relay
 * channels and separate localStorage namespaces (wallet side:
 * `qrlconnect:sessions`, this SDK: `@qrlwallet/connect:session`).
 *
 * The SDK is imported dynamically so its socket/ML-KEM weight stays out of
 * the main bundle until a pairing exists or is requested.
 */

// Mirrors the SDK's default `${STORAGE_KEY_PREFIX}:session` key. Used for a
// cheap "is there a stored pairing?" probe without loading the SDK chunk.
const SDK_SESSION_KEY = "@qrlwallet/connect:session";
const SDK_INFLIGHT_KEY = `${SDK_SESSION_KEY}:inflight`;

/** The slice of qrlStore this module drives. Injected to avoid a dep cycle. */
export interface MobileConnectStore {
  setActiveAccount(newActiveAccount?: string, source?: AccountSource): Promise<void>;
  setMobileProvider(provider: ExtensionProvider | null): void;
  /** Make `address` the (single) mobile-sourced account, replacing any other. */
  adoptMobileAccount(address: string): Promise<void>;
  /** Remove all mobile-sourced accounts (pairing ended). */
  removeMobileAccounts(): Promise<void>;
}

let instance: QRLConnect | null = null;
let creating: Promise<QRLConnect> | null = null;
// One adapter per instance so observable.ref comparisons in the store don't
// churn on every event.
let adapter: ExtensionProvider | null = null;

// The SDK's request() returns Promise<unknown>; the store's ExtensionProvider
// surface is generic. Adapt with a single assertion from unknown at the
// boundary rather than pretending QRLConnect IS an ExtensionProvider.
function asExtensionProvider(qrl: QRLConnect): ExtensionProvider {
  if (adapter) return adapter;
  adapter = {
    request: <T = unknown>(args: { method: string; params?: unknown[] | object }) => {
      // The relay protocol takes positional (array) params only; wrap a bare
      // object param the way EIP-1193 callers sometimes pass one.
      const params =
        args.params === undefined || Array.isArray(args.params)
          ? args.params
          : [args.params];
      return qrl.request({ method: args.method, params }) as Promise<T>;
    },
  };
  return adapter;
}

/** True when the SDK has a stored (unexpired at last write) pairing session. */
export function hasMobileSession(): boolean {
  try {
    return localStorage.getItem(SDK_SESSION_KEY) !== null;
  } catch {
    return false;
  }
}

async function createInstance(store: MobileConnectStore): Promise<QRLConnect> {
  const { QRLConnect } = await import("@qrlwallet/connect");
  const qrl = new QRLConnect({
    dappMetadata: {
      name: "MyQRLWallet Web",
      url: window.location.origin,
      // Peer redirect: after approving on the phone, return the user here.
      redirectUrl: window.location.href,
    },
    autoReconnect: true,
    // MANDATORY: the web wallet must never announce itself as an EIP-6963
    // provider; it would show up in its own extension picker (and in every
    // dApp's) as a wallet.
    announceProvider: false,
  });

  // The SDK emits 'connect' (relay status CONNECTED) and 'accountsChanged'
  // independently and in no guaranteed order: 'connect' can fire while
  // getAccounts() is still empty, with the address arriving via a later
  // 'accountsChanged'. So BOTH handlers publish the provider, and the
  // provider is set eagerly, never gated on account adoption completing:
  // otherwise a mobile account can be active with a null provider and every
  // send fails with "Mobile app wallet not connected".
  qrl.on("connect", () => {
    store.setMobileProvider(asExtensionProvider(qrl));
    const address = qrl.getAccounts()[0];
    if (!address) {
      log("Mobile connect: relay connected, awaiting accounts");
      return;
    }
    log(`Mobile connect: paired with ${address}`);
    void store.adoptMobileAccount(address).catch((error: unknown) => {
      console.error("Mobile connect: failed to adopt paired account:", error);
    });
  });

  qrl.on("accountsChanged", (accounts: string[]) => {
    const next = accounts[0];
    if (!next) {
      // Wallet revoked account access: same cleanup as a terminate.
      log("Mobile connect: accounts revoked");
      store.setMobileProvider(null);
      void store.removeMobileAccounts().catch((error: unknown) => {
        console.error("Mobile connect: failed to remove accounts:", error);
      });
      return;
    }
    log(`Mobile connect: account changed to ${next}`);
    store.setMobileProvider(asExtensionProvider(qrl));
    void store.adoptMobileAccount(next).catch((error: unknown) => {
      console.error("Mobile connect: failed to adopt changed account:", error);
    });
  });

  qrl.on("disconnect", () => {
    // The SDK also emits 'disconnect' when the phone is merely backgrounded
    // (routine on mobile: the app loses its socket within seconds). The
    // stored session survives that, and any request revives it: relay-
    // buffered and, on SDK >= 3.3.0, deep-linked awake. Keep the account.
    if (qrl.hasStoredSession()) {
      log("Mobile connect: transient disconnect (session kept)");
      return;
    }
    // Real terminate (phone-side disconnect, or a stale session whose
    // startup reconnect gave up): drop the provider and the account.
    log("Mobile connect: session terminated");
    store.setMobileProvider(null);
    void store.removeMobileAccounts().catch((error: unknown) => {
      console.error("Mobile connect: failed to remove accounts:", error);
    });
  });

  return qrl;
}

/** Lazy singleton. The first caller's store gets wired into the events. */
export async function getMobileConnect(store: MobileConnectStore): Promise<QRLConnect> {
  if (instance) return instance;
  creating ??= createInstance(store).then((qrl) => {
    instance = qrl;
    creating = null;
    return qrl;
  });
  return creating;
}

/**
 * Live pairing-status updates for the QR dialog. No-op unsubscribe when the
 * SDK instance does not exist yet (callers subscribe after startMobilePairing,
 * which guarantees creation).
 */
export function subscribeMobileStatus(cb: (status: string) => void): () => void {
  const qrl = instance;
  if (!qrl) return () => undefined;
  const handler = (status: unknown) => cb(String(status));
  qrl.on("statusChanged", handler);
  return () => {
    qrl.off("statusChanged", handler);
  };
}

export interface MobilePairingStart {
  uri: string;
  /** True when a mobile-browser deep link into the app succeeded (no QR needed). */
  redirected: boolean;
  /** Set when the deep link failed: the app is likely not installed. */
  installHint: string | null;
}

/**
 * Begin (or resume) pairing: returns the qrlconnect:// URI for the QR dialog.
 * On mobile browsers it first tries to deep-link straight into the app.
 */
export async function startMobilePairing(
  store: MobileConnectStore,
  fresh = false,
): Promise<MobilePairingStart> {
  const qrl = await getMobileConnect(store);
  const { attemptWalletRedirect, getAppStoreUrl } = await import("@qrlwallet/connect");
  const uri = fresh ? await qrl.newConnection() : await qrl.getConnectionURI();
  if (qrl.isMobile()) {
    const opened = await attemptWalletRedirect(uri);
    if (opened) return { uri, redirected: true, installHint: null };
    return {
      uri,
      redirected: false,
      installHint: `MyQRLWallet app not detected. Install it (${getAppStoreUrl()}) or scan the code with the app on another device.`,
    };
  }
  return { uri, redirected: false, installHint: null };
}

/**
 * End the pairing from this side. Notifies the phone when a live instance
 * exists; otherwise just drops the SDK's stored session so it cannot
 * auto-reconnect on the next load.
 */
export async function disconnectMobile(): Promise<void> {
  try {
    if (instance) {
      await instance.disconnect();
    } else {
      localStorage.removeItem(SDK_SESSION_KEY);
      localStorage.removeItem(SDK_INFLIGHT_KEY);
    }
  } catch (error) {
    console.error("Mobile connect: disconnect failed:", error);
    try {
      localStorage.removeItem(SDK_SESSION_KEY);
      localStorage.removeItem(SDK_INFLIGHT_KEY);
    } catch { /* storage unavailable */ }
  }
}

/**
 * Startup restore: if the SDK holds a stored pairing AND the account list
 * still contains a mobile-sourced account, re-create the provider so
 * autoReconnect resumes the session. A stored SDK session without a matching
 * account (wallet was logged out / wiped) is discarded instead, so a wiped
 * wallet never resurrects from SDK localStorage.
 */
export async function maybeRestoreMobileConnection(
  store: MobileConnectStore,
  hasMobileAccount: boolean,
): Promise<void> {
  if (!hasMobileSession()) return;
  if (!hasMobileAccount) {
    log("Mobile connect: stored SDK session without a mobile account; discarding");
    await disconnectMobile();
    return;
  }
  const qrl = await getMobileConnect(store);
  // Provider is usable immediately; requests made before the socket resumes
  // are buffered/relayed by the SDK. The 'connect' event re-confirms the
  // account when the handshake completes.
  store.setMobileProvider(asExtensionProvider(qrl));
}
