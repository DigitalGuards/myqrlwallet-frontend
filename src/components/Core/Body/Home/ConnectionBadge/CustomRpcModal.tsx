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
 * Check if a hostname resolves to a private or reserved IP range.
 * Blocks localhost, private networks, link-local (cloud metadata), and similar.
 */
function isPrivateOrReservedHost(hostname: string): boolean {
    const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();

    // IPv6 localhost
    if (host === '::1' || host === '0:0:0:0:0:0:0:1') return true;

    // Hostname-based checks
    if (host === 'localhost' || host.endsWith('.localhost')) return true;
    // Common cloud metadata hostname
    if (host === 'metadata.google.internal') return true;

    // IPv6 reserved ranges
    if (host.startsWith('fc') || host.startsWith('fd')) return true;  // fc00::/7 Unique Local
    if (host.startsWith('fe8') || host.startsWith('fe9') ||
        host.startsWith('fea') || host.startsWith('feb')) return true; // fe80::/10 Link-Local

    // IPv4-mapped IPv6 (::ffff:x.x.x.x)
    const v4MappedMatch = host.match(/^::ffff:(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (v4MappedMatch) {
        const [a, b] = [Number(v4MappedMatch[1]), Number(v4MappedMatch[2])];
        if (isPrivateIPv4(a, b)) return true;
    }

    // IPv4 checks
    const ipv4Match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipv4Match) {
        const [a, b] = [Number(ipv4Match[1]), Number(ipv4Match[2])];
        if (isPrivateIPv4(a, b)) return true;
    }

    return false;
}

function isPrivateIPv4(a: number, b: number): boolean {
    if (a === 0) return true;                             // 0.0.0.0/8
    if (a === 127) return true;                           // 127.0.0.0/8 loopback
    if (a === 10) return true;                            // 10.0.0.0/8 private
    if (a === 172 && b >= 16 && b <= 31) return true;    // 172.16.0.0/12 private
    if (a === 192 && b === 168) return true;              // 192.168.0.0/16 private
    if (a === 169 && b === 254) return true;              // 169.254.0.0/16 link-local / cloud metadata
    return false;
}

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

    // Block credentials in URL
    if (parsed.username || parsed.password) {
        return { valid: false, error: "URL must not contain credentials" };
    }

    // Block private/reserved IP ranges
    if (isPrivateOrReservedHost(parsed.hostname)) {
        return { valid: false, error: "Cannot connect to private or reserved IP addresses" };
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
