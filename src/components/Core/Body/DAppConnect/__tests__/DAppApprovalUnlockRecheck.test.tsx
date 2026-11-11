/** @jest-environment jsdom */
// The PIN unlock takes a second or two. An account, network, provider or
// request change while it runs must stop the approval before anything is
// signed or broadcast, and the PIN accounting must stay exactly as it was.
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { configure, observable } from "mobx";
import DAppApprovalModal from "../DAppApprovalModal";
import DAppConnectStore from "@/stores/dappConnectStore";
import { dappConnectService } from "@/services/dappConnect/DAppConnectService";
import { quoteFees } from "@/stores/qrlStore";
import type { PendingDAppRequest } from "@/services/dappConnect/types";
import { decryptStoredSeedWithPin } from "@/utils/crypto";
import {
  getRemainingAttempts,
  recordFailedAttempt,
  recordSuccessfulAttempt,
} from "@/utils/crypto/pinAttemptTracker";
import { clearNativeInjectedPin } from "@/utils/nativeApp";
import { logger } from "@/utils/log";
import * as signing from "@/utils/signing";
import { deferred } from "@/test-utils/deferred";
import { mockReviewObservers } from "@/test-utils/reviewObserver";

const ADDRESS = `Q${"a".repeat(128)}`;
const OTHER_ADDRESS = `Q${"b".repeat(128)}`;
const SESSION = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const OTHER_SESSION = "ffffffff-bbbb-cccc-dddd-eeeeeeeeeeee";
const HEX_SEED = "00".repeat(48);
const TX_HASH = `0x${"c".repeat(64)}`;
const NATIVE_PIN = "123456";

let mockV3 = false;
let mockNativePin = "";
let mockDappStore: DAppConnectStore;

/** A PromiEvent stand-in: the approval subscribes, the test emits. */
class Broadcast {
  private readonly listeners = new Map<string, ((value: unknown) => void)[]>();
  on(event: string, listener: (value: unknown) => void): this {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
    return this;
  }
  emit(event: string, value: unknown): void {
    for (const listener of this.listeners.get(event) ?? []) listener(value);
  }
}

/** A class instance, like a Web3 provider, so the store keeps it by reference. */
class FakeProvider {
  readonly broadcasts: Broadcast[] = [];
  readonly requestManager = { send: jest.fn(() => Promise.resolve("0x301825")) };
  readonly getTransactionCount = jest.fn(() => Promise.resolve(1n));
  readonly estimateGas = jest.fn(() => Promise.resolve(21000n));
  readonly call = jest.fn(() => Promise.resolve("0x"));
  readonly accounts = {
    signTransaction: jest.fn(() =>
      Promise.resolve({ rawTransaction: "0x1234", transactionHash: TX_HASH }),
    ),
  };
  readonly sendSignedTransaction = jest.fn(() => {
    const broadcast = new Broadcast();
    this.broadcasts.push(broadcast);
    return broadcast;
  });
}

// The production store's annotations: an in-place edit keeps the object's
// identity, so only a direct read of the field sees it.
const mockQrlStore = observable(
  {
    activeAccount: { accountAddress: ADDRESS, lastSeen: 0, source: "seed" },
    qrlConnection: { blockchain: "TEST_NET" },
    qrlAccounts: { isLoading: false },
    qrlInstance: new FakeProvider(),
    activeNetwork: undefined,
    assertNetworkReady: jest.fn(() => Promise.resolve()),
    signingChainId: () => "0x301825",
  },
  {
    activeAccount: observable.struct,
    qrlConnection: observable.struct,
    qrlInstance: observable.struct,
    assertNetworkReady: false,
    signingChainId: false,
  },
);
const mockTokenStore = { tokenList: [] };

