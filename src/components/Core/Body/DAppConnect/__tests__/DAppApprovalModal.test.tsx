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
import { RequestHandler } from "@/services/dappConnect/RequestHandler";
import { desktopSigner } from "@/desktop/bridge";
import { quoteFees, type FeeQuote } from "@/stores/qrlStore";
import type { SignatureResult } from "@/desktop/bridge";
import type { PendingDAppRequest } from "@/services/dappConnect/types";

import { decryptStoredSeedWithPin } from "@/utils/crypto";
import { checkLockout, getRemainingAttempts } from "@/utils/crypto/pinAttemptTracker";
import { PinVerificationError } from "@/utils/crypto/verifyPinWithLimit";
import { logger } from "@/utils/log";
import { mockReviewObservers } from "@/test-utils/reviewObserver";
import { deferred } from "@/test-utils/deferred";
import { SignTypedDataParamsSchema } from "@/utils/signing";
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

function request(method: string, id: string | number = 1): PendingDAppRequest {
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
          : method === "wallet_switchQrlChain" || method === "wallet_addQrlChain"
            ? [{ chainId: "0x301825" }]
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

describe.each([false, true])("typed-data chain check (desktop=%s)", (desktop) => {
  let signTypedDataSpy: jest.SpiedFunction<typeof desktopSigner.signTypedData>;
  beforeEach(() => { mockDesktop = desktop; });

  function attemptBlockedApproval() {
    const button = screen.getByRole("button", { name: "Approve" });
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(button.getAttribute("type")).toBe("button");
    fireEvent.click(button);
    fireEvent.keyDown(button, { key: "Enter" });
    fireEvent.submit(screen.getByRole("dialog"));
    if (!desktop) {
      const input = screen.getByPlaceholderText("Enter PIN");
      fireEvent.change(input, { target: { value: "123456" } });
      fireEvent.keyDown(input, { key: "Enter" });
      fireEvent.change(input, { target: { value: "" } });
    }
    expect(decryptStoredSeedWithPin).not.toHaveBeenCalled();
    expect(signTypedDataSpy).not.toHaveBeenCalled();
    expect(approveRequestSpy).not.toHaveBeenCalled();
    expect(rejectRequestSpy).not.toHaveBeenCalled();
    expect(screen.queryByText("Please enter your PIN")).toBeNull();
  }

  beforeEach(() => {
    signTypedDataSpy = jest.spyOn(desktopSigner, "signTypedData").mockReturnValue(new Promise(() => undefined));
  });

  it.each(["0x301825", "0x1"])("waits for %s and requires any new mismatch warning to be seen", async (chainId) => {
    visibility.hold();
    const read = deferred<string>();
    const send = jest.spyOn(mockQrlStore.qrlInstance.requestManager, "send").mockReturnValueOnce(read.promise);
    await showApproval("qrl_signTypedData");
    act(() => { visibility.emit(); });
    expect(screen.getByText("Checking the network...")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Approve" }).getAttribute("aria-describedby")).toBe("approval-chain-hint");
    attemptBlockedApproval();
    const oldTargets = visibility.targets;
    await act(async () => { read.resolve(chainId); await read.promise; });
    expect(screen.queryByText("Checking the network...")).toBeNull();
    if (chainId === "0x1") {
      const warning = screen.getByRole("alert");
      expect(warning.textContent).toContain("differs from the connected chain (1)");
      expect(warning.hasAttribute("data-review-block")).toBe(true);
      act(() => { visibility.emitQueued(oldTargets); });
      attemptBlockedApproval();
      act(() => { visibility.emit(visibility.targets.filter((target) => target.parentElement === warning)); });
    } else {
      expect(screen.queryByRole("alert")).toBeNull();
    }
    expect(send).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Approve" }).hasAttribute("disabled")).toBe(false);
    await approve();
    if (desktop) expect(signTypedDataSpy).toHaveBeenCalledTimes(1);
    else expect(screen.getByText("Please enter your PIN")).toBeTruthy();
  });

  it("blocks a failed check and keeps retry pending until it succeeds", async () => {
    const error = new Error("RPC unavailable");
    const warn = jest.spyOn(logger, "warn").mockImplementation(() => undefined);
    const retry = deferred<string>();
    const send = jest.spyOn(mockQrlStore.qrlInstance.requestManager, "send")
      .mockRejectedValueOnce(error).mockReturnValueOnce(retry.promise);
    await showApproval("qrl_signTypedData");
    expect(warn).toHaveBeenCalledWith(
      "[DAppConnect] Could not read the wallet chain id for typed-data review:", error,
    );
    const failure = screen.getByRole("alert");
    expect(failure.textContent).toBe("The wallet could not check its network, so this request cannot be approved yet.");
    expect(failure.hasAttribute("data-review-block")).toBe(true);
    attemptBlockedApproval();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    act(() => { visibility.settle(); });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(screen.getByText("Checking the network...")).toBeTruthy();
    attemptBlockedApproval();
    await act(async () => { retry.resolve("0x301825"); await retry.promise; });
    act(() => { visibility.settle(); });
    expect(send).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: "Approve" }).hasAttribute("disabled")).toBe(false);
  });

  it("preserves approval for a domain without chainId and makes no chain read", async () => {
    const send = jest.spyOn(mockQrlStore.qrlInstance.requestManager, "send");
    const params = SignTypedDataParamsSchema.parse(request("qrl_signTypedData").params);
    params[1].types["QRLDomain"] = [{ name: "name", type: "string" }];
    delete params[1].domain["chainId"];
    await showApproval("qrl_signTypedData", params);
    expect(send).not.toHaveBeenCalled();
    expect(screen.queryByText("Checking the network...")).toBeNull();
    expect(screen.getByText("This domain has no chain ID. The signature is not bound to a chain.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Approve" }).hasAttribute("disabled")).toBe(false);
  });

  it("checks a zero chain ID", async () => {
    jest.spyOn(mockQrlStore.qrlInstance.requestManager, "send").mockReturnValueOnce(new Promise(() => undefined));
    const params = SignTypedDataParamsSchema.parse(request("qrl_signTypedData").params);
    params[1].domain["chainId"] = 0;
    await showApproval("qrl_signTypedData", params);
    expect(screen.getByText("Checking the network...")).toBeTruthy();
    attemptBlockedApproval();
  });

  it.each(["resolve", "reject"])("ignores a late %s after an identical request replaces the review", async (outcome) => {
    const old = deferred<string>();
    const next = deferred<string>();
    const send = jest.spyOn(mockQrlStore.qrlInstance.requestManager, "send")
      .mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    await showApproval("qrl_signTypedData");
    act(() => {
      const replacement = request("qrl_signTypedData");
      mockDappStore.pendingRequests = [replacement];
      mockDappStore.currentApproval = replacement;
    });
    await act(async () => {
      if (outcome === "reject") old.reject(new Error("Old network failed"));
      else old.resolve("0x1");
      await Promise.resolve();
    });
    act(() => { visibility.settle(); });
    expect(send).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(screen.getByText("Checking the network...")).toBeTruthy();
    attemptBlockedApproval();
    await act(async () => { next.resolve("0x301825"); await next.promise; });
    act(() => { visibility.settle(); });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Approve" }).hasAttribute("disabled")).toBe(false);
  });
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

