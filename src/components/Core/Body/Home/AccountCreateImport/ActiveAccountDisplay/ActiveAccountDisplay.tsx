import { useState } from "react";
import { useStore } from "../../../../../../stores/store";
import { observer } from "mobx-react-lite";
import { Copy, Check, RefreshCw } from "lucide-react";
import { formatBalance, formatAddress } from "@/utils/formatting";
import { copyToClipboard } from "@/utils/nativeApp";
import { SlotBalance } from "./SlotBalance";

export const ActiveAccountDisplay = observer(() => {
  const { qrlStore } = useStore();
  const { activeAccount, fetchAccounts, activeAccountBalance, activeAccountBalanceUsd, qrlPrice, qrlPriceChange24h } = qrlStore;
  const { accountAddress } = activeAccount;
  const [copiedItem, setCopiedItem] = useState<'balance' | 'address' | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshSuccess, setRefreshSuccess] = useState(false);
  const [isSlotSpinning, setIsSlotSpinning] = useState(false);

  const handleCopy = async (text: string, type: 'balance' | 'address') => {
    const success = await copyToClipboard(text);
    if (success) {
      setCopiedItem(type);
      setTimeout(() => {
        setCopiedItem(null);
      }, 1500);
    }
  };

  const refreshBalance = async () => {
    setIsRefreshing(true);
    setIsSlotSpinning(true);
    try {
      await fetchAccounts();
      qrlStore.fetchQrlPrice();
    } finally {
      setIsRefreshing(false);
      // Let the slot animation finish its cascade before clearing
      setTimeout(() => setIsSlotSpinning(false), 1200);
      setRefreshSuccess(true);
      setTimeout(() => {
        setRefreshSuccess(false);
      }, 1500);
    }
  };

  return (
    <div className="flex flex-col">
      <div
        className="flex justify-center items-baseline text-2xl md:text-3xl font-semibold text-foreground group font-data"
      >
        <div className="cursor-pointer flex items-baseline" onClick={() => handleCopy(activeAccountBalance, 'balance')}>
          <span>
            <SlotBalance value={formatBalance(activeAccountBalance)} spinning={isSlotSpinning} />
            <span className="ml-1.5 text-base font-medium text-muted-foreground">QRL</span>
          </span>
          {copiedItem === 'balance' ? (
            <Check className="w-4 h-4 ml-2 self-center text-success" />
          ) : (
            <Copy className="w-4 h-4 ml-2 self-center text-muted-foreground transition-colors group-hover:text-foreground" />
          )}
        </div>
        <button
          className="ml-2 p-1 rounded-full self-center hover:bg-foreground/10 flex items-center justify-center transition-colors"
          onClick={refreshBalance}
          disabled={isRefreshing || refreshSuccess}
        >
          {refreshSuccess ? (
            <Check className="w-4 h-4 text-success" />
          ) : isRefreshing ? (
            <RefreshCw className="w-4 h-4 text-foreground animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4 text-muted-foreground" />
          )}
        </button>
      </div>
      {qrlPrice > 0 && (
        <div className="flex items-center justify-center gap-2 text-sm mt-2 mb-4 font-data">
          <span className="text-muted-foreground">
            ≈ ${activeAccountBalanceUsd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
          {qrlPriceChange24h !== 0 && (
            <span className={qrlPriceChange24h > 0 ? "text-success" : "text-red-400"}>
              {qrlPriceChange24h > 0 ? "▲" : "▼"} {qrlPriceChange24h > 0 ? "+" : ""}{qrlPriceChange24h.toFixed(2)}%
            </span>
          )}
        </div>
      )}
      <div className="flex justify-center">
        <div
          className="inline-flex items-center gap-1.5 sm:gap-2 rounded-full border border-blue-accent/30 bg-blue-accent/[0.08] px-3 sm:px-4 py-1.5 text-[clamp(0.6rem,2.5vw,0.875rem)] group cursor-pointer backdrop-blur-sm transition-colors hover:border-blue-accent/60"
          onClick={() => handleCopy(accountAddress, 'address')}
        >
          <span className="font-data text-blue-accent">{formatAddress(accountAddress)}</span>
          {copiedItem === 'address' ? (
            <Check className="w-3.5 h-3.5 text-success" />
          ) : (
            <Copy className="w-3.5 h-3.5 text-blue-accent/60" />
          )}
        </div>
      </div>
    </div>
  );
});
