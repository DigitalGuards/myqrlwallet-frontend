/** @jest-environment jsdom */
import {
  fakeHistory,
  fakeRouterModule as mockRouterModule,
} from "@/test-utils/fakeRouterHistory";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { ROUTES, type RoutePath } from "@/router/routes";
import { resetNativeBackForTests } from "@/utils/nativeBack";
import AccountList from "@/components/Core/Body/AccountList/AccountList";
import AddAccount from "@/components/Core/Body/AddAccount/AddAccount";
import AddressBook from "@/components/Core/Body/AddressBook/AddressBook";
import CreateAccount from "@/components/Core/Body/CreateAccount/CreateAccount";
import CreateToken from "@/components/Core/Body/CreateToken/CreateToken";
import TokenStatus from "@/components/Core/Body/CreateToken/TokenStatus";
import DAppSessionsPage from "@/components/Core/Body/DAppConnect/DAppSessionsPage";
import Disclaimer from "@/components/Core/Body/Disclaimer/Disclaimer";
import Home from "@/components/Core/Body/Home/Home";
import ImportAccount from "@/components/Core/Body/ImportAccount/ImportAccount";
import Legal from "@/components/Core/Body/Legal/Legal";
import NftDetail from "@/components/Core/Body/Nfts/NftDetail";
import Privacy from "@/components/Core/Body/Privacy/Privacy";
import QRView from "@/components/Core/Body/QRView/QRView";
import Security from "@/components/Core/Body/Security/Security";
import DesktopSettings from "@/components/Core/Body/Settings/DesktopSettings";
import Settings from "@/components/Core/Body/Settings/Settings";
import Terms from "@/components/Core/Body/Terms/Terms";
import TransactionHistory from "@/components/Core/Body/TransactionHistory/TransactionHistory";
import Transfer from "@/components/Core/Body/Transfer/Transfer";

/**
 * Every page the router shows, rendered as the router shows it, with the
 * real Back. A sub-page shows Back, and on a fresh load Back takes the
 * page's own parent; a menu destination shows none. PageShell is reduced to
 * its title and its Back slot, so the page bodies stay out of the test.
 */

jest.mock("react-router", () => ({
  ...mockRouterModule(),
  Link: ({ children }: { children?: ReactNode }) => children,
}));
jest.mock("@/components/Core/Layout/PageShell", () => ({
  PageShell: ({ title, back }: { title: ReactNode; back?: ReactNode }) => (
    <section>
      <h1>{title}</h1>
      {back}
    </section>
  ),
}));
jest.mock("@/router/router", () => ({
  ROUTES: jest.requireActual<typeof import("@/router/routes")>(
    "@/router/routes",
  ).ROUTES,
}));
// The network table reads Vite's import.meta, which jest cannot load.
jest.mock("@/config/networks", () => {
  const network = {
    id: "TEST_NET",
    name: "QRL 2.0 Testnet",
    url: "https://rpc.example",
    explorer: "https://explorer.example",
  };
  return {
    QRL_PROVIDER: { TEST_NET: network },
    AVAILABLE_NETWORKS: [network],
    DEFAULT_NETWORK_ID: "TEST_NET",
    isAvailableNetwork: (id: string) => id === "TEST_NET",
    TOKEN_FACTORY_ADDRESS: "",
    EXPLORER_BASE: "https://explorer.example",
    SERVER_URL: "https://wallet.example/api",
    getNetworkConfig: () => network,
    getExplorerAddressUrl: () => "https://explorer.example/address",
    getExplorerTxUrl: () => "https://explorer.example/tx",
    getTokenDiscoveryApiUrl: () => "",
    getNFTDiscoveryApiUrl: () => "",
  };
});
// The wallet's crypto encodes text as it loads; jsdom has no encoder.
jest.mock("@/utils/crypto/walletEncryption", () => {
  const { TextEncoder, TextDecoder } =
    jest.requireActual<typeof import("node:util")>("node:util");
  Object.defineProperty(globalThis, "TextEncoder", {
    configurable: true,
    value: TextEncoder,
  });
  Object.defineProperty(globalThis, "TextDecoder", {
    configurable: true,
    value: TextDecoder,
  });
  return jest.requireActual<
    typeof import("@/utils/crypto/walletEncryption")
  >("@/utils/crypto/walletEncryption");
});
// Vite's worker import cannot load in jest. Nothing here encrypts.
jest.mock("@/utils/crypto/cryptoWorkerClient", () => ({
  CryptoErrorCode: {
    INCORRECT_PIN: "INCORRECT_PIN",
    INVALID_DATA: "INVALID_DATA",
    OUTDATED_FORMAT: "OUTDATED_FORMAT",
    DEVICE_CREDENTIAL_UNAVAILABLE: "DEVICE_CREDENTIAL_UNAVAILABLE",
    DECRYPT_FAILED: "DECRYPT_FAILED",
    UNKNOWN: "UNKNOWN",
  },
  CryptoOperationError: class extends Error {},
  encryptSeedAsync: jest.fn(),
  decryptSeedAsync: jest.fn(),
  decryptStoredSeedAsync: jest.fn(),
  verifyStoredSeedPinAsync: jest.fn(),
  reEncryptSeedAsync: jest.fn(),
  decryptKeystoreAsync: jest.fn(),
  deriveHexSeedAsync: jest.fn(),
  terminateCryptoWorker: jest.fn(),
}));
jest.mock("@/utils", () => ({
  cn: jest.requireActual<typeof import("@/utils/cn")>("@/utils/cn").cn,
  log: jest.fn(),
}));
jest.mock("@/utils/logout", () => ({ handleLogout: jest.fn() }));
jest.mock("@/components/SEO/SEO", () => ({ SEO: () => null }));
jest.mock("mobx-react-lite", () => ({
  observer: (component: unknown) => component,
}));

