/** @jest-environment jsdom */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import axios from "axios";
import { OtherAccounts } from "../OtherAccounts/OtherAccounts";
import { ActiveAccount } from "../ActiveAccount/ActiveAccount";
import { TransactionHistoryPopup } from "../ActiveAccount/TransactionHistoryPopup";
import QRView from "../../QRView/QRView";
import AccountImportSuccess from "../../ImportAccount/AccountImportSuccess/AccountImportSuccess";
import { FooterLinks } from "@/components/Core/Layout/Footer";

// A network may have no explorer (an optional mainnet setting). The helpers
// then return "" and every control that would open or encode it stays hidden.
let mockExplorer = "";
const mockAddress = `Q${"12".repeat(64)}`;
const mockOther = `Q${"34".repeat(64)}`;
let mockActiveNetwork: { explorer: string } | undefined;
const mockStore = {
  qrlStore: {
    activeAccount: { accountAddress: mockAddress },
    activeAccountSource: "seed",
    qrlAccounts: {
      accounts: [
        { accountAddress: mockAddress, source: "seed" },
        { accountAddress: mockOther, source: "seed" },
      ],
    },
    qrlConnection: { blockchain: "TEST_NET" },
    get activeNetwork() {
      return mockActiveNetwork;
    },
  },
};

jest.mock("axios");
jest.mock("@/stores/store", () => ({ useStore: () => mockStore }));
jest.mock("mobx-react-lite", () => ({
  observer: (component: unknown) => component,
}));
jest.mock("@/config", () => ({
  SERVER_URL: "https://wallet.example/api",
  EXPLORER_BASE: "https://build-explorer.example",
  getExplorerAddressUrl: (address: string) =>
    mockExplorer ? `${mockExplorer}/address/${address}` : "",
  getExplorerTxUrl: (hash: string) =>
    mockExplorer ? `${mockExplorer}/tx/${hash}` : "",
}));
jest.mock("@/router/router", () => ({
  ROUTES: {
    HOME: "/",
    TRANSFER: "/transfer",
    PRIVACY: "/privacy",
    TERMS: "/terms",
    LEGAL: "/legal",
  },
}));
jest.mock("react-router", () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));
jest.mock("@/components/Core/Layout/PageShell", () => ({
  PageShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
jest.mock("@/components/UI/QrlAddress", () => ({
  QrlAddress: () => null,
  CompactAddressText: ({ address }: { address: string }) => address,
}));
jest.mock("@/utils/nativeApp", () => ({
  openExternalUrl: jest.fn(),
  copyToClipboard: jest.fn(() => Promise.resolve(true)),
}));
jest.mock("@/utils/mobileConnect/mobileConnection", () => ({
  disconnectMobile: jest.fn(),
}));
jest.mock("@/utils", () => ({
  cn: (...values: unknown[]) => values.filter(Boolean).join(" "),
}));
jest.mock("../AccountId/AccountId", () => ({ AccountId: () => null }));
jest.mock("../AccountBalance/AccountBalance", () => ({
  AccountBalance: () => null,
}));
jest.mock("../CopyAddressButton/CopyAddressButton", () => ({
  CopyAddressButton: () => null,
}));

const post = jest.spyOn(axios, "post");
const historyRow = {
  ID: "row",
  InOut: 1,
  TxType: "0x2",
  Address: mockAddress,
  From: mockOther,
  To: mockAddress,
  TxHash: "0xabc",
  TimeStamp: "0x1",
  Amount: "1",
  BlockNumber: "0x1",
};

beforeEach(() => {
  mockExplorer = "";
  mockActiveNetwork = undefined;
  mockStore.qrlStore.qrlConnection.blockchain = "TEST_NET";
});
afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

describe.each([
  ["without an explorer", "", false],
  ["with an explorer", "https://explorer.example", true],
])("account explorer controls %s", (_label, explorer, shown) => {
  beforeEach(() => {
    mockExplorer = explorer;
  });

  it("shows the active account's explorer button and QR code only with a URL", () => {
    const view = render(<ActiveAccount />);
    expect(
      view.container.querySelector("button:has(.lucide-external-link)") !==
        null,
    ).toBe(shown);
    expect(screen.queryByText("Scan to open in Explorer") !== null).toBe(shown);
  });

  it("shows another account's explorer button only with a URL", () => {
    const view = render(<OtherAccounts />);
    expect(
      view.container.querySelector("button:has(.lucide-external-link)") !==
        null,
    ).toBe(shown);
  });

  it("encodes the explorer URL in the QR page only when there is one", () => {
    const view = render(<QRView />);
    expect(view.container.querySelector("svg") !== null).toBe(shown);
    expect(screen.queryByText("Scan to open in Explorer") !== null).toBe(shown);
  });

  it("offers View on Explorer after an import only with a URL", () => {
    render(
      <AccountImportSuccess account={{ address: mockAddress }} />,
    );
    expect(
      screen.queryByRole("button", { name: "View on Explorer" }) !== null,
    ).toBe(shown);
  });

  it("links history rows and View All only with a URL, and keeps the rows", async () => {
    post.mockResolvedValueOnce({ data: { transactions: [historyRow] } });
    render(
      <TransactionHistoryPopup
        accountAddress={mockAddress}
        blockchain="TEST_NET"
        isOpen
        onClose={jest.fn()}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText("0xabc")).toBeTruthy();
    });
    // The row keeps its content either way; only the link goes.
    expect(screen.getByText("0xabc").closest("button") !== null).toBe(shown);
    expect(
      screen.queryByRole("button", { name: "View All in Explorer" }) !== null,
    ).toBe(shown);
  });
});

describe("footer explorer link", () => {
  function explorerLink(): string | null {
    return (
      screen.queryByRole("link", { name: "Explorer" })?.getAttribute("href") ??
      null
    );
  }

  it("follows the active network's explorer", () => {
    mockActiveNetwork = { explorer: "https://mainnet.example" };
    render(<FooterLinks />);
    expect(explorerLink()).toBe("https://mainnet.example");
  });

  it("hides the link on a network without an explorer", () => {
    mockActiveNetwork = { explorer: "" };
    render(<FooterLinks />);
    expect(explorerLink()).toBeNull();
  });

  it("uses the build's starting network before the wallet connects", () => {
    render(<FooterLinks />);
    expect(explorerLink()).toBe("https://build-explorer.example");
  });
});
