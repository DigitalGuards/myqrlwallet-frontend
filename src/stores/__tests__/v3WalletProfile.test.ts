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
}));
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
import {
  createQrlRpc,
  pendingSend,
  signedTransaction,
} from "@/test-utils/web3";
import type { QrlWalletBridge } from "@/desktop/bridge";
import QrlStore from "../qrlStore";
import type { ExtensionProvider } from "../qrlStore";
import {
  isQualifiedV3MobileProvider,
  qualifyV3MobileProvider,
  qualifyV3Provider,
  V3_MOBILE_QUALIFICATION_TTL_MS,
  V3_MOBILE_UNRESPONSIVE_MESSAGE,
  V3_UNQUALIFIED_MOBILE_MESSAGE,
} from "@/utils/extension/v3Provider";
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
import { qrlWallet } from "@/desktop/bridge";
import { walletMutations } from "@/utils/nativeWalletMutation";
import { FEE_NOT_SHOWN } from "@/utils/web3/feePolicy";

const ACCOUNT = `Q${"1".repeat(128)}`;
const HASH = `0x${"ab".repeat(32)}`;
let fetchAccounts: jest.SpiedFunction<QrlStore["fetchAccounts"]>;

function rpcFixture() {
  const provider = createQrlRpc();
  const send = jest
    .spyOn(provider.requestManager, "send")
    .mockImplementation(({ method }) =>
      Promise.resolve(
        method === "qrl_chainId" ? "0x301825" : { number: "0x0", hash: HASH },
      ),
    );
  jest.spyOn(provider.net, "isListening").mockResolvedValue(true);
  jest.spyOn(provider, "getTransactionCount").mockResolvedValue(0n);
  jest.spyOn(provider, "getGasPrice").mockResolvedValue(1n);
  jest
    .spyOn(provider, "getMaxPriorityFeePerGas")
    .mockRejectedValue(new Error("Use gas price"));
  jest
    .spyOn(provider, "getBlock")
    .mockRejectedValue(new Error("Use gas price"));
  const estimateGas = jest
    .spyOn(provider, "estimateGas")
    .mockResolvedValue(21000n);
  const signTransaction = jest
    .spyOn(provider.accounts, "signTransaction")
    .mockResolvedValue(signedTransaction("0x1234"));
  const sendSignedTransaction = jest
    .spyOn(provider, "sendSignedTransaction")
    .mockImplementation(() => pendingSend());
  return {
    provider,
    send,
    estimateGas,
    signTransaction,
    sendSignedTransaction,
  };
}
function storeFixture(rpc = rpcFixture()) {
  const store = new QrlStore();
  store._Web3 = class<
    Subscriptions extends Record<
      string,
      Web3SubscriptionConstructor<QRLExecutionAPI>
    > = RegisteredSubscription,
  > extends Web3<Subscriptions> {
    override qrl = rpc.provider;
  };
  store._utils = Web3.utils;
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
  fetchAccounts = jest
    .spyOn(QrlStore.prototype, "fetchAccounts")
    .mockResolvedValue(undefined);
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

it("keeps a paired mobile account but refuses it until the phone requalifies", async () => {
  const key = "TEST_NET_V3_QIP55_ACCOUNT_LIST";
  const value = JSON.stringify({
    value: [{ address: ACCOUNT, source: "mobile" }],
    timestamp: Date.now(),
    version: "v1",
  });
  localStorage.setItem(key, value);
  expect(await StorageUtil.getAccountList("TEST_NET_V3")).toEqual([
    { address: ACCOUNT, source: "mobile" },
  ]);
  expect(localStorage.getItem(key)).toBe(value);
  const { store } = storeFixture();
  await expect(store.setActiveAccount(ACCOUNT, "mobile")).rejects.toThrow(
    V3_UNQUALIFIED_MOBILE_MESSAGE,
  );
});

it("marks v3 ready only after chain and genesis verification", async () => {
  const { store, rpc } = storeFixture();
  await store.initializeBlockchain();
  expect(store.qrlConnection).toMatchObject({
    blockchain: "TEST_NET_V3",
    isConnected: true,
  });
  expect(rpc.send.mock.calls.map(([args]) => args.method)).toEqual([
    "qrl_chainId",
    "qrl_getBlockByNumber",
    "qrl_chainId",
    "qrl_getBlockByNumber",
  ]);
  expect(fetchAccounts).toHaveBeenCalledTimes(1);
});

it.each(["chain", "genesis"])(
  "keeps accounts and readiness blocked on a %s mismatch",
  async (kind) => {
    const { store, rpc } = storeFixture();
    rpc.send.mockImplementation(({ method }) =>
      Promise.resolve(
        method === "qrl_chainId"
          ? kind === "chain"
            ? "0x539"
            : "0x301825"
          : { number: "0x0", hash: "wrong" },
      ),
    );
    const errors = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    await store.initializeBlockchain();
    expect(store.qrlConnection.isConnected).toBe(false);
    expect(store.qrlInstance).toBeUndefined();
    expect(fetchAccounts).not.toHaveBeenCalled();
    expect(errors).toHaveBeenCalled();
  },
);

it("signs a normal web transfer with the pinned chain and rechecks before broadcast", async () => {
  const { store, rpc } = storeFixture();
  await store.initializeBlockchain();
  await store.signAndSendTransaction(
    ACCOUNT,
    ACCOUNT,
    "1",
    "public fixture",
    "medium",
    FEE_NOT_SHOWN,
  );
  expect(deriveHexSeedAsync).toHaveBeenCalled();
  expect(rpc.signTransaction).toHaveBeenCalledWith(
    expect.objectContaining({ chainId: "0x301825", gas: 21000n }),
    "public-test-seed",
  );
  expect(rpc.sendSignedTransaction).toHaveBeenCalledWith("0x1234");
  expect(rpc.send).toHaveBeenCalledTimes(10);
});

it("stops before derivation and signing if the chain changes after initialization", async () => {
  const { store, rpc } = storeFixture();
  await store.initializeBlockchain();
  rpc.send.mockResolvedValue("0x539");
  await store.signAndSendTransaction(
    ACCOUNT,
    ACCOUNT,
    "1",
    "public fixture",
    "medium",
    FEE_NOT_SHOWN,
  );
  expect(deriveHexSeedAsync).not.toHaveBeenCalled();
  expect(rpc.signTransaction).not.toHaveBeenCalled();
  expect(rpc.sendSignedTransaction).not.toHaveBeenCalled();
  expect(store.transactionStatus.state).toBe("failed");
  expect(store.qrlConnection.isConnected).toBe(false);
});

it("retries initialization after an identity failure and never restores readiness from listening alone", async () => {
  const { store, rpc } = storeFixture();
  jest.spyOn(console, "error").mockImplementation(() => undefined);
  rpc.send.mockResolvedValue("0x539");
  await store.initializeBlockchain();
  expect(store.qrlInstance).toBeUndefined();
  rpc.send.mockImplementation(({ method }) =>
    Promise.resolve(
      method === "qrl_chainId" ? "0x301825" : { number: "0x0", hash: HASH },
    ),
  );
  await store.fetchQrlConnection();
  expect(store.qrlConnection.isConnected).toBe(true);
  rpc.send.mockResolvedValue("0x539");
  await store.fetchQrlConnection();
  expect(store.qrlConnection.isConnected).toBe(false);
});

it("does not broadcast if wallet generation changes during the final identity check", async () => {
  const { store, rpc } = storeFixture();
  await store.initializeBlockchain();
  let current = true;
  jest.spyOn(walletMutations, "isCurrent").mockImplementation(() => current);
  rpc.signTransaction.mockImplementation(() => {
    rpc.send.mockImplementation(({ method }) => {
      current = false;
      return Promise.resolve(
        method === "qrl_chainId" ? "0x301825" : { number: "0x0", hash: HASH },
      );
    });
    return Promise.resolve(signedTransaction("0x1234"));
  });
  await store.signAndSendTransaction(
    ACCOUNT,
    ACCOUNT,
    "1",
    "public fixture",
    "medium",
    FEE_NOT_SHOWN,
  );
  expect(rpc.signTransaction).toHaveBeenCalledTimes(1);
  expect(rpc.sendSignedTransaction).not.toHaveBeenCalled();
  expect(store.transactionStatus.error).toMatch(/Wallet changed/);
});

it("does not retain signing authority across a clear during the initial identity check", async () => {
  const { store, rpc } = storeFixture();
  await store.initializeBlockchain();
  let current = true;
  jest.spyOn(walletMutations, "isCurrent").mockImplementation(() => current);
  rpc.send.mockImplementation(({ method }) => {
    current = false;
    return Promise.resolve(
      method === "qrl_chainId" ? "0x301825" : { number: "0x0", hash: HASH },
    );
  });
  await store.signAndSendTransaction(
    ACCOUNT,
    ACCOUNT,
    "1",
    "public fixture",
    "medium",
    FEE_NOT_SHOWN,
  );
  expect(deriveHexSeedAsync).not.toHaveBeenCalled();
  expect(rpc.signTransaction).not.toHaveBeenCalled();
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
  store.extensionProvider = provider;
  await expect(store.setActiveAccount(ACCOUNT, "extension")).rejects.toThrow(
    "not yet qualified",
  );
  expect(() => {
    store.setExtensionProvider(provider);
  }).toThrow("not yet qualified");
  expect(() => {
    store.setMobileProvider(provider);
  }).toThrow("not yet qualified");
  store.extensionProvider = provider;
  store.qrlAccounts.accounts = [
    { accountAddress: ACCOUNT, accountBalance: "1", source: "extension" },
  ];
  await store.sendTransactionViaProvider(ACCOUNT, "1");
  expect(provider.request).not.toHaveBeenCalled();
  expect(store.transactionStatus.error).toMatch(/not yet qualified/);
});

it.each([false, true])(
  "rechecks a qualified extension before send when its chain changes: %s",
  async (changeChain) => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest
      .spyOn(QrlStore.prototype, "pollForReceipt")
      .mockResolvedValue(undefined);
    const { store, rpc } = storeFixture();
    await store.initializeBlockchain();
    let chain = "0x301825";
    const request = jest.fn(
      ({ method }: { method: string }): Promise<unknown> => {
        if (method === "qrl_walletCapabilities")
          return Promise.resolve({
            addressScheme: "qip55-64",
            chainId: "0x301825",
            genesisHash: HASH,
          });
        if (method === "qrl_chainId") return Promise.resolve(chain);
        if (method === "qrl_accounts") return Promise.resolve([ACCOUNT]);
        if (method === "qrl_getBlockByNumber")
          return Promise.resolve({ number: "0x0", hash: HASH });
        if (method === "qrl_sendTransaction") return Promise.resolve(HASH);
        return Promise.reject(new Error("Unexpected extension request"));
      },
    );
    const provider: ExtensionProvider = { request };
    await qualifyV3Provider(provider);
    store.setExtensionProvider(provider);
    store.qrlAccounts.accounts = [
      { accountAddress: ACCOUNT, accountBalance: "1", source: "extension" },
    ];
    rpc.estimateGas.mockImplementation(() => {
      if (changeChain) chain = "0x539";
      return Promise.resolve(21000n);
    });
    await store.sendTransactionViaProvider(ACCOUNT, "1");
    const sends = request.mock.calls.filter(
      ([args]) => args.method === "qrl_sendTransaction",
    );
    expect(sends).toHaveLength(changeChain ? 0 : 1);
    if (changeChain) {
      expect(store.transactionStatus.error).toMatch(/chain identity mismatch/);
    } else {
      expect(request).toHaveBeenCalledWith({
        method: "qrl_sendTransaction",
        params: [
          expect.objectContaining({
            from: ACCOUNT,
            to: ACCOUNT,
            chainId: "0x301825",
            gas: "0x5208",
          }),
        ],
      });
      expect(store.transactionStatus.txHash).toBe(HASH);
    }
  },
);

