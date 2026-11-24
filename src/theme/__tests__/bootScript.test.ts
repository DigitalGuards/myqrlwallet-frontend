/** @jest-environment jsdom */
import { buildThemeBootScript, type BootScriptOptions } from "../bootScript";
import { currentThemeState, THEME_STORAGE_KEY } from "../preference";
import {
  DEFAULT_THEME,
  SHELL_THEME_CACHE_NAME,
  SHELL_THEME_GLOBAL,
  THEME_COLOR,
  THEME_STORAGE_NAME,
} from "../values";
import { SHELL_THEME_CACHE_KEY, resetShellThemeForTests } from "../shell";

let mockEmbedded = false;
jest.mock("@/utils/embeddedRuntime", () => ({
  get IS_EMBEDDED_BUILD() {
    return mockEmbedded;
  },
}));
jest.mock("@/utils/nativeApp", () => ({
  isInNativeApp: () => false,
  sendToNative: jest.fn(),
}));

const options = (mode: "browser" | "phone"): BootScriptOptions => ({
  mode,
  storageKey: THEME_STORAGE_KEY,
  cacheKey: SHELL_THEME_CACHE_KEY,
  defaultTheme: DEFAULT_THEME,
  shellGlobal: SHELL_THEME_GLOBAL,
});

const root = document.documentElement;
let systemLight = false;

function runBoot(mode: "browser" | "phone"): string | undefined {
  delete root.dataset["theme"];
  document.head.innerHTML = '<meta name="theme-color" content="#000">';
  // Indirect eval: the boot script is a plain classic script.
  (0, eval)(buildThemeBootScript(options(mode)));
  return root.dataset["theme"];
}

beforeEach(() => {
  localStorage.clear();
  resetShellThemeForTests();
  Reflect.deleteProperty(window, SHELL_THEME_GLOBAL);
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: () => ({ matches: systemLight }),
  });
});

it("uses the names the module uses", () => {
  expect(THEME_STORAGE_KEY.endsWith(THEME_STORAGE_NAME)).toBe(true);
  expect(SHELL_THEME_CACHE_KEY.endsWith(SHELL_THEME_CACHE_NAME)).toBe(true);
});

describe("browser mode matches initTheme over the whole matrix", () => {
  const stored = [undefined, '"dark"', '"light"', '"system"', '"purple"', "nope", "7"];
  for (const value of stored) {
    for (const light of [false, true]) {
      it(`stored ${String(value)} system light ${String(light)}`, () => {
        mockEmbedded = false;
        systemLight = light;
        if (value !== undefined) localStorage.setItem(THEME_STORAGE_KEY, value);
        const resolved = currentThemeState().resolved;
        const attribute = runBoot("browser");
        expect(attribute).toBe(resolved === "light" ? "light" : undefined);
        expect(
          document.querySelector('meta[name="theme-color"]')?.getAttribute("content"),
        ).toBe(THEME_COLOR[resolved]);
      });
    }
  }
});

describe("phone mode matches the shell adapter", () => {
  const states: unknown[] = [
    undefined,
    { theme: "light", resolved: "light" },
    { theme: "system", resolved: "dark" },
    { theme: "dark", resolved: "light" },
    { theme: "light" },
    { theme: "x", resolved: "light" },
    "light",
  ];
  for (const injected of states) {
    for (const cached of states) {
      it(`global ${JSON.stringify(injected)} cache ${JSON.stringify(cached)}`, () => {
        mockEmbedded = true;
        systemLight = true;
        resetShellThemeForTests();
        if (injected !== undefined) {
          Object.defineProperty(window, SHELL_THEME_GLOBAL, {
            configurable: true,
            writable: true,
            value: injected,
          });
        }
        if (cached !== undefined) {
          localStorage.setItem(SHELL_THEME_CACHE_KEY, JSON.stringify(cached));
        }
        const resolved = currentThemeState().resolved;
        expect(runBoot("phone")).toBe(resolved === "light" ? "light" : undefined);
      });
    }
  }
});

it("leaves the page dark when storage throws", () => {
  const get = jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  expect(runBoot("browser")).toBeUndefined();
  expect(runBoot("phone")).toBeUndefined();
  get.mockRestore();
});
