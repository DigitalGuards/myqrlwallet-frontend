/** @jest-environment jsdom */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { configure } from "mobx";
import DAppApprovalModal from "../DAppApprovalModal";
import DAppConnectConsentModal from "../DAppConnectConsentModal";
import DAppConnectStore from "@/stores/dappConnectStore";
import { dappConnectService } from "@/services/dappConnect/DAppConnectService";
import { desktopSigner } from "@/desktop/bridge";
import { quoteFees, type FeeQuote } from "@/stores/qrlStore";
import type { SignatureResult } from "@/desktop/bridge";
import type { PendingDAppRequest } from "@/services/dappConnect/types";

import { decryptStoredSeedWithPin } from "@/utils/crypto";
import { checkLockout, getRemainingAttempts } from "@/utils/crypto/pinAttemptTracker";
import { PinVerificationError } from "@/utils/crypto/verifyPinWithLimit";
import { logger } from "@/utils/log";
import { mockReviewObservers } from "@/test-utils/reviewObserver";
let visibility: ReturnType<typeof mockReviewObservers>;
let mockDesktop = true;
const address = `Q${"a".repeat(128)}`;
let mockDappStore: DAppConnectStore;
let rejectRequestSpy: jest.SpiedFunction<typeof dappConnectService.rejectRequest>;
let approveRequestSpy: jest.SpiedFunction<typeof dappConnectService.approveRequest>;
const mockQrlStore = {
  activeAccount: { accountAddress: address },
  qrlConnection: { blockchain: "TEST_NET" },
  qrlAccounts: { isLoading: false },
  qrlInstance: { requestManager: { send: () => Promise.resolve("0x301825") } },
};

jest.mock("@/stores/store", () => ({
  useStore: () => ({ dappConnectStore: mockDappStore, qrlStore: mockQrlStore }),
}));
jest.mock("react-router", () => ({ useNavigate: () => jest.fn() }));
jest.mock("@/stores/qrlStore", () => ({
  quoteFees: jest.fn(),
}));
jest.mock("@/services/dappConnect/DAppConnectService", () => ({
  DEFAULT_RELAY_URL: "https://relay.example",
  dappConnectService: {
    setHandlers: jest.fn(),
    getActiveSessions: () => [],
    reconnectAll: () => Promise.resolve(),
    rejectRequest: jest.fn(),
    approveRequest: jest.fn(),
  },
}));
jest.mock("@/services/dappConnect/qrUri", () => ({
  parseConnectionURI: () => Promise.resolve({ relayUrl: "https://relay.example" }),
}));
jest.mock("@/desktop/bridge", () => ({
  ...jest.requireActual<typeof import("@/desktop/bridge")>("@/desktop/bridge"),
  get isDesktop() { return mockDesktop; },
}));
jest.mock("@/config", () => ({
  getExplorerTxUrl: () => "https://explorer.example/tx",
}));
jest.mock("@/config/runtimeProfile", () => ({ IS_V3_PROFILE: false, profileStorageKey: (key: string) => key }));
jest.mock("@/utils/crypto", () => ({ decryptStoredSeedWithPin: jest.fn(), DeviceCredentialUnavailableError: class extends Error {} }));
jest.mock("@/utils/storage/storage", () => ({ __esModule: true, default: { getBlockChain: () => Promise.resolve("TEST_NET"), getEncryptedSeed: () => Promise.resolve("fixture") } }));
jest.mock("@/utils/nativeWalletMutation", () => ({ walletMutations: { captureGeneration: () => 0, isCurrent: () => true } }));
jest.mock("@/utils/nativeApp", () => ({ isIOSNativeApp: () => false, getNativeInjectedPin: () => "" }));
jest.mock("@/hooks/useHasNativeInjectedPin", () => ({
  useHasNativeInjectedPin: () => false,
}));
jest.mock("@/utils/formatting", () => ({ formatQuantaValue: () => "0" }));
jest.mock("@/utils", () =>
  jest.requireActual<typeof import("@/utils/cn")>("@/utils/cn"),
);
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

