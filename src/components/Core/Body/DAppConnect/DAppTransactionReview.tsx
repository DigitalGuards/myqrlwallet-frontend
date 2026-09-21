/**
 * Transaction Review - Displays transaction details for dApp approval.
 */

import { formatQuantaValue } from "@/utils/formatting";
import { QrlAddress } from "@/components/UI/QrlAddress";

interface TransactionReviewProps {
  params: Record<string, unknown>;
}

function formatGasLimit(gas: unknown): string {
  if (typeof gas === "number" && Number.isFinite(gas)) {
    return String(Math.trunc(gas));
  }
  if (typeof gas === "bigint") {
    return gas.toString();
  }
  if (typeof gas === "string") {
    const parsed = Number.parseInt(gas, gas.startsWith("0x") ? 16 : 10);
    if (Number.isFinite(parsed)) {
      return String(parsed);
    }
    return gas;
  }
  return "Unknown";
}

const DAppTransactionReview: React.FC<TransactionReviewProps> = ({
  params,
}) => {
  const from = (params["from"] as string) || "Unknown";
  const to = (params["to"] as string) || "Unknown";
  const value = params["value"] as string | undefined;
  const data = params["data"] as string | undefined;
  const gas = params["gas"];

  const displayValue = formatQuantaValue(value);

  return (
    <div className="space-y-3 rounded-md border border-border bg-muted/30 p-4 text-sm">
      <div className="flex justify-between">
        <span className="text-muted-foreground">From</span>
        {from === "Unknown" ? (
          <span className="text-xs">Unknown</span>
        ) : (
          <QrlAddress
            address={from}
            mode="full"
            className="max-w-[75%] justify-end text-right"
            addressClassName="text-xs"
          />
        )}
      </div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">To</span>
        {to === "Unknown" ? (
          <span className="text-xs">Unknown</span>
        ) : (
          <QrlAddress
            address={to}
            mode="full"
            className="max-w-[75%] justify-end text-right"
            addressClassName="text-xs"
          />
        )}
      </div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">Value</span>
        <span className="font-semibold">{displayValue}</span>
      </div>
      {gas != null && (
        <div className="flex justify-between">
          <span className="text-muted-foreground">Gas Limit</span>
          <span>{formatGasLimit(gas)}</span>
        </div>
      )}
      {params['chainId'] != null && (
        <div className="flex justify-between">
          <span className="text-muted-foreground">Chain ID</span>
          <span>{String(params['chainId'])}</span>
        </div>
      )}
      {data && data !== "0x" && (
        <div>
          <span className="text-muted-foreground">Data</span>
          <div className="mt-1 max-h-20 overflow-auto rounded bg-muted p-2 font-mono text-xs break-all">
            {data}
          </div>
        </div>
      )}
    </div>
  );
};

export default DAppTransactionReview;
