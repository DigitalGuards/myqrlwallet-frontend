import { Button } from "@/components/UI/Button"
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
import { useStore } from "@/stores/store";
import { fetchTokenInfo, fetchBalance } from "@/utils/web3";
import { TokenInterface } from "@/constants";
import { ZOND_PROVIDER } from "@/config";
import { StorageUtil } from "@/utils/storage";

export function AddTokenModal({ isOpen, onClose }: { isOpen: boolean, onClose: () => void }) {
    const { zondStore } = useStore();
    const {
        addToken: addTokenToStore,
        activeAccount: { accountAddress: activeAccountAddress },
    } = zondStore;
    const [tokenAddress, setTokenAddress] = useState("");
    const [tokenInfo, setTokenInfo] = useState<TokenInterface | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

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
            if (tokenAddress.length === 41 && tokenAddress.startsWith("Z")) {
                try {
                    setIsLoading(true);
                    const selectedBlockChain = await StorageUtil.getBlockChain();
                    const { name, symbol, decimals } = await fetchTokenInfo(tokenAddress, ZOND_PROVIDER[selectedBlockChain].url);
                    const balance = await fetchBalance(tokenAddress, activeAccountAddress, ZOND_PROVIDER[selectedBlockChain].url);
                    setTokenInfo({ name, symbol, decimals: parseInt(decimals.toString()), address: tokenAddress, amount: balance.toString() });
                } catch (error) {
                    console.error("Error fetching token info", error);
                }
            }
            setIsLoading(false);
        }
        init();
    }, [tokenAddress, activeAccountAddress]);

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-[600px]">
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
}
