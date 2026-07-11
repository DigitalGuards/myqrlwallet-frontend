import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Copy, RefreshCw } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/UI/Dialog";
import { Button } from "@/components/UI/Button";
import { copyToClipboard } from "@/utils/nativeApp";
import { subscribeMobileStatus } from "@/utils/mobileConnect/mobileConnection";

interface Props {
  uri: string;
  /** Set on mobile browsers when the deep link into the app failed. */
  installHint: string | null;
  onClose: () => void;
  /** Rotate to a fresh channel/keys and show the new code. */
  onNewCode: () => Promise<void>;
}

/**
 * Pairing dialog for connecting the MyQRLWallet mobile app as a remote
 * signer: renders the qrlconnect:// URI as a QR for the phone to scan.
 * The parent closes it when the store adopts the paired account.
 */
const MobilePairingDialog = ({ uri, installHint, onClose, onNewCode }: Props) => {
  const [status, setStatus] = useState<string>("");
  const [hasJustCopied, setHasJustCopied] = useState(false);
  const [isRotating, setIsRotating] = useState(false);

  useEffect(() => subscribeMobileStatus(setStatus), []);

  const handleCopy = async () => {
    const success = await copyToClipboard(uri);
    if (success) {
      setHasJustCopied(true);
      setTimeout(() => setHasJustCopied(false), 1000);
    }
  };

  const handleNewCode = async () => {
    setIsRotating(true);
    try {
      await onNewCode();
    } catch (error) {
      console.error("Failed to rotate pairing code:", error);
    } finally {
      setIsRotating(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Connect Mobile App</DialogTitle>
          <DialogDescription>
            Open MyQRLWallet on your phone and scan this code to use the app
            as the signer for this session.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-4">
          <div className="rounded-lg bg-white p-3">
            <QRCodeSVG value={uri} size={220} bgColor="#ffffff" fgColor="#000000" level="L" />
          </div>
          {installHint && (
            <p className="text-center text-sm text-yellow-200">{installHint}</p>
          )}
          {status && (
            <p className="text-center text-xs text-muted-foreground">{status}</p>
          )}
          <div className="flex w-full gap-4">
            <Button className="w-full" type="button" variant="outline" onClick={handleCopy}>
              <Copy className="mr-2 h-4 w-4" />
              {hasJustCopied ? "Copied" : "Copy code"}
            </Button>
            <Button
              className="w-full"
              type="button"
              variant="outline"
              onClick={handleNewCode}
              disabled={isRotating}
            >
              <RefreshCw className={`mr-2 h-4 w-4 ${isRotating ? "animate-spin" : ""}`} />
              New code
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default MobilePairingDialog;