jest.mock("@/stores/store", () => ({
  useStore: () => ({
    dappConnectStore: mockDappStore,
    qrlStore: mockQrlStore,
    tokenStore: mockTokenStore,
  }),
}));
jest.mock("@/stores/qrlStore", () => ({ quoteFees: jest.fn() }));
jest.mock("@/services/dappConnect/DAppConnectService", () => ({
  DEFAULT_RELAY_URL: "https://relay.example",
  dappConnectService: {
    setHandlers: jest.fn(),
    getActiveSessions: () => [],
    reconnectAll: () => Promise.resolve(),
    rejectRequest: jest.fn(),
    approveRequest: jest.fn(),
    sessionNetworkError: () => null,
  },
}));
jest.mock("@/desktop/bridge", () => ({
  ...jest.requireActual<typeof import("@/desktop/bridge")>("@/desktop/bridge"),
  isDesktop: false,
}));
jest.mock("@/config", () => ({
  getExplorerTxUrl: () => "https://explorer.example/tx",
}));
jest.mock("@/config/runtimeProfile", () => ({
  get IS_V3_PROFILE() { return mockV3; },
  profileStorageKey: (key: string) => key,
}));
jest.mock("@/utils/crypto", () => ({
  decryptStoredSeedWithPin: jest.fn(),
  DeviceCredentialUnavailableError: class extends Error {},
}));
// The real limiter and tracker run; the two writes are observed.
jest.mock("@/utils/crypto/pinAttemptTracker", () => ({
  ...jest.requireActual<typeof import("@/utils/crypto/pinAttemptTracker")>(
    "@/utils/crypto/pinAttemptTracker",
  ),
  recordSuccessfulAttempt: jest.fn(),
  recordFailedAttempt: jest.fn(),
}));
jest.mock("@/utils/storage/storage", () => ({
  __esModule: true,
  default: {
    getBlockChain: () => Promise.resolve("TEST_NET"),
    getEncryptedSeed: () => Promise.resolve("fixture"),
  },
}));
// Always current, so the check under test is the only thing that can stop
// the signature.
jest.mock("@/utils/nativeWalletMutation", () => ({
  walletMutations: { captureGeneration: () => 0, isCurrent: () => true },
}));
jest.mock("@/utils/nativeApp", () => ({
  isIOSNativeApp: () => false,
  getNativeInjectedPin: () => mockNativePin,
  clearNativeInjectedPin: jest.fn(),
}));
jest.mock("@/hooks/useHasNativeInjectedPin", () => ({
  useHasNativeInjectedPin: () => Boolean(mockNativePin),
}));
jest.mock("@/utils/formatting", () => ({ formatQuantaValue: () => "0" }));
jest.mock("@/utils", () =>
  jest.requireActual<typeof import("@/utils/cn")>("@/utils/cn"),
);
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

const actualTracker = jest.requireActual<
  typeof import("@/utils/crypto/pinAttemptTracker")
>("@/utils/crypto/pinAttemptTracker");

const METHODS = [
  "qrl_sendTransaction",
  "qrl_signTransaction",
  "qrl_signMessage",
  "qrl_signTypedData",
] as const;
type Method = (typeof METHODS)[number];
const CHANGES = ["account", "network", "provider", "request"] as const;
type Change = (typeof CHANGES)[number];
/** Message and typed-data signing never use the provider. */
const isOffline = (method: Method): boolean =>
  method === "qrl_signMessage" || method === "qrl_signTypedData";
/**
 * Only a plain message signs with no provider check at all: the typed data
 * here carries a domain chainId, which was checked against the live provider.
 */
const ignoresProvider = (method: Method): boolean => method === "qrl_signMessage";

/** How the existing stale-wallet path answers the dApp for each method. */
const STALE_ANSWER: Record<Method, string> = {
  qrl_sendTransaction: "Transaction failed. Please verify details and try again.",
  qrl_signTransaction: "Transaction failed. Please verify details and try again.",
  qrl_signMessage:
    "Message signing failed: Wallet changed while preparing the request",
  qrl_signTypedData:
    "Typed data signing failed: Wallet changed while preparing the request",
};

