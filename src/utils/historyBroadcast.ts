import { isCallable, isRecord } from "@/utils/guards";
import { transactionHistoryStore } from "@/stores/transactionHistoryStore";
import { historyHash, receiptUpdate } from "@/utils/transactionHistory";

type BroadcastDetails = Omit<
  Parameters<typeof transactionHistoryStore.record>[0],
  "hash"
>;
interface BroadcastEvents {
  on(event: string, listener: (value: unknown) => void): unknown;
}

function isBroadcastEvents(value: unknown): value is BroadcastEvents {
  return isRecord(value) && isCallable(value["on"]);
}

/** Capture the reviewed send details before asynchronous account changes. */
export function observeHistoryBroadcast(
  source: unknown,
  details: BroadcastDetails,
): void {
  if (!isBroadcastEvents(source)) return;
  let broadcastHash: string | null = null;
  source.on("transactionHash", (value) => {
    broadcastHash = historyHash(value);
    if (broadcastHash)
      transactionHistoryStore.record({ ...details, hash: broadcastHash });
  });
  const settle = (receipt: unknown) => {
    if (!isRecord(receipt)) return;
    const hash = historyHash(receipt["transactionHash"]);
    if (hash === null || (broadcastHash !== null && hash !== broadcastHash))
      return;
    if (receiptUpdate(receipt, hash) === null) return;
    transactionHistoryStore.record({ ...details, hash });
    transactionHistoryStore.settle(
      details.blockchain,
      details.from,
      hash,
      receipt,
    );
  };
  source.on("receipt", settle);
  source.on("error", (error) => {
    if (isRecord(error)) settle(error["receipt"]);
  });
}
