/** @jest-environment jsdom */
jest.mock("@/config/runtimeProfile", () => {
  Object.defineProperty(globalThis, "__QRL_WALLET_PROFILE__", {
    value: "v3-private",
    configurable: true,
  });
  return jest.requireActual<typeof import("@/config/runtimeProfile")>(
    "@/config/runtimeProfile",
  );
});
// One network (every testnet build) or two (a pinned web build).
let mockAvailableIds = ["TEST_NET_V3"];
jest.mock("@/config", () => {
  const providers = {
    TEST_NET_V3: {
      id: "TEST_NET_V3",
      name: "QRL Testnet v3 (Private)",
      url: "https://v3.invalid",
      explorer: "https://testnet-explorer.invalid",
      expectedChainId: "0x301825",
      genesisHash: `0x${"ab".repeat(32)}`,
      qrns: { expectedChainId: "", registry: "" },
      tokenFactory: "",
    },
    MAIN_NET_V3: {
      id: "MAIN_NET_V3",
      name: "QRL 2.0 Mainnet",
      url: "https://mainnet.invalid",
      explorer: "https://mainnet-explorer.invalid",
      expectedChainId: "0x1",
      genesisHash: `0x${"cd".repeat(32)}`,
      qrns: { expectedChainId: "", registry: "" },
      tokenFactory: "",
    },
    TEST_NET: { id: "TEST_NET", url: "https://legacy.invalid" },
    MAIN_NET: { id: "MAIN_NET", url: "https://legacy-main.invalid" },
  };
  return {
    QRL_PROVIDER: providers,
    get AVAILABLE_NETWORKS() {
      return mockAvailableIds.map((id) =>
        id === "MAIN_NET_V3" ? providers.MAIN_NET_V3 : providers.TEST_NET_V3,
      );
    },
    DEFAULT_NETWORK_ID: "TEST_NET_V3",
    EXPLORER_BASE: "https://testnet-explorer.invalid",
  };
});
jest.mock("@/utils", () => ({ log: jest.fn() }));
jest.mock("@/utils/crypto", () => ({
  deriveHexSeedAsync: jest.fn(() => Promise.resolve("public-test-seed")),
}));
jest.mock("@/utils/storage", () => ({
  StorageUtil: jest.requireActual<typeof import("@/utils/storage/storage")>(
    "@/utils/storage/storage",
  ).default,
}));
jest.mock("@/utils/nativeApp", () => ({ isInNativeApp: () => false }));
jest.mock("@/utils/web3", () => ({ getQrlWeb3: jest.fn() }));

import Web3 from "@theqrl/web3";
import type { QRLExecutionAPI } from "@theqrl/web3";
import type { Web3SubscriptionConstructor } from "@theqrl/web3-core";
import type { RegisteredSubscription } from "@theqrl/web3-qrl";
import { createQrlRpc, pendingSend, signedTransaction } from "@/test-utils/web3";
import QrlStore from "../qrlStore";
import StorageUtil from "@/utils/storage/storage";
import { FEE_NOT_SHOWN } from "@/utils/web3/feePolicy";
import { QRL_PROVIDER } from "@/config";

const mockMainnet = QRL_PROVIDER.MAIN_NET_V3;
const TESTNET_GENESIS = `0x${"ab".repeat(32)}`;
const MAINNET_GENESIS = `0x${"cd".repeat(32)}`;

const ACCOUNT = `Q${"1".repeat(128)}`;
const SELECTION_KEY = "qrlwallet:v3:BLOCKCHAIN_SELECTION";

function stored(value: unknown, timestamp = Date.now()) {
  return JSON.stringify({ value, timestamp, version: "v1" });
}

