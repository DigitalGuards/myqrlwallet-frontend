/** @jest-environment jsdom */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import type { ReactNode } from "react";
import App from "@/App";
import { applyLanguage, i18n, namespaces } from "../index";
import StorageUtil from "@/utils/storage/storage";
import { LanguageSettings as MockLanguageSettings } from "@/components/Core/Body/Settings/LanguageSettings";
import { deferred } from "@/test-utils/deferred";

const german =
  jest.requireActual<typeof import("@/locales/de")>("@/locales/de");
let mockDownload = deferred<typeof german>();
jest.mock("@/locales/de", () => ({
  __esModule: true,
  then: (
    resolve: (catalog: typeof german) => void,
    reject: (error: unknown) => void,
  ) => mockDownload.promise.then(resolve, reject),
}));
jest.mock("@/config", () => ({
  QRL_PROVIDER: { TEST_NET: { id: "TEST_NET" } },
}));
jest.mock("@/config/runtimeProfile", () => ({
  IS_V3_PROFILE: false,
  isUnsupportedV3Context: () => false,
  profileStorageKey: (key: string) => key,
}));
jest.mock("@/stores/store", () => ({
  store: {},
  StoreProvider: ({ children }: { children: ReactNode }) => children,
}));
jest.mock("@/router/router", () => ({
  AppRouter: () => (
    <main>
      Wallet ready
      <MockLanguageSettings />
    </main>
  ),
}));
jest.mock("@/utils/nativeApp", () => ({ isInNativeApp: () => false }));
jest.mock("@/desktop/bridge", () => ({ isDesktop: false }));
jest.mock("@/utils", () =>
  jest.requireActual<typeof import("@/utils/cn")>("@/utils/cn"),
);
jest.mock("@/utils/log", () => ({ logger: { error: jest.fn() } }));

const hours = (count: number) => count * 60 * 60 * 1000;
function legacyLanguage(language: unknown, age = 0) {
  localStorage.setItem(
    "WALLET_SETTINGS",
    JSON.stringify({
      value: {
        language,
        autoLockTimeout: 3600000,
        showTokensCard: false,
        showNftsCard: false,
      },
      timestamp: Date.now() - age,
      version: "v1",
    }),
  );
}
async function flush() {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(0);
  });
}

beforeEach(async () => {
  jest.useFakeTimers();
  localStorage.clear();
  await applyLanguage("en");
  for (const ns of namespaces) i18n.removeResourceBundle("de", ns);
  mockDownload = deferred<typeof german>();
  void mockDownload.promise.catch(() => undefined);
  jest.spyOn(navigator, "languages", "get").mockReturnValue(["de-DE"]);
});
afterEach(async () => {
  cleanup();
  mockDownload.resolve(german);
  await flush();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it("renders the wallet immediately while the selected catalog is held", async () => {
  legacyLanguage("de");
  const view = render(<App />);
  expect(view.container.childElementCount).toBeGreaterThan(0);
  expect(screen.getByText("Wallet ready")).toBeTruthy();
  expect(screen.getByLabelText("Language")).toBeTruthy();
  await flush();
  expect(document.documentElement.lang).toBe("en");
  await act(async () => {
    mockDownload.resolve(german);
    await jest.advanceTimersByTimeAsync(0);
  });
  expect(await screen.findByLabelText("Sprache")).toBeTruthy();
});

it("times out within a few seconds, preserves the choice and ignores a late catalog", async () => {
  legacyLanguage("de");
  const view = render(<App />);
  await flush();
  await act(async () => {
    await jest.advanceTimersByTimeAsync(4000);
  });
  expect(screen.getByLabelText("Language")).toBeTruthy();
  expect(localStorage.getItem("WALLET_LANGUAGE")).toBe('"de"');
  await act(async () => {
    mockDownload.resolve(german);
    await jest.advanceTimersByTimeAsync(0);
  });
  expect(document.documentElement.lang).toBe("en");
  view.unmount();
  await act(async () => {
    render(<App />);
    await Promise.resolve();
  });
  expect(await screen.findByLabelText("Sprache")).toBeTruthy();
});

it("keeps English and retries the saved choice after a rejected download", async () => {
  legacyLanguage("de");
  const view = render(<App />);
  await flush();
  await act(async () => {
    mockDownload.reject(new Error("catalog unavailable"));
    await jest.advanceTimersByTimeAsync(0);
  });
  expect(screen.getByLabelText("Language")).toBeTruthy();
  expect(localStorage.getItem("WALLET_LANGUAGE")).toBe('"de"');
  view.unmount();
  mockDownload = deferred<typeof german>();
  void mockDownload.promise.catch(() => undefined);
  await act(async () => {
    render(<App />);
    mockDownload.resolve(german);
    await jest.advanceTimersByTimeAsync(0);
  });
  expect(document.documentElement.lang).toBe("de");
});

it("saves an explicit choice before downloading and releases the selector on timeout", async () => {
  legacyLanguage("en");
  render(<App />);
  await flush();
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "de" } });
  expect(localStorage.getItem("WALLET_LANGUAGE")).toBe('"de"');
  await flush();
  await act(async () => {
    await jest.advanceTimersByTimeAsync(4000);
  });
  expect(screen.getByRole("combobox").hasAttribute("disabled")).toBe(false);
  expect(screen.getByRole("alert").textContent).toBe(
    "Could not change language. Please try again.",
  );
  expect(document.documentElement.lang).toBe("en");
});

