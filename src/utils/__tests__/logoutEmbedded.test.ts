/**
 * Logout in the app-shipped embedded build.
 *
 * The embedded document is served by no origin, so logout cannot reload; the
 * reload was the only thing dropping the module-level state that the native
 * branch of `handleLogout` deliberately leaves alone, including the plaintext
 * PIN the native app injects for prompt-free signing. These tests pin that the
 * in-place reset actually clears it.
 */
import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const mockTerminateCryptoWorker = jest.fn();

jest.mock("@/router/router", () => ({ ROUTES: { HOME: "/" } }));
jest.mock("@/config", () => ({ QRL_PROVIDER: {} }));
jest.mock("@/config/runtimeProfile", () => ({ IS_V3_PROFILE: false }));
jest.mock("@/utils/storage/storage", () => ({ __esModule: true, default: {} }));
jest.mock("@/desktop/bridge", () => ({
  isDesktop: false,
  desktopSigner: { lock: jest.fn(async () => undefined) },
}));
jest.mock("@/utils/nativeApp", () => ({
  // The embedded build always runs inside the native app.
  isInNativeApp: () => true,
  clearNativeInjectedPin: jest.fn(),
}));
// cryptoWorkerClient imports the worker module, which jest cannot evaluate
// (it references `self`). Only the terminator matters here.
jest.mock("@/utils/crypto/cryptoWorkerClient", () => ({
  terminateCryptoWorker: () => mockTerminateCryptoWorker(),
}));
jest.mock("@/utils/crypto/pinAttemptTracker", () => ({
  clearAttemptTracker: jest.fn(),
}));
jest.mock("@/utils/crypto/deviceCredential", () => ({
  clearDeviceCredential: jest.fn(async () => undefined),
}));
jest.mock("@/utils/mobileConnect/mobileConnection", () => ({
  disconnectMobile: jest.fn(async () => undefined),
  hasMobileSession: () => false,
}));
jest.mock("@/services/dappConnect/DAppConnectService", () => ({
  dappConnectService: { clearAllSessions: jest.fn(async () => undefined) },
}));
jest.mock("@/utils/embeddedShell", () => ({
  // The real one returns false in the embedded build, where its reload branch
  // does not survive minification.
  reloadDocument: jest.fn(() => false),
}));
jest.mock("@/utils/nativeWalletMutation", () => ({
  walletMutations: {
    clear: jest.fn(
      async (storage: () => Promise<void>, after: () => Promise<void>) => {
        await storage();
        await after();
      },
    ),
  },
}));
jest.mock("@/utils/embeddedRuntime", () => ({
  isEmbeddedRuntime: () => true,
  IS_EMBEDDED_BUILD: false,
}));

// jest hoists mock factories above these declarations, so the names it closes
// over must carry the `mock` prefix it allows.
const mockResetTransactionStatus = jest.fn();
const mockSetActiveAccount = jest.fn(
  async (_address?: string) => undefined,
);
const mockQrlStore: {
  resetTransactionStatus: () => void;
  setActiveAccount: (address?: string) => Promise<undefined>;
  activeAccount: { accountAddress: string; lastSeen: number; source: string };
} = {
  resetTransactionStatus: () => mockResetTransactionStatus(),
  setActiveAccount: (address?: string) => mockSetActiveAccount(address),
  activeAccount: { accountAddress: "Q01", lastSeen: 1, source: "seed" },
};
jest.mock("@/stores/store", () => ({ store: { qrlStore: mockQrlStore } }));

import { reloadDocument } from "@/utils/embeddedShell";
import { clearNativeInjectedPin } from "@/utils/nativeApp";
import { clearAttemptTracker } from "@/utils/crypto/pinAttemptTracker";
import { clearDeviceCredential } from "@/utils/crypto/deviceCredential";
import { handleLogout } from "@/utils/logout";

const pinCleared = jest.mocked(clearNativeInjectedPin);
const trackerCleared = jest.mocked(clearAttemptTracker);
const deviceKeyCleared = jest.mocked(clearDeviceCredential);

beforeEach(() => {
  jest.clearAllMocks();
  deviceKeyCleared.mockResolvedValue(undefined);
  mockSetActiveAccount.mockResolvedValue(undefined);
  mockQrlStore.activeAccount = { accountAddress: "Q01", lastSeen: 1, source: "seed" };
});

describe("embedded logout", () => {
  it("clears the native-injected PIN", async () => {
    const navigate = jest.fn();
    await handleLogout(navigate);

    expect(pinCleared).toHaveBeenCalledTimes(1);
  });

  it("keeps the saved PIN lockout counter", async () => {
    // The native logout path keeps it on purpose. Clearing it would make
    // logging out a way to reset the failed-attempt count and lift a lockout.
    await handleLogout(jest.fn());

    expect(trackerCleared).not.toHaveBeenCalled();
  });

  it("drops the cached device key and the wallet state in memory", async () => {
    await handleLogout(jest.fn());

    expect(deviceKeyCleared).toHaveBeenCalledTimes(1);
    expect(mockResetTransactionStatus).toHaveBeenCalledTimes(1);
    expect(mockSetActiveAccount).toHaveBeenCalledWith(undefined);
  });

  it("navigates home without reloading the document", async () => {
    const navigate = jest.fn();
    // There is no `window` under the node test environment, so a reload would
    // throw rather than pass silently.
    await expect(handleLogout(navigate)).resolves.toBeUndefined();
    expect(navigate).toHaveBeenCalledWith("/");
  });

  it("clears the secrets before anything that can fail", async () => {
    deviceKeyCleared.mockRejectedValue(new Error("device key clear failed"));
    mockSetActiveAccount.mockRejectedValue(new Error("store reset failed"));

    await expect(handleLogout(jest.fn())).resolves.toBeUndefined();

    // A rejection here would surface as an unhandled rejection: every caller
    // fires handleLogout and forgets it.
    expect(pinCleared).toHaveBeenCalledTimes(1);
    expect(trackerCleared).not.toHaveBeenCalled();
  });

  it("tears down the crypto worker pool", async () => {
    // The reload used to do this unconditionally on web and desktop.
    await handleLogout(jest.fn());

    expect(mockTerminateCryptoWorker).toHaveBeenCalledTimes(1);
  });

  it("drops the in-memory account even if the v3 assertion throws", async () => {
    mockSetActiveAccount.mockRejectedValue(
      new Error("Testnet v3 supports this web wallet and updated releases"),
    );

    await expect(handleLogout(jest.fn())).resolves.toBeUndefined();

    expect(mockQrlStore.activeAccount).toEqual({
      accountAddress: "",
      lastSeen: 0,
      source: "seed",
    });
  });

  it("never reloads the document", async () => {
    await handleLogout(jest.fn());

    // reloadDocument() is the single choke point, and in the embedded build
    // its reload branch is removed at build time. The build additionally
    // asserts the emitted document contains no location.reload() at all.
    expect(reloadDocument).toHaveBeenCalledTimes(1);
    expect(reloadDocument).toHaveReturnedWith(false);
  });
});
