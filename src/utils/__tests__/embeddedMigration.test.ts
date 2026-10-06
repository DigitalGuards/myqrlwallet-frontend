/**
 * @jest-environment jsdom
 */
import { readFileSync } from "fs";
import { join } from "path";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import {
  EMBEDDED_MIGRATION_DONE_MESSAGE,
  EMBEDDED_MIGRATION_FLAG,
  MIGRATION_SESSION_KEYS,
  resetEmbeddedMigrationForTests,
  runEmbeddedMigration,
} from "@/utils/embeddedMigration";

const repoRoot = join(__dirname, "..", "..", "..");

/** Everything the migration must leave exactly as it found it. */
const PRESERVED: ReadonlyArray<readonly [string, string]> = [
  // Encrypted seeds and the account list.
  ["TEST_NET_V3_ENCRYPTED_SEEDS", '{"Q01":"cipher"}'],
  ["TEST_NET_V3_QIP55_ACCOUNT_LIST", '["Q01"]'],
  ["TEST_NET_V3_QIP55_ACTIVE_ACCOUNT", "Q01"],
  // PIN lockout state.
  ["qrlwallet:v3:pin_attempt_tracker", '{"failures":2}'],
  // Settings, display preferences and lists.
  ["qrlwallet:v3:WALLET_SETTINGS", '{"autoLockMinutes":5}'],
  ["qrlwallet:v3:BLOCKCHAIN_SELECTION", "TEST_NET_V3"],
  ["TEST_NET_V3_q01_TOKEN_LIST_V3", "[]"],
  ["TEST_NET_V3_q01_NFT_LIST_V3", "[]"],
  // Address book.
  ["qrlwallet:v3:qrl:addressBook:qip55:v2", '[{"name":"a"}]'],
  // Wallet epoch.
  ["qrlwallet:v3:qrlwallet:wallet-epoch-v1", "3"],
];

const postMessage = jest.fn((_message: string) => undefined);

/** The storage wrapper StorageUtil writes: { value, timestamp, version }. */
const wrap = (value: unknown): string =>
  JSON.stringify({ value, timestamp: Date.now(), version: "1" });

const ACCOUNT_LIST_KEY = "TEST_NET_V3_QIP55_ACCOUNT_LIST";
const LEGACY_ACCOUNT_LIST_KEY = "TEST_NET_ACCOUNT_LIST";

const MIXED_ACCOUNTS = [
  { address: "Q01", source: "seed" },
  { address: "Q02", source: "mobile" },
  { address: "Q03", source: "extension" },
  "Q04",
];

const seedStorage = (): void => {
  for (const key of MIGRATION_SESSION_KEYS) {
    localStorage.setItem(key, '[{"id":"session"}]');
    sessionStorage.setItem(key, '[{"id":"session"}]');
  }
  for (const [key, value] of PRESERVED) localStorage.setItem(key, value);
};

