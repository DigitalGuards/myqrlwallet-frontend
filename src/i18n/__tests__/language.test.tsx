/** @jest-environment jsdom */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { i18n, applyLanguage, loadLanguage, namespaces } from "../index";
import { detectLanguage, isLanguage } from "../languages";
import { useLanguagePreference } from "../useLanguagePreference";
import { LanguageSettings } from "@/components/Core/Body/Settings/LanguageSettings";
import { LANGUAGE_STORAGE_KEY, saveLanguagePreference } from "../preference";
import { StorageUtil } from "@/utils/storage";

let mockDesktop = false;
let mockNative = false;
jest.mock("@/config", () => ({
  QRL_PROVIDER: { TEST_NET: { id: "TEST_NET" } },
}));
jest.mock("@/config/runtimeProfile", () => ({
  IS_V3_PROFILE: false,
  profileStorageKey: (key: string) => key,
}));
jest.mock("@/utils/nativeApp", () => ({
  isInNativeApp: () => mockNative,
  openNativeSettings: jest.fn(),
}));
jest.mock("@/desktop/bridge", () => ({
  get isDesktop() {
    return mockDesktop;
  },
  desktopSigner: { openDesktopSettings: jest.fn(() => Promise.resolve()) },
}));
jest.mock("@/utils", () =>
  jest.requireActual<typeof import("@/utils/cn")>("@/utils/cn"),
);
jest.mock("@/utils/logout", () => ({ handleLogout: jest.fn() }));
jest.mock("@/utils/log", () => ({
  logger: { log: jest.fn(), error: jest.fn() },
}));

function Preferences() {
  useLanguagePreference();
  return <LanguageSettings />;
}

beforeEach(async () => {
  localStorage.clear();
  mockDesktop = false;
  mockNative = false;
  jest.clearAllMocks();
  await applyLanguage("en");
});
afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

it.each([
  [["de-DE"], "de"],
  [["es-MX"], "es"],
  [["ru-RU"], "ru"],
  [["zh-CN"], "zh-CN"],
  [["zh-Hans"], "zh-CN"],
  [["zh-Hans-SG"], "zh-CN"],
  [["zh-SG"], "zh-CN"],
  [["zh-TW"], "en"],
  [["zh-Hant"], "en"],
  [["zh-Hant-CN"], "en"],
  [["zh"], "en"],
  [["fr-FR", "ru-UA"], "ru"],
  [["en-GB", "de-DE"], "en"],
  [[], "en"],
])("detects browser preferences %j as %s", (preferences, expected) => {
  expect(detectLanguage(preferences)).toBe(expected);
});

it("rejects unsupported and malformed persisted languages", () => {
  for (const value of [null, {}, 5, "fr", "DE", "__proto__"])
    expect(isLanguage(value)).toBe(false);
});

it("ships English first and only loads a selected language", async () => {
  for (const ns of namespaces)
    expect(i18n.hasResourceBundle("en", ns)).toBe(true);
  expect(i18n.hasResourceBundle("es", "home")).toBe(false);
  await loadLanguage("de");
  expect(i18n.hasResourceBundle("de", "home")).toBe(true);
  expect(i18n.hasResourceBundle("es", "home")).toBe(false);
});

it("uses Russian plural rules and falls back to English for a missing key", async () => {
  await applyLanguage("ru");
  expect(i18n.getFixedT("ru", "settings")("attemptsLeft", { count: 1 })).toBe(
    "Осталась 1 попытка",
  );
  expect(i18n.getFixedT("ru", "settings")("attemptsLeft", { count: 2 })).toBe(
    "Осталось 2 попытки",
  );
  expect(i18n.getFixedT("ru", "settings")("attemptsLeft", { count: 5 })).toBe(
    "Осталось 5 попыток",
  );
  i18n.removeResourceBundle("ru", "home");
  i18n.addResourceBundle("ru", "home", { activeAccount: "Активный аккаунт" });
  expect(i18n.getFixedT("ru", "home")("receiveQuanta")).toBe("Receive Quanta");
  i18n.removeResourceBundle("ru", "home");
});

it("keeps the newest language when asynchronous requests overlap", async () => {
  await Promise.all([
    applyLanguage("ru"),
    applyLanguage("de"),
    applyLanguage("zh-CN"),
  ]);
  expect(i18n.language).toBe("zh-CN");
  expect(document.documentElement.lang).toBe("zh-CN");
});

it("detects once, saves separately from wallet settings, changes live and restores across visits", async () => {
  jest.spyOn(navigator, "languages", "get").mockReturnValue(["es-MX", "en"]);
  await StorageUtil.setWalletSettings({
    autoLockTimeout: 120000,
    showTokensCard: false,
  });
  const view = render(<Preferences />);
  await screen.findByLabelText("Idioma");
  expect(document.documentElement.lang).toBe("es");
  expect(JSON.parse(localStorage.getItem(LANGUAGE_STORAGE_KEY) ?? "null")).toBe(
    "es",
  );
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "de" } });
  await screen.findByLabelText("Sprache");
  expect(document.documentElement.lang).toBe("de");
  expect(await StorageUtil.getWalletSettings()).toMatchObject({
    autoLockTimeout: 120000,
    showTokensCard: false,
  });
  await act(async () => {
    await StorageUtil.setWalletSettings({ showNftsCard: false });
  });
  expect(JSON.parse(localStorage.getItem(LANGUAGE_STORAGE_KEY) ?? "null")).toBe(
    "de",
  );
  view.unmount();
  await applyLanguage("en");
  render(<Preferences />);
  await screen.findByLabelText("Sprache");
});

it("handles changes from another tab", async () => {
  saveLanguagePreference("en");
  render(<Preferences />);
  await screen.findByLabelText("Language");
  act(() => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, JSON.stringify("ru"));
    window.dispatchEvent(
      new StorageEvent("storage", { key: LANGUAGE_STORAGE_KEY }),
    );
  });
  await screen.findByLabelText("Язык");
  expect(document.documentElement.lang).toBe("ru");
});

it("keeps a failed preference write visible and retains the current language", async () => {
  jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("Storage unavailable");
  });
  render(<LanguageSettings />);
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "de" } });
  expect((await screen.findByRole("alert")).textContent).toBe(
    "Could not change language. Please try again.",
  );
  expect(i18n.language).toBe("en");
});
