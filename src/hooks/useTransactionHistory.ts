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
    let cancelled = false;
    let busy = false;
    const poll = async () => {
      if (busy) return;
      busy = true;
      try {
        await transactionHistoryStore.reconcile(
          blockchain,
          account,
          {
            request: (args) => provider.requestManager.send(args),
          },
          () =>
            cancelled ||
            provider !== qrlStore.qrlInstance ||
            blockchain !== qrlStore.qrlConnection.blockchain,
        );
      } finally {
        busy = false;
      }
    };
    void poll();
    const interval = setInterval(() => {
      void poll();
    }, 10000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
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
