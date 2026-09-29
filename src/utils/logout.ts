import { ROUTES } from "@/router/router";
import StorageUtil from "./storage/storage";
import { QRL_PROVIDER } from "@/config";
import { IS_V3_PROFILE } from "@/config/runtimeProfile";
import { isInNativeApp, clearNativeInjectedPin } from "./nativeApp";
import { clearAttemptTracker } from "./crypto/pinAttemptTracker";
import { isDesktop, desktopSigner } from "@/desktop/bridge";
import {
  disconnectMobile,
  hasMobileSession,
} from "./mobileConnect/mobileConnection";
import { clearDeviceCredential } from "./crypto/deviceCredential";
import { dappConnectService } from "@/services/dappConnect/DAppConnectService";
import { walletMutations } from "./nativeWalletMutation";
import { reloadDocument } from "./embeddedShell";

/**
 * Return to the home route and drop the wallet state still held in memory.
 *
 * Web and desktop reload the document, which is the cheapest complete reset.
 * The app-shipped embedded build cannot: its document was injected into the
 * WebView as a string under the qrlwallet.com baseUrl and is served by no
 * origin, so a reload would fetch the live site and replace the audited bundle
 * that came out of the signed app binary.
 *
 * Everything the reload used to drop therefore has to be dropped by hand. The
 * embedded build always runs inside the native app, so `isInNativeApp()` is
 * true and the caller's `if (!nativeApp)` branch deliberately leaves the
 * device credential and the attempt tracker alone. That left the module-level
 * state below alive across an embedded logout, including the plaintext PIN the
 * native app injects for prompt-free signing.
 *
 * The saved PIN lockout counter is deliberately NOT cleared. The native logout
 * path keeps it on purpose: clearing it would turn logout into a way to reset
 * the failed-attempt count and remove the lockout, which is the opposite of
 * what logging out should do.
 *
 * `clearDeviceCredential()` is safe to call here: inside the native app it
 * only nulls the in-memory key cache and returns before touching the stored
 * credential, which the native logout path preserves on purpose.
 *
 * The store is pulled in dynamically to avoid an import cycle: the stores
 * import the `@/utils` barrel, which re-exports this module. Rolldown reports
 * the dynamic import as ineffective for chunking, which is expected and fine;
 * the store is already in the main graph and splitting it was never the point.
 */
const resetEmbeddedState = async (): Promise<void> => {
  // Synchronous and unfailing, so the secret goes first.
  clearNativeInjectedPin();

  await clearDeviceCredential().catch((error) =>
    console.error("Logout: device key cache clear failed", error),
  );

  const { store } = await import("@/stores/store");
  store.qrlStore.resetTransactionStatus();
  await store.qrlStore.setActiveAccount(undefined);
};

const finishLogout = async (
  navigate: (path: string) => void,
): Promise<void> => {
  navigate(ROUTES.HOME);
  // reloadDocument() refuses in the embedded build, where the statement is not
  // merely unreached: it is removed at build time.
  if (reloadDocument()) return;
  // Every caller fires this and forgets it, so a rejection here would surface
  // as an unhandled rejection with the user left on a half-logged-out screen.
  // The secrets are already cleared by the time anything below can throw.
  try {
    await resetEmbeddedState();
  } catch (error) {
    console.error("Logout: embedded state reset did not complete:", error);
  }
};

/**
 * A utility function to handle logout by clearing
 * all wallet-specific data and redirecting to the home page.
 *
 * This function uses StorageUtil methods to ensure proper
 * data cleanup and maintains encryption/security controls.
 *
 * On web: Clears all encrypted seeds (user must re-import wallet)
 * On native app: Seeds persist in native storage and are restored on app launch
 *
 * @param navigate - The navigate function from react-router
 */
/**
 * Lock the isolated desktop signer before touching fallible relay state.
 * Neither failure may be presented as a completed logout.
 */
export const secureDesktopLogout = async (): Promise<void> => {
  await desktopSigner.lock();
  await dappConnectService.clearAllSessions();
};

export const handleLogout = async (navigate: (path: string) => void) => {
  // Desktop: the seed lives in the isolated signer, NOT in localStorage,
  // so logout LOCKS the signer session (drops the in-memory keys) instead
  // of wiping. A wipe here would clear the UI's account list while the
  // encrypted seed file persists in the signer, orphaning the wallet.
  // Re-entry is a password unlock (the desktop unlock screen). Fully
  // removing the wallet from the device is a separate, explicit action
  // that deletes the signer's seed file, not this button.
  if (isDesktop) {
    try {
      await secureDesktopLogout();
      await finishLogout(navigate);
    } catch (error) {
      console.error("Desktop logout did not complete:", error);
    }
    return;
  }

  try {
    const nativeApp = isInNativeApp();
    const blockchains = IS_V3_PROFILE
      ? ["TEST_NET_V3"]
      : Object.keys(QRL_PROVIDER).filter((id) => id !== "TEST_NET_V3");

    const clearWalletStorage = async () => {
      for (const blockchain of blockchains) {
        await StorageUtil.clearActiveAccount(blockchain);
        await StorageUtil.clearTransactionValues(blockchain);

        // Native logout locks the UI while preserving its seed backup.
        if (!nativeApp) {
          StorageUtil.clearAllEncryptedSeeds(blockchain);
          StorageUtil.clearAccountList(blockchain);
        }
      }
    };

    await walletMutations.clear(clearWalletStorage, async () => {
      // The coordinator already advanced the shared epoch.
      await dappConnectService.clearAllSessions(false);
      if (hasMobileSession()) {
        await disconnectMobile().catch((err) =>
          console.error("Logout: mobile pairing disconnect failed", err),
        );
      }

      if (!nativeApp) {
        clearAttemptTracker();
        await clearDeviceCredential().catch((error) =>
          console.error("Logout: device credential clear failed", error),
        );
      }
    });

    // NOTE: token and NFT lists are intentionally NOT cleared here.
    // They are public contract addresses (not secrets) keyed per
    // account, so preserving them means re-importing the same account
    // restores its curated token/NFT lists instead of forcing the
    // user to re-add every contract. A full wipe (CLEAR_WALLET) does
    // clear them.

    // Navigate home and reset whatever state is still in memory.
    await finishLogout(navigate);
  } catch (error) {
    console.error("Error during logout:", error);
    // Fallback: navigate and reset anyway.
    await finishLogout(navigate);
  }
};
