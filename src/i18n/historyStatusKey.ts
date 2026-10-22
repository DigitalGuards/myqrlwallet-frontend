import type { HistoryRow } from "@/utils/transactionHistory";

export function historyStatusKey(row: HistoryRow) {
  switch (row.state) {
    case "confirmed":
      return "history:confirmed";
    case "pending":
      return "history:pending";
    case "failed":
      return "history:failed";
    case "dropped":
      return "history:dropped";
    default:
      return "history:unknown";
  }
}
