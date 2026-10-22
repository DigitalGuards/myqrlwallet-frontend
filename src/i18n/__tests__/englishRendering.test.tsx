/** @jest-environment jsdom */
// Snapshots originate from origin/dev 83f29adf741291ca10055f3bee18830aec2bcecf.
// Run this same harness on that revision to regenerate the English oracle.
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactElement, ReactNode, AnchorHTMLAttributes } from "react";
import { HelmetProvider } from "react-helmet-async";
import { groupNftsByCollection } from "@/utils/web3/nftCollections";
import type { NFTInterface, TokenInterface } from "@/constants";
import type { HistoryRow } from "@/utils/transactionHistory";
import Home from "@/components/Core/Body/Home/Home";
import AddAccount from "@/components/Core/Body/AddAccount/AddAccount";
import AccountList from "@/components/Core/Body/AccountList/AccountList";
import DAppSessionsPage from "@/components/Core/Body/DAppConnect/DAppSessionsPage";
import AccountCreateImport from "@/components/Core/Body/Home/AccountCreateImport/AccountCreateImport";
import { ActiveAccountDisplay } from "@/components/Core/Body/Home/AccountCreateImport/ActiveAccountDisplay/ActiveAccountDisplay";
import ExtensionPickerDialog from "@/components/Core/Body/Home/AccountCreateImport/ExtensionPickerDialog";
import MobilePairingDialog from "@/components/Core/Body/Home/AccountCreateImport/MobilePairingDialog";
import BackgroundVideo from "@/components/Core/Body/Home/BackgroundVideo/BackgroundVideo";
import ConnectionBadge from "@/components/Core/Body/Home/ConnectionBadge/ConnectionBadge";
import ConnectionFailed from "@/components/Core/Body/Home/ConnectionFailed/ConnectionFailed";
import { ReceivePopup } from "@/components/Core/Body/Home/ReceivePopup";
import { TransactionHistoryPopup } from "@/components/Core/Body/AccountList/ActiveAccount/TransactionHistoryPopup";
import DAppSessionsList from "@/components/Core/Body/DAppConnect/DAppSessionsList";
import Settings from "@/components/Core/Body/Settings/Settings";
import { ExportWalletFile } from "@/components/Core/Body/Settings/ExportWalletFile";
import { NetworkSettings } from "@/components/Core/Body/Settings/NetworkSettings/NetworkSettings";
import { AddTokenModal } from "@/components/Core/Body/Tokens/AddTokenModal/AddTokenModal";
import TokenForm from "@/components/Core/Body/Tokens/TokenForm/TokenForm";
import { DataTable } from "@/components/Core/Body/Tokens/TokenForm/data-table";
import { columns } from "@/components/Core/Body/Tokens/TokenForm/columns";
import NftGallery from "@/components/Core/Body/Nfts/NftGallery";
import { NftCard } from "@/components/Core/Body/Nfts/NftCard";
import { NftCollectionRow } from "@/components/Core/Body/Nfts/NftCollectionRow";
import { NftImage } from "@/components/Core/Body/Nfts/NftImage";
import MyQRLWalletLogo from "@/components/Core/Header/MyQRLWalletLogo/MyQRLWalletLogo";
import Footer from "@/components/Core/Layout/Footer";
import MobileNav from "@/components/Core/Layout/MobileNav";
import { AppSidebar } from "@/components/Core/Layout/app-sidebar";
import { AddressDisclosure } from "@/components/UI/AddressDisclosure";
import { QrlAddress } from "@/components/UI/QrlAddress";
import { PinInput } from "@/components/UI/PinInput/PinInput";
import { SessionStatus } from "@/services/dappConnect/types";
import * as desktop from "@/desktop/bridge";
import { isInNativeApp } from "@/utils/nativeApp";

