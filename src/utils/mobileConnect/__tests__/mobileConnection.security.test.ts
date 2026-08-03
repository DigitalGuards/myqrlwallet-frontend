import { beforeEach, describe, expect, it, jest } from "@jest/globals";

type Handler = (...args: unknown[]) => void;

const mockInstances: MockConnect[] = [];
let mockInitialAccounts: string[] = [];
let mockRequestResult: unknown = [];
let mockRequestError: Error | null = null;
let mockRequestHook: (() => Promise<unknown>) | null = null;
let mockHasStoredSession = false;

class MockConnect {
  private handlers = new Map<string, Set<Handler>>();
  accounts = [...mockInitialAccounts];
  request = jest.fn<(args: { method: string; params?: unknown[] }) => Promise<unknown>>(async () => {
    if (mockRequestHook) return mockRequestHook();
    if (mockRequestError) throw mockRequestError;
    return mockRequestResult;
  });
  getConnectionURI = jest.fn(async () => "qrlconnect://?q=first");
  newConnection = jest.fn(async () => "qrlconnect://?q=second");
  disconnect = jest.fn(async () => undefined);
  isMobile = jest.fn(() => false);
  hasStoredSession = jest.fn(() => mockHasStoredSession);

  constructor() {
    mockInstances.push(this);
  }

  on(event: string, handler: Handler): void {
    let handlers = this.handlers.get(event);
    if (!handlers) {
      handlers = new Set();
      this.handlers.set(event, handlers);
    }
    handlers.add(handler);
  }

  off(event: string, handler: Handler): void {
    this.handlers.get(event)?.delete(handler);
  }

  emit(event: string, ...args: unknown[]): void {
    for (const handler of this.handlers.get(event) ?? []) handler(...args);
  }

  getAccounts(): string[] {
    return [...this.accounts];
  }
}

jest.mock("@qrlwallet/connect", () => ({
  QRLConnect: MockConnect,
  attemptWalletRedirect: jest.fn(async () => false),
  getAppStoreUrl: jest.fn(() => "https://example.test/app"),
}));

jest.mock("@/utils", () => ({ log: jest.fn() }));

function makeStore() {
  return {
    setActiveAccount: jest.fn(async () => undefined),
    setMobileProvider: jest.fn(),
    adoptMobileAccount: jest.fn<(address: string) => Promise<void>>(async () => undefined),
    removeMobileAccounts: jest.fn(async () => undefined),
  };
}

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
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

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  jest.resetModules();
  mockInstances.length = 0;
  mockInitialAccounts = [];
  mockRequestResult = [];
  mockRequestError = null;
  mockRequestHook = null;
  mockHasStoredSession = false;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: new MemoryStorage(),
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: {
        origin: "https://wallet.example",
        href: "https://wallet.example/connect",
      },
    },
  });
});