function storeOn(
  blockchain: string,
  identity: { chainId: string; genesisHash: string },
) {
  const rpc = createQrlRpc();
  const send = jest
    .spyOn(rpc.requestManager, "send")
    .mockImplementation(({ method }) =>
      Promise.resolve(
        method === "qrl_chainId"
          ? identity.chainId
          : { number: "0x0", hash: identity.genesisHash },
      ),
    );
  jest.spyOn(rpc.net, "isListening").mockResolvedValue(true);
  jest.spyOn(rpc, "getTransactionCount").mockResolvedValue(0n);
  jest.spyOn(rpc, "getGasPrice").mockResolvedValue(1n);
  jest
    .spyOn(rpc, "getMaxPriorityFeePerGas")
    .mockRejectedValue(new Error("Use gas price"));
  jest.spyOn(rpc, "getBlock").mockRejectedValue(new Error("Use gas price"));
  jest.spyOn(rpc, "estimateGas").mockResolvedValue(21000n);
  const signTransaction = jest
    .spyOn(rpc.accounts, "signTransaction")
    .mockResolvedValue(signedTransaction("0x1234"));
  jest
    .spyOn(rpc, "sendSignedTransaction")
    .mockImplementation(() => pendingSend());
  localStorage.setItem(SELECTION_KEY, stored(blockchain));
  const store = new QrlStore();
  store._Web3 = class<
    Subscriptions extends Record<
      string,
      Web3SubscriptionConstructor<QRLExecutionAPI>
    > = RegisteredSubscription,
  > extends Web3<Subscriptions> {
    override qrl = rpc;
  };
  store._utils = Web3.utils;
  store.activeAccount.accountAddress = ACCOUNT;
  store.qrlAccounts.accounts = [
    { accountAddress: ACCOUNT, accountBalance: "2", source: "seed" },
  ];
  return { store, send, signTransaction };
}

beforeEach(() => {
  jest.useFakeTimers();
  localStorage.clear();
  jest.clearAllMocks();
  mockAvailableIds = ["TEST_NET_V3"];
  jest.spyOn(QrlStore.prototype, "fetchAccounts").mockResolvedValue(undefined);
  jest.spyOn(QrlStore.prototype, "fetchQrlPrice").mockResolvedValue(undefined);
  jest
    .spyOn(QrlStore.prototype, "validateActiveAccount")
    .mockResolvedValue(undefined);
  jest
    .spyOn(StorageUtil, "getAccountList")
    .mockResolvedValue([{ address: ACCOUNT, source: "seed" }]);
});
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("testnet storage", () => {
  it("never reads or rewrites the stored selection in a one-network build", async () => {
    // Today's v3 build ignores this key. An expired or foreign value stays
    // exactly where it is, byte for byte.
    for (const raw of [
      stored("MAIN_NET_V3"),
      stored("TEST_NET_V3", 0),
      "not json",
    ]) {
      localStorage.setItem(SELECTION_KEY, raw);
      expect(await StorageUtil.getBlockChain()).toBe("TEST_NET_V3");
      expect(localStorage.getItem(SELECTION_KEY)).toBe(raw);
    }
    await expect(StorageUtil.setBlockChain("MAIN_NET_V3")).rejects.toThrow(
      "not available in this build",
    );
  });

  it("keeps the testnet keys byte-identical and gives mainnet its own", async () => {
    mockAvailableIds = ["TEST_NET_V3", "MAIN_NET_V3"];
    await StorageUtil.setBlockChain("TEST_NET_V3");
    await StorageUtil.setActiveAccount("TEST_NET_V3", ACCOUNT);
    await StorageUtil.setAccountList("TEST_NET_V3", [
      { address: ACCOUNT, source: "seed" },
    ]);
    await StorageUtil.updateTokenList("TEST_NET_V3", ACCOUNT, []);
    await StorageUtil.updateNftList("TEST_NET_V3", ACCOUNT, []);
    const testnetKeys = Object.keys(localStorage).sort();
    expect(testnetKeys).toEqual(
      [
        SELECTION_KEY,
        "TEST_NET_V3_QIP55_ACTIVE_ACCOUNT",
        "TEST_NET_V3_QIP55_ACCOUNT_LIST",
        `TEST_NET_V3_${ACCOUNT.toLowerCase()}_TOKEN_LIST_V3`,
        `TEST_NET_V3_${ACCOUNT.toLowerCase()}_NFT_LIST_V3`,
      ].sort(),
    );
    await StorageUtil.setActiveAccount("MAIN_NET_V3", ACCOUNT);
    await StorageUtil.setAccountList("MAIN_NET_V3", [
      { address: ACCOUNT, source: "seed" },
    ]);
    await StorageUtil.updateTokenList("MAIN_NET_V3", ACCOUNT, []);
    const mainnetKeys = Object.keys(localStorage).filter(
      (key) => !testnetKeys.includes(key),
    );
    expect(mainnetKeys.sort()).toEqual(
      [
        "MAIN_NET_V3_QIP55_ACTIVE_ACCOUNT",
        "MAIN_NET_V3_QIP55_ACCOUNT_LIST",
        `MAIN_NET_V3_${ACCOUNT.toLowerCase()}_TOKEN_LIST_V3`,
      ].sort(),
    );
  });

  it("persists the active network when two are available and falls back to the default", async () => {
    mockAvailableIds = ["TEST_NET_V3", "MAIN_NET_V3"];
    expect(await StorageUtil.getBlockChain()).toBe("TEST_NET_V3");
    await StorageUtil.setBlockChain("MAIN_NET_V3");
    expect(await StorageUtil.getBlockChain()).toBe("MAIN_NET_V3");
    for (const value of ["MAIN_NET", "TEST_NET", ["MAIN_NET_V3"], null]) {
      localStorage.setItem(SELECTION_KEY, stored(value));
      expect(await StorageUtil.getBlockChain()).toBe("TEST_NET_V3");
    }
    await expect(StorageUtil.setBlockChain("MAIN_NET")).rejects.toThrow(
      "not available in this build",
    );
  });
});

