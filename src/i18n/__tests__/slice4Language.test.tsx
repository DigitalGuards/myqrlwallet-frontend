/** @jest-environment jsdom */
// Live renderer language invariants with synthetic requests and no signing.
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import type { ComponentProps, ReactElement } from "react";
import { HelmetProvider } from "react-helmet-async";
import DAppApprovalModal from "@/components/Core/Body/DAppConnect/DAppApprovalModal";
import DAppMessageReview from "@/components/Core/Body/DAppConnect/DAppMessageReview";
import DAppTypedDataReview from "@/components/Core/Body/DAppConnect/DAppTypedDataReview";
import DAppTransactionReview from "@/components/Core/Body/DAppConnect/DAppTransactionReview";
import {
  type PendingDAppRequest,
  type DAppSession,
} from "@/services/dappConnect/types";
import type { TxProgressState } from "@/stores/dappConnectStore";
import type { TypedDataPayload } from "@/utils/signing";
import { applyLanguage, i18n } from "../index";

const ADDRESS = `Q${"a".repeat(128)}`;
const DIGEST = `0x${"cd".repeat(64)}`;
let mockDesktop = false;
let mockNative = false;
let mockInjectedPin = false;
let mockMobile = false;
const mockApprove = jest.fn();
const mockReject = jest.fn();
const mockConnect = jest.fn<
  Promise<{ success: boolean; error?: string }>,
  []
>();
const mockQuote = jest.fn<
  Promise<{
    maxFeePerGas: bigint;
    maxPriorityFeePerGas: bigint;
    expectedFeePerGas: bigint;
  }>,
  []
