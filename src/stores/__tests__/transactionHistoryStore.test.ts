/** @jest-environment jsdom */
import { TransactionHistoryStore } from "../transactionHistoryStore";
import { mergeHistory, parseHistoryResponse } from "@/utils/transactionHistory";
import type { HistoryRpc } from "../transactionHistoryStore";
import { QRL_ADDRESS_PATTERN } from "@/utils/web3/address";

const from = `Q${"a".repeat(128)}`;
const to = `Q${"b".repeat(128)}`;
const hash = `0x${"c".repeat(64)}`;
const details = {
  blockchain: "TEST_NET_V3",
  from,
  to,
  hash,
  amount: "1.123456789012345678",
  nonce: 7n,
};
const receipt = {
  transactionHash: hash,
  blockNumber: "0x42",
  status: "0x1",
  gasUsed: "0x5208",
  effectiveGasPrice: "0x3b9aca00",
};
const row = {
  ID: "indexed",
  InOut: 0,
  TxType: "0x2",
  Address: from,
  From: from,
  To: to,
  TxHash: hash,
  TimeStamp: "0x42",
  Amount: details.amount,
  BlockNumber: "0x42",
  Status: "0x1",
};
const request = () =>
  jest.fn<Promise<unknown>, [Parameters<HistoryRpc["request"]>[0]]>();
const stillCurrent = () => false;

beforeEach(() => localStorage.clear());
afterEach(() => jest.restoreAllMocks());

it("persists exact broadcast details and reloads with the original submission time", () => {
  const store = new TransactionHistoryStore();
  const entry = store.record(details);
  expect(entry).toMatchObject({
    amount: details.amount,
    to,
    hash,
    state: "pending",
    nonce: "7",
  });
  expect(new TransactionHistoryStore().getSnapshot().entries).toEqual([entry]);
  store.record(details);
  expect(store.getSnapshot().entries).toEqual([entry]);
});

it("normalizes fractional native input without losing precision", () => {
  const store = new TransactionHistoryStore();
  store.record({ ...details, amount: ".123456789012345678" });
  expect(store.getSnapshot().entries[0]?.amount).toBe("0.123456789012345678");
});

it.each(["1.", "0.", "123456789012345678901234567890."])(
  "persists and reloads a trailing-dot amount: %s",
  (amount) => {
    const store = new TransactionHistoryStore();
    expect(store.record({ ...details, amount })?.amount).toBe(
      amount.slice(0, -1),
    );
    expect(new TransactionHistoryStore().getSnapshot().entries[0]?.amount).toBe(
      amount.slice(0, -1),
    );
  },
);

it.each([".", "1..", ".1.", "1e2", "-1."])(
  "rejects malformed decimal input: %s",
  (amount) => {
    expect(
      new TransactionHistoryStore().record({ ...details, amount }),
    ).toBeNull();
  },
);

it.each([
  from,
  `Q${"A".repeat(128)}`,
  from.toLowerCase(),
  `Q${"a".repeat(40)}`,
  `Q${"g".repeat(128)}`,
])(
  "uses the shared address format for both history addresses: %s",
  (address) => {
    for (const field of ["from", "to"] as const) {
      const store = new TransactionHistoryStore();
      expect(store.record({ ...details, [field]: address }) !== null).toBe(
        QRL_ADDRESS_PATTERN.test(address),
      );
    }
  },
);

it("isolates identical hashes by account and network and accepts concurrent sends", () => {
  const first = new TransactionHistoryStore();
  const second = new TransactionHistoryStore();
  first.record(details);
  second.record({ ...details, hash: `0x${"d".repeat(64)}` });
  first.record({ ...details, blockchain: "MAIN_NET" });
  first.record({ ...details, from: to });
  expect(new TransactionHistoryStore().getSnapshot().entries).toHaveLength(4);
});

