/** @jest-environment jsdom */
import { configure, intercept } from "mobx";
import type { TokenInterface } from "@/constants";
import { logger } from "@/utils/log";
import Web3 from "@theqrl/web3";
import type { TransactionReceipt } from "@theqrl/web3";
import {
  createQrlRpc,
  pendingSend,
  signedTransaction,
} from "@/test-utils/web3";
import { malformed } from "@/test-utils/malformed";
import QrlStore from "../qrlStore";
import TokenStore from "../tokenStore";
import { StorageUtil } from "@/utils/storage";
import { fetchBalance } from "@/utils/web3";
import { parseUnits } from "@/utils/web3/units";
import { FEE_NOT_SHOWN } from "@/utils/web3/feePolicy";

jest.mock("@/config", () => ({
  QRL_PROVIDER: { TEST_NET: { url: "https://old.invalid" }, MAIN_NET: { url: "https://new.invalid" } },
  EXPLORER_BASE: "https://explorer.invalid",
}));
jest.mock("@/utils", () => ({ log: jest.fn() }));
jest.mock("@/utils/crypto", () => ({
  deriveHexSeedAsync: jest.fn(() => Promise.resolve("test-seed")),
}));
jest.mock("@/desktop/bridge", () => ({ isDesktop: false, desktopSigner: {} }));
jest.mock("@/desktop/walletHydration", () => ({}));
jest.mock("@/utils/storage", () => ({ StorageUtil: {
  getAccountList: jest.fn(), setBalanceCache: jest.fn(), getBalanceCache: jest.fn(), updateTokenList: jest.fn(),
  clearLegacyGlobalTokenData: jest.fn(),
  getTokenList: jest.fn(() => Promise.resolve([])),
  getHiddenTokens: jest.fn(() => Promise.resolve([])),
} }));
jest.mock("@/utils/web3", () => ({ getQrlWeb3: jest.fn(), fetchBalance: jest.fn() }));
jest.mock("@/utils/web3/address", () => ({
  normalizeQrlAddress: (value: string) => value,
  isValidQrlAddress: (value: unknown) => typeof value === 'string' && /^Q[0-9a-fA-F]{128}$/.test(value),
}));
jest.mock("@/utils/web3/vm64Logs", () => ({}));
jest.mock("@/utils/nativeWalletMutation", () => ({ walletMutations: {
  captureGeneration: () => 1, isCurrent: () => true,
} }));
jest.mock("@/constants", () => ({ KNOWN_TOKEN_LIST: [] }));
jest.mock("@/utils/formatting", () => ({ getOptimalTokenBalance: (value: string) => value }));

const HASH = `0x${"a".repeat(64)}`;
const INCLUSION = {
  blockHash: `0x${"c".repeat(64)}`,
  blockNumber: 42n,
  gasUsed: 21000n,
  transactionIndex: 0n,
  from: `Q${"1".repeat(128)}`,
  to: `Q${"2".repeat(128)}`,
  cumulativeGasUsed: 21000n,
  logs: [],
  logsBloom: "0x",
  root: `0x${"0".repeat(64)}`,
};
let getAccountList: jest.SpiedFunction<typeof StorageUtil.getAccountList>;
let getBalanceCache: jest.SpiedFunction<typeof StorageUtil.getBalanceCache>;
let setBalanceCache: jest.SpiedFunction<typeof StorageUtil.setBalanceCache>;
let updateTokenList: jest.SpiedFunction<typeof StorageUtil.updateTokenList>;
const ACCOUNT = `Q${"1".repeat(128)}`;
const RECIPIENT = `Q${"2".repeat(128)}`;
function deferred<T>() {
  let resolve: (value: T) => void = () => {
    throw new Error("Deferred promise unavailable");
  };
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function makeStore() {
  const store = new QrlStore();
  store.qrlConnection.blockchain = "TEST_NET";
  store.activeAccount.accountAddress = ACCOUNT;
  store._utils = {
    ...Web3.utils,
    bytesToHex: (value) =>
      typeof value === "string" ? value : Web3.utils.bytesToHex(value),
    fromPlanck: (value) => value.toString(),
    toPlanck: (value) => parseUnits(String(value), 18).toString(),
  };
  const rpc = createQrlRpc();
  store.qrlInstance = rpc;
  return { store, rpc };
}

beforeEach(() => {
  configure({ enforceActions: "never" });
  jest.useFakeTimers();
  jest.clearAllMocks();
  jest
    .spyOn(QrlStore.prototype, "initializeBlockchain")
    .mockResolvedValue(undefined);
  getAccountList = jest.spyOn(StorageUtil, "getAccountList");
  getBalanceCache = jest.spyOn(StorageUtil, "getBalanceCache");
  setBalanceCache = jest.spyOn(StorageUtil, "setBalanceCache");
  updateTokenList = jest.spyOn(StorageUtil, "updateTokenList");
  getAccountList.mockResolvedValue([{ address: ACCOUNT, source: "seed" }]);
  getBalanceCache.mockResolvedValue({});
});
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); jest.restoreAllMocks(); });

