/** @jest-environment jsdom */
import StorageUtil from "../storage";
import { clearAutoLockTimer, startAutoLockTimer } from "../autoLock";
import { desktopSigner } from "@/desktop/bridge";
import { handleLogout } from "@/utils/logout";

let mockDesktop = false;
jest.mock("@/config", () => ({
  QRL_PROVIDER: { TEST_NET: { id: "TEST_NET" } },
}));
jest.mock("@/config/runtimeProfile", () => ({
  IS_V3_PROFILE: false,
  profileStorageKey: (key: string) => key,
}));
jest.mock("@/utils/nativeApp", () => ({ isInNativeApp: () => false }));
jest.mock("@/desktop/bridge", () => ({
  get isDesktop() {
    return mockDesktop;
  },
  desktopSigner: { lock: jest.fn(() => Promise.resolve()) },
}));
jest.mock("@/utils/logout", () => ({
  handleLogout: jest.fn(() => Promise.resolve()),
}));
jest.mock("@/utils/log", () => ({
  logger: { log: jest.fn(), error: jest.fn() },
}));

beforeEach(async () => {
  jest.useFakeTimers({ now: 1_000_000 });
  jest.clearAllMocks();
  localStorage.clear();
  await StorageUtil.setActiveAccount("TEST_NET", `Q${"12".repeat(64)}`);
});

afterEach(() => {
  clearAutoLockTimer();
  jest.useRealTimers();
});

describe.each([false, true])("auto-lock with desktop=%s", (desktop) => {
  it.each([
    { autoLockTimeout: 1000, showTokensCard: "false" },
    { autoLockTimeout: "1000", showNftsCard: 0 },
    { autoLockTimeout: [1000], showTokensCard: {}, showNftsCard: [] },
  ])(
    "replaces the timer and locks with stored settings %j",
    async (settings) => {
      mockDesktop = desktop;
      const navigate = jest.fn();
      await StorageUtil.setWalletSettings({ autoLockTimeout: 900000 });
      await startAutoLockTimer(navigate);
      expect(jest.getTimerCount()).toBe(1);

      const raw = JSON.stringify({ value: settings, timestamp: Date.now() });
      localStorage.setItem("WALLET_SETTINGS", raw);
      await startAutoLockTimer(navigate);
      expect(jest.getTimerCount()).toBe(1);
      await jest.advanceTimersByTimeAsync(5000);

      expect(handleLogout).toHaveBeenCalledTimes(desktop ? 0 : 1);
      expect(jest.mocked(desktopSigner).lock.mock.calls).toHaveLength(
        desktop ? 1 : 0,
      );
      expect(jest.getTimerCount()).toBe(0);
      expect(localStorage.getItem("WALLET_SETTINGS")).toBe(raw);
    },
  );
});
