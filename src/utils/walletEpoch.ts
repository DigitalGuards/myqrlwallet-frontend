export type WalletEpoch = string;

export const INITIAL_WALLET_EPOCH: WalletEpoch = "legacy";
export const WALLET_EPOCH_STORAGE_KEY = "qrlwallet:wallet-epoch-v1";
const WALLET_EPOCH_CHANNEL_NAME = "qrlwallet:wallet-epoch-v1";
export const WALLET_MUTATION_LOCK_NAME = "qrlwallet:wallet-mutation-v1";

type WalletEpochListener = (epoch: WalletEpoch) => void;

const listeners = new Set<WalletEpochListener>();
let observedEpoch: WalletEpoch = INITIAL_WALLET_EPOCH;
let volatileEpoch: WalletEpoch | null = null;
let volatileBaseEpoch: WalletEpoch | null = null;
let listenersInstalled = false;
let broadcastChannel: BroadcastChannel | null = null;

function parseEpoch(value: string | null): WalletEpoch {
  return value !== null && /^[0-9a-f]{32}$/.test(value)
    ? value
    : INITIAL_WALLET_EPOCH;
}

function readStoredEpoch(): WalletEpoch {
  try {
    return typeof localStorage === "undefined"
      ? INITIAL_WALLET_EPOCH
      : parseEpoch(localStorage.getItem(WALLET_EPOCH_STORAGE_KEY));
  } catch {
    return INITIAL_WALLET_EPOCH;
  }
}

function notifyDifferentEpoch(epoch: WalletEpoch): void {
  if (epoch === observedEpoch) return;
  observedEpoch = epoch;
  for (const listener of listeners) {
    try {
      listener(epoch);
    } catch (error) {
      console.error("[WalletEpoch] Listener failed:", error);
    }
  }
}

function acceptCrossTabEpoch(): void {
  // Event delivery can be reordered across tabs. localStorage is the final
  // authority, so a delayed BroadcastChannel payload cannot roll this realm
  // back to a generation that is no longer persisted.
  const storedEpoch = readStoredEpoch();
  if (volatileEpoch !== null && storedEpoch === volatileBaseEpoch) return;
  volatileEpoch = null;
  volatileBaseEpoch = null;
  notifyDifferentEpoch(storedEpoch);
}

function installCrossTabListeners(): void {
  if (listenersInstalled || typeof window === "undefined") return;
  listenersInstalled = true;
  observedEpoch = readStoredEpoch();

  window.addEventListener("storage", (event) => {
    if (event.key !== WALLET_EPOCH_STORAGE_KEY) return;
    acceptCrossTabEpoch();
  });

  if (typeof window.BroadcastChannel !== "function") return;
  try {
    broadcastChannel = new window.BroadcastChannel(WALLET_EPOCH_CHANNEL_NAME);
    broadcastChannel.addEventListener("message", (event) => {
      const data = event.data as {
        epoch?: unknown;
        volatile?: unknown;
        baseEpoch?: unknown;
      } | null;
      const epoch = data?.epoch;
      if (typeof epoch === "string" && /^[0-9a-f]{32}$/.test(epoch)) {
        if (data?.volatile === true) {
          const baseEpoch = data.baseEpoch;
          if (
            (baseEpoch !== INITIAL_WALLET_EPOCH &&
              (typeof baseEpoch !== "string" ||
                !/^[0-9a-f]{32}$/.test(baseEpoch))) ||
            readStoredEpoch() !== baseEpoch
          ) {
            return;
          }
          volatileBaseEpoch = baseEpoch;
          volatileEpoch = epoch;
          notifyDifferentEpoch(epoch);
          return;
        }
        acceptCrossTabEpoch();
      }
    });
  } catch (error) {
    // Storage events remain the compatibility path when BroadcastChannel is
    // unavailable or disabled by the browser's privacy policy.
    console.warn("[WalletEpoch] BroadcastChannel unavailable:", error);
  }
}

function generateEpoch(): WalletEpoch {
  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto?.getRandomValues !== "function") {
    throw new Error("Secure wallet epoch randomness is unavailable");
  }
  try {
    globalThis.crypto.getRandomValues(bytes);
  } catch {
    throw new Error("Secure wallet epoch randomness is unavailable");
  }
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join(
    "",
  );
}

/** Return the wallet identity generation currently authoritative in this tab. */
export function getWalletEpoch(): WalletEpoch {
  installCrossTabListeners();
  if (volatileEpoch !== null) return volatileEpoch;
  const storedEpoch = readStoredEpoch();
  notifyDifferentEpoch(storedEpoch);
  return observedEpoch;
}

export function isWalletEpochCurrent(epoch: WalletEpoch): boolean {
  return epoch === getWalletEpoch();
}

/**
 * Replace the persistent wallet identity generation before clearing secrets
 * or reconnect checkpoints. Generations are random equality tokens instead
 * of counters: concurrent tabs can write in either order without making a
 * later write look "older" and therefore ignorable.
 */
export function advanceWalletEpoch(): WalletEpoch {
  installCrossTabListeners();
  const current = getWalletEpoch();
  let next = generateEpoch();
  while (next === current) next = generateEpoch();

  if (typeof localStorage === "undefined") {
    volatileEpoch = next;
    volatileBaseEpoch = current;
    notifyDifferentEpoch(next);
    return next;
  }
  try {
    localStorage.setItem(WALLET_EPOCH_STORAGE_KEY, next);
    volatileEpoch = null;
    volatileBaseEpoch = null;
  } catch {
    // Preserve a realm-local boundary so a storage failure cannot let old
    // async work resume or brick the coordinator's subsequent cleanup.
    volatileEpoch = next;
    volatileBaseEpoch = current;
    notifyDifferentEpoch(next);
    try {
      // This cannot make the wipe durable, but it immediately invalidates
      // live sibling tabs until persistent storage becomes available again.
      broadcastChannel?.postMessage({
        epoch: next,
        volatile: true,
        baseEpoch: current,
      });
    } catch (error) {
      console.warn("[WalletEpoch] Could not broadcast volatile epoch:", error);
    }
    throw new Error("Could not persist the wallet clear boundary");
  }
  notifyDifferentEpoch(next);
  try {
    broadcastChannel?.postMessage({ epoch: next });
  } catch (error) {
    console.warn("[WalletEpoch] Could not broadcast wallet epoch:", error);
  }
  return next;
}

export function subscribeWalletEpoch(
  listener: WalletEpochListener,
): () => void {
  installCrossTabListeners();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Serialize sensitive wallet mutations across tabs when the browser exposes
 * the same origin-wide lock primitive already required by QRL Connect.
 * Epoch guards remain the fail-safe path in older browsers.
 */
export async function withWalletMutationLock<T>(
  operation: () => Promise<T>,
): Promise<T> {
  if (
    typeof navigator === "undefined" ||
    typeof navigator.locks?.request !== "function"
  ) {
    return operation();
  }
  return navigator.locks.request(
    WALLET_MUTATION_LOCK_NAME,
    { mode: "exclusive" },
    operation,
  );
}
