/** @jest-environment jsdom */

import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { runInAction } from "mobx";
import QrlStore from "@/stores/qrlStore";
import { useLocation, useSearchParams } from "react-router";
import { useStore } from "@/stores/store";
import { useNetworkQrnsRecipient } from "@/hooks/useNetworkQrnsRecipient";
import type { UseQrnsRecipientResult } from "@/hooks/useQrnsRecipient";
import Transfer from "../Transfer";

jest.mock("react-router", () => ({
  useLocation: jest.fn(),
  useNavigate: jest.fn(() => jest.fn()),
  useSearchParams: jest.fn(),
}));
jest.mock("@/stores/store", () => ({ useStore: jest.fn() }));
jest.mock("@/utils", () => ({
  log: jest.fn(),
  cn: (...values: unknown[]) =>
    values.filter((value) => typeof value === "string").join(" "),
}));
jest.mock("@/router/router", () => ({
  ROUTES: { HOME: "/", IMPORT_ACCOUNT: "/import" },
}));
jest.mock("@/hooks/useNetworkQrnsRecipient", () => ({
  useNetworkQrnsRecipient: jest.fn(),
}));
jest.mock("@/config", () => ({
  QRL_PROVIDER: {
    TEST_NET: {
      url: "http://rpc.invalid",
      explorer: "https://explorer.invalid",
    },
  },
  getExplorerAddressUrl: jest.fn(() => "https://explorer.invalid/address"),
  getExplorerTxUrl: jest.fn(() => "https://explorer.invalid/tx"),
}));
jest.mock("@/constants", () => ({
  NATIVE_TOKEN: { symbol: "QRL", name: "Quanta", decimals: 18 },
}));
jest.mock("@/desktop/bridge", () => ({ isDesktop: false }));
jest.mock("@/utils/storage", () => ({
  StorageUtil: { getBlockChain: jest.fn(async () => "TEST_NET") },
}));
jest.mock("@/utils/crypto", () => ({
  DeviceCredentialUnavailableError: class extends Error {},
  decryptStoredSeedWithPin: jest.fn(),
  getAddressFromMnemonicAsync: jest.fn(),
}));
jest.mock("@/utils/nativeWalletMutation", () => ({
  walletMutations: {
    captureGeneration: jest.fn(),
    isCurrent: jest.fn(() => true),
  },
}));
jest.mock("@/utils/nativeApp", () => ({
  copyToClipboard: jest.fn(async () => true),
  openExternalUrl: jest.fn(),
  isInNativeApp: jest.fn(() => false),
  requestQRScan: jest.fn(),
  subscribeToNativeMessages: jest.fn(() => jest.fn()),
  triggerHaptic: jest.fn(),
}));
jest.mock("@/utils/formatting", () => ({
  getOptimalTokenBalance: (value: string) => value,
  formatAddress: (value: string) => value,
  formatAddressShort: (value: string) => value,
}));
jest.mock("@/utils/web3", () => ({
  fetchBalance: jest.fn(async () => 1000n),
  isValidQrlAddress: jest.fn(() => true),
}));
jest.mock("@theqrl/web3", () => ({
  utils: {
    fromPlanck: jest.fn(() => "0"),
  },
}));
jest.mock("../GasFeeNotice/GasFeeNotice", () => ({
  GasFeeNotice: ({ onFeeLevelChange }: { onFeeLevelChange: (level: string) => void }) => (
    <button type="button" onClick={() => onFeeLevelChange("high")}>Select high fee</button>
  ),
}));
jest.mock("../../AddressBook/AddressBookPicker", () => ({
  AddressBookPicker: () => null,
}));
jest.mock("../TransactionSuccessful/TransactionSuccessful", () => ({
  TransactionSuccessful: () => null,
}));
jest.mock("@/components/SEO/SEO", () => ({ SEO: () => null }));

const ACCOUNT = `Q${"1".repeat(128)}`;
const TOKEN_ADDRESS = `Q${"2".repeat(128)}`;
const RESOLVED_RECIPIENT = `Q${"3".repeat(128)}`;

