import { isRecord } from "@/utils/guards";
import {
  historyHash,
  localTransactionSchema,
  receiptUpdate,
  unsignedQuantity,
} from "@/utils/transactionHistory";
import type { LocalTransaction } from "@/utils/transactionHistory";

const STORAGE_PREFIX = "qrl:transaction-history:v1:";
const MAX_ENTRIES_PER_ACCOUNT = 100;
const MAX_POLL_AGE_MS = 24 * 60 * 60 * 1000;
const POLL_INTERVAL_MS = 10000;
const POLL_BATCH_SIZE = 20;

function scopeKey(blockchain: string, from: string): string {
  return `${blockchain}:${from.toLowerCase()}`;
}

function entryKey(tx: LocalTransaction): string {
  return `${STORAGE_PREFIX}${tx.blockchain}:${tx.from.toLowerCase()}:${tx.hash}`;
}

export interface HistoryRpc {
  request(args: { method: string; params: string[] }): Promise<unknown>;
}

interface PollClient {
  rpc: HistoryRpc;
  cancelled: () => boolean;
}

interface HistoryPoller {
  clients: Set<PollClient>;
  release: (client: PollClient) => void;
}

/** Public transaction metadata only. Each broadcast has its own storage key. */
export class TransactionHistoryStore {
  private snapshot: {
    entries: LocalTransaction[];
    storageUnavailable: boolean;
  } = { entries: [], storageUnavailable: false };
  private listeners = new Set<() => void>();
  private unsaved = new Map<string, LocalTransaction>();
  private generation = 0;
  private pollOffsets = new Map<string, number>();
  private pollers = new Map<string, HistoryPoller>();

  constructor(
    private readonly storage: () => Storage | null = () =>
      typeof window === "undefined" ? null : window.localStorage,
  ) {
    this.reload();
  }