it.each([0n, 0, false, "0x0"])(
  "marks a receipt with status %s as execution failure",
  async (status) => {
    const { store, rpc } = makeStore();
    const receipt = { ...INCLUSION, transactionHash: HASH, status };
    jest
      .spyOn(rpc, "getTransactionReceipt")
      .mockResolvedValue(
        typeof status === "boolean"
          ? malformed<TransactionReceipt>(receipt)
          : { ...receipt, status },
      );
    jest.spyOn(rpc, "getBalance").mockResolvedValue(1n);
    store.transactionStatus = {
      state: "pending",
      txHash: HASH,
      receipt: null,
      error: null,
    };
    await store.pollForReceipt(HASH);
    await jest.advanceTimersByTimeAsync(5000);
    expect(store.transactionStatus.state).toBe("failed");
    expect(store.transactionStatus.error).toMatch(/reverted/);
    expect(store.transactionStatus.receipt?.status).toBe(0n);
  },
);

it("retains pending state through observation failure and confirms a later receipt", async () => {
  const { store, rpc } = makeStore();
  jest
    .spyOn(rpc, "getTransactionReceipt")
    .mockRejectedValueOnce(new Error("RPC unavailable"))
    .mockResolvedValueOnce({ ...INCLUSION, transactionHash: HASH, status: 1n });
  jest.spyOn(rpc, "getBalance").mockResolvedValue(1n);
  store.transactionStatus = {
    state: "pending",
    txHash: HASH,
    receipt: null,
    error: null,
  };
  await store.pollForReceipt(HASH);
  await jest.advanceTimersByTimeAsync(5000);
  expect(store.transactionStatus.state).toBe("pending");
  await jest.advanceTimersByTimeAsync(5000);
  expect(store.transactionStatus.state).toBe("confirmed");
});

it.each([
  { ...INCLUSION, transactionHash: HASH, status: undefined },
  { ...INCLUSION, transactionHash: HASH, status: "not-known" },
  { transactionHash: `0x${"b".repeat(64)}`, status: 1n },
])(
  "waits for evidence when a receipt is incomplete or mismatched: %p",
  async (receipt) => {
    const { store, rpc } = makeStore();
    jest
      .spyOn(rpc, "getTransactionReceipt")
      .mockResolvedValue(malformed<TransactionReceipt>(receipt));
    store.transactionStatus = {
      state: "pending",
      txHash: HASH,
      receipt: null,
      error: null,
    };
    await store.pollForReceipt(HASH);
    await jest.advanceTimersByTimeAsync(5000);
    expect(store.transactionStatus.state).toBe("pending");
  },
);

it("supplies the full native-transfer estimate to the extension signer", async () => {
  const { store, rpc } = makeStore();
  store.qrlAccounts.accounts = [
    { accountAddress: ACCOUNT, accountBalance: "10", source: "extension" },
  ];
  const request = jest.fn(
    ({ method }: { method: string }): Promise<unknown> =>
      Promise.resolve(method === "qrl_accounts" ? [ACCOUNT] : "0xreceipt"),
  );
  store.extensionProvider = { request };
  const estimateGas = jest.spyOn(rpc, "estimateGas").mockResolvedValue(90000n);
  jest.spyOn(rpc, "getGasPrice").mockResolvedValue(100n);
  await store.sendTransactionViaProvider(RECIPIENT, "0.123456789012345678");
  expect(estimateGas).toHaveBeenCalledWith(
    expect.objectContaining({
      from: ACCOUNT,
      to: RECIPIENT,
      value: `0x${123456789012345678n.toString(16)}`,
    }),
  );
  expect(request).toHaveBeenCalledWith({
    method: "qrl_sendTransaction",
    params: [expect.objectContaining({ gas: "0x15f90" })],
  });
  store.resetTransactionStatus();
});

