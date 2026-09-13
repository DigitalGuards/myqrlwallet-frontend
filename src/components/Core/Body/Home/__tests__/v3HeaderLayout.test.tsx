/** @jest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import Home from "../Home";

let mockV3Profile = false;

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
jest.mock("@/utils/nativeApp", () => ({ isInNativeApp: () => false }));
jest.mock("@/router/router", () => ({ ROUTES: {} }));
jest.mock("react-router", () => ({ Link: () => null }));
jest.mock("@/components/SEO/SEO", () => ({ SEO: () => null }));
jest.mock("../ConnectionFailed/ConnectionFailed", () => () => null);
jest.mock("../ConnectionBadge/ConnectionBadge", () => () => (
  <button>Network</button>
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

afterEach(cleanup);

function headerElements() {
  const logo = screen.getByRole("img", { name: "MyQRLWallet Logo" });
  const header = logo.parentElement;
  const badgeWrapper = screen.getByRole("button", {
    name: "Network",
  }).parentElement;
  if (!header || !badgeWrapper)
    throw new Error("Expected logo and badge layout containers");
  return { header, badgeWrapper };
}

it("places the v3 phone badge below the logo in normal flow and retains the desktop side position", () => {
  mockV3Profile = true;
  render(<Home />);
  const { header, badgeWrapper } = headerElements();
  expect(header.classList.contains("flex-col")).toBe(true);
  expect(header.classList.contains("gap-2")).toBe(true);
  expect(header.classList.contains("md:flex-row")).toBe(true);
  expect(badgeWrapper.classList.contains("absolute")).toBe(false);
  expect(badgeWrapper.classList.contains("order-1")).toBe(true);
  expect(badgeWrapper.classList.contains("md:absolute")).toBe(true);
  expect(badgeWrapper.classList.contains("md:order-none")).toBe(true);
});

it("preserves the default profile's existing centered logo and absolute left badge", () => {
  mockV3Profile = false;
  render(<Home />);
  const { header, badgeWrapper } = headerElements();
  expect(header.className).toBe(
    "relative flex w-full items-center justify-center px-4",
  );
  expect(badgeWrapper.className).toBe("absolute left-4");
});
