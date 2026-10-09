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
    TEST_NET_V3: {
      expectedChainId: "0x301825",
      genesisHash: `0x${"ab".repeat(32)}`,
    },
  },
  EXPLORER_BASE: "https://explorer.invalid",
  getPendingTxApiUrl: jest.fn(),
}));
jest.mock("@/utils", () => ({ log: jest.fn() }));
jest.mock("@/utils/crypto", () => ({ deriveHexSeedAsync: jest.fn() }));
jest.mock("@/utils/storage", () => ({
  StorageUtil: jest.requireActual("@/utils/storage/storage").default,
}));

import Web3 from "@theqrl/web3";
import { TextEncoder } from "node:util";
import { configure } from "mobx";
import QrlStore from "../qrlStore";
import { StorageUtil } from "@/utils/storage";
import { normalizeQrlAddress } from "@/utils/web3/address";
import type { EIP6963ProviderDetail } from "@/utils/extension";

const ACCOUNT = `Q${"a".repeat(128)}`;
const OTHER = `Q${"b".repeat(128)}`;
const HASH = `0x${"ab".repeat(32)}`;
const CHAIN = "TEST_NET_V3";
const cleanups: (() => void)[] = [];

function extension(accounts: unknown = [ACCOUNT]) {
  const request = jest.fn(
    async ({ method }: { method: string }): Promise<unknown> => {
      if (method === "qrl_accounts") return accounts;
      if (method === "qrl_walletCapabilities")
        return {
          addressScheme: "qip55-64",
          chainId: "0x301825",
          genesisHash: HASH,
        };
      if (method === "qrl_chainId") return "0x301825";
      if (method === "qrl_getBlockByNumber")
        return { number: "0x0", hash: HASH };
      if (method === "qrl_sendTransaction") return HASH;
      throw new Error(`Unexpected extension method: ${method}`);
    },
  );
  const detail: EIP6963ProviderDetail = {
    info: {
      uuid: "extension",
      name: "MyQRLWallet Extension",
      rdns: "com.qrlwallet.extension",
      icon: "",
    },
    provider: { request },
  };
  return { detail, request };
}

function install(detail: EIP6963ProviderDetail) {
  const announce = () =>
    window.dispatchEvent(
      new CustomEvent("eip6963:announceProvider", { detail }),
    );
  window.addEventListener("eip6963:requestProvider", announce);
  cleanups.push(() =>
    window.removeEventListener("eip6963:requestProvider", announce),
  );
  announce();
}

async function restoredStore() {
  const store = new QrlStore();
  const rpc = new Web3().qrl;
  store._utils = Web3.utils;
  store.qrlInstance = rpc;
  store.qrlConnection = {
    blockchain: CHAIN,
    isConnected: true,
    isLoading: false,
    qrlNetworkName: CHAIN,
  };
  jest
    .spyOn(rpc.requestManager, "send")
    .mockImplementation(async ({ method }) =>
      method === "qrl_chainId" ? "0x301825" : { number: "0x0", hash: HASH },
    );
  jest.spyOn(rpc, "getGasPrice").mockResolvedValue(100n);
  jest
    .spyOn(rpc, "getMaxPriorityFeePerGas")
    .mockRejectedValue(new Error("Use gas price"));
  jest.spyOn(rpc, "getBlock").mockRejectedValue(new Error("Use gas price"));
  const estimate = jest.spyOn(rpc, "estimateGas").mockResolvedValue(21000n);
  await StorageUtil.setAccountList(CHAIN, [
    { address: ACCOUNT, source: "extension" },
  ]);
  await StorageUtil.setActiveAccount(CHAIN, ACCOUNT);
  await store.validateActiveAccount();
  expect(store.activeAccountSource).toBe("extension");
  expect(store.extensionProvider).toBeNull();
  return { store, estimate };
}

