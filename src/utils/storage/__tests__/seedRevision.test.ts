jest.mock("@/config", () => ({
  QRL_PROVIDER: {
    TEST_NET: { id: "TEST_NET" },
    MAIN_NET: { id: "MAIN_NET" },
  },
}));

jest.mock("@/utils/logout", () => ({ handleLogout: jest.fn() }));

import StorageUtil, {
  type EncryptedSeedData,
  STORAGE_EVENT_ACTIVE_ACCOUNT,
  STORAGE_EVENT_WALLET_SETTINGS,
} from "../storage";
import { advanceWalletEpoch, getWalletEpoch } from "@/utils/walletEpoch";
import { deferred } from "@/test-utils/deferred";
import { malformed } from "@/test-utils/malformed";
import { logger } from "@/utils/log";
import { handleLogout } from "@/utils/logout";
import {
  clearAutoLockTimer,
  hasActiveWallet,
  setupActivityTracking,
  startAutoLockTimer,
  updateLastActivity,
} from "../autoLock";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  onSet: ((key: string) => void) | null = null;

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
    this.onSet?.(key);
  }
}

const originalLocalStorage = Object.getOwnPropertyDescriptor(
  globalThis,
  "localStorage",
);
const ADDRESS = `Q${"12".repeat(64)}`;

