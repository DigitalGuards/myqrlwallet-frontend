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
import type { SignatureResult } from "@/desktop/bridge";
import type { PendingDAppRequest } from "@/services/dappConnect/types";

import { decryptStoredSeedWithPin } from "@/utils/crypto";
import { checkLockout, getRemainingAttempts } from "@/utils/crypto/pinAttemptTracker";
let mockDesktop = true;
const address = `Q${"a".repeat(128)}`;
let mockDappStore: DAppConnectStore;
const mockQrlStore = {
  activeAccount: { accountAddress: address },
  qrlConnection: { blockchain: "TEST_NET" },
  qrlAccounts: { isLoading: false },
  qrlInstance: { requestManager: { send: async () => "0x301825" } },
};

jest.mock("@/stores/store", () => ({
  useStore: () => ({ dappConnectStore: mockDappStore, qrlStore: mockQrlStore }),
}));
jest.mock("react-router", () => ({ useNavigate: () => jest.fn() }));
jest.mock("@/stores/qrlStore", () => ({
  quoteFees: async () => ({ maxFeePerGas: 1n, maxPriorityFeePerGas: 1n }),
}));
jest.mock("@/services/dappConnect/DAppConnectService", () => ({
  DEFAULT_RELAY_URL: "https://relay.example",
  dappConnectService: {
    setHandlers: jest.fn(),
    getActiveSessions: () => [],
    reconnectAll: async () => undefined,
    rejectRequest: jest.fn(),
    approveRequest: jest.fn(),
  },
}));
jest.mock("@/services/dappConnect/qrUri", () => ({
  parseConnectionURI: async () => ({ relayUrl: "https://relay.example" }),
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
jest.mock("@/utils/storage/storage", () => ({ __esModule: true, default: { getBlockChain: async () => "TEST_NET", getEncryptedSeed: async () => "fixture" } }));
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
  mockDappStore = new DAppConnectStore();
});
afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

async function showApproval(method: string): Promise<PendingDAppRequest> {
  const pending = request(method);
  mockDappStore.pendingRequests = [pending];
  mockDappStore.currentApproval = pending;
  mockDappStore.approvalModalOpen = true;
  render(<DAppApprovalModal />);
  await act(async () => {
    await jest.advanceTimersByTimeAsync(400);
  });
  return pending;
}

async function approve(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
  });
}

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
      expect(dappConnectService.rejectRequest).toHaveBeenCalledWith(
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
      expect(dappConnectService.rejectRequest).toHaveBeenCalledWith(
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
        expect(dappConnectService.rejectRequest).not.toHaveBeenCalled();
        const close = screen.getAllByRole("button", { name: "Close" })[0];
        if (!close) throw new Error("Close action missing");
        fireEvent.click(close);
        expect(dappConnectService.rejectRequest).toHaveBeenCalledWith(
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
      expect(dappConnectService.rejectRequest).toHaveBeenCalledWith(
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
      expect(dappConnectService.rejectRequest).not.toHaveBeenCalled();
      const next = request(method, 2);
      act(() => {
        mockDappStore.pendingRequests = [next];
        mockDappStore.currentApproval = next;
      });
      await act(async () => {
        rejectSigning(new Error("signer locked"));
      });
      expect(dappConnectService.rejectRequest).toHaveBeenCalledWith(
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
    expect(dappConnectService.approveRequest).not.toHaveBeenCalled();
    expect(dappConnectService.rejectRequest).not.toHaveBeenCalled();
  },
);
