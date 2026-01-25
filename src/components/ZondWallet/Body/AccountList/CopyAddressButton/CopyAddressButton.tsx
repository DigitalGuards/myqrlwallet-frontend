import { Button } from "../../../../UI/Button";
import { Label } from "../../../../UI/Label";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../../../../UI/Tooltip";
import { copyToClipboard } from "@/utils/nativeApp";
import { Copy, Download } from "lucide-react";
import { useState, useRef } from "react";
import { QRCodeSVG } from "qrcode.react";

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
      // Convert SVG to canvas
      const svg = qrRef.current;
      const svgData = new XMLSerializer().serializeToString(svg);
      const svgBlob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
      const svgUrl = URL.createObjectURL(svgBlob);

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
            // Fallback: download the image
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `address-${accountAddress.slice(0, 8)}.png`;
            a.click();
            URL.revokeObjectURL(url);
            setQrCopied(true);
            setTimeout(() => setQrCopied(false), 1500);
          }
        }, "image/png");

        URL.revokeObjectURL(svgUrl);
      };
      img.src = svgUrl;
    } catch (err) {
      console.error("Failed to copy QR code:", err);
    }
  };

  return (
    <span className="group relative">
      <TooltipProvider>
        <Tooltip open={isTooltipOpen} onOpenChange={setTooltipOpen} delayDuration={0}>
          <TooltipTrigger asChild>
            <Button
              className="hover:text-secondary"
              variant="outline"
              size="icon"
              onClick={copyAccount}
            >
              <Copy size={18} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">
            <Label>{copied ? "Copied!" : "Copy Address"}</Label>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <div className="absolute invisible group-hover:visible hover:visible -bottom-[270px] left-1/2 transform -translate-x-1/2 z-50">
        {/* Invisible bridge to maintain hover when moving from button to popup */}
        <div className="absolute -top-4 left-0 right-0 h-4" />
        <div className="bg-card rounded-lg p-4 shadow-lg border border-border">
        <div className="flex flex-col items-center gap-3">
          <QRCodeSVG
            ref={qrRef}
            value={accountAddress}
            size={150}
            bgColor="#ffffff"
            fgColor="#000000"
            level="L"
            includeMargin={false}
          />
          <Label className="text-xs text-muted-foreground text-center max-w-[150px] truncate">
            {accountAddress}
          </Label>
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
        </div>
      </div>
    </span>
  );
};
