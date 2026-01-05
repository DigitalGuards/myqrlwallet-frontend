import { Button } from "../../../../UI/Button";
import { Card } from "../../../../UI/Card";
import { Label } from "../../../../UI/Label";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../../../../UI/Tooltip";
import { useStore } from "../../../../../stores/store";
import { getExplorerAddressUrl } from "@/config";
import { ArrowRight, Copy, ExternalLink } from "lucide-react";
import { observer } from "mobx-react-lite";
import { AccountId } from "../AccountId/AccountId";
import { AccountBalance } from "../AccountBalance/AccountBalance";
import { useState } from "react";
import { ExtensionBadge } from "../ExtensionBadge/ExtensionBadge";

export const OtherAccounts = observer(() => {
  const { zondStore } = useStore();
  const {
    zondAccounts,
    activeAccount: { accountAddress: activeAccountAddress },
    setActiveAccount,
    zondConnection: { blockchain },
  } = zondStore;
  const { accounts } = zondAccounts;

  const otherAccountsLabel = activeAccountAddress ? "Other accounts" : "Your accounts";
  const otherAccounts = accounts.filter(
    ({ accountAddress }) => accountAddress !== activeAccountAddress
  );

  const [copiedAccount, setCopiedAccount] = useState<string | null>(null);
  const [tooltipStates, setTooltipStates] = useState<{ [key: string]: boolean }>({});

  const copyAccount = async (accountAddress: string) => {
    try {
      await navigator.clipboard.writeText(accountAddress);
      setCopiedAccount(accountAddress);
      setTooltipStates(prev => ({ ...prev, [accountAddress]: true }));
      setTimeout(() => {
        setCopiedAccount(null);
        setTooltipStates(prev => ({ ...prev, [accountAddress]: false }));
      }, 1000);
    } catch (error) {
      console.error('Failed to copy address:', error);
    }
  };

  const viewInExplorer = (accountAddress: string) => {
    window.open(getExplorerAddressUrl(accountAddress, blockchain), '_blank');
  };

  return (
    !!otherAccounts.length && (
      <>
        <Label className="text-foreground">{otherAccountsLabel}</Label>
        {otherAccounts.map(({ accountAddress, source }) => (
          <Card
            key={accountAddress}
            id={accountAddress}
            className="flex flex-col md:flex-row items-center gap-4 p-4 font-bold text-foreground hover:bg-accent border-l-4 border-l-secondary"
          >
            <div className="flex flex-col gap-1">
              <AccountId className="text-xs md:text-sm" account={accountAddress} />
              <AccountBalance className="m-auto md:m-0" accountAddress={accountAddress} />
              {source === 'extension' && <ExtensionBadge />}
            </div>
            <div className="flex gap-4 items-center">
              <span>
                <TooltipProvider>
                  <Tooltip
                    open={tooltipStates[accountAddress]}
                    onOpenChange={(open) =>
                      setTooltipStates(prev => ({ ...prev, [accountAddress]: open }))
                    }
                    delayDuration={0}
                  >
                    <TooltipTrigger asChild>
                      <Button
                        className="hover:text-secondary"
                        variant="outline"
                        size="icon"
                        onClick={() => copyAccount(accountAddress)}
                      >
                        <Copy size={18} />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      <Label>{copiedAccount === accountAddress ? "Copied!" : "Copy Address"}</Label>
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
                        onClick={() => viewInExplorer(accountAddress)}
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
              <span>
                <TooltipProvider>
                  <Tooltip delayDuration={0}>
                    <TooltipTrigger asChild>
                      <Button
                        className="hover:text-secondary"
                        variant="outline"
                        size="icon"
                        onClick={() => setActiveAccount(accountAddress, source)}
                      >
                        <ArrowRight size={18} />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      <Label>Switch to this account</Label>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </span>
            </div>
          </Card>
        ))}
      </>
    )
  );
});
