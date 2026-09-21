import { useState, useEffect } from "react";
import { observer } from "mobx-react-lite";
import axios from "axios";
import { BigNumber } from "bignumber.js";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { SERVER_URL } from "@/config";
import { historyNetwork } from "@/config/runtimeProfile";
import { formatBalance, formatAddressShort } from "@/utils/formatting";
import { Card, CardContent } from "../../../../UI/Card";
import { Button } from "../../../../UI/Button";
import { getExplorerAddressUrl, getExplorerTxUrl } from "@/config";
import { openExternalUrl } from "@/utils/nativeApp";

type TransactionHistoryType = {
  ID: string;
  InOut: number;
  // Raw EIP-1559 envelope type from the node ("0x2" for every v2 tx),
  // not a user-facing category. Direction is derived from InOut instead.
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

const DUST_DISPLAY_FLOOR = new BigNumber("0.000001");

const formatTxAmount = (amount: string): string => {
  const bn = new BigNumber(amount);
  if (bn.isNaN() || bn.isZero()) return "0";
  if (bn.abs().lt(DUST_DISPLAY_FLOOR)) return "<0.000001";
  return formatBalance(amount);
};

interface TransactionHistoryPopupProps {
  accountAddress: string;
  blockchain: string;
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
    const [transactions, setTransactions] = useState<TransactionHistoryType[]>(
      [],
    );
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const network = historyNetwork(blockchain);

    useEffect(() => {
      const controller = new AbortController();
      setTransactions([]);
      setError(null);
      if (!isOpen || !accountAddress) {
        setLoading(false);
        return () => controller.abort();
      }
      if (!network) {
        setLoading(false);
        setError("Transaction history is unavailable for this network.");
        return () => controller.abort();
      }
      setLoading(true);
      void (async () => {
        try {
          const response = await axios.post<{
            transactions: TransactionHistoryType[];
          }>(
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
          if (!Array.isArray(response.data.transactions))
            throw new Error("Invalid transaction history response");
          setTransactions(response.data.transactions);
        } catch (cause) {
          if (controller.signal.aborted) return;
          const unavailable =
            axios.isAxiosError(cause) && cause.response?.status === 501;
          setError(
            unavailable
              ? "Transaction history is unavailable for this network."
              : "Unable to load transaction history. Please try again.",
          );
        } finally {
          if (!controller.signal.aborted) setLoading(false);
        }
      })();
      return () => controller.abort();
    }, [isOpen, accountAddress, network]);

    const viewAllTransactions = () => {
      openExternalUrl(getExplorerAddressUrl(accountAddress, blockchain));
      onClose();
    };

    if (!isOpen) return null;

    return (
      <div
        className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
        onClick={onClose}
      >
        <Card
          className="w-full max-w-md mx-4 max-h-[80vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          <CardContent className="p-4">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold">Recent Transactions</h2>
              <Button variant="ghost" size="sm" onClick={onClose}>
                ×
              </Button>
            </div>

            {loading ? (
              <div className="text-center py-8 text-muted-foreground">
                Loading...
              </div>
            ) : error ? (
              <div role="alert" className="text-center py-8 text-red-400">
                {error}
              </div>
            ) : transactions.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No transactions found
              </div>
            ) : (
              <div className="divide-y divide-border">
                {transactions.map((tx) => {
                  const isIncoming = tx.InOut === 1;
                  const amountText = formatTxAmount(tx.Amount);
                  const isZero = amountText === "0";
                  const sign =
                    isZero || amountText.startsWith("<")
                      ? ""
                      : isIncoming
                        ? "+"
                        : "-";
                  const amountClass = isZero
                    ? "text-muted-foreground"
                    : isIncoming
                      ? "text-success"
                      : "text-red-400";
                  const counterparty = isIncoming
                    ? `From ${formatAddressShort(tx.From)}`
                    : tx.To
                      ? `To ${formatAddressShort(tx.To)}`
                      : "Contract creation";

                  return (
                    <button
                      key={tx.ID}
                      type="button"
                      title="View transaction on Explorer"
                      onClick={() =>
                        openExternalUrl(getExplorerTxUrl(tx.TxHash, blockchain))
                      }
                      className="w-full flex items-start justify-between gap-3 px-1 py-3 text-left rounded-md transition-colors hover:bg-foreground/5"
                    >
                      <div className="flex items-start gap-2.5 min-w-0">
                        <div
                          className={`mt-0.5 shrink-0 rounded-full p-1.5 ${isIncoming ? "bg-success/10 text-success" : "bg-red-400/10 text-red-400"}`}
                        >
                          {isIncoming ? (
                            <ArrowDownLeft size={14} />
                          ) : (
                            <ArrowUpRight size={14} />
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-medium">
                            {isIncoming ? "Received" : "Sent"}
                          </div>
                          <div className="text-xs text-muted-foreground font-data break-words">
                            {counterparty}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {new Date(
                              parseInt(tx.TimeStamp, 16) * 1000,
                            ).toLocaleString()}
                          </div>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className={`text-sm font-data ${amountClass}`}>
                          {sign}
                          {amountText}
                        </div>
                        <div className="text-xs text-muted-foreground font-data">
                          Quanta
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            <div className="mt-4 flex justify-center">
              <Button variant="outline" onClick={viewAllTransactions}>
                View All in Explorer
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  },
);
