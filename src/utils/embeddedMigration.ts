/**
 * One-time cleanup when the app upgrades from the hosted wallet to the
 * app-shipped document.
 *
 * An install that used to load https://qrlwallet.com carries that origin's
 * localStorage into the embedded document, because the WebView is handed the
 * same baseUrl. Encrypted seeds, PIN state, settings and the address book are
 * exactly what should survive. Pairing sessions are not: the relay channels
 * and the remote-signer pairing belong to the old document's sockets and keys,
 * and resuming them from a new build reconnects to peers the user never
 * re-approved.
 *
 * The app's bootstrap sets `window.__QRL_EMBEDDED_MIGRATION__` on the first
 * launches after such an upgrade. When the flag is absent this module does
 * nothing at all.
 *
 * TIMING. This has to run before the MobX stores are constructed:
 * `src/stores/dappConnectStore.ts` reads the persisted sessions and calls
 * `reconnectAll()` from its constructor, and that constructor runs while
 * `src/App.tsx` is being evaluated. ES modules evaluate every import before
 * any statement in the importing file, so a call placed in `main.tsx`'s body
 * would run after the sessions had already been read and sockets opened.
 * `embeddedMigrationBoot.ts` therefore performs the work at module-evaluation
 * time and is imported above `./App.tsx`. Nothing here may import a module
 * that reaches `src/stores/store.ts`.
 *
 * Everything below is synchronous, so the clearing is complete before the next
 * module in the graph is evaluated.
 */

/** Set by the app's bootstrap on the first launches after the upgrade. */
export const EMBEDDED_MIGRATION_FLAG = "__QRL_EMBEDDED_MIGRATION__";

/** Reported to the app once the cleanup has run. */
export const EMBEDDED_MIGRATION_DONE_MESSAGE = "EMBEDDED_MIGRATION_DONE";

/**
 * Every persisted key that holds a pairing session, and nothing else.
 *
 * Both profile spellings of the wallet's own key are listed: a browser profile
 * can hold whichever form the build that wrote it used, and this build cannot
 * assume which app version stored it. `src/config/runtimeProfile.ts` prefixes
 * `qrlwallet:v3:` for the v3 profile.
 *
 * The two `@qrlwallet/connect` keys are the SDK's own defaults and carry no
 * profile prefix, because `src/utils/mobileConnect/mobileConnection.ts`
 * constructs `QRLConnect` without a `storageKey`.
 *
 * A test asserts these literals still match the modules that write them.
 */
export const MIGRATION_SESSION_KEYS: readonly string[] = [
  // Wallet-side dApp-connect sessions (src/services/dappConnect/SessionStore.ts)
  "qrlconnect:sessions",
  "qrlwallet:v3:qrlconnect:sessions",
  // Remote-signer pairing (@qrlwallet/connect SDK, via src/utils/mobileConnect)
  "@qrlwallet/connect:session",
  "@qrlwallet/connect:session:inflight",
];

/**
 * Account-list keys are `${blockchain}_QIP55_ACCOUNT_LIST` and the pre-QIP-55
 * `${blockchain}_ACCOUNT_LIST` (src/utils/storage/storage.ts). Both end with
 * this suffix, and matching on it covers every blockchain segment without this
 * module needing to know the network list.
 */
const ACCOUNT_LIST_SUFFIX = "_ACCOUNT_LIST";

type MigrationScope = { [EMBEDDED_MIGRATION_FLAG]?: unknown };

/**
 * Drop remote-signer rows whose pairing session has just been cleared.
 *
 * A `source: "mobile"` entry is a phone acting as a remote signer over the
 * relay. It holds no seed, and without its session it can sign nothing, so it
 * would sit in the account list as a row that cannot be used.
 * `maybeRestoreMobileConnection` discards exactly this when it finds a session
 * missing (src/utils/mobileConnect/mobileConnection.ts), and clearing the SDK
 * keys here means it never gets the chance.
 *
 * Every other row is left alone: `source: "seed"` accounts own an encrypted
 * seed, `source: "extension"` accounts are signed by the browser extension,
 * and a bare string entry is the legacy spelling of a seed account.
 *
 * Values are stored wrapped as `{ value, timestamp, version }`, so the wrapper
 * is preserved and only `value` is filtered. Anything that does not parse into
 * that shape is left untouched.
 */
function pruneRemoteSignerAccounts(storage: Storage | undefined): number {
  if (storage === undefined) return 0;

  const keys: string[] = [];
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key !== null && key.endsWith(ACCOUNT_LIST_SUFFIX)) keys.push(key);
    }
  } catch {
    return 0;
  }

  let removed = 0;
  for (const key of keys) {
    try {
      const raw = storage.getItem(key);
      if (raw === null) continue;
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null) continue;
      const wrapper = parsed as { value?: unknown };
      if (!Array.isArray(wrapper.value)) continue;

      const kept = wrapper.value.filter((entry) => {
        if (typeof entry !== "object" || entry === null) return true;
        return (entry as { source?: unknown }).source !== "mobile";
      });
      if (kept.length === wrapper.value.length) continue;

      removed += wrapper.value.length - kept.length;
      storage.setItem(key, JSON.stringify({ ...wrapper, value: kept }));
    } catch {
      // A malformed or unwritable entry is left exactly as it is.
    }
  }
  return removed;
}

let alreadyRun = false;

function clearFrom(storage: Storage | undefined): number {
  if (storage === undefined) return 0;
  let removed = 0;
  for (const key of MIGRATION_SESSION_KEYS) {
    try {
      if (storage.getItem(key) !== null) removed += 1;
      storage.removeItem(key);
    } catch {
      // A blocked or full storage must not stop the rest of the cleanup.
    }
  }
  return removed;
}

function reportDone(): void {
  const bridge = window.ReactNativeWebView;
  if (typeof bridge?.postMessage !== "function") return;
  // No token field: the app's bootstrap adds the per-load token itself. This
  // introduces no new bridge protocol; the app consumes it in QRLWebView.
  bridge.postMessage(
    JSON.stringify({ type: EMBEDDED_MIGRATION_DONE_MESSAGE }),
  );
}

/**
 * Drop every pairing session and tell the app the cleanup is done.
 *
 * Returns whether the migration ran. It is a no-op without the flag, and it
 * runs at most once per document so the app receives a single message.
 *
 * Seeds, PIN state, the device credential in IndexedDB, wallet settings, token
 * and NFT lists and the address book are all left exactly as they were. The
 * account list keeps every row except the remote-signer ones whose session
 * this migration just removed.
 */
export function runEmbeddedMigration(): boolean {
  if (alreadyRun) return false;
  if (typeof window === "undefined") return false;

  const scope = window as MigrationScope;
  if (scope[EMBEDDED_MIGRATION_FLAG] !== true) return false;
  alreadyRun = true;

  const removed = clearFrom(window.localStorage);
  // No pairing state lives in sessionStorage today. Removing the same names
  // costs nothing and keeps this correct if one ever moves there.
  clearFrom(window.sessionStorage);
  const orphans = pruneRemoteSignerAccounts(window.localStorage);
  // IndexedDB holds only the device-credential store, which wraps the
  // PIN-encrypted seed. Touching it would destroy the wallet, so it is left
  // alone deliberately. The connect SDK uses no IndexedDB.

  console.info(
    `[embedded] migration from the hosted wallet cleared ${removed} pairing session key(s) ` +
      `and ${orphans} orphaned remote-signer account row(s)`,
  );
  reportDone();
  return true;
}

/** Test seam: forget that the migration already ran. */
export function resetEmbeddedMigrationForTests(): void {
  alreadyRun = false;
}
