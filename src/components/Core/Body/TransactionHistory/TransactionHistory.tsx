import { historyStatusKey } from "@/i18n/historyStatusKey";
import { useTranslation } from "react-i18next";
import { PageShell } from "@/components/Core/Layout/PageShell";
import { Card } from "@/components/UI/Card";
import { createPortal } from "react-dom";
import { useTransactionHistory } from "@/hooks/useTransactionHistory";
import {
  parseHistoryResponse,
} from "@/utils/transactionHistory";
import type { HistoryRow } from "@/utils/transactionHistory";
import { observer } from "mobx-react-lite";
import { QrlAddress } from "@/components/UI/QrlAddress";
import { useStore } from "../../../../stores/store";
import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import axios from "axios";
import { BigNumber } from "bignumber.js";
import { SERVER_URL } from "@/config";
import { historyNetwork } from "@/config/runtimeProfile";
import { formatBalance } from "@/utils/formatting";
import { useBackDismiss } from "@/utils/useBackDismiss";

const TransactionHistory = observer(() => {
  const { t } = useTranslation(["history", "common"]);
  const { qrlStore } = useStore();
  const { activeAccount } = qrlStore;
  const blockchain = qrlStore.qrlConnection.blockchain;
  const network = historyNetwork(blockchain);
  const [transactionHistory, setTransactionHistory] = useState<HistoryRow[]>(
    [],
  );
  const { transactions: mergedTransactions, storageUnavailable } =
    useTransactionHistory(
      blockchain,
      activeAccount.accountAddress,
      transactionHistory,
    );
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [sortConfig, setSortConfig] = useState<{
    key: "TxHash" | "Amount" | "TimeStamp";
    direction: "ascending" | "descending";
  } | null>(null);
  const [currentPage, setCurrentPage] = useState<number>(0);
  const [hasMore, setHasMore] = useState<boolean>(true);
  const [error, setError] = useState<"history:unavailable" | "history:loadError" | null>(null);
  const requestGeneration = useRef(0);
  const requestController = useRef<AbortController | null>(null);
  const cancelRequest = useCallback(() => {
    requestGeneration.current++;
    requestController.current?.abort();
  }, []);

  const limit = 5;

  const fetchTransactionHistory = useCallback(
    async (page: number, reset: boolean = false) => {
      if (!network || !activeAccount.accountAddress) return;
      const generation = ++requestGeneration.current;
      requestController.current?.abort();
      const controller = new AbortController();
      requestController.current = controller;
      setLoading(true);
      setError(null);
      try {
        const response = await axios.post<unknown>(
          `${SERVER_URL}/tx-history`,
          {
            network,
            address: activeAccount.accountAddress,
            page: page,
            limit: limit,
          },
          { signal: controller.signal },
        );
        if (
          generation !== requestGeneration.current ||
          controller.signal.aborted
        )
          return;
        const newTransactions = parseHistoryResponse(response.data);
        setHasMore(newTransactions.length === limit);
        setCurrentPage(page);

        if (reset) {
          setTransactionHistory(newTransactions);
        } else {
          setTransactionHistory((prev) => [...prev, ...newTransactions]);
        }
      } catch (cause) {
        if (
          generation !== requestGeneration.current ||
          controller.signal.aborted
        )
          return;
        const unavailable =
          axios.isAxiosError(cause) && cause.response?.status === 501;
        setError(
          unavailable
            ? "history:unavailable"
            : "history:loadError",
        );
        if (unavailable) setHasMore(false);
      } finally {
        if (generation === requestGeneration.current) setLoading(false);
      }
    },
    [activeAccount.accountAddress, network],
  );

  useEffect(() => {
    setTransactionHistory([]);
    setCurrentPage(0);
    setHasMore(network !== null);
    setError(
      network ? null : "history:unavailable",
    );
    if (network && activeAccount.accountAddress) {
      void fetchTransactionHistory(1, true);
    } else {
      setLoading(false);
    }
    return cancelRequest;
  }, [
    activeAccount.accountAddress,
    network,
    fetchTransactionHistory,
    cancelRequest,
  ]);

  const sortedTransactions = useMemo(() => {
    const sortableTransactions = [...mergedTransactions];
    if (sortConfig !== null) {
      sortableTransactions.sort((a, b) => {
        const comparison =
          sortConfig.key === "Amount"
            ? (new BigNumber(a.Amount).comparedTo(b.Amount) ?? 0)
            : sortConfig.key === "TimeStamp"
              ? parseInt(a.TimeStamp, 16) - parseInt(b.TimeStamp, 16)
              : a.TxHash.localeCompare(b.TxHash);
        return sortConfig.direction === "ascending" ? comparison : -comparison;
      });
    }
    return sortableTransactions;
  }, [mergedTransactions, sortConfig]);

  const filteredTransactions = useMemo(() => {
    return sortedTransactions.filter(
      (tx) =>
        tx.TxType.toLowerCase().includes(searchTerm.toLowerCase()) ||
        tx.TxHash.toLowerCase().includes(searchTerm.toLowerCase()) ||
        tx.From.toLowerCase().includes(searchTerm.toLowerCase()) ||
        tx.To.toLowerCase().includes(searchTerm.toLowerCase()),
    );
  }, [sortedTransactions, searchTerm]);

  const requestSort = (key: "TxHash" | "Amount" | "TimeStamp") => {
    let direction: "ascending" | "descending" = "ascending";
    if (sortConfig?.key === key && sortConfig.direction === "ascending") {
      direction = "descending";
    }
    setSortConfig({ key, direction });
  };

  const handleLoadMore = () => {
    if (!loading) {
      const nextPage = currentPage + 1;
      void fetchTransactionHistory(nextPage, currentPage === 0);
    }
  };

  return (
    <PageShell title={t("history:pageTitle")} width="wide" seoTitle={t("history:pageTitle")}>
      <Card className="p-6">
      <div className="mb-4 flex flex-col sm:flex-row justify-between items-center">
        <input
          type="text"
          placeholder={t("history:search")}
          value={searchTerm}
          onChange={(e) => {
            setSearchTerm(e.target.value);
          }}
          className="border p-2 rounded w-full sm:w-1/3 bg-card mb-4 sm:mb-0"
        />
      </div>
      {storageUnavailable && (
        <p role="alert" className="mb-4 text-sm text-red-400">
          {t("history:storageError")}
        </p>
      )}
      {error && (
        <div role="alert" className="mb-4 text-sm text-red-400">
          {t(error)}
        </div>
      )}
      {loading && filteredTransactions.length === 0 ? (
        <div className="text-center">{t("common:loading")}</div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="block w-full bg-card sm:table">
              <thead className="hidden sm:table-header-group">
                <tr>
                  <th
                    className="py-2 px-4 border-b cursor-pointer text-left text-sm sm:text-base"
                    onClick={() => {
                      requestSort("TxHash");
                    }}
                  >
                    {t("history:hash")}{" "}
                    {sortConfig?.key === "TxHash"
                      ? sortConfig.direction === "ascending"
                        ? "↑"
                        : "↓"
                      : ""}
                  </th>
                  <th
                    className="py-2 px-4 border-b cursor-pointer text-left text-sm sm:text-base hidden sm:table-cell"
                    onClick={() => {
                      requestSort("Amount");
                    }}
                  >
                    {t("history:amountUnit", { unit: "Quanta" })}{" "}
                    {sortConfig?.key === "Amount"
                      ? sortConfig.direction === "ascending"
                        ? "↑"
                        : "↓"
                      : ""}
                  </th>
                  <th
                    className="py-2 px-4 border-b cursor-pointer text-left text-sm sm:text-base table-cell sm:hidden"
                    onClick={() => {
                      requestSort("Amount");
                    }}
                  >
                    {t("history:amount")}{" "}
                    {sortConfig?.key === "Amount"
                      ? sortConfig.direction === "ascending"
                        ? "↑"
                        : "↓"
                      : ""}
                  </th>
                  <th
                    className="py-2 px-4 border-b cursor-pointer text-left text-sm sm:text-base"
                    onClick={() => {
                      requestSort("TimeStamp");
                    }}
                  >
                    {t("history:date")}{" "}
                    {sortConfig?.key === "TimeStamp"
                      ? sortConfig.direction === "ascending"
                        ? "↑"
                        : "↓"
                      : ""}
                  </th>
                  <th className="py-2 px-4 border-b text-left text-sm sm:text-base">
                    {t("history:details")}
                  </th>
                </tr>
              </thead>
              <tbody className="block sm:table-row-group">
                {filteredTransactions.map((tx) => (
                  <tr
                    key={tx.ID}
                    className="block border-b hover:bg-muted sm:table-row sm:border-0"
                  >
                    <td className="block py-2 px-4 break-all text-sm sm:table-cell sm:border-b sm:text-base">
                      <button
                        type="button"
                        className="block text-xs text-muted-foreground sm:hidden"
                        onClick={() => {
                          requestSort("TxHash");
                        }}
                        aria-label={t("history:sortHash")}
                      >
                        {t("history:hash")}
                      </button>
                      <span className="block">{tx.TxHash}</span>
                      <div className="mt-2 text-xs text-muted-foreground">
                        {t("history:status")}
                      </div>
                      <div className="text-sm">{t(historyStatusKey(tx))}</div>
                      <div className="mt-2 text-xs text-muted-foreground">
                        {tx.InOut === 1 ? t("history:fromLabel") : t("history:toLabel")}
                      </div>
                      <QrlAddress
                        address={tx.InOut === 1 ? tx.From : tx.To}
                        mode="compact"
                      />
                    </td>
                    <td className="block py-2 px-4 font-numeric text-sm sm:table-cell sm:border-b sm:text-base">
                      <button
                        type="button"
                        className="block text-xs text-muted-foreground sm:hidden"
                        onClick={() => {
                          requestSort("Amount");
                        }}
                        aria-label={t("history:sortAmount")}
                      >
                        {t("history:amountUnit", { unit: tx.asset ?? "Quanta" })}
                      </button>
                      {formatBalance(tx.Amount)}
                      {tx.asset && tx.asset !== "Quanta" && (
                        <div className="text-xs text-muted-foreground">
                          {tx.asset}
                        </div>
                      )}
                    </td>
                    <td className="block py-2 px-4 text-sm sm:table-cell sm:border-b sm:text-base">
                      <button
                        type="button"
                        className="block text-xs text-muted-foreground sm:hidden"
                        onClick={() => {
                          requestSort("TimeStamp");
                        }}
                        aria-label={t("history:sortDate")}
                      >
                        {t("history:date")}
                      </button>
                      {/* Short date for mobile */}
                      <span className="block sm:hidden">
                        {new Date(
                          parseInt(tx.TimeStamp, 16) * 1000,
                        ).toLocaleDateString()}
                      </span>
                      {/* Full date/time for larger screens */}
                      <span className="hidden sm:block">
                        {new Date(
                          parseInt(tx.TimeStamp, 16) * 1000,
                        ).toLocaleString()}
                      </span>
                    </td>
                    <td className="block py-2 px-4 text-sm sm:table-cell sm:border-b sm:text-base">
                      <DetailsModal transaction={tx} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex justify-center">
            <button
              onClick={handleLoadMore}
              className="px-4 py-2 rounded-md border border-foreground/10 bg-foreground/[0.06] text-sm sm:text-base cursor-pointer transition-colors hover:bg-foreground/10 disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={loading || !hasMore}
            >
              {loading
                ? t("common:loading")
                : hasMore
                  ? error
                    ? t("history:retry")
                    : t("history:loadMore")
                  : t("history:noMore")}
            </button>
          </div>
        </>
      )}
    </Card>
    </PageShell>
  );
});

type DetailsModalProps = {
  transaction: HistoryRow;
};

const DetailsModal = ({ transaction }: DetailsModalProps) => {
  const { t } = useTranslation(["history", "common"]);
  const [isOpen, setIsOpen] = useState(false);
  // Android's back button closes this the same way its Close button does.
  useBackDismiss(isOpen, () => {
    setIsOpen(false);
  });
  return (
    <>
      <button
        onClick={() => {
          setIsOpen(true);
        }}
        className="text-secondary underline text-sm sm:text-base"
      >
        {t("history:viewDetails")}
      </button>
      {isOpen &&
        createPortal(
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
            <div
              role="dialog"
              aria-modal="true"
              aria-label={t("history:detailsTitle")}
              className="bg-card p-4 rounded shadow-lg w-full sm:w-1/2 max-h-[calc(100dvh-2rem)] overflow-y-auto"
            >
              <h2 className="text-xl sm:text-2xl font-bold mb-2">
                {t("history:detailsTitle")}
              </h2>
              <div className="space-y-2">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div className="text-muted-foreground font-medium">{t("history:idDetail")}</div>
                  <div className="sm:col-span-2 break-all">
                    {transaction.ID}
                  </div>

                  <div className="text-muted-foreground font-medium">
                    {t("history:statusDetail")}
                  </div>
                  <div className="sm:col-span-2">
                    {t(historyStatusKey(transaction))}
                  </div>

                  <div className="text-muted-foreground font-medium">{t("history:typeDetail")}</div>
                  <div className="sm:col-span-2">
                    {transaction.InOut} ({transaction.TxType})
                  </div>

                  <div className="text-muted-foreground font-medium">
                    {t("history:addressDetail")}
                  </div>
                  <QrlAddress
                    address={transaction.Address}
                    mode="full"
                    className="sm:col-span-2"
                  />

                  <div className="text-muted-foreground font-medium">{t("history:fromDetail")}</div>
                  <QrlAddress
                    address={transaction.From}
                    mode="full"
                    className="sm:col-span-2"
                  />

                  <div className="text-muted-foreground font-medium">{t("history:toDetail")}</div>
                  <QrlAddress
                    address={transaction.To}
                    mode="full"
                    className="sm:col-span-2"
                  />

                  <div className="text-muted-foreground font-medium">
                    {t("history:hashDetail")}
                  </div>
                  <div className="sm:col-span-2 break-all">
                    {transaction.TxHash}
                  </div>

                  <div className="text-muted-foreground font-medium">{t("history:timeDetail")}</div>
                  <div className="sm:col-span-2">
                    {new Date(
                      parseInt(transaction.TimeStamp, 16) * 1000,
                    ).toLocaleString()}
                  </div>

                  <div className="text-muted-foreground font-medium">
                    {t("history:amountDetail")}
                  </div>
                  <div className="font-numeric sm:col-span-2">
                    {transaction.Amount} {transaction.asset ?? "Quanta"}
                  </div>

                  <div className="text-muted-foreground font-medium">{t("history:feesDetail")}</div>
                  <div className="font-numeric sm:col-span-2">
                    {transaction.PaidFees ?? t("history:unknown")}
                  </div>

                  <div className="text-muted-foreground font-medium">
                    {t("history:blockDetail")}
                  </div>
                  <div className="font-numeric sm:col-span-2">
                    {transaction.BlockNumber || t("history:unknown")}
                  </div>
                </div>
              </div>
              <button
                onClick={() => {
                  setIsOpen(false);
                }}
                className="mt-4 px-3 py-1 rounded-md border border-foreground/10 bg-foreground/[0.06] text-sm sm:text-base transition-colors hover:bg-foreground/10"
              >
                {t("common:close")}
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
};

export default TransactionHistory;
