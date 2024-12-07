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
import { getExplorerAddressUrl } from "../../../../../configuration/zondConfig";
import { ArrowRight, Copy, ExternalLink } from "lucide-react";
import { observer } from "mobx-react-lite";
import { AccountId } from "../AccountId/AccountId";
import { useState } from "react";

export const OtherAccounts = observer(() => {
  const { zondStore } = useStore();
  const {
    zondAccounts,
    activeAccount: { accountAddress: activeAccountAddress },
    setActiveAccount,
    zondConnection: { blockchain },
  } = zondStore;
  const { accounts } = zondAccounts;

  const otherAccountsLabel = `${activeAccountAddress ? "Other accounts" : "Accounts"} in the wallet`;
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
        <Label className="text-secondary">{otherAccountsLabel}</Label>
        {otherAccounts.map(({ accountAddress }) => (
          <Card
            key={accountAddress}
            id={accountAddress}
            className="flex items-center gap-4 p-4 font-bold text-foreground hover:bg-accent"
          >
            <AccountId account={accountAddress} />
            <span>
              <TooltipProvider>
                <Tooltip 
                  open={tooltipStates[accountAddress]} 
                  onOpenChange={(open) => 
                    setTooltipStates(prev => ({ ...prev, [accountAddress]: open }))
                  }
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
                      onClick={() => setActiveAccount(accountAddress)}
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
          </Card>
        ))}
      </>
    )
  );
});