const setFlag = (value: unknown): void => {
  Object.defineProperty(window, EMBEDDED_MIGRATION_FLAG, {
    configurable: true,
    value,
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  resetEmbeddedMigrationForTests();
  localStorage.clear();
  sessionStorage.clear();
  setFlag(undefined);
  Object.defineProperty(window, "ReactNativeWebView", {
    configurable: true,
    value: { postMessage },
  });
  seedStorage();
});

describe("orphaned remote-signer rows", () => {
  beforeEach(() => {
    localStorage.setItem(ACCOUNT_LIST_KEY, wrap(MIXED_ACCOUNTS));
    localStorage.setItem(
      LEGACY_ACCOUNT_LIST_KEY,
      wrap([{ address: "Q05", source: "mobile" }]),
    );
  });

  it("removes mobile rows and keeps every other kind", () => {
    setFlag(true);
    runEmbeddedMigration();

    const stored: { value: unknown[] } = JSON.parse(
      localStorage.getItem(ACCOUNT_LIST_KEY) ?? "{}",
    );
    expect(stored.value).toEqual([
      { address: "Q01", source: "seed" },
      { address: "Q03", source: "extension" },
      // A bare string is the legacy spelling of a seed account.
      "Q04",
    ]);
  });

  it("covers the pre-QIP-55 account list too", () => {
    setFlag(true);
    runEmbeddedMigration();

    const legacy: { value: unknown[] } = JSON.parse(
      localStorage.getItem(LEGACY_ACCOUNT_LIST_KEY) ?? "{}",
    );
    expect(legacy.value).toEqual([]);
  });

  it("keeps the storage wrapper intact", () => {
    setFlag(true);
    runEmbeddedMigration();

    const stored: Record<string, unknown> = JSON.parse(
      localStorage.getItem(ACCOUNT_LIST_KEY) ?? "{}",
    );
    expect(typeof stored["timestamp"]).toBe("number");
    expect(stored["version"]).toBe("1");
  });

  it("removes nothing without the flag", () => {
    expect(runEmbeddedMigration()).toBe(false);

    const stored: { value: unknown[] } = JSON.parse(
      localStorage.getItem(ACCOUNT_LIST_KEY) ?? "{}",
    );
    expect(stored.value).toEqual(MIXED_ACCOUNTS);
  });

  it("leaves a list with no mobile row byte-identical", () => {
    const onlyLocal = wrap([{ address: "Q01", source: "seed" }]);
    localStorage.setItem(ACCOUNT_LIST_KEY, onlyLocal);
    setFlag(true);
    runEmbeddedMigration();

    expect(localStorage.getItem(ACCOUNT_LIST_KEY)).toBe(onlyLocal);
  });

  it("leaves a malformed account list untouched", () => {
    for (const [key, raw] of [
      ["TEST_NET_A_ACCOUNT_LIST", "not json"],
      ["TEST_NET_B_ACCOUNT_LIST", JSON.stringify({ value: "not an array" })],
      ["TEST_NET_C_ACCOUNT_LIST", JSON.stringify(null)],
    ] as const) {
      localStorage.setItem(key, raw);
    }
    setFlag(true);
    runEmbeddedMigration();

    expect(localStorage.getItem("TEST_NET_A_ACCOUNT_LIST")).toBe("not json");
    expect(localStorage.getItem("TEST_NET_B_ACCOUNT_LIST")).toBe(
      JSON.stringify({ value: "not an array" }),
    );
    expect(localStorage.getItem("TEST_NET_C_ACCOUNT_LIST")).toBe("null");
  });

  it("does not touch the encrypted seeds beside it", () => {
    setFlag(true);
    runEmbeddedMigration();

    expect(localStorage.getItem("TEST_NET_V3_ENCRYPTED_SEEDS")).toBe(
      '{"Q01":"cipher"}',
    );
  });
});

describe("migration when the app signals an upgrade", () => {
  it("clears exactly the pairing session keys", () => {
    setFlag(true);
    expect(runEmbeddedMigration()).toBe(true);

    for (const key of MIGRATION_SESSION_KEYS) {
      expect(localStorage.getItem(key)).toBeNull();
      expect(sessionStorage.getItem(key)).toBeNull();
    }
  });

  it("leaves seeds, PIN state, settings and the address book untouched", () => {
    setFlag(true);
    runEmbeddedMigration();

    for (const [key, value] of PRESERVED) {
      expect(localStorage.getItem(key)).toBe(value);
    }
    // Nothing beyond the session keys was removed.
    expect(localStorage.length).toBe(PRESERVED.length);
  });

  it("tells the app once, with no token field", () => {
    setFlag(true);
    runEmbeddedMigration();

    expect(postMessage).toHaveBeenCalledTimes(1);
    const payload: unknown = JSON.parse(postMessage.mock.calls[0]?.[0] ?? "{}");
    // The app's bootstrap adds the per-load token, so the page must not.
    expect(payload).toEqual({ type: EMBEDDED_MIGRATION_DONE_MESSAGE });
  });

  it("runs at most once per document", () => {
    setFlag(true);
    expect(runEmbeddedMigration()).toBe(true);
    expect(runEmbeddedMigration()).toBe(false);
    expect(postMessage).toHaveBeenCalledTimes(1);
  });

  it("still reports done when there was nothing to clear", () => {
    localStorage.clear();
    sessionStorage.clear();
    setFlag(true);

    expect(runEmbeddedMigration()).toBe(true);
    expect(postMessage).toHaveBeenCalledTimes(1);
  });

  it("does not report done when a storage getter itself throws", () => {
    // window.localStorage is an accessor that throws SecurityError when site
    // data is blocked. The whole document is one chunk, so an escape here
    // would abort boot and leave a blank wallet.
    setFlag(true);
    const original = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("site data is blocked", "SecurityError");
      },
    });

    expect(() => runEmbeddedMigration()).not.toThrow();
    expect(runEmbeddedMigration()).toBe(false);
    // Silence is what makes the app retry on the next launch.
    expect(postMessage).not.toHaveBeenCalled();

    if (original) Object.defineProperty(window, "localStorage", original);
  });

  it("does not report done when a key cannot be removed", () => {
    setFlag(true);
    const removeItem = jest
      .spyOn(Storage.prototype, "removeItem")
      .mockImplementation(() => {
        throw new Error("storage is blocked");
      });

    expect(runEmbeddedMigration()).toBe(false);
    expect(postMessage).not.toHaveBeenCalled();
    removeItem.mockRestore();
  });

  it("does not let a throwing bridge abort the caller", () => {
    // postMessage is an app-supplied function; the boot wrapper is the last
    // line of defence, and the migration itself must not make it necessary.
    setFlag(true);
    postMessage.mockImplementation(() => {
      throw new Error("the bridge is gone");
    });

    // The boot module is what catches this; see embeddedMigrationBoot.test.ts.
    expect(() => runEmbeddedMigration()).toThrow("the bridge is gone");
    postMessage.mockReset();
  });

  it("survives a storage that throws", () => {
    setFlag(true);
    const removeItem = jest
      .spyOn(Storage.prototype, "removeItem")
      .mockImplementation(() => {
        throw new Error("storage is blocked");
      });

    expect(() => runEmbeddedMigration()).not.toThrow();
    removeItem.mockRestore();
  });
});

