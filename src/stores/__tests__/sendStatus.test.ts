/** @jest-environment jsdom */
import { configure, reaction } from "mobx";
import QrlStore from "../qrlStore";
import TokenStore from "../tokenStore";
import { transactionHistoryStore } from "../transactionHistoryStore";
import { parseUnits } from "@/utils/web3/units";
import { FEE_NOT_SHOWN } from "@/utils/web3/feePolicy";
import type { SendSigner } from "@/utils/sendStatus";

const FROM = `Q${"1".repeat(128)}`;
const TO = `Q${"2".repeat(128)}`;
const CONTRACT = `Q${"3".repeat(128)}`;
const HASH = `0x${"a".repeat(64)}`;
const RECEIPT = {
  transactionHash: HASH,
  blockHash: `0x${"b".repeat(64)}`,
  blockNumber: 42n,
  gasUsed: 21000n,
  effectiveGasPrice: 100n,
  status: 1n,
};
const TOKEN = {
  address: CONTRACT,
  name: "Token",
  symbol: "TOK",
  decimals: 6,
  amount: "10",
};
const mockParseUnits = parseUnits;
let mockDesktop = false;
const mockDesktopSend = jest.fn<Promise<unknown>, [unknown]>();

class Events {
  listeners = new Map<string, ((value: unknown) => void)[]>();
  on(event: string, listener: (value: unknown) => void) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
    return this;
  }
  emit(event: string, value: unknown) {
    for (const listener of this.listeners.get(event) ?? []) listener(value);
  }
  then(receive: (value: unknown) => void, fail: (error: unknown) => void) {
    this.on("resolved", receive);
    this.on("rejected", fail);
  }
}
let mockEvents = new Events();
const mockRpc = {
  getTransactionCount: async () => 7n,
  getGasPrice: async () => 100n,
  estimateGas: jest.fn(async () => 21000n),
  getTransactionReceipt: jest.fn<Promise<unknown>, [string]>(),
  accounts: {
    signTransaction: jest.fn(async () => ({ rawTransaction: "0x01" })),
    seedToAccount: jest.fn(() => ({ address: FROM })),
  },
  wallet: { add: jest.fn() },
  sendSignedTransaction: jest.fn(() => mockEvents),
  sendTransaction: jest.fn(() => mockEvents),
  Contract: class {
    methods = {
      transfer: (to: string, amount: string) => ({
        encodeABI: () =>
          `0xa9059cbb${to.slice(1)}${BigInt(amount).toString(16).padStart(64, "0")}`,
      }),
    };
  },
};

jest.mock("@/config/runtimeProfile", () => ({
  IS_V3_PROFILE: false,
  profileStorageKey: (key: string) => key,
  assertSupportedAccountSource: jest.fn(),
}));
jest.mock("@/config", () => ({
  QRL_PROVIDER: { TEST_NET: { url: "https://rpc.example" } },
  EXPLORER_BASE: "",
}));
jest.mock("@/utils", () => ({ log: jest.fn() }));
jest.mock("@/utils/crypto", () => ({
  deriveHexSeedAsync: jest.fn(async () => "fixture-seed"),
}));
jest.mock("@/desktop/bridge", () => ({
  get isDesktop() {
    return mockDesktop;
  },
  desktopSigner: {
    signAndSendTransaction: (args: unknown) => mockDesktopSend(args),
  },
}));
jest.mock("@/desktop/walletHydration", () => ({}));
jest.mock("@/utils/storage", () => ({
  StorageUtil: { getBlockChain: async () => "TEST_NET" },
}));
jest.mock("@/utils/web3", () => ({
  getQrlWeb3: async () => ({
    default: class {
      static providers: { HttpProvider: new (url: string) => object } = {
        HttpProvider: class {},
      };
      qrl = mockRpc;
    },
    utils: {
      toPlanck: (value: string) => mockParseUnits(value).toString(),
      toHex: (value: bigint) => `0x${value.toString(16)}`,
    },
  }),
}));
jest.mock("@/utils/nativeWalletMutation", () => ({
  walletMutations: { captureGeneration: () => 0, isCurrent: () => true },
}));

