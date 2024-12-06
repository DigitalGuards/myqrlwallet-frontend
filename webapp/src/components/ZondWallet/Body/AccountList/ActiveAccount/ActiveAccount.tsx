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
import { Copy, ExternalLink, Send } from "lucide-react";
import { observer } from "mobx-react-lite";
import { Link } from "react-router-dom";
import { AccountId } from "../AccountId/AccountId";

export const ActiveAccount = observer(() => {
  const { zondStore } = useStore();
  const {
    activeAccount: { accountAddress },
    zondConnection: { blockchain },
  } = zondStore;

  const activeAccountLabel = `${accountAddress ? "Active account" : ""}`;

  const copyAccount = () => {
    navigator.clipboard.writeText(accountAddress);
  };

  const viewInExplorer = () => {
    if (accountAddress) {
      window.open(getExplorerAddressUrl(accountAddress, blockchain), '_blank');
    }
  };

  return (
    !!accountAddress && (
      <>
        <Label className="text-secondary">{activeAccountLabel}</Label>
        <Card className="flex w-full flex-col gap-4 p-4 font-bold text-foreground hover:bg-accent">
          <div className="flex gap-2">
            <AccountId account={accountAddress} />
            <span>
              <TooltipProvider>
                <Tooltip delayDuration={0}>
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
                    <Label>Copy Address</Label>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </span>
            <span>
              <TooltipProvider>
                <Tooltip delayDuration={0}>
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
                  <TooltipContent side="bottom">
                    <Label>View in Zondscan</Label>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </span>
            <Link className="ml-auto" to={ROUTES.ACCOUNT_DETAILS}>
              <Button variant="outline" size="icon">
                <Send size={18} />
              </Button>
            </Link>
          </div>
        </Card>
      </>
    )
  );
});
