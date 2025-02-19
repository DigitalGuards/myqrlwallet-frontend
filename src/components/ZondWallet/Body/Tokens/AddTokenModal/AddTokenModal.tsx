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
import { fetchTokenInfo, fetchBalance } from "@/utilities/web3utils/customERC20";
import { TokenInterface } from "@/lib/constants";
import { toast } from "@/hooks/use-toast";

export function AddTokenModal({ isOpen, onClose }: { isOpen: boolean, onClose: () => void }) {
    const { zondStore } = useStore();
    const {
        addToken: addTokenToStore,
        activeAccount: { accountAddress: activeAccountAddress },
    } = zondStore;
    const [tokenAddress, setTokenAddress] = useState("");
    const [tokenInfo, setTokenInfo] = useState<TokenInterface | null>(null);

    const addToken = async () => {
        if (tokenInfo) {
            const data = await addTokenToStore(tokenInfo);
            if (data) {
                setTokenInfo(null);
                setTokenAddress("");
                onClose();
            } else {
                toast({
                    title: "Token already exists",
                    description: "Please enter a different token address",
                    variant: "destructive",
                });
            }
        } else {
            toast({
                title: "Please enter a valid token address",
                description: "Please enter a valid token address",
                variant: "destructive",
            });
        }
    }

    useEffect(() => {
        const init = async () => {
            if (tokenAddress.length === 42 && tokenAddress.startsWith("0x")) {
                try {
                    const { name, symbol, decimals } = await fetchTokenInfo(tokenAddress);
                    const balance = await fetchBalance(tokenAddress, activeAccountAddress);
                    setTokenInfo({ name, symbol, decimals: parseInt(decimals.toString()), address: tokenAddress, amount: balance.toString() });
                } catch (error) {
                    console.error("Error fetching token info", error);
                }
            }
        }
        init();
    }, [tokenAddress]);

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Add Token</DialogTitle>
                    <DialogDescription>
                        Add a new token to your wallet
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="name" className="text-right">
                            Token Address
                        </Label>
                        <Input className="col-span-3" value={tokenAddress} onChange={(e) => setTokenAddress(e.target.value)} />
                    </div>
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
                    <Button type="button" disabled={tokenAddress.length === 0} onClick={addToken}>Add Token</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
