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
import { getExplorerAddressUrl } from "@/config";
import { openExternalUrl } from "@/utils/nativeApp";
import { ExternalLink, SendHorizontal, History, Unlink } from "lucide-react";
import { observer } from "mobx-react-lite";
import { Link } from "react-router-dom";
import { AccountId } from "../AccountId/AccountId";
import { AccountBalance } from "../AccountBalance/AccountBalance";
import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { TransactionHistoryPopup } from "./TransactionHistoryPopup";
import { ExtensionBadge } from "../ExtensionBadge/ExtensionBadge";
import { MobileBadge } from "../MobileBadge/MobileBadge";
import { CopyAddressButton } from "../CopyAddressButton/CopyAddressButton";
import { disconnectMobile } from "@/utils/mobileConnect/mobileConnection";

export const ActiveAccount = observer(() => {
  const { qrlStore } = useStore();
  const {
    activeAccount: { accountAddress },
    activeAccountSource,
    qrlConnection: { blockchain },
  } = qrlStore;

  const activeAccountLabel = "Active account";
  const [txHistoryOpen, setTxHistoryOpen] = useState(false);

  const viewInExplorer = () => {
    openExternalUrl(getExplorerAddressUrl(accountAddress, blockchain));
  };

  // Mobile-app pairings get an explicit Disconnect: it ends the relay session
  // (notifying the phone) and removes the account from this wallet.
  const disconnectMobileAccount = async () => {
    try {
      await disconnectMobile();
      qrlStore.setMobileProvider(null);
      await qrlStore.removeMobileAccounts();
    } catch (error) {
      console.error("Failed to disconnect mobile account:", error);
    }
  };

  return (
    !!accountAddress && (
      <>
        <Label className="text-foreground">{activeAccountLabel}</Label>
        <Card className="surface-ember flex flex-col md:flex-row items-center gap-4 p-4 font-bold text-foreground transition-colors hover:border-primary/40">
          <div className="flex flex-col gap-1">
            <AccountId className="text-xs md:text-sm" account={accountAddress} />
            <div className="flex flex-col gap-1">
              <AccountBalance className="m-auto md:m-0" accountAddress={accountAddress} />
              {activeAccountSource === 'extension' && <ExtensionBadge />}
              {activeAccountSource === 'mobile' && <MobileBadge />}
            </div>
          </div>
          <div className="flex gap-4 items-center">
            <CopyAddressButton accountAddress={accountAddress} />
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
                    <Label>View on Explorer</Label>
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
                  <Label className="text-xs text-muted-foreground">Scan to open in Explorer</Label>
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
                      to={ROUTES.TRANSFER}
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
                    <Label>Transfer</Label>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </span>
            {activeAccountSource === 'mobile' && (
              <span>
                <TooltipProvider>
                  <Tooltip delayDuration={0}>
                    <TooltipTrigger asChild>
                      <Button
                        className="hover:text-destructive"
                        variant="outline"
                        size="icon"
                        onClick={() => void disconnectMobileAccount()}
                      >
                        <Unlink size={18} />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      <Label>Disconnect mobile app</Label>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </span>
            )}
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
