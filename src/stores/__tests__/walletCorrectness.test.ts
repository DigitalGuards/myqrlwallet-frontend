/** @jest-environment jsdom */
import { configure } from "mobx";
import QrlStore from "../qrlStore";
import TokenStore from "../tokenStore";
import { StorageUtil } from "@/utils/storage";
import { fetchBalance } from "@/utils/web3";
import { parseUnits } from "@/utils/web3/units";

jest.mock("@/config", () => ({
  QRL_PROVIDER: { TEST_NET: { url: "https://old.invalid" }, MAIN_NET: { url: "https://new.invalid" } },
  EXPLORER_BASE: "https://explorer.invalid", getPendingTxApiUrl: jest.fn(),
}));
jest.mock("@/utils", () => ({ log: jest.fn() }));
jest.mock("@/utils/crypto", () => ({ deriveHexSeedAsync: jest.fn(async () => "test-seed") }));
jest.mock("@/desktop/bridge", () => ({ isDesktop: false, desktopSigner: {} }));
jest.mock("@/desktop/walletHydration", () => ({}));
jest.mock("@/utils/storage", () => ({ StorageUtil: {
  getAccountList: jest.fn(), setBalanceCache: jest.fn(), getBalanceCache: jest.fn(), updateTokenList: jest.fn(),
} }));
jest.mock("@/utils/web3", () => ({ getQrlWeb3: jest.fn(), fetchBalance: jest.fn() }));
jest.mock("@/utils/web3/address", () => ({ normalizeQrlAddress: (value: string) => value }));
jest.mock("@/utils/web3/vm64Logs", () => ({}));
jest.mock("@/utils/nativeWalletMutation", () => ({ walletMutations: {
  captureGeneration: () => 1, isCurrent: () => true,
} }));
jest.mock("@/constants", () => ({ KNOWN_TOKEN_LIST: [] }));
jest.mock("@/utils/formatting", () => ({ getOptimalTokenBalance: (value: string) => value }));

const ACCOUNT = `Q${"1".repeat(128)}`;
const RECIPIENT = `Q${"2".repeat(128)}`;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function makeStore() {
  const store = new QrlStore();
  store.qrlConnection.blockchain = "TEST_NET";
  store.activeAccount.accountAddress = ACCOUNT;
  store._utils = {
    bytesToHex: (value: string) => value,
    fromPlanck: (value: bigint) => value.toString(),
    toPlanck: (value: string) => parseUnits(value, 18).toString(),
    toHex: (value: bigint) => `0x${value.toString(16)}`,
  } as never;
  return store;
}

beforeEach(() => {
  configure({ enforceActions: "never" });
  jest.useFakeTimers();
  jest.clearAllMocks();
  jest.spyOn(QrlStore.prototype, "initializeBlockchain").mockResolvedValue(undefined);
  jest.spyOn(QrlStore.prototype, "fetchPendingTxDetails").mockResolvedValue(undefined);
  jest.mocked(StorageUtil.getAccountList).mockResolvedValue([{ address: ACCOUNT, source: "seed" }]);
  jest.mocked(StorageUtil.getBalanceCache).mockResolvedValue({});
});
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); jest.restoreAllMocks(); });

it.each([0n, 0, false, "0x0"])("marks a receipt with status %s as execution failure", async (status) => {
  const store = makeStore();
  store.qrlInstance = { getTransactionReceipt: jest.fn(async () => ({ transactionHash: "0xreceipt", status })),
    getBalance: jest.fn(async () => 1n) } as never;
  store.transactionStatus = { state: "pending", txHash: "0xreceipt", receipt: null, error: null, pendingDetails: null };
  await store.pollForReceipt("0xreceipt");
  await jest.advanceTimersByTimeAsync(5000);
  expect(store.transactionStatus.state).toBe("failed");
  expect(store.transactionStatus.error).toMatch(/reverted/);
  expect(store.transactionStatus.receipt?.status).toBe(status);
});

it("retains pending state through observation failure and confirms a later receipt", async () => {
  const getReceipt = jest.fn().mockRejectedValueOnce(new Error("RPC unavailable"))
    .mockResolvedValueOnce({ transactionHash: "0xreceipt", status: 1n });
  const store = makeStore();
  store.qrlInstance = { getTransactionReceipt: getReceipt, getBalance: jest.fn(async () => 1n) } as never;
  store.transactionStatus = { state: "pending", txHash: "0xreceipt", receipt: null, error: null, pendingDetails: null };
  await store.pollForReceipt("0xreceipt");
  await jest.advanceTimersByTimeAsync(5000);
  expect(store.transactionStatus.state).toBe("pending");
  await jest.advanceTimersByTimeAsync(5000);
  expect(store.transactionStatus.state).toBe("confirmed");
});

it.each([
  { transactionHash: "0xreceipt", status: undefined },
  { transactionHash: "0xreceipt", status: "not-known" },
  { transactionHash: "0xother", status: 1n },
])("waits for evidence when a receipt is incomplete or mismatched: %p", async (receipt) => {
  const store = makeStore();
  store.qrlInstance = { getTransactionReceipt: jest.fn(async () => receipt) } as never;
  store.transactionStatus = { state: "pending", txHash: "0xreceipt", receipt: null, error: null, pendingDetails: null };
  await store.pollForReceipt("0xreceipt");
  await jest.advanceTimersByTimeAsync(5000);
  expect(store.transactionStatus.state).toBe("pending");
});

