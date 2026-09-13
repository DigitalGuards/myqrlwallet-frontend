jest.mock("@/config", () => ({
  QRL_PROVIDER: {
    TEST_NET: { id: "TEST_NET" },
  },
}));

import StorageUtil from "../storage";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

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
  }
}

const LOWER_ADDRESS =
  "Qd5812f6cf4a0f645aa620cd57319a0ed649dd8f5519a9dde7770ae5b0e49e547985f35eb972a2a07041561aa39c65a3991478f9b1e6749e05277dcf58a9a8b72";
const CHECKSUM_ADDRESS =
  "Qd5812F6Cf4a0f645aa620cd57319a0Ed649dd8f5519A9dde7770ae5b0E49e547985f35eB972A2a07041561aa39c65A3991478f9B1e6749e05277dcf58A9A8B72";
const LEGACY_Q40 = `Q${"12".repeat(20)}`;
const ACCOUNT_LIST_KEY = "TEST_NET_QIP55_ACCOUNT_LIST";
const LEGACY_ACCOUNT_LIST_KEY = "TEST_NET_ACCOUNT_LIST";
const ACTIVE_ACCOUNT_KEY = "TEST_NET_QIP55_ACTIVE_ACCOUNT";
const LEGACY_ACTIVE_ACCOUNT_KEY = "TEST_NET_ACTIVE_ACCOUNT";

describe("QIP-55 account persistence boundary", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: new MemoryStorage(),
    });
  });

  it("canonicalizes new active-account and account-list writes", async () => {
    await StorageUtil.setActiveAccount("TEST_NET", LOWER_ADDRESS);
    expect(await StorageUtil.getActiveAccount("TEST_NET")).toBe(CHECKSUM_ADDRESS);
    expect(await StorageUtil.getAccountList("TEST_NET")).toEqual([
      { address: CHECKSUM_ADDRESS, source: "seed" },
    ]);
  });

  it("rejects legacy Q+40 writes", async () => {
    await expect(
      StorageUtil.setActiveAccount("TEST_NET", LEGACY_Q40),
    ).rejects.toThrow("QIP-55");
    await expect(
      StorageUtil.setAccountList("TEST_NET", [
        { address: LEGACY_Q40, source: "mobile" },
      ]),
    ).rejects.toThrow("QIP-55");
  });

  it("excludes legacy records from runtime without rewriting recoverable storage", async () => {
    const raw = JSON.stringify({
      value: [
        { address: LEGACY_Q40, source: "seed" },
        { address: LOWER_ADDRESS, source: "mobile" },
      ],
      timestamp: Date.now(),
      version: "v1",
    });
    localStorage.setItem(ACCOUNT_LIST_KEY, raw);

    expect(await StorageUtil.getAccountList("TEST_NET")).toEqual([
      { address: CHECKSUM_ADDRESS, source: "mobile" },
    ]);
    expect(localStorage.getItem(ACCOUNT_LIST_KEY)).toBe(raw);
  });

  it("keeps the pre-QIP-55 namespace isolated for rollback", async () => {
    const legacyRaw = JSON.stringify({
      value: [{ address: LEGACY_Q40, source: "seed" }],
      timestamp: Date.now(),
      version: "v1",
    });
    localStorage.setItem(LEGACY_ACCOUNT_LIST_KEY, legacyRaw);

    expect(await StorageUtil.getAccountList("TEST_NET")).toEqual([]);
    await StorageUtil.setAccountList("TEST_NET", [
      { address: CHECKSUM_ADDRESS, source: "seed" },
    ]);
    expect(localStorage.getItem(LEGACY_ACCOUNT_LIST_KEY)).toBe(legacyRaw);
  });

  it("clears both namespaces during an explicit wallet wipe", async () => {
    for (const key of [
      ACCOUNT_LIST_KEY,
      LEGACY_ACCOUNT_LIST_KEY,
      ACTIVE_ACCOUNT_KEY,
      LEGACY_ACTIVE_ACCOUNT_KEY,
    ]) {
      localStorage.setItem(key, "stored");
    }

    StorageUtil.clearAccountList("TEST_NET");
    await StorageUtil.clearActiveAccount("TEST_NET");

    for (const key of [
      ACCOUNT_LIST_KEY,
      LEGACY_ACCOUNT_LIST_KEY,
      ACTIVE_ACCOUNT_KEY,
      LEGACY_ACTIVE_ACCOUNT_KEY,
    ]) {
      expect(localStorage.getItem(key)).toBeNull();
    }
  });
});
