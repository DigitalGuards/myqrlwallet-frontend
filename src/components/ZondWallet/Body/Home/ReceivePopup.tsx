import { useState } from "react";
import { observer } from "mobx-react-lite";
import { Card, CardContent } from "../../../UI/Card";
import { Button } from "../../../UI/Button";
import { Label } from "../../../UI/Label";
import { QRCodeSVG } from "qrcode.react";
import { Copy } from "lucide-react";

interface ReceivePopupProps {
    accountAddress: string;
    isOpen: boolean;
    onClose: () => void;
}

export const ReceivePopup = observer(({
    accountAddress,
    isOpen,
    onClose,
}: ReceivePopupProps) => {
    const [copied, setCopied] = useState(false);

    const copyAddress = async () => {
        try {
            await navigator.clipboard.writeText(accountAddress);
            setCopied(true);
            setTimeout(() => {
                setCopied(false);
            }, 1500);
        } catch (error) {
            console.error('Failed to copy address:', error);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
            <Card className="w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
                <CardContent className="p-4">
                    <div className="flex justify-between items-center mb-4">
                        <h2 className="text-xl font-bold">Receive QRL</h2>
                        <Button variant="ghost" size="sm" onClick={onClose}>×</Button>
                    </div>
                    
                    <div className="flex flex-col items-center gap-4">
                        <QRCodeSVG
                            value={accountAddress}
                            size={200}
                            bgColor="#000000"
                            fgColor="#ffffff"
                            level="L"
                            includeMargin={true}
                        />
                        
                        <div className="w-full">
                            <Label className="block mb-2 text-sm text-muted-foreground">Your Wallet Address</Label>
                            <div className="flex gap-2">
                                <div className="flex-1 bg-card border border-border rounded p-2 text-sm break-all">
                                    {accountAddress}
                                </div>
                                <Button 
                                    variant="outline" 
                                    size="icon" 
                                    onClick={copyAddress}
                                    className={copied ? "text-green-500" : ""}
                                >
                                    <Copy size={18} />
                                </Button>
                            </div>
                            {copied && (
                                <p className="text-green-500 text-xs mt-1">Address copied to clipboard!</p>
                            )}
                        </div>
                        
                        <div className="text-center text-sm text-muted-foreground mt-2">
                            <p>Share this address or QR code to receive QRL.</p>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
});