describe("network request details", () => {
  it.each(["0x003018aB", `0x${"aB".repeat(32)}`])(
    "shows the validated switch ID %s as received without reading the network",
    async (chainId) => {
      const send = jest.spyOn(mockQrlStore.qrlInstance.requestManager, "send");
      const params = [{ chainId }];
      RequestHandler.validateRestrictedRequest("wallet_switchQrlChain", params);
      await showApproval("wallet_switchQrlChain", params);
      const value = screen.getByText(chainId);
      expect(value.getAttribute("dir")).toBe("ltr");
      expect(value.classList.contains("font-mono")).toBe(true);
      expect(value.closest("[data-review-block]")?.textContent).toBe(`Requested chain ID${chainId}`);
      expect(screen.queryByText("Wallet chain ID")).toBeNull();
      expect(send).not.toHaveBeenCalled();
    },
  );

  it.each(["wallet_switchQrlChain", "wallet_addQrlChain"])(
    "%s never renders extra chainName or rpcUrls with bidi controls and a 10 kB string",
    async (method) => {
      const chainId = "0x003018aB";
      const chainName = "Untrusted network name";
      const rpcUrls = ["https://rpc.example/\u202euntrusted-network", "x".repeat(10 * 1024)];
      const params = [{ chainId, chainName, rpcUrls }];
      if (method === "wallet_switchQrlChain") {
        RequestHandler.validateRestrictedRequest(method, params);
      }
      await showApproval(method, params);
      const dialog = screen.getByRole("dialog");
      expect(screen.getByRole("region", { name: "Request details" }).textContent).toBe(
        method === "wallet_switchQrlChain" ? `Requested chain ID${chainId}` : "",
      );
      for (const untrusted of ["chainName", "rpcUrls", chainName, ...rpcUrls, "\u202e"]) {
        expect(dialog.outerHTML).not.toContain(untrusted);
      }
      expect(dialog.querySelector("pre")).toBeNull();
      if (method === "wallet_addQrlChain") expect(dialog.outerHTML).not.toContain(chainId);
    },
  );

  it.each([undefined, "0x", "0x12\u202e34", `0x${"f".repeat(65)}`, 123])(
    "omits an unvalidated switch ID (%s)",
    async (chainId) => {
      await showApproval("wallet_switchQrlChain", [{ chainId }]);
      expect(screen.getByRole("region", { name: "Request details" }).textContent).toBe("");
    },
  );

  it("requires fresh visibility when the requested switch ID changes", async () => {
    visibility.hold();
    await showApproval("wallet_switchQrlChain");
    act(() => { visibility.emit(); });
    expect(screen.getByRole("button", { name: "Approve" }).hasAttribute("disabled")).toBe(false);
    act(() => {
      const approval = mockDappStore.currentApproval;
      if (approval) approval.params = [{ chainId: "0x003018aB" }];
      fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    });
    expect(approveRequestSpy).not.toHaveBeenCalled();
    expect(rejectRequestSpy).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Approve" }).hasAttribute("disabled")).toBe(true);
    act(() => {
      visibility.emit(visibility.targets.filter((target) => target.parentElement?.textContent === "Requested chain ID0x003018aB"));
    });
    expect(screen.getByRole("button", { name: "Approve" }).hasAttribute("disabled")).toBe(false);
  });

  it.each([false, true])("keeps add-network rejection (desktop=%s)", async (desktop) => {
    mockDesktop = desktop;
    const pending = await showApproval("wallet_addQrlChain");
    await approve();
    expect(rejectRequestSpy).toHaveBeenCalledWith(
      pending.sessionId, pending.id, "Adding networks is not supported by this wallet", 4200,
    );
    expect(approveRequestSpy).not.toHaveBeenCalled();
  });

  it.each([
    { desktop: false, chainId: "0x00301825", accepted: true },
    { desktop: false, chainId: "0x1", accepted: false },
    { desktop: true, chainId: "0x301825", accepted: false },
  ])("keeps switch behavior for $chainId (desktop=$desktop)", async ({ desktop, chainId, accepted }) => {
    mockDesktop = desktop;
    const pending = await showApproval("wallet_switchQrlChain", [{ chainId }]);
    await approve();
    if (accepted) {
      expect(approveRequestSpy).toHaveBeenCalledWith(pending.sessionId, pending.id, null);
      expect(rejectRequestSpy).not.toHaveBeenCalled();
    } else {
      expect(rejectRequestSpy).toHaveBeenCalledWith(pending.sessionId, pending.id, expect.any(String), 4902);
      expect(approveRequestSpy).not.toHaveBeenCalled();
    }
  });
});