it("keeps a newer English selection when an older catalog finishes", async () => {
  const old = applyLanguage("de");
  await applyLanguage("en");
  mockDownload.resolve(german);
  await old;
  expect(document.documentElement.lang).toBe("en");
});

it.each(["unsupported-language", {}, null, 42])(
  "replaces corrupt legacy language %j with English despite a German browser",
  async (value) => {
    legacyLanguage(value);
    await act(async () => {
      render(<App />);
      mockDownload.resolve(german);
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(document.documentElement.lang).toBe("en");
    expect(screen.getByLabelText("Language")).toBeTruthy();
    expect(localStorage.getItem("WALLET_LANGUAGE")).toBe('"en"');
  },
);

it.each(['"unsupported-language"', "{}", "null", "42", "{broken"])(
  "repairs corrupt independent language %s",
  async (value) => {
    localStorage.setItem("WALLET_LANGUAGE", value);
    await act(async () => {
      render(<App />);
      mockDownload.resolve(german);
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(document.documentElement.lang).toBe("en");
    expect(localStorage.getItem("WALLET_LANGUAGE")).toBe('"en"');
  },
);

it("detects the browser only when the preference is absent", async () => {
  await act(async () => {
    render(<App />);
    mockDownload.resolve(german);
    await jest.advanceTimersByTimeAsync(0);
  });
  expect(document.documentElement.lang).toBe("de");
  expect(localStorage.getItem("WALLET_LANGUAGE")).toBe('"de"');
});

it("expires seven-hour-old security and card preferences as on origin/dev", async () => {
  legacyLanguage("en", hours(7));
  expect(await StorageUtil.getWalletSettings()).toEqual({
    autoLockTimeout: 900000,
    showTokensCard: true,
    showNftsCard: true,
  });
  expect(localStorage.getItem("WALLET_SETTINGS")).toBeNull();
});

it("migrates language without extending settings expiration or changing card preferences", async () => {
  legacyLanguage("en", hours(5));
  const before = localStorage.getItem("WALLET_SETTINGS");
  await act(async () => {
    render(<App />);
    await Promise.resolve();
  });
  expect(localStorage.getItem("WALLET_SETTINGS")).toBe(before);
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "de" } });
  await act(async () => {
    mockDownload.resolve(german);
    await jest.advanceTimersByTimeAsync(0);
  });
  expect(localStorage.getItem("WALLET_SETTINGS")).toBe(before);
  jest.setSystemTime(Date.now() + hours(2));
  expect(await StorageUtil.getWalletSettings()).toEqual({
    autoLockTimeout: 900000,
    showTokensCard: true,
    showNftsCard: true,
  });
  expect(localStorage.getItem("WALLET_LANGUAGE")).toBe('"de"');
});

it("retries a rejected language from the selector without replacing the app", async () => {
  legacyLanguage("en");
  const view = render(<App />);
  await flush();
  const root = view.container.firstChild;
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "de" } });
  await flush();
  await act(async () => {
    mockDownload.reject(new Error("catalog unavailable"));
    await jest.advanceTimersByTimeAsync(0);
  });
  expect(screen.getByRole("alert")).toBeTruthy();
  mockDownload = deferred<typeof german>();
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "de" } });
  await act(async () => {
    mockDownload.resolve(german);
    await jest.advanceTimersByTimeAsync(0);
  });
  expect(document.documentElement.lang).toBe("de");
  expect(view.container.firstChild).toBe(root);
  expect(screen.queryByRole("alert")).toBeNull();
});
