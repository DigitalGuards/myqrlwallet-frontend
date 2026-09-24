import { observer } from "mobx-react-lite";
import { Card, CardContent } from "../../../UI/Card";
import { Button } from "../../../UI/Button";
import { QRCodeSVG } from "qrcode.react";
import { AddressDisclosure } from "@/components/UI/AddressDisclosure";

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
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
            <Card className="w-full max-w-md" onClick={(e) => e.stopPropagation()}>
                <CardContent className="p-4">
                    <div className="flex justify-between items-center mb-4">
                        <h2 className="text-xl font-bold">Receive Quanta</h2>
                        <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">×</Button>
                    </div>

                    <div className="flex flex-col items-center gap-4">
                        {/*
                          marginSize draws the 4-module quiet zone the QR spec
                          requires inside the symbol itself, so it scales with
                          the encoded address instead of depending on padding.
                        */}
                        <div className="rounded-lg bg-white p-2">
                            <QRCodeSVG value={accountAddress} size={200} level="L" marginSize={4} />
                        </div>

                        <AddressDisclosure
                            address={accountAddress}
                            className="w-full"
                            fingerprintClassName="text-center text-identity-accent"
                            fullAddressClassName="text-center text-identity-accent"
                        />

                        <p className="text-center text-sm text-muted-foreground">
                            Share this address or QR code to receive Quanta.
                        </p>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
});
