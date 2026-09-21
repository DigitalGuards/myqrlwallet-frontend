/** @jest-environment jsdom */
jest.mock("@/config/runtimeProfile", () => {
  Object.defineProperty(globalThis, "__QRL_WALLET_PROFILE__", {
    value: "v3-private",
    configurable: true,
  });
  return jest.requireActual("@/config/runtimeProfile");
});
jest.mock("@/config", () => ({
  QRL_PROVIDER: {
    TEST_NET: { id: "TEST_NET", url: "https://legacy.invalid" },
    MAIN_NET: { id: "MAIN_NET", url: "https://main.invalid" },
    TEST_NET_V3: {
      id: "TEST_NET_V3",
      name: "QRL Testnet v3 (Private)",
      url: "https://v3.invalid",
      expectedChainId: "0x301825",
      genesisHash: `0x${"ab".repeat(32)}`,
    },
  },
  EXPLORER_BASE: "https://explorer.invalid",
  getPendingTxApiUrl: jest.fn(),
}));
jest.mock("@/utils", () => ({ log: jest.fn() }));
jest.mock("@/utils/crypto", () => ({
  deriveHexSeedAsync: jest.fn(async () => "public-test-seed"),
}));
jest.mock("@/utils/storage", () => ({
  StorageUtil: jest.requireActual("@/utils/storage/storage").default,
}));
jest.mock("@/utils/nativeApp", () => ({ isInNativeApp: () => false }));
jest.mock("@/utils/web3", () => ({ getQrlWeb3: jest.fn() }));

import QrlStore from "../qrlStore";
import StorageUtil from "@/utils/storage/storage";
import { deriveHexSeedAsync } from "@/utils/crypto";
import {
  isUnsupportedV3Context,
  profileStorageKey,
} from "@/config/runtimeProfile";
import {
  connectWithProvider,
  discoverQrlProviders,
} from "@/utils/extension/extensionConnection";
import {
  hasMobileSession,
  maybeRestoreMobileConnection,
  getMobileConnect,
} from "@/utils/mobileConnect/mobileConnection";
import { qrlWallet } from "@/desktop/bridge";
import { walletMutations } from "@/utils/nativeWalletMutation";

const ACCOUNT = `Q${"1".repeat(128)}`;
const HASH = `0x${"ab".repeat(32)}`;
function rpcFixture() {
  return {
    requestManager: {
      send: jest.fn(
        async ({ method }: { method: string }): Promise<unknown> =>
          method === "qrl_chainId" ? "0x301825" : { number: "0x0", hash: HASH },
      ),
    },
    net: { isListening: jest.fn(async () => true) },
    getTransactionCount: jest.fn(async () => 0n),
    getGasPrice: jest.fn(async () => 1n),
    estimateGas: jest.fn(async () => 21000n),
    accounts: {
      signTransaction: jest.fn(async () => ({ rawTransaction: "0x1234" })),
    },
    sendSignedTransaction: jest.fn(() => {
      const event = { on: jest.fn() };
      event.on.mockReturnValue(event);
      return event;
    }),
  };
}
function storeFixture(rpc = rpcFixture()) {
  const store = new QrlStore();
  const utils = {
    toPlanck: (value: string) => BigInt(value) * 10n ** 18n,
    toHex: (value: bigint) => `0x${value.toString(16)}`,
  };
  store._Web3 = class {
    static providers = { HttpProvider: class {} };
    qrl = rpc;
  } as never;
  store._utils = utils as never;
  store.activeAccount.accountAddress = ACCOUNT;
  store.qrlAccounts.accounts = [
    { accountAddress: ACCOUNT, accountBalance: "1", source: "seed" },
  ];
  return { store, rpc };
}

beforeEach(() => {
  jest.useFakeTimers();
  localStorage.clear();
  jest.clearAllMocks();
  jest.spyOn(QrlStore.prototype, "fetchAccounts").mockResolvedValue(undefined);
  jest
    .spyOn(QrlStore.prototype, "validateActiveAccount")
    .mockResolvedValue(undefined);
  jest.spyOn(QrlStore.prototype, "fetchQrlPrice").mockResolvedValue(undefined);
});
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
  delete window.qrlWallet;
  delete window.ReactNativeWebView;
});

