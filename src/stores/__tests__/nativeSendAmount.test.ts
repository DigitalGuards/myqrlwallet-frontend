/** @jest-environment jsdom */
/**
 * A native send signs the amount the user typed, converted by the installed
 * @theqrl/web3 `toPlanck`, the same function the fee estimate uses.
 *
 * The Transfer form accepts any decimal that parseUnits(amount, 18) can hold,
 * and that includes more than 18 fractional digits when the extra ones are
 * zeros ("0.1000000000000000000"). @theqrl/web3 1.0.3 converted that input to
 * ten times the amount (upstream finding H-2); 2.0.0 converts it exactly. The
 * cases below pin the signed value to parseUnits, so a regression in either
 * direction fails here.
 */
import { configure } from "mobx";
import { utils } from "@theqrl/web3";
import { createQrlRpc, pendingSend, signedTransaction } from "@/test-utils/web3";
import QrlStore from "../qrlStore";
import { StorageUtil } from "@/utils/storage";
import { parseUnits } from "@/utils/web3/units";
import { FEE_NOT_SHOWN } from "@/utils/web3/feePolicy";

let mockDesktop = false;
const mockDesktopSend = jest.fn((_args: unknown) =>
  Promise.resolve({ transactionHash: `0x${"d".repeat(64)}` }),
);

jest.mock("@/config", () => ({
  QRL_PROVIDER: { TEST_NET: { url: "https://rpc.invalid" } },
  EXPLORER_BASE: "https://explorer.invalid",
}));
jest.mock("@/utils", () => ({ log: jest.fn() }));
jest.mock("@/utils/crypto", () => ({
  deriveHexSeedAsync: jest.fn(() => Promise.resolve("test-seed")),
}));
jest.mock("@/desktop/bridge", () => ({
  get isDesktop() {
    return mockDesktop;
  },
  desktopSigner: {
    signAndSendTransaction: (args: unknown) => mockDesktopSend(args),
  },
}));
jest.mock("@/desktop/walletHydration", () => ({}));
jest.mock("@/utils/storage", () => ({
  StorageUtil: {
    getAccountList: jest.fn(),
    setBalanceCache: jest.fn(),
    getBalanceCache: jest.fn(() => Promise.resolve({})),
  },
}));
jest.mock("@/utils/web3", () => ({ getQrlWeb3: jest.fn(), fetchBalance: jest.fn() }));
jest.mock("@/utils/web3/vm64Logs", () => ({}));
jest.mock("@/utils/nativeWalletMutation", () => ({
  walletMutations: { captureGeneration: () => 1, isCurrent: () => true },
}));
jest.mock("@/constants", () => ({ KNOWN_TOKEN_LIST: [] }));
jest.mock("@/utils/formatting", () => ({ getOptimalTokenBalance: (value: string) => value }));

const ACCOUNT = `Q${"1".repeat(128)}`;
const RECIPIENT = `Q${"2".repeat(128)}`;

/** Amounts the Transfer form accepts, with what each must sign. */
const AMOUNTS = [
  "1",
  "1.5",
  ".5",
  "0.000000000000000001",
  // 19 fractional digits with a trailing zero: 1.0.3 signed 1 Quanta here.
  "0.1000000000000000000",
  "2.50000000000000000000",
];

function makeStore() {
  const store = new QrlStore();
  store.qrlConnection.blockchain = "TEST_NET";
  store.activeAccount.accountAddress = ACCOUNT;
  // The real conversion functions of the installed web3, which is what the
  // app caches here during initializeBlockchain.
  store._utils = utils;
  const rpc = createQrlRpc();
  store.qrlInstance = rpc;
  return { store, rpc };
}

beforeEach(() => {
  configure({ enforceActions: "never" });
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockDesktop = false;
  jest.spyOn(QrlStore.prototype, "initializeBlockchain").mockResolvedValue(undefined);
  jest
    .spyOn(StorageUtil, "getAccountList")
    .mockResolvedValue([{ address: ACCOUNT, source: "seed" }]);
});
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it("converts the 19-digit amount exactly, where 1.0.3 multiplied it by ten", () => {
  expect(utils.toPlanck("0.1000000000000000000", "quanta")).toBe("100000000000000000");
  expect(parseUnits("0.1000000000000000000", 18)).toBe(100000000000000000n);
});

it.each(AMOUNTS)("signs %s as the amount the form validated", async (amount) => {
  const { store, rpc } = makeStore();
  const sign = jest
    .spyOn(rpc.accounts, "signTransaction")
    .mockResolvedValue(signedTransaction("0xraw"));
  const estimateGas = jest.spyOn(rpc, "estimateGas").mockResolvedValue(21000n);
  jest.spyOn(rpc, "getTransactionCount").mockResolvedValue(0n);
  jest.spyOn(rpc, "getGasPrice").mockResolvedValue(1n);
  jest.spyOn(rpc, "sendSignedTransaction").mockReturnValue(pendingSend());

  await store.signAndSendTransaction(ACCOUNT, RECIPIENT, amount, "test mnemonic", "medium", FEE_NOT_SHOWN);

  const expected = parseUnits(amount, 18).toString();
  expect(estimateGas).toHaveBeenCalledWith(expect.objectContaining({ value: expected }));
  expect(sign).toHaveBeenCalledWith(expect.objectContaining({ value: expected }), "test-seed");
});

it.each(AMOUNTS)("hands the desktop signer %s as the amount the form validated", async (amount) => {
  mockDesktop = true;
  const { store } = makeStore();

  await store.signAndSendTransaction(ACCOUNT, RECIPIENT, amount, "", "medium", FEE_NOT_SHOWN);

  expect(mockDesktopSend).toHaveBeenCalledWith(
    expect.objectContaining({ value: parseUnits(amount, 18).toString() }),
  );
});
