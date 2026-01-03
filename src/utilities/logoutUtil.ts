import { ROUTES } from "@/router/router";
import StorageUtil from "./storageUtil";
import { ZOND_PROVIDER } from "@/configuration/zondConfig";

/**
 * A utility function to handle logout by clearing
 * all wallet-specific data and redirecting to the home page.
 *
 * This function uses StorageUtil methods to ensure proper
 * data cleanup and maintains encryption/security controls.
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
            // Clean up expired seeds
            await StorageUtil.cleanupExpiredSeeds(blockchain);
        }

        // Clear token list
        StorageUtil.clearTokenList();

        // Clear wallet settings (optional - uncomment if you want to reset settings on logout)
        // await StorageUtil.setWalletSettings({
        //     autoLockTimeout: 15 * 60 * 1000,
        //     showTestNetworks: false,
        //     hideSmallBalances: false,
        //     hideUnknownTokens: false,
        // });

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