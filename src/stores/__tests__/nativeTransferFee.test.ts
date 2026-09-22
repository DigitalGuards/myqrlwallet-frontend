/** @jest-environment jsdom */
import { configure } from "mobx";
import QrlStore, { quoteFees } from "../qrlStore";

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

describe("quoteFees", () => {
  const gwei = 1000000000n;
  const market = (tip: bigint, baseFeePerGas: bigint | undefined) => ({
    getGasPrice: jest.fn(async () => 99n * gwei),
    getMaxPriorityFeePerGas: jest.fn(async () => tip),
    getBlock: jest.fn(async () => ({ baseFeePerGas })),
  });

  it.each([
    ["low", 2n * gwei],
    ["medium", 3n * gwei],
    ["high", 4n * gwei],
  ] as const)("scales the suggested tip for %s", async (level, tip) => {
    const provider = market(2n * gwei, 10n * gwei);
    expect(await quoteFees(provider as never, level)).toEqual({
      maxPriorityFeePerGas: tip,
      maxFeePerGas: 20n * gwei + tip,
      expectedFeePerGas: 10n * gwei + tip,
    });
    expect(provider.getBlock).toHaveBeenCalledWith("latest");
    expect(provider.getGasPrice).not.toHaveBeenCalled();
  });

  it("falls back to gasPrice multipliers when the tip method is refused", async () => {
    const provider = market(0n, 10n * gwei);
    provider.getMaxPriorityFeePerGas.mockRejectedValue(new Error("Method not allowed"));
    provider.getGasPrice.mockResolvedValue(gwei);
    expect(await quoteFees(provider as never, "medium")).toEqual({
      maxFeePerGas: 1500000000n,
      maxPriorityFeePerGas: 1250000000n,
      expectedFeePerGas: 1500000000n,
    });
  });

  it("falls back when the latest block carries no base fee", async () => {
    const provider = market(gwei, undefined);
    provider.getGasPrice.mockResolvedValue(gwei);
    expect((await quoteFees(provider as never, "low")).maxFeePerGas).toBe(gwei);
  });

  it("reserves the fee ceiling for Max sends", async () => {
    const store = new QrlStore();
    const estimateGas = jest.fn(async () => 21000n);
    store.qrlInstance = { ...market(gwei, 10n * gwei), estimateGas } as never;
    // 21000 * (2 * 10 gwei + 1.5 gwei)
    expect(await store.estimateNativeTransferFee("medium", transfer)).toBe("0.0004515");
    expect(estimateGas).toHaveBeenCalledWith(expect.objectContaining({
      maxFeePerGas: `0x${(21500000000n).toString(16)}`,
      maxPriorityFeePerGas: `0x${(1500000000n).toString(16)}`,
    }));
  });
});
