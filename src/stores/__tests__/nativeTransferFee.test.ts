/** @jest-environment jsdom */
import { configure } from "mobx";
import QrlStore from "../qrlStore";

let mockDesktop = false;
const mockBuildTransaction = jest.fn();
jest.mock("@/config", () => ({ QRL_PROVIDER: {}, EXPLORER_BASE: "" }));
jest.mock("@/utils", () => ({ log: jest.fn() }));
jest.mock("@/utils/crypto", () => ({ deriveHexSeedAsync: jest.fn() }));
jest.mock("@/desktop/bridge", () => ({
  get isDesktop() {
    return mockDesktop;
  },
  desktopSigner: {},
  qrlWallet: () => ({ buildTransaction: mockBuildTransaction }),
}));
jest.mock("@/desktop/walletHydration", () => ({}));
jest.mock("@/utils/storage", () => ({ StorageUtil: {} }));
jest.mock("@/utils/web3", () => ({ getQrlWeb3: jest.fn() }));
jest.mock("@/utils/nativeWalletMutation", () => ({ walletMutations: {} }));

const from = `Q${"1".repeat(128)}`;
const to = `Q${"2".repeat(128)}`;
const transfer = { from, to, value: "0.123456789012345678" };

beforeEach(() => {
  configure({ enforceActions: "never" });
  mockDesktop = false;
  mockBuildTransaction.mockReset();
  jest
    .spyOn(QrlStore.prototype, "initializeBlockchain")
    .mockResolvedValue(undefined);
});
afterEach(() => jest.restoreAllMocks());

it("quotes empty-calldata contract execution using the exact transfer value", async () => {
  const store = new QrlStore();
  const estimateGas = jest.fn(async () => 150000n);
  store.qrlInstance = {
    estimateGas,
    getGasPrice: jest.fn(async () => 1000000000n),
  } as never;
  expect(await store.estimateNativeTransferFee("medium", transfer)).toBe(
    "0.000225",
  );
  expect(estimateGas).toHaveBeenCalledWith({
    from,
    to,
    value: "123456789012345678",
    type: "0x2",
    maxFeePerGas: "0x59682f00",
    maxPriorityFeePerGas: "0x4a817c80",
  });
});

it("uses the desktop builder gas buffer and desktop fee cap for Max", async () => {
  mockDesktop = true;
  const store = new QrlStore();
  mockBuildTransaction.mockResolvedValue({
    gas: "25200",
    maxFeePerGas: "1000000000",
  });
  expect(await store.estimateNativeTransferFee("low", transfer)).toBe(
    "0.0000252",
  );
  expect(mockBuildTransaction).toHaveBeenCalledWith({
    from,
    to,
    value: "123456789012345678",
    feeLevel: "low",
  });
});

it("retains zero-priced node quotes", async () => {
  const store = new QrlStore();
  store.qrlInstance = {
    estimateGas: jest.fn(async () => 21000n),
    getGasPrice: jest.fn(async () => 0n),
  } as never;
  expect(await store.estimateNativeTransferFee("low", transfer)).toBe("0.0");
});

it("propagates quote failure and refuses incomplete desktop quotes", async () => {
  const store = new QrlStore();
  await expect(
    store.estimateNativeTransferFee("low", transfer),
  ).rejects.toThrow("not connected");
  mockDesktop = true;
  mockBuildTransaction.mockResolvedValue({ gas: "25200" });
  await expect(
    store.estimateNativeTransferFee("low", transfer),
  ).rejects.toThrow("unavailable");
});

it("leaves fee authority with a paired phone", async () => {
  const store = new QrlStore();
  store.activeAccount.accountAddress = from;
  store.qrlAccounts.accounts = [
    { accountAddress: from, accountBalance: "1", source: "mobile" },
  ];
  await expect(
    store.estimateNativeTransferFee("low", transfer),
  ).rejects.toThrow("paired phone");
});
