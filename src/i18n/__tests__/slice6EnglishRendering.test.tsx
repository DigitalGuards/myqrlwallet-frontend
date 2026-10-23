/** @jest-environment jsdom */
// English oracle: run this harness unchanged on origin/dev at
// b7a0fac72ace1f3c393c6335499df1fd1d1c0366 with TZ=UTC.
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
import DAppConnectConsentModal from "@/components/Core/Body/DAppConnect/DAppConnectConsentModal";
import DAppMessageReview from "@/components/Core/Body/DAppConnect/DAppMessageReview";
import DAppTypedDataReview from "@/components/Core/Body/DAppConnect/DAppTypedDataReview";
import DAppTransactionReview from "@/components/Core/Body/DAppConnect/DAppTransactionReview";
import {
  type PendingDAppRequest,
  type DAppSession,
} from "@/services/dappConnect/types";
import type { TxProgressState } from "@/stores/dappConnectStore";
import type { TypedDataPayload } from "@/utils/signing";
import { desktopSigner } from "@/desktop/bridge";
import { PinVerificationError } from "@/utils/crypto/verifyPinWithLimit";
import { applyLanguage } from "../index";

import { mockReviewObservers } from "@/test-utils/reviewObserver";
let reviewObservers: ReturnType<typeof mockReviewObservers>;

const ADDRESS = `Q${"a".repeat(128)}`;
const HASH = `0x${"ab".repeat(32)}`;
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
    desktopConnectReview: { uri: string } | null;
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
    desktopConnectReview: null,
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
  if (mockStore.dappConnectStore.desktopConnectUri)
    mockStore.dappConnectStore.desktopConnectReview = {
      uri: mockStore.dappConnectStore.desktopConnectUri,
    };
  await act(async () => {
    render(<HelmetProvider>{element}</HelmetProvider>);
    await Promise.resolve();
  });
  await act(async () => {
    reviewObservers.settle();
    await Promise.resolve();
  });
}
async function click(name: string) {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
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
  jest.clearAllMocks();
  reviewObservers = mockReviewObservers();
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
    desktopConnectReview: null,
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
  reviewObservers.restore();
  jest.restoreAllMocks();
  document.title = "";
});

