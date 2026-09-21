import { observer } from "mobx-react-lite";
import { QrlAddress } from "@/components/UI/QrlAddress";
import { useStore } from "../../../../stores/store";
import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import axios from "axios";
import { BigNumber } from "bignumber.js";
import { SERVER_URL } from "@/config";
import { historyNetwork } from "@/config/runtimeProfile";
import { formatBalance } from "@/utils/formatting";

type TransactionHistoryType = {
  ID: string;
  InOut: number;
  TxType: string;
  Address: string;
  From: string;
  To: string;
  TxHash: string;
  TimeStamp: string;
  Amount: string;
  PaidFees?: string;
  BlockNumber: string;
};

const TransactionHistory = observer(() => {
  const { qrlStore } = useStore();
  const { activeAccount } = qrlStore;
  const blockchain = qrlStore.qrlConnection.blockchain;
  const network = historyNetwork(blockchain);
  const [transactionHistory, setTransactionHistory] = useState<
    TransactionHistoryType[]
  >([]);
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
        const response = await axios.post<{
          transactions: TransactionHistoryType[];
        }>(
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
        const newTransactions = response.data.transactions;
        if (!Array.isArray(newTransactions))
          throw new Error("Invalid transaction history response");
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
    const sortableTransactions = [...transactionHistory];
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
  }, [transactionHistory, sortConfig]);

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
            <table className="min-w-full bg-card">
              <thead>
                <tr>
                  <th
                    className="py-2 px-4 border-b cursor-pointer text-left text-sm sm:text-base"
                    onClick={() => requestSort("TxHash")}
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
                    onClick={() => requestSort("Amount")}
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
                    onClick={() => requestSort("Amount")}
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
                    onClick={() => requestSort("TimeStamp")}
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
              <tbody>
                {filteredTransactions.map((tx) => (
                  <tr key={tx.ID} className="hover:bg-muted">
                    <td className="py-2 px-4 border-b break-all text-sm sm:text-base">
                      {/* Truncated TxHash for Mobile */}
                      <span className="block sm:hidden">
                        {tx.TxHash.length > 8
                          ? `${tx.TxHash.slice(0, 8)}...`
                          : tx.TxHash}
                      </span>
                      {/* Full TxHash for larger screens */}
                      <span className="hidden sm:block">{tx.TxHash}</span>
                    </td>
                    <td className="py-2 px-4 border-b text-sm sm:text-base">
                      {formatBalance(tx.Amount)}
                    </td>
                    <td className="py-2 px-4 border-b text-sm sm:text-base">
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
                    <td className="py-2 px-4 border-b text-sm sm:text-base">
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
  transaction: TransactionHistoryType;
};

const DetailsModal = ({ transaction }: DetailsModalProps) => {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="text-secondary underline text-sm sm:text-base"
      >
        View
      </button>
      {isOpen && (
        <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 p-4">
          <div className="bg-card p-4 rounded shadow-lg w-full sm:w-1/2">
            <h2 className="text-xl sm:text-2xl font-bold mb-2">
              Transaction Details
            </h2>
            <div className="space-y-2">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div className="text-muted-foreground font-medium">ID:</div>
                <div className="sm:col-span-2 break-all">{transaction.ID}</div>

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

                <div className="text-muted-foreground font-medium">Amount:</div>
                <div className="sm:col-span-2">{transaction.Amount}</div>

                <div className="text-muted-foreground font-medium">Fees:</div>
                <div className="sm:col-span-2">
                  {transaction.PaidFees ?? "Unavailable"}
                </div>

                <div className="text-muted-foreground font-medium">Block:</div>
                <div className="sm:col-span-2">{transaction.BlockNumber}</div>
              </div>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="mt-4 px-3 py-1 rounded-md border border-foreground/10 bg-foreground/[0.06] text-sm sm:text-base transition-colors hover:bg-foreground/10"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export default TransactionHistory;
