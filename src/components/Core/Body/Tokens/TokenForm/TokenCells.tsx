import { useTranslation } from "react-i18next";
import { renderValue, stringValue } from "@/utils/guards";
import { Copy, Check, EyeOff } from "lucide-react";
import { useState } from "react";
import { observer } from "mobx-react-lite";
import { useStore } from "@/stores/store";
import { copyToClipboard } from "@/utils/nativeApp";
import { reportError } from "@/utils/reportError";
import { SlotBalance } from "../../Home/AccountCreateImport/ActiveAccountDisplay/SlotBalance";

export const CopyableText = ({
  text,
  className,
}: {
  text: unknown;
  className?: string;
}) => {
  const [isCopied, setIsCopied] = useState(false);

  const handleCopy = async (textToCopy: unknown) => {
    const success = await copyToClipboard(textToCopy);
    if (success) {
      setIsCopied(true);
      setTimeout(() => {
        setIsCopied(false);
      }, 1500);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 group">
      <span className={className}>{renderValue(text)}</span>
      {isCopied ? (
        <Check className="w-4 h-4 text-success" />
      ) : (
        <Copy
          className="w-4 h-4 opacity-0 group-hover:opacity-100 hover:text-foreground transition-opacity cursor-pointer"
          onClick={() => {
            handleCopy(text).catch((error: unknown) => {
              reportError("Failed to copy token text:", error);
            });
          }}
        />
      )}
    </div>
  );
};

// Token amount cell with the QRL-balance-style slot-machine cascade
// while tokenStore.isRefreshingBalances is on, plus the same copy
// affordance as CopyableText.
export const BalanceCell = observer(({ amount }: { amount: unknown }) => {
  const { tokenStore } = useStore();
  const [isCopied, setIsCopied] = useState(false);

  const handleCopy = async (textToCopy: unknown) => {
    const success = await copyToClipboard(textToCopy);
    if (success) {
      setIsCopied(true);
      setTimeout(() => {
        setIsCopied(false);
      }, 1500);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 group font-numeric">
      <SlotBalance
        value={stringValue(amount)}
        spinning={tokenStore.isRefreshingBalances}
      />
      {isCopied ? (
        <Check className="w-4 h-4 text-success" />
      ) : (
        <Copy
          className="w-4 h-4 opacity-0 group-hover:opacity-100 hover:text-foreground transition-opacity cursor-pointer"
          onClick={() => {
            handleCopy(amount).catch((error: unknown) => {
              reportError("Failed to copy token balance:", error);
            });
          }}
        />
      )}
    </div>
  );
});

export const HideTokenButton = ({ tokenAddress }: { tokenAddress: string }) => {
  const { t } = useTranslation(["tokens", "common"]);
  const { tokenStore } = useStore();

  const handleHide = (e: React.MouseEvent) => {
    e.stopPropagation();
    tokenStore.hideToken(tokenAddress).catch((error: unknown) => {
      reportError("Failed to hide token:", error);
    });
  };

  return (
    <span title={t("tokens:hide")}>
      <EyeOff
        className="w-4 h-4 opacity-50 hover:opacity-100 cursor-pointer transition-opacity"
        onClick={handleHide}
      />
    </span>
  );
};
