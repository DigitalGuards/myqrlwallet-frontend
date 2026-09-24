/** @jest-environment jsdom */

// Layout C: the home screen no longer carries its own centred logo/wordmark
// (the mark lives in the sidebar rail on desktop and the Layout top bar on
// mobile instead) or a network selector pill. This covers what remains of
// the header row: the native QR-scan affordance and the plain network
// status label, identically for both runtime profiles.

import { cleanup, render, screen } from "@testing-library/react";
import Home from "../Home";

let mockV3Profile = false;
let mockInNativeApp = false;

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
      activeAccount: { accountAddress: "" },
    },
    tokenStore: {},
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
    getWalletSettings: async () => ({
      showTokensCard: true,
      showNftsCard: true,
    }),
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
  mockV3Profile = false;
  mockInNativeApp = false;
});
afterEach(cleanup);

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
