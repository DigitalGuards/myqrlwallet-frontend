import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/router/router", () => ({ ROUTES: { HOME: "/" } }));
jest.mock("@/config", () => ({ QRL_PROVIDER: {} }));
jest.mock("@/utils/nativeApp", () => ({ isInNativeApp: () => false }));
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
  walletMutations: { clear: jest.fn() },
}));
jest.mock("@/utils/storage/storage", () => ({ __esModule: true, default: {} }));
jest.mock("@/desktop/bridge", () => ({
  isDesktop: true,
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
import { secureDesktopLogout } from "@/utils/logout";

const lock = jest.mocked(desktopSigner.lock);
const clearAllSessions = jest.mocked(dappConnectService.clearAllSessions);

beforeEach(() => {
  jest.clearAllMocks();
  lock.mockResolvedValue({ hasWallet: true, locked: true, address: "Q" });
  clearAllSessions.mockResolvedValue(undefined);
});

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
