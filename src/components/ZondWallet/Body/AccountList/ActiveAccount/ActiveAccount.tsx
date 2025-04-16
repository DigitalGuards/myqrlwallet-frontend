import { Button } from "../../../../UI/Button";
import { Card } from "../../../../UI/Card";
import { Label } from "../../../../UI/Label";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../../../../UI/Tooltip";
import { ROUTES } from "../../../../../router/router";
import { useStore } from "../../../../../stores/store";
import { getExplorerAddressUrl } from "../../../../../configuration/zondConfig";
import { Copy, ExternalLink, SendHorizontal, History } from "lucide-react";
import { observer } from "mobx-react-lite";
import { Link } from "react-router-dom";
import { AccountId } from "../AccountId/AccountId";
import { AccountBalance } from "../AccountBalance/AccountBalance";
import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { TransactionHistoryPopup } from "./TransactionHistoryPopup";

export const ActiveAccount = observer(() => {
  const { zondStore } = useStore();
  const {
    activeAccount: { accountAddress },
    zondConnection: { blockchain },
  } = zondStore;

  const activeAccountLabel = "Active account";
  const [copied, setCopied] = useState(false);
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const [txHistoryOpen, setTxHistoryOpen] = useState(false);

  const copyAccount = async () => {
    try {
      await navigator.clipboard.writeText(accountAddress);
      setCopied(true);
      setTooltipOpen(true);
      setTimeout(() => {
        setCopied(false);
        setTooltipOpen(false);
      }, 1000);
    } catch (error) {
      console.error('Failed to copy address:', error);
    }
  };

  const viewInExplorer = () => {
    window.open(getExplorerAddressUrl(accountAddress, blockchain), '_blank');
  };

  return (
    !!accountAddress && (
      <>
        <Label className="text-foreground">{activeAccountLabel}</Label>
        <Card className="flex flex-col md:flex-row items-center gap-4 p-4 font-bold text-foreground hover:bg-accent">
          <div className="flex flex-col gap-1">
            <AccountId className="flex md:hidden" oneLine={true} account={accountAddress} />
            <AccountId className="hidden md:flex" account={accountAddress} />
            <AccountBalance className="m-auto md:m-0" accountAddress={accountAddress} />
          </div>
          <div className="flex gap-4 items-center">
            <span>
              <TooltipProvider>
                <Tooltip open={tooltipOpen} onOpenChange={setTooltipOpen} delayDuration={0}>
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
                  <TooltipContent side="bottom">
                    <Label>{copied ? "Copied!" : "Copy Address"}</Label>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </span>
            <span className="group relative">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      className="hover:text-secondary"
                      variant="outline"
                      size="icon"
                      onClick={viewInExplorer}
                    >
                      <ExternalLink size={18} />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    <Label>View in Zondscan</Label>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <div className="absolute invisible group-hover:visible -bottom-[220px] left-1/2 transform -translate-x-1/2 bg-card rounded-lg p-4 shadow-lg z-50 border border-border">
                <div className="flex flex-col items-center gap-2">
                  <QRCodeSVG
                    value={getExplorerAddressUrl(accountAddress, blockchain)}
                    size={150}
                    bgColor="#000000"
                    fgColor="#ffffff"
                    level="L"
                    includeMargin={false}
                  />
                  <Label className="text-xs text-muted-foreground">Scan to open in Zondscan</Label>
                </div>
              </div>
            </span>
            <span>
              <TooltipProvider>
                <Tooltip delayDuration={0}>
                  <TooltipTrigger asChild>
                    <Button
                      className="hover:text-secondary"
                      variant="outline"
                      size="icon"
                      onClick={() => setTxHistoryOpen(true)}
                    >
                      <History size={18} />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    <Label>Show Tx History</Label>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </span>
            <span>
              <TooltipProvider>
                <Tooltip delayDuration={0}>
                  <TooltipTrigger asChild>
                    <Link
                      to={ROUTES.ACCOUNT_DETAILS}
                    >
                      <Button
                        className="hover:text-secondary"
                        variant="outline"
                        size="icon"
                      >
                        <SendHorizontal size={18} />
                      </Button>
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    <Label>Send Quanta</Label>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </span>
          </div>
        </Card>
        <TransactionHistoryPopup 
          accountAddress={accountAddress}
          blockchain={blockchain}
          isOpen={txHistoryOpen}
          onClose={() => setTxHistoryOpen(false)}
        />
      </>
    )
  );
});