it("ignores corrupt storage, mismatched keys, invalid amounts, hashes and networks", () => {
  localStorage.setItem("qrl:transaction-history:v1:broken", "{");
  const store = new TransactionHistoryStore();
  for (const change of [
    { hash: "bad" },
    { amount: "NaN" },
    { amount: "-1" },
    { from: "Qbad" },
    { blockchain: "unknown" },
  ]) {
    expect(store.record({ ...details, ...change })).toBeNull();
  }
  const tx = store.record(details);
  localStorage.clear();
  localStorage.setItem(
    "qrl:transaction-history:v1:wrong-key",
    JSON.stringify(tx),
  );
  expect(new TransactionHistoryStore().getSnapshot().entries).toEqual([]);
});

it("keeps a broadcast in memory and reports failed persistence across reload attempts", () => {
  const store = new TransactionHistoryStore();
  jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("quota");
  });
  store.record(details);
  store.reload();
  expect(store.getSnapshot().storageUnavailable).toBe(true);
  expect(store.getSnapshot().entries).toHaveLength(1);
});

it("reacts to storage events from another tab and handles cleared storage", () => {
  const store = new TransactionHistoryStore();
  const changed = jest.fn();
  const unsubscribe = store.subscribe(changed);
  new TransactionHistoryStore().record(details);
  window.dispatchEvent(
    new StorageEvent("storage", { key: localStorage.key(0) }),
  );
  expect(store.getSnapshot().entries).toHaveLength(1);
  localStorage.clear();
  window.dispatchEvent(new StorageEvent("storage", { key: null }));
  expect(store.getSnapshot().entries).toHaveLength(0);
  expect(changed).toHaveBeenCalledTimes(2);
  unsubscribe();
});

it("preserves a receipt recorded by another tab when a late broadcast event arrives", () => {
  const first = new TransactionHistoryStore();
  const stale = new TransactionHistoryStore();
  first.record(details);
  first.settle(details.blockchain, from, hash, receipt);
  stale.record(details);
  expect(new TransactionHistoryStore().getSnapshot().entries[0]?.state).toBe(
    "confirmed",
  );
});

it("preserves another tab's receipt while an older RPC view suggests a drop", async () => {
  const first = new TransactionHistoryStore();
  first.record(details);
  const stale = new TransactionHistoryStore();
  first.settle(details.blockchain, from, hash, receipt);
  const rpc = request()
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce("0x8")
    .mockResolvedValueOnce(null);
  await stale.reconcile(
    details.blockchain,
    from,
    { request: rpc },
    stillCurrent,
  );
  expect(new TransactionHistoryStore().getSnapshot().entries[0]?.state).toBe(
    "confirmed",
  );
});

it.each([
  ["0x1", "confirmed"],
  ["0x0", "failed"],
  [0n, "failed"],
  [true, "confirmed"],
])("resolves receipt status %s and persists fees", async (status, state) => {
  const store = new TransactionHistoryStore();
  store.record(details);
  const rpc = request().mockResolvedValue({ ...receipt, status });
  await store.reconcile(
    details.blockchain,
    from,
    { request: rpc },
    stillCurrent,
  );
  expect(new TransactionHistoryStore().getSnapshot().entries[0]).toMatchObject({
    state,
    blockNumber: "66",
    paidFees: "0.000021",
  });
  expect(rpc).toHaveBeenCalledTimes(1);
});

it.each([
  null,
  {},
  { ...receipt, status: "unknown" },
  { ...receipt, transactionHash: `0x${"d".repeat(64)}` },
  { ...receipt, blockNumber: null },
])("keeps malformed or absent receipts pending: %j", async (value) => {
  const store = new TransactionHistoryStore();
  store.record(details);
  const rpc = request().mockResolvedValue(value);
  await store.reconcile(
    details.blockchain,
    from,
    { request: rpc },
    stillCurrent,
  );
  expect(store.getSnapshot().entries[0]?.state).toBe("pending");
});

