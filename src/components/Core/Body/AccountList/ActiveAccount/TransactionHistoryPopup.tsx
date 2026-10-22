import type { ParseKeys } from "i18next";
import { historyStatusKey } from "@/i18n/historyStatusKey";
import { Trans, useTranslation } from "react-i18next";
import type { BlockchainSelection } from "@/utils/storage/storage";
import { useTransactionHistory } from "@/hooks/useTransactionHistory";
import { parseHistoryResponse } from "@/utils/transactionHistory";
import type { HistoryRow } from "@/utils/transactionHistory";
import { useState, useEffect, useRef } from "react";
import { observer } from "mobx-react-lite";
import axios from "axios";
import { SERVER_URL } from "@/config";
import { historyNetwork } from "@/config/runtimeProfile";
import { historyRowView } from "@/utils/historyRow";
import type { HistoryTone } from "@/utils/historyRow";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../../../../UI/Dialog";
import { Button } from "../../../../UI/Button";
import { CompactAddressText } from "../../../../UI/QrlAddress";
import { getExplorerAddressUrl, getExplorerTxUrl } from "@/config";
import { openExternalUrl } from "@/utils/nativeApp";

const TONE_CLASS: Record<HistoryTone, string> = {
  success: "text-success",
  danger: "text-red-400",
  warning: "text-amber-400",
  muted: "text-muted-foreground",
};

interface TransactionHistoryPopupProps {
  accountAddress: string;
  blockchain: BlockchainSelection;
  isOpen: boolean;
  onClose: () => void;
}

export const TransactionHistoryPopup = observer(
  ({
    accountAddress,
    blockchain,
    isOpen,
    onClose,
  }: TransactionHistoryPopupProps) => {
    const { t } = useTranslation(["history", "common"]);
    const [backendTransactions, setTransactions] = useState<HistoryRow[]>([]);
    const contentRef = useRef<HTMLDivElement>(null);
    const openerRef = useRef<HTMLElement | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<ParseKeys<["history", "common"]> | null>(
      null,
    );
    const network = historyNetwork(blockchain);
    const { transactions, storageUnavailable } = useTransactionHistory(
      blockchain,
      accountAddress,
      backendTransactions,
      isOpen,
    );

    useEffect(() => {
      const controller = new AbortController();
      setTransactions([]);
      setError(null);
      if (!isOpen || !accountAddress) {
        setLoading(false);
        return () => {
          controller.abort();
        };
      }
      if (!network) {
        setLoading(false);
        setError("history:unavailable");
        return () => {
          controller.abort();
        };
      }
      setLoading(true);
      void (async () => {
        try {
          const response = await axios.post<unknown>(
            `${SERVER_URL}/tx-history`,
            {
              network,
              address: accountAddress,
              page: 1,
              limit: 5,
            },
            { signal: controller.signal },
          );
          if (controller.signal.aborted) return;
          setTransactions(parseHistoryResponse(response.data));
        } catch (cause) {
          if (controller.signal.aborted) return;
          const unavailable =
            axios.isAxiosError(cause) && cause.response?.status === 501;
          setError(unavailable ? "history:unavailable" : "history:loadError");
        } finally {
          if (!controller.signal.aborted) setLoading(false);
        }
      })();
      return () => {
        controller.abort();
      };
    }, [isOpen, accountAddress, network]);

    const viewAllTransactions = () => {
      openExternalUrl(getExplorerAddressUrl(accountAddress, blockchain));
      onClose();
    };

    if (!isOpen) return null;

    return (
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <DialogContent
          ref={contentRef}
          onOpenAutoFocus={(event) => {
            // Remember the opening control so Escape and back return focus to
            // it, then start on the dialog itself so no row shows a ring.
            event.preventDefault();
            openerRef.current =
              document.activeElement instanceof HTMLElement
                ? document.activeElement
                : null;
            contentRef.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            openerRef.current?.focus();
            openerRef.current = null;
          }}
          className="max-h-[85dvh] focus:outline-none focus-visible:outline-none w-[calc(100%-2rem)] max-w-md gap-0 overflow-y-auto rounded-lg p-4 sm:p-5"
        >
          <DialogTitle className="pr-8 text-xl font-bold">
            {t("history:title")}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {t("history:description")}
          </DialogDescription>

          {storageUnavailable && (
            <p role="alert" className="mt-3 text-sm text-red-400">
              {t("history:storageError")}
            </p>
          )}
          {error && (
            <div role="alert" className="mt-3 text-sm text-red-400">
              {t(error)}
            </div>
          )}
          {loading && transactions.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              {t("common:loading")}
            </div>
          ) : transactions.length === 0 && !error ? (
            <div className="py-8 text-center text-muted-foreground">
              {t("history:empty")}
            </div>
          ) : (
            <ul className="mt-3 divide-y divide-border">
              {transactions.map((tx) => {
                const view = historyRowView(tx);
                return (
                  <li key={tx.ID}>
                    <button
                      type="button"
                      title={t("history:view")}
                      onClick={() => {
                        openExternalUrl(
                          getExplorerTxUrl(tx.TxHash, blockchain),
                        );
                      }}
                      className="flex w-full items-start justify-between gap-3 rounded-md px-1 py-3 text-left transition-colors hover:bg-foreground/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-medium">
                          {t(
                            view.title === "Received"
                              ? "history:received"
                              : "history:sent",
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {view.counterparty ? (
                            <Trans
                              t={t}
                              i18nKey={
                                view.title === "Received"
                                  ? "history:from"
                                  : "history:to"
                              }
                              components={{
                                address: (
                                  <CompactAddressText
                                    address={view.counterparty}
                                  />
                                ),
                              }}
                            />
                          ) : view.title === "Received" ? (
                            t("history:unknownSender")
                          ) : (
                            t("history:contractCreation")
                          )}
                        </div>
                        <div
                          className={`mt-1 text-xs ${TONE_CLASS[view.statusTone]}`}
                        >
                          {t(historyStatusKey(tx))}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {view.time === "Unknown time"
                            ? t("history:unknownTime")
                            : view.time}
                        </div>
                        <div className="mt-1 break-all font-data text-[11px] text-muted-foreground">
                          {view.hash}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div
                          className={`text-sm font-numeric ${TONE_CLASS[view.amountTone]}`}
                        >
                          {view.amount}
                        </div>
                        <div className="text-xs font-numeric text-muted-foreground">
                          {view.unit}
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="mt-4 flex justify-center">
            <Button variant="outline" onClick={viewAllTransactions}>
              {t("history:viewAll")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  },
);