>();
const mockDecrypt = jest.fn<Promise<{ hexSeed: string }>, []>();
const mockFetch = jest.fn();
const mockStore: {
  qrlStore: {
    activeAccount: { accountAddress: string };
    qrlConnection: { blockchain: string };
    qrlAccounts: { isLoading: boolean };
    qrlInstance: { requestManager: { send: () => Promise<string> } } | null;
  };
  dappConnectStore: {
    currentApproval: PendingDAppRequest | null;
    approvalModalOpen: boolean;
    txProgress: TxProgressState;
    txHash: string | null;
    txError: string | null;
    desktopConnectUri: string | null;
    desktopConnectSource: string;
    activeSessions: Pick<
      DAppSession,
      "id" | "status" | "dappInfo" | "createdAt" | "connectedAccount"
    >[];
    returnHandedBackSessionId: string | null;
    confirmDesktopConnect: typeof mockConnect;
    clearDesktopConnect: () => void;
    approveRequestById: typeof mockApprove;
    rejectRequestById: typeof mockReject;
    rejectCurrentRequest: typeof mockReject;
    dismissCurrentApproval: () => void;
    disconnectSession: () => void;
    disconnectAll: () => void;
    isCurrentApproval: () => boolean;
    setTxProgressForApproval: () => void;
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
    currentApproval: null,
    approvalModalOpen: true,
    txProgress: "idle",
    txHash: null,
    txError: null,
    desktopConnectUri: null,
    desktopConnectSource: "paste",
    activeSessions: [],
    returnHandedBackSessionId: null,
    confirmDesktopConnect: mockConnect,
    clearDesktopConnect: () => undefined,
    approveRequestById: mockApprove,
    rejectRequestById: mockReject,
    rejectCurrentRequest: mockReject,
    dismissCurrentApproval: () => undefined,
    disconnectSession: () => undefined,
    disconnectAll: () => undefined,
    isCurrentApproval: () => true,
    setTxProgressForApproval: () => undefined,
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
jest.mock("@/stores/qrlStore", () => ({ quoteFees: () => mockQuote() }));
jest.mock("@/services/dappConnect/DAppConnectService", () => ({
  DEFAULT_RELAY_URL: "https://relay.example",
  DAppConnectService: { isConnectionURI: () => false },
}));
jest.mock("@/services/dappConnect/qrUri", () => ({
  parseConnectionURI: () =>
    Promise.resolve({ relayUrl: "https://relay.example" }),
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
jest.mock("@/utils/crypto", () => ({
  decryptStoredSeedWithPin: () => mockDecrypt(),
  DeviceCredentialUnavailableError: class extends Error {},
}));
jest.mock("@/utils/crypto/verifyPinWithLimit", () => ({
  ...jest.requireActual<typeof import("@/utils/crypto/verifyPinWithLimit")>(
    "@/utils/crypto/verifyPinWithLimit",
  ),
  verifyPinWithLimit: (run: () => unknown) => run(),
}));
jest.mock("@/utils/storage/storage", () => ({
  __esModule: true,
  default: {
    getBlockChain: () => Promise.resolve("TEST_NET"),
    getEncryptedSeed: () => Promise.resolve("fixture"),
  },
}));
jest.mock("@/utils/nativeWalletMutation", () => ({
  walletMutations: { captureGeneration: () => 0, isCurrent: () => true },
}));
jest.mock("@/utils/nativeApp", () => ({
  isIOSNativeApp: () => mockNative,
  isInNativeApp: () => mockNative,
  getNativeInjectedPin: () => "",
  sendToNative: () => false,
}));
jest.mock("@/hooks/useHasNativeInjectedPin", () => ({
  useHasNativeInjectedPin: () => mockInjectedPin,
}));
jest.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => mockMobile }));
jest.mock("@/utils", () =>
  jest.requireActual<typeof import("@/utils/cn")>("@/utils/cn"),
);
jest.mock("@/components/Telegram/config", () => ({
  serverUrl: "https://wallet.example/api",
}));
jest.mock("@theqrl/web3", () => ({ utils: {} }));
jest.mock("@/utils/signing", () => {
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
  return jest.requireActual<typeof import("@/utils/signing")>(
    "@/utils/signing",
  );
});
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

function payload(chain = true): TypedDataPayload {
  return {
    types: {
      QRLDomain: [
        { name: "name", type: "string" },
        ...(chain ? [{ name: "chainId", type: "uint256" }] : []),
      ],
      Challenge: [
        { name: "challengeText", type: "string" },
        { name: "accounts", type: "address[]" },
      ],
    },
    primaryType: "Challenge",
    domain: chain
      ? { name: "Example domain", chainId: "3151909" }
      : { name: "Example domain" },
    message: { challengeText: "Authenticate 123", accounts: [ADDRESS] },
  };
}
function request(method: string, params?: unknown[]): PendingDAppRequest {
  return {
    id: 1,
    sessionId: "session-fixture",
    method,
    params:
      params ??
      (method === "qrl_signTypedData"
        ? [ADDRESS, payload()]
        : method === "qrl_signMessage"
          ? [ADDRESS, "0x68656c6c6f"]
          : [
              {
                from: ADDRESS,
                to: ADDRESS,
                value: "0x1",
                gas: "0x5208",
                data: "0xabcd",
                chainId: "0x301825",
              },
            ]),
    dappInfo: {
      name: "Example dApp",
      url: "https://dapp.example",
      chainId: "0x301825",
    },
    timestamp: 1700000000000,
  };
}
async function show(element: ReactElement) {
  await act(async () => {
    render(<HelmetProvider>{element}</HelmetProvider>);
    await Promise.resolve();
  });
}
async function click(name: string) {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
    await Promise.resolve();
  });
}
beforeEach(async () => {
  jest.clearAllMocks();
  mockDesktop = false;
  mockNative = false;
  mockInjectedPin = false;
  mockMobile = false;
  localStorage.clear();
  await applyLanguage("en");
  mockStore.qrlStore.activeAccount.accountAddress = ADDRESS;
  mockStore.qrlStore.qrlAccounts.isLoading = false;
  mockStore.qrlStore.qrlInstance = {
    requestManager: { send: () => Promise.resolve("0x301825") },
  };
  Object.assign(mockStore.dappConnectStore, {
    currentApproval: null,
    approvalModalOpen: true,
    txProgress: "idle",
    txHash: null,
    txError: null,
    desktopConnectUri: null,
    activeSessions: [],
    returnHandedBackSessionId: null,
  });
  mockQuote.mockResolvedValue({
    maxFeePerGas: 1n,
    maxPriorityFeePerGas: 1n,
    expectedFeePerGas: 1n,
  });
  mockConnect.mockResolvedValue({ success: false, error: "Connection failed" });
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
  document.title = "";
});