it("defaults to v3 independently of old dev selection and rejects v2/mainnet selection", async () => {
  localStorage.setItem(
    "BLOCKCHAIN_SELECTION",
    JSON.stringify({ value: "TEST_NET", timestamp: Date.now(), version: "v1" }),
  );
  const original = localStorage.getItem("BLOCKCHAIN_SELECTION");
  expect(await StorageUtil.getBlockChain()).toBe("TEST_NET_V3");
  await StorageUtil.setBlockChain("TEST_NET_V3");
  await expect(StorageUtil.setBlockChain("MAIN_NET")).rejects.toThrow(
    "Only Testnet v3",
  );
  await expect(StorageUtil.setBlockChain("TEST_NET")).rejects.toThrow(
    "Only Testnet v3",
  );
  expect(localStorage.getItem("BLOCKCHAIN_SELECTION")).toBe(original);
  expect(
    localStorage.getItem(profileStorageKey("BLOCKCHAIN_SELECTION")),
  ).not.toBeNull();
});

it("preserves legacy account/seed records while creating and clearing v3 records", async () => {
  const legacy = {
    TEST_NET_ACCOUNT_LIST: "legacy-accounts",
    TEST_NET_ACTIVE_ACCOUNT: "legacy-active",
    TEST_NET_ENCRYPTED_SEEDS: "legacy-ciphertext",
    "qrlwallet:wallet-epoch-v1": "legacy-epoch",
  };
  for (const [key, value] of Object.entries(legacy))
    localStorage.setItem(key, value);
  await StorageUtil.setActiveAccount("TEST_NET_V3", ACCOUNT);
  await StorageUtil.storeEncryptedSeed("TEST_NET_V3", ACCOUNT, "v3-ciphertext");
  expect(await StorageUtil.getActiveAccount("TEST_NET_V3")).toBe(ACCOUNT);
  expect((await StorageUtil.getAccountList("TEST_NET_V3"))[0]?.address).toBe(
    ACCOUNT,
  );
  StorageUtil.clearAllEncryptedSeeds("TEST_NET_V3");
  StorageUtil.clearAccountList("TEST_NET_V3");
  await StorageUtil.clearActiveAccount("TEST_NET_V3");
  for (const [key, value] of Object.entries(legacy))
    expect(localStorage.getItem(key)).toBe(value);
});

it("excludes stale external accounts without rewriting their records", async () => {
  const key = "TEST_NET_V3_QIP55_ACCOUNT_LIST";
  const value = JSON.stringify({
    value: [{ address: ACCOUNT, source: "mobile" }],
    timestamp: Date.now(),
    version: "v1",
  });
  localStorage.setItem(key, value);
  expect(await StorageUtil.getAccountList("TEST_NET_V3")).toEqual([]);
  expect(localStorage.getItem(key)).toBe(value);
});

it("marks v3 ready only after chain and genesis verification", async () => {
  const { store, rpc } = storeFixture();
  await store.initializeBlockchain();
  expect(store.qrlConnection).toMatchObject({
    blockchain: "TEST_NET_V3",
    isConnected: true,
  });
  expect(
    rpc.requestManager.send.mock.calls.map(([args]) => args.method),
  ).toEqual([
    "qrl_chainId",
    "qrl_getBlockByNumber",
    "qrl_chainId",
    "qrl_getBlockByNumber",
  ]);
  expect(QrlStore.prototype.fetchAccounts).toHaveBeenCalledTimes(1);
});

it.each(["chain", "genesis"])(
  "keeps accounts and readiness blocked on a %s mismatch",
  async (kind) => {
    const { store, rpc } = storeFixture();
    rpc.requestManager.send.mockImplementation(async ({ method }) =>
      method === "qrl_chainId"
        ? kind === "chain"
          ? "0x539"
          : "0x301825"
        : { number: "0x0", hash: "wrong" },
    );
    const errors = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    await store.initializeBlockchain();
    expect(store.qrlConnection.isConnected).toBe(false);
    expect(store.qrlInstance).toBeUndefined();
    expect(QrlStore.prototype.fetchAccounts).not.toHaveBeenCalled();
    expect(errors).toHaveBeenCalled();
  },
);

