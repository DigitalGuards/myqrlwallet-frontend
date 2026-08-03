jest.mock("@/config", () => ({
  QRL_PROVIDER: {
    TEST_NET: { id: "TEST_NET" },
    MAIN_NET: { id: "MAIN_NET" },
  },
}));

import StorageUtil, { type EncryptedSeedData } from "../storage";
import { advanceWalletEpoch, getWalletEpoch } from "@/utils/walletEpoch";

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
const ADDRESS = `Q${"12".repeat(20)}`;

describe("encrypted seed revision merge", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: new MemoryStorage(),
    });
  });

  afterAll(() => {
    if (originalLocalStorage) {
      Object.defineProperty(globalThis, "localStorage", originalLocalStorage);
    } else {
      Reflect.deleteProperty(globalThis, "localStorage");
    }
  });

  it("increments only on ciphertext writes, not ordinary reads", async () => {
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

  it("removes its exact late seed write when another tab advances the epoch", async () => {
    const storage = localStorage as MemoryStorage;
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

    advanceWalletEpoch();
    StorageUtil.clearAllEncryptedSeeds("TEST_NET");
    // Model an old renderer process completing setItem and dying before it can
    // observe the changed epoch or remove its exact late value.
    localStorage.setItem("TEST_NET_ENCRYPTED_SEEDS", staleWrite as string);

    await expect(StorageUtil.getAllEncryptedSeeds("TEST_NET")).resolves.toEqual(
      [],
    );
  });
});
