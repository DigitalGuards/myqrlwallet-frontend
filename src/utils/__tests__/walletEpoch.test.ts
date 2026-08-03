import {
  advanceWalletEpoch,
  getWalletEpoch,
  subscribeWalletEpoch,
  WALLET_EPOCH_STORAGE_KEY,
} from "../walletEpoch";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  failEpochWrite = false;

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
    if (this.failEpochWrite && key === WALLET_EPOCH_STORAGE_KEY) {
      throw new Error("epoch storage denied");
    }
    this.values.set(key, value);
  }
}

class FakeBroadcastChannel extends EventTarget {
  static latest: FakeBroadcastChannel | null = null;
  readonly posted: unknown[] = [];

  constructor(readonly name: string) {
    super();
    FakeBroadcastChannel.latest = this;
  }

  postMessage(data: unknown): void {
    this.posted.push(data);
  }

  close(): void {}
}

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalLocalStorage = Object.getOwnPropertyDescriptor(
  globalThis,
  "localStorage",
);

describe("wallet epoch propagation", () => {
  beforeAll(() => {
    const windowTarget = new EventTarget() as EventTarget & {
      BroadcastChannel: typeof BroadcastChannel;
    };
    windowTarget.BroadcastChannel =
      Object(FakeBroadcastChannel) as typeof BroadcastChannel;
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: windowTarget,
    });
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: new MemoryStorage(),
    });
  });

  afterAll(() => {
    if (originalWindow)
      Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (originalLocalStorage) {
      Object.defineProperty(globalThis, "localStorage", originalLocalStorage);
    } else {
      Reflect.deleteProperty(globalThis, "localStorage");
    }
  });

  it("notifies a live realm when another tab updates persistent storage", () => {
    const observed: string[] = [];
    const unsubscribe = subscribeWalletEpoch((epoch) => observed.push(epoch));
    const nextEpoch =
      getWalletEpoch() === "11".repeat(16) ? "22".repeat(16) : "11".repeat(16);
    localStorage.setItem(WALLET_EPOCH_STORAGE_KEY, String(nextEpoch));

    const event = new Event("storage");
    Object.assign(event, {
      key: WALLET_EPOCH_STORAGE_KEY,
      newValue: String(nextEpoch),
    });
    window.dispatchEvent(event);

    expect(observed).toEqual([nextEpoch]);
    expect(getWalletEpoch()).toBe(nextEpoch);
    unsubscribe();
  });

  it("accepts reverse write order because generations use equality, not ordering", () => {
    const observed: string[] = [];
    const unsubscribe = subscribeWalletEpoch((epoch) => observed.push(epoch));
    const laterComputed = "33".repeat(16);
    const earlierComputedButLastWritten = "44".repeat(16);

    for (const epoch of [laterComputed, earlierComputedButLastWritten]) {
      localStorage.setItem(WALLET_EPOCH_STORAGE_KEY, epoch);
      const event = new Event("storage");
      Object.assign(event, { key: WALLET_EPOCH_STORAGE_KEY, newValue: epoch });
      window.dispatchEvent(event);
    }

    expect(observed).toEqual([laterComputed, earlierComputedButLastWritten]);
    expect(getWalletEpoch()).toBe(earlierComputedButLastWritten);
    unsubscribe();
  });

  it("ignores delayed stale storage and broadcast payloads when storage is newer", () => {
    const observed: string[] = [];
    const unsubscribe = subscribeWalletEpoch((epoch) => observed.push(epoch));
    const current = "55".repeat(16);
    const stale = "66".repeat(16);
    localStorage.setItem(WALLET_EPOCH_STORAGE_KEY, current);
    const currentEvent = new Event("storage");
    Object.assign(currentEvent, {
      key: WALLET_EPOCH_STORAGE_KEY,
      newValue: current,
    });
    window.dispatchEvent(currentEvent);
    observed.length = 0;

    const staleStorageEvent = new Event("storage");
    Object.assign(staleStorageEvent, {
      key: WALLET_EPOCH_STORAGE_KEY,
      newValue: stale,
    });
    window.dispatchEvent(staleStorageEvent);
    const staleBroadcastEvent = new Event("message");
    Object.assign(staleBroadcastEvent, { data: { epoch: stale } });
    FakeBroadcastChannel.latest?.dispatchEvent(staleBroadcastEvent);

    expect(observed).toEqual([]);
    expect(getWalletEpoch()).toBe(current);
    unsubscribe();
  });

  it("keeps a volatile failure boundary across a stale storage event", () => {
    const storage = localStorage as MemoryStorage;
    const base = getWalletEpoch();
    storage.failEpochWrite = true;
    expect(() => advanceWalletEpoch()).toThrow(
      "persist the wallet clear boundary",
    );
    const volatile = getWalletEpoch();
    expect(volatile).not.toBe(base);
    const posted = FakeBroadcastChannel.latest?.posted ?? [];
    expect(posted[posted.length - 1]).toEqual({
      epoch: volatile,
      volatile: true,
      baseEpoch: base,
    });

    const staleEvent = new Event("storage");
    Object.assign(staleEvent, {
      key: WALLET_EPOCH_STORAGE_KEY,
      newValue: base,
    });
    window.dispatchEvent(staleEvent);
    expect(getWalletEpoch()).toBe(volatile);

    storage.failEpochWrite = false;
    const recovery = "77".repeat(16);
    localStorage.setItem(WALLET_EPOCH_STORAGE_KEY, recovery);
    const recoveryEvent = new Event("storage");
    Object.assign(recoveryEvent, {
      key: WALLET_EPOCH_STORAGE_KEY,
      newValue: recovery,
    });
    window.dispatchEvent(recoveryEvent);
    expect(getWalletEpoch()).toBe(recovery);
  });

  it("fails closed when secure epoch randomness is unavailable", () => {
    const randomSpy = jest
      .spyOn(globalThis.crypto, "getRandomValues")
      .mockImplementation(() => {
        throw new Error("rng denied");
      });
    try {
      expect(() => advanceWalletEpoch()).toThrow(
        "Secure wallet epoch randomness is unavailable",
      );
    } finally {
      randomSpy.mockRestore();
    }
  });
});