const MESSAGE_RESULT: ReturnType<typeof signing.signMessage> = {
  signer: ADDRESS,
  signature: "0xab",
  publicKey: "0xcd",
  descriptor: "0x00",
  digest: "0xef",
  schemeVersion: signing.SCHEME_VERSION_MSG,
};

function requestParams(method: Method, changed = false): unknown[] {
  switch (method) {
    case "qrl_signMessage":
      return [ADDRESS, changed ? "0x776f726c64" : "0x68656c6c6f"];
    case "qrl_signTypedData":
      return [
        ADDRESS,
        {
          types: {
            QRLDomain: [
              { name: "name", type: "string" },
              { name: "chainId", type: "uint256" },
            ],
            Recipients: [{ name: "accounts", type: "address[]" }],
          },
          primaryType: "Recipients",
          domain: { name: "Unlock test", chainId: "3151909" },
          message: { accounts: changed ? [] : [ADDRESS] },
        },
      ];
    case "qrl_sendTransaction":
    case "qrl_signTransaction":
      return [{ from: ADDRESS, to: ADDRESS, value: changed ? "0x1" : "0x0" }];
  }
}

let visibility: ReturnType<typeof mockReviewObservers>;
let rejectRequestSpy: jest.SpiedFunction<typeof dappConnectService.rejectRequest>;
let approveRequestSpy: jest.SpiedFunction<typeof dappConnectService.approveRequest>;
let signMessageSpy: jest.SpiedFunction<typeof signing.signMessage>;
let signTypedDataSpy: jest.SpiedFunction<typeof signing.signTypedData>;
let logSpy: jest.SpiedFunction<typeof logger.log>;
/** Releases an unlock a failed test left waiting, so the limiter is free. */
let releaseUnlock: (() => void) | null = null;

beforeEach(() => {
  configure({ enforceActions: "never" });
  jest.useFakeTimers();
  jest.clearAllMocks();
  localStorage.clear();
  mockV3 = false;
  mockNativePin = "";
  mockQrlStore.activeAccount = { accountAddress: ADDRESS, lastSeen: 0, source: "seed" };
  mockQrlStore.qrlConnection = { blockchain: "TEST_NET" };
  mockQrlStore.qrlInstance = new FakeProvider();
  mockQrlStore.assertNetworkReady.mockReset().mockResolvedValue(undefined);
  jest.mocked(recordSuccessfulAttempt).mockReset()
    .mockImplementation(actualTracker.recordSuccessfulAttempt);
  jest.mocked(recordFailedAttempt).mockReset()
    .mockImplementation(actualTracker.recordFailedAttempt);
  jest.mocked(clearNativeInjectedPin).mockReset().mockImplementation(() => {
    mockNativePin = "";
  });
  jest.mocked(decryptStoredSeedWithPin).mockReset();
  jest.mocked(quoteFees).mockReset().mockResolvedValue({
    maxFeePerGas: 1n,
    maxPriorityFeePerGas: 1n,
    expectedFeePerGas: 1n,
  });
  signMessageSpy = jest.spyOn(signing, "signMessage").mockReturnValue(MESSAGE_RESULT);
  signTypedDataSpy = jest.spyOn(signing, "signTypedData").mockImplementation((payload) => ({
    ...MESSAGE_RESULT,
    schemeVersion: signing.typedDataSchemeVersion(payload),
    domain: payload.domain,
  }));
  logSpy = jest.spyOn(logger, "log").mockImplementation(() => undefined);
  visibility = mockReviewObservers();
  mockDappStore = new DAppConnectStore();
  rejectRequestSpy = jest.spyOn(dappConnectService, "rejectRequest");
  approveRequestSpy = jest.spyOn(dappConnectService, "approveRequest");
  // One earlier wrong PIN, so a recorded success is visible in storage.
  actualTracker.recordFailedAttempt();
});

