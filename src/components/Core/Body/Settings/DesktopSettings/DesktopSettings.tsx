import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Trash2, AlertTriangle } from "lucide-react";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/UI/Card";
import { Button } from "@/components/UI/Button";
import { StorageUtil } from "@/utils/storage";
import { ROUTES } from "@/router/router";
import { QRL_PROVIDER } from "@/config";
import { desktopSigner } from "@/desktop/bridge";

/**
 * Desktop-only (Electron) settings. Rendered by Settings behind an isDesktop
 * gate. Today this is the destructive "remove wallet" (wipe), mirroring the
 * mobile app: locking is the everyday action (sidebar); this is the deliberate
 * removal that deletes the encrypted seed from this device and requires
 * re-import. The actual confirmation is a trusted main-process dialog (the
 * renderer cannot draw the security gate); this button just triggers it.
 * Future desktop lock options (auto-lock, unlock method) belong here too.
 */
export const DesktopSettings = () => {
    const navigate = useNavigate();
    const [isRemoving, setIsRemoving] = useState(false);
    const [removeError, setRemoveError] = useState<string | null>(null);

    async function onRemoveWallet() {
        if (isRemoving) return;
        setIsRemoving(true);
        setRemoveError(null);
        try {
            // Main draws the trusted confirmation dialog (default Cancel) and,
            // on approval, deletes the encrypted seed + clears the keychain +
            // locks the signer. A cancel rejects here and is a no-op.
            await desktopSigner.removeWallet();
        } catch (error) {
            setIsRemoving(false);
            const message = error instanceof Error ? error.message : String(error);
            // Trusted dialog cancelled: silently abort, no error banner.
            if (/reject|cancel/i.test(message)) return;
            setRemoveError(message || "Failed to remove the wallet.");
            return;
        }
        // The seed is gone in main. Clear the renderer's local state (mirroring
        // the mobile CLEAR_WALLET wipe) best-effort, then ALWAYS reload so the
        // UI re-evaluates to the create/import screen even if a clear hiccups.
        try {
            const blockchains = Object.keys(QRL_PROVIDER);
            for (const blockchain of blockchains) {
                await StorageUtil.clearActiveAccount(blockchain);
                await StorageUtil.clearTransactionValues(blockchain);
                StorageUtil.clearAllEncryptedSeeds(blockchain);
                StorageUtil.clearAccountList(blockchain);
            }
            StorageUtil.clearAllTokenData();
            StorageUtil.clearAllNftData();
        } catch (cleanupError) {
            console.error("Post-wipe local cleanup failed (reloading anyway):", cleanupError);
        }
        navigate(ROUTES.HOME);
        window.location.reload();
    }

    return (
        <Card className="border-l-4 border-l-destructive">
            <CardHeader className="bg-gradient-to-r from-destructive/5 to-transparent">
                <div className="flex items-center gap-2">
                    <AlertTriangle className="h-6 w-6 text-destructive" />
                    <CardTitle className="text-2xl font-bold">Remove Wallet</CardTitle>
                </div>
                <CardDescription>
                    Permanently remove this wallet from this device. The encrypted seed is
                    deleted and you will need your recovery phrase to restore it.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                {removeError && (
                    <div role="alert" className="rounded-md bg-destructive/15 p-3 text-sm text-destructive">
                        {removeError}
                    </div>
                )}
                <Button
                    type="button"
                    variant="destructive"
                    className="w-full"
                    disabled={isRemoving}
                    onClick={() => void onRemoveWallet()}
                >
                    <Trash2 className="mr-2 h-4 w-4" />
                    {isRemoving ? "Removing..." : "Remove wallet from this device"}
                </Button>
                <p className="text-xs text-muted-foreground">
                    You will be asked to confirm. This cannot be undone without your recovery phrase.
                </p>
            </CardContent>
        </Card>
    );
};

export default DesktopSettings;