it("signs a normal web transfer with the pinned chain and rechecks before broadcast", async () => {
  const { store, rpc } = storeFixture();
  await store.initializeBlockchain();
  await store.signAndSendTransaction(ACCOUNT, ACCOUNT, "1", "public fixture");
  expect(deriveHexSeedAsync).toHaveBeenCalled();
  expect(rpc.accounts.signTransaction).toHaveBeenCalledWith(
    expect.objectContaining({ chainId: "0x301825", gas: 21000n }),
    "public-test-seed",
  );
  expect(rpc.sendSignedTransaction).toHaveBeenCalledWith("0x1234");
  expect(rpc.requestManager.send).toHaveBeenCalledTimes(10);
});

it("stops before derivation and signing if the chain changes after initialization", async () => {
  const { store, rpc } = storeFixture();
  await store.initializeBlockchain();
  rpc.requestManager.send.mockResolvedValue("0x539");
  await store.signAndSendTransaction(ACCOUNT, ACCOUNT, "1", "public fixture");
  expect(deriveHexSeedAsync).not.toHaveBeenCalled();
  expect(rpc.accounts.signTransaction).not.toHaveBeenCalled();
  expect(rpc.sendSignedTransaction).not.toHaveBeenCalled();
  expect(store.transactionStatus.state).toBe("failed");
  expect(store.qrlConnection.isConnected).toBe(false);
});

it("retries initialization after an identity failure and never restores readiness from listening alone", async () => {
  const { store, rpc } = storeFixture();
  jest.spyOn(console, "error").mockImplementation(() => undefined);
  rpc.requestManager.send.mockResolvedValue("0x539");
  await store.initializeBlockchain();
  expect(store.qrlInstance).toBeUndefined();
  rpc.requestManager.send.mockImplementation(async ({ method }) =>
    method === "qrl_chainId" ? "0x301825" : { number: "0x0", hash: HASH },
  );
  await store.fetchQrlConnection();
  expect(store.qrlConnection.isConnected).toBe(true);
  rpc.requestManager.send.mockResolvedValue("0x539");
  await store.fetchQrlConnection();
  expect(store.qrlConnection.isConnected).toBe(false);
});

it("does not broadcast if wallet generation changes during the final identity check", async () => {
  const { store, rpc } = storeFixture();
  await store.initializeBlockchain();
  let current = true;
  jest.spyOn(walletMutations, "isCurrent").mockImplementation(() => current);
  rpc.accounts.signTransaction.mockImplementation(async () => {
    rpc.requestManager.send.mockImplementation(async ({ method }) => {
      current = false;
      return method === "qrl_chainId"
        ? "0x301825"
        : { number: "0x0", hash: HASH };
    });
    return { rawTransaction: "0x1234" };
  });
  await store.signAndSendTransaction(ACCOUNT, ACCOUNT, "1", "public fixture");
  expect(rpc.accounts.signTransaction).toHaveBeenCalledTimes(1);
  expect(rpc.sendSignedTransaction).not.toHaveBeenCalled();
  expect(store.transactionStatus.error).toMatch(/Wallet changed/);
});

it("does not retain signing authority across a clear during the initial identity check", async () => {
  const { store, rpc } = storeFixture();
  await store.initializeBlockchain();
  let current = true;
  jest.spyOn(walletMutations, "isCurrent").mockImplementation(() => current);
  rpc.requestManager.send.mockImplementation(async ({ method }) => {
    current = false;
    return method === "qrl_chainId"
      ? "0x301825"
      : { number: "0x0", hash: HASH };
  });
  await store.signAndSendTransaction(ACCOUNT, ACCOUNT, "1", "public fixture");
  expect(deriveHexSeedAsync).not.toHaveBeenCalled();
  expect(rpc.accounts.signTransaction).not.toHaveBeenCalled();
  expect(rpc.sendSignedTransaction).not.toHaveBeenCalled();
  expect(store.transactionStatus.error).toMatch(/Wallet changed/);
});

it("keeps both directions of legacy and v3 asset-cache sweeps isolated", async () => {
  const legacyKey = `TEST_NET_${ACCOUNT.toLowerCase()}_TOKEN_LIST`;
  localStorage.setItem(legacyKey, "legacy-list");
  await StorageUtil.updateTokenList("TEST_NET_V3", ACCOUNT, []);
  const v3Key = `TEST_NET_V3_${ACCOUNT.toLowerCase()}_TOKEN_LIST_V3`;
  expect(localStorage.getItem(v3Key)).not.toBeNull();
  const legacySweepKeys = Array.from(
    { length: localStorage.length },
    (_, index) => localStorage.key(index),
  ).filter((key) => key?.endsWith("_TOKEN_LIST"));
  expect(legacySweepKeys).not.toContain(v3Key);
  StorageUtil.clearAllTokenData();
  expect(localStorage.getItem(v3Key)).toBeNull();
  expect(localStorage.getItem(legacyKey)).toBe("legacy-list");
});