describe("migration when the app says nothing", () => {
  it("does nothing without the flag", () => {
    expect(runEmbeddedMigration()).toBe(false);

    for (const key of MIGRATION_SESSION_KEYS) {
      expect(localStorage.getItem(key)).not.toBeNull();
    }
    expect(postMessage).not.toHaveBeenCalled();
  });

  it("does nothing for any value other than the boolean true", () => {
    for (const value of [false, "true", 1, {}, null]) {
      resetEmbeddedMigrationForTests();
      setFlag(value);
      expect(runEmbeddedMigration()).toBe(false);
    }
    expect(postMessage).not.toHaveBeenCalled();
    for (const key of MIGRATION_SESSION_KEYS) {
      expect(localStorage.getItem(key)).not.toBeNull();
    }
  });
});

describe("the key list matches the modules that write those keys", () => {
  it("covers the wallet's own dApp-connect session key, both profiles", () => {
    const sessionStore = readFileSync(
      join(repoRoot, "src/services/dappConnect/SessionStore.ts"),
      "utf8",
    );
    const key = sessionStore.match(
      /STORAGE_KEY\s*=\s*profileStorageKey\(\s*["']([^"']+)["']/,
    );
    expect(key).not.toBeNull();
    const bare = key?.[1] ?? "";
    expect(MIGRATION_SESSION_KEYS).toContain(bare);
    // src/config/runtimeProfile.ts prefixes the v3 profile.
    expect(MIGRATION_SESSION_KEYS).toContain(`qrlwallet:v3:${bare}`);
  });

  it("covers both remote-signer pairing keys", () => {
    const mobile = readFileSync(
      join(repoRoot, "src/utils/mobileConnect/mobileConnection.ts"),
      "utf8",
    );
    const sdkKey = mobile.match(
      /SDK_SESSION_KEY\s*=\s*["']([^"']+)["']/,
    );
    expect(sdkKey).not.toBeNull();
    expect(MIGRATION_SESSION_KEYS).toContain(sdkKey?.[1]);
    expect(MIGRATION_SESSION_KEYS).toContain(`${sdkKey?.[1]}:inflight`);
  });

  it("names no key that belongs to seeds, PIN state or settings", () => {
    for (const key of MIGRATION_SESSION_KEYS) {
      expect(key).not.toMatch(
        /SEED|ACCOUNT_LIST|ACTIVE_ACCOUNT|pin_attempt|WALLET_SETTINGS|addressBook|TOKEN_LIST|NFT_LIST/i,
      );
    }
  });
});

describe("the migration is evaluated before the stores are constructed", () => {
  it("is imported before main.tsx loads ./App.tsx", () => {
    // DAppConnectStore's constructor reads the persisted sessions and calls
    // reconnectAll(). The boot module is a static import, so it is evaluated
    // before main.tsx's body runs; App is loaded later by a dynamic import in
    // that body. Neither may become a static import of App above the boot.
    const main = readFileSync(join(repoRoot, "src/main.tsx"), "utf8");
    // Match the statements themselves; prose mentioning either module would
    // otherwise decide the comparison.
    const boot = main.search(
      /^import\s+["']@\/utils\/embeddedMigrationBoot["']/m,
    );
    const app = main.search(/import\(\s*["']\.\/App\.tsx["']\s*\)/);
    expect(boot).toBeGreaterThan(-1);
    expect(app).toBeGreaterThan(-1);
    expect(boot).toBeLessThan(app);
    expect(main).not.toMatch(/^import\s+App\s+from/m);
  });

  it("reaches no module that constructs the stores", () => {
    const boot = readFileSync(
      join(repoRoot, "src/utils/embeddedMigrationBoot.ts"),
      "utf8",
    );
    const migration = readFileSync(
      join(repoRoot, "src/utils/embeddedMigration.ts"),
      "utf8",
    );
    const imports = [...`${boot}\n${migration}`.matchAll(/^import\s.*$/gm)].map(
      (m) => m[0],
    );
    // embeddedRuntime is a leaf module holding only the build constant.
    expect(imports).toEqual([
      'import { runEmbeddedMigration } from "./embeddedMigration";',
      'import { IS_EMBEDDED_BUILD } from "./embeddedRuntime";',
    ]);
  });
});