function request(method: string, id = 1): PendingDAppRequest {
  const params =
    method === "qrl_signTypedData"
      ? [
          address,
          {
            types: {
              QRLDomain: [
                { name: "name", type: "string" },
                { name: "chainId", type: "uint256" },
              ],
              Recipients: [{ name: "accounts", type: "address[]" }],
            },
            primaryType: "Recipients",
            domain: { name: "Approval test", chainId: "3151909" },
            message: {
              accounts: Array.from(
                { length: 12 },
                (_, index) => `Q${(index + 1).toString(16).padStart(128, "0")}`,
              ),
            },
          },
        ]
      : method === "qrl_signMessage"
        ? [address, "0x68656c6c6f"]
        : method === "qrl_requestAccounts"
          ? []
          : [{ from: address, to: address, value: "0x0" }];
  return {
    id,
    sessionId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    method,
    params,
    dappInfo: {
      name: "Test dApp",
      url: "https://dapp.example",
      chainId: "0x301825",
    },
    timestamp: Date.now(),
  };
}

beforeEach(() => {
  mockDesktop = true;
  localStorage.clear();
  configure({ enforceActions: "never" });
  jest.useFakeTimers();
  jest.clearAllMocks();
  visibility = mockReviewObservers();
  jest.mocked(quoteFees).mockReset().mockResolvedValue({
    maxFeePerGas: 1n,
    maxPriorityFeePerGas: 1n,
    expectedFeePerGas: 1n,
  });
  mockDappStore = new DAppConnectStore();
  rejectRequestSpy = jest.spyOn(dappConnectService, "rejectRequest");
  approveRequestSpy = jest.spyOn(dappConnectService, "approveRequest");
});

