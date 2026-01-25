import { ROUTES } from "@/router/router";
import StorageUtil from "./storage/storage";
import { ZOND_PROVIDER } from "@/config";
import { isInNativeApp } from "./nativeApp";
import { clearAttemptTracker } from "./crypto/pinAttemptTracker";

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
        // Get all blockchain types
        const blockchains = Object.keys(ZOND_PROVIDER);

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

        // Clear token list
        await StorageUtil.clearTokenList();

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