afterEach(async () => {
  if (releaseUnlock) {
    const release = releaseUnlock;
    await act(async () => {
      release();
      await jest.advanceTimersByTimeAsync(1);
    });
  }
  releaseUnlock = null;
  cleanup();
  visibility.restore();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

/**
 * Show the request, approve it and stop inside the PIN unlock: the seed
 * decryption has started and nothing has been signed.
 */
async function approveIntoUnlock(method: Method) {
  const unlock = deferred<{ mnemonic: string; hexSeed: string }>();
  jest.mocked(decryptStoredSeedWithPin).mockReturnValueOnce(unlock.promise);
  releaseUnlock = () => { unlock.resolve({ mnemonic: "", hexSeed: HEX_SEED }); };
  const pending: PendingDAppRequest = {
    id: 1,
    sessionId: SESSION,
    method,
    params: requestParams(method),
    dappInfo: { name: "Test dApp", url: "https://dapp.example", chainId: "0x301825" },
    timestamp: Date.now(),
  };
  mockDappStore.pendingRequests = [pending];
  mockDappStore.currentApproval = pending;
  mockDappStore.approvalModalOpen = true;
  const provider = mockQrlStore.qrlInstance;
  render(<DAppApprovalModal />);
  await act(async () => { await jest.advanceTimersByTimeAsync(400); });
  if (!mockNativePin) {
    fireEvent.change(screen.getByPlaceholderText("Enter PIN"), {
      target: { value: "123456" },
    });
  }
  act(() => { visibility.settle(); });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await jest.advanceTimersByTimeAsync(1);
  });
  expect(decryptStoredSeedWithPin).toHaveBeenCalledTimes(1);
  expect(recordSuccessfulAttempt).not.toHaveBeenCalled();
  expect(getRemainingAttempts()).toBe(4);
  expectNothingSigned(provider);
  return { unlock, provider };
}

async function finishUnlock(unlock: ReturnType<typeof deferred<{ mnemonic: string; hexSeed: string }>>) {
  releaseUnlock = null;
  await act(async () => {
    unlock.resolve({ mnemonic: "", hexSeed: HEX_SEED });
    await jest.advanceTimersByTimeAsync(1);
  });
}

/**
 * Make the change, then let the wallet catch up (a new fee quote, a new chain
 * check, a re-render) before the unlock ends, as it does in a real unlock.
 */
async function applyChange(change: Change, method: Method): Promise<void> {
  await act(async () => {
    switch (change) {
      case "account":
        // In place: the account object keeps its identity.
        mockQrlStore.activeAccount.accountAddress = OTHER_ADDRESS;
        break;
      case "network":
        mockQrlStore.qrlConnection = { ...mockQrlStore.qrlConnection, blockchain: "MAIN_NET" };
        break;
      case "provider":
        mockQrlStore.qrlInstance = new FakeProvider();
        break;
      case "request": {
        const current = mockDappStore.currentApproval;
        if (!current) throw new Error("The approval is no longer current");
        current.params = requestParams(method, true);
        break;
      }
    }
    await jest.advanceTimersByTimeAsync(1);
  });
}

function expectNothingSigned(...providers: FakeProvider[]): void {
  expect(signMessageSpy).not.toHaveBeenCalled();
  expect(signTypedDataSpy).not.toHaveBeenCalled();
  for (const provider of providers) {
    expect(provider.accounts.signTransaction).not.toHaveBeenCalled();
    expect(provider.sendSignedTransaction).not.toHaveBeenCalled();
  }
}

/** The dApp got one rejection, from the existing stale-wallet path. */
function expectStaleAnswer(method: Method): void {
  expect(approveRequestSpy).not.toHaveBeenCalled();
  expect(rejectRequestSpy).toHaveBeenCalledTimes(1);
  expect(rejectRequestSpy).toHaveBeenCalledWith(SESSION, 1, STALE_ANSWER[method], -32603);
  if (method === "qrl_sendTransaction" || method === "qrl_signTransaction") {
    // The transaction answer is generic; the log keeps the cause.
    expect(logSpy).toHaveBeenCalledWith(
      "[DAppConnect] approval error:",
      "Wallet changed while preparing the request",
    );
  }
}

