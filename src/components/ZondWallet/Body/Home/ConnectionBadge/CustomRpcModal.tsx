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

export function CustomRpcModal({ isOpen, onClose }: { isOpen: boolean, onClose: () => void }) {
    const { CUSTOM_RPC } = ZOND_PROVIDER;
    const [rpcUrl, setRpcUrl] = useState("");
    const { zondStore } = useStore();
    const { setCustomRpcUrl, selectBlockchain } = zondStore;


    const selectCustomRpc = () => {
        selectBlockchain(CUSTOM_RPC.id);
        setCustomRpcUrl(rpcUrl);
        setRpcUrl("");
        onClose();
    }

    useEffect(() => {
        const fetchCustomRpcUrl = async () => {
            const customRpcUrl = await StorageUtil.getCustomRpcUrl();
            if (customRpcUrl) {
                setRpcUrl(customRpcUrl);
            }
        }
        fetchCustomRpcUrl();
    }, [isOpen]);

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-[600px]">
                <DialogHeader>
                    <DialogTitle>Custom RPC</DialogTitle>
                    <DialogDescription>
                        Enter a custom RPC URL
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="flex flex-col">
                        <Label htmlFor="amount" className="mb-2">
                            RPC URL
                        </Label>
                        <Input placeholder="https://127.0.0.1:8545" value={rpcUrl} onChange={(e) => setRpcUrl(e.target.value)} />
                    </div>
                </div>
                <DialogFooter>
                    <Button onClick={selectCustomRpc}>Select</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