describe("store on the pinned mainnet", () => {
  it("verifies the mainnet pins, shows fiat and signs for the mainnet chain", async () => {
    mockAvailableIds = ["TEST_NET_V3", "MAIN_NET_V3"];
    const { store, send, signTransaction } = storeOn("MAIN_NET_V3", {
      chainId: "0x1",
      genesisHash: MAINNET_GENESIS,
    });
    await store.initializeBlockchain();
    expect(store.qrlConnection).toMatchObject({
      blockchain: "MAIN_NET_V3",
      qrlNetworkName: "QRL 2.0 Mainnet",
      isConnected: true,
    });
    expect(store.activeNetwork).toBe(mockMainnet);
    expect(store.showsFiatValue).toBe(true);
    expect(send).toHaveBeenCalledWith({
      method: "qrl_getBlockByNumber",
      params: ["0x0", false],
    });
    await store.signAndSendTransaction(
      ACCOUNT,
      ACCOUNT,
      "1",
      "public fixture",
      "medium",
      FEE_NOT_SHOWN,
    );
    expect(signTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ chainId: "0x1" }),
      "public-test-seed",
    );
  });

  it("stays disconnected, without fiat, when the mainnet RPC answers with the testnet identity", async () => {
    mockAvailableIds = ["TEST_NET_V3", "MAIN_NET_V3"];
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    const { store, signTransaction } = storeOn("MAIN_NET_V3", {
      chainId: "0x301825",
      genesisHash: TESTNET_GENESIS,
    });
    await store.initializeBlockchain();
    expect(store.qrlConnection.isConnected).toBe(false);
    expect(store.qrlInstance).toBeUndefined();
    expect(store.showsFiatValue).toBe(false);
    expect(store.activeAccountBalanceUsd).toBe(0);
    await store.signAndSendTransaction(
      ACCOUNT,
      ACCOUNT,
      "1",
      "public fixture",
      "medium",
      FEE_NOT_SHOWN,
    );
    expect(signTransaction).not.toHaveBeenCalled();
  });

  it("keeps the testnet on its own pins with fiat hidden", async () => {
    const { store, signTransaction } = storeOn("TEST_NET_V3", {
      chainId: "0x301825",
      genesisHash: TESTNET_GENESIS,
    });
    await store.initializeBlockchain();
    expect(store.qrlConnection).toMatchObject({
      blockchain: "TEST_NET_V3",
      isConnected: true,
    });
    expect(store.showsFiatValue).toBe(false);
    await store.signAndSendTransaction(
      ACCOUNT,
      ACCOUNT,
      "1",
      "public fixture",
      "medium",
      FEE_NOT_SHOWN,
    );
    expect(signTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ chainId: "0x301825" }),
      "public-test-seed",
    );
  });

  it("refuses to select a mainnet the build does not list", async () => {
    const { store } = storeOn("TEST_NET_V3", {
      chainId: "0x301825",
      genesisHash: TESTNET_GENESIS,
    });
    await expect(store.selectBlockchain("MAIN_NET_V3")).rejects.toThrow(
      "not available in this build",
    );
    await expect(store.selectBlockchain("MAIN_NET")).rejects.toThrow(
      "not available in this build",
    );
  });
});
