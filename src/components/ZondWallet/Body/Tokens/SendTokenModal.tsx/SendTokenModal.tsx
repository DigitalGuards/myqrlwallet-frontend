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

export function SendTokenModal({ isOpen, onClose, token }: { isOpen: boolean, onClose: () => void, token: TokenInterface }) {
    const { zondStore } = useStore();
    const {
        sendToken: sendTokenToStore,
        activeAccount: { accountAddress: activeAccountAddress },
    } = zondStore;
    const [tokenInfo, setTokenInfo] = useState<TokenInterface | null>(token);
    const [amount, setAmount] = useState("");
    const [mnemonic, setMnemonic] = useState("");

    const sendToken = async () => {
        if (tokenInfo) {
            const data = await sendTokenToStore(tokenInfo, amount, mnemonic);
            if (data) {
                setTokenInfo(null);
                setAmount("");
                setMnemonic("");
                onClose();
            } else {
                toast({
                    title: "Error sending token",
                    description: "Please try again",
                    variant: "destructive",
                });
            }
        } else {
            toast({
                title: "Please enter a valid token address",
                variant: "destructive",
            });
        }
    }

    useEffect(() => {
        const init = async () => {
            if (tokenInfo?.address.length === 42 && tokenInfo?.address.startsWith("0x")) {
                try {
                    const { name, symbol, decimals } = await fetchTokenInfo(tokenInfo.address);
                    const balance = await fetchBalance(tokenInfo.address, activeAccountAddress);
                    setTokenInfo({ name, symbol, decimals: parseInt(decimals.toString()), address: tokenInfo.address, amount: balance.toString() });
                } catch (error) {
                    console.error("Error fetching token info", error);
                }
            }
        }
        init();
    }, [tokenInfo]);

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Send Token - {token?.name}</DialogTitle>
                    <DialogDescription>
                        Send a token to another address
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="amount" className="text-right">
                            Amount
                        </Label>
                        <Input value={amount} onChange={(e) => setAmount(e.target.value)} />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="mnemonic" className="text-right">
                            Mnemonic
                        </Label>
                        <Input value={mnemonic} onChange={(e) => setMnemonic(e.target.value)} />
                    </div>
                </div>
                <DialogFooter>
                    <Button type="button" disabled={tokenInfo?.address.length === 0} onClick={sendToken}>Send Token</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
