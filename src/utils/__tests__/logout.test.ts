/** @jest-environment jsdom */
import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const mockTerminateCryptoWorker = jest.fn();
let mockDesktop = true;
let mockNative = false;

jest.mock("@/router/router", () => ({ ROUTES: { HOME: "/" } }));
jest.mock("@/config", () => ({ QRL_PROVIDER: { TEST_NET_V3: {} } }));
jest.mock("@/config/runtimeProfile", () => ({ IS_V3_PROFILE: true }));
jest.mock("@/utils/embeddedShell", () => ({ reloadDocument: () => true }));
jest.mock("@/utils/nativeApp", () => ({
  isInNativeApp: () => mockNative,
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
jest.mock("@/utils/nativeWalletMutation", () => ({
  walletMutations: {
    clear: async (clear: () => Promise<void>, after: () => Promise<void>) => {
      await clear();
      await after();
      await clear();
    },
  },
}));
jest.mock("@/utils/storage/storage", () => ({
  __esModule: true,
  default: {
    clearActiveAccount: jest.fn(async () => undefined),
    clearTransactionValues: jest.fn(async () => undefined),
    clearAllEncryptedSeeds: jest.fn(),
    clearAccountList: jest.fn(),
  },
}));
jest.mock("@/desktop/bridge", () => ({
  get isDesktop() {
    return mockDesktop;
  },
  desktopSigner: {
    lock: jest.fn(async () => ({
      hasWallet: true,
      locked: true,
      address: "Q",
    })),
  },
}));
jest.mock("@/services/dappConnect/DAppConnectService", () => ({
  dappConnectService: { clearAllSessions: jest.fn(async () => undefined) },
}));

import { desktopSigner } from "@/desktop/bridge";
import { dappConnectService } from "@/services/dappConnect/DAppConnectService";
import { handleLogout, secureDesktopLogout } from "@/utils/logout";
import { transactionHistoryStore } from "@/stores/transactionHistoryStore";
import StorageUtil from "@/utils/storage/storage";

const lock = jest.mocked(desktopSigner.lock);
const clearAllSessions = jest.mocked(dappConnectService.clearAllSessions);

beforeEach(() => {
  jest.clearAllMocks();
  mockDesktop = true;
  mockNative = false;
  localStorage.clear();
  transactionHistoryStore.reload();
  lock.mockResolvedValue({ hasWallet: true, locked: true, address: "Q" });
  clearAllSessions.mockResolvedValue(undefined);
});

const details = {
  blockchain: "TEST_NET_V3",
  from: `Q${"a".repeat(128)}`,
  to: `Q${"b".repeat(128)}`,
  hash: `0x${"c".repeat(64)}`,
  amount: "1",
};

it("wipes all pending history with the web account list and preserves unrelated keys", async () => {
  mockDesktop = false;
  transactionHistoryStore.record(details);
  transactionHistoryStore.record({
    ...details,
    blockchain: "MAIN_NET",
    from: details.to,
  });
  localStorage.setItem("qrl:transaction-history:v1:broken", "{");
  localStorage.setItem("preferences", "keep");
  const navigate = jest.fn();
  await handleLogout(navigate);
  expect(StorageUtil.clearAccountList).toHaveBeenCalledWith("TEST_NET_V3");
  expect(transactionHistoryStore.getSnapshot().entries).toEqual([]);
  transactionHistoryStore.reload();
  expect(transactionHistoryStore.getSnapshot().entries).toEqual([]);
  expect(localStorage.length).toBe(1);
  expect(localStorage.getItem("preferences")).toBe("keep");
  expect(navigate).toHaveBeenCalledWith("/");
});

it.each(["native", "desktop"])(
  "preserves history when %s logout locks the wallet",
  async (runtime) => {
    mockDesktop = runtime === "desktop";
    mockNative = runtime === "native";
    const entry = transactionHistoryStore.record(details);
    await handleLogout(jest.fn());
    transactionHistoryStore.reload();
    expect(transactionHistoryStore.getSnapshot().entries).toEqual([entry]);
    expect(StorageUtil.clearAccountList).not.toHaveBeenCalled();
  },
);

describe("secure desktop logout", () => {
  it("locks the isolated signer before clearing relay sessions", async () => {
    const order: string[] = [];
    lock.mockImplementation(async () => {
      order.push("lock");
      return { hasWallet: true, locked: true, address: "Q" };
    });
    clearAllSessions.mockImplementation(async () => {
      order.push("sessions");
    });

    await expect(secureDesktopLogout()).resolves.toBeUndefined();
    expect(order).toEqual(["lock", "sessions"]);
  });

  it("does not touch relay state when signer locking fails", async () => {
    lock.mockRejectedValue(new Error("lock failed"));

    await expect(secureDesktopLogout()).rejects.toThrow("lock failed");
    expect(clearAllSessions).not.toHaveBeenCalled();
  });

  it("propagates session cleanup failure after the signer is locked", async () => {
    clearAllSessions.mockRejectedValue(new Error("cleanup failed"));

    await expect(secureDesktopLogout()).rejects.toThrow("cleanup failed");
    expect(lock).toHaveBeenCalledTimes(1);
  });
});
