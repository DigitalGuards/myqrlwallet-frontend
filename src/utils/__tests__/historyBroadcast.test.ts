/** @jest-environment jsdom */
import { observeHistoryBroadcast } from "../historyBroadcast";
import { transactionHistoryStore } from "@/stores/transactionHistoryStore";
import { waitForDAppBroadcastSettlement } from "@/components/Core/Body/DAppConnect/dappBroadcastSettlement";

const from = `Q${"a".repeat(128)}`;
const to = `Q${"b".repeat(128)}`;
const hash = `0x${"c".repeat(64)}`;
const details = {
  blockchain: "TEST_NET",
  from,
  to,
  amount: "3.123456789012345678",
};
class Events {
  listeners = new Map<string, ((value: unknown) => void)[]>();
  on(event: string, listener: (value: unknown) => void) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
  }
  emit(event: string, value: unknown) {
    for (const listener of this.listeners.get(event) ?? []) listener(value);
  }
}

beforeEach(() => {
  localStorage.clear();
  transactionHistoryStore.reload();
});

it("records only after a valid hash is broadcast and retains exact submitted details", () => {
  const events = new Events();
  observeHistoryBroadcast(events, details);
  expect(transactionHistoryStore.getSnapshot().entries).toHaveLength(0);
  events.emit("transactionHash", "invalid");
  expect(transactionHistoryStore.getSnapshot().entries).toHaveLength(0);
  events.emit("transactionHash", hash);
  expect(transactionHistoryStore.getSnapshot().entries[0]).toMatchObject({
    ...details,
    hash,
    state: "pending",
  });
});

it.each([0n, 1n])(
  "updates a matching receipt with execution status %s and ignores a later timeout",
  (status) => {
    const events = new Events();
    observeHistoryBroadcast(events, details);
    events.emit("transactionHash", hash);
    events.emit("receipt", { transactionHash: hash, status, blockNumber: 5n });
    events.emit("error", new Error("timeout"));
    expect(transactionHistoryStore.getSnapshot().entries[0]?.state).toBe(
      status === 1n ? "confirmed" : "failed",
    );
  },
);

it("retains a pending broadcast on observation error and rejects mismatched receipts", () => {
  const events = new Events();
  observeHistoryBroadcast(events, details);
  events.emit("transactionHash", hash);
  events.emit("error", new Error("offline"));
  events.emit("receipt", {
    transactionHash: `0x${"d".repeat(64)}`,
    status: 1n,
    blockNumber: 5n,
  });
  expect(transactionHistoryStore.getSnapshot().entries).toHaveLength(1);
  expect(transactionHistoryStore.getSnapshot().entries[0]?.state).toBe(
    "pending",
  );
});

it("handles a missed hash event and a revert receipt carried by an error", () => {
  const events = new Events();
  observeHistoryBroadcast(events, details);
  events.emit("error", {
    receipt: { transactionHash: hash, status: false, blockNumber: 5n },
  });
  expect(transactionHistoryStore.getSnapshot().entries[0]?.state).toBe(
    "failed",
  );
});

it("does not create history for a rejected broadcast or an invalid receipt", () => {
  const events = new Events();
  observeHistoryBroadcast(events, details);
  events.emit("error", new Error("rejected"));
  events.emit("receipt", { transactionHash: hash, status: "invalid" });
  expect(transactionHistoryStore.getSnapshot().entries).toHaveLength(0);
});

it.each([0n, 1n])(
  "persists dApp broadcasts before answering and reconciles status %s after settlement",
  async (status) => {
    const events = new Events();
    observeHistoryBroadcast(events, details);
    const answer = jest.fn(() => {
      expect(transactionHistoryStore.getSnapshot().entries[0]?.state).toBe(
        "pending",
      );
    });
    const settled = waitForDAppBroadcastSettlement(events, {
      onTransactionHash: answer,
      onSuccess: () => undefined,
      onFailure: () => undefined,
      onUnknown: () => undefined,
    });
    events.emit("transactionHash", hash);
    events.emit("receipt", {
      transactionHash: hash,
      blockNumber: "0x42",
      status,
    });
    await settled;
    expect(answer).toHaveBeenCalledWith(hash);
    expect(transactionHistoryStore.getSnapshot().entries[0]?.state).toBe(
      status === 1n ? "confirmed" : "failed",
    );
  },
);
