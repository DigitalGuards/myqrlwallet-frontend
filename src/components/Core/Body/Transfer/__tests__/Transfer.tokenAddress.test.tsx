/** @jest-environment jsdom */

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useLocation, useSearchParams } from "react-router";
import { observable, runInAction } from "mobx";
import { copyToClipboard } from "@/utils/nativeApp";
import type { TokenInterface } from "@/constants";
import { getExplorerAddressUrl } from "@/config";
import Transfer from "../Transfer";

jest.mock("react-router", () => ({
  useLocation: jest.fn(),
  useNavigate: jest.fn(() => jest.fn()),
  useSearchParams: jest.fn(),
}));
let mockStore: ReturnType<typeof fixture>;
jest.mock("@/stores/store", () => ({ useStore: () => mockStore }));
jest.mock("@/utils", () => ({
  log: jest.fn(),
  cn: (...values: unknown[]) => values.filter(Boolean).join(" "),
}));
jest.mock("@/router/router", () => ({
  ROUTES: { HOME: "/", IMPORT_ACCOUNT: "/import-account" },
}));
jest.mock("@/config", () => ({
  QRL_PROVIDER: { TEST_NET_V3: { url: "https://rpc.invalid" } },
  getExplorerAddressUrl: jest.fn(),
  getExplorerTxUrl: jest.fn(),
}));
jest.mock("@/desktop/bridge", () => ({ isDesktop: false }));
jest.mock("@/utils/storage", () => ({
  StorageUtil: { getBlockChain: jest.fn(() => Promise.resolve("TEST_NET_V3")) },
}));
jest.mock("@/utils/crypto", () => ({
  DeviceCredentialUnavailableError: class extends Error {},
  decryptStoredSeedWithPin: jest.fn(),
  getAddressFromMnemonicAsync: jest.fn(),
}));
jest.mock("@/utils/nativeWalletMutation", () => ({
  walletMutations: {},
}));
jest.mock("@/utils/nativeApp", () => ({
  copyToClipboard: jest.fn(() => Promise.resolve(true)),
  openExternalUrl: jest.fn(),
  isInNativeApp: jest.fn(() => false),
  requestQRScan: jest.fn(),
  subscribeToNativeMessages: jest.fn(() => jest.fn()),
  triggerHaptic: jest.fn(),
}));
jest.mock("@/utils/web3", () => ({
  fetchBalance: jest.fn(() => Promise.resolve(0n)),
  isValidQrlAddress: jest.fn(() => true),
}));
jest.mock("@theqrl/web3", () => ({ utils: {} }));
jest.mock("@/hooks/useNetworkQrnsRecipient", () => ({
  useNetworkQrnsRecipient: () => ({
    status: "empty",
    address: null,
    bindingKey: "empty-recipient",
  }),
}));
jest.mock("../GasFeeNotice/GasFeeNotice", () => ({
  GasFeeNotice: () => <div>Native fee notice</div>,
}));
jest.mock("../../AddressBook/AddressBookPicker", () => ({
  AddressBookPicker: () => null,
}));
jest.mock("../TransactionSuccessful/TransactionSuccessful", () => ({
  TransactionSuccessful: () => null,
}));
jest.mock("@/components/SEO/SEO", () => ({ SEO: () => null }));

const ACCOUNT = `Q${"1".repeat(128)}`;
const TOKENS: [TokenInterface, TokenInterface] = [
  {
    address: `Q${"2".repeat(128)}`,
    name: "First fixture token",
    symbol: "ONE",
    decimals: 18,
    amount: "0",
  },
  {
    address: `Q${"aB".repeat(64)}`,
    name: "Second fixture token",
    symbol: "TWO",
    decimals: 6,
    amount: "0",
  },
];

class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const previousResizeObserver = globalThis.ResizeObserver;
beforeAll(() => {
  globalThis.ResizeObserver = MockResizeObserver;
});
afterAll(() => {
  globalThis.ResizeObserver = previousResizeObserver;
});
afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

function fixture(asset: string, tokens: TokenInterface[] = TOKENS) {
  const store = {
    qrlStore: {
      activeAccount: { accountAddress: ACCOUNT },
      getAccountBalance: jest.fn(() => "0"),
      signAndSendTransaction: jest.fn(),
      sendTransactionViaProvider: jest.fn(),
      activeAccountSource: "seed",
      qrlConnection: { blockchain: "TEST_NET_V3" },
      transactionStatus: { state: "idle" },
      resetTransactionStatus: jest.fn(),
      estimateNativeTransferFee: jest.fn(),
    },
    tokenStore: observable(
      { visibleTokenList: tokens, sendToken: jest.fn() },
      undefined,
      { deep: false },
    ),
  };
  mockStore = store;
  jest.mocked(useLocation).mockReturnValue({
    state: null,
    key: "transfer",
    pathname: "/transfer",
    search: "",
    hash: "",
  });
  jest
    .mocked(useSearchParams)
    .mockReturnValue([new URLSearchParams({ asset }), jest.fn()]);
  return store;
}

