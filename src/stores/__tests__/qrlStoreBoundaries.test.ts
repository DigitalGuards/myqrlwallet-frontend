/** @jest-environment jsdom */
import { configure } from "mobx";
import Web3 from "@theqrl/web3";
import QrlStore from "../qrlStore";
import { desktopSigner } from "@/desktop/bridge";
import { StorageUtil } from "@/utils/storage";
import type { AccountListItem } from "@/utils/storage";
import { log } from "@/utils";
import { logger } from "@/utils/log";
import { createQrlRpc } from "@/test-utils/web3";
import { malformed } from "@/test-utils/malformed";
import { SEND_TX_POLLING_CONFIG } from "@/utils/web3/txPolling";

let mockDesktop = false;
jest.mock("@/config", () => ({
  QRL_PROVIDER: {
    TEST_NET: { name: "Testnet", url: "https://rpc.invalid" },
  },
  EXPLORER_BASE: "https://explorer.invalid",
}));
jest.mock("@/utils", () => ({ log: jest.fn() }));
jest.mock("@/utils/crypto", () => ({ deriveHexSeedAsync: jest.fn() }));
jest.mock("@/utils/web3", () => ({ getQrlWeb3: jest.fn() }));
jest.mock("@/desktop/bridge", () => ({
  get isDesktop() {
    return mockDesktop;
  },
  desktopSigner: {
    listWallets: jest.fn(),
    getStatus: jest.fn(),
    setActiveWallet: jest.fn(() => Promise.resolve()),
    onLockStateChanged: jest.fn(),
  },
}));
jest.mock("@/utils/storage", () => ({
  StorageUtil: {
    getBlockChain: jest.fn(() => Promise.resolve("TEST_NET")),
    getAccountList: jest.fn(),
    getActiveAccount: jest.fn(),
    setAccountList: jest.fn(() => Promise.resolve()),
    setActiveAccount: jest.fn(() => Promise.resolve()),
    clearActiveAccount: jest.fn(() => Promise.resolve()),
  },
}));

const ACCOUNT = `Q${"1".repeat(128)}`;
const OTHER = `Q${"2".repeat(128)}`;
const HASH = `0x${"a".repeat(64)}`;

let initialize: jest.SpiedFunction<QrlStore["initializeBlockchain"]>;
let logError: jest.SpiedFunction<typeof logger.error>;
let listWallets: jest.SpiedFunction<typeof desktopSigner.listWallets>;
let getStatus: jest.SpiedFunction<typeof desktopSigner.getStatus>;
let getAccountList: jest.SpiedFunction<typeof StorageUtil.getAccountList>;
let getActiveAccount: jest.SpiedFunction<typeof StorageUtil.getActiveAccount>;
let setAccountList: jest.SpiedFunction<typeof StorageUtil.setAccountList>;
let setActiveAccount: jest.SpiedFunction<typeof StorageUtil.setActiveAccount>;
let clearActiveAccount: jest.SpiedFunction<
  typeof StorageUtil.clearActiveAccount
>;

function makeStore() {
  const store = new QrlStore();
  store.qrlConnection.blockchain = "TEST_NET";
  return store;
}