it("keeps old transactions pending across RPC failures and unconsumed nonces", async () => {
  const store = new TransactionHistoryStore();
  store.record(details);
  const rpc = request().mockRejectedValueOnce(new Error("offline"));
  await store.reconcile(
    details.blockchain,
    from,
    { request: rpc },
    stillCurrent,
  );
  rpc
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce("0x7");
  await store.reconcile(
    details.blockchain,
    from,
    { request: rpc },
    stillCurrent,
  );
  expect(store.getSnapshot().entries[0]?.state).toBe("pending");
});

it("learns a remote signer's nonce from a matching transaction", async () => {
  const store = new TransactionHistoryStore();
  store.record({ ...details, nonce: undefined });
  const rpc = request()
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce({ hash, from, nonce: "0x7" });
  await store.reconcile(
    details.blockchain,
    from,
    { request: rpc },
    stillCurrent,
  );
  expect(store.getSnapshot().entries[0]?.nonce).toBe("7");
});

it("stops polling a confirmed drop across reloads and accepts a directly supplied receipt", async () => {
  const store = new TransactionHistoryStore();
  store.record(details);
  const rpc = request()
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce("0x8")
    .mockResolvedValueOnce(null);
  await store.reconcile(
    details.blockchain,
    from,
    { request: rpc },
    stillCurrent,
  );
  expect(new TransactionHistoryStore().getSnapshot().entries[0]?.state).toBe(
    "dropped",
  );
  rpc.mockClear();
  const reloaded = new TransactionHistoryStore();
  await reloaded.reconcile(
    details.blockchain,
    from,
    { request: rpc },
    stillCurrent,
  );
  expect(rpc).not.toHaveBeenCalled();
  expect(reloaded.settle(details.blockchain, from, hash, receipt)).toBe(true);
  expect(reloaded.getSnapshot().entries[0]?.state).toBe("confirmed");
});

it("rechecks the receipt after nonce advancement before declaring a drop", async () => {
  const store = new TransactionHistoryStore();
  store.record(details);
  const rpc = request()
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce("0x8")
    .mockResolvedValueOnce(receipt);
  await store.reconcile(
    details.blockchain,
    from,
    { request: rpc },
    stillCurrent,
  );
  expect(store.getSnapshot().entries[0]?.state).toBe("confirmed");
});

it("discards a receipt after its polling scope is cancelled", async () => {
  const store = new TransactionHistoryStore();
  store.record(details);
  let cancelled = false;
  const rpc: HistoryRpc = {
    request: async () => {
      cancelled = true;
      return receipt;
    },
  };
  await store.reconcile(details.blockchain, from, rpc, () => cancelled);
  expect(store.getSnapshot().entries[0]?.state).toBe("pending");
  await store.reconcile("MAIN_NET", from, { request: request() }, stillCurrent);
  expect(store.getSnapshot().entries[0]?.state).toBe("pending");
});

it("deduplicates case-insensitive indexed hashes and retains independent internal transfers", () => {
  const store = new TransactionHistoryStore();
  store.record(details);
  const backend = parseHistoryResponse({
    transactions: [row, { ...row, ID: "internal", IsInternal: true }],
  });
  const merged = mergeHistory(backend, store.getSnapshot().entries);
  expect(merged).toHaveLength(2);
  expect(merged.find((tx) => tx.ID === "indexed")?.state).toBe("confirmed");
  expect(
    mergeHistory([...backend, ...backend], store.getSnapshot().entries),
  ).toHaveLength(2);
});