it("discovers extensions but refuses unqualified connections", async () => {
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
  expect(request).toHaveBeenCalledWith({ method: "qrl_walletCapabilities" });
  expect(request).not.toHaveBeenCalledWith({ method: "qrl_requestAccounts" });
});

function pairedPhone(genesisHash = HASH, chainId = "0x301825") {
  const calls: unknown[] = [];
  const provider: ExtensionProvider = {
    request: (args): Promise<unknown> => {
      calls.push(args);
      const answer: unknown =
        args.method === "qrl_chainId"
          ? chainId
          : args.method === "qrl_getBlockByNumber"
            ? { number: "0x0", hash: genesisHash }
            : undefined;
      if (answer === undefined)
        return Promise.reject(new Error(`unexpected ${args.method}`));
      return Promise.resolve(answer);
    },
  };
  return { provider, calls };
}

it("accepts a paired phone that proves the v3 network through the pairing", async () => {
  const { store } = storeFixture();
  const { provider: phone, calls } = pairedPhone();
  expect(() => {
    store.setMobileProvider(phone);
  }).toThrow(V3_UNQUALIFIED_MOBILE_MESSAGE);
  await qualifyV3MobileProvider(phone);
  expect(() => {
    store.setMobileProvider(phone);
  }).not.toThrow();
  expect(store.mobileProvider).toBe(phone);
  expect(calls).toContainEqual({
    method: "qrl_getBlockByNumber",
    params: ["0x0", false],
  });
});