beforeEach(() => {
  configure({ enforceActions: "never" });
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockDesktop = false;
  initialize = jest
    .spyOn(QrlStore.prototype, "initializeBlockchain")
    .mockResolvedValue(undefined);
  jest.spyOn(QrlStore.prototype, "fetchAccounts").mockResolvedValue(undefined);
  logError = jest.spyOn(logger, "error").mockImplementation(() => undefined);
  listWallets = jest.spyOn(desktopSigner, "listWallets").mockResolvedValue({
    wallets: [{ address: ACCOUNT, keychainBacked: false }],
    active: ACCOUNT,
  });
  getStatus = jest.spyOn(desktopSigner, "getStatus");
  getAccountList = jest
    .spyOn(StorageUtil, "getAccountList")
    .mockResolvedValue([]);
  getActiveAccount = jest
    .spyOn(StorageUtil, "getActiveAccount")
    .mockResolvedValue("");
  setAccountList = jest.spyOn(StorageUtil, "setAccountList");
  setActiveAccount = jest.spyOn(StorageUtil, "setActiveAccount");
  clearActiveAccount = jest.spyOn(StorageUtil, "clearActiveAccount");
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it("schedules initialization for the next timer turn", async () => {
  makeStore();
  expect(initialize).not.toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(0);
  expect(initialize).toHaveBeenCalledTimes(1);
});

it("continues initialization while the price request is pending", async () => {
  initialize.mockRestore();
  const order: string[] = [];
  jest
    .spyOn(QrlStore.prototype, "fetchQrlConnection")
    .mockResolvedValue(undefined);
  jest.spyOn(QrlStore.prototype, "fetchAccounts").mockImplementation(() => {
    order.push("accounts");
    return Promise.resolve();
  });
  jest.spyOn(QrlStore.prototype, "fetchQrlPrice").mockImplementation(() => {
    order.push("price");
    return new Promise(() => undefined);
  });
  jest
    .spyOn(QrlStore.prototype, "validateActiveAccount")
    .mockImplementation(() => {
      order.push("active");
      return Promise.resolve();
    });
  const store = makeStore();
  store.qrlInstance = createQrlRpc();
  store._Web3 = Web3;
  store._utils = Web3.utils;
  store.onBlockchainReady = () => {
    order.push("ready");
    return Promise.resolve();
  };
  await store.initializeBlockchain();
  expect(order).toEqual(["accounts", "price", "active", "ready"]);
});

it("installs the receipt timer synchronously and resolves its setup promise", async () => {
  const store = makeStore();
  store.qrlInstance = createQrlRpc();
  const cancel = jest.spyOn(store, "cancelReceiptPoller");
  const polling = store.pollForReceipt(HASH);
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(store._receiptPollerIntervalId).not.toBeNull();
  expect(polling).toBeInstanceOf(Promise);
  await expect(polling).resolves.toBeUndefined();
});

it("rejects a receipt setup failure through its promise", async () => {
  const store = makeStore();
  store.qrlInstance = createQrlRpc();
  const failure = new Error("Timer cleanup failed");
  const cancel = jest
    .spyOn(store, "cancelReceiptPoller")
    .mockImplementation(() => {
      throw failure;
    });
  const polling = store.pollForReceipt(HASH);
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(store._receiptPollerIntervalId).toBeNull();
  await expect(polling).rejects.toBe(failure);
});

it("returns a resolved setup promise when a receipt cannot be polled", async () => {
  const store = makeStore();
  await expect(store.pollForReceipt(HASH)).resolves.toBeUndefined();
  expect(store._receiptPollerIntervalId).toBeNull();
});

it("keeps one receipt request in flight and cancels it on reset", async () => {
  const store = makeStore();
  const rpc = createQrlRpc();
  store.qrlInstance = rpc;
  store.transactionStatus = {
    state: "pending",
    txHash: HASH,
    receipt: null,
    error: null,
  };
  const receipt = jest
    .spyOn(rpc, "getTransactionReceipt")
    .mockImplementation(() => new Promise(() => undefined));
  const polling = store.pollForReceipt(HASH);
  await jest.advanceTimersByTimeAsync(
    SEND_TX_POLLING_CONFIG.transactionPollingInterval * 3,
  );
  expect(receipt).toHaveBeenCalledTimes(1);
  store.resetTransactionStatus();
  await jest.advanceTimersByTimeAsync(
    SEND_TX_POLLING_CONFIG.transactionPollingInterval,
  );
  expect(receipt).toHaveBeenCalledTimes(1);
  expect(store._receiptPollerIntervalId).toBeNull();
  await polling;
});

it.each([null, undefined])(
  "keeps the UI switch with a desktop wallet list of %p",
  async (list) => {
    mockDesktop = true;
    const store = makeStore();
    const stored: Array<AccountListItem & { label: string }> = [
      { address: OTHER, source: "extension", label: "Keep this row" },
    ];
    getAccountList.mockResolvedValue(stored);
    listWallets.mockResolvedValue(
      malformed<Awaited<ReturnType<typeof desktopSigner.listWallets>>>(list),
    );
    const switchWallet = jest.spyOn(desktopSigner, "setActiveWallet");
    await store.setActiveAccount(ACCOUNT);
    expect(switchWallet).not.toHaveBeenCalled();
    expect(store.activeAccount.accountAddress).toBe(ACCOUNT);
    expect(setAccountList).toHaveBeenCalledWith("TEST_NET", [
      ...stored,
      { address: ACCOUNT, source: "seed" },
    ]);
    expect(stored).toEqual([
      { address: OTHER, source: "extension", label: "Keep this row" },
    ]);
  },
);

it.each([null, undefined])(
  "retains authoritative reconciliation for a wallets field of %p",
  async (wallets) => {
    mockDesktop = true;
    const store = makeStore();
    const foreign = {
      address: OTHER,
      source: "extension",
      label: "Keep this row",
    };
    const malformedRow = { address: 12, source: "seed", revision: 7 };
    const stored = [
      foreign,
      malformedRow,
      { address: ACCOUNT, source: "seed" },
    ];
    getAccountList.mockResolvedValue(malformed<AccountListItem[]>(stored));
    listWallets.mockResolvedValue(
      malformed<Awaited<ReturnType<typeof desktopSigner.listWallets>>>({
        wallets,
        active: null,
      }),
    );
    await store.hydrateDesktopWalletsFromSigner();
    expect(getStatus).not.toHaveBeenCalled();
    expect(setAccountList).toHaveBeenCalledWith("TEST_NET", [
      foreign,
      malformedRow,
    ]);
    expect(stored).toHaveLength(3);
  },
);

it.each([null, undefined])(
  "leaves storage untouched when the fallback status address is %p",
  async (address) => {
    mockDesktop = true;
    const store = makeStore();
    listWallets.mockRejectedValue(new Error("Method unavailable"));
    getStatus.mockResolvedValue(
      malformed<Awaited<ReturnType<typeof desktopSigner.getStatus>>>({
        address,
      }),
    );
    await store.hydrateDesktopWalletsFromSigner();
    expect(getAccountList).not.toHaveBeenCalled();
    expect(setAccountList).not.toHaveBeenCalled();
    expect(setActiveAccount).not.toHaveBeenCalled();
    expect(clearActiveAccount).not.toHaveBeenCalled();
  },
);

it.each<[null | undefined, null | undefined]>([
  [null, undefined],
  [undefined, null],
])(
  "adopts the signer when the stored pointer stays empty (%p to %p)",
  async (stored, fresh) => {
    mockDesktop = true;
    const store = makeStore();
    getAccountList.mockResolvedValue([{ address: ACCOUNT, source: "seed" }]);
    getActiveAccount
      .mockResolvedValueOnce(malformed<string>(stored))
      .mockResolvedValueOnce(malformed<string>(fresh));
    await store.hydrateDesktopWalletsFromSigner();
    expect(setActiveAccount).toHaveBeenCalledWith("TEST_NET", ACCOUNT);
    expect(setAccountList).not.toHaveBeenCalled();
  },
);

it("preserves a concurrent active account change during desktop hydration", async () => {
  mockDesktop = true;
  const store = makeStore();
  getAccountList.mockResolvedValue([{ address: ACCOUNT, source: "seed" }]);
  getActiveAccount.mockResolvedValueOnce("").mockResolvedValueOnce(OTHER);
  await store.hydrateDesktopWalletsFromSigner();
  expect(setActiveAccount).not.toHaveBeenCalled();
  expect(clearActiveAccount).not.toHaveBeenCalled();
});

it("finds the active remote account among incomplete stored rows", async () => {
  const store = makeStore();
  const stored = [
    null,
    undefined,
    { address: 7 },
    { address: ACCOUNT, source: "mobile", revision: 9 },
  ];
  getAccountList.mockResolvedValue(malformed<AccountListItem[]>(stored));
  getActiveAccount.mockResolvedValue(ACCOUNT);
  await store.validateActiveAccount();
  expect(store.activeAccount.accountAddress).toBe(ACCOUNT);
  expect(store.activeAccountSource).toBe("mobile");
  await expect(store.assertLocalSeedAccount(ACCOUNT)).rejects.toThrow(
    "paired mobile app",
  );
  expect(setAccountList).not.toHaveBeenCalled();
  expect(clearActiveAccount).not.toHaveBeenCalled();
  expect(stored).toEqual([
    null,
    undefined,
    { address: 7 },
    { address: ACCOUNT, source: "mobile", revision: 9 },
  ]);
});

it.each<[unknown, string]>([
  [null, "null"],
  [undefined, "undefined"],
  [12, "12"],
  [12n, "12"],
  ["storage unavailable", "storage unavailable"],
  [new Error("storage unavailable"), "Error: storage unavailable"],
])("retains the logged error and text for %p", async (error, text) => {
  const store = makeStore();
  getActiveAccount.mockRejectedValue(error);
  await store.validateActiveAccount();
  expect(logError).toHaveBeenCalledWith(
    "Failed to validate active account:",
    error,
  );
  expect(log).toHaveBeenLastCalledWith(
    `Error validating active account: ${text}`,
  );
});
