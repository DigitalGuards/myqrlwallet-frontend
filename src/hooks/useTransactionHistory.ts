import { useEffect, useSyncExternalStore } from "react";
import { useStore } from "@/stores/store";
import { transactionHistoryStore } from "@/stores/transactionHistoryStore";
import { mergeHistory } from "@/utils/transactionHistory";
import type { HistoryRow } from "@/utils/transactionHistory";

export function useTransactionHistory(
  blockchain: string,
  account: string,
  backend: HistoryRow[],
  enabled = true,
) {
  const { qrlStore } = useStore();
  const provider = qrlStore.qrlInstance;
  const providerBlockchain = qrlStore.qrlConnection.blockchain;
  const snapshot = useSyncExternalStore(
    transactionHistoryStore.subscribe,
    transactionHistoryStore.getSnapshot,
  );

  useEffect(() => {
    transactionHistoryStore.reload();
    if (!enabled || !provider || blockchain !== providerBlockchain || !account)
      return;
    return transactionHistoryStore.watch(
      blockchain,
      account,
      { request: (args) => provider.requestManager.send(args) },
      () =>
        provider !== qrlStore.qrlInstance ||
        blockchain !== qrlStore.qrlConnection.blockchain,
    );
  }, [account, blockchain, enabled, provider, providerBlockchain, qrlStore]);

  const local = snapshot.entries.filter(
    (tx) =>
      tx.blockchain === blockchain &&
      tx.from.toLowerCase() === account.toLowerCase(),
  );
  return {
    transactions: mergeHistory(backend, local),
    storageUnavailable: local.length > 0 && snapshot.storageUnavailable,
  };
}
