import { useTranslation } from "react-i18next";
/**
 * Transaction Review - Displays transaction details for dApp approval.
 */

import { formatQuantaValue } from "@/utils/formatting";
import { QrlAddress } from "@/components/UI/QrlAddress";
import { isDesktop } from "@/desktop/bridge";
import { reviewValueKey } from "./reviewIdentity";

interface TransactionReviewProps {
  params: Record<string, unknown>;
  /**
   * The most this transaction can cost in network fees, quoted by the wallet
   * before the user decides. Absent while the quote is in flight, or when the
   * wallet refused it.
   */
  maxNetworkFee?: string | undefined;
  feeReviewValue?: string | undefined;
}

function formatGasLimit(gas: unknown, unknownLabel: string): string {
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
  return unknownLabel;
}

/** Review fields come from validated JSON; anything that is not a string is shown as absent. */
function stringParam(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

const DAppTransactionReview: React.FC<TransactionReviewProps> = ({
  params,
  maxNetworkFee,
  feeReviewValue,
}) => {
  const { t } = useTranslation(["dapps", "common", "settings", "transfer"]);
  const from = stringParam(params["from"]) || "Unknown";
  const to = stringParam(params["to"]) || "Unknown";
  const value = stringParam(params["value"]);
  const data = stringParam(params["data"]);
  const gas = params["gas"];

  const displayValue = formatQuantaValue(value);

  return (
    <div className="space-y-3 rounded-md border border-border bg-muted/30 p-4 text-sm">
      <div data-review-block data-review-value={reviewValueKey(params['from'])} className="flex justify-between">
        <span className="text-muted-foreground">{t("transfer:from")}</span>
        {from === "Unknown" ? (
          <span className="text-xs">{stringParam(params["from"]) || t("dapps:unknownValue")}</span>
        ) : (
          <QrlAddress
            address={from}
            mode="full"
            className="max-w-[75%] justify-end text-right"
            addressClassName="text-xs"
          />
        )}
      </div>
      <div data-review-block data-review-value={reviewValueKey(params['to'])} className="flex justify-between">
        <span className="text-muted-foreground">{t("dapps:to")}</span>
        {to === "Unknown" ? (
          <span className="text-xs">{stringParam(params["to"]) || t("dapps:unknownValue")}</span>
        ) : (
          <QrlAddress
            address={to}
            mode="full"
            className="max-w-[75%] justify-end text-right"
            addressClassName="text-xs"
          />
        )}
      </div>
      <div data-review-block data-review-value={reviewValueKey(params['value'])} className="flex justify-between gap-2">
        <span className="text-muted-foreground">{t("dapps:value")}</span>
        <span className="font-numeric font-semibold">{displayValue === "invalid value" ? t("dapps:invalidValue") : displayValue}</span>
      </div>
      {gas != null && (
        <div data-review-block data-review-value={reviewValueKey(gas)} className="flex justify-between gap-2">
          {/* On desktop the shell resolves max(this value, its own buffered
              estimate), so the number the dApp asked for is a floor. The web
              and mobile paths sign the requested limit as given. */}
          <span className="text-muted-foreground">{t(isDesktop ? "dapps:gasMinimum" : "dapps:gasLimit")}
          </span>
          <span className="font-numeric">{formatGasLimit(gas, t("dapps:unknownValue"))}</span>
        </div>
      )}
      {maxNetworkFee !== undefined && (
        <div data-review-block data-review-value={feeReviewValue} className="flex justify-between gap-2">
          {/* The ceiling, so the user sees the worst case before approving.
              Unused headroom in the base fee is refunded. */}
          <span className="text-muted-foreground">{t("dapps:maxFee")}</span>
          <span className="font-numeric">{maxNetworkFee === "invalid value" ? t("dapps:invalidValue") : maxNetworkFee}</span>
        </div>
      )}
      {typeof params['chainId'] === 'string' && (
        <div data-review-block className="flex justify-between gap-2">
          <span className="text-muted-foreground">{t("dapps:chainId")}</span>
          <span>{params['chainId']}</span>
        </div>
      )}
      {data && data !== "0x" && (
        <div>
          <span data-review-block className="block text-muted-foreground">{t("dapps:data")}</span>
          <div data-review-block className="mt-1 max-h-20 overflow-auto rounded bg-muted p-2 font-mono text-xs break-all">
            {data}
          </div>
        </div>
      )}
    </div>
  );
};

export default DAppTransactionReview;