it.each(TOKENS)(
  "shows and copies the exact full contract selected by the $symbol query",
  async (token) => {
    const store = fixture(token.address);
    await act(() => {
      render(<Transfer />);
      return Promise.resolve();
    });
    expect(screen.getByText("Token contract")).toBeTruthy();
    expect(screen.getByRole("combobox").textContent).toContain(token.symbol);
    const address = screen.getByLabelText(`QRL address ${token.address}`);
    expect(
      address.closest("[data-address-mode]")?.getAttribute("data-address-mode"),
    ).toBe("full");
    expect(address.textContent.replace(/\s/g, "")).toBe(token.address);
    expect(screen.queryByText("Native fee notice")).toBeNull();
    await act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Copy token contract address" }));
      return Promise.resolve();
    });
    expect(copyToClipboard).toHaveBeenCalledWith(token.address);
    expect(store.qrlStore.signAndSendTransaction).not.toHaveBeenCalled();
    expect(store.qrlStore.sendTransactionViaProvider).not.toHaveBeenCalled();
    expect(store.tokenStore.sendToken).not.toHaveBeenCalled();
  },
);

it("keeps the native transfer display without a token contract section", async () => {
  fixture("native");
  await act(() => {
    render(<Transfer />);
    return Promise.resolve();
  });
  expect(screen.getByRole("combobox").textContent).toContain("Quanta (Native)");
  expect(screen.getByText("Native fee notice")).toBeTruthy();
  expect(screen.getByLabelText(`QRL address ${ACCOUNT}`)).toBeTruthy();
  expect(screen.queryByText("Token contract")).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Copy token contract address" }),
  ).toBeNull();
});

it.each([
  ["", false],
  ["https://explorer.invalid/address/value", true],
])(
  "shows View on Explorer only for a network with an explorer (%p)",
  async (url, shown) => {
    jest.mocked(getExplorerAddressUrl).mockReturnValue(url);
    fixture("native");
    await act(() => {
      render(<Transfer />);
      return Promise.resolve();
    });
    expect(
      screen.queryByRole("button", { name: "View on Explorer" }) !== null,
    ).toBe(shown);
    expect(getExplorerAddressUrl).toHaveBeenCalledWith(ACCOUNT, "TEST_NET_V3");
  },
);

it("waits for the selected token record and removes its contract when unavailable", async () => {
  const token = TOKENS[0];
  const store = fixture(token.address, []);
  const view = render(<Transfer />);
  expect(screen.queryByText("Token contract")).toBeNull();
  await act(() => {
    runInAction(() => {
      store.tokenStore.visibleTokenList = [token];
    });
    view.rerender(<Transfer />);
    return Promise.resolve();
  });
  expect(screen.getByLabelText(`QRL address ${token.address}`)).toBeTruthy();
  await act(() => {
    runInAction(() => {
      store.tokenStore.visibleTokenList = [];
    });
    view.rerender(<Transfer />);
    return Promise.resolve();
  });
  expect(screen.queryByText("Token contract")).toBeNull();
  expect(screen.queryByLabelText(`QRL address ${token.address}`)).toBeNull();
});

it("keeps the amount as typed and refuses a comma or an oversized amount", async () => {
  fixture("native");
  await act(() => {
    render(<Transfer />);
    return Promise.resolve();
  });
  const amount = screen.getByPlaceholderText("Enter amount");
  if (!(amount instanceof HTMLInputElement)) throw new Error("Missing amount input");
  const comma = "Use a dot (.) for decimals, without thousands separators";
  fireEvent.change(amount, { target: { value: "1,000" } });
  // A pasted "1,000" stays as typed and is refused, never signed as 1.
  expect(amount.value).toBe("1,000");
  expect(await screen.findByText(comma)).toBeTruthy();
  fireEvent.change(amount, { target: { value: "1.5" } });
  await waitFor(() => {
    expect(screen.queryByText(comma)).toBeNull();
  });
  // A comma keypad's single decimal comma is read as a decimal mark.
  fireEvent.change(amount, { target: { value: "1,5" } });
  expect(amount.value).toBe("1,5");
  expect(screen.queryByText(comma)).toBeNull();
  for (const grouped of ["12,345", "1,000.5"]) {
    fireEvent.change(amount, { target: { value: "2" } });
    await waitFor(() => {
      expect(screen.queryByText(comma)).toBeNull();
    });
    fireEvent.change(amount, { target: { value: grouped } });
    expect(await screen.findByText(comma)).toBeTruthy();
  }
  fireEvent.change(amount, { target: { value: "9".repeat(101) } });
  expect(await screen.findByText("This amount is too large")).toBeTruthy();
});
