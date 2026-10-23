/** @jest-environment jsdom */
// Error text oracle starts from origin/dev at b7a0fac72ace1f3c393c6335499df1fd1d1c0366.
// Tuple diagnostics reflect the Zod 4.6.7 upgrade.
// All languages must match its rendered English bytes. External calls are stubbed.
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
import DAppTransactionReview from "@/components/Core/Body/DAppConnect/DAppTransactionReview";
import {
  type PendingDAppRequest,
  type DAppSession,
} from "@/services/dappConnect/types";
import type { TxProgressState } from "@/stores/dappConnectStore";
import type { TypedDataPayload } from "@/utils/signing";
import { applyLanguage, i18n } from "../index";
import { desktopSigner } from "@/desktop/bridge";
import { DeviceCredentialUnavailableError } from "@/utils/crypto";
import { PinVerificationError } from "@/utils/crypto/verifyPinWithLimit";
import * as signing from "@/utils/signing";
import englishErrors from "./fixtures/slice6Errors.origin-dev.json";

jest.setTimeout(30000);

import DAppConnectConsentModal from "@/components/Core/Body/DAppConnect/DAppConnectConsentModal";
import { mockReviewObservers } from "@/test-utils/reviewObserver";
let reviewObservers: ReturnType<typeof mockReviewObservers>;