it("retains both indexed directions of a self-send and deduplicates repeated IDs", () => {
  const store = new TransactionHistoryStore();
  store.record({ ...details, to: from });
  const backend = parseHistoryResponse({
    transactions: [
      { ...row, ID: "sent", To: from },
      {
        ...row,
        ID: "received",
        InOut: 1,
        To: from,
        TxHash: `0x${"C".repeat(64)}`,
      },
      { ...row, ID: "internal", IsInternal: true },
    ],
  });
  const merged = mergeHistory(
    [...backend, ...backend],
    store.getSnapshot().entries,
  );
  expect(merged).toHaveLength(3);
  expect(merged.find((tx) => tx.ID === "sent")).toMatchObject({
    InOut: 0,
    state: "confirmed",
  });
  expect(merged.find((tx) => tx.ID === "received")).toMatchObject({
    InOut: 1,
    state: "confirmed",
  });
  expect(merged.find((tx) => tx.ID === "internal")).toMatchObject({
    To: to,
    IsInternal: true,
  });
  expect(mergeHistory(backend, [])).toHaveLength(3);
});

it("clears every history key and its memory fallback while preserving unrelated storage", () => {
  const store = new TransactionHistoryStore();
  store.record(details);
  store.record({ ...details, blockchain: "MAIN_NET", from: to });
  localStorage.setItem("qrl:transaction-history:v1:broken", "{");
  localStorage.setItem("qrl:transaction-history:v10:unrelated", "keep");
  localStorage.setItem("preferences", "keep");
  const persist = jest
    .spyOn(Storage.prototype, "setItem")
    .mockImplementation(() => {
      throw new Error("quota");
    });
  store.record({ ...details, hash: `0x${"d".repeat(64)}` });
  persist.mockRestore();
  const listener = jest.fn();
  const unsubscribe = store.subscribe(listener);
  store.clear();
  expect(listener).toHaveBeenCalledTimes(1);
  store.reload();
  expect(store.getSnapshot()).toEqual({
    entries: [],
    storageUnavailable: false,
  });
  expect(new TransactionHistoryStore().getSnapshot().entries).toEqual([]);
  expect(localStorage.length).toBe(2);
  expect(localStorage.getItem("preferences")).toBe("keep");
  expect(localStorage.getItem("qrl:transaction-history:v10:unrelated")).toBe(
    "keep",
  );
  unsubscribe();
});

it("reports a failed wipe and clears its in-memory history", () => {
  const store = new TransactionHistoryStore();
  store.record(details);
  jest.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
    throw new Error("storage denied");
  });
  expect(() => store.clear()).toThrow("storage denied");
  expect(store.getSnapshot()).toEqual({
    entries: [],
    storageUnavailable: true,
  });
});

it("discards a pre-wipe receipt even when the same hash is recorded again", async () => {
  const store = new TransactionHistoryStore();
  store.record(details);
  const rpc = request().mockImplementation(async () => {
    store.clear();
    store.record(details);
    return receipt;
  });
  await store.reconcile(
    details.blockchain,
    from,
    { request: rpc },
    stillCurrent,
  );
  expect(store.getSnapshot().entries[0]?.state).toBe("pending");
  expect(rpc).toHaveBeenCalledTimes(1);
});

const numberedHash = (index: number) =>
  `0x${index.toString(16).padStart(64, "0")}`;

it("caps persisted entries at the newest 100 per chain and account across writers", () => {
  const first = new TransactionHistoryStore();
  const second = new TransactionHistoryStore();
  const now = jest.spyOn(Date, "now");
  const submittedAt = Date.now();
  first.record({ ...details, blockchain: "MAIN_NET" });
  first.record({ ...details, from: to });
  for (let index = 0; index < 102; index++) {
    now.mockReturnValue(submittedAt + index);
    (index % 2 === 0 ? first : second).record({
      ...details,
      hash: numberedHash(index),
    });
  }
  const entries = new TransactionHistoryStore().getSnapshot().entries;
  expect(entries).toHaveLength(102);
  expect(
    entries.filter(
      (tx) => tx.blockchain === details.blockchain && tx.from === from,
    ),
  ).toHaveLength(100);
  expect(
    entries.some(
      (tx) => tx.hash === numberedHash(0) || tx.hash === numberedHash(1),
    ),
  ).toBe(false);
  expect(localStorage.length).toBe(102);
});