beforeEach(() => {
  Object.defineProperty(globalThis, "TextEncoder", {
    value: TextEncoder,
    configurable: true,
  });
  configure({ enforceActions: "never" });
  jest.useFakeTimers();
  localStorage.clear();
  jest
    .spyOn(QrlStore.prototype, "initializeBlockchain")
    .mockResolvedValue(undefined);
  jest.spyOn(QrlStore.prototype, "fetchAccounts").mockResolvedValue(undefined);
  jest
    .spyOn(QrlStore.prototype, "fetchPendingTxDetails")
    .mockResolvedValue(undefined);
  jest.spyOn(QrlStore.prototype, "pollForReceipt").mockResolvedValue(undefined);
  jest.spyOn(console, "error").mockImplementation(() => undefined);
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it("sends from the persisted account after reload with a fresh provider announcement", async () => {
  const { detail, request } = extension([OTHER, ACCOUNT]);
  install(detail);
  const { store } = await restoredStore();
  const send = store.sendTransactionViaProvider(OTHER, "1");
  expect(store.transactionStatus.state).toBe("pending");
  await jest.advanceTimersByTimeAsync(1000);
  await send;
  expect(store.extensionProvider).toBe(detail.provider);
  expect(request).not.toHaveBeenCalledWith({ method: "qrl_requestAccounts" });
  expect(request).toHaveBeenCalledWith({
    method: "qrl_sendTransaction",
    params: [
      expect.objectContaining({
        from: store.activeAccount.accountAddress,
        to: OTHER,
        chainId: "0x301825",
        gas: "0x5208",
      }),
    ],
  });
  expect(store.transactionStatus.txHash).toBe(HASH);
  expect(store.activeAccount.accountAddress.toLowerCase()).toBe(
    ACCOUNT.toLowerCase(),
  );

  await store.sendTransactionViaProvider(OTHER, "2");
  expect(
    request.mock.calls.filter(
      ([args]) => args.method === "qrl_sendTransaction",
    ),
  ).toHaveLength(2);
});

it("restores the provider while selecting another stored extension account", async () => {
  const { store } = await restoredStore();
  const { detail } = extension([ACCOUNT, OTHER]);
  install(detail);
  const select = store.setActiveAccount(OTHER, "extension");
  await jest.advanceTimersByTimeAsync(1000);
  await select;
  expect(store.extensionProvider).toBe(detail.provider);
  expect(store.activeAccount.accountAddress).toBe(normalizeQrlAddress(OTHER));
});

it("shares recovery between fee estimation and Send", async () => {
  const { store } = await restoredStore();
  const { detail, request } = extension();
  install(detail);
  const fee = store.estimateNativeTransferFee("medium", {
    from: ACCOUNT,
    to: OTHER,
    value: "1",
  });
  const send = store.sendTransactionViaProvider(OTHER, "1");
  await jest.advanceTimersByTimeAsync(1000);
  expect(await fee).toMatch(/^0\./);
  await send;
  expect(store.transactionStatus.error).toBeNull();
  expect(store.transactionStatus.txHash).toBe(HASH);
  expect(
    request.mock.calls.filter(
      ([args]) => args.method === "qrl_sendTransaction",
    ),
  ).toHaveLength(1);
});

it.each([
  "missing",
  "revoked",
  "wrong account",
  "malformed",
  "unauthorized",
  "wrong chain",
  "wrong genesis",
])("fails closed when the extension is %s", async (condition) => {
  const { store } = await restoredStore();
  const { detail, request } = extension(
    condition === "revoked"
      ? []
      : condition === "wrong account"
        ? [OTHER]
        : condition === "malformed"
          ? [ACCOUNT, false]
          : [ACCOUNT],
  );
  if (condition === "unauthorized")
    request.mockRejectedValue(
      Object.assign(new Error("Unauthorized"), { code: 4100 }),
    );
  const original = request.getMockImplementation();
  if (!original) throw new Error("Missing fixture implementation");
  if (condition === "wrong chain" || condition === "wrong genesis") {
    request.mockImplementation(async (args) => {
      if (args.method === "qrl_chainId" && condition === "wrong chain")
        return "0x539";
      if (
        args.method === "qrl_getBlockByNumber" &&
        condition === "wrong genesis"
      )
        return { number: "0x0", hash: "wrong" };
      return original(args);
    });
  }
  if (condition !== "missing") install(detail);
  const send = store.sendTransactionViaProvider(OTHER, "1");
  await jest.advanceTimersByTimeAsync(1000);
  await send;
  if (condition === "wrong chain") {
    expect(store.transactionStatus.error).toMatch(/chain identity mismatch/);
  } else if (condition === "wrong genesis") {
    expect(store.transactionStatus.error).toMatch(/genesis identity mismatch/);
  } else {
    expect(store.transactionStatus.error).toBe("Extension not connected.");
  }
  expect(store.extensionProvider).toBeNull();
  expect(
    request.mock.calls.some(([args]) => args.method === "qrl_sendTransaction"),
  ).toBe(false);
  expect(
    request.mock.calls.some(([args]) => args.method === "qrl_requestAccounts"),
  ).toBe(false);
});

it("retries discovery after an unavailable extension becomes available", async () => {
  const { store } = await restoredStore();
  const first = store.sendTransactionViaProvider(OTHER, "1");
  await jest.advanceTimersByTimeAsync(1000);
  await first;
  expect(store.transactionStatus.error).toBe("Extension not connected.");
  install(extension().detail);
  const retry = store.sendTransactionViaProvider(OTHER, "1");
  await jest.advanceTimersByTimeAsync(1000);
  await retry;
  expect(store.transactionStatus.txHash).toBe(HASH);
  expect(store.transactionStatus.error).toBeNull();
});

it.each(["account", "source", "network", "provider cleared"])(
  "cancels recovery if the %s changes during discovery",
  async (change) => {
    const { store } = await restoredStore();
    const { detail, request } = extension();
    install(detail);
    const send = store.sendTransactionViaProvider(OTHER, "1");
    if (change === "account") store.activeAccount.accountAddress = OTHER;
    if (change === "source") store.activeAccount.source = "seed";
    if (change === "network") store.qrlConnection.blockchain = "OTHER";
    if (change === "provider cleared") store.setExtensionProvider(null);
    await jest.advanceTimersByTimeAsync(1000);
    await send;
    expect(store.extensionProvider).toBeNull();
    expect(store.transactionStatus.error).toMatch(/Wallet changed/);
    expect(
      request.mock.calls.some(
        ([args]) => args.method === "qrl_sendTransaction",
      ),
    ).toBe(false);
  },
);

it("checks revocation again after estimating gas", async () => {
  const { store, estimate } = await restoredStore();
  const { detail, request } = extension();
  install(detail);
  const original = request.getMockImplementation();
  if (!original) throw new Error("Missing fixture implementation");
  estimate.mockImplementation(async () => {
    request.mockImplementation(async (args) =>
      args.method === "qrl_accounts" ? [] : original(args),
    );
    return 21000n;
  });
  const send = store.sendTransactionViaProvider(OTHER, "1");
  await jest.advanceTimersByTimeAsync(1000);
  await send;
  expect(store.transactionStatus.error).toBe("Extension not connected.");
  expect(
    request.mock.calls.some(([args]) => args.method === "qrl_sendTransaction"),
  ).toBe(false);
});

it("preserves rejection from the extension approval surface", async () => {
  const { store } = await restoredStore();
  const { detail, request } = extension();
  const original = request.getMockImplementation();
  if (!original) throw new Error("Missing fixture implementation");
  request.mockImplementation(async (args) => {
    if (args.method === "qrl_sendTransaction")
      throw Object.assign(new Error("Rejected"), { code: 4001 });
    return original(args);
  });
  install(detail);
  const send = store.sendTransactionViaProvider(OTHER, "1");
  await jest.advanceTimersByTimeAsync(1000);
  await send;
  expect(store.transactionStatus.error).toBe(
    "Transaction rejected in extension.",
  );
});
