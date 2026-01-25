import { Button } from "@/components/UI/Button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/UI/Dialog"
import { Input } from "@/components/UI/Input"
import { Label } from "@/components/UI/Label"
import { useEffect, useState } from "react";
import { ZOND_PROVIDER } from "@/config";
import { useStore } from "@/stores/store";
import { StorageUtil } from "@/utils/storage";
import { Loader2 } from "lucide-react";

/**
 * Validate that the input is a valid HTTP/HTTPS URL
 */
function isValidRpcUrl(url: string): { valid: boolean; error?: string } {
    if (!url.trim()) {
        return { valid: false, error: "RPC URL is required" };
    }

    // Check URL format
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return { valid: false, error: "Invalid URL format" };
    }

    // Must be http or https
    if (!['http:', 'https:'].includes(parsed.protocol)) {
        return { valid: false, error: "URL must start with http:// or https://" };
    }

    // Must have a hostname
    if (!parsed.hostname) {
        return { valid: false, error: "URL must include a hostname" };
    }

    return { valid: true };
}

/**
 * Test RPC endpoint by making a simple JSON-RPC call
 */
async function testRpcConnection(url: string): Promise<{ success: boolean; error?: string }> {
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                method: 'eth_chainId',
                params: [],
                id: 1
            }),
            signal: AbortSignal.timeout(10000) // 10 second timeout
        });

        if (!response.ok) {
            return { success: false, error: `Server returned ${response.status}` };
        }

        const data = await response.json();
        if (data.error) {
            return { success: false, error: data.error.message || "RPC error" };
        }

        if (!data.result) {
            return { success: false, error: "Invalid RPC response" };
        }

        return { success: true };
    } catch (error) {
        if (error instanceof Error) {
            if (error.name === 'TimeoutError') {
                return { success: false, error: "Connection timed out" };
            }
            return { success: false, error: error.message };
        }
        return { success: false, error: "Connection failed" };
    }
}

export function CustomRpcModal({ isOpen, onClose }: { isOpen: boolean, onClose: () => void }) {
    const { CUSTOM_RPC } = ZOND_PROVIDER;
    const [rpcUrl, setRpcUrl] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [isTesting, setIsTesting] = useState(false);
    const { zondStore } = useStore();
    const { setCustomRpcUrl, selectBlockchain } = zondStore;

    const selectCustomRpc = async () => {
        setError(null);

        // Validate URL format
        const validation = isValidRpcUrl(rpcUrl);
        if (!validation.valid) {
            setError(validation.error || "Invalid URL");
            return;
        }

        // Test the RPC connection
        setIsTesting(true);
        const test = await testRpcConnection(rpcUrl);
        setIsTesting(false);

        if (!test.success) {
            setError(`Connection failed: ${test.error}`);
            return;
        }

        // Success - save and close
        selectBlockchain(CUSTOM_RPC.id);
        setCustomRpcUrl(rpcUrl);
        onClose();
    }

    useEffect(() => {
        if (isOpen) {
            const fetchCustomRpcUrl = async () => {
                const customRpcUrl = await StorageUtil.getCustomRpcUrl();
                if (customRpcUrl) {
                    setRpcUrl(customRpcUrl);
                }
            }
            fetchCustomRpcUrl();
        } else {
            // Intentional cleanup when modal closes - resetting form state
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setError(null);
            setIsTesting(false);
        }
    }, [isOpen]);

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-[600px]">
                <DialogHeader>
                    <DialogTitle>Custom RPC</DialogTitle>
                    <DialogDescription>
                        Enter a custom RPC URL to connect to a different node
                    </DialogDescription>
                </DialogHeader>
                {error && (
                    <div className="rounded-md bg-destructive/15 p-3 text-sm text-destructive">
                        {error}
                    </div>
                )}
                <div className="grid gap-4 py-4">
                    <div className="flex flex-col">
                        <Label htmlFor="rpcUrl" className="mb-2">
                            RPC URL
                        </Label>
                        <Input
                            id="rpcUrl"
                            placeholder="https://rpc.example.com:8545"
                            value={rpcUrl}
                            onChange={(e) => { setRpcUrl(e.target.value); setError(null); }}
                            disabled={isTesting}
                        />
                        <p className="text-xs text-muted-foreground mt-1">
                            Must be a valid HTTP or HTTPS URL
                        </p>
                    </div>
                </div>
                <DialogFooter>
                    <Button onClick={selectCustomRpc} disabled={isTesting || !rpcUrl.trim()}>
                        {isTesting ? (
                            <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Testing connection...
                            </>
                        ) : (
                            "Connect"
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