it.each([
  ["another genesis", pairedPhone(`0x${"cd".repeat(32)}`).provider],
  ["another chain", pairedPhone(HASH, "0x539").provider],
])("refuses a paired phone on %s", async (_name, phone) => {
  const { store } = storeFixture();
  await expect(qualifyV3MobileProvider(phone)).rejects.toThrow(
    V3_UNQUALIFIED_MOBILE_MESSAGE,
  );
  expect(() => {
    store.setMobileProvider(phone);
  }).toThrow(V3_UNQUALIFIED_MOBILE_MESSAGE);
  await expect(store.setActiveAccount(ACCOUNT, "mobile")).rejects.toThrow(
    V3_UNQUALIFIED_MOBILE_MESSAGE,
  );
});

function desktopBridge(): QrlWalletBridge {
  const unexpectedRequest = () =>
    Promise.reject(new Error("Unexpected desktop request"));
  return {
    createWallet: unexpectedRequest,
    importWallet: unexpectedRequest,
    unlock: unexpectedRequest,
    lock: unexpectedRequest,
    removeWallet: unexpectedRequest,
    getStatus: unexpectedRequest,
    listWallets: unexpectedRequest,
    setActiveWallet: unexpectedRequest,
    hasWallet: unexpectedRequest,
    getBalance: unexpectedRequest,
    buildTransaction: unexpectedRequest,
    requestSignature: unexpectedRequest,
    sendRawTransaction: unexpectedRequest,
    onLockStateChanged: () => {
      throw new Error("Unexpected desktop subscription");
    },
  };
}