it("does not prompt an extension send when the recipient gas estimate fails", async () => {
  const { store, rpc } = makeStore();
  store.qrlAccounts.accounts = [
    { accountAddress: ACCOUNT, accountBalance: "10", source: "extension" },
  ];
  const request = jest.fn(() => Promise.resolve([ACCOUNT]));
  store.extensionProvider = { request };
  jest.spyOn(rpc, "getGasPrice").mockResolvedValue(100n);
  jest
    .spyOn(rpc, "estimateGas")
    .mockRejectedValue(new Error("receiver reverted"));
  await store.sendTransactionViaProvider(RECIPIENT, "1");
  expect(request).toHaveBeenCalledWith({ method: "qrl_accounts" });
  expect(request).toHaveBeenCalledTimes(1);
  expect(store.transactionStatus.state).toBe("failed");
});

it("does not publish or cache an old network balance after the new network refresh", async () => {
  const old = deferred<bigint>();
  const { store, rpc } = makeStore();
  jest.spyOn(rpc, "getBalance").mockReturnValue(old.promise);
  const first = store.fetchAccounts();
  await Promise.resolve();
  store.qrlConnection.blockchain = "MAIN_NET";
  const nextRpc = createQrlRpc();
  jest.spyOn(nextRpc, "getBalance").mockResolvedValue(25n);
  store.qrlInstance = nextRpc;
  await store.fetchAccounts();
  old.resolve(99n);
  await first;
  expect(store.getAccountBalance(ACCOUNT)).toBe("25");
  expect(setBalanceCache).toHaveBeenCalledTimes(1);
  expect(setBalanceCache).toHaveBeenCalledWith("MAIN_NET", { [ACCOUNT]: "25" });
  expect(store.qrlAccounts.isLoading).toBe(false);
});

it("keeps the newest balance when same-network refreshes complete out of order", async () => {
  const old = deferred<bigint>();
  const { store, rpc } = makeStore();
  jest
    .spyOn(rpc, "getBalance")
    .mockReturnValueOnce(old.promise)
    .mockResolvedValue(25n);
  const first = store.fetchAccounts();
  await Promise.resolve();
  await store.fetchAccounts();
  old.resolve(99n);
  await first;
  expect(store.getAccountBalance(ACCOUNT)).toBe("25");
});

it("does not overwrite new-network tokens for the same account with old balances", async () => {
  const old = deferred<bigint>();
  const { store } = makeStore();
  const tokens = new TokenStore(store);
  tokens.tokenList = [
    {
      address: RECIPIENT,
      name: "Token",
      symbol: "TOK",
      decimals: 0,
      amount: "0",
    },
  ];
  jest
    .mocked(fetchBalance)
    .mockReturnValueOnce(old.promise)
    .mockResolvedValueOnce(25n);
  const first = tokens.refreshTokenBalances();
  store.qrlConnection.blockchain = "MAIN_NET";
  await tokens.refreshTokenBalances();
  old.resolve(99n);
  await first;
  expect(tokens.tokenList[0]?.amount).toBe("25");
  expect(updateTokenList).toHaveBeenCalledTimes(1);
  expect(updateTokenList).toHaveBeenCalledWith(
    "MAIN_NET",
    ACCOUNT,
    expect.any(Array),
  );
});

it.each([21000n, 45000n])(
  "uses the estimated gas %s for an empty-calldata native send",
  async (gas) => {
    const { store, rpc } = makeStore();
    const sign = jest
      .spyOn(rpc.accounts, "signTransaction")
      .mockResolvedValue(signedTransaction("0xraw"));
    const estimateGas = jest.spyOn(rpc, "estimateGas").mockResolvedValue(gas);
    jest.spyOn(rpc, "getTransactionCount").mockResolvedValue(0n);
    jest.spyOn(rpc, "getGasPrice").mockResolvedValue(1n);
    jest.spyOn(rpc, "sendSignedTransaction").mockReturnValue(pendingSend());
    await store.signAndSendTransaction(
      ACCOUNT,
      RECIPIENT,
      "1",
      "test mnemonic",
      "medium",
      FEE_NOT_SHOWN,
    );
    expect(estimateGas).toHaveBeenCalledWith(
      expect.objectContaining({
        from: ACCOUNT,
        to: RECIPIENT,
        value: "1000000000000000000",
      }),
    );
    expect(sign).toHaveBeenCalledWith(
      expect.objectContaining({ gas }),
      "test-seed",
    );
  },
);

