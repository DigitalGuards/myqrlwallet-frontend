import { ROUTES } from "@/router/router";
import StorageUtil from "./storage/storage";
import { QRL_PROVIDER } from "@/config";
import { isInNativeApp } from "./nativeApp";
import { clearAttemptTracker } from "./crypto/pinAttemptTracker";
import { isDesktop, desktopSigner } from "@/desktop/bridge";
import { disconnectMobile, hasMobileSession } from "./mobileConnect/mobileConnection";

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
export const handleLogout = async (navigate: (path: string) => void) => {
    try {
        // Desktop: the seed lives in the isolated signer, NOT in localStorage,
        // so logout LOCKS the signer session (drops the in-memory keys) instead
        // of wiping. A wipe here would clear the UI's account list while the
        // encrypted seed file persists in the signer, orphaning the wallet.
        // Re-entry is a password unlock (the desktop unlock screen). Fully
        // removing the wallet from the device is a separate, explicit action
        // that deletes the signer's seed file, not this button.
        if (isDesktop) {
            await desktopSigner
                .lock()
                .catch((err) => console.error("Desktop logout: signer lock failed", err));
            navigate(ROUTES.HOME);
            window.location.reload();
            return;
        }

        // End any mobile-app pairing first (best-effort, notifies the phone
        // when live) so the SDK session in localStorage cannot silently
        // re-pair on the next load after the account list is wiped.
        if (hasMobileSession()) {
            await disconnectMobile().catch((err) =>
                console.error("Logout: mobile pairing disconnect failed", err),
            );
        }

        // Get all blockchain types
        const blockchains = Object.keys(QRL_PROVIDER);

        // Clear active accounts and encrypted seeds for all blockchains
        for (const blockchain of blockchains) {
            await StorageUtil.clearActiveAccount(blockchain);
            await StorageUtil.clearTransactionValues(blockchain);

            // On web app, clear all encrypted seeds on logout
            // On native app, seeds persist (backed up to native storage)
            if (!isInNativeApp()) {
                StorageUtil.clearAllEncryptedSeeds(blockchain);
                StorageUtil.clearAccountList(blockchain);
            }
        }

        // Clear PIN attempt tracker on web logout
        if (!isInNativeApp()) {
            clearAttemptTracker();
        }

        // NOTE: token and NFT lists are intentionally NOT cleared here.
        // They are public contract addresses (not secrets) keyed per
        // account, so preserving them means re-importing the same account
        // restores its curated token/NFT lists instead of forcing the
        // user to re-add every contract. A full wipe (CLEAR_WALLET) does
        // clear them.

        // Navigate to homepage
        navigate(ROUTES.HOME);

        // Reload the application to reset all state
        window.location.reload();
    } catch (error) {
        console.error("Error during logout:", error);
        // Fallback: navigate and reload anyway
        navigate(ROUTES.HOME);
        window.location.reload();
    }
};
