import { Button } from "../../../../UI/Button";
import { Label } from "../../../../UI/Label";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../../../../UI/Tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../../../../UI/Dialog";
import { copyToClipboard } from "@/utils/nativeApp";
import { Copy, Download, QrCode } from "lucide-react";
import { useState, useRef } from "react";
import { QRCodeSVG } from "qrcode.react";
import { QrlAddress } from "@/components/UI/QrlAddress";

interface CopyAddressButtonProps {
  accountAddress: string;
  tooltipOpen?: boolean;
  onTooltipChange?: (open: boolean) => void;
}

export const CopyAddressButton = ({
  accountAddress,
  tooltipOpen,
  onTooltipChange,
}: CopyAddressButtonProps) => {
  const [copied, setCopied] = useState(false);
  const [internalTooltipOpen, setInternalTooltipOpen] = useState(false);
  const [qrCopied, setQrCopied] = useState(false);
  const qrRef = useRef<SVGSVGElement>(null);

  // Use external tooltip state if provided, otherwise use internal
  const isTooltipOpen = tooltipOpen ?? internalTooltipOpen;
  const setTooltipOpen = onTooltipChange ?? setInternalTooltipOpen;

  const copyAccount = async () => {
    const success = await copyToClipboard(accountAddress);
    if (success) {
      setCopied(true);
      setTooltipOpen(true);
      setTimeout(() => {
        setCopied(false);
        setTooltipOpen(false);
      }, 1000);
    }
  };

  const copyQrCode = async () => {
    if (!qrRef.current) return;

    try {
      // Convert SVG to canvas using data URL (CSP-compliant)
      const svg = qrRef.current;
      const svgData = new XMLSerializer().serializeToString(svg);
      // Convert UTF-8 string to base64 (modern replacement for deprecated unescape/encodeURIComponent)
      const utf8Bytes = new TextEncoder().encode(svgData);
      const base64 = btoa(Array.from(utf8Bytes, byte => String.fromCharCode(byte)).join(''));
      const svgDataUrl = "data:image/svg+xml;base64," + base64;

      const img = new Image();
      img.onload = async () => {
        const canvas = document.createElement("canvas");
        // Add padding for better QR scanning
        const padding = 20;
        canvas.width = img.width + padding * 2;
        canvas.height = img.height + padding * 2;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        // White background
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        // Draw QR code centered
        ctx.drawImage(img, padding, padding);

        // Convert to blob and copy
        canvas.toBlob(async (blob) => {
          if (!blob) return;
          try {
            await navigator.clipboard.write([
              new ClipboardItem({ "image/png": blob }),
            ]);
            setQrCopied(true);
            setTimeout(() => setQrCopied(false), 1500);
          } catch (_err) {
            // Fallback: download the image as data URL
            const dataUrl = canvas.toDataURL("image/png");
            const a = document.createElement("a");
            a.href = dataUrl;
            a.download = `address-${accountAddress.slice(0, 8)}.png`;
            a.click();
            setQrCopied(true);
            setTimeout(() => setQrCopied(false), 1500);
          }
        }, "image/png");
      };
      img.src = svgDataUrl;
    } catch (err) {
      console.error("Failed to copy QR code:", err);
    }
  };

  return (
    <span className="inline-flex items-center gap-2">
      <TooltipProvider>
        <Tooltip open={isTooltipOpen} onOpenChange={setTooltipOpen} delayDuration={0}>
          <TooltipTrigger asChild>
            <Button
              className="hover:text-secondary"
              variant="outline"
              size="icon"
              onClick={copyAccount}
              aria-label={copied ? "Address copied" : "Copy address"}
            >
              <Copy size={18} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">
            <Label>{copied ? "Copied!" : "Copy Address"}</Label>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <Dialog>
        <DialogTrigger asChild>
          <Button
            className="hover:text-secondary"
            variant="outline"
            size="icon"
            aria-label="Show address QR code"
          >
            <QrCode size={18} />
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Wallet Address</DialogTitle>
            <DialogDescription>
              Scan or copy the complete address below.
            </DialogDescription>
          </DialogHeader>
          <div className="flex min-w-0 flex-col items-center gap-4">
            <QRCodeSVG
              ref={qrRef}
              value={accountAddress}
              size={200}
              bgColor="#ffffff"
              fgColor="#000000"
              level="L"
              includeMargin
            />
            <QrlAddress
              address={accountAddress}
              mode="full"
              copyable
              className="w-full justify-center text-center text-xs text-muted-foreground"
            />
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={copyQrCode}
            >
              {qrCopied ? (
                "Copied!"
              ) : (
                <>
                  <Download size={14} className="mr-1" />
                  Copy QR
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </span>
  );
};
