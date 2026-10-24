/** @jest-environment jsdom */
// English oracle: run this harness unchanged on origin/dev at
// 6b1e544c21d278a0aa8a8614828cc563b91f130f with TZ=UTC.
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import type { ComponentProps, ReactElement } from "react";
import { HelmetProvider } from "react-helmet-async";
import DAppConnectionBanner from "@/components/Core/Body/DAppConnect/DAppConnectionBanner";
import DAppSessionsPage from "@/components/Core/Body/DAppConnect/DAppSessionsPage";
import QRView from "@/components/Core/Body/QRView/QRView";
import TelegramControlCenter from "@/components/Telegram/TelegramControlCenter";
import RetiredAppNotice from "@/components/RetiredAppNotice";
import WalletLoadFailed from "@/components/WalletLoadFailed";
import App from "@/App";
import {
  Sidebar,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@/components/UI/sidebar";
import { SessionStatus, type DAppSession } from "@/services/dappConnect/types";
import { applyLanguage } from "../index";

const ADDRESS = `Q${"a".repeat(128)}`;
let mockDesktop = false;
let mockNative = false;
let mockMobile = false;
const mockFetch = jest.fn();
const mockStore: {
  qrlStore: {
    activeAccount: { accountAddress: string };
    qrlConnection: { blockchain: string };
    qrlAccounts: { isLoading: boolean };
    qrlInstance: { requestManager: { send: () => Promise<string> } } | null;
  };
  dappConnectStore: {
    activeSessions: Pick<
      DAppSession,
      "id" | "status" | "dappInfo" | "createdAt" | "connectedAccount"
    >[];
    returnHandedBackSessionId: string | null;
    disconnectSession: () => void;
    disconnectAll: () => void;
  };
} = {
  qrlStore: {
    activeAccount: { accountAddress: ADDRESS },
    qrlConnection: { blockchain: "TEST_NET" },
    qrlAccounts: { isLoading: false },
    qrlInstance: {
      requestManager: { send: () => Promise.resolve("0x301825") },
    },
  },
  dappConnectStore: {
    activeSessions: [],
    returnHandedBackSessionId: null,
    disconnectSession: () => undefined,
    disconnectAll: () => undefined,
  },
};
jest.mock("mobx-react-lite", () => ({
  observer: (component: unknown) => component,
}));
jest.mock("@/stores/store", () => ({
  useStore: () => mockStore,
  store: {},
  StoreProvider: () => null,
}));
jest.mock("@/router/router", () => ({ AppRouter: () => null }));
jest.mock("react-router", () => ({
  useNavigate: () => () => Promise.resolve(),
}));
jest.mock("@/services/dappConnect/DAppConnectService", () => ({
  DEFAULT_RELAY_URL: "https://relay.example",
  DAppConnectService: { isConnectionURI: () => false },
}));
jest.mock("@/desktop/bridge", () => ({
  ...jest.requireActual<typeof import("@/desktop/bridge")>("@/desktop/bridge"),
  get isDesktop() {
    return mockDesktop;
  },
}));
jest.mock("@/config", () => ({
  getExplorerTxUrl: () => "https://explorer.example/tx",
  getExplorerAddressUrl: () => "https://explorer.example/address",
}));
jest.mock("@/config/runtimeProfile", () => ({
  IS_V3_PROFILE: false,
  profileStorageKey: (key: string) => key,
  isUnsupportedV3Context: () => true,
  V3_UNSUPPORTED_SIGNER_MESSAGE:
    "Testnet v3 supports this web wallet and updated MyQRLWallet mobile, desktop and extension releases. Older native apps are not yet qualified.",
}));
jest.mock("@/utils/storage/storage", () => ({
  __esModule: true,
  default: {
    getBlockChain: () => Promise.resolve("TEST_NET"),
    getEncryptedSeed: () => Promise.resolve("fixture"),
  },
}));
jest.mock("@/utils/nativeApp", () => ({
  isIOSNativeApp: () => mockNative,
  isInNativeApp: () => mockNative,
  getNativeInjectedPin: () => "",
  sendToNative: () => false,
}));
jest.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => mockMobile }));
jest.mock("@/utils", () =>
  jest.requireActual<typeof import("@/utils/cn")>("@/utils/cn"),
);
jest.mock("@/components/Telegram/config", () => ({
  serverUrl: "https://wallet.example/api",
}));
jest.mock("@theqrl/web3", () => ({ utils: {} }));
jest.mock("react-helmet-async", () => {
  const actual =
    jest.requireActual<typeof import("react-helmet-async")>(
      "react-helmet-async",
    );
  return {
    ...actual,
    Helmet: (props: ComponentProps<typeof actual.Helmet>) => (
      <actual.Helmet {...props} defer={false} />
    ),
  };
});