describe("mobile pairing account consent", () => {
  it("single-flights explicit qrl_requestAccounts after an empty fresh handshake", async () => {
    const store = makeStore();
    const module = await import("../mobileConnection");
    await module.startMobilePairing(store);
    const qrl = mockInstances[0];
    if (!qrl) throw new Error("Expected QRLConnect instance");
    mockRequestResult = ["Q0000000000000000000000000000000000000000"];

    qrl.emit("connect");
    qrl.emit("connect");
    await flush();

    expect(qrl.request).toHaveBeenCalledTimes(1);
    expect(qrl.request).toHaveBeenCalledWith({
      method: "qrl_requestAccounts",
      params: [],
    });
    expect(store.adoptMobileAccount).toHaveBeenCalledWith(
      "Q0000000000000000000000000000000000000000",
    );
  });

  it("does not loop an account prompt after rejection", async () => {
    const store = makeStore();
    const module = await import("../mobileConnection");
    await module.startMobilePairing(store);
    const qrl = mockInstances[0];
    if (!qrl) throw new Error("Expected QRLConnect instance");
    mockRequestError = new Error("User rejected");

    qrl.emit("connect");
    await flush();
    qrl.emit("connect");
    await flush();

    expect(qrl.request).toHaveBeenCalledTimes(1);
    expect(store.adoptMobileAccount).not.toHaveBeenCalled();
  });

  it.each([
    ["authorization ordering", Object.assign(new Error("Unauthorized"), { code: 4100 })],
    ["transport failure", new Error("transport disconnected")],
  ])("retries a %s failure on the next connect without duplicate in-flight requests", async (_label, firstError) => {
    const store = makeStore();
    const module = await import("../mobileConnection");
    await module.startMobilePairing(store);
    const qrl = mockInstances[0];
    if (!qrl) throw new Error("Expected QRLConnect instance");
    let attempt = 0;
    mockRequestHook = async () => {
      attempt += 1;
      if (attempt === 1) throw firstError;
      return ["Q0000000000000000000000000000000000000000"];
    };

    qrl.emit("connect");
    qrl.emit("connect");
    await flush();
    expect(qrl.request).toHaveBeenCalledTimes(1);

    qrl.emit("connect");
    await flush();
    expect(qrl.request).toHaveBeenCalledTimes(2);
    expect(store.adoptMobileAccount).toHaveBeenCalledWith(
      "Q0000000000000000000000000000000000000000",
    );
  });

  it("does not prompt when an authorized reconnect already has a cached account", async () => {
    mockInitialAccounts = ["Q0000000000000000000000000000000000000000"];
    const store = makeStore();
    const module = await import("../mobileConnection");
    await module.startMobilePairing(store);
    const qrl = mockInstances[0];
    if (!qrl) throw new Error("Expected QRLConnect instance");

    qrl.emit("connect");
    await flush();

    expect(qrl.request).not.toHaveBeenCalled();
    expect(store.adoptMobileAccount).toHaveBeenCalledWith(
      "Q0000000000000000000000000000000000000000",
    );
  });

  it("retires an unconsumed pairing capability on cancel before rotating", async () => {
    const store = makeStore();
    const module = await import("../mobileConnection");
    const first = await module.startMobilePairing(store);
    const qrl = mockInstances[0];
    if (!qrl) throw new Error("Expected QRLConnect instance");

    await module.cancelMobilePairing();
    const second = await module.startMobilePairing(store, true);

    expect(first.uri).toBe("qrlconnect://?q=first");
    expect(qrl.disconnect).toHaveBeenCalledTimes(1);
    expect(qrl.newConnection).toHaveBeenCalledTimes(1);
    expect(second.uri).toBe("qrlconnect://?q=second");
  });

  it("does not adopt an account approval that resolves after cancellation", async () => {
    const store = makeStore();
    const module = await import("../mobileConnection");
    await module.startMobilePairing(store);
    const qrl = mockInstances[0];
    if (!qrl) throw new Error("Expected QRLConnect instance");
    let resolveRequest: (value: unknown) => void = () => undefined;
    mockRequestHook = () =>
      new Promise<unknown>((resolve) => {
        resolveRequest = resolve;
      });

    qrl.emit("connect");
    await flush();
    await module.cancelMobilePairing();
    resolveRequest(["Q0000000000000000000000000000000000000000"]);
    await flush();

    expect(store.adoptMobileAccount).not.toHaveBeenCalled();
  });

  it("rejects malformed or multi-account authorization updates", async () => {
    const store = makeStore();
    const module = await import("../mobileConnection");
    await module.startMobilePairing(store);
    const qrl = mockInstances[0];
    if (!qrl) throw new Error("Expected QRLConnect instance");

    qrl.emit("accountsChanged", [
      "Q0000000000000000000000000000000000000000",
      "Q1111111111111111111111111111111111111111",
    ]);
    qrl.emit("accountsChanged", ["not-a-qrl-address"]);
    await flush();

    expect(store.adoptMobileAccount).not.toHaveBeenCalled();
    expect(store.setMobileProvider).toHaveBeenCalledWith(null);
    expect(store.removeMobileAccounts).toHaveBeenCalled();
  });

  it("drops an incompatible SDK 3.3 v4 record instead of publishing a provider", async () => {
    localStorage.setItem("@qrlwallet/connect:session", JSON.stringify({ version: 4 }));
    mockHasStoredSession = false;
    const store = makeStore();
    const module = await import("../mobileConnection");

    await module.maybeRestoreMobileConnection(store, true);

    expect(store.setMobileProvider).toHaveBeenCalledWith(null);
    expect(store.removeMobileAccounts).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("@qrlwallet/connect:session")).toBeNull();
  });

  it("publishes the provider only after SDK4 validates a v5 record", async () => {
    localStorage.setItem("@qrlwallet/connect:session", JSON.stringify({ version: 5 }));
    mockHasStoredSession = true;
    const store = makeStore();
    const module = await import("../mobileConnection");

    await module.maybeRestoreMobileConnection(store, true);

    expect(store.setMobileProvider).toHaveBeenCalledWith(
      expect.objectContaining({ request: expect.any(Function) }),
    );
    expect(store.setMobileProvider).not.toHaveBeenCalledWith(null);
    expect(store.removeMobileAccounts).not.toHaveBeenCalled();
  });

  it("removes the persisted mobile account when SDK4 invalidates restore without Web Locks", async () => {
    localStorage.setItem("@qrlwallet/connect:session", JSON.stringify({ version: 5 }));
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {},
    });
    mockHasStoredSession = false;
    const store = makeStore();
    const module = await import("../mobileConnection");

    await module.maybeRestoreMobileConnection(store, true);

    expect(store.setMobileProvider).toHaveBeenCalledWith(null);
    expect(store.removeMobileAccounts).toHaveBeenCalledTimes(1);
  });
});