const ADDRESS = `Q${"a".repeat(128)}`;
const DIGEST = `0x${"cd".repeat(64)}`;
let mockGenerationCurrent = true;
let mockStoredSeed = "fixture";
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
    qrlInstance: {
      requestManager: { send: () => Promise<string> };
      getTransactionCount?: () => Promise<number>;
    } | null;
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
    setTxProgressForApproval: (
      sessionId: string,
      id: string | number,
      state: TxProgressState,
      hash?: string,
      error?: string,
    ) => void;
    sendRejectionResultById: typeof mockReject;
    sendApprovalResultById: typeof mockApprove;
    resetTxProgress: () => void;
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
    setTxProgressForApproval: (_sessionId, _id, state, hash, error) => {
      mockStore.dappConnectStore.txProgress = state;
      mockStore.dappConnectStore.txHash = hash ?? null;
      mockStore.dappConnectStore.txError = error ?? null;
    },
    sendRejectionResultById: mockReject,
    sendApprovalResultById: mockApprove,
    resetTxProgress: () => {
      mockStore.dappConnectStore.txProgress = "idle";
    },
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
    getEncryptedSeed: () => Promise.resolve(mockStoredSeed),
  },
}));
jest.mock("@/utils/nativeWalletMutation", () => ({
  walletMutations: {
    captureGeneration: () => 0,
    isCurrent: () => mockGenerationCurrent,
  },
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
  return {
    __esModule: true,
    ...jest.requireActual<typeof import("@/utils/signing")>("@/utils/signing"),
  };
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
async function click(name: "Approve" | "Connect") {
  const translated =
    name === "Approve" ? i18n.t("dapps:approve") : i18n.t("settings:connect");
  await act(async () => {
    fireEvent.click(
      screen.queryByRole("button", { name: translated }) ??
        screen.getByRole("button", { name }),
    );
    await Promise.resolve();
  });
}
beforeEach(async () => {
  jest.clearAllMocks();
  mockDecrypt.mockReset();
  mockGenerationCurrent = true;
  mockStoredSeed = "fixture";
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
    getTransactionCount: () => Promise.resolve(0),
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

const oracle: Record<string, string> = englishErrors;
function expectError(name: string, text: string | null | undefined) {
  expect(typeof text).toBe("string");
  expect(text).toBe(oracle[name]);
}
function errorText() {
  return document.querySelector(
    "p[data-review-block].text-destructive, p[role=alert].text-destructive, p.text-destructive.break-all",
  )?.textContent;
}
function enterPin() {
  const input =
    screen.queryByPlaceholderText(i18n.t("dapps:enterPin")) ??
    screen.getByPlaceholderText("Enter PIN");
  fireEvent.change(input, { target: { value: "123456" } });
}
function throwDiagnostic(cause: unknown): never {
  throw cause;
}
const languages = ["en", "de", "es", "ru", "zh-CN"] as const;
const methods = ["qrl_signMessage", "qrl_signTypedData"] as const;

const diagnostics = [
  "",
  " \n\t ",
  "Incorrect PIN. 4 attempts remaining.",
  "Message signing failed: upstream authorization-id-17",
  "No active account",
  "Invalid input: expected relay authorization token, received diagnostic-id-17",
  "Message signing failed: Incorrect PIN. 4 attempts remaining.",
  "Typed-data signing failed: the desktop signer does not match the requested signer",
  "Transaction signing failed: Message signing failed: external tail",
  "  External relay failure\nsecond line: {{reason}} <raw>  ",
  "Relay join acknowledgement timeout",
  "Failed to join channel",
  "Relay send acknowledgement timeout",
  "Failed to send",
  "Socket not connected",
  "Relay channel not joined",
  "KeyExchange: handshake generation changed",
  "PQCrypto: WebCrypto SubtleCrypto is not available",
  "Relay-provided public key does not match the fingerprint from the QR",
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
  "Too many failed attempts. Please wait 3 minutes.",
  "Another PIN check is still running. Please try again.",
  "Transaction was broadcast, but confirmation is unavailable. Check the explorer before sending again.",
  "Transaction confirmation is unavailable. Check the explorer before sending again.",
  "This transaction is already in the network queue. Check the explorer before sending it again.",
  "The network did not confirm whether this transaction was accepted. Check the explorer before sending it again.",
];

describe.each(languages)(
  "%s matches the base English error renderer",
  (language) => {
    beforeEach(async () => {
      await applyLanguage(language);
    });

    it.each(diagnostics)(
      "consent, failed and unknown transaction details: %s",
      async (message) => {
        mockStore.dappConnectStore.desktopConnectUri =
          "qrlconnect://?q=fixture";
        mockConnect.mockResolvedValue({ success: false, error: message });
        await show(<DAppConnectConsentModal />);
        await click("Connect");
        expectError(
          `consent: ${message}`,
          screen.getByRole("alert").textContent,
        );
        cleanup();
        for (const progress of ["failed", "unknown"] as const) {
          Object.assign(mockStore.dappConnectStore, {
            currentApproval: request("qrl_sendTransaction"),
            txProgress: progress,
            txError: message,
          });
          await show(<DAppApprovalModal />);
          expectError(
            `${progress}: ${message}`,
            document.querySelector("p.break-all")?.textContent,
          );
          cleanup();
        }
        expect(mockApprove).not.toHaveBeenCalled();
      },
    );

    it.each(methods)(
      "schema preview and approval errors for %s",
      async (method) => {
        const invalid = [
          [],
          [ADDRESS],
          [ADDRESS, "not-hex"],
          ["invalid-address", {}],
          [ADDRESS, {}, "extra"],
        ];
        for (const [index, params] of invalid.entries()) {
          mockStore.dappConnectStore.currentApproval = request(method, params);
          await show(<DAppApprovalModal />);
          expectError(
            `${method} schema preview ${index}`,
            document.querySelector(
              "div[data-review-block] > p.text-xs.text-muted-foreground.break-all",
            )?.textContent,
          );
          await click("Approve");
          expectError(`${method} schema approval ${index}`, errorText());
          expect(mockApprove).not.toHaveBeenCalled();
          cleanup();
        }
      },
    );

    it("typed schema paths and encoder failures", async () => {
      const base = payload(false);
      const invalid = [
        { ...base, message: {} },
        { ...base, message: { challengeText: 1, accounts: [ADDRESS] } },
        { ...base, message: { ...base.message, "exact\nfield: tail": 1 } },
        { ...base, primaryType: "" },
        { ...base, primaryType: "Missing" },
        { ...base, primaryType: "QRLDomain" },
        { ...base, "Exact field: 名字": 1 },
        { ...base, "Exact field: 名字": 1, "second field": 2 },
        { ...base, types: { "": [] } },
        {
          ...base,
          types: { ...base.types, Challenge: [{ name: "", type: "string" }] },
        },
        {
          ...base,
          types: { ...base.types, Challenge: [{ name: "text", type: "" }] },
        },
        {
          ...base,
          types: {
            ...base.types,
            Challenge: [{ name: "value", type: "uint7" }],
          },
        },
        {
          ...base,
          types: {
            ...base.types,
            Challenge: [{ name: "value", type: "Missing" }],
          },
        },
        {
          ...base,
          types: {
            ...base.types,
            Challenge: [{ name: "text", type: "Challenge" }],
          },
        },
        {
          ...base,
          types: { ...base.types, Unused: [{ name: "value", type: "string" }] },
        },
        {
          ...base,
          types: {
            ...base.types,
            QRLDomain: [{ name: "chainId", type: "uint256" }],
          },
        },
        {
          ...base,
          types: {
            ...base.types,
            QRLDomain: [{ name: "name", type: "uint256" }],
          },
        },
      ];
      for (const [index, data] of invalid.entries()) {
        mockStore.dappConnectStore.currentApproval = request(
          "qrl_signTypedData",
          [ADDRESS, data],
        );
        await show(<DAppApprovalModal />);
        expectError(
          `typed validation ${index}`,
          document.querySelector(
            "div[data-review-block] > p.text-xs.text-muted-foreground.break-all",
          )?.textContent,
        );
        expect(mockApprove).not.toHaveBeenCalled();
        cleanup();
      }
    });

    it.each(["qrl_sendTransaction", "qrl_signTransaction", ...methods])(
      "account and PIN guards for %s",
      async (method) => {
        for (const kind of [
          "no-account",
          "wrong-account",
          "missing-pin",
          "stale-wallet",
          "missing-seed",
          "wrong-pin",
          "last-pin",
          "locked-pin",
          "busy-pin",
          "device-credential",
          "unlock-failure",
        ]) {
          mockStore.dappConnectStore.currentApproval = request(method);
          mockStore.dappConnectStore.txProgress = "idle";
          mockStore.dappConnectStore.txError = null;
          mockStore.qrlStore.activeAccount.accountAddress =
            kind === "no-account"
              ? ""
              : kind === "wrong-account"
                ? `Q${"b".repeat(128)}`
                : ADDRESS;
          mockGenerationCurrent = kind !== "stale-wallet";
          mockStoredSeed = kind === "missing-seed" ? "" : "fixture";
          const status = {
            attemptsLeft: kind === "last-pin" ? 1 : 4,
            isLocked: kind === "locked-pin",
            remainingMs: kind === "locked-pin" ? 120000 : 0,
          };
          const cause =
            kind === "device-credential"
              ? new DeviceCredentialUnavailableError()
              : kind === "unlock-failure"
                ? new Error("External unlock diagnostic")
                : new PinVerificationError(
                    status,
                    kind === "busy-pin"
                      ? "Another PIN check is still running. Please try again."
                      : undefined,
                  );
          mockDecrypt.mockRejectedValue(cause);
          await show(<DAppApprovalModal />);
          if (kind !== "missing-pin") enterPin();
          await click("Approve");
          expectError(`${method} ${kind}`, errorText());
          expect(mockApprove).not.toHaveBeenCalled();
          cleanup();
        }
      },
    );

    it.each(methods)("desktop signer failures for %s", async (method) => {
      mockDesktop = true;
      for (const kind of [
        "mismatch",
        "scheme",
        "external",
        "wrapped",
        "blank",
        "non-error",
        "long",
        "circular",
        "deep",
      ]) {
        if (kind === "scheme" && method !== "qrl_signTypedData") continue;
        mockStore.dappConnectStore.currentApproval = request(method);
        const signer = jest.spyOn(
          desktopSigner,
          method === "qrl_signMessage" ? "signMessage" : "signTypedData",
        );
        if (kind === "mismatch" || kind === "scheme") {
          signer.mockResolvedValue({
            kind: method === "qrl_signMessage" ? "message" : "typedData",
            signature: "0x01",
            publicKey: "0x02",
            signer: kind === "mismatch" ? `Q${"b".repeat(128)}` : ADDRESS,
            digest: DIGEST,
            schemeVersion: "unexpected-scheme",
          });
        } else {
          const cause =
            kind === "blank"
              ? " \n "
              : kind === "non-error"
                ? {}
                : kind === "long"
                  ? "x".repeat(300)
                  : kind === "wrapped"
                    ? "Error invoking remote method 'sign': Error: Incorrect PIN. 4 attempts remaining.\nprivate tail"
                    : kind === "circular"
                      ? "cyclic type reference: Challenge"
                      : kind === "deep"
                        ? "value nesting too deep: message.orders"
                        : " External signer failure\nsecond line ";
          signer.mockRejectedValue(
            typeof cause === "string" ? new Error(cause) : cause,
          );
        }
        await show(<DAppApprovalModal />);
        await click("Approve");
        expectError(
          `${method} desktop ${kind}`,
          screen.getByRole("alert").textContent,
        );
        expect(signer).toHaveBeenCalledTimes(1);
        expect(mockApprove).not.toHaveBeenCalled();
        expect(mockReject).not.toHaveBeenCalled();
        cleanup();
        signer.mockRestore();
      }
    });

    it.each(methods)("web signing failures for %s", async (method) => {
      mockDecrypt.mockResolvedValue({ hexSeed: "fixture-never-signed" });
      for (const kind of [
        "mismatch",
        "external",
        "non-error",
        "circular",
        "deep",
      ]) {
        mockStore.dappConnectStore.currentApproval = request(method);
        const signer = jest.spyOn(
          signing,
          method === "qrl_signMessage" ? "signMessage" : "signTypedData",
        );
        if (kind === "mismatch") {
          signer.mockReturnValue({
            signature: "0x01",
            publicKey: "0x02",
            descriptor: "0x03",
            signer: `Q${"b".repeat(128)}`,
            digest: DIGEST,
            schemeVersion: "QRL-SIGN-MSG-v1",
          });
        } else {
          signer.mockImplementation(() => {
            if (kind === "non-error")
              throwDiagnostic("external string failure");
            throw new Error(
              kind === "circular"
                ? "cyclic type reference: Challenge"
                : kind === "deep"
                  ? "type graph nesting too deep: Challenge"
                  : "Incorrect PIN. 4 attempts remaining.\nexternal tail",
            );
          });
        }
        await show(<DAppApprovalModal />);
        enterPin();
        await click("Approve");
        expectError(`${method} web ${kind}`, errorText());
        expect(signer).toHaveBeenCalledTimes(1);
        expect(mockApprove).not.toHaveBeenCalled();
        cleanup();
        signer.mockRestore();
      }
    });

    it.each(["qrl_sendTransaction", "qrl_signTransaction"])(
      "chain, fee and desktop transaction failures for %s",
      async (method) => {
        for (const kind of [
          "chain-unavailable",
          "chain-mismatch",
          "fee-read",
          "fee-increase",
          "desktop-funds",
          "desktop-nonce",
          "desktop-known",
          "desktop-rejected",
          "desktop-external",
        ]) {
          mockStore.dappConnectStore.currentApproval = request(method);
          mockStore.dappConnectStore.txProgress = "idle";
          mockStore.dappConnectStore.txError = null;
          const provider = mockStore.qrlStore.qrlInstance;
          if (!provider) throw new Error("Missing test provider");
          provider.requestManager.send = () =>
            kind === "chain-unavailable"
              ? Promise.reject(new Error("node unavailable"))
              : Promise.resolve(kind === "chain-mismatch" ? "0x1" : "0x301825");
          mockDesktop = kind.startsWith("desktop-");
          mockDecrypt.mockResolvedValue({ hexSeed: "fixture-never-signed" });
          mockQuote.mockResolvedValue({
            maxFeePerGas: 1n,
            maxPriorityFeePerGas: 1n,
            expectedFeePerGas: 1n,
          });
          const signer = jest.spyOn(
            desktopSigner,
            method === "qrl_sendTransaction"
              ? "signAndSendTransaction"
              : "signTransactionOnly",
          );
          signer.mockRejectedValue(
            new Error(
              kind === "desktop-funds"
                ? "insufficient funds"
                : kind === "desktop-nonce"
                  ? "nonce too low"
                  : kind === "desktop-known"
                    ? "already known"
                    : kind === "desktop-rejected"
                      ? "user denied"
                      : "external desktop failure",
            ),
          );
          await show(<DAppApprovalModal />);
          if (kind === "fee-read")
            mockQuote.mockRejectedValue(new Error("quote unavailable"));
          if (kind === "fee-increase")
            mockQuote.mockResolvedValue({
              maxFeePerGas: 2n,
              maxPriorityFeePerGas: 1n,
              expectedFeePerGas: 1n,
            });
          if (!mockDesktop) enterPin();
          await click("Approve");
          expectError(`${method} ${kind}`, errorText());
          expect(mockApprove).not.toHaveBeenCalled();
          if (mockDesktop) expect(signer).toHaveBeenCalledTimes(1);
          else expect(signer).not.toHaveBeenCalled();
          cleanup();
          signer.mockRestore();
        }
      },
    );

    it("invalid transaction amount and fee fallbacks", async () => {
      await show(
        <DAppTransactionReview
          params={{ value: "invalid" }}
          maxNetworkFee="invalid value"
        />,
      );
      const values = [...document.querySelectorAll(".font-numeric")].map(
        (element) => element.textContent,
      );
      expectError("invalid amount and fee", JSON.stringify(values));
    });
  },
);
