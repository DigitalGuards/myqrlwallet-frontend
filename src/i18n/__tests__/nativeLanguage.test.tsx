/** @jest-environment jsdom */
import { StrictMode } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { useLanguagePreference } from "../useLanguagePreference";
import { applyLanguage, i18n, namespaces } from "../index";
import { LANGUAGE_STORAGE_KEY, saveLanguagePreference } from "../preference";
import { getCurrentNativeDocumentId } from "@/utils/nativeApp";
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
import { notifyNativeLanguage } from "../nativeLanguage";

jest.mock("@/utils/embeddedRuntime", () => ({ HAS_NATIVE_BRIDGE: true }));
jest.mock("@/config/runtimeProfile", () => ({
  IS_V3_PROFILE: false,
  profileStorageKey: (key: string) => key,
}));
jest.mock("@/utils/log", () => ({
  logger: { error: jest.fn() },
  logWarning: jest.fn(),
}));
const postMessage = jest.fn();
const setLanguage = jest.fn();
function Preferences() {
  useLanguagePreference();
  return null;
}
function desktop(value: unknown): void {
  Object.defineProperty(window, "qrlWallet", { configurable: true, value });
}
beforeEach(async () => {
  mockDownload = deferred<typeof german>();
  mockDownload.resolve(german);
  localStorage.clear();
  Reflect.deleteProperty(window, "ReactNativeWebView");
  Reflect.deleteProperty(window, "qrlWallet");
  jest.spyOn(navigator, "userAgent", "get").mockReturnValue("Browser");
  await applyLanguage("en");
  jest.clearAllMocks();
  setLanguage.mockReturnValue(undefined);
});
afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

it.each(["mobile", "desktop", "old desktop", "noncallable desktop", "web"])(
  "signals startup and every change on %s",
  async (shell) => {
    if (shell === "mobile") {
      window.ReactNativeWebView = { postMessage };
      jest.spyOn(navigator, "userAgent", "get").mockReturnValue("MyQRLWallet");
    }
    if (shell === "desktop") desktop({ setLanguage });
    if (shell === "old desktop") desktop({});
    if (shell === "noncallable desktop")
      desktop({ setLanguage: "unsupported" });
    localStorage.setItem(LANGUAGE_STORAGE_KEY, '"de"');
    await act(async () => {
      render(
        <StrictMode>
          <Preferences />
        </StrictMode>,
      );
      await Promise.resolve();
    });
    for (const language of ["es", "ru", "zh-CN", "en"] as const) {
      await act(async () => {
        saveLanguagePreference(language);
        await applyLanguage(language);
      });
      // Duplicate same-value restoration must not notify a second time.
      await act(async () => {
        window.dispatchEvent(
          new StorageEvent("storage", { key: LANGUAGE_STORAGE_KEY }),
        );
        await Promise.resolve();
      });
    }
    const expected = ["de", "es", "ru", "zh-CN", "en"];
    if (shell === "mobile") {
      expect(postMessage.mock.calls).toEqual(
        expected.map((language) => [
          JSON.stringify({
            type: "LANGUAGE_CHANGED",
            payload: { language, documentId: getCurrentNativeDocumentId() },
          }),
        ]),
      );
      expect(setLanguage).not.toHaveBeenCalled();
    } else {
      expect(postMessage).not.toHaveBeenCalled();
      expect(setLanguage.mock.calls).toEqual(
        shell === "desktop" ? expected.map((language) => [language]) : [],
      );
    }
  },
);
it("waits for the startup catalog, and ignores superseded completion", async () => {
  desktop({ setLanguage });
  for (const ns of namespaces) i18n.removeResourceBundle("de", ns);
  mockDownload = deferred<typeof german>();
  localStorage.setItem(LANGUAGE_STORAGE_KEY, '"de"');
  await act(async () => {
    render(<Preferences />);
    await Promise.resolve();
  });
  expect(setLanguage).not.toHaveBeenCalled();
  await act(async () => {
    await applyLanguage("es");
  });
  expect(setLanguage.mock.calls).toEqual([["es"]]);
  await act(async () => {
    mockDownload.resolve(german);
    await Promise.resolve();
  });
  expect(setLanguage.mock.calls).toEqual([["es"]]);
});
it("signals resolved English after a startup catalog failure", async () => {
  desktop({ setLanguage });
  for (const ns of namespaces) i18n.removeResourceBundle("de", ns);
  mockDownload = deferred<typeof german>();
  void mockDownload.promise.catch(() => undefined);
  localStorage.setItem(LANGUAGE_STORAGE_KEY, '"de"');
  await act(async () => {
    render(
      <StrictMode>
        <Preferences />
      </StrictMode>,
    );
    await Promise.resolve();
  });
  await act(async () => {
    mockDownload.reject(new Error("catalog unavailable"));
    await Promise.resolve();
  });
  expect(setLanguage.mock.calls).toEqual([["en"]]);
  expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('"de"');
});
it("isolates shell failures from renderer language changes", async () => {
  desktop({ setLanguage });
  setLanguage.mockImplementationOnce(() => {
    throw new Error("shell failure");
  });
  expect(() => {
    notifyNativeLanguage("ru");
  }).not.toThrow();
  setLanguage.mockRejectedValueOnce(new Error("shell rejection"));
  await act(async () => {
    notifyNativeLanguage("es");
    await Promise.resolve();
  });
});

it("signals the timeout fallback once and ignores the late catalog", async () => {
  jest.useFakeTimers();
  desktop({ setLanguage });
  for (const ns of namespaces) i18n.removeResourceBundle("de", ns);
  mockDownload = deferred<typeof german>();
  localStorage.setItem(LANGUAGE_STORAGE_KEY, '"de"');
  await act(async () => {
    render(<Preferences />);
    await jest.advanceTimersByTimeAsync(0);
  });
  expect(setLanguage).not.toHaveBeenCalled();
  await act(async () => {
    await jest.advanceTimersByTimeAsync(4000);
  });
  expect(setLanguage.mock.calls).toEqual([["en"]]);
  await act(async () => {
    mockDownload.resolve(german);
    await jest.advanceTimersByTimeAsync(0);
  });
  expect(setLanguage.mock.calls).toEqual([["en"]]);
});
