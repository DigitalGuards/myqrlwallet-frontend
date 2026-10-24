/** @jest-environment jsdom */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { HelmetProvider } from "react-helmet-async";
import DesktopSettings from "../DesktopSettings";
import { applyLanguage, i18n } from "@/i18n";
import { languages } from "@/i18n/languages";
import { useLanguagePreference } from "@/i18n/useLanguagePreference";
import { LANGUAGE_STORAGE_KEY } from "@/i18n/preference";
import { logger } from "@/utils/log";

const mockOpenDesktopSettings = jest.fn(() => Promise.resolve());

jest.mock("@/config/runtimeProfile", () => ({
  profileStorageKey: (key: string) => key,
}));
jest.mock("@/utils/nativeApp", () => ({ isInNativeApp: () => false }));
jest.mock("@/utils", () =>
  jest.requireActual<typeof import("@/utils/cn")>("@/utils/cn"),
);
jest.mock("@/desktop/bridge", () => ({
  desktopSigner: { openDesktopSettings: () => mockOpenDesktopSettings() },
}));

const setLanguage = jest.fn();

function SettingsPage() {
  useLanguagePreference();
  return (
    <HelmetProvider>
      <DesktopSettings />
    </HelmetProvider>
  );
}

beforeEach(async () => {
  jest.clearAllMocks();
  localStorage.clear();
  Object.defineProperty(window, "qrlWallet", {
    configurable: true,
    value: { setLanguage },
  });
  await applyLanguage("en");
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "qrlWallet");
  jest.restoreAllMocks();
});

it.each(languages)(
  "renders only language and native security controls in $code",
  async ({ code }) => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, JSON.stringify(code));
    const { container } = render(<SettingsPage />);
    await waitFor(() => {
      expect(i18n.resolvedLanguage).toBe(code);
    });
    const t = i18n.getFixedT(code, ["settings", "common"]);
    expect(
      screen.getByRole("heading", { name: t("common:settings"), level: 1 }),
    ).toBeTruthy();
    expect(
      screen.getByRole("combobox", { name: t("language") }),
    ).toHaveProperty("value", code);
    expect(screen.getAllByRole("option")).toHaveLength(5);
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(container.querySelectorAll("section")).toHaveLength(2);
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByRole("spinbutton")).toBeNull();
    for (const key of [
      "changePin",
      "network",
      "autoLock",
      "showTokens",
      "showNfts",
      "connections",
      "export",
      "sessions",
    ] as const) {
      expect(screen.queryByText(t(key), { exact: true })).toBeNull();
    }
    expect(setLanguage).toHaveBeenLastCalledWith(code);
    expect(mockOpenDesktopSettings).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", {
        name: `${t("desktopSecurity")} ${t("desktopSecurityHint")}`,
      }),
    );
    await waitFor(() => {
      expect(mockOpenDesktopSettings).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByRole("alert")).toBeNull();

    const next = code === "en" ? "de" : "en";
    fireEvent.change(screen.getByRole("combobox"), { target: { value: next } });
    await waitFor(() => {
      expect(setLanguage).toHaveBeenLastCalledWith(next);
    });
    expect(screen.getByRole("combobox")).toHaveProperty("value", next);
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe(
      JSON.stringify(next),
    );
  },
);

it("shows a localized native settings error and clears it on retry", async () => {
  localStorage.setItem(LANGUAGE_STORAGE_KEY, '"de"');
  const failure = new Error("Window unavailable");
  const report = jest
    .spyOn(logger, "error")
    .mockImplementation(() => undefined);
  mockOpenDesktopSettings.mockRejectedValueOnce(failure);
  render(<SettingsPage />);
  await screen.findByRole("combobox", { name: "Sprache" });
  fireEvent.click(screen.getByRole("button"));
  expect((await screen.findByRole("alert")).textContent).toBe(
    i18n.t("settings:desktopSecurityError"),
  );
  expect(report).toHaveBeenCalledWith(
    "Failed to open desktop security settings:",
    failure,
  );
  fireEvent.click(screen.getByRole("button"));
  await waitFor(() => {
    expect(mockOpenDesktopSettings).toHaveBeenCalledTimes(2);
  });
  expect(screen.queryByRole("alert")).toBeNull();
});
