/**
 * Transaction Review - Displays transaction details for dApp approval.
 */

import { formatQuantaValue } from "@/utils/formatting";
import { QrlAddress } from "@/components/UI/QrlAddress";
import { isDesktop } from "@/desktop/bridge";

interface TransactionReviewProps {
  params: Record<string, unknown>;
  /**
   * The most this transaction can cost in network fees, quoted by the wallet
   * before the user decides. Absent while the quote is in flight, or when the
   * wallet refused it.
   */
  maxNetworkFee?: string | undefined;
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

/** Review fields come from validated JSON; anything that is not a string is shown as absent. */
function stringParam(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

const DAppTransactionReview: React.FC<TransactionReviewProps> = ({
  params,
  maxNetworkFee,
}) => {
  const from = stringParam(params["from"]) || "Unknown";
  const to = stringParam(params["to"]) || "Unknown";
  const value = stringParam(params["value"]);
  const data = stringParam(params["data"]);
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
        <span className="font-numeric font-semibold">{displayValue}</span>
      </div>
      {gas != null && (
        <div className="flex justify-between">
          {/* On desktop the shell resolves max(this value, its own buffered
              estimate), so the number the dApp asked for is a floor. The web
              and mobile paths sign the requested limit as given. */}
          <span className="text-muted-foreground">
            Gas Limit{isDesktop ? " (minimum)" : ""}
          </span>
          <span className="font-numeric">{formatGasLimit(gas)}</span>
        </div>
      )}
      {maxNetworkFee !== undefined && (
        <div className="flex justify-between">
          {/* The ceiling, so the user sees the worst case before approving.
              Unused headroom in the base fee is refunded. */}
          <span className="text-muted-foreground">Max network fee</span>
          <span className="font-numeric">{maxNetworkFee}</span>
        </div>
      )}
      {typeof params['chainId'] === 'string' && (
        <div className="flex justify-between">
          <span className="text-muted-foreground">Chain ID</span>
          <span>{params['chainId']}</span>
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