describe("encrypted seed revision merge", () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: storage,
    });
  });

  afterAll(() => {
    if (originalLocalStorage) {
      Object.defineProperty(globalThis, "localStorage", originalLocalStorage);
    } else {
      Reflect.deleteProperty(globalThis, "localStorage");
    }
  });

  it("increments revisions only on ciphertext writes", async () => {
    const first = await StorageUtil.storeEncryptedSeed(
      "TEST_NET",
      ADDRESS,
      "cipher-1",
    );
    expect(first.revision).toBe(1);

    await expect(
      StorageUtil.getEncryptedSeed("TEST_NET", ADDRESS),
    ).resolves.toBe("cipher-1");
    expect(
      (await StorageUtil.getAllEncryptedSeeds("TEST_NET"))[0]?.revision,
    ).toBe(1);

    const second = await StorageUtil.storeEncryptedSeed(
      "TEST_NET",
      ADDRESS,
      "cipher-2",
    );
    expect(second.revision).toBe(2);
  });

  it("never lets an equal or older native revision overwrite live local state", async () => {
    await StorageUtil.storeEncryptedSeed("TEST_NET", ADDRESS, "local-v1");
    await StorageUtil.storeEncryptedSeed("TEST_NET", ADDRESS, "local-v2");

    await expect(
      StorageUtil.restoreEncryptedSeedIfNewer(
        "TEST_NET",
        ADDRESS,
        "native-stale",
        1,
      ),
    ).resolves.toBe("skipped");
    await expect(
      StorageUtil.restoreEncryptedSeedIfNewer(
        "TEST_NET",
        ADDRESS,
        "native-conflict",
        2,
      ),
    ).resolves.toBe("skipped");
    expect(
      (await StorageUtil.getAllEncryptedSeeds("TEST_NET"))[0]?.encryptedSeed,
    ).toBe("local-v2");

    await expect(
      StorageUtil.restoreEncryptedSeedIfNewer(
        "TEST_NET",
        ADDRESS,
        "native-newer",
        3,
      ),
    ).resolves.toBe("stored");
    expect(
      (await StorageUtil.getAllEncryptedSeeds("TEST_NET"))[0],
    ).toMatchObject({
      encryptedSeed: "native-newer",
      revision: 3,
    });
  });

  it("allows a revision-0 legacy backup only when the local slot is missing", async () => {
    await expect(
      StorageUtil.restoreEncryptedSeedIfNewer(
        "MAIN_NET",
        ADDRESS,
        "legacy-native",
        0,
      ),
    ).resolves.toBe("stored");
    await expect(
      StorageUtil.restoreEncryptedSeedIfNewer(
        "MAIN_NET",
        ADDRESS,
        "other-legacy",
        0,
      ),
    ).resolves.toBe("skipped");
    expect(
      (await StorageUtil.getAllEncryptedSeeds("MAIN_NET"))[0]?.encryptedSeed,
    ).toBe("legacy-native");
  });

  it("compare-and-swaps a full network snapshot and rejects a stale writer", async () => {
    const first = await StorageUtil.storeEncryptedSeed(
      "TEST_NET",
      ADDRESS,
      "cipher-1",
    );
    const snapshot = await StorageUtil.getAllEncryptedSeeds("TEST_NET");
    const replacement: EncryptedSeedData[] = [
      { ...first, encryptedSeed: "cipher-2", revision: 2 },
    ];
    await expect(
      StorageUtil.replaceEncryptedSeedSetIfUnchanged(
        "TEST_NET",
        snapshot,
        replacement,
      ),
    ).resolves.toBe(true);
    await expect(
      StorageUtil.replaceEncryptedSeedSetIfUnchanged("TEST_NET", snapshot, [
        { ...first, encryptedSeed: "cipher-3", revision: 3 },
      ]),
    ).resolves.toBe(false);
  });

  it("keeps incomplete seed records visible to inventory and native revision checks", async () => {
    const records = [
      { address: ADDRESS, encryptedSeed: "local", revision: 7 },
      { address: "another-account", extra: { preserved: true } },
    ];
    const raw = JSON.stringify({ value: records, timestamp: Date.now() });
    localStorage.setItem("TEST_NET_ENCRYPTED_SEEDS", raw);

    await expect(StorageUtil.getAllEncryptedSeeds("TEST_NET")).resolves.toEqual(records);
    await expect(StorageUtil.hasEncryptedSeeds("TEST_NET")).resolves.toBe(true);
    await expect(
      StorageUtil.restoreEncryptedSeedIfNewer("TEST_NET", ADDRESS, "stale", 7),
    ).resolves.toBe("skipped");
    expect(localStorage.getItem("TEST_NET_ENCRYPTED_SEEDS")).toBe(raw);

    const writeStarted = Date.now();
    await StorageUtil.storeEncryptedSeed("TEST_NET", ADDRESS, "updated");
    const updated = await StorageUtil.getAllEncryptedSeeds("TEST_NET");
    expect(updated).toHaveLength(2);
    expect(updated[0]?.lastAccessed).toBeGreaterThanOrEqual(writeStarted);
    expect(updated).toMatchObject([
      {
        ...records[0],
        encryptedSeed: "updated",
        revision: 8,
        walletEpoch: getWalletEpoch(),
      },
      { ...records[1], walletEpoch: getWalletEpoch() },
    ]);
  });

  it("preserves stored numeric balances and partial token and NFT records", async () => {
    const balances = { [ADDRESS]: 123.5, other: "0x10", zero: 0 };
    const token = { address: "token", amount: 12, extra: "kept" };
    const nft = { contractAddress: "nft", tokenId: 3, balance: 2, extra: "kept" };
    const entries: [string, unknown][] = [
      ["TEST_NET_BALANCE_CACHE", balances],
      [`TEST_NET_${ADDRESS.toLowerCase()}_TOKEN_LIST`, [token]],
      [`TEST_NET_${ADDRESS.toLowerCase()}_NFT_LIST`, [nft]],
    ];
    const rawEntries = entries.map(([key, value]): [string, string] => [
      key,
      JSON.stringify({ value, timestamp: String(Date.now()) }),
    ]);
    for (const [key, raw] of rawEntries) localStorage.setItem(key, raw);

    await expect(StorageUtil.getBalanceCache("TEST_NET")).resolves.toEqual(balances);
    await expect(StorageUtil.getTokenList("TEST_NET", ADDRESS)).resolves.toEqual([token]);
    await expect(StorageUtil.getNftList("TEST_NET", ADDRESS)).resolves.toEqual([nft]);
    for (const [key, raw] of rawEntries) expect(localStorage.getItem(key)).toBe(raw);
  });

  it("writes ciphertext synchronously before its returned promise settles", async () => {
    const promise = StorageUtil.storeEncryptedSeed("TEST_NET", ADDRESS, "cipher");
    const raw = localStorage.getItem("TEST_NET_ENCRYPTED_SEEDS");
    expect(raw).toContain('"encryptedSeed":"cipher"');
    await expect(promise).resolves.toMatchObject({ revision: 1 });
  });

  it("rejects storage exceptions through the returned promise", async () => {
    const failure = new Error("Storage unavailable");
    storage.onSet = () => { throw failure; };
    let promise: Promise<void> | undefined;
    expect(() => { promise = StorageUtil.setActivePage("/home"); }).not.toThrow();
    await expect(promise).rejects.toBe(failure);
  });

  it("removes its exact late seed write when another tab advances the epoch", async () => {
    const expectedEpoch = getWalletEpoch();
    storage.onSet = (key) => {
      if (!key.endsWith("_ENCRYPTED_SEEDS")) return;
      storage.onSet = null;
      advanceWalletEpoch();
    };

    await expect(
      StorageUtil.storeEncryptedSeed(
        "TEST_NET",
        ADDRESS,
        "late-ciphertext",
        expectedEpoch,
      ),
    ).rejects.toThrow("Wallet identity changed");
    await expect(StorageUtil.getAllEncryptedSeeds("TEST_NET")).resolves.toEqual(
      [],
    );
  });

  it("rejects a stale seed record even if its writer dies before the post-check", async () => {
    await StorageUtil.storeEncryptedSeed(
      "TEST_NET",
      ADDRESS,
      "old-wallet-ciphertext",
    );
    const staleWrite = localStorage.getItem("TEST_NET_ENCRYPTED_SEEDS");
    expect(staleWrite).not.toBeNull();
    if (staleWrite === null) throw new Error("Expected the stored seed snapshot");

    advanceWalletEpoch();
    StorageUtil.clearAllEncryptedSeeds("TEST_NET");
    // Model an old renderer process completing setItem and dying before it can
    // observe the changed epoch or remove its exact late value.
    localStorage.setItem("TEST_NET_ENCRYPTED_SEEDS", staleWrite);

    await expect(StorageUtil.getAllEncryptedSeeds("TEST_NET")).resolves.toEqual(
      [],
    );
  });
});

