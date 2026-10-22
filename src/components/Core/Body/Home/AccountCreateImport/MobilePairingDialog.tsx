import { useTranslation } from "react-i18next";
import { logger } from "@/utils/log";
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
  onClose: () => void | Promise<void>;
  /** Rotate to a fresh channel/keys and show the new code. */
  onNewCode: () => Promise<void>;
}

/**
 * Pairing dialog for connecting the MyQRLWallet mobile app as a remote
 * signer: renders the qrlconnect:// URI as a QR for the phone to scan.
 * The parent closes it when the store adopts the paired account.
 */
const MobilePairingDialog = ({
  uri,
  installHint,
  onClose,
  onNewCode,
}: Props) => {
  const { t } = useTranslation(["home", "common", "settings"]);
  const statusKey = (value: string) => {
    switch (value) {
      case "disconnected":
        return "home:disconnected";
      case "connecting":
        return "settings:connecting";
      case "waiting":
        return "home:waiting";
      case "key_exchange":
        return "settings:exchangingKeys";
      case "connected":
        return "settings:connected";
      case "reconnecting":
        return "settings:reconnecting";
      case "Your phone did not respond. Open MyQRLWallet on your phone and try again.":
        return "home:mobileUnresponsive";
      case "This MyQRLWallet app is not yet qualified for Testnet v3. Update the app and pair again.":
        return "home:mobileUnqualified";
      default:
        return "home:pairingUnknown";
    }
  };
  const [status, setStatus] = useState<string>("");
  const [hasJustCopied, setHasJustCopied] = useState(false);
  const [isRotating, setIsRotating] = useState(false);

  useEffect(() => subscribeMobileStatus(setStatus), []);

  const handleCopy = async () => {
    const success = await copyToClipboard(uri);
    if (success) {
      setHasJustCopied(true);
      setTimeout(() => {
        setHasJustCopied(false);
      }, 1000);
    }
  };

  const handleNewCode = async () => {
    setIsRotating(true);
    try {
      await onNewCode();
    } catch (error) {
      logger.error("Failed to rotate pairing code:", error);
    } finally {
      setIsRotating(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          Promise.resolve(onClose()).catch((error: unknown) => {
            logger.error("Failed to close mobile pairing:", error);
          });
        }
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("home:connectMobile")}</DialogTitle>
          <DialogDescription>{t("home:pairingHint")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-4">
          <div className="rounded-lg bg-white p-3">
            <QRCodeSVG
              value={uri}
              size={220}
              bgColor="#ffffff"
              fgColor="#000000"
              level="L"
            />
          </div>
          {installHint && (
            <p className="text-center text-sm text-yellow-200">
              {t("home:installMobile")}
            </p>
          )}
          {status && (
            <p className="text-center text-xs text-muted-foreground">
              {t(statusKey(status))}
            </p>
          )}
          <div className="flex w-full flex-wrap gap-2">
            <Button
              className="min-w-0 flex-[1_1_8rem]"
              type="button"
              variant="outline"
              onClick={() => {
                handleCopy().catch((error: unknown) => {
                  logger.error("Failed to copy pairing code:", error);
                });
              }}
            >
              <Copy className="mr-2 h-4 w-4" />
              {hasJustCopied ? t("common:copied") : t("home:copyCode")}
            </Button>
            <Button
              className="min-w-0 flex-[1_1_8rem]"
              type="button"
              variant="outline"
              onClick={() => {
                handleNewCode().catch((error: unknown) => {
                  logger.error("Failed to rotate pairing code:", error);
                });
              }}
              disabled={isRotating}
            >
              <RefreshCw
                className={`mr-2 h-4 w-4 ${isRotating ? "animate-spin" : ""}`}
              />
              {t("home:newCode")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default MobilePairingDialog;