it("blocks the desktop bridge and rejects native wrapper readiness", async () => {
  const buildTransaction = jest.fn<
    ReturnType<QrlWalletBridge["buildTransaction"]>,
    Parameters<QrlWalletBridge["buildTransaction"]>
  >();
  window.qrlWallet = { ...desktopBridge(), buildTransaction };
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
  window.qrlWallet = { ...desktopBridge(), addressScheme: "qip55-64" };
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

it("reuses a recent mobile qualification and keeps it through a timeout", async () => {
  let now = 1_000_000;
  const clock = jest.spyOn(Date, "now").mockImplementation(() => now);
  try {
    let mode: "ok" | "timeout" | "mismatch" = "ok";
    const calls: string[] = [];
    const phone: ExtensionProvider = {
      request: (args): Promise<unknown> => {
        calls.push(args.method);
        if (mode === "timeout")
          return Promise.reject(
            new Error("Network identity verification timed out"),
          );
        const answer: unknown =
          args.method === "qrl_chainId"
            ? "0x301825"
            : {
                number: "0x0",
                hash: mode === "ok" ? HASH : `0x${"cd".repeat(32)}`,
              };
        return Promise.resolve(answer);
      },
    };
    await qualifyV3MobileProvider(phone);
    expect(isQualifiedV3MobileProvider(phone)).toBe(true);
    const afterFirst = calls.length;
    await qualifyV3MobileProvider(phone);
    expect(calls.length).toBe(afterFirst);

    now += V3_MOBILE_QUALIFICATION_TTL_MS + 1;
    mode = "timeout";
    await expect(qualifyV3MobileProvider(phone)).rejects.toThrow(
      V3_MOBILE_UNRESPONSIVE_MESSAGE,
    );
    expect(isQualifiedV3MobileProvider(phone)).toBe(true);

    mode = "mismatch";
    await expect(qualifyV3MobileProvider(phone)).rejects.toThrow(
      V3_UNQUALIFIED_MOBILE_MESSAGE,
    );
    expect(isQualifiedV3MobileProvider(phone)).toBe(false);
  } finally {
    clock.mockRestore();
  }
});