it("stops before signing when native transfer gas estimation fails", async () => {
  const { store, rpc } = makeStore();
  const sign = jest
    .spyOn(rpc.accounts, "signTransaction")
    .mockRejectedValue(new Error("Unexpected signing"));
  jest.spyOn(rpc, "getTransactionCount").mockResolvedValue(0n);
  jest.spyOn(rpc, "getGasPrice").mockResolvedValue(1n);
  jest
    .spyOn(rpc, "estimateGas")
    .mockRejectedValue(new Error("receiver rejects value"));
  await store.signAndSendTransaction(
    ACCOUNT,
    RECIPIENT,
    "1",
    "test mnemonic",
    "medium",
    FEE_NOT_SHOWN,
  );
  expect(sign).not.toHaveBeenCalled();
  expect(store.transactionStatus.state).toBe("failed");
});


it.each([
  { balance: 1250, expected: '12.5' },
  { balance: -1250, expected: '-12.5' },
  { balance: 1250n, expected: '12.5' },
  { balance: '0x4e2', expected: '12.5' },
  { balance: '1250', expected: '12.5' },
  { balance: 1200, expected: '12' },
  { balance: 0, expected: '0' },
  { balance: true, expected: '0.01' },
  { balance: { valueOf: () => 1250 }, expected: '12.5' },
])('preserves numeric RPC balances: $balance', async ({ balance, expected }) => {
  const { store } = makeStore();
  const tokens = new TokenStore(store);
  const token: TokenInterface = {
    address: RECIPIENT, name: 'Token', symbol: 'TOK', decimals: 2, amount: 'old',
  };
  tokens.tokenList = [token];
  jest.mocked(fetchBalance).mockResolvedValueOnce(malformed(balance));
  await tokens.refreshTokenBalances();
  expect(tokens.tokenList).toEqual([{ ...token, amount: expected }]);
  expect(updateTokenList).toHaveBeenCalledWith('TEST_NET', ACCOUNT, [
    { ...token, amount: expected },
  ]);
});

it('retains failed balance rows and their fields in the original order', async () => {
  const { store } = makeStore();
  const tokens = new TokenStore(store);
  const first = {
    address: RECIPIENT, name: 'First', symbol: 'ONE', decimals: 2, amount: 37,
    importedField: { label: 'preserved' },
  };
  const second = { address: ACCOUNT, symbol: 'TWO', decimals: 0, extra: true };
  tokens.tokenList = [malformed(first), malformed(second)];
  jest.mocked(fetchBalance)
    .mockResolvedValueOnce(malformed('invalid'))
    .mockResolvedValueOnce(malformed(7));
  const error = jest.spyOn(logger, 'error').mockImplementation(() => undefined);
  await tokens.refreshTokenBalances();
  expect(tokens.tokenList).toEqual([
    { ...first, amount: 'Error' }, { ...second, amount: '7' },
  ]);
  expect(error).toHaveBeenCalledWith(
    'Error fetching balance for token ONE:', expect.any(SyntaxError),
  );
});

it.each([{ toString: null }, { toString: 'TOK' }, [{ toString: null }]])(
  'persists all balance rows with diagnostics disabled for stored symbol %p',
  async (symbol) => {
    const flag = Object.getOwnPropertyDescriptor(globalThis, '__QRL_DIAGNOSTICS__');
    Object.defineProperty(globalThis, '__QRL_DIAGNOSTICS__', {
      configurable: true,
      value: false,
    });
    localStorage.setItem('TOKEN_LIST_GATE_MIGRATED_V1', '1');
    localStorage.setItem('TOKEN_LIST_PER_ACCOUNT_MIGRATED_V1', '1');
    try {
      const { store } = makeStore();
      const tokens = new TokenStore(store);
      const rows = [
        {
          address: RECIPIENT, name: 'Failed', symbol, decimals: 0,
          amount: 'old-failed', extra: { retained: 'first' },
        },
        {
          address: ACCOUNT, name: 'Healthy', symbol: 'OK', decimals: 0,
          amount: 'old-healthy', extra: { retained: 'second' },
        },
      ].map((row) => malformed<TokenInterface>(row));
      jest.spyOn(StorageUtil, 'getTokenList').mockResolvedValueOnce(rows);
      await tokens.initialize();
      expect(tokens.tokenList).toEqual(rows);
      updateTokenList.mockClear();

      const healthy = deferred<Awaited<ReturnType<typeof fetchBalance>>>();
      jest.mocked(fetchBalance)
        .mockRejectedValueOnce(new Error('RPC unavailable'))
        .mockReturnValueOnce(healthy.promise);
      const error = jest.spyOn(logger, 'error').mockImplementation(() => undefined);
      const refresh = tokens.refreshTokenBalances();
      expect(fetchBalance).toHaveBeenCalledTimes(2);
      expect(updateTokenList).not.toHaveBeenCalled();
      healthy.resolve(malformed(7n));
      await refresh;

      const expected = [{ ...rows[0], amount: 'Error' }, { ...rows[1], amount: '7' }];
      expect(tokens.tokenList).toEqual(expected);
      expect(updateTokenList).toHaveBeenCalledTimes(1);
      expect(updateTokenList).toHaveBeenCalledWith('TEST_NET', ACCOUNT, expected);
      expect(error).not.toHaveBeenCalled();
    } finally {
      localStorage.clear();
      if (flag) {
        Object.defineProperty(globalThis, '__QRL_DIAGNOSTICS__', flag);
      } else {
        Reflect.deleteProperty(globalThis, '__QRL_DIAGNOSTICS__');
      }
    }
  },
);

