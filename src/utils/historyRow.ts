import { BigNumber } from "bignumber.js";
import type { HistoryRow } from "@/utils/transactionHistory";
import { historyStatus } from "@/utils/transactionHistory";
import { formatBalance } from "@/utils/formatting";
import { normalizeQrlAddress } from "@/utils/web3/address";

const DUST_DISPLAY_FLOOR = new BigNumber("0.000001");

export type HistoryTone = "success" | "danger" | "warning" | "muted";

export interface HistoryRowView {
  title: "Received" | "Sent";
  counterpartyLabel: string;
  /** Address in its canonical QIP-55 checksum casing, or null when absent. */
  counterparty: string | null;
  amount: string;
  amountTone: HistoryTone;
  unit: string;
  status: string;
  statusTone: HistoryTone;
  time: string;
  hash: string;
}

/** One canonical casing for every address the popup shows. */
export function displayAddress(address: string): string {
  return normalizeQrlAddress(address) ?? address;
}

export function formatTxAmount(amount: string): string {
  const bn = new BigNumber(amount);
  if (bn.isNaN() || bn.isZero()) return "0";
  if (bn.abs().lt(DUST_DISPLAY_FLOOR)) return "<0.000001";
  return formatBalance(amount);
}

export function formatHistoryTime(timestamp: string): string {
  const date = new Date(parseInt(timestamp, 16) * 1000);
  return Number.isNaN(date.getTime())
    ? "Unknown time"
    : date.toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      });
}

function statusTone(row: HistoryRow): HistoryTone {
  switch (row.state) {
    case "confirmed":
      return "success";
    case "failed":
    case "dropped":
      return "danger";
    case "pending":
      return "warning";
    default:
      return "muted";
  }
}

export function historyRowView(row: HistoryRow): HistoryRowView {
  const incoming = row.InOut === 1;
  const raw = incoming ? row.From : row.To;
  const amountText = formatTxAmount(row.Amount);
  const isZero = amountText === "0";
  const sign = isZero || amountText.startsWith("<") ? "" : incoming ? "+" : "-";
  return {
    title: incoming ? "Received" : "Sent",
    counterpartyLabel: incoming ? "From" : "To",
    counterparty: raw ? displayAddress(raw) : null,
    amount: `${sign}${amountText}`,
    amountTone: isZero ? "muted" : incoming ? "success" : "danger",
    unit: row.asset ?? "Quanta",
    status: historyStatus(row),
    statusTone: statusTone(row),
    time: formatHistoryTime(row.TimeStamp),
    hash: row.TxHash,
  };
}