const mockContract = `Q${"ab".repeat(64)}`;
let mockAccount = "";
let mockDesktop = false;
let mockInApp = false;
let mockNfts: unknown[] = [];
const mockStore = {
  qrlStore: {
    get activeAccount() {
      return { accountAddress: mockAccount };
    },
    activeAccountSource: "seed",
    qrlConnection: {
      blockchain: "TEST_NET",
      isConnected: true,
      isLoading: false,
    },
    qrlInstance: undefined,
    transactionStatus: { state: "idle" },
    getAccountBalance: () => "0",
    resetTransactionStatus: jest.fn(),
    fetchAccounts: jest.fn(() => Promise.resolve()),
    fetchQrlPrice: jest.fn(() => Promise.resolve()),
    setActiveAccount: jest.fn(() => Promise.resolve()),
    estimateNativeTransferFee: jest.fn(() => Promise.resolve("0")),
  },
  tokenStore: {
    visibleTokenList: [],
    creatingToken: { creating: false, error: "", txHash: "", txUrl: "" },
    createdToken: {
      name: "",
      symbol: "",
      decimals: 18,
      address: "",
      tx: "",
      blockNumber: "",
      blockHash: "",
      gasUsed: "0",
      effectiveGasPrice: "0",
    },
    addToken: jest.fn(() => Promise.resolve()),
    createToken: jest.fn(() => Promise.resolve()),
    refreshTokenBalances: jest.fn(() => Promise.resolve()),
  },
  nftStore: {
    get nftList() {
      return mockNfts;
    },
  },
  dappConnectStore: {
    activeSessions: [],
    sessionCount: 0,
    disconnectAll: jest.fn(),
  },
};
jest.mock("@/stores/store", () => ({ useStore: () => mockStore }));
jest.mock("@/desktop/bridge", () => ({
  get isDesktop() {
    return mockDesktop;
  },
  desktopSigner: { openDesktopSettings: jest.fn(() => Promise.resolve()) },
}));
jest.mock("@/utils/nativeApp", () => ({
  isInNativeApp: () => mockInApp,
  copyToClipboard: jest.fn(() => Promise.resolve(true)),
  openExternalUrl: jest.fn(),
  requestQRScan: jest.fn(),
  subscribeToNativeMessages: jest.fn(() => () => undefined),
  triggerHaptic: jest.fn(),
}));
jest.mock("@/hooks/useWalletLimit", () => ({
  useWalletLimit: () => ({
    isWalletLimitReached: false,
    walletCount: 0,
    maxWallets: 10,
  }),
}));
jest.mock("@/hooks/useTransactionHistory", () => ({
  useTransactionHistory: () => ({ transactions: [], storageUnavailable: false }),
}));
jest.mock("@/hooks/useNetworkQrnsRecipient", () => ({
  useNetworkQrnsRecipient: () => ({
    status: "idle",
    source: null,
    input: "",
    normalizedName: null,
    address: null,
    message: null,
    bindingKey: "",
    captureSubmission: () => null,
    revalidateSubmission: () => null,
  }),
}));
jest.mock("axios", () => ({
  post: () => Promise.resolve({ data: { transactions: [] } }),
  isAxiosError: () => false,
}));
jest.mock("@/utils/storage", () => ({
  ...jest.requireActual<typeof import("@/utils/storage")>("@/utils/storage"),
  StorageUtil: {
    getWalletSettings: () =>
      Promise.resolve({
        autoLockTimeout: 900000,
        showTokensCard: true,
        showNftsCard: true,
      }),
    setWalletSettings: () => Promise.resolve(),
    hasEncryptedSeeds: () => Promise.resolve(false),
    getBlockChain: () => Promise.resolve("TEST_NET"),
  },
}));