it('keeps unknown-network refresh failure ahead of reads and writes', async () => {
  const { store } = makeStore();
  store.qrlConnection.blockchain = 'missing-network';
  const tokens = new TokenStore(store);
  const error = jest.spyOn(logger, 'error').mockImplementation(() => undefined);
  await tokens.refreshTokenBalances();
  expect(fetchBalance).not.toHaveBeenCalled();
  expect(updateTokenList).not.toHaveBeenCalled();
  expect(error).toHaveBeenCalledWith(
    'Error refreshing token balances:',
    new TypeError("Cannot read properties of undefined (reading 'url')"),
  );
});

it('updates creation state synchronously and resolves through a promise', async () => {
  const { store } = makeStore();
  const tokens = new TokenStore(store);
  const pending = tokens.setCreatingToken('Token', true, 'detail');
  expect(tokens.creatingToken).toEqual({ name: 'Token', creating: true, error: 'detail' });
  expect(pending).toBeInstanceOf(Promise);
  await expect(pending).resolves.toBeUndefined();
});

it('rejects a creation-state write failure through its promise', async () => {
  const { store } = makeStore();
  const tokens = new TokenStore(store);
  const failure = new Error('creation write failed');
  const dispose = intercept(tokens, 'creatingToken', () => { throw failure; });
  try {
    const pending = tokens.setCreatingToken('Token', true);
    expect(pending).toBeInstanceOf(Promise);
    await expect(pending).rejects.toBe(failure);
  } finally {
    dispose();
  }
});

it('runs legacy migration before initialize yields and preserves stored records', async () => {
  localStorage.clear();
  localStorage.setItem('TOKEN_LIST_PER_ACCOUNT_MIGRATED_V1', '1');
  const { store } = makeStore();
  const tokens = new TokenStore(store);
  const rows = [
    { address: ACCOUNT, amount: 42, extra: 'first' },
    { address: RECIPIENT, decimals: 3, extra: 'second' },
  ].map((row) => malformed<TokenInterface>(row));
  const getTokens = jest.spyOn(StorageUtil, 'getTokenList').mockResolvedValueOnce(rows);
  const clear = jest.spyOn(StorageUtil, 'clearLegacyGlobalTokenData');
  const pending = tokens.initialize();
  expect(clear).toHaveBeenCalledTimes(1);
  expect(localStorage.getItem('TOKEN_LIST_GATE_MIGRATED_V1')).toBe('1');
  expect(getTokens).not.toHaveBeenCalled();
  await pending;
  expect(tokens.tokenList).toEqual(rows);
  expect(updateTokenList).toHaveBeenCalledWith('TEST_NET', ACCOUNT, rows);
  localStorage.clear();
});

it('rejects migration failure and leaves its marker unset', async () => {
  localStorage.clear();
  const { store } = makeStore();
  const tokens = new TokenStore(store);
  const failure = new Error('migration failed');
  const getTokens = jest.spyOn(StorageUtil, 'getTokenList');
  const clear = jest.spyOn(StorageUtil, 'clearLegacyGlobalTokenData').mockImplementationOnce(() => { throw failure; });
  const pending = tokens.initialize();
  expect(clear).toHaveBeenCalledTimes(1);
  expect(localStorage.getItem('TOKEN_LIST_GATE_MIGRATED_V1')).toBeNull();
  await expect(pending).rejects.toBe(failure);
  expect(getTokens).not.toHaveBeenCalled();
  expect(updateTokenList).not.toHaveBeenCalled();
});