  getSnapshot = () => this.snapshot;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    if (this.listeners.size === 1 && typeof window !== "undefined")
      window.addEventListener("storage", this.onStorage);
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0 && typeof window !== "undefined")
        window.removeEventListener("storage", this.onStorage);
    };
  };

  private onStorage = (event: StorageEvent) => {
    if (event.key === null) this.unsaved.clear();
    else if (event.newValue === null) this.unsaved.delete(event.key);
    if (event.key === null || event.key.startsWith(STORAGE_PREFIX))
      this.reload();
  };

  reload = () => {
    try {
      const storage = this.storage();
      if (storage === null) {
        this.publish(this.snapshot.entries, true);
        return;
      }
      const entries: LocalTransaction[] = [];
      for (let index = 0; index < storage.length; index++) {
        const key = storage.key(index);
        if (key === null || !key.startsWith(STORAGE_PREFIX)) continue;
        try {
          const value: unknown = JSON.parse(storage.getItem(key) ?? "null");
          const parsed = localTransactionSchema.safeParse(value);
          if (parsed.success && entryKey(parsed.data) === key)
            entries.push(parsed.data);
        } catch {
          /* An unreadable entry stays outside the history. */
        }
      }
      const merged = new Map(entries.map((tx) => [entryKey(tx), tx]));
      for (const [key, tx] of this.unsaved) merged.set(key, tx);
      this.publish([...merged.values()], false);
    } catch {
      this.publish(this.snapshot.entries, true);
    }
  };

  /** Erase history for every account and chain, including unreadable entries. */
  clear() {
    this.generation += 1;
    this.unsaved.clear();
    this.pollOffsets.clear();
    let storageUnavailable = true;
    try {
      const storage = this.storage();
      if (storage === null)
        throw new Error("Transaction history storage unavailable");
      for (let index = storage.length - 1; index >= 0; index--) {
        const key = storage.key(index);
        if (key?.startsWith(STORAGE_PREFIX)) storage.removeItem(key);
      }
      storageUnavailable = false;
    } finally {
      this.snapshot = { entries: [], storageUnavailable };
      this.emit();
    }
  }

  private publish(entries: LocalTransaction[], storageUnavailable: boolean) {
    const counts = new Map<string, number>();
    const retained: LocalTransaction[] = [];
    for (const tx of [...entries].sort(
      (a, b) => b.submittedAt - a.submittedAt || a.hash.localeCompare(b.hash),
    )) {
      const scope = scopeKey(tx.blockchain, tx.from);
      const count = counts.get(scope) ?? 0;
      counts.set(scope, count + 1);
      if (count < MAX_ENTRIES_PER_ACCOUNT) retained.push(tx);
      else {
        const key = entryKey(tx);
        this.unsaved.delete(key);
        try {
          this.storage()?.removeItem(key);
        } catch {
          storageUnavailable = true;
        }
      }
    }
    this.snapshot = {
      entries: retained,
      storageUnavailable: storageUnavailable || this.unsaved.size > 0,
    };
    this.emit();
  }

  private emit() {
    for (const listener of this.listeners) listener();
  }

  private save(tx: LocalTransaction) {
    const key = entryKey(tx);
    let storageUnavailable = false;
    try {
      const storage = this.storage();
      if (storage === null) storageUnavailable = true;
      else {
        // Another tab may have already observed this transaction's receipt.
        const stored: unknown = JSON.parse(storage.getItem(key) ?? "null");
        const parsed = localTransactionSchema.safeParse(stored);
        if (
          parsed.success &&
          entryKey(parsed.data) === key &&
          (tx.state === "pending" || tx.state === "dropped") &&
          (parsed.data.state === "confirmed" ||
            parsed.data.state === "failed" ||
            parsed.data.state === "dropped")
        )
          tx = parsed.data;
        storage.setItem(key, JSON.stringify(tx));
      }
    } catch {
      storageUnavailable = true;
    }
    if (storageUnavailable) this.unsaved.set(key, tx);
    else this.unsaved.delete(key);
    this.snapshot = {
      entries: [
        ...this.snapshot.entries.filter((entry) => entryKey(entry) !== key),
        tx,
      ],
      storageUnavailable: storageUnavailable || this.unsaved.size > 0,
    };
    this.reload();
  }

  record(input: {
    blockchain: string;
    from: string;
    to: string;
    hash: unknown;
    amount: string;
    asset?: string;
    nonce?: unknown;
  }): LocalTransaction | null {
    const nonce = unsignedQuantity(input.nonce);
    const parsed = localTransactionSchema.safeParse({
      ...input,
      amount:
        input.amount.startsWith(".") && input.amount.length > 1
          ? `0${input.amount}`
          : input.amount,
      hash: historyHash(input.hash),
      asset: input.asset ?? "Quanta",
      nonce: nonce === null ? null : nonce.toString(),
      submittedAt: Date.now(),
      state: "pending",
      blockNumber: "",
      paidFees: null,
    });
    if (!parsed.success) return null;
    const existing = this.snapshot.entries.find(
      (tx) => entryKey(tx) === entryKey(parsed.data),
    );
    if (existing) return existing;
    this.save(parsed.data);
    return parsed.data;
  }

  settle(
    blockchain: string,
    from: string,
    hash: unknown,
    receipt: unknown,
  ): boolean {
    const tx = this.snapshot.entries.find(
      (entry) =>
        entry.blockchain === blockchain &&
        entry.from.toLowerCase() === from.toLowerCase() &&
        entry.hash === historyHash(hash),
    );
    if (!tx) return false;
    const update = receiptUpdate(receipt, tx.hash);
    if (!update) return false;
    this.save({ ...tx, ...update });
    return true;
  }

  /** Views of one account share a timer and one in-flight reconciliation. */
  watch(
    blockchain: string,
    from: string,
    rpc: HistoryRpc,
    cancelled: () => boolean,
  ): () => void {
    const scope = scopeKey(blockchain, from);
    const client = { rpc, cancelled };
    const existing = this.pollers.get(scope);
    if (existing) {
      existing.clients.add(client);
      return () => {
        existing.release(client);
      };
    }
    const clients = new Set([client]);
    let busy = false;
    const poll = async () => {
      if (busy) return;
      const current = [...clients].find((candidate) => !candidate.cancelled());
      if (current === undefined) return;
      busy = true;
      try {
        await this.reconcile(
          blockchain,
          from,
          current.rpc,
          () => clients.size === 0 || current.cancelled(),
        );
      } finally {
        busy = false;
      }
    };
    const interval = setInterval(() => {
      void poll();
    }, POLL_INTERVAL_MS);
    const release = (leaving: PollClient) => {
      clients.delete(leaving);
      if (clients.size === 0) {
        clearInterval(interval);
        this.pollers.delete(scope);
      }
    };
    this.pollers.set(scope, { clients, release });
    void poll();
    return () => {
      release(client);
    };
  }

  async reconcile(
    blockchain: string,
    from: string,
    rpc: HistoryRpc,
    cancelled: () => boolean,
  ): Promise<void> {
    const generation = this.generation;
    const isCancelled = () => cancelled() || generation !== this.generation;
    const entries = this.snapshot.entries.filter(
      (tx) =>
        tx.blockchain === blockchain &&
        tx.from.toLowerCase() === from.toLowerCase() &&
        tx.state === "pending" &&
        Date.now() - tx.submittedAt < MAX_POLL_AGE_MS,
    );
    const scope = scopeKey(blockchain, from);
    const offset = (this.pollOffsets.get(scope) ?? 0) % (entries.length || 1);
    const batch = [...entries.slice(offset), ...entries.slice(0, offset)].slice(
      0,
      POLL_BATCH_SIZE,
    );
    this.pollOffsets.set(scope, offset + batch.length);
    for (const tx of batch) {
      if (isCancelled()) return;
      try {
        const receipt = await rpc.request({
          method: "qrl_getTransactionReceipt",
          params: [tx.hash],
        });
        if (isCancelled()) return;
        if (this.settle(blockchain, from, tx.hash, receipt)) continue;
        if (receipt !== null) continue;
        const transaction = await rpc.request({
          method: "qrl_getTransactionByHash",
          params: [tx.hash],
        });
        if (isCancelled()) return;
        if (
          isRecord(transaction) &&
          historyHash(transaction["hash"]) === tx.hash &&
          typeof transaction["from"] === "string" &&
          transaction["from"].toLowerCase() === from.toLowerCase()
        ) {
          const nonce = unsignedQuantity(transaction["nonce"]);
          const current = this.snapshot.entries.find(
            (entry) => entryKey(entry) === entryKey(tx),
          );
          if (
            nonce !== null &&
            current?.state === "pending" &&
            current.nonce === null
          )
            this.save({ ...current, nonce: nonce.toString() });
          continue;
        }
        if (transaction !== null || tx.nonce === null) continue;
        const count = unsignedQuantity(
          await rpc.request({
            method: "qrl_getTransactionCount",
            params: [from, "latest"],
          }),
        );
        if (isCancelled()) return;
        if (count === null || count <= BigInt(tx.nonce)) continue;
        // Recheck after the nonce query to cover inclusion during this poll.
        const finalReceipt = await rpc.request({
          method: "qrl_getTransactionReceipt",
          params: [tx.hash],
        });
        if (isCancelled()) return;
        if (this.settle(blockchain, from, tx.hash, finalReceipt)) continue;
        const current = this.snapshot.entries.find(
          (entry) => entryKey(entry) === entryKey(tx),
        );
        if (finalReceipt === null && current?.state === "pending")
          this.save({ ...current, state: "dropped" });
      } catch {
        /* Transport errors leave the broadcast available for another poll. */
      }
    }
  }
}

export const transactionHistoryStore = new TransactionHistoryStore();
