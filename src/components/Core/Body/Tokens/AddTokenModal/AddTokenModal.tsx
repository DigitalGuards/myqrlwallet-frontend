import { Button } from "@/components/UI/Button"
import { Checkbox } from "@/components/UI/CheckBox"
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
import { useEffect, useMemo, useState } from "react";
import { observer } from "mobx-react-lite";
import { Loader2, Sparkles } from "lucide-react";
import { useStore } from "@/stores/store";
import { fetchTokenInfo, fetchBalance } from "@/utils/web3";
import type { TokenInterface } from "@/constants";
import { QRL_PROVIDER } from "@/config";
import { StorageUtil } from "@/utils/storage";

export const AddTokenModal = observer(({ isOpen, onClose }: { isOpen: boolean, onClose: () => void }) => {
    const { qrlStore, tokenStore } = useStore();
    const { addToken: addTokenToStore, pendingDiscoveredTokens } = tokenStore;
    const { accountAddress: activeAccountAddress } = qrlStore.activeAccount;
    const [tokenAddress, setTokenAddress] = useState("");
    const [tokenInfo, setTokenInfo] = useState<TokenInterface | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isAddingPicks, setIsAddingPicks] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [selectedAddresses, setSelectedAddresses] = useState<Set<string>>(new Set());

    // Re-fire discovery whenever the modal opens so the picker can't go
    // stale if the card mounted long ago. Drops selection state on reopen.
    useEffect(() => {
        if (!isOpen || !activeAccountAddress) return;
        setSelectedAddresses(new Set());
        void tokenStore.discoverTokensForReview(activeAccountAddress);
    }, [isOpen, activeAccountAddress, tokenStore]);

    // pendingDiscoveredTokens filters out already-added tokens. Lower-cased
    // address keys for selection so the picker matches the store's dedupe.
    const selectableAddresses = useMemo(
        () => pendingDiscoveredTokens.map((t) => t.address.toLowerCase()),
        [pendingDiscoveredTokens],
    );

    // Prune selectedAddresses if a discovered token has since been added
    // elsewhere — keeps the "Add Selected (n)" count honest.
    useEffect(() => {
        setSelectedAddresses((prev) => {
            const allow = new Set(selectableAddresses);
            const next = new Set<string>();
            for (const a of prev) if (allow.has(a)) next.add(a);
            return next.size === prev.size ? prev : next;
        });
    }, [selectableAddresses]);

    const toggleSelection = (address: string) => {
        const key = address.toLowerCase();
        setSelectedAddresses((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    };

    const addSelected = async () => {
        if (selectedAddresses.size === 0) return;
        setIsAddingPicks(true);
        setError(null);
        try {
            const picks = pendingDiscoveredTokens.filter((t) =>
                selectedAddresses.has(t.address.toLowerCase()),
            );
            await tokenStore.addDiscoveredTokens(picks);
            setSelectedAddresses(new Set());
            onClose();
        } catch (err) {
            setError(
                err instanceof Error
                    ? `Failed to add picks: ${err.message}`
                    : "Failed to add picks.",
            );
        } finally {
            setIsAddingPicks(false);
        }
    };

    const addToken = async () => {
        setError(null);
        if (tokenInfo) {
            const data = await addTokenToStore(tokenInfo);
            if (data) {
                setTokenInfo(null);
                setTokenAddress("");
                onClose();
            } else {
                setError("Token already exists. Please enter a different token address.");
            }
        } else {
            setError("Please enter a valid token address.");
        }
    }

    useEffect(() => {
        const init = async () => {
            if (tokenAddress.length === 41 && tokenAddress.startsWith("Q")) {
                try {
                    setIsLoading(true);
                    setError(null);
                    const selectedBlockChain = await StorageUtil.getBlockChain();
                    const { name, symbol, decimals } = await fetchTokenInfo(tokenAddress, QRL_PROVIDER[selectedBlockChain].url);
                    const balance = await fetchBalance(tokenAddress, activeAccountAddress, QRL_PROVIDER[selectedBlockChain].url);
                    setTokenInfo({ name, symbol, decimals: parseInt(decimals.toString()), address: tokenAddress, amount: balance.toString() });
                } catch (err) {
                    console.error("Error fetching token info", err);
                    setTokenInfo(null);
                    setError(
                        err instanceof Error
                            ? `Could not fetch token info — the address may not be a QRC-20 token contract. (${err.message})`
                            : "Could not fetch token info. The address may not be a token contract."
                    );
                }
            }
            setIsLoading(false);
        }
        init();
    }, [tokenAddress, activeAccountAddress]);

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-[600px] max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Add Token</DialogTitle>
                    <DialogDescription>
                        Add a new token to your wallet
                    </DialogDescription>
                </DialogHeader>
                {error && (
                    <div role="alert" className="rounded-md bg-destructive/15 p-3 text-sm text-destructive">
                        {error}
                    </div>
                )}

                {pendingDiscoveredTokens.length > 0 && (
                    <div className="rounded-md border bg-muted/30 p-3">
                        <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                            <Sparkles className="h-4 w-4 text-muted-foreground/70" />
                            Discovered tokens ({pendingDiscoveredTokens.length})
                        </div>
                        <p className="mb-3 text-xs text-muted-foreground">
                            The explorer sees these on this address. Pick the ones you trust; the rest stay off your dashboard.
                        </p>
                        <ul className="flex max-h-60 flex-col gap-2 overflow-y-auto">
                            {pendingDiscoveredTokens.map((t) => {
                                const key = t.address.toLowerCase();
                                const checked = selectedAddresses.has(key);
                                return (
                                    <li
                                        key={key}
                                        className="flex items-center gap-3 rounded-md border bg-background p-2"
                                    >
                                        <Checkbox
                                            id={`discovered-${key}`}
                                            checked={checked}
                                            onCheckedChange={() => toggleSelection(t.address)}
                                            disabled={isAddingPicks}
                                        />
                                        <Label
                                            htmlFor={`discovered-${key}`}
                                            className="flex flex-1 cursor-pointer flex-col gap-0.5"
                                        >
                                            <span className="text-sm font-medium">
                                                {t.name || "Unknown"}{" "}
                                                <span className="text-muted-foreground">
                                                    ({t.symbol || "UNK"})
                                                </span>
                                            </span>
                                            <span className="break-all font-mono text-xs text-muted-foreground">
                                                {t.address}
                                            </span>
                                        </Label>
                                    </li>
                                );
                            })}
                        </ul>
                        <Button
                            type="button"
                            size="sm"
                            className="mt-3 w-full"
                            disabled={selectedAddresses.size === 0 || isAddingPicks}
                            onClick={addSelected}
                        >
                            {isAddingPicks ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Adding…
                                </>
                            ) : (
                                <>Add Selected ({selectedAddresses.size})</>
                            )}
                        </Button>
                    </div>
                )}

                <div className="flex flex-col">
                    <Label htmlFor="name" className="mb-2">
                        Token Contract Address
                    </Label>
                    <Input className="col-span-3" value={tokenAddress} onChange={(e) => { setTokenAddress(e.target.value); setError(null); }} />
                </div>
                {tokenInfo && (
                    <div className="grid gap-4 py-4">
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="name" className="text-right">
                                Token Name
                            </Label>
                            <Input className="col-span-3" value={tokenInfo.name} disabled />
                        </div>
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="symbol" className="text-right">
                                Token Symbol
                            </Label>
                            <Input className="col-span-3" value={tokenInfo.symbol} disabled />
                        </div>
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="decimals" className="text-right">
                                Token Decimals
                            </Label>
                            <Input className="col-span-3" value={tokenInfo.decimals} disabled />
                        </div>
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="amount" className="text-right">
                                Token Amount
                            </Label>
                            <Input className="col-span-3" value={tokenInfo.amount} disabled />
                        </div>
                    </div>
                )}

                <DialogFooter>
                    <Button className="w-full" type="button" disabled={tokenAddress.length === 0 || isLoading} onClick={addToken}>Add Token</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
});