/** The unlock recorded one success, no failure, and kept a correct native PIN. */
function expectPinAccountedOnce(): void {
  expect(recordSuccessfulAttempt).toHaveBeenCalledTimes(1);
  expect(recordFailedAttempt).not.toHaveBeenCalled();
  expect(getRemainingAttempts()).toBe(5);
  expect(clearNativeInjectedPin).not.toHaveBeenCalled();
}

describe.each([
  { label: "web PIN, legacy profile", nativePin: "", v3: false },
  { label: "native injected PIN, v3 profile", nativePin: NATIVE_PIN, v3: true },
])("$label", ({ nativePin, v3 }) => {
  beforeEach(() => {
    mockNativePin = nativePin;
    mockV3 = v3;
  });

  it.each(METHODS.flatMap((method) => CHANGES
    .filter((change) => !(change === "provider" && ignoresProvider(method)))
    .map((change) => ({ method, change }))))(
    "$method: nothing is signed or broadcast when the $change changes during the PIN unlock",
    async ({ method, change }) => {
      const { unlock, provider } = await approveIntoUnlock(method);
      await applyChange(change, method);
      await finishUnlock(unlock);

      expectNothingSigned(provider, mockQrlStore.qrlInstance);
      expectStaleAnswer(method);
      expectPinAccountedOnce();
      expect(mockNativePin).toBe(nativePin);
    },
  );

  it.each(["qrl_sendTransaction", "qrl_signTransaction"] as const)(
    "%s: a provider replaced during the unlock is caught before the transaction is built",
    async (method) => {
      const { unlock, provider } = await approveIntoUnlock(method);
      const replacement = new FakeProvider();
      await act(async () => {
        mockQrlStore.qrlInstance = replacement;
        await jest.advanceTimersByTimeAsync(1);
      });
      await finishUnlock(unlock);

      // No nonce, fee or gas call reached either provider.
      expect(replacement.getTransactionCount).not.toHaveBeenCalled();
      expect(provider.getTransactionCount).not.toHaveBeenCalled();
      expectNothingSigned(provider, replacement);
      expectStaleAnswer(method);
      expectPinAccountedOnce();
    },
  );

  it.each(["qrl_sendTransaction", "qrl_signTransaction"] as const)(
    "%s: an account change while the transaction is built is caught before signing",
    async (method) => {
      const { unlock, provider } = await approveIntoUnlock(method);
      const nonce = deferred<bigint>();
      provider.getTransactionCount.mockReturnValueOnce(nonce.promise);
      await finishUnlock(unlock);
      // The unlock is over and the transaction is being built.
      expect(provider.getTransactionCount).toHaveBeenCalledTimes(1);
      await applyChange("account", method);
      await act(async () => {
        nonce.resolve(1n);
        await jest.advanceTimersByTimeAsync(1);
      });

      expectNothingSigned(provider);
      expectStaleAnswer(method);
      expectPinAccountedOnce();
    },
  );

  it.each(["qrl_signMessage"] as const)(
    "%s: a provider re-init during the unlock does not block the offline signature",
    async (method) => {
      const { unlock } = await approveIntoUnlock(method);
      await applyChange("provider", method);
      await finishUnlock(unlock);

      expectPinAccountedOnce();
      expect(signMessageSpy).toHaveBeenCalledTimes(1);
      expect(rejectRequestSpy).not.toHaveBeenCalled();
      expect(approveRequestSpy).toHaveBeenCalledTimes(1);
      expect(approveRequestSpy).toHaveBeenCalledWith(
        SESSION,
        1,
        expect.objectContaining({ signer: ADDRESS }),
      );
    },
  );

  // Only the v3 store clears the provider at the start of a switch.
  (v3 ? it : it.skip).each(METHODS)(
    "%s: a network switch still in progress when the unlock ends signs nothing",
    async (method) => {
      const { unlock, provider } = await approveIntoUnlock(method);
      // A real switch clears the provider first, then moves the network.
      await act(async () => {
        Reflect.set(mockQrlStore, "qrlInstance", undefined);
        mockQrlStore.qrlConnection = { ...mockQrlStore.qrlConnection, blockchain: "MAIN_NET" };
        await jest.advanceTimersByTimeAsync(1);
      });
      await finishUnlock(unlock);

      expectNothingSigned(provider);
      expectPinAccountedOnce();
      if (isOffline(method)) {
        expectStaleAnswer(method);
      } else {
        expect(approveRequestSpy).not.toHaveBeenCalled();
        expect(rejectRequestSpy).toHaveBeenCalledTimes(1);
        expect(rejectRequestSpy).toHaveBeenCalledWith(SESSION, 1, "Web3 not initialized", -32603);
      }
    },
  );

  it.each(METHODS)(
    "%s: a request replaced during the unlock signs nothing and leaves the next request alone",
    async (method) => {
      const { unlock, provider } = await approveIntoUnlock(method);
      const next: PendingDAppRequest = {
        id: 2,
        sessionId: OTHER_SESSION,
        method: "qrl_signMessage",
        params: requestParams("qrl_signMessage"),
        dappInfo: { name: "Other dApp", url: "https://other.example", chainId: "0x301825" },
        timestamp: Date.now(),
      };
      // As a session disconnect does: drop the request, promote the next one.
      await act(async () => {
        mockDappStore.pendingRequests = [next];
        mockDappStore.currentApproval = next;
        await jest.advanceTimersByTimeAsync(1);
      });
      await finishUnlock(unlock);

      expectNothingSigned(provider, mockQrlStore.qrlInstance);
      expectPinAccountedOnce();
      expect(approveRequestSpy).not.toHaveBeenCalled();
      for (const call of rejectRequestSpy.mock.calls) {
        expect(call.slice(0, 2)).toEqual([SESSION, 1]);
      }
      // The store keeps its own observable copy, so compare what identifies it.
      expect(mockDappStore.currentApproval?.sessionId).toBe(OTHER_SESSION);
      expect(mockDappStore.currentApproval?.id).toBe(2);
      expect(mockDappStore.pendingRequests).toEqual([next]);
    },
  );

  it("qrl_sendTransaction: a change while the transaction is signed is never broadcast", async () => {
    const method = "qrl_sendTransaction";
    const { unlock, provider } = await approveIntoUnlock(method);
    const signing = deferred<{ rawTransaction: string; transactionHash: string }>();
    provider.accounts.signTransaction.mockReturnValueOnce(signing.promise);
    await finishUnlock(unlock);
    await act(async () => { await jest.advanceTimersByTimeAsync(1); });
    // Signed, not yet broadcast.
    expect(provider.accounts.signTransaction).toHaveBeenCalledTimes(1);
    await applyChange("account", method);
    await act(async () => {
      signing.resolve({ rawTransaction: "0x1234", transactionHash: TX_HASH });
      await jest.advanceTimersByTimeAsync(1);
    });

    expect(provider.sendSignedTransaction).not.toHaveBeenCalled();
    expectStaleAnswer(method);
    expectPinAccountedOnce();
  });

  it.each(METHODS)("%s: signs once when nothing changed", async (method) => {
    const { unlock, provider } = await approveIntoUnlock(method);
    await finishUnlock(unlock);

    expectPinAccountedOnce();
    expect(signMessageSpy).toHaveBeenCalledTimes(method === "qrl_signMessage" ? 1 : 0);
    expect(signTypedDataSpy).toHaveBeenCalledTimes(method === "qrl_signTypedData" ? 1 : 0);
    expect(provider.accounts.signTransaction).toHaveBeenCalledTimes(
      method === "qrl_sendTransaction" || method === "qrl_signTransaction" ? 1 : 0,
    );
    expect(provider.sendSignedTransaction).toHaveBeenCalledTimes(
      method === "qrl_sendTransaction" ? 1 : 0,
    );
    if (method === "qrl_sendTransaction") {
      const [broadcast] = provider.broadcasts;
      if (!broadcast) throw new Error("Nothing was broadcast");
      await act(async () => {
        broadcast.emit("transactionHash", TX_HASH);
        broadcast.emit("receipt", { transactionHash: TX_HASH, status: 1n });
        await jest.advanceTimersByTimeAsync(1);
      });
    }
    expect(rejectRequestSpy).not.toHaveBeenCalled();
    expect(approveRequestSpy).toHaveBeenCalledTimes(1);
    expect(approveRequestSpy).toHaveBeenCalledWith(
      SESSION,
      1,
      method === "qrl_sendTransaction"
        ? TX_HASH
        : method === "qrl_signTransaction"
          ? "0x1234"
          : expect.objectContaining({ signer: ADDRESS }),
    );
  });
});