it("blocks external account adoption and direct external broadcasts", async () => {
  const { store } = storeFixture();
  const provider = { request: jest.fn() };
  await expect(store.setActiveAccount(ACCOUNT, "extension")).rejects.toThrow(
    "not yet qualified",
  );
  expect(() => store.setExtensionProvider(provider)).toThrow(
    "not yet qualified",
  );
  expect(() => store.setMobileProvider(provider)).toThrow("not yet qualified");
  store.extensionProvider = provider;
  store.qrlAccounts.accounts = [
    { accountAddress: ACCOUNT, accountBalance: "1", source: "extension" },
  ];
  await store.sendTransactionViaProvider(ACCOUNT, "1");
  expect(provider.request).not.toHaveBeenCalled();
  expect(store.transactionStatus.error).toMatch(/not yet qualified/);
});

it("discovers extensions but refuses unqualified connections and old mobile sessions", async () => {
  const { store } = storeFixture();
  localStorage.setItem("@qrlwallet/connect:session", "legacy-pairing");
  const request = jest.fn();
  const announce = jest.spyOn(window, "dispatchEvent");
  const discovered = discoverQrlProviders();
  jest.advanceTimersByTime(1000);
  expect(await discovered).toEqual([]);
  expect(announce).toHaveBeenCalled();
  jest.spyOn(window, "alert").mockImplementation(() => undefined);
  jest.spyOn(console, "error").mockImplementation(() => undefined);
  expect(
    await connectWithProvider(
      {
        info: { uuid: "x", name: "test", icon: "", rdns: "test" },
        provider: { request },
      },
      jest.fn(),
      jest.fn(),
    ),
  ).toBeNull();
  expect(hasMobileSession()).toBe(false);
  await maybeRestoreMobileConnection(store, true);
  await expect(getMobileConnect(store)).rejects.toThrow("not yet qualified");
  expect(localStorage.getItem("@qrlwallet/connect:session")).toBe(
    "legacy-pairing",
  );
  expect(request).toHaveBeenCalledWith({ method: "qrl_walletCapabilities" });
  expect(request).not.toHaveBeenCalledWith({ method: "qrl_requestAccounts" });
});

it("blocks the desktop bridge and rejects native wrapper readiness", async () => {
  const buildTransaction = jest.fn();
  window.qrlWallet = { buildTransaction } as never;
  expect(isUnsupportedV3Context()).toBe(true);
  expect(() => qrlWallet()).toThrow("not yet qualified");
  const { store } = storeFixture();
  jest.spyOn(console, "error").mockImplementation(() => undefined);
  await store.initializeBlockchain();
  expect(store.qrlConnection.isConnected).toBe(false);
  expect(buildTransaction).not.toHaveBeenCalled();
  delete window.qrlWallet;
  window.ReactNativeWebView = { postMessage: jest.fn() };
  expect(isUnsupportedV3Context()).toBe(true);
});

it("accepts an updated desktop bridge while retaining native mobile rejection", () => {
  window.qrlWallet = { addressScheme: "qip55-64" } as never;
  expect(isUnsupportedV3Context()).toBe(false);
  expect(qrlWallet()).toBe(window.qrlWallet);
  window.ReactNativeWebView = { postMessage: jest.fn() };
  expect(isUnsupportedV3Context()).toBe(true);
});

it("does not send native messages or register native restore listeners", () => {
  const native =
    jest.requireActual<typeof import("@/utils/nativeApp")>("@/utils/nativeApp");
  const postMessage = jest.fn();
  window.ReactNativeWebView = { postMessage };
  const listener = jest.fn();
  const register = jest.spyOn(window, "addEventListener");
  const unsubscribe = native.subscribeToNativeMessages(listener);
  expect(native.sendToNative("WEB_APP_READY")).toBe(false);
  expect(postMessage).not.toHaveBeenCalled();
  expect(register).not.toHaveBeenCalled();
  window.dispatchEvent(
    new CustomEvent("nativeMessage", { detail: { type: "RESTORE_SEED" } }),
  );
  expect(listener).not.toHaveBeenCalled();
  unsubscribe();
});
