/** @jest-environment jsdom */

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { useLocation, useSearchParams } from "react-router";
import { observable, runInAction } from "mobx";
import { useStore } from "@/stores/store";
import { copyToClipboard } from "@/utils/nativeApp";
import type { TokenInterface } from "@/constants";
import Transfer from "../Transfer";

jest.mock("react-router", () => ({
  useLocation: jest.fn(),
  useNavigate: jest.fn(() => jest.fn()),
  useSearchParams: jest.fn(),
}));
jest.mock("@/stores/store", () => ({ useStore: jest.fn() }));
jest.mock("@/utils", () => ({
  log: jest.fn(),
  cn: (...values: unknown[]) => values.filter(Boolean).join(" "),
}));
jest.mock("@/router/router", () => ({
  ROUTES: { HOME: "/", IMPORT_ACCOUNT: "/import-account" },
}));
jest.mock("@/config", () => ({
  QRL_PROVIDER: { TEST_NET_V3: { url: "http://127.0.0.1:9" } },
  getExplorerAddressUrl: jest.fn(),
  getExplorerTxUrl: jest.fn(),
}));
jest.mock("@/desktop/bridge", () => ({ isDesktop: false }));
jest.mock("@/utils/storage", () => ({
  StorageUtil: { getBlockChain: jest.fn(async () => "TEST_NET_V3") },
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
  copyToClipboard: jest.fn(async () => true),
  openExternalUrl: jest.fn(),
  isInNativeApp: jest.fn(() => false),
  requestQRScan: jest.fn(),
  subscribeToNativeMessages: jest.fn(() => jest.fn()),
  triggerHaptic: jest.fn(),
}));
jest.mock("@/utils/web3", () => ({
  fetchBalance: jest.fn(async () => 0n),
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
  jest.mocked(useStore).mockReturnValue(store as never);
  jest.mocked(useLocation).mockReturnValue({ state: null } as never);
  jest
    .mocked(useSearchParams)
    .mockReturnValue([new URLSearchParams({ asset }), jest.fn()]);
  return store;
}

it.each(TOKENS)(
  "shows and copies the exact full contract selected by the $symbol query",
  async (token) => {
    const store = fixture(token.address);
    await act(async () => {
      render(<Transfer />);
    });
    expect(screen.getByText("Token contract")).toBeTruthy();
    expect(screen.getByRole("combobox").textContent).toContain(token.symbol);
    const address = screen.getByLabelText(`QRL address ${token.address}`);
    expect(
      address.closest("[data-address-mode]")?.getAttribute("data-address-mode"),
    ).toBe("full");
    expect(address.textContent?.replace(/\s/g, "")).toBe(token.address);
    expect(screen.queryByText("Native fee notice")).toBeNull();
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Copy token contract address" }),
      );
    });
    expect(copyToClipboard).toHaveBeenCalledWith(token.address);
    expect(store.qrlStore.signAndSendTransaction).not.toHaveBeenCalled();
    expect(store.qrlStore.sendTransactionViaProvider).not.toHaveBeenCalled();
    expect(store.tokenStore.sendToken).not.toHaveBeenCalled();
  },
);

it("keeps the native transfer display without a token contract section", async () => {
  fixture("native");
  await act(async () => {
    render(<Transfer />);
  });
  expect(screen.getByRole("combobox").textContent).toContain("Quanta (Native)");
  expect(screen.getByText("Native fee notice")).toBeTruthy();
  expect(screen.getByLabelText(`QRL address ${ACCOUNT}`)).toBeTruthy();
  expect(screen.queryByText("Token contract")).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Copy token contract address" }),
  ).toBeNull();
});

it("waits for the selected token record and removes its contract when unavailable", async () => {
  const token = TOKENS[0];
  const store = fixture(token.address, []);
  const view = render(<Transfer />);
  expect(screen.queryByText("Token contract")).toBeNull();
  await act(async () => {
    runInAction(() => {
      store.tokenStore.visibleTokenList = [token];
    });
    view.rerender(<Transfer />);
  });
  expect(screen.getByLabelText(`QRL address ${token.address}`)).toBeTruthy();
  await act(async () => {
    runInAction(() => {
      store.tokenStore.visibleTokenList = [];
    });
    view.rerender(<Transfer />);
  });
  expect(screen.queryByText("Token contract")).toBeNull();
  expect(screen.queryByLabelText(`QRL address ${token.address}`)).toBeNull();
});