describe("fee preview lifetime", () => {
  it.each(["resolve", "reject"])(
    "ignores a stale quote that finishes with %s while a new request is waiting",
    async (outcome) => {
      mockDesktop = false;
      let finish: () => void = () => { throw new Error("Quote did not start"); };
      jest.mocked(quoteFees).mockReturnValueOnce(new Promise<FeeQuote>((resolve, reject) => {
        finish = () => {
          if (outcome === "reject") reject(new Error("Node unavailable"));
          else resolve({ maxFeePerGas: 1n, maxPriorityFeePerGas: 1n, expectedFeePerGas: 1n });
        };
      }));
      jest.mocked(quoteFees).mockReturnValueOnce(new Promise<FeeQuote>(() => undefined));
      await showApproval("qrl_sendTransaction");
      const next = request("qrl_sendTransaction", 2);
      act(() => {
        mockDappStore.pendingRequests = [next];
        mockDappStore.currentApproval = next;
      });
      await act(() => {
        finish();
        return Promise.resolve();
      });
      expect(quoteFees).toHaveBeenCalledTimes(2);
      expect(screen.getByRole("button", { name: "Approve" }).hasAttribute("disabled")).toBe(true);
      expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
      expect(approveRequestSpy).not.toHaveBeenCalled();
    },
  );

  it("keeps a completed quote across PIN edits", async () => {
    mockDesktop = false;
    await showApproval("qrl_sendTransaction");
    fireEvent.change(screen.getByPlaceholderText("Enter PIN"), { target: { value: "123456" } });
    expect(quoteFees).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Approve" }).hasAttribute("disabled")).toBe(false);
  });

  it("quotes again when the reviewed transaction content changes", async () => {
    mockDesktop = false;
    await showApproval("qrl_sendTransaction");
    await act(async () => {
      const approval = mockDappStore.currentApproval;
      if (!approval) throw new Error("Expected current approval");
      approval.params = [{ from: address, to: address, value: "0x1", gas: "0x5209" }];
      await jest.advanceTimersByTimeAsync(1);
    });
    expect(quoteFees).toHaveBeenCalledTimes(2);
    act(() => { visibility.settle(); });
    expect(screen.getByRole("button", { name: "Approve" }).hasAttribute("disabled")).toBe(false);
  });
});
afterEach(() => {
  cleanup();
  visibility.restore();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

async function showApproval(method: string, params?: unknown[]): Promise<PendingDAppRequest> {
  const pending = request(method);
  if (params) pending.params = params;
  mockDappStore.pendingRequests = [pending];
  mockDappStore.currentApproval = pending;
  mockDappStore.approvalModalOpen = true;
  render(<DAppApprovalModal />);
  await act(async () => {
    await jest.advanceTimersByTimeAsync(400);
  });
  act(() => { visibility.settle(); });
  return pending;
}

async function approve(): Promise<void> {
  act(() => { visibility.settle(); });
  await act(() => {
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    return Promise.resolve();
  });
}

describe('visibility gate', () => {
  it.each(['qrl_requestAccounts', 'wallet_addQrlChain', 'wallet_switchQrlChain', 'qrl_sendTransaction', 'qrl_signTransaction', 'qrl_signMessage', 'qrl_signTypedData'])(
    'blocks %s until seen and keeps rejection working', async (method) => {
      visibility.hold();
      const pending = await showApproval(method);
      const button = screen.getByRole('button', { name: 'Approve' });
      expect(button.hasAttribute('disabled')).toBe(true);
      expect(screen.getByRole('status').textContent).toBe('Scroll to see every detail before approving');
      fireEvent.click(button);
      fireEvent.submit(screen.getByRole('dialog'));
      expect(approveRequestSpy).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
      expect(rejectRequestSpy).toHaveBeenCalledWith(pending.sessionId, pending.id, undefined, undefined);
    },
  );

  it('blocks PIN Enter and exposes only a button action', async () => {
    visibility.hold(); mockDesktop = false;
    await showApproval('qrl_signMessage');
    const input = screen.getByPlaceholderText('Enter PIN');
    fireEvent.change(input, { target: { value: '123456' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(decryptStoredSeedWithPin).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Approve' }).getAttribute('type')).toBe('button');
  });

  it('requires a newly arrived fee even after every earlier row was seen', async () => {
    visibility.hold(); mockDesktop = false;
    let finish: (quote: FeeQuote) => void = () => { throw new Error('Quote not started'); };
    jest.mocked(quoteFees).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    await showApproval('qrl_sendTransaction');
    act(() => { visibility.emit(); });
    expect(screen.getByRole('button', { name: 'Approve' }).hasAttribute('disabled')).toBe(true);
    await act(async () => {
      finish({ maxFeePerGas: 2n, maxPriorityFeePerGas: 1n, expectedFeePerGas: 1n });
      await Promise.resolve();
    });
    expect(screen.getByRole('button', { name: 'Approve' }).hasAttribute('disabled')).toBe(true);
    act(() => { visibility.emit(visibility.targets.filter((target) => target.parentElement?.textContent.includes('Max network fee'))); });
    expect(screen.getByRole('button', { name: 'Approve' }).hasAttribute('disabled')).toBe(false);
  });

  it('re-gates in-place message edits without resetting seen identity', async () => {
    visibility.hold();
    mockDesktop = false;
    await showApproval('qrl_signMessage');
    fireEvent.change(screen.getByPlaceholderText('Enter PIN'), { target: { value: '123456' } });
    act(() => { visibility.emit(); });
    act(() => {
      const approval = mockDappStore.currentApproval;
      if (approval?.params) approval.params[1] = '0x776f726c64';
      fireEvent.keyDown(screen.getByPlaceholderText('Enter PIN'), { key: 'Enter' });
    });
    expect(decryptStoredSeedWithPin).not.toHaveBeenCalled();
    expect(screen.getByText('world')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Approve' }).hasAttribute('disabled')).toBe(true);
    act(() => { visibility.emit(visibility.targets.filter((target) => target.parentElement?.textContent === 'world')); });
    expect(screen.getByRole('button', { name: 'Approve' }).hasAttribute('disabled')).toBe(false);
  });

  it.each(['Escape', 'Close', 'Cancel'])('keeps consent %s available while gated', async (action) => {
    visibility.hold();
    mockDappStore.desktopConnectUri = 'qrlconnect://?q=fixture';
    const connect = jest.spyOn(mockDappStore, 'confirmDesktopConnect');
    render(<DAppConnectConsentModal />);
    await act(async () => { await jest.advanceTimersByTimeAsync(400); });
    const button = screen.getByRole('button', { name: 'Connect' });
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(button.getAttribute('type')).toBe('button');
    fireEvent.click(button);
    fireEvent.submit(screen.getByRole('dialog'));
    expect(connect).not.toHaveBeenCalled();
    if (action === 'Escape') fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    else fireEvent.click(screen.getByRole('button', { name: action }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

// Oracle generated on the unchanged fadf59e base (production files match
// origin/dev b1785b8). Settle mock IO before capture: fitted content is enabled.
describe('English fitted rendering', () => {
  function snapshot(action: 'Approve' | 'Connect') {
    act(() => { visibility.settle(); });
    expect(screen.getByRole('button', { name: action }).hasAttribute('disabled')).toBe(false);
    const copy = screen.getByRole('dialog').cloneNode(true);
    if (!(copy instanceof HTMLElement)) throw new Error('Missing dialog');
    copy.querySelectorAll('[aria-hidden=true], .sr-only').forEach((element) => { element.remove(); });
    expect({ text: copy.textContent,
      controls: [...copy.querySelectorAll('button,input')].map((element) => ({
        text: element.textContent, label: element.getAttribute('aria-label'),
        title: element.getAttribute('title'), placeholder: element.getAttribute('placeholder'),
        disabled: element.hasAttribute('disabled'),
      })),
    }).toMatchSnapshot();
  }
  it.each(['qrl_sendTransaction', 'qrl_signTransaction', 'qrl_signMessage', 'qrl_signTypedData'])('%s', async (method) => {
    await showApproval(method);
    snapshot('Approve');
  });
  it.each(['paste', 'link', 'deeplink'] as const)('consent %s', async (source) => {
    mockDappStore.desktopConnectUri = 'qrlconnect://?q=fixture';
    mockDappStore.desktopConnectSource = source;
    render(<DAppConnectConsentModal />);
    await act(async () => { await jest.advanceTimersByTimeAsync(400); });
    snapshot('Connect');
  });
});

it.each(["", " \t\n"])("shows a fallback for a blank retryable request error (%j)", async (message) => {
  mockDesktop = false;
  jest.mocked(decryptStoredSeedWithPin).mockRejectedValueOnce(
    new PinVerificationError({ isLocked: false, remainingMs: 0, attemptsLeft: 5 }, message),
  );
  await showApproval("qrl_signMessage");
  expect(screen.queryByText("The request failed.")).toBeNull();
  fireEvent.change(screen.getByPlaceholderText("Enter PIN"), { target: { value: "123456" } });
  await approve();
  expect(screen.getByText("The request failed.")).toBeTruthy();
  expect(rejectRequestSpy).not.toHaveBeenCalled();
  fireEvent.change(screen.getByPlaceholderText("Enter PIN"), { target: { value: "123457" } });
  expect(screen.queryByText("The request failed.")).toBeNull();
});

describe.each(["", " \t\n", "RPC unavailable"])("transaction error display (%j)", (message) => {
  it.each(["failed", "unknown"] as const)("keeps the %s outcome and original error", async (state) => {
    await showApproval("qrl_sendTransaction");
    act(() => { mockDappStore.setTxProgress(state, undefined, message); });
    const fallback = state === "failed" ? "The request failed." : "Transaction status is unavailable.";
    expect(screen.getByText(message.trim() ? message : fallback)).toBeTruthy();
    expect(mockDappStore.txError).toBe(message);
    expect(mockDappStore.txProgress).toBe(state);
    expect(rejectRequestSpy).not.toHaveBeenCalled();
    expect(approveRequestSpy).not.toHaveBeenCalled();
  });
});

it.each([
  ["Payload", "Typed data contains a circular type reference."],
  [`uint8${"[]".repeat(13)}`, "Typed data is nested too deeply."],
])("shows consistent typed-data preview errors for %s", async (fieldType, expected) => {
  await showApproval("qrl_signTypedData", [address, {
    types: {
      QRLDomain: [{ name: "name", type: "string" }],
      Payload: [{ name: "value", type: fieldType }],
    },
    primaryType: "Payload",
    domain: { name: "Validation test" },
    message: { value: [] },
  }]);
  expect(screen.getByText(expected)).toBeTruthy();
  expect(approveRequestSpy).not.toHaveBeenCalled();
  expect(rejectRequestSpy).not.toHaveBeenCalled();
});

it.each([
  ["cyclic type reference: Loop -> Loop", "Typed data contains a circular type reference."],
  ["type graph nesting too deep: Root -> Child", "Typed data is nested too deeply."],
])("keeps the desktop protocol error while displaying %s consistently", async (message, expected) => {
  jest.spyOn(desktopSigner, "signTypedData").mockRejectedValueOnce(new Error(message));
  const pending = await showApproval("qrl_signTypedData");
  await approve();
  expect(screen.getByRole("alert").textContent).toBe(expected);
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(rejectRequestSpy).toHaveBeenCalledWith(pending.sessionId, pending.id, message, -32603);
});

it("logs an unavailable chain during typed-data review and keeps approval available", async () => {
  const error = new Error("RPC unavailable");
  const warn = jest.spyOn(logger, "warn").mockImplementation(() => undefined);
  jest.spyOn(mockQrlStore.qrlInstance.requestManager, "send").mockRejectedValueOnce(error);
  await showApproval("qrl_signTypedData");
  expect(warn).toHaveBeenCalledWith(
    "[DAppConnect] Could not read the wallet chain id for typed-data review:", error,
  );
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByRole("button", { name: "Approve" }).hasAttribute("disabled")).toBe(false);
  expect(rejectRequestSpy).not.toHaveBeenCalled();
});

it("logs a chain read failure and retains the network-switch rejection", async () => {
  mockDesktop = false;
  const error = new Error("RPC unavailable");
  const warn = jest.spyOn(logger, "warn").mockImplementation(() => undefined);
  jest.spyOn(mockQrlStore.qrlInstance.requestManager, "send").mockRejectedValueOnce(error);
  const pending = await showApproval("wallet_switchQrlChain", [{ chainId: "0x301825" }]);
  await approve();
  expect(warn).toHaveBeenCalledWith("[DAppConnect] Could not verify the requested network:", error);
  expect(rejectRequestSpy).toHaveBeenCalledWith(
    pending.sessionId, pending.id, "The wallet could not verify the requested network", 4902,
  );
  expect(approveRequestSpy).not.toHaveBeenCalled();
});

it.each(["qrl_sendTransaction", "qrl_signTransaction"])(
  "retains the logged approval failure for %s when its chain read fails",
  async (method) => {
    const error = new Error("RPC unavailable");
    const log = jest.spyOn(logger, "log").mockImplementation(() => undefined);
    jest.spyOn(mockQrlStore.qrlInstance.requestManager, "send").mockRejectedValueOnce(error);
    const pending = await showApproval(method, [{ from: address, to: address, chainId: "0x301825" }]);
    await approve();
    expect(log).toHaveBeenCalledWith("[DAppConnect] approval error:", error.message);
    expect(rejectRequestSpy).toHaveBeenCalledWith(
      pending.sessionId, pending.id, "Transaction failed. Please verify details and try again.", undefined,
    );
    expect(approveRequestSpy).not.toHaveBeenCalled();
  },
);

it.each(["", " \t\n", "Relay unavailable"])("keeps connection errors visible (%j)", async (message) => {
  mockDappStore.desktopConnectUri = "qrlconnect://?q=fixture";
  jest.spyOn(mockDappStore, "confirmDesktopConnect").mockResolvedValueOnce({ success: false, error: message });
  render(<DAppConnectConsentModal />);
  await act(async () => { await jest.advanceTimersByTimeAsync(400); });
  await act(() => {
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    return Promise.resolve();
  });
  expect(screen.getByRole("alert").textContent).toBe(message.trim() ? message : "Connection failed");
});

describe.each([
  "qrl_signTypedData",
  "qrl_signMessage",
  "qrl_sendTransaction",
  "qrl_signTransaction",
  "qrl_requestAccounts",
])("%s dismissal", (method) => {
  it.each(["Escape", "Close", "Reject"])(
    "rejects through %s",
    async (action) => {
      const pending = await showApproval(method);
      if (action === "Escape")
        fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
      else fireEvent.click(screen.getByRole("button", { name: action }));
      expect(rejectRequestSpy).toHaveBeenCalledWith(
        pending.sessionId,
        pending.id,
        undefined,
        undefined,
      );
      expect(mockDappStore.currentApproval).toBeNull();
      expect(screen.queryByRole("dialog")).toBeNull();
    },
  );
});

describe.each(["qrl_signTypedData", "qrl_signMessage"])(
  "%s desktop errors",
  (method) => {
    function signer() {
      return jest.spyOn(
        desktopSigner,
        method === "qrl_signTypedData" ? "signTypedData" : "signMessage",
      );
    }

    it("closes quietly after cancellation in the trusted window", async () => {
      signer().mockRejectedValue(
        new Error(
          "Error invoking remote method 'wallet:requestSignature': Error: user rejected signature",
        ),
      );
      const pending = await showApproval(method);
      await approve();
      expect(rejectRequestSpy).toHaveBeenCalledWith(
        pending.sessionId,
        pending.id,
        "User rejected the request",
        4001,
      );
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it.each([
      "signer refused signature",
      "signer locked",
      "boundary rejected request",
    ])(
      "keeps %s visible until Close rejects with the failure code",
      async (reason) => {
        signer().mockRejectedValue(
          new Error(
            `Error invoking remote method 'wallet:requestSignature': Error: ${reason}`,
          ),
        );
        const pending = await showApproval(method);
        await approve();
        expect(screen.getByRole("alert").textContent).toContain(reason);
        expect(screen.getByRole("dialog").textContent).not.toContain(
          "Error invoking remote method",
        );
        expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
        expect(rejectRequestSpy).not.toHaveBeenCalled();
        const close = screen.getAllByRole("button", { name: "Close" })[0];
        if (!close) throw new Error("Close action missing");
        fireEvent.click(close);
        expect(rejectRequestSpy).toHaveBeenCalledWith(
          pending.sessionId,
          pending.id,
          reason,
          -32603,
        );
        expect(screen.queryByRole("dialog")).toBeNull();
      },
    );

    it("preserves the failure code when Escape closes the error", async () => {
      signer().mockRejectedValue(new Error("signer locked"));
      const pending = await showApproval(method);
      await approve();
      fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
      expect(rejectRequestSpy).toHaveBeenCalledWith(
        pending.sessionId,
        pending.id,
        "signer locked",
        -32603,
      );
    });

    it("keeps an in-flight signature pending and isolates a late failure from the next approval", async () => {
      let rejectSigning: (reason: Error) => void = () => {
        throw new Error("Signing did not start");
      };
      signer().mockReturnValue(
        new Promise<SignatureResult>((_resolve, reject) => {
          rejectSigning = reject;
        }),
      );
      const pending = await showApproval(method);
      await approve();
      fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
      expect(rejectRequestSpy).not.toHaveBeenCalled();
      const next = request(method, 2);
      act(() => {
        mockDappStore.pendingRequests = [next];
        mockDappStore.currentApproval = next;
      });
      await act(() => {
        rejectSigning(new Error("signer locked"));
        return Promise.resolve();
      });
      expect(rejectRequestSpy).toHaveBeenCalledWith(
        pending.sessionId,
        pending.id,
        "signer locked",
        -32603,
      );
      expect(mockDappStore.currentApproval?.id).toBe(2);
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.getByRole("button", { name: "Approve" })).toBeTruthy();
    });
  },
);

it.each(["Escape", "Close", "Cancel"])(
  "declines connect consent through %s",
  async (action) => {
    mockDappStore.desktopConnectUri = "qrlconnect://?q=fixture";
    render(<DAppConnectConsentModal />);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(400);
    });
    if (action === "Escape")
      fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    else fireEvent.click(screen.getByRole("button", { name: action }));
    expect(mockDappStore.desktopConnectUri).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  },
);


it.each(["qrl_signMessage", "qrl_signTypedData", "qrl_sendTransaction"])(
  "limits wrong PINs for %s approvals and keeps the prompt retryable",
  async (method) => {
    mockDesktop = false;
    jest
      .mocked(decryptStoredSeedWithPin)
      .mockRejectedValue(
        Object.assign(new Error("Incorrect PIN"), { code: "INCORRECT_PIN" }),
      );
    const pending = await showApproval(method);
    for (let attempt = 1; attempt <= 6; attempt++) {
      fireEvent.change(screen.getByPlaceholderText("Enter PIN"), {
        target: { value: `99999${attempt}` },
      });
      await approve();
      expect(getRemainingAttempts()).toBe(Math.max(0, 5 - attempt));
      expect(decryptStoredSeedWithPin).toHaveBeenCalledTimes(
        Math.min(attempt, 5),
      );
      expect(
        screen.getByText(
          attempt >= 5
            ? "Too many failed attempts. Please wait 15 minutes."
            : `Incorrect PIN. ${5 - attempt} attempt${attempt === 4 ? "" : "s"} remaining.`,
        ),
      ).toBeTruthy();
      expect(mockDappStore.currentApproval?.id).toBe(pending.id);
    }
    expect(checkLockout().isLocked).toBe(true);
    expect(approveRequestSpy).not.toHaveBeenCalled();
    expect(rejectRequestSpy).not.toHaveBeenCalled();
  },
);