it.each(["web", "native", "desktop"])(
  "every approval method on %s",
  async (shell) => {
    mockDesktop = shell === "desktop";
    mockNative = shell === "native";
    mockInjectedPin = mockNative;
    for (const method of [
      "qrl_requestAccounts",
      "qrl_sendTransaction",
      "qrl_signTransaction",
      "qrl_signMessage",
      "qrl_signTypedData",
      "wallet_addQrlChain",
      "wallet_switchQrlChain",
      "unknown_method",
    ]) {
      mockStore.dappConnectStore.currentApproval = request(method);
      await show(<DAppApprovalModal />);
      snapshot();
      cleanup();
    }
  },
);
it.each(["qrl_signMessage", "qrl_signTypedData"])(
  "invalid %s preview",
  async (method) => {
    for (const params of [[], [ADDRESS, "not-hex"], ["invalid-address", {}]]) {
      mockStore.dappConnectStore.currentApproval = request(method, params);
      await show(<DAppApprovalModal />);
      snapshot();
      cleanup();
    }
  },
);
it.each(["loading", "failed"])("fee preview %s", async (state) => {
  mockQuote.mockReset();
  if (state === "loading")
    mockQuote.mockReturnValue(new Promise(() => undefined));
  else mockQuote.mockRejectedValue(new Error("fixture quote failure"));
  mockStore.dappConnectStore.currentApproval = request("qrl_sendTransaction");
  await show(<DAppApprovalModal />);
  snapshot();
});
it.each<TxProgressState>([
  "signing",
  "broadcasting",
  "confirming",
  "confirmed",
  "failed",
  "unknown",
])("transaction progress %s", async (progress) => {
  mockNative = true;
  Object.assign(mockStore.dappConnectStore, {
    currentApproval: request("qrl_sendTransaction"),
    txProgress: progress,
    txHash: HASH,
    txError: "fixture external error",
  });
  await show(<DAppApprovalModal />);
  snapshot();
});
it.each([
  "",
  "Insufficient funds for this transaction.",
  "Transaction nonce is too low. Please retry.",
  "This transaction was already submitted.",
  "Request was rejected.",
  "Transaction failed. Please verify details and try again.",
  "Please enter your PIN",
  "Wallet changed while preparing the request",
  "No encrypted seed found",
  "Wallet device security credential unavailable; re-import the seed",
  "Failed to unlock the seed. Please try again.",
  "Web3 not initialized",
  "Failed to sign transaction",
  "Transaction has been reverted by the QRVM",
  "This transaction would fail on chain, so it was not sent.",
  "This transaction would fail on chain: contract reason",
  "Incorrect PIN. 2 attempts remaining.",
  "Too many failed attempts. Please wait 3 minutes.",
  "Another PIN check is still running. Please try again.",
  "External node error 123",
])("transaction error: %s", async (error) => {
  Object.assign(mockStore.dappConnectStore, {
    currentApproval: request("qrl_sendTransaction"),
    txProgress: "failed",
    txError: error,
  });
  await show(<DAppApprovalModal />);
  snapshot();
});
it.each([
  "",
  "Transaction was broadcast, but confirmation is unavailable. Check the explorer before sending again.",
  "Transaction confirmation is unavailable. Check the explorer before sending again.",
  "This transaction is already in the network queue. Check the explorer before sending it again.",
  "The network did not confirm whether this transaction was accepted. Check the explorer before sending it again.",
])("unknown transaction: %s", async (error) => {
  Object.assign(mockStore.dappConnectStore, {
    currentApproval: request("qrl_sendTransaction"),
    txProgress: "unknown",
    txError: error,
  });
  await show(<DAppApprovalModal />);
  snapshot();
});
it.each(["qrl_signMessage", "qrl_signTypedData"])(
  "%s PIN and signer errors",
  async (method) => {
    mockStore.dappConnectStore.currentApproval = request(method);
    await show(<DAppApprovalModal />);
    await click("Approve");
    snapshot();
    cleanup();
    mockStore.qrlStore.activeAccount.accountAddress = "";
    await show(<DAppApprovalModal />);
    await click("Approve");
    snapshot();
    cleanup();
    mockStore.qrlStore.activeAccount.accountAddress = `Q${"b".repeat(128)}`;
    await show(<DAppApprovalModal />);
    await click("Approve");
    snapshot();
    cleanup();
    mockStore.qrlStore.activeAccount.accountAddress = ADDRESS;
    mockDesktop = true;
    const signer = jest
      .spyOn(
        desktopSigner,
        method === "qrl_signMessage" ? "signMessage" : "signTypedData",
      )
      .mockRejectedValue(new Error("External signer failure"));
    await show(<DAppApprovalModal />);
    await click("Approve");
    snapshot();
    signer.mockRestore();
  },
);
it("PIN attempts and lockout in signing form", async () => {
  mockStore.dappConnectStore.currentApproval = request("qrl_signMessage");
  for (const error of [
    new PinVerificationError({
      attemptsLeft: 2,
      isLocked: false,
      remainingMs: 0,
    }),
    new PinVerificationError({
      attemptsLeft: 0,
      isLocked: true,
      remainingMs: 120000,
    }),
  ]) {
    mockDecrypt.mockRejectedValue(error);
    await show(<DAppApprovalModal />);
    fireEvent.change(screen.getByPlaceholderText("Enter PIN"), {
      target: { value: "123456" },
    });
    await click("Approve");
    snapshot();
    cleanup();
  }
});
it.each(["paste", "link", "protocol"])("pairing consent %s", async (source) => {
  mockStore.dappConnectStore.desktopConnectUri = "qrlconnect://?q=fixture";
  mockStore.dappConnectStore.desktopConnectSource = source;
  await show(<DAppConnectConsentModal />);
  snapshot();
  await click("Connect");
  snapshot();
});
it.each([
  "missing",
  "hydrating",
  "connecting",
  "external-error",
  "blank-error",
])("pairing state %s", async (state) => {
  mockStore.dappConnectStore.desktopConnectUri = "qrlconnect://?q=fixture";
  mockStore.dappConnectStore.desktopConnectSource = "paste";
  if (state === "missing" || state === "hydrating")
    mockStore.qrlStore.activeAccount.accountAddress = "";
  if (state === "hydrating") mockStore.qrlStore.qrlAccounts.isLoading = true;
  if (state === "connecting")
    mockConnect.mockReturnValue(new Promise(() => undefined));
  if (state === "external-error")
    mockConnect.mockResolvedValue({
      success: false,
      error: "External relay failure 123",
    });
  if (state === "blank-error")
    mockConnect.mockResolvedValue({ success: false, error: " " });
  await show(<DAppConnectConsentModal />);
  if (!["missing", "hydrating"].includes(state))
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
  await act(async () => {
    await Promise.resolve();
  });
  snapshot();
});
it.each([
  "0x",
  "0x61",
  "0x6162",
  "0xff",
  "0x00",
  "0xe280ae",
  "0x20",
  "0x09",
  "0x0a",
  "0x200920",
  "0xe2808b",
  "0xefbbbf",
])("message bytes %s", async (messageHex) => {
  await show(<DAppMessageReview messageHex={messageHex} digestHex={DIGEST} />);
  snapshot();
});
it.each(["matching", "mismatch", "no-chain"])(
  "typed data %s",
  async (state) => {
    await show(
      <DAppTypedDataReview
        payload={payload(state !== "no-chain")}
        digestHex={DIGEST}
        connectedChainId={state === "mismatch" ? "1" : "3151909"}
      />,
    );
    snapshot();
  },
);
it("nested typed values and empty placeholders", async () => {
  const data = payload();
  data.message = {
    challengeText: { nested: [null, undefined, false, 5, 6n] },
    accounts: [],
  };
  await show(<DAppTypedDataReview payload={data} />);
  snapshot();
});
it.each([undefined, 21000, "0x5208", 21000n, "malformed", {}])(
  "transaction gas %s",
  async (gas) => {
    await show(<DAppTransactionReview params={{ gas }} />);
    snapshot();
  },
);

it.each(["pending", "failed"])("typed network check %s", async (state) => {
  mockStore.qrlStore.qrlInstance = {
    requestManager: {
      send: () =>
        state === "pending"
          ? new Promise(() => undefined)
          : Promise.reject(new Error("fixture chain failure")),
    },
  };
  mockStore.dappConnectStore.currentApproval = request("qrl_signTypedData");
  await show(<DAppApprovalModal />);
  snapshot();
});
it.each(["approval", "consent"])("visibility hint %s", async (kind) => {
  reviewObservers.hold();
  if (kind === "approval") {
    mockStore.dappConnectStore.currentApproval = request("qrl_signMessage");
    await show(<DAppApprovalModal />);
  } else {
    mockStore.dappConnectStore.desktopConnectUri = "qrlconnect://?q=fixture";
    await show(<DAppConnectConsentModal />);
  }
  snapshot();
});
