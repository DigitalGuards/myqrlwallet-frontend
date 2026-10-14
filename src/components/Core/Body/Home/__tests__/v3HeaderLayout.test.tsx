/** @jest-environment jsdom */

// Layout C: the home screen no longer carries its own centred logo/wordmark
// (the mark lives in the sidebar rail on desktop and the Layout top bar on
// mobile instead) or a network selector pill. This covers what remains of
// the header row: the native QR-scan affordance and the plain network
// status label, identically for both runtime profiles.

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import Home from "../Home";
import { logger } from "@/utils/log";

const logError = jest.spyOn(logger, "error");

let mockV3Profile = false;
let mockInNativeApp = false;
let mockAddress = "";
const mockSettings = jest.fn(() => Promise.resolve({ showTokensCard: true, showNftsCard: true }));
const mockAccounts = jest.fn(() => Promise.resolve());
const mockTokens = jest.fn(() => Promise.resolve());
const mockPrice = jest.fn(() => Promise.resolve());
jest.mock("@/utils/log", () => ({ logger: { error: jest.fn() } }));

jest.mock("@/config/runtimeProfile", () => ({
  get IS_V3_PROFILE() {
    return mockV3Profile;
  },
}));
jest.mock("@/stores/store", () => ({
  useStore: () => ({
    qrlStore: {
      qrlConnection: {
        isLoading: true,
        isConnected: false,
        blockchain: "TEST_NET_V3",
      },
      activeAccount: { accountAddress: mockAddress },
      fetchAccounts: mockAccounts,
      fetchQrlPrice: mockPrice,
    },
    tokenStore: { refreshTokenBalances: mockTokens },
  }),
}));
jest.mock("mobx-react-lite", () => ({
  observer: (component: unknown) => component,
}));
jest.mock("@/utils/react", () => ({ withSuspense: () => () => null }));
jest.mock("@/utils", () => ({
  cn: (...values: unknown[]) => values.filter(Boolean).join(" "),
}));
jest.mock("@/utils/storage", () => ({
  StorageUtil: {
    getWalletSettings: () => mockSettings(),
  },
  STORAGE_EVENT_WALLET_SETTINGS: "test:wallet-settings-changed",
}));
jest.mock("@/utils/nativeApp", () => ({
  isInNativeApp: () => mockInNativeApp,
  requestQRScan: jest.fn(),
}));
jest.mock("@/router/router", () => ({ ROUTES: {} }));
jest.mock("react-router", () => ({ Link: () => null }));
jest.mock("@/components/SEO/SEO", () => ({ SEO: () => null }));
jest.mock("../ConnectionFailed/ConnectionFailed", () => () => null);
jest.mock("../ConnectionBadge/ConnectionBadge", () => () => (
  <span>Network status</span>
));
jest.mock("../BackgroundVideo/BackgroundVideo", () => () => null);
jest.mock(
  "../AccountCreateImport/ActiveAccountDisplay/ActiveAccountDisplay",
  () => ({ ActiveAccountDisplay: () => null }),
);
jest.mock("../../AccountList/ActiveAccount/TransactionHistoryPopup", () => ({
  TransactionHistoryPopup: () => null,
}));
jest.mock("../ReceivePopup", () => ({ ReceivePopup: () => null }));

beforeEach(() => {
  jest.clearAllMocks();
  mockAddress = "";
  mockV3Profile = false;
  mockInNativeApp = false;
});
afterEach(cleanup);

it("reports settings failures on mount and after a settings event", async () => {
  const error = new Error("Settings unavailable");
  mockSettings.mockRejectedValueOnce(error).mockRejectedValueOnce(error);
  render(<Home />);
  await waitFor(() => {
    expect(logError).toHaveBeenCalledTimes(1);
  });
  window.dispatchEvent(new Event("test:wallet-settings-changed"));
  await waitFor(() => {
    expect(logError).toHaveBeenCalledTimes(2);
  });
  expect(logError).toHaveBeenCalledWith("Failed to load wallet settings:", error);
});

it("starts every refresh independently and contains each rejection", async () => {
  jest.useFakeTimers();
  mockAddress = "active";
  const error = new Error("Network unavailable");
  for (const request of [mockAccounts, mockTokens, mockPrice]) {
    request.mockRejectedValueOnce(error);
  }
  try {
    render(<Home />);
    expect(mockAccounts).toHaveBeenCalledTimes(1);
    expect(mockTokens).toHaveBeenCalledTimes(1);
    expect(mockPrice).toHaveBeenCalledTimes(1);
    await act(async () => {
      await Promise.resolve();
    });
    expect(logError).toHaveBeenCalledTimes(3);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(30000);
    });
    expect(mockAccounts).toHaveBeenCalledTimes(2);
    expect(mockTokens).toHaveBeenCalledTimes(2);
    expect(mockPrice).toHaveBeenCalledTimes(2);
    cleanup();
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    jest.useRealTimers();
  }
});

it("no longer renders the old centered logo image, in either profile", () => {
  render(<Home />);
  expect(screen.queryByRole("img", { name: "MyQRLWallet Logo" })).toBeNull();
  mockV3Profile = true;
  render(<Home />);
  expect(screen.queryByRole("img", { name: "MyQRLWallet Logo" })).toBeNull();
});

it("renders the plain network status label instead of a selector pill", () => {
  render(<Home />);
  expect(screen.getByText("Network status")).toBeTruthy();
});

it("hides the native QR-scan button outside the native app", () => {
  mockInNativeApp = false;
  render(<Home />);
  expect(screen.queryByRole("button", { name: "Scan QR code" })).toBeNull();
});

it("shows the native QR-scan button inside the native app, identically for both profiles", () => {
  mockInNativeApp = true;
  render(<Home />);
  expect(screen.getByRole("button", { name: "Scan QR code" })).toBeTruthy();
  cleanup();
  mockV3Profile = true;
  render(<Home />);
  expect(screen.getByRole("button", { name: "Scan QR code" })).toBeTruthy();
});
