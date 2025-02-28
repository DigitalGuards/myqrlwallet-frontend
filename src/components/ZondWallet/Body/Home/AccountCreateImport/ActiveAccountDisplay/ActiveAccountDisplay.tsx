import { useState } from "react";
import { useStore } from "../../../../../../stores/store";
import { observer } from "mobx-react-lite";
import { Copy, Check } from "lucide-react";

export const ActiveAccountDisplay = observer(() => {
  const { zondStore } = useStore();
  const { activeAccount, getAccountBalance } = zondStore;
  const { accountAddress } = activeAccount;
  const [copiedItem, setCopiedItem] = useState<'balance' | 'address' | null>(null);

  const accountBalance = getAccountBalance(accountAddress);

  const prefix = accountAddress.substring(0, 1);
  const addressSplit: string[] = [];
  for (let i = 1; i < accountAddress.length; i += 4) {
    addressSplit.push(accountAddress.substring(i, i + 4));
  }

  const copyToClipboard = (text: string, type: 'balance' | 'address') => {
    navigator.clipboard.writeText(text);
    setCopiedItem(type);
    setTimeout(() => {
      setCopiedItem(null);
    }, 1500);
  };

  return (
    <div className="flex flex-col gap-4">
      <div
        className="flex justify-center items-center text-xl font-bold text-secondary group cursor-pointer"
        onClick={() => copyToClipboard(accountBalance.slice(0, -4).toString(), 'balance')}
      >
        <span>{accountBalance}</span>
        {copiedItem === 'balance' ? (
          <Check className="w-4 h-4 ml-2 text-green-500" />
        ) : (
          <Copy className="w-4 h-4 ml-2 opacity-0 group-hover:opacity-100 transition-opacity" />
        )}
      </div>
      <div
        className="text-center text-sm flex justify-center items-center group cursor-pointer"
        onClick={() => copyToClipboard(accountAddress, 'address')}
      >
        <span>{`${prefix} ${addressSplit.join(" ")}`}</span>
        {copiedItem === 'address' ? (
          <Check className="w-4 h-4 ml-2 text-green-500" />
        ) : (
          <Copy className="w-4 h-4 ml-2 opacity-0 group-hover:opacity-100 transition-opacity" />
        )}
      </div>
    </div>
  );
});