describe("auto-lock promise callbacks", () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const events = new EventTarget();
  const navigate = jest.fn();
  const getBlockChain = jest.fn<ReturnType<typeof StorageUtil.getBlockChain>, []>();
  const getActiveAccount = jest.fn<Promise<string>, [string]>();
  const getWalletSettings = jest.fn<ReturnType<typeof StorageUtil.getWalletSettings>, []>();
  const log = jest.fn<undefined, unknown[]>();

  beforeAll(() => {
    Object.defineProperty(globalThis, "window", { configurable: true, value: events });
    const logSpy = jest.spyOn(logger, "log").mockImplementation(log);
    setupActivityTracking();
    logSpy.mockRestore();
  });

  beforeEach(() => {
    jest.useFakeTimers();
    log.mockClear();
    getBlockChain.mockReset().mockResolvedValue("TEST_NET");
    getActiveAccount.mockReset().mockResolvedValue(ADDRESS);
    getWalletSettings.mockReset().mockResolvedValue({
      autoLockTimeout: 10_000, showTokensCard: true, showNftsCard: true,
    });
    jest.spyOn(logger, "log").mockImplementation(log);
    jest.spyOn(StorageUtil, "getBlockChain").mockImplementation(getBlockChain);
    jest.spyOn(StorageUtil, "getActiveAccount").mockImplementation(getActiveAccount);
    jest.spyOn(StorageUtil, "getWalletSettings").mockImplementation(getWalletSettings);
    jest.mocked(handleLogout).mockReset();
    jest.mocked(handleLogout).mockResolvedValue(undefined);
  });

  afterEach(() => {
    clearAutoLockTimer();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  afterAll(() => {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  });

  it("keeps the empty blockchain check at the storage boundary", async () => {
    getBlockChain.mockResolvedValue(malformed(""));
    await expect(hasActiveWallet()).resolves.toBe(false);
    expect(getActiveAccount).not.toHaveBeenCalled();
  });

  it("clears the timer while logout is still pending", async () => {
    const logout = deferred<undefined>();
    jest.mocked(handleLogout).mockReturnValue(logout.promise);
    await startAutoLockTimer(navigate);
    await jest.advanceTimersByTimeAsync(10_000);
    expect(jest.mocked(handleLogout)).toHaveBeenCalledWith(navigate);
    expect(jest.getTimerCount()).toBe(0);
    logout.resolve(undefined);
    await logout.promise;
  });

  it("resets inactivity on activity and stops when the wallet disappears", async () => {
    await startAutoLockTimer(navigate);
    await jest.advanceTimersByTimeAsync(5_000);
    updateLastActivity();
    await jest.advanceTimersByTimeAsync(5_000);
    expect(jest.mocked(handleLogout)).not.toHaveBeenCalled();
    getActiveAccount.mockResolvedValue("");
    await jest.advanceTimersByTimeAsync(5_000);
    expect(jest.getTimerCount()).toBe(0);
    expect(jest.mocked(handleLogout)).not.toHaveBeenCalled();
  });

  it("processes same-tab changes and awaits each branch of a cross-tab event", async () => {
    await startAutoLockTimer(navigate);
    events.dispatchEvent(new Event(STORAGE_EVENT_ACTIVE_ACCOUNT));
    events.dispatchEvent(new Event(STORAGE_EVENT_WALLET_SETTINGS));
    await jest.advanceTimersByTimeAsync(0);
    expect(jest.getTimerCount()).toBe(1);

    const settings = deferred<Awaited<ReturnType<typeof StorageUtil.getWalletSettings>>>();
    getWalletSettings.mockReturnValueOnce(settings.promise);
    const event = new Event("storage");
    Object.defineProperty(event, "key", { value: "WALLET_SETTINGS_ACTIVE_ACCOUNT" });
    events.dispatchEvent(event);
    await jest.advanceTimersByTimeAsync(0);
    expect(jest.getTimerCount()).toBe(0);
    expect(log).toHaveBeenCalledWith(
      "⚙️ Auto-lock: Settings changed (cross-tab), restarting timer",
    );
    expect(log).not.toHaveBeenCalledWith(
      "👛 Auto-lock: Wallet status changed (cross-tab), checking auto-lock",
    );

    settings.resolve({ autoLockTimeout: 10_000, showTokensCard: true, showNftsCard: true });
    await jest.advanceTimersByTimeAsync(0);
    expect(log).toHaveBeenCalledWith(
      "👛 Auto-lock: Wallet status changed (cross-tab), checking auto-lock",
    );
    expect(jest.getTimerCount()).toBe(1);
  });
});
