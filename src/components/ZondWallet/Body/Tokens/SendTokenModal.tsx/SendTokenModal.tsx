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
import { useState } from "react";
import { useStore } from "@/stores/store";
import { TokenInterface } from "@/lib/constants";
import { toast } from "@/hooks/use-toast";
import { fetchBalance, fetchTokenInfo } from "@/utilities/web3utils/customERC20";
import { Loader2 } from "lucide-react";
import { getAddressFromMnemonic } from "@/functions/getHexSeedFromMnemonic";
import StorageUtil from "@/utilities/storageUtil";
import { ZOND_PROVIDER } from "@/configuration/zondConfig";

export function SendTokenModal({ isOpen, onClose, token }: { isOpen: boolean, onClose: () => void, token: TokenInterface }) {
    const { zondStore } = useStore();
    const {
        sendToken: sendTokenToStore,
        tokenList,
        setTokenList,
        activeAccount: { accountAddress: activeAccountAddress },
    } = zondStore;
    const [amount, setAmount] = useState("");
    const [mnemonic, setMnemonic] = useState("");
    const [toAddress, setToAddress] = useState("");
    const [isLoading, setIsLoading] = useState(false);

    const sendToken = async () => {
        setIsLoading(true);
        if (toAddress && amount && mnemonic) {
            const senderAddress = getAddressFromMnemonic(mnemonic);
            if (senderAddress.toLowerCase() !== activeAccountAddress.toLowerCase()) {
                toast({
                    title: "Invalid mnemonic",
                    description: "Please try again",
                    variant: "destructive",
                });
                setIsLoading(false);
                return;
            }

            let tokenInfo = tokenList.find(t => t.address === token?.address);

            const selectedBlockChain = await StorageUtil.getBlockChain();
            if (!tokenInfo) {
                try {
                    const { name, symbol, decimals } = await fetchTokenInfo(token?.address, ZOND_PROVIDER[selectedBlockChain].url);
                    const balance = await fetchBalance(token?.address, activeAccountAddress, ZOND_PROVIDER[selectedBlockChain].url);
                    tokenInfo = { name, symbol, decimals: parseInt(decimals.toString()), address: token?.address, amount: balance.toString() };
                } catch (error) {
                    toast({
                        title: "Error fetching token info",
                        description: "Please try again",
                        variant: "destructive",
                    });
                    setIsLoading(false);
                    return;
                }
            }

            if (tokenInfo) {
                const data = await sendTokenToStore(tokenInfo, amount, mnemonic, toAddress);
                if (data) {
                    setAmount("");
                    setMnemonic("");
                    setToAddress("");
                    onClose();
                    const selectedBlockChain = await StorageUtil.getBlockChain();
                    const balance = await fetchBalance(tokenInfo.address, activeAccountAddress, ZOND_PROVIDER[selectedBlockChain].url);
                    setTokenList([...tokenList.filter(t => t.address !== tokenInfo.address), { ...tokenInfo, amount: balance.toString() }]);
                    toast({
                        title: "Token sent successfully",
                        description: "Please check your wallet",
                    });
                } else {
                    toast({
                        title: "Error sending token",
                        description: "Please try again",
                        variant: "destructive",
                    });
                }
            }
        } else {
            toast({
                title: "Please enter a valid token address",
                variant: "destructive",
            });
        }
        setIsLoading(false);
    }

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-[600px]">
                <DialogHeader>
                    <DialogTitle>Send Token - {token?.name}</DialogTitle>
                    <DialogDescription>
                        Send a token to another address
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="flex flex-col">
                        <Label htmlFor="amount" className="mb-2">
                            To
                        </Label>
                        <Input disabled={isLoading} value={toAddress} onChange={(e) => setToAddress(e.target.value)} />
                    </div>
                    <div className="flex flex-col">
                        <Label htmlFor="amount" className="mb-2">
                            Amount
                        </Label>
                        <Input disabled={isLoading} value={amount} onChange={(e) => setAmount(e.target.value)} />
                    </div>
                    <div className="flex flex-col">
                        <Label htmlFor="mnemonic" className="mb-2">
                            Mnemonic
                        </Label>
                        <Input disabled={isLoading} value={mnemonic} onChange={(e) => setMnemonic(e.target.value)} />
                    </div>
                </div>
                <DialogFooter>
                    {isLoading ?
                        <Button type="button" disabled={true}><Loader2 className="w-4 h-4 mr-2 animate-spin" />Sending...</Button> :
                        <Button type="button" disabled={toAddress.length === 0 || amount.length === 0 || mnemonic.length === 0} onClick={sendToken}>Send Token</Button>
                    }
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