it("supplies the full native-transfer estimate to the extension signer", async () => {
  const store = makeStore();
  store.qrlAccounts.accounts = [{ accountAddress: ACCOUNT, accountBalance: "10", source: "extension" }];
  const request = jest.fn(async () => "0xreceipt");
  store.extensionProvider = { request } as never;
  const estimateGas = jest.fn(async () => 90000n);
  store.qrlInstance = { getGasPrice: jest.fn(async () => 100n), estimateGas } as never;
  await store.sendTransactionViaProvider(RECIPIENT, "0.123456789012345678");
  expect(estimateGas).toHaveBeenCalledWith(expect.objectContaining({
    from: ACCOUNT, to: RECIPIENT, value: `0x${123456789012345678n.toString(16)}`,
  }));
  expect(request).toHaveBeenCalledWith({ method: "qrl_sendTransaction", params: [expect.objectContaining({ gas: "0x15f90" })] });
  store.resetTransactionStatus();
});

it("does not prompt an extension send when the recipient gas estimate fails", async () => {
  const store = makeStore();
  store.qrlAccounts.accounts = [{ accountAddress: ACCOUNT, accountBalance: "10", source: "extension" }];
  const request = jest.fn();
  store.extensionProvider = { request } as never;
  store.qrlInstance = { getGasPrice: jest.fn(async () => 100n), estimateGas: jest.fn(async () => { throw new Error("receiver reverted"); }) } as never;
  await store.sendTransactionViaProvider(RECIPIENT, "1");
  expect(request).not.toHaveBeenCalled();
  expect(store.transactionStatus.state).toBe("failed");
});

it("does not publish or cache an old network balance after the new network refresh", async () => {
  const old = deferred<bigint>();
  const store = makeStore();
  store.qrlInstance = { getBalance: jest.fn(() => old.promise) } as never;
  const first = store.fetchAccounts();
  await Promise.resolve();
  store.qrlConnection.blockchain = "MAIN_NET";
  store.qrlInstance = { getBalance: jest.fn(async () => 25n) } as never;
  await store.fetchAccounts();
  old.resolve(99n);
  await first;
  expect(store.getAccountBalance(ACCOUNT)).toBe("25");
  expect(StorageUtil.setBalanceCache).toHaveBeenCalledTimes(1);
  expect(StorageUtil.setBalanceCache).toHaveBeenCalledWith("MAIN_NET", { [ACCOUNT]: "25" });
  expect(store.qrlAccounts.isLoading).toBe(false);
});

it("keeps the newest balance when same-network refreshes complete out of order", async () => {
  const old = deferred<bigint>();
  const store = makeStore();
  store.qrlInstance = { getBalance: jest.fn().mockImplementationOnce(() => old.promise).mockResolvedValue(25n) } as never;
  const first = store.fetchAccounts();
  await Promise.resolve();
  await store.fetchAccounts();
  old.resolve(99n);
  await first;
  expect(store.getAccountBalance(ACCOUNT)).toBe("25");
});

it("does not overwrite new-network tokens for the same account with old balances", async () => {
  const old = deferred<bigint>();
  const store = makeStore();
  const tokens = new TokenStore(store);
  tokens.tokenList = [{ address: RECIPIENT, name: "Token", symbol: "TOK", decimals: 0, amount: "0" }];
  jest.mocked(fetchBalance).mockReturnValueOnce(old.promise).mockResolvedValueOnce(25n);
  const first = tokens.refreshTokenBalances();
  store.qrlConnection.blockchain = "MAIN_NET";
  await tokens.refreshTokenBalances();
  old.resolve(99n);
  await first;
  expect(tokens.tokenList[0]?.amount).toBe("25");
  expect(StorageUtil.updateTokenList).toHaveBeenCalledTimes(1);
  expect(StorageUtil.updateTokenList).toHaveBeenCalledWith("MAIN_NET", ACCOUNT, expect.any(Array));
});

it.each([21000n, 45000n])("uses the estimated gas %s for an empty-calldata native send", async (gas) => {
  const store = makeStore();
  const send = { on: jest.fn().mockReturnThis() };
  const sign = jest.fn(async () => ({ rawTransaction: "0xraw" }));
  const estimateGas = jest.fn(async () => gas);
  store.qrlInstance = { getTransactionCount: jest.fn(async () => 0n), getGasPrice: jest.fn(async () => 1n),
    estimateGas, accounts: { signTransaction: sign }, sendSignedTransaction: jest.fn(() => send) } as never;
  await store.signAndSendTransaction(ACCOUNT, RECIPIENT, "1", "test mnemonic");
  expect(estimateGas).toHaveBeenCalledWith(expect.objectContaining({ from: ACCOUNT, to: RECIPIENT, value: "1000000000000000000" }));
  expect(sign).toHaveBeenCalledWith(expect.objectContaining({ gas }), "test-seed");
});

it("stops before signing when native transfer gas estimation fails", async () => {
  const store = makeStore();
  const sign = jest.fn();
  store.qrlInstance = { getTransactionCount: jest.fn(async () => 0n), getGasPrice: jest.fn(async () => 1n),
    estimateGas: jest.fn(async () => { throw new Error("receiver rejects value"); }), accounts: { signTransaction: sign } } as never;
  await store.signAndSendTransaction(ACCOUNT, RECIPIENT, "1", "test mnemonic");
  expect(sign).not.toHaveBeenCalled();
  expect(store.transactionStatus.state).toBe("failed");
});