/** One way the router shows a page. */
interface PageRow {
  readonly route: RoutePath;
  readonly page: ComponentType;
  /** Where the router shows it. */
  readonly path: string;
  /** Where Back lands on a fresh load, or null for a page with no Back. */
  readonly parent: string | null;
  /** The wallet holds an account. */
  readonly hasWallet?: boolean;
  readonly platform?: "web" | "desktop" | "app";
  /** The NFTs the wallet holds. */
  readonly nfts?: readonly unknown[];
}

const nftPath = `/nft/${mockContract}/7`;
const heldNft = {
  contractAddress: mockContract,
  standard: "ERC721",
  tokenId: "7",
  name: "Seven",
};

const ROWS: readonly PageRow[] = [
  // Menu destinations: the menu is their navigation.
  { route: ROUTES.HOME, page: Home, path: "/", parent: null },
  { route: ROUTES.HOME, page: Home, path: "/", parent: null, hasWallet: true },
  {
    route: ROUTES.ACCOUNT_LIST,
    page: AccountList,
    path: "/account-list",
    parent: null,
  },
  { route: ROUTES.TRANSFER, page: Transfer, path: "/transfer", parent: null },
  {
    route: ROUTES.ADDRESS_BOOK,
    page: AddressBook,
    path: "/address-book",
    parent: null,
  },
  { route: ROUTES.SETTINGS, page: Settings, path: "/settings", parent: null },
  {
    route: ROUTES.SETTINGS,
    page: DesktopSettings,
    path: "/settings",
    parent: null,
    platform: "desktop",
  },
  // The desktop sidebar lists the dApp connections.
  {
    route: ROUTES.DAPP_SESSIONS,
    page: DAppSessionsPage,
    path: "/dapp-sessions",
    parent: null,
    platform: "desktop",
  },

  // Sub-pages.
  {
    route: ROUTES.DAPP_SESSIONS,
    page: DAppSessionsPage,
    path: "/dapp-sessions",
    parent: ROUTES.SETTINGS,
  },
  {
    route: ROUTES.DAPP_SESSIONS,
    page: DAppSessionsPage,
    path: "/dapp-sessions",
    parent: ROUTES.HOME,
    platform: "app",
  },
  {
    route: ROUTES.CREATE_ACCOUNT,
    page: CreateAccount,
    path: "/create-account",
    parent: ROUTES.HOME,
  },
  {
    route: ROUTES.CREATE_ACCOUNT,
    page: CreateAccount,
    path: "/create-account",
    parent: ROUTES.ACCOUNT_LIST,
    hasWallet: true,
  },
  {
    route: ROUTES.IMPORT_ACCOUNT,
    page: ImportAccount,
    path: "/import-account",
    parent: ROUTES.HOME,
  },
  {
    route: ROUTES.IMPORT_ACCOUNT,
    page: ImportAccount,
    path: "/import-account",
    parent: ROUTES.ACCOUNT_LIST,
    hasWallet: true,
  },
  {
    route: ROUTES.ADD_ACCOUNT,
    page: AddAccount,
    path: "/add-account",
    parent: ROUTES.ACCOUNT_LIST,
    hasWallet: true,
  },
  {
    route: ROUTES.CREATE_TOKEN,
    page: CreateToken,
    path: "/create-token",
    parent: ROUTES.HOME,
    hasWallet: true,
  },
  {
    route: ROUTES.TOKEN_STATUS,
    page: TokenStatus,
    path: "/token-status",
    parent: ROUTES.HOME,
    hasWallet: true,
  },
  {
    route: ROUTES.QR_VIEW,
    page: QRView,
    path: "/qr-view",
    parent: ROUTES.HOME,
    hasWallet: true,
  },
  {
    route: ROUTES.TRANSACTION_HISTORY,
    page: TransactionHistory,
    path: "/tx-history",
    parent: ROUTES.HOME,
    hasWallet: true,
  },
  // The NFT page narrows its parent to the open collection.
  {
    route: ROUTES.NFT_DETAIL,
    page: NftDetail,
    path: nftPath,
    parent: `/?collection=${mockContract.toLowerCase()}`,
    hasWallet: true,
    nfts: [heldNft],
  },
  {
    route: ROUTES.NFT_DETAIL,
    page: NftDetail,
    path: nftPath,
    parent: ROUTES.HOME,
    hasWallet: true,
  },
  { route: ROUTES.TERMS, page: Terms, path: "/terms", parent: ROUTES.HOME },
  {
    route: ROUTES.PRIVACY,
    page: Privacy,
    path: "/privacy",
    parent: ROUTES.HOME,
  },
  { route: ROUTES.LEGAL, page: Legal, path: "/legal", parent: ROUTES.HOME },
  {
    route: ROUTES.DISCLAIMER,
    page: Disclaimer,
    path: "/disclaimer",
    parent: ROUTES.LEGAL,
  },
  {
    route: ROUTES.SECURITY,
    page: Security,
    path: "/security",
    parent: ROUTES.LEGAL,
  },
];

