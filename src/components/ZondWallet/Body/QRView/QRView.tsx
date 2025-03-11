import { getExplorerAddressUrl } from "@/configuration/zondConfig";
import { observer } from "mobx-react-lite";
import { QRCodeSVG } from "qrcode.react";
import { Label } from "@/components/UI/Label";
import { useStore } from "@/stores/store";

const QRView = observer(() => {
    const { zondStore } = useStore();
    const {
        activeAccount: { accountAddress },
        zondConnection: { blockchain },
    } = zondStore;

    return (
        <div className="absolute top-1/2 mt-[-100px] left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-2">
            <QRCodeSVG
                value={getExplorerAddressUrl(accountAddress, blockchain)}
                size={200}
                bgColor="#000000"
                fgColor="#ffffff"
                level="L"
                includeMargin={false}
            />
            <Label className="text-xs text-muted-foreground">Scan to open in Zondscan</Label>
        </div>
    );
});

export default QRView;