it.each(["de", "es", "ru", "zh-CN"] as const)(
  "keeps dApp payloads verbatim in %s",
  async (language) => {
    await applyLanguage(language);
    const data = payload();
    await show(
      <>
        <DAppTypedDataReview
          payload={data}
          digestHex={DIGEST}
          connectedChainId="1"
        />
        <DAppMessageReview messageHex="0x68656c6c6f" digestHex={DIGEST} />
        <DAppTransactionReview
          params={{ from: "Unknown", to: "Unknown", data: "0xabcd" }}
        />
      </>,
    );
    const t = i18n.getFixedT(language, "dapps");
    expect(screen.getByText("challengeText")).toBeDefined();
    expect(screen.getByText("accounts")).toBeDefined();
    expect(screen.getByText('"Authenticate 123"')).toBeDefined();
    expect(screen.getByText('"Example domain"')).toBeDefined();
    expect(screen.getByText('"' + ADDRESS + '"')).toBeDefined();
    expect(screen.getByText("hello")).toBeDefined();
    expect(screen.getByText("0x68656c6c6f")).toBeDefined();
    expect(screen.getAllByText("Unknown")).toHaveLength(2);
    expect(screen.getByText("0xabcd")).toBeDefined();
    expect(screen.getAllByText(DIGEST)).toHaveLength(2);
    expect(screen.getByRole("alert").textContent).toBe(
      t("chainMismatch", { domain: "3151909", connected: "1" }),
    );
    expect(screen.getByText(t("trustWarning"))).toBeDefined();
    expect(document.querySelector("pre")?.textContent).toContain(
      '"challengeText": "Authenticate 123"',
    );
  },
);
it("changes an already displayed PIN error without another unlock or approval", async () => {
  mockStore.dappConnectStore.currentApproval = request("qrl_signMessage");
  await show(<DAppApprovalModal />);
  await click("Approve");
  expect(screen.getByText("Please enter your PIN")).toBeDefined();
  for (const language of ["de", "es", "ru", "zh-CN"] as const) {
    await act(async () => {
      await applyLanguage(language);
    });
    expect(
      screen.getByText(i18n.getFixedT(language, "dapps")("pinRequired")),
    ).toBeDefined();
    expect(screen.getByText("Example dApp")).toBeDefined();
    expect(screen.getByText("https://dapp.example")).toBeDefined();
  }
  expect(mockDecrypt).not.toHaveBeenCalled();
  expect(mockApprove).not.toHaveBeenCalled();
  expect(mockReject).not.toHaveBeenCalled();
});
it("retains the fee quote and approval gating through live language changes", async () => {
  mockStore.dappConnectStore.currentApproval = request("qrl_sendTransaction");
  await show(<DAppApprovalModal />);
  expect(mockQuote).toHaveBeenCalledTimes(1);
  for (const language of ["de", "es", "ru", "zh-CN", "en"] as const) {
    await act(async () => {
      await applyLanguage(language);
    });
    const t = i18n.getFixedT(language, "dapps");
    expect(screen.getByText(t("maxFee"))).toBeDefined();
    expect(
      screen
        .getByRole("button", { name: t("approve") })
        .hasAttribute("disabled"),
    ).toBe(false);
    expect(screen.getByText("0xabcd")).toBeDefined();
    expect(screen.getByText("0x301825")).toBeDefined();
  }
  expect(mockQuote).toHaveBeenCalledTimes(1);
  expect(mockApprove).not.toHaveBeenCalled();
});
it("uses all Russian byte count forms", async () => {
  await applyLanguage("ru");
  for (const [count, expected] of [
    [1, "1 байт"],
    [2, "2 байта"],
    [5, "5 байт"],
    [21, "21 байт"],
  ] as const) {
    await show(<DAppMessageReview messageHex={`0x${"61".repeat(count)}`} />);
    expect(screen.getByText(expected)).toBeDefined();
    cleanup();
  }
});
