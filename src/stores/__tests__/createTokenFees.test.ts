/**
 * Token creation signs through the real @theqrl/web3 client against a fake
 * node, so a web3 upgrade that changes how the fee pair is filled, or that
 * starts refusing the transaction object, fails here.
 *
 * Token creation never showed a fee: it let web3 fill the EIP-1559 pair from
 * the latest block. Until the 2.0.0 upgrade it also passed a legacy gasPrice,
 * which web3 1.0.3 dropped silently and 2.0.0 refuses outright. The values
 * pinned below are the ones 1.0.3 signed for the same node answers (measured
 * side by side): tip = web3's default 2.5 gwei, cap = 2 * baseFee + tip.
 */
import { configure } from "mobx";
import { utils } from "@theqrl/web3";
import type { JsonRpcId } from "@theqrl/web3";
import { TransactionFactory, create } from "@theqrl/web3-qrl-accounts";
import QrlStore from "../qrlStore";
import TokenStore from "../tokenStore";

const RECIPIENT = `Q${"2".repeat(128)}`;
const FACTORY = `Q${"4".repeat(128)}`;
const BASE_FEE = 1_000_000_000n;
const WEB3_DEFAULT_TIP = 2_500_000_000n;
const ESTIMATED_GAS = 50_000n;

const mockAccount = create();
const mockRpcCalls: { method: string; params: unknown }[] = [];
let mockBroadcastRaw: string | null = null;

function mockAnswer(method: string, params: unknown): { result?: unknown; error?: unknown } {
  switch (method) {
    case "qrl_chainId":
      return { result: "0x301825" };
    case "net_version":
      return { result: "3151909" };
    case "qrl_getCode":
      return { result: "0x6001" };
    case "qrl_estimateGas":
      return { result: `0x${ESTIMATED_GAS.toString(16)}` };
    case "qrl_getTransactionCount":
      return { result: "0x0" };
    case "qrl_blockNumber":
      return { result: "0x10" };
    case "qrl_getBlockByNumber":
      return {
        result: {
          number: "0x10",
          hash: `0x${"1".repeat(64)}`,
          baseFeePerGas: `0x${BASE_FEE.toString(16)}`,
          gasLimit: "0x1c9c380",
          transactions: [],
        },
      };
    case "qrl_call":
      return { result: "0x" };
    case "qrl_sendRawTransaction":
      // Capture the signed bytes and refuse them, which ends the send.
      mockBroadcastRaw = Array.isArray(params) && typeof params[0] === "string" ? params[0] : null;
      return { error: { code: -32000, message: "fixture: broadcast refused" } };
    default:
      return { error: { code: -32601, message: `fixture: unexpected ${method}` } };
  }
}

jest.mock("@/config/runtimeProfile", () => ({
  IS_V3_PROFILE: true,
  profileStorageKey: (key: string) => `qrlwallet:v3:${key}`,
  assertV3BrowserContext: jest.fn(),
  assertSupportedAccountSource: jest.fn(),
}));
jest.mock("@/config", () => ({
  QRL_PROVIDER: {
    TEST_NET_V3: {
      id: "TEST_NET_V3",
      url: "https://v3.example/rpc",
      explorer: "https://explorer.example",
      expectedChainId: "0x301825",
      tokenFactory: `Q${"4".repeat(128)}`,
    },
  },
  TOKEN_FACTORY_ADDRESS: "",
  EXPLORER_BASE: "https://explorer.example",
}));
jest.mock("@/utils", () => ({ log: jest.fn() }));
jest.mock("@/utils/crypto", () => ({
  deriveHexSeedAsync: jest.fn(() => Promise.resolve(mockAccount.seed)),
}));
jest.mock("@/desktop/bridge", () => ({ isDesktop: false, desktopSigner: {} }));
jest.mock("@/desktop/walletHydration", () => ({}));
jest.mock("@/utils/storage", () => ({
  StorageUtil: {
    getBlockChain: jest.fn(() => Promise.resolve("TEST_NET_V3")),
    getAccountList: jest.fn(() => Promise.resolve([])),
  },
}));
jest.mock("@/utils/web3", () => {
  const actual = jest.requireActual<typeof import("@theqrl/web3")>("@theqrl/web3");
  /** Stands in for the HttpProvider: one EIP-1193 request per JSON-RPC call. */
  class FixtureProvider {
    request({ id, method, params }: { id?: JsonRpcId; method: string; params?: unknown }) {
      mockRpcCalls.push({ method, params });
      return Promise.resolve({ jsonrpc: "2.0", id, ...mockAnswer(method, params) });
    }
    supportsSubscriptions() {
      return false;
    }
  }
  // The store builds `new Web3(new Web3.providers.HttpProvider(url))`; only
  // the transport is swapped, the client is the real one.
  class FixtureWeb3 extends actual.default {}
  Object.defineProperty(FixtureWeb3, "providers", {
    value: { ...actual.default.providers, HttpProvider: FixtureProvider },
  });
  return {
    getQrlWeb3: () => Promise.resolve({ ...actual, default: FixtureWeb3 }),
    fetchTokenInfo: jest.fn(),
    fetchBalance: jest.fn(),
    discoverTokens: jest.fn(),
    mergeTokenLists: jest.fn(),
  };
});
jest.mock("@/utils/web3/nft", () => ({}));
jest.mock("@/utils/formatting", () => ({}));

beforeAll(() => {
  configure({ enforceActions: "never" });
});

beforeEach(() => {
  mockRpcCalls.length = 0;
  mockBroadcastRaw = null;
});

it("signs token creation with the fee pair web3 has always filled in", async () => {
  // The refused broadcast below is logged on purpose.
  const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);
  // The constructor schedules a network bootstrap on the next tick. This test
  // drives token creation alone, so that timer is dropped before it fires.
  jest.useFakeTimers();
  const store = new QrlStore();
  jest.clearAllTimers();
  jest.useRealTimers();
  store.qrlConnection = {
    ...store.qrlConnection,
    blockchain: "TEST_NET_V3",
    isConnected: true,
    isLoading: false,
  };
  store.activeAccount.accountAddress = mockAccount.address;
  jest.spyOn(store, "assertNetworkReady").mockResolvedValue(undefined);
  const tokens = new TokenStore(store);

  await expect(
    tokens.createToken("Created", "CRT", "100", 8, "1000", RECIPIENT, "10", "10", "test mnemonic"),
  ).rejects.toThrow("fixture: broadcast refused");

  if (mockBroadcastRaw === null) throw new Error("the creation was never broadcast");
  const signed = TransactionFactory.fromSerializedData(utils.hexToBytes(mockBroadcastRaw));
  expect(signed.type).toBe(2);
  expect(signed.toJSON()).toMatchObject({
    to: FACTORY,
    chainId: "0x301825",
    gasLimit: `0x${((ESTIMATED_GAS * 12n) / 10n).toString(16)}`,
    maxPriorityFeePerGas: `0x${WEB3_DEFAULT_TIP.toString(16)}`,
    maxFeePerGas: `0x${(2n * BASE_FEE + WEB3_DEFAULT_TIP).toString(16)}`,
  });
  const methods = mockRpcCalls.map(({ method }) => method);
  // The quote comes from the block alone, as before: no gas price and no
  // node tip suggestion are asked for.
  expect(methods).not.toContain("qrl_gasPrice");
  expect(methods).not.toContain("qrl_maxPriorityFeePerGas");
  expect(tokens.creatingToken).toMatchObject({ creating: false, error: "Returned error: fixture: broadcast refused" });
  consoleError.mockRestore();
});
