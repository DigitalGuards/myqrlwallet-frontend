import { createPortal } from "react-dom";
import { useTransactionHistory } from "@/hooks/useTransactionHistory";
import {
  historyStatus,
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
  const [error, setError] = useState<string | null>(null);
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
            ? "Transaction history is unavailable for this network."
            : "Unable to load transaction history. Please try again.",
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
      network ? null : "Transaction history is unavailable for this network.",
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
    <div className="page-enter p-4 sm:p-6">
      <h1 className="text-xl sm:text-2xl font-bold mb-4">
        Transaction History
      </h1>
      <div className="mb-4 flex flex-col sm:flex-row justify-between items-center">
        <input
          type="text"
          placeholder="Search loaded transactions..."
          value={searchTerm}
          onChange={(e) => {
            setSearchTerm(e.target.value);
          }}
          className="border p-2 rounded w-full sm:w-1/3 bg-card mb-4 sm:mb-0"
        />
      </div>
      {storageUnavailable && (
        <p role="alert" className="mb-4 text-sm text-red-400">
          Transaction history could not be saved. Keep this page open until
          confirmation.
        </p>
      )}
      {error && (
        <div role="alert" className="mb-4 text-sm text-red-400">
          {error}
        </div>
      )}
      {loading && filteredTransactions.length === 0 ? (
        <div className="text-center">Loading...</div>
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
                    Hash{" "}
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
                    Amount (Quanta){" "}
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
                    Amount{" "}
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
                    Date{" "}
                    {sortConfig?.key === "TimeStamp"
                      ? sortConfig.direction === "ascending"
                        ? "↑"
                        : "↓"
                      : ""}
                  </th>
                  <th className="py-2 px-4 border-b text-left text-sm sm:text-base">
                    Details
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
                        aria-label="Sort by hash"
                      >
                        Hash
                      </button>
                      <span className="block">{tx.TxHash}</span>
                      <div className="mt-2 text-xs text-muted-foreground">
                        Status
                      </div>
                      <div className="text-sm">{historyStatus(tx)}</div>
                      <div className="mt-2 text-xs text-muted-foreground">
                        {tx.InOut === 1 ? "From" : "To"}
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
                        aria-label="Sort by amount"
                      >
                        Amount ({tx.asset ?? "Quanta"})
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
                        aria-label="Sort by date"
                      >
                        Date
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
                ? "Loading..."
                : hasMore
                  ? error
                    ? "Retry"
                    : "Load More"
                  : "No more transactions"}
            </button>
          </div>
        </>
      )}
    </div>
  );
});

type DetailsModalProps = {
  transaction: HistoryRow;
};

const DetailsModal = ({ transaction }: DetailsModalProps) => {
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
        View
      </button>
      {isOpen &&
        createPortal(
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Transaction Details"
              className="bg-card p-4 rounded shadow-lg w-full sm:w-1/2 max-h-[calc(100dvh-2rem)] overflow-y-auto"
            >
              <h2 className="text-xl sm:text-2xl font-bold mb-2">
                Transaction Details
              </h2>
              <div className="space-y-2">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div className="text-muted-foreground font-medium">ID:</div>
                  <div className="sm:col-span-2 break-all">
                    {transaction.ID}
                  </div>

                  <div className="text-muted-foreground font-medium">
                    Status:
                  </div>
                  <div className="sm:col-span-2">
                    {historyStatus(transaction)}
                  </div>

                  <div className="text-muted-foreground font-medium">Type:</div>
                  <div className="sm:col-span-2">
                    {transaction.InOut} ({transaction.TxType})
                  </div>

                  <div className="text-muted-foreground font-medium">
                    Address:
                  </div>
                  <QrlAddress
                    address={transaction.Address}
                    mode="full"
                    className="sm:col-span-2"
                  />

                  <div className="text-muted-foreground font-medium">From:</div>
                  <QrlAddress
                    address={transaction.From}
                    mode="full"
                    className="sm:col-span-2"
                  />

                  <div className="text-muted-foreground font-medium">To:</div>
                  <QrlAddress
                    address={transaction.To}
                    mode="full"
                    className="sm:col-span-2"
                  />

                  <div className="text-muted-foreground font-medium">
                    Transaction Hash:
                  </div>
                  <div className="sm:col-span-2 break-all">
                    {transaction.TxHash}
                  </div>

                  <div className="text-muted-foreground font-medium">Time:</div>
                  <div className="sm:col-span-2">
                    {new Date(
                      parseInt(transaction.TimeStamp, 16) * 1000,
                    ).toLocaleString()}
                  </div>

                  <div className="text-muted-foreground font-medium">
                    Amount:
                  </div>
                  <div className="font-numeric sm:col-span-2">
                    {transaction.Amount} {transaction.asset ?? "Quanta"}
                  </div>

                  <div className="text-muted-foreground font-medium">Fees:</div>
                  <div className="font-numeric sm:col-span-2">
                    {transaction.PaidFees ?? "Unavailable"}
                  </div>

                  <div className="text-muted-foreground font-medium">
                    Block:
                  </div>
                  <div className="font-numeric sm:col-span-2">
                    {transaction.BlockNumber || "Unavailable"}
                  </div>
                </div>
              </div>
              <button
                onClick={() => {
                  setIsOpen(false);
                }}
                className="mt-4 px-3 py-1 rounded-md border border-foreground/10 bg-foreground/[0.06] text-sm sm:text-base transition-colors hover:bg-foreground/10"
              >
                Close
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
};

export default TransactionHistory;