function deferred<T>() {
  let resolve: (value: T) => void = () => {
    throw new Error("Deferred promise unavailable");
  };
  let reject: (error: unknown) => void = () => {
    throw new Error("Deferred promise unavailable");
  };
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function fixture(signer: SendSigner, token: boolean) {
  mockDesktop = signer === "desktop";
  const store = new QrlStore();
  store.qrlConnection.blockchain = "TEST_NET";
  store.activeAccount = {
    accountAddress: FROM,
    lastSeen: 0,
    source: signer === "desktop" ? "seed" : signer,
  };
  Object.assign(store, { qrlInstance: mockRpc });
  const tokens = new TokenStore(store);
  const requested = deferred<undefined>();
  const approval = deferred<unknown>();
  const request = jest.fn(
    async ({ method }: { method: string }): Promise<unknown> => {
      if (method === "qrl_accounts") return [FROM];
      requested.resolve(undefined);
      return approval.promise;
    },
  );
  if (signer === "extension") store.extensionProvider = { request };
  if (signer === "mobile") store.mobileProvider = { request };
  mockDesktopSend.mockImplementation(() => {
    requested.resolve(undefined);
    return approval.promise;
  });
  const send = () =>
    token
      ? tokens.sendToken(
          TOKEN,
          "1234567",
          "fixture-seed",
          TO,
          "medium",
          FEE_NOT_SHOWN,
        )
      : signer === "extension" || signer === "mobile"
        ? store.sendTransactionViaProvider(TO, "1.234567")
        : store.signAndSendTransaction(
            FROM,
            TO,
            "1.234567",
            "fixture-seed",
            "medium",
            FEE_NOT_SHOWN,
          );
  const broadcast = async () => {
    const sending = send();
    if (signer === "seed") {
      await sending;
      mockEvents.emit("transactionHash", HASH);
    } else {
      await requested.promise;
      approval.resolve(signer === "desktop" ? { transactionHash: HASH } : HASH);
      await sending;
    }
  };
  return { store, tokens, send, broadcast, request, requested, approval };
}

beforeEach(() => {
  configure({ enforceActions: "never" });
  jest.useFakeTimers();
  jest.clearAllMocks();
  localStorage.clear();
  transactionHistoryStore.reload();
  mockEvents = new Events();
  mockRpc.getTransactionReceipt.mockReset().mockResolvedValue(null);
  mockRpc.estimateGas.mockReset().mockResolvedValue(21000n);
  jest
    .spyOn(QrlStore.prototype, "initializeBlockchain")
    .mockResolvedValue(undefined);
  jest
    .spyOn(QrlStore.prototype, "assertLocalSeedAccount")
    .mockResolvedValue(undefined);
  jest
    .spyOn(QrlStore.prototype, "fetchPendingTxDetails")
    .mockResolvedValue(undefined);
  jest.spyOn(QrlStore.prototype, "fetchAccounts").mockResolvedValue(undefined);
  jest
    .spyOn(TokenStore.prototype, "refreshTokenBalances")
    .mockResolvedValue(undefined);
});
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe.each([false, true])("send lifecycle (token=%s)", (token) => {
  describe.each<SendSigner>(["seed", "extension", "mobile", "desktop"])(
    "%s signer",
    (signer) => {
      it("shows preparation, approval when remote, broadcast and successful inclusion", async () => {
        const { store, send, requested, approval, request } = fixture(
          signer,
          token,
        );
        const states: string[] = [];
        const stop = reaction(
          () => store.transactionStatus.state,
          (state) => states.push(state),
        );
        const sending = send();
        expect(store.transactionStatus.state).toBe(
          signer === "mobile" && !token ? "awaiting-approval" : "preparing",
        );
        if (signer === "seed") {
          await sending;
          expect(store.transactionStatus.state).toBe("preparing");
        } else {
          await requested.promise;
          expect(store.transactionStatus).toMatchObject({
            state: "awaiting-approval",
            txHash: null,
            details: {
              to: TO,
              amount: "1.234567",
              asset: token ? "TOK" : "Quanta",
              signer,
            },
          });
        }
        expect(transactionHistoryStore.getSnapshot().entries).toHaveLength(0);
        if (signer === "seed") mockEvents.emit("transactionHash", HASH);
        else {
          approval.resolve(
            signer === "desktop" ? { transactionHash: HASH } : HASH,
          );
          await sending;
        }
        expect(store.transactionStatus).toMatchObject({
          state: "pending",
          txHash: HASH,
          receipt: null,
        });
        expect(transactionHistoryStore.getSnapshot().entries[0]).toMatchObject({
          state: "pending",
          to: TO,
          amount: "1.234567",
          hash: HASH,
          asset: token ? "TOK" : "Quanta",
        });
        transactionHistoryStore.reload();
        expect(transactionHistoryStore.getSnapshot().entries[0]?.state).toBe(
          "pending",
        );
        if (signer === "seed") mockEvents.emit("receipt", RECEIPT);
        else {
          mockRpc.getTransactionReceipt.mockResolvedValue(RECEIPT);
          await jest.advanceTimersByTimeAsync(5000);
        }
        expect(store.transactionStatus).toMatchObject({
          state: "confirmed",
          receipt: { blockNumber: 42n },
        });
        expect(transactionHistoryStore.getSnapshot().entries[0]?.state).toBe(
          "confirmed",
        );
        expect(states).toEqual(
          signer === "seed"
            ? ["preparing", "pending", "confirmed"]
            : signer === "mobile" && !token
              ? ["awaiting-approval", "pending", "confirmed"]
              : ["preparing", "awaiting-approval", "pending", "confirmed"],
        );
        if (token && (signer === "mobile" || signer === "extension")) {
          expect(request).toHaveBeenLastCalledWith({
            method: "qrl_sendTransaction",
            params: [
              expect.objectContaining({
                from: FROM,
                to: CONTRACT,
                data: expect.stringContaining("0xa9059cbb"),
              }),
            ],
          });
        }
        stop();
      });

      it.each([0n, 0, false, "0x0"])(
        "marks reverted status %s as failed",
        async (status) => {
          const { store, broadcast } = fixture(signer, token);
          await broadcast();
          const receipt = { ...RECEIPT, status };
          if (signer === "seed") mockEvents.emit("receipt", receipt);
          else {
            mockRpc.getTransactionReceipt.mockResolvedValue(receipt);
            await jest.advanceTimersByTimeAsync(5000);
          }
          expect(store.transactionStatus.state).toBe("failed");
          expect(store.transactionStatus.error).toMatch(/reverted/);
          expect(transactionHistoryStore.getSnapshot().entries[0]?.state).toBe(
            "failed",
          );
        },
      );

      it("shows node rejection without adding a pending broadcast", async () => {
        const { store, send, requested, approval } = fixture(signer, token);
        const sending = send();
        if (signer === "seed") {
          await sending;
          mockEvents.emit("error", {
            code: -32000,
            message: "insufficient funds",
          });
        } else {
          await requested.promise;
          approval.reject({ code: -32000, message: "insufficient funds" });
          await sending;
        }
        expect(store.transactionStatus).toMatchObject({
          state: "failed",
          error: "insufficient funds",
          txHash: null,
        });
        expect(transactionHistoryStore.getSnapshot().entries).toHaveLength(0);
      });

      it("rejects malformed broadcast hashes", async () => {
        const { store, send, requested, approval } = fixture(signer, token);
        const sending = send();
        if (signer === "seed") {
          await sending;
          mockEvents.emit("transactionHash", "0xinvalid");
        } else {
          await requested.promise;
          approval.resolve(
            signer === "desktop"
              ? { transactionHash: "0xinvalid" }
              : { hash: HASH },
          );
          await sending;
        }
        expect(store.transactionStatus.state).toBe("failed");
        expect(store.transactionStatus.txHash).toBeNull();
        expect(transactionHistoryStore.getSnapshot().entries).toHaveLength(0);
      });
    },
  );

  describe.each<SendSigner>(["extension", "mobile", "desktop"])(
    "%s approval outcomes",
    (signer) => {
      it.each([
        [{ code: 4001, message: "User rejected request" }, /declined/],
        [new Error("user rejected signature"), /declined/],
        [new Error("Approval request cancelled"), /cancelled/],
        [
          new Error("Request timeout: qrl_sendTransaction (300000ms)"),
          /timed out/,
        ],
      ])(
        "separates %p from technical failure and allows retry",
        async (error, message) => {
          const { store, send, requested, approval } = fixture(signer, token);
          const sending = send();
          await requested.promise;
          approval.reject(error);
          await sending;
          expect(store.transactionStatus.state).toBe("rejected");
          expect(store.transactionStatus.error).toMatch(message);
          expect(transactionHistoryStore.getSnapshot().entries).toHaveLength(0);
          store.resetTransactionStatus();
          expect(store.transactionStatus.state).toBe("idle");
        },
      );

      it("keeps receipt timeout neutral and preserves History Pending", async () => {
        const { store, broadcast } = fixture(signer, token);
        await broadcast();
        mockRpc.getTransactionReceipt.mockRejectedValue(
          new Error("RPC unavailable"),
        );
        await jest.advanceTimersByTimeAsync(300000);
        expect(store.transactionStatus).toMatchObject({
          state: "timeout",
          txHash: HASH,
        });
        expect(transactionHistoryStore.getSnapshot().entries[0]?.state).toBe(
          "pending",
        );
      });
    },
  );
});

it("captures a reverted receipt carried by a PromiEvent error and its reason", async () => {
  const { store, broadcast } = fixture("seed", true);
  await broadcast();
  mockEvents.emit("error", {
    message: "execution reverted",
    reason: "Token transfers are paused",
    receipt: { ...RECEIPT, status: 0n },
  });
  expect(store.transactionStatus).toMatchObject({
    state: "failed",
    error: "Token transfers are paused",
    receipt: { blockNumber: 42n },
  });
  expect(transactionHistoryStore.getSnapshot().entries[0]?.state).toBe(
    "failed",
  );
});

it("handles promise rejection after broadcast as uncertain confirmation", async () => {
  const { store, broadcast } = fixture("seed", false);
  await broadcast();
  mockEvents.emit("rejected", new Error("Transaction polling timeout"));
  expect(store.transactionStatus).toMatchObject({
    state: "timeout",
    txHash: HASH,
  });
  expect(transactionHistoryStore.getSnapshot().entries[0]?.state).toBe(
    "pending",
  );
});

it.each([undefined, "unknown", 2n])(
  "waits for a receipt with explicit execution status: %s",
  async (status) => {
    const { store, broadcast } = fixture("mobile", true);
    await broadcast();
    mockRpc.getTransactionReceipt.mockResolvedValue({ ...RECEIPT, status });
    await jest.advanceTimersByTimeAsync(5000);
    expect(store.transactionStatus.state).toBe("pending");
  },
);

it("keeps late signer results in History without replacing a newer send screen", async () => {
  const { store, send, requested, approval } = fixture("mobile", false);
  const sending = send();
  await requested.promise;
  store.beginSend({
    from: FROM,
    to: TO,
    amount: "2",
    asset: "Quanta",
    signer: "mobile",
  });
  approval.resolve(HASH);
  await sending;
  expect(store.transactionStatus).toMatchObject({
    state: "preparing",
    txHash: null,
    details: { amount: "2" },
  });
  expect(transactionHistoryStore.getSnapshot().entries[0]?.hash).toBe(HASH);
});

it("shows a revert reason supplied in a polled receipt", async () => {
  const { store, broadcast } = fixture("mobile", true);
  await broadcast();
  mockRpc.getTransactionReceipt.mockResolvedValue({
    ...RECEIPT,
    status: 0n,
    revertReason: "Token transfers are paused",
  });
  await jest.advanceTimersByTimeAsync(5000);
  expect(store.transactionStatus).toMatchObject({
    state: "failed",
    error: "Transaction reverted: Token transfers are paused",
  });
});