const mockAddress = `Q${"1".repeat(128)}`;
const nft: NFTInterface = {
  contractAddress: mockAddress,
  standard: "ERC721",
  tokenId: "12",
  collectionName: "Example collection",
};
const token: TokenInterface = {
  address: mockAddress,
  name: "Example token",
  symbol: "EX",
  decimals: 6,
  amount: "1.2345",
};
const mockStore = {
  qrlStore: {
    activeAccount: { accountAddress: mockAddress },
    activeAccountSource: "seed",
    qrlAccounts: { accounts: [] },
    getAccountBalance: () => "123",
    qrlConnection: {
      blockchain: "TEST_NET",
      qrlNetworkName: "QRL 2.0 Testnet",
      isConnected: true,
      isLoading: false,
    },
    activeAccountBalance: "123",
    activeAccountBalanceUsd: 123,
    qrlPrice: 1,
    qrlPriceChange24h: 2.5,
    fetchAccounts: jest.fn(() => Promise.resolve()),
    fetchQrlPrice: jest.fn(() => Promise.resolve()),
    initializeBlockchain: jest.fn(() => Promise.resolve()),
    selectBlockchain: jest.fn(),
  },
  tokenStore: {
    visibleTokenList: [token],
    pendingDiscoveredTokens: [token],
    isRefreshingBalances: false,
    refreshTokenBalances: jest.fn(() => Promise.resolve()),
    discoverTokensForReview: jest.fn(() => Promise.resolve([])),
    setRefreshingBalances: jest.fn(),
    hideToken: jest.fn(() => Promise.resolve()),
  },
  nftStore: {
    nftCollections: groupNftsByCollection([nft]),
    pendingDiscoveredNftCollections: groupNftsByCollection([nft]),
    refreshNftBalances: jest.fn(() => Promise.resolve()),
    refreshNftMetadata: jest.fn(() => Promise.resolve()),
    discoverNftsForReview: jest.fn(() => Promise.resolve([])),
    hideNft: jest.fn(() => Promise.resolve()),
  },
  dappConnectStore: {
    sessionCount: 2,
    activeSessions: [
      SessionStatus.CONNECTED,
      SessionStatus.RECONNECTING,
      SessionStatus.CONNECTING,
      SessionStatus.KEY_EXCHANGE,
      SessionStatus.DISCONNECTED,
    ].map((status, index) => ({
      id: String(index),
      status,
      dappInfo: { name: "Example dApp", url: "https://dapp.example" },
      connectedAccount: index ? null : mockAddress,
      createdAt: 0,
    })),
  },
};
jest.mock("react-router", () => ({
  useLocation: () => ({ pathname: "/", search: "", state: null }),
  useNavigate: () => jest.fn(),
  useSearchParams: () => [new URLSearchParams(), jest.fn()],
  Link: ({
    to,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) => (
    <a href={to} {...props} />
  ),
}));
jest.mock("@/components/Core/Body/Home/DecorativeAccountVideo", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("@/stores/store", () => ({ useStore: () => mockStore }));
jest.mock("mobx-react-lite", () => ({
  observer: (component: unknown) => component,
}));
jest.mock("@/utils", () =>
  jest.requireActual<typeof import("@/utils/cn")>("@/utils/cn"),
);
jest.mock("@/utils/logout", () => ({ handleLogout: jest.fn() }));
jest.mock("@/utils/nativeApp", () => ({
  isInNativeApp: jest.fn(() => false),
  copyToClipboard: () => Promise.resolve(true),
  openExternalUrl: jest.fn(),
}));
jest.mock("@/desktop/bridge", () => ({
  __esModule: true,
  get isDesktop() {
    return false;
  },
}));
jest.mock("@/utils/extension", () => ({
  discoverQrlProviders: () => Promise.resolve([]),
}));
jest.mock("@/utils/mobileConnect/mobileConnection", () => ({
  subscribeMobileStatus: () => () => undefined,
}));
jest.mock("@/services/dappConnect/DAppConnectService", () => ({
  DAppConnectService: {},
}));
let mockHistoryRows: HistoryRow[] = [];
jest.mock("@/hooks/useTransactionHistory", () => ({
  useTransactionHistory: () => ({
    transactions: mockHistoryRows,
    storageUnavailable: false,
  }),
}));
jest.mock("axios", () => ({
  post: () => Promise.resolve({ data: { transactions: [] } }),
}));
jest.mock("@/utils/storage", () => ({
  StorageUtil: {
    getMaxWallets: () => 10,
    isWalletLimitReached: () => Promise.resolve(false),
    getWalletCount: () => Promise.resolve(1),
    getWalletSettings: () =>
      Promise.resolve({
        autoLockTimeout: 900000,
        showTokensCard: true,
        showNftsCard: true,
      }),
    hasEncryptedSeeds: () => Promise.resolve(true),
  },
}));
jest.mock("@/utils/crypto", () => ({
  WalletEncryptionUtil: { validatePassword: () => true },
}));
jest.mock("@/utils/crypto/pinRotation", () => ({
  rotateStoredSeedPin: jest.fn(),
}));
jest.mock("@/utils/web3", () => ({ isValidQrlAddress: () => false }));
jest.mock("@/components/Core/Body/Nfts/AddNftModal", () => ({
  AddNftModal: () => null,
}));
jest.mock("@/config/runtimeProfile", () => ({
  IS_V3_PROFILE: false,
  profileStorageKey: (key: string) => key,
  historyNetwork: () => "testnet",
}));
jest.mock("@/config", () => ({
  IS_V3_PROFILE: false,
  SERVER_URL: "https://wallet.example/api",
  EXPLORER_BASE: "https://explorer.example",
  QRL_PROVIDER: { TEST_NET: { id: "TEST_NET" }, MAIN_NET: { id: "MAIN_NET" } },
  AVAILABLE_NETWORKS: [
    { id: "MAIN_NET", name: "QRL 2.0 Mainnet" },
    { id: "TEST_NET", name: "QRL 2.0 Testnet" },
  ],
  getExplorerAddressUrl: () => "https://explorer.example/address",
  getExplorerTxUrl: () => "https://explorer.example/tx",
}));
jest.mock("@/router/router", () => ({
  ROUTES: {
    HOME: "/",
    SETTINGS: "/settings",
    TRANSFER: "/transfer",
    CREATE_ACCOUNT: "/create",
    IMPORT_ACCOUNT: "/import",
    CREATE_TOKEN: "/create-token",
    ADDRESS_BOOK: "/contacts",
    ACCOUNT_LIST: "/accounts",
    NFT_DETAIL: "/nft/:contractAddress/:tokenId",
    DAPP_SESSIONS: "/dapps",
    PRIVACY: "/privacy",
    TERMS: "/terms",
    LEGAL: "/legal",
  },
}));
jest.mock("@/components/UI/sidebar", () => {
  const Container = ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  );
  return {
    Sidebar: Container,
    SidebarContent: Container,
    SidebarFooter: Container,
    SidebarGroup: Container,
    SidebarGroupContent: Container,
    SidebarMenu: Container,
    SidebarMenuItem: Container,
    SidebarMenuButton: Container,
  };
});

beforeEach(() => {
  jest.mocked(isInNativeApp).mockReturnValue(false);
  mockHistoryRows = [];
  mockStore.qrlStore.activeAccount.accountAddress = mockAddress;
});
afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

function expectNoCatalogKeys() {
  const copy = document.body.cloneNode(true);
  if (!(copy instanceof HTMLElement)) throw new Error("Missing rendered body");
  copy
    .querySelectorAll("style, script, [hidden], [aria-hidden=true], .sr-only")
    .forEach((element) => {
      element.remove();
    });
  expect(copy.textContent).not.toMatch(
    /(?:common|home|settings|tokens|history):[A-Za-z][\w.-]*/,
  );
}

function englishSnapshot() {
  const copy = document.body.cloneNode(true);
  if (!(copy instanceof HTMLElement)) throw new Error("Missing rendered body");
  // Language is the single new row allowed in this slice.
  copy.querySelector("#wallet-language")?.closest(".px-4.py-3")?.remove();
  copy
    .querySelectorAll("style, script, [hidden], [aria-hidden=true], .sr-only")
    .forEach((element) => {
      element.remove();
    });
  expect({
    text: copy.textContent,
    labels: [
      ...copy.querySelectorAll("[aria-label], [title], [alt], [placeholder]"),
    ].map((element) =>
      ["aria-label", "title", "alt", "placeholder"].flatMap((name) =>
        element.hasAttribute(name) ? [[name, element.getAttribute(name)]] : [],
      ),
    ),
  }).toMatchSnapshot();
}

async function show(element: ReactElement) {
  await act(async () => {
    render(<HelmetProvider>{element}</HelmetProvider>);
    await Promise.resolve();
  });
}

const collection = groupNftsByCollection([nft])[0];
if (!collection) throw new Error("Missing collection fixture");

it.each([
  ["Home", <Home />],
  ["AccountCreateImport", <AccountCreateImport />],
  ["ActiveAccountDisplay", <ActiveAccountDisplay onShowAddress={jest.fn()} />],
  [
    "ExtensionPickerDialog and Dialog",
    <ExtensionPickerDialog
      providers={[]}
      onSelect={jest.fn()}
      onClose={jest.fn()}
    />,
  ],
  [
    "MobilePairingDialog",
    <MobilePairingDialog
      uri="qrlconnect://example"
      installHint="MyQRLWallet app not detected. Install it (https://store.example/app) or scan the code with the app on another device."
      onClose={jest.fn()}
      onNewCode={() => Promise.resolve()}
    />,
  ],
  ["BackgroundVideo", <BackgroundVideo />],
  ["ConnectionBadge", <ConnectionBadge />],
  ["ConnectionFailed", <ConnectionFailed />],
  [
    "ReceivePopup",
    <ReceivePopup accountAddress={mockAddress} isOpen onClose={jest.fn()} />,
  ],
  [
    "TransactionHistoryPopup",
    <TransactionHistoryPopup
      accountAddress={mockAddress}
      blockchain="TEST_NET"
      isOpen
      onClose={jest.fn()}
    />,
  ],
  ["DAppSessionsList", <DAppSessionsList />],
  ["Settings", <Settings />],
  ["NetworkSettings", <NetworkSettings />],
  ["AddTokenModal", <AddTokenModal isOpen onClose={jest.fn()} />],
  ["TokenForm", <TokenForm />],
  [
    "DataTable, columns and TokenCells",
    <DataTable columns={columns} data={[token]} />,
  ],
  ["NftGallery", <NftGallery />],
  [
    "NftCollectionRow",
    <NftCollectionRow collection={collection} onOpen={jest.fn()} />,
  ],
  ["NftCard", <NftCard nft={nft} />],
  ["NftImage", <NftImage alt="Example artwork" />],
  ["MyQRLWalletLogo", <MyQRLWalletLogo />],
  ["Footer", <Footer />],
  ["MobileNav", <MobileNav />],
  ["AppSidebar", <AppSidebar />],
  ["AddressDisclosure", <AddressDisclosure address={mockAddress} />],
  ["QrlAddress", <QrlAddress address={mockAddress} revealable />],
  ["PinInput", <PinInput value="" onChange={jest.fn()} />],
] satisfies [string, ReactElement][])(
  "preserves origin/dev English: %s",
  async (_name, element) => {
    await show(element);
    expectNoCatalogKeys();
    englishSnapshot();
  },
);

describe.each(["web", "native", "desktop"])(
  "setup routes in %s mode",
  (shell) => {
    it.each([
      ["/add-account", <AddAccount />, false],
      ["/account-list without an active account", <AccountList />, false],
      ["/account-list with an active account", <AccountList />, true],
      ["/ without an active account", <Home />, false],
    ] satisfies [string, ReactElement, boolean][])(
      "renders the origin/dev setup copy on %s without catalog keys",
      async (_route, element, active) => {
        jest.mocked(isInNativeApp).mockReturnValue(shell === "native");
        jest
          .spyOn(desktop, "isDesktop", "get")
          .mockReturnValue(shell === "desktop");
        mockStore.qrlStore.activeAccount.accountAddress = active
          ? mockAddress
          : "";
        await show(element);
        await screen.findByRole("link", {
          name: "Create a new account",
        });
        const expected =
          shell === "web"
            ? "You are connected to the blockchain. Create a new account, import an existing account, or connect a wallet you already use: your browser extension or the MyQRLWallet mobile app."
            : "You are connected to the blockchain. Create a new account or import an existing account.";
        await waitFor(() => {
          expectNoCatalogKeys();
          expect(screen.getAllByText(expected).length).toBeGreaterThan(0);
        });
      },
    );
  },
);

it("translates all session status keys on /dapp-sessions", async () => {
  await show(<DAppSessionsPage />);
  for (const status of [
    "Connected",
    "Reconnecting...",
    "Connecting...",
    "Exchanging keys...",
    "Offline, retries later",
  ])
    expect(screen.getByText(status).textContent).toBe(status);
  expectNoCatalogKeys();
});

it.each([
  ["/", <Home />],
  ["/account-list", <AccountList />],
] satisfies [string, ReactElement][])(
  "translates every history status in the popup opened from %s",
  async (_route, element) => {
    const states = [
      "confirmed",
      "pending",
      "failed",
      "dropped",
      undefined,
    ] as const;
    mockHistoryRows = states.map((state, index) => ({
      ID: String(index),
      InOut: 0,
      TxType: "0x2",
      Address: mockAddress,
      From: mockAddress,
      To: `Q${"2".repeat(128)}`,
      TxHash: `0x${String(index).repeat(64)}`,
      TimeStamp: "0x42",
      Amount: "1.25",
      BlockNumber: "0x42",
      state,
    }));
    await show(element);
    const trigger = document.querySelector("button:has(.lucide-history)");
    if (!(trigger instanceof HTMLElement))
      throw new Error("Missing history button");
    fireEvent.click(trigger);
    for (const status of [
      "Confirmed",
      "Pending",
      "Failed",
      "Failed (dropped or replaced)",
      "Unavailable",
    ])
      expect((await screen.findByText(status)).textContent).toBe(status);
    expectNoCatalogKeys();
  },
);

it("preserves origin/dev English: ExportWalletFile with its active account", async () => {
  await show(<ExportWalletFile />);
  fireEvent.click(screen.getByRole("button", { name: /Export Wallet File/ }));
  englishSnapshot();
});

it("preserves origin/dev English: PIN fields and validation", async () => {
  await show(<Settings />);
  fireEvent.click(screen.getByRole("button", { name: /Change PIN/ }));
  englishSnapshot();
});