describe('visibility gate', () => {
  function collisionRequest(second: boolean, id: string | number) {
    const pending = request('qrl_signTypedData', id);
    pending.params = [address, {
      types: {
        QRLDomain: [{ name: 'name', type: 'string' }, { name: 'chainId', type: 'uint256' }],
        Review: [{ name: 'prefix', type: 'string' }, { name: 'order', type: 'Order' }],
        Order: second ? [{ name: 'a1b', type: 'uint256' }]
          : [{ name: 'a', type: 'uint256' }, { name: 'b', type: 'uint256' }],
      },
      primaryType: 'Review',
      domain: { name: 'Example', chainId: '3151909' },
      message: { prefix: 'Visible review context '.repeat(150), order: second ? { a1b: 23 } : { a: 1, b: 23 } },
    }];
    return pending;
  }

  it.each(['1', 1, 'other'])('starts fresh after rejecting a queued collision request with ID %p', async (id) => {
    visibility.hold();
    mockDesktop = false;
    const first = collisionRequest(false, 1);
    const second = collisionRequest(true, id);
    RequestHandler.validateRestrictedRequest(first.method, first.params);
    RequestHandler.validateRestrictedRequest(second.method, second.params);
    const signing = await import('@/utils/signing');
    const digest = (pending: PendingDAppRequest) => signing.computeTypedDataDigest(signing.SignTypedDataParamsSchema.parse(pending.params)[1]);
    expect(digest(first)).not.toEqual(digest(second));
    await showApproval(first.method, first.params);
    act(() => { visibility.emit(); });
    expect(screen.getByRole('button', { name: 'Approve' }).hasAttribute('disabled')).toBe(false);
    const oldTargets = visibility.targets;
    // The real store queue rejects numeric 1 independently of string "1".
    // Reuse of the same envelope ID is also a fresh review object.
    if (id === 1) {
      fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
      act(() => {
        mockDappStore.pendingRequests = [second];
        mockDappStore.currentApproval = second;
        mockDappStore.approvalModalOpen = true;
      });
    } else {
      act(() => { mockDappStore.pendingRequests.push(second); });
      fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    }
    await act(async () => { await jest.advanceTimersByTimeAsync(400); });
    expect(mockDappStore.currentApproval?.id).toBe(id);
    act(() => { visibility.emitQueued(oldTargets); });
    expect(screen.getByRole('button', { name: 'Approve' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(screen.queryByText('Please enter your PIN')).toBeNull();
    expect(decryptStoredSeedWithPin).not.toHaveBeenCalled();
    act(() => { visibility.emit(); });
    await approve();
    expect(screen.getByText('Please enter your PIN')).toBeTruthy();
  });

  it('re-gates a colliding typed subtree edited in place, including its type definition', async () => {
    visibility.hold();
    const first = collisionRequest(false, 1);
    await showApproval(first.method, first.params);
    act(() => { visibility.emit(); });
    const oldTargets = visibility.targets;
    act(() => {
      const approval = mockDappStore.currentApproval;
      if (approval) approval.params = collisionRequest(true, 1).params;
    });
    act(() => { visibility.emitQueued(oldTargets); });
    expect(screen.getByRole('button', { name: 'Approve' }).hasAttribute('disabled')).toBe(true);
    act(() => { visibility.emit(); });
    expect(screen.getByRole('button', { name: 'Approve' }).hasAttribute('disabled')).toBe(false);
  });

  it('rejects a same-tick replacement object with identical content before React commits', async () => {
    mockDesktop = false;
    await showApproval('qrl_signMessage');
    fireEvent.change(screen.getByPlaceholderText('Enter PIN'), { target: { value: '123456' } });
    act(() => {
      mockDappStore.currentApproval = request('qrl_signMessage');
      fireEvent.keyDown(screen.getByPlaceholderText('Enter PIN'), { key: 'Enter' });
    });
    expect(decryptStoredSeedWithPin).not.toHaveBeenCalled();
  });

  it('starts a fresh consent when the same URI is staged again', async () => {
    visibility.hold();
    mockDappStore.desktopConnectUri = 'qrlconnect://?q=fixture';
    render(<DAppConnectConsentModal />);
    await act(async () => { await jest.advanceTimersByTimeAsync(400); });
    act(() => { visibility.emit(); });
    expect(screen.getByRole('button', { name: 'Connect' }).hasAttribute('disabled')).toBe(false);
    const stale = visibility.targets;
    act(() => { mockDappStore.desktopConnectReview = {}; });
    act(() => { visibility.emitQueued(stale); });
    expect(screen.getByRole('button', { name: 'Connect' }).hasAttribute('disabled')).toBe(true);
  });

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
  it.each(['qrl_sendTransaction', 'qrl_signTransaction', 'qrl_signMessage', 'qrl_signTypedData', 'wallet_addQrlChain'])('%s', async (method) => {
    await showApproval(method);
    snapshot('Approve');
  });
  // These two screens add the account address and validated switch ID to the base.
  it.each(['qrl_requestAccounts', 'wallet_switchQrlChain'])('%s', async (method) => {
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