/** Routes outside the wallet layout, with no PageShell and no Back. */
const OUTSIDE: readonly RoutePath[] = [
  // The Telegram page has a shell of its own.
  ROUTES.TELEGRAM,
  // An unknown path redirects Home.
  ROUTES.DEFAULT,
];

beforeEach(() => {
  resetNativeBackForTests();
  mockAccount = "";
  mockDesktop = false;
  mockInApp = false;
  mockNfts = [];
  jest.spyOn(window, "scrollTo").mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  resetNativeBackForTests();
});

const here = () => {
  const { pathname, search } = fakeHistory.current();
  return `${pathname}${search}`;
};

function rowName(row: PageRow): string {
  const notes = [
    row.platform ?? "web",
    row.hasWallet === true ? "a wallet" : "no wallet",
    ...(row.nfts ? ["the NFT held"] : []),
  ];
  const shown = row.path.replace(mockContract, "<contract>");
  return `${shown} (${notes.join(", ")})`;
}

async function show(row: PageRow) {
  mockAccount = row.hasWallet === true ? `Q${"12".repeat(64)}` : "";
  mockDesktop = row.platform === "desktop";
  mockInApp = row.platform === "app";
  mockNfts = [...(row.nfts ?? [])];
  // A fresh load: the page is the only screen of this page load.
  fakeHistory.load([row.path]);
  const Page = row.page;
  await act(async () => {
    render(<Page />);
    await Promise.resolve();
  });
  expect(screen.getByRole("heading", { level: 1 })).toBeTruthy();
}

it("classifies every route", () => {
  const classified = new Set<string>([
    ...ROWS.map((row) => row.route),
    ...OUTSIDE,
  ]);
  for (const route of Object.values(ROUTES)) {
    expect([route, classified.has(route)]).toEqual([route, true]);
  }
});

const named = (rows: readonly PageRow[]) =>
  rows.map((row) => [rowName(row), row] as const);

describe.each(named(ROWS.filter((row) => row.parent === null)))(
  "the menu destination %s",
  (_name, row) => {
    it("shows no Back", async () => {
      await show(row);
      expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
    });
  },
);

describe.each(named(ROWS.filter((row) => row.parent !== null)))(
  "the sub-page %s",
  (_name, row) => {
    it("shows Back, which takes its parent on a fresh load", async () => {
      await show(row);
      const back = screen.getByRole("button", { name: "Back" });
      expect(back).toHaveProperty("disabled", false);
      await act(async () => {
        fireEvent.click(back);
        await Promise.resolve();
      });
      expect(here()).toBe(row.parent);
      // The page is replaced, so it cannot come back on a later back.
      expect(fakeHistory.action()).toBe("REPLACE");
      expect(fakeHistory.length()).toBe(1);
    });
  },
);