const captureSubmission = jest.fn(() => ({
  input: "alice.qrl",
  address: RESOLVED_RECIPIENT,
  bindingKey: "alice-binding",
}));
const revalidateSubmission = jest.fn(() => RESOLVED_RECIPIENT);

function resolvedRecipient(): UseQrnsRecipientResult {
  return {
    status: "success",
    source: "qrns",
    input: "alice.qrl",
    normalizedName: "alice.qrl",
    address: RESOLVED_RECIPIENT,
    message: "alice.qrl resolved successfully.",
    bindingKey: "alice-binding",
    captureSubmission,
    revalidateSubmission,
  };
}

class MockResizeObserver implements ResizeObserver {
  constructor(_callback: ResizeObserverCallback) {}

  observe(_target: Element, _options?: ResizeObserverOptions): void {}

  unobserve(_target: Element): void {}

  disconnect(): void {}
}

beforeAll(() => {
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    value: MockResizeObserver,
  });
});

function nativeQuoteStore(estimateFee: jest.Mock) {
  const store = {
    qrlStore: {
      activeAccount: { accountAddress: ACCOUNT },
      getAccountBalance: jest.fn(() => "100"),
      signAndSendTransaction: jest.fn(),
      sendTransactionViaProvider: jest.fn(),
      activeAccountSource: "extension",
      qrlConnection: { blockchain: "TEST_NET" },
      transactionStatus: { state: "idle", txHash: null, receipt: null, error: null, pendingDetails: null },
      resetTransactionStatus: jest.fn(),
      estimateNativeTransferFee: estimateFee,
    },
    tokenStore: { visibleTokenList: [], sendToken: jest.fn() },
  };
  jest.mocked(useStore).mockReturnValue(store as never);
  jest.mocked(useLocation).mockReturnValue({ state: null } as never);
  jest.mocked(useSearchParams).mockReturnValue([new URLSearchParams(), jest.fn()]);
  jest.mocked(useNetworkQrnsRecipient).mockReturnValue(resolvedRecipient());
  return store;
}

