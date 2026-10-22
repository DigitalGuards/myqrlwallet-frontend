import type { ParseKeys } from "i18next";
import { useTranslation } from "react-i18next";
import { blockchainKey } from "@/utils/storage/storage";
import { renderValue, toTemplateString } from "@/utils/guards";
import { isRecord } from "@/utils/guards";
import { unsignedQuantity } from "@/utils/transactionHistory";
import { reportError } from "@/utils/reportError";
import { Button } from "@/components/UI/Button";
import { Checkbox } from "@/components/UI/CheckBox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/UI/Dialog";
import { Input } from "@/components/UI/Input";
import { Label } from "@/components/UI/Label";
import { useEffect, useMemo, useState } from "react";
import { observer } from "mobx-react-lite";
import { Loader2, Sparkles } from "lucide-react";
import { useStore } from "@/stores/store";
import { fetchTokenInfo, fetchBalance, isValidQrlAddress } from "@/utils/web3";
import { formatUnits } from "@/utils/web3/units";
import { getOptimalTokenBalance } from "@/utils/formatting";
import type { TokenInterface } from "@/constants";
import { QRL_PROVIDER } from "@/config";
import { StorageUtil } from "@/utils/storage";
import { QrlAddress } from "@/components/UI/QrlAddress";

export const AddTokenModal = observer(
  ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) => {
    const { t } = useTranslation(["tokens", "common"]);
    const { qrlStore, tokenStore } = useStore();
    const { pendingDiscoveredTokens } = tokenStore;
    const { accountAddress: activeAccountAddress } = qrlStore.activeAccount;
    const [tokenAddress, setTokenAddress] = useState("");
    const [tokenInfo, setTokenInfo] = useState<TokenInterface | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isAddingPicks, setIsAddingPicks] = useState(false);
    const [error, setError] = useState<{
      key: ParseKeys<["tokens", "common"]>;
      reason?: string;
    } | null>(null);
    const [selectedAddresses, setSelectedAddresses] = useState<Set<string>>(
      new Set(),
    );

    // Re-fire discovery whenever the modal opens so the picker can't go
    // stale if the card mounted long ago. Drops selection state on reopen.
    useEffect(() => {
      if (!isOpen || !activeAccountAddress) return;
      setSelectedAddresses(new Set());
      tokenStore
        .discoverTokensForReview(activeAccountAddress)
        .catch((error: unknown) => {
          reportError("Failed to discover tokens:", error);
        });
    }, [isOpen, activeAccountAddress, tokenStore]);

    // pendingDiscoveredTokens filters out already-added tokens. Lower-cased
    // address keys for selection so the picker matches the store's dedupe.
    const selectableAddresses = useMemo(
      () => pendingDiscoveredTokens.map((token) => token.address.toLowerCase()),
      [pendingDiscoveredTokens],
    );

    // Prune selectedAddresses if a discovered token has since been added
    // elsewhere. This keeps the "Add Selected (n)" count accurate.
    useEffect(() => {
      setSelectedAddresses((prev) => {
        const allow = new Set(selectableAddresses);
        const next = new Set<string>();
        for (const a of prev) if (allow.has(a)) next.add(a);
        return next.size === prev.size ? prev : next;
      });
    }, [selectableAddresses]);

    const toggleSelection = (address: string) => {
      const key = address.toLowerCase();
      setSelectedAddresses((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
    };

    const addSelected = async () => {
      if (selectedAddresses.size === 0) return;
      setIsAddingPicks(true);
      setError(null);
      try {
        const picks = pendingDiscoveredTokens.filter((token) =>
          selectedAddresses.has(token.address.toLowerCase()),
        );
        await tokenStore.addDiscoveredTokens(picks);
        setSelectedAddresses(new Set());
        onClose();
      } catch (err) {
        setError(
          err instanceof Error
            ? { key: "tokens:addPicksReason", reason: err.message }
            : { key: "tokens:addPicksFailed" },
        );
      } finally {
        setIsAddingPicks(false);
      }
    };

    const addToken = async () => {
      setError(null);
      if (tokenInfo) {
        const data = await tokenStore.addToken(tokenInfo);
        if (data) {
          setTokenInfo(null);
          setTokenAddress("");
          onClose();
        } else {
          setError({ key: "tokens:exists" });
        }
      } else {
        setError({ key: "tokens:invalidAddress" });
      }
    };

    useEffect(() => {
      let cancelled = false;
      const init = async () => {
        if (!isValidQrlAddress(tokenAddress)) {
          setTokenInfo(null);
          setIsLoading(false);
          return;
        }

        try {
          setIsLoading(true);
          setError(null);
          const selectedBlockChain = await StorageUtil.getBlockChain();
          const info: unknown = await fetchTokenInfo(
            tokenAddress,
            QRL_PROVIDER[blockchainKey(selectedBlockChain)].url,
          );
          const balance: unknown = await fetchBalance(
            tokenAddress,
            activeAccountAddress,
            QRL_PROVIDER[blockchainKey(selectedBlockChain)].url,
          );
          if (cancelled) return;
          if (
            !isRecord(info) ||
            typeof info["name"] !== "string" ||
            typeof info["symbol"] !== "string"
          ) {
            throw new Error("Invalid token metadata.");
          }
          const name = info["name"];
          const symbol = info["symbol"];
          const decimals = info["decimals"];
          const decimalQuantity =
            decimals === undefined || decimals === null
              ? 18n
              : unsignedQuantity(decimals);
          if (decimalQuantity === null || decimalQuantity > 255n) {
            throw new Error("Invalid token decimals.");
          }
          const parsedDecimals = Number(decimalQuantity);
          const balanceQuantity =
            balance === undefined || balance === null
              ? 0n
              : unsignedQuantity(balance);
          if (balanceQuantity === null)
            throw new Error("Invalid token balance.");
          // Store the display-formatted balance (decimals applied) so the
          // token list doesn't flash the raw base-unit integer until the
          // next refreshTokenBalances cycle reformats it.
          let amount: string;
          try {
            amount = getOptimalTokenBalance(
              formatUnits(balanceQuantity, parsedDecimals),
              symbol,
              false,
            );
          } catch {
            amount = "0.0";
          }
          setTokenInfo({
            name,
            symbol,
            decimals: parsedDecimals,
            address: tokenAddress,
            amount,
          });
        } catch (err) {
          if (cancelled) return;
          reportError("Error fetching token info", err);
          setTokenInfo(null);
          setError(
            err instanceof Error
              ? { key: "tokens:fetchReason", reason: err.message }
              : { key: "tokens:fetchFailed" },
          );
        } finally {
          if (!cancelled) setIsLoading(false);
        }
      };
      void init();
      return () => {
        cancelled = true;
      };
    }, [tokenAddress, activeAccountAddress]);

    return (
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="sm:max-w-[600px] max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("tokens:add")}</DialogTitle>
            <DialogDescription>{t("tokens:addHint")}</DialogDescription>
          </DialogHeader>
          {error && (
            <div
              role="alert"
              className="rounded-md bg-destructive/15 p-3 text-sm text-destructive"
            >
              {t(error.key, { reason: error.reason })}
            </div>
          )}

          {pendingDiscoveredTokens.length > 0 && (
            <div className="rounded-md border bg-muted/30 p-3">
              <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                <Sparkles className="h-4 w-4 text-muted-foreground/70" />
                {t("tokens:discovered", {
                  count: pendingDiscoveredTokens.length,
                })}
              </div>
              <p className="mb-3 text-xs text-muted-foreground">
                {t("tokens:discoveredHint")}
              </p>
              <ul className="flex max-h-60 flex-col gap-2 overflow-y-auto">
                {pendingDiscoveredTokens.map((token) => {
                  const key = token.address.toLowerCase();
                  const checked = selectedAddresses.has(key);
                  return (
                    <li
                      key={key}
                      className="flex items-center gap-3 rounded-md border bg-background p-2"
                    >
                      <Checkbox
                        id={`discovered-${key}`}
                        checked={checked}
                        onCheckedChange={() => {
                          toggleSelection(token.address);
                        }}
                        disabled={isAddingPicks}
                      />
                      <Label
                        htmlFor={`discovered-${key}`}
                        className="flex flex-1 cursor-pointer flex-col gap-0.5"
                      >
                        <span className="text-sm font-medium">
                          {renderValue(token.name || t("tokens:unknown"))}{" "}
                          <span className="text-muted-foreground">
                            ({renderValue(token.symbol || "UNK")})
                          </span>
                        </span>
                        <QrlAddress
                          address={token.address}
                          className="text-xs text-muted-foreground"
                        />
                      </Label>
                    </li>
                  );
                })}
              </ul>
              <Button
                type="button"
                size="sm"
                className="mt-3 w-full"
                disabled={selectedAddresses.size === 0 || isAddingPicks}
                onClick={() => {
                  void addSelected();
                }}
              >
                {isAddingPicks ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t("tokens:adding")}
                  </>
                ) : (
                  <>
                    {t("tokens:addSelected", { count: selectedAddresses.size })}
                  </>
                )}
              </Button>
            </div>
          )}

          <div className="flex flex-col">
            <Label htmlFor="name" className="mb-2">
              {t("tokens:contractAddress")}
            </Label>
            <Input
              className="col-span-3"
              value={tokenAddress}
              onChange={(e) => {
                setTokenAddress(e.target.value);
                setError(null);
              }}
            />
          </div>
          {tokenInfo && (
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="name" className="text-right">
                  {t("tokens:tokenName")}
                </Label>
                <Input
                  className="col-span-3"
                  value={
                    tokenInfo.name == null
                      ? undefined
                      : toTemplateString(tokenInfo.name)
                  }
                  disabled
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="symbol" className="text-right">
                  {t("tokens:tokenSymbol")}
                </Label>
                <Input
                  className="col-span-3"
                  value={
                    tokenInfo.symbol == null
                      ? undefined
                      : toTemplateString(tokenInfo.symbol)
                  }
                  disabled
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="decimals" className="text-right">
                  {t("tokens:decimals")}
                </Label>
                <Input
                  className="col-span-3"
                  value={
                    tokenInfo.decimals == null
                      ? undefined
                      : toTemplateString(tokenInfo.decimals)
                  }
                  disabled
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="amount" className="text-right">
                  {t("tokens:amount")}
                </Label>
                <Input
                  className="col-span-3"
                  value={
                    tokenInfo.amount == null
                      ? undefined
                      : toTemplateString(tokenInfo.amount)
                  }
                  disabled
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              className="w-full"
              type="button"
              disabled={tokenAddress.length === 0 || isLoading}
              onClick={() => {
                addToken().catch((error: unknown) => {
                  setError(
                    error instanceof Error
                      ? { key: "tokens:addReason", reason: error.message }
                      : { key: "tokens:addFailed" },
                  );
                });
              }}
            >
              {t("tokens:add")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  },
);