it("prunes an oversized existing history on reload", () => {
  const template = new TransactionHistoryStore().record(details);
  for (let index = 0; index < 110; index++) {
    const hash = numberedHash(index);
    localStorage.setItem(
      `qrl:transaction-history:v1:${details.blockchain}:${from.toLowerCase()}:${hash}`,
      JSON.stringify({ ...template, hash, submittedAt: index }),
    );
  }
  expect(new TransactionHistoryStore().getSnapshot().entries).toHaveLength(100);
  expect(localStorage.length).toBe(100);
});

it("caps entries held in memory when persistence is unavailable", () => {
  const store = new TransactionHistoryStore(() => null);
  for (let index = 0; index < 105; index++) {
    store.record({ ...details, hash: numberedHash(index) });
  }
  store.reload();
  expect(store.getSnapshot().entries).toHaveLength(100);
  expect(store.getSnapshot().storageUnavailable).toBe(true);
});

it.each([undefined, 7n])(
  "stops polling after 24 hours with nonce %s",
  async (nonce) => {
    const now = jest.spyOn(Date, "now").mockReturnValue(1000);
    const store = new TransactionHistoryStore();
    store.record({ ...details, nonce });
    const rpc = request().mockImplementation(async ({ method }) =>
      method === "qrl_getTransactionCount" ? "0x7" : null,
    );
    now.mockReturnValue(1000 + 24 * 60 * 60 * 1000 - 1);
    await store.reconcile(
      details.blockchain,
      from,
      { request: rpc },
      stillCurrent,
    );
    expect(rpc).toHaveBeenCalledTimes(nonce === undefined ? 2 : 3);
    rpc.mockClear();
    now.mockReturnValue(1000 + 24 * 60 * 60 * 1000);
    const reloaded = new TransactionHistoryStore();
    await reloaded.reconcile(
      details.blockchain,
      from,
      { request: rpc },
      stillCurrent,
    );
    expect(rpc).not.toHaveBeenCalled();
    expect(reloaded.getSnapshot().entries[0]?.state).toBe("pending");
  },
);

it("limits reconciliation to 20 entries per pass and eventually checks every entry", async () => {
  const store = new TransactionHistoryStore();
  for (let index = 0; index < 45; index++) {
    store.record({ ...details, hash: numberedHash(index) });
  }
  const rpc = request().mockImplementation(async ({ method }) =>
    method === "qrl_getTransactionCount" ? "0x8" : null,
  );
  await store.reconcile(
    details.blockchain,
    from,
    { request: rpc },
    stillCurrent,
  );
  expect(rpc).toHaveBeenCalledTimes(80);
  await store.reconcile(
    details.blockchain,
    from,
    { request: rpc },
    stillCurrent,
  );
  await store.reconcile(
    details.blockchain,
    from,
    { request: rpc },
    stillCurrent,
  );
  expect(rpc).toHaveBeenCalledTimes(180);
  expect(
    store.getSnapshot().entries.every((tx) => tx.state === "dropped"),
  ).toBe(true);
});

it.each(["TOKEN", "Quanta"])(
  "uses a verified backend failure and keeps reviewed %s metadata",
  (asset) => {
    const store = new TransactionHistoryStore();
    store.record({ ...details, asset, amount: "2.5" });
    const merged = mergeHistory(
      parseHistoryResponse({
        transactions: [
          {
            ...row,
            Amount: "0",
            Status: "0x0",
            To: from,
            TxHash: `0x${"C".repeat(64)}`,
          },
        ],
      }),
      store.getSnapshot().entries,
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      state: "failed",
      Amount: "2.5",
      asset,
      To: to,
    });
  },
);

it.each([
  { transactions: null },
  { transactions: [null] },
  { transactions: [{ ...row, Amount: {} }] },
  { transactions: [{ ...row, TimeStamp: "bad" }] },
])("rejects malformed backend history: %j", (value) => {
  expect(() => parseHistoryResponse(value)).toThrow(
    "Invalid transaction history response",
  );
});