describe("native Max fee composition", () => {
  it("invalidates Max-derived input when fees change and preserves manual input", async () => {
    const quote = jest.fn(async (level: string) => level === "high" ? "0.002" : "0.001");
    const store = nativeQuoteStore(quote);
    const view = render(<Transfer />);
    const max = view.getByRole("button", { name: "Max" }) as HTMLButtonElement;
    await waitFor(() => expect(max.disabled).toBe(false));
    await act(async () => { fireEvent.click(max); });
    expect((view.getByPlaceholderText("Enter amount") as HTMLInputElement).value).toBe("99.999");
    await act(async () => { fireEvent.click(view.getByRole("button", { name: "Select high fee" })); });
    expect((view.getByPlaceholderText("Enter amount") as HTMLInputElement).value).toBe("");
    await waitFor(() => expect(max.disabled).toBe(false));
    await act(async () => { fireEvent.click(max); });
    expect((view.getByPlaceholderText("Enter amount") as HTMLInputElement).value).toBe("99.998");
    await act(async () => {
      fireEvent.change(view.getByPlaceholderText("Enter amount"), { target: { value: "0.1" } });
    });
    store.qrlStore.qrlConnection.blockchain = "MAIN_NET";
    view.rerender(<Transfer />);
    await waitFor(() => expect(max.disabled).toBe(false));
    expect((view.getByPlaceholderText("Enter amount") as HTMLInputElement).value).toBe("0.1");
  });

  it("uses the verified fee reserve for Max", async () => {
    const quote = jest.fn(async () => "0.001");
    nativeQuoteStore(quote);
    const view = render(<Transfer />);
    const max = view.getByRole("button", { name: "Max" }) as HTMLButtonElement;
    expect(max.disabled).toBe(true);
    await waitFor(() => expect(max.disabled).toBe(false));
    expect(quote).toHaveBeenLastCalledWith("medium", {
      from: ACCOUNT, to: RESOLVED_RECIPIENT, value: "99.999",
    });
    await act(async () => { fireEvent.click(max); });
    expect((view.getByPlaceholderText("Enter amount") as HTMLInputElement).value).toBe("99.999");
  });

  it("keeps Max disabled after a quote failure while permitting manual amounts", async () => {
    const quote = jest.fn(async () => { throw new Error("offline"); });
    nativeQuoteStore(quote);
    const view = render(<Transfer />);
    await waitFor(() => expect(quote).toHaveBeenCalled());
    expect((view.getByRole("button", { name: "Max" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      fireEvent.change(view.getByPlaceholderText("Enter amount"), { target: { value: "0.1" } });
    });
    expect((view.getByPlaceholderText("Enter amount") as HTMLInputElement).value).toBe("0.1");
  });

  it("discards delayed old-network quotes", async () => {
    let finishOld!: (fee: string) => void;
    let finishNew!: (fee: string) => void;
    const oldQuote = new Promise<string>((resolve) => { finishOld = resolve; });
    const newQuote = new Promise<string>((resolve) => { finishNew = resolve; });
    const quote = jest.fn().mockReturnValueOnce(oldQuote).mockReturnValue(newQuote);
    const store = nativeQuoteStore(quote);
    const view = render(<Transfer />);
    store.qrlStore.qrlConnection.blockchain = "MAIN_NET";
    view.rerender(<Transfer />);
    await act(async () => { finishOld("0.001"); });
    const max = view.getByRole("button", { name: "Max" }) as HTMLButtonElement;
    expect(max.disabled).toBe(true);
    await act(async () => { finishNew("0.1"); });
    await waitFor(() => expect(max.disabled).toBe(false));
    await act(async () => { fireEvent.click(max); });
    expect((view.getByPlaceholderText("Enter amount") as HTMLInputElement).value).toBe("99.9");
  });

  it("shows the real store's reverted receipt as a failed transfer", async () => {
    nativeQuoteStore(jest.fn(async () => "0"));
    jest.useFakeTimers();
    const initialize = jest.spyOn(QrlStore.prototype, "initializeBlockchain").mockResolvedValue(undefined);
    const refresh = jest.spyOn(QrlStore.prototype, "fetchAccounts").mockResolvedValue(undefined);
    const store = new QrlStore();
    runInAction(() => {
      store.qrlConnection.blockchain = "TEST_NET";
      store.activeAccount.accountAddress = ACCOUNT;
      store._utils = { bytesToHex: (value: string) => value } as never;
      store.qrlInstance = { getTransactionReceipt: async () => ({ transactionHash: "0xreceipt", status: 0n }) } as never;
      store.transactionStatus = { state: "pending", txHash: "0xreceipt", receipt: null, error: null, pendingDetails: null };
    });
    jest.mocked(useStore).mockReturnValue({ qrlStore: store, tokenStore: { visibleTokenList: [] } } as never);
    try {
      const view = render(<Transfer />);
      await act(async () => {
        await store.pollForReceipt("0xreceipt");
        await jest.advanceTimersByTimeAsync(5000);
      });
      expect(view.getByText("Transaction Failed")).toBeTruthy();
      expect(view.getByText(/transfer was reverted/)).toBeTruthy();
    } finally {
      store.cancelReceiptPoller();
      refresh.mockRestore();
      initialize.mockRestore();
      jest.useRealTimers();
    }
  });
});

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

describe("Transfer QRNS recipient flow", () => {
  it.each([
    { asset: "native", expectedPath: "native", amount: "1", decimals: 18, raw: "1" },
    { asset: TOKEN_ADDRESS, expectedPath: "token", amount: "1", decimals: 18, raw: "1000000000000000000" },
    { asset: "native", expectedPath: "native", amount: "0.123456789012345678", decimals: 18, raw: "0.123456789012345678" },
    { asset: TOKEN_ADDRESS, expectedPath: "token", amount: "0.0000001", decimals: 18, raw: "100000000000" },
    { asset: TOKEN_ADDRESS, expectedPath: "token", amount: "0.123456789012345678", decimals: 18, raw: "123456789012345678" },
    { asset: TOKEN_ADDRESS, expectedPath: "token", amount: "9007199254740993", decimals: 0, raw: "9007199254740993" },
    { asset: TOKEN_ADDRESS, expectedPath: "token", amount: "max", decimals: 0, raw: "1000" },
    { asset: TOKEN_ADDRESS, expectedPath: "token", amount: "1.1", decimals: 0, raw: null },
  ])(
    "passes an exact $amount amount and resolved address to the $expectedPath transfer path",
    async ({ asset, expectedPath, amount, decimals, raw }) => {
      const sendTransactionViaProvider = jest.fn(async () => undefined);
      const sendToken = jest.fn(async () => true);
      const token = {
        address: TOKEN_ADDRESS,
        name: "QRNS Token",
        symbol: "QNS",
        decimals,
      };
      const mockStore = Object.assign(Object.create(null), {
        qrlStore: {
          activeAccount: { accountAddress: ACCOUNT },
          getAccountBalance: jest.fn(() => "100"),
          signAndSendTransaction: jest.fn(),
          sendTransactionViaProvider,
          activeAccountSource: "mobile",
          qrlConnection: { blockchain: "TEST_NET" },
          transactionStatus: {
            state: "idle",
            txHash: null,
            receipt: null,
            error: null,
            pendingDetails: null,
          },
          resetTransactionStatus: jest.fn(),
          estimateNativeTransferFee: jest.fn(async () => "0"),
        },
        tokenStore: {
          visibleTokenList: [token],
          sendToken,
        },
      });
      jest.mocked(useStore).mockReturnValue(mockStore);
      jest
        .mocked(useLocation)
        .mockReturnValue(Object.assign(Object.create(null), { state: null }));
      const searchParams: ReturnType<typeof useSearchParams> = [
        new URLSearchParams(`asset=${asset}`),
        jest.fn(),
      ];
      jest.mocked(useSearchParams).mockReturnValue(searchParams);
      jest.mocked(useNetworkQrnsRecipient).mockReturnValue(resolvedRecipient());
      Object.defineProperty(window, "scrollTo", {
        configurable: true,
        value: jest.fn(),
      });

      const view = render(<Transfer />);
      fireEvent.change(
        view.getByPlaceholderText("QIP-55 address or QNS name"),
        { target: { value: "alice.qrl" } },
      );
      if (amount === "max") {
        await waitFor(() => expect(view.getByText("Available: 1000")).toBeTruthy());
        fireEvent.click(view.getByRole("button", { name: "Max" }));
        expect((view.getByPlaceholderText("Enter amount") as HTMLInputElement).value).toBe("1000");
      } else {
        fireEvent.change(view.getByPlaceholderText("Enter amount"), {
          target: { value: amount },
        });
      }
      const submit = view.getByRole("button", {
        name: expectedPath === "native" ? "Send QRL" : "Send QNS",
      });
      if (raw === null) {
        await waitFor(() => expect(view.getByText("Enter an amount with at most 0 decimal places")).toBeTruthy());
        expect((submit as HTMLButtonElement).disabled).toBe(true);
        expect(sendToken).not.toHaveBeenCalled();
        return;
      }
      await waitFor(() =>
        expect((submit as HTMLButtonElement).disabled).toBe(false),
      );
      fireEvent.click(submit);

      if (expectedPath === "native") {
        await waitFor(() =>
          expect(sendTransactionViaProvider).toHaveBeenCalledWith(
            RESOLVED_RECIPIENT,
            raw,
            "medium",
          ),
        );
        expect(sendToken).not.toHaveBeenCalled();
      } else {
        await waitFor(() => expect(sendToken).toHaveBeenCalledTimes(1));
        expect(sendToken).toHaveBeenCalledWith(
          token,
          raw,
          "",
          RESOLVED_RECIPIENT,
        );
        expect(sendTransactionViaProvider).not.toHaveBeenCalled();
      }
      expect(captureSubmission).toHaveBeenCalledWith("alice.qrl");
      expect(revalidateSubmission).toHaveBeenCalledTimes(1);
    },
  );
});