describe("answer codes for a web wallet that does not complete a request", () => {
  async function runToBroadcast(method: "qrl_sendTransaction") {
    const { unlock, provider } = await approveIntoUnlock(method);
    await finishUnlock(unlock);
    await act(async () => { await jest.advanceTimersByTimeAsync(50); });
    const [broadcast] = provider.broadcasts;
    if (!broadcast) throw new Error("The transaction was not broadcast");
    return { provider, broadcast };
  }

  it("answers -32603 when the broadcast ends without a hash", async () => {
    const { broadcast } = await runToBroadcast("qrl_sendTransaction");
    await act(async () => {
      broadcast.emit("receipt", { transactionHash: TX_HASH, status: "0x0" });
      await jest.advanceTimersByTimeAsync(1);
    });
    expect(rejectRequestSpy).toHaveBeenCalledTimes(1);
    expect(rejectRequestSpy).toHaveBeenCalledWith(
      SESSION, 1, expect.stringMatching(/^Transaction failed: /), -32603,
    );
  });

  it("answers -32603 when the outcome is unknown and no hash exists", async () => {
    const { broadcast } = await runToBroadcast("qrl_sendTransaction");
    await act(async () => {
      broadcast.emit("receipt", {});
      await jest.advanceTimersByTimeAsync(1);
    });
    expect(rejectRequestSpy).toHaveBeenCalledTimes(1);
    expect(rejectRequestSpy).toHaveBeenCalledWith(
      SESSION, 1, expect.stringContaining("confirmation is unavailable"), -32603,
    );
  });

  it("answers -32603 when signing yields no raw transaction", async () => {
    const { unlock, provider } = await approveIntoUnlock("qrl_sendTransaction");
    provider.accounts.signTransaction.mockReturnValueOnce(Promise.resolve({ rawTransaction: "", transactionHash: TX_HASH }));
    await finishUnlock(unlock);
    await act(async () => { await jest.advanceTimersByTimeAsync(50); });
    expect(rejectRequestSpy).toHaveBeenCalledWith(SESSION, 1, "Failed to sign transaction", -32603);
  });

  it.each(["qrl_signMessage", "qrl_signTypedData"] as const)(
    "answers %s with -32603 when the seed cannot be unlocked",
    async (method) => {
      const { unlock } = await approveIntoUnlock(method);
      releaseUnlock = null;
      await act(async () => {
        unlock.reject(new Error("storage failure"));
        await jest.advanceTimersByTimeAsync(1);
      });
      expect(rejectRequestSpy).toHaveBeenCalledTimes(1);
      expect(rejectRequestSpy).toHaveBeenCalledWith(
        SESSION, 1, "Failed to unlock the seed. Please try again.", -32603,
      );
    },
  );
});