async function show(element: ReactElement) {
  await act(async () => {
    render(<HelmetProvider>{element}</HelmetProvider>);
    await Promise.resolve();
  });
}
function snapshot() {
  const copy = document.body.cloneNode(true);
  if (!(copy instanceof HTMLElement)) throw new Error("Missing body");
  copy
    .querySelectorAll("style,script,[hidden],[aria-hidden=true]")
    .forEach((node) => {
      node.remove();
    });
  expect({
    text: copy.textContent,
    labels: [
      ...copy.querySelectorAll("[aria-label],[title],[alt],[placeholder]"),
    ].map((element) =>
      ["aria-label", "title", "alt", "placeholder"].flatMap((name) =>
        element.hasAttribute(name) ? [[name, element.getAttribute(name)]] : [],
      ),
    ),
    title: document.title,
  }).toMatchSnapshot();
}
beforeEach(async () => {
  document.title = "";
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    value: class {
      observe() {}
      disconnect() {}
    },
  });
  jest.clearAllMocks();
  mockDesktop = false;
  mockNative = false;
  mockMobile = false;
  localStorage.clear();
  await applyLanguage("en");
  mockStore.qrlStore.activeAccount.accountAddress = ADDRESS;
  mockStore.qrlStore.qrlAccounts.isLoading = false;
  mockStore.qrlStore.qrlInstance = {
    requestManager: { send: () => Promise.resolve("0x301825") },
  };
  Object.assign(mockStore.dappConnectStore, {
    activeSessions: [],
    returnHandedBackSessionId: null,
  });
  mockFetch.mockReturnValue(new Promise(() => undefined));
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    writable: true,
    value: mockFetch,
  });
});
afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

it.each(Object.values(SessionStatus))(
  "session banner and list %s",
  async (status) => {
    mockStore.dappConnectStore.activeSessions = [
      {
        id: "fixture",
        status,
        dappInfo: {
          name: "Example dApp",
          url: "https://dapp.example",
          chainId: "0x301825",
        },
        createdAt: 1700000000000,
        connectedAccount: ADDRESS,
      },
    ];
    await show(
      <>
        <DAppConnectionBanner />
        <DAppSessionsPage />
      </>,
    );
    snapshot();
  },
);
it("empty sessions and QR", async () => {
  await show(
    <>
      <DAppSessionsPage />
      <QRView />
    </>,
  );
  snapshot();
});
it.each(["loading", "ok", "degraded", "rejected"])(
  "Telegram %s",
  async (health) => {
    if (health === "rejected")
      mockFetch.mockRejectedValue(new Error("Unavailable"));
    else if (health !== "loading")
      mockFetch.mockResolvedValue({ ok: health === "ok" });
    await show(<TelegramControlCenter />);
    snapshot();
  },
);
it.each([RetiredAppNotice, WalletLoadFailed, App])(
  "shared notice %p",
  async (Component) => {
    await show(<Component />);
    snapshot();
  },
);
it("sidebar accessibility copy", async () => {
  mockMobile = true;
  await show(
    <SidebarProvider defaultOpen>
      <SidebarTrigger />
      <SidebarRail />
      <Sidebar />
    </SidebarProvider>,
  );
  const trigger = document.querySelector("[data-sidebar=trigger]");
  if (!trigger) throw new Error("Missing sidebar trigger");
  fireEvent.click(trigger);
  snapshot();
});
