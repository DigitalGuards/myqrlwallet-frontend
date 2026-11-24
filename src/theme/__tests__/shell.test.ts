/** @jest-environment jsdom */
import { THEME_STORAGE_KEY } from "../preference";

let mockEmbedded = true;
jest.mock("@/utils/embeddedRuntime", () => ({
  get IS_EMBEDDED_BUILD() {
    return mockEmbedded;
  },
}));
const mockSend = jest.fn((..._args: unknown[]): boolean => true);
jest.mock("@/utils/nativeApp", () => ({
  isInNativeApp: () => false,
  sendToNative: (...args: unknown[]): boolean => mockSend(...args),
}));

import {
  SHELL_THEME_CACHE_KEY,
  applyShellTheme,
  resetShellThemeForTests,
} from "../shell";
import {
  applyTheme,
  currentThemeState,
  initTheme,
  readThemePreference,
  resetThemeChoiceForTests,
  saveThemePreference,
} from "../preference";

const root = document.documentElement;
const matchMedia = jest.fn();

beforeEach(() => {
  mockEmbedded = true;
  mockSend.mockReset();
  localStorage.clear();
  Reflect.deleteProperty(window, "__QRL_SHELL_THEME__");
  delete root.dataset["theme"];
  resetShellThemeForTests();
  resetThemeChoiceForTests();
  matchMedia.mockReset();
  matchMedia.mockReturnValue({
    matches: true,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: matchMedia,
  });
});

const injected = (value: unknown) => {
  Object.defineProperty(window, "__QRL_SHELL_THEME__", {
    configurable: true,
    writable: true,
    value,
  });
};

describe("the phone shell leads", () => {
  it("applies the injected state before anything else", () => {
    injected({ theme: "system", resolved: "light" });
    applyTheme();
    expect(root.dataset["theme"]).toBe("light");
    expect(currentThemeState()).toEqual({ theme: "system", resolved: "light" });
  });

  it("never consults the system setting", () => {
    injected({ theme: "system", resolved: "dark" });
    const stop = initTheme();
    expect(root.dataset["theme"]).toBeUndefined();
    stop();
    resetShellThemeForTests();
    Reflect.deleteProperty(window, "__QRL_SHELL_THEME__");
    applyTheme();
    expect(matchMedia).not.toHaveBeenCalled();
  });

  it.each([
    [{ theme: "light" }],
    [{ theme: "light", resolved: "system" }],
    [{ theme: "x", resolved: "dark" }],
    ["light"],
    [null],
  ])("falls back to the cache when the global is invalid: %j", (value) => {
    injected(value);
    localStorage.setItem(
      SHELL_THEME_CACHE_KEY,
      JSON.stringify({ theme: "light", resolved: "light" }),
    );
    expect(currentThemeState()).toEqual({ theme: "light", resolved: "light" });
  });

  it("uses the cache when the global is missing", () => {
    localStorage.setItem(
      SHELL_THEME_CACHE_KEY,
      JSON.stringify({ theme: "system", resolved: "light" }),
    );
    applyTheme();
    expect(root.dataset["theme"]).toBe("light");
  });

  it("uses the default when the global and the cache are missing or invalid", () => {
    expect(currentThemeState()).toEqual({ theme: "dark", resolved: "dark" });
    localStorage.setItem(SHELL_THEME_CACHE_KEY, "not json");
    expect(currentThemeState()).toEqual({ theme: "dark", resolved: "dark" });
    localStorage.setItem(SHELL_THEME_CACHE_KEY, '{"theme":"light"}');
    expect(currentThemeState()).toEqual({ theme: "dark", resolved: "dark" });
  });

  it("SET_THEME state replaces the injected one and refreshes the cache", () => {
    injected({ theme: "dark", resolved: "dark" });
    expect(applyShellTheme({ theme: "light", resolved: "light" })).toBe(true);
    expect(currentThemeState()).toEqual({ theme: "light", resolved: "light" });
    expect(JSON.parse(localStorage.getItem(SHELL_THEME_CACHE_KEY) ?? "")).toEqual({
      theme: "light",
      resolved: "light",
    });
  });

  it("keeps the old state when SET_THEME is invalid", () => {
    applyShellTheme({ theme: "light", resolved: "light" });
    expect(applyShellTheme({ theme: "dark" })).toBe(false);
    expect(currentThemeState().resolved).toBe("light");
  });

  it("sends the wallet's own choice to the shell and saves no user choice", () => {
    saveThemePreference("light");
    expect(mockSend).toHaveBeenCalledWith("THEME_CHANGED", { theme: "light" });
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(currentThemeState()).toEqual({ theme: "light", resolved: "light" });
  });

  it("keeps the resolved colours while the shell resolves a system choice", () => {
    applyShellTheme({ theme: "light", resolved: "light" });
    saveThemePreference("system");
    expect(mockSend).toHaveBeenCalledWith("THEME_CHANGED", { theme: "system" });
    expect(currentThemeState()).toEqual({ theme: "system", resolved: "light" });
  });
});

describe("the browser build", () => {
  beforeEach(() => {
    mockEmbedded = false;
  });

  it("never treats the shell cache as the user's choice", () => {
    localStorage.setItem(
      SHELL_THEME_CACHE_KEY,
      JSON.stringify({ theme: "light", resolved: "light" }),
    );
    expect(readThemePreference()).toBe("dark");
    expect(currentThemeState()).toEqual({ theme: "dark", resolved: "dark" });
    applyTheme();
    expect(root.dataset["theme"]).toBeUndefined();
  });

  it("ignores the injected global and answers SET_THEME with a cache only", () => {
    injected({ theme: "light", resolved: "light" });
    expect(currentThemeState().resolved).toBe("dark");
  });

  it("sends nothing to a shell", () => {
    saveThemePreference("light");
    expect(mockSend).not.toHaveBeenCalled();
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('"light"');
  });
});

describe("the desktop shell leads", () => {
  type Bridge = {
    theme?: unknown;
    setTheme?: jest.Mock;
    onThemeChanged?: jest.Mock;
  };
  const install = (bridge: Bridge | undefined) => {
    Object.defineProperty(window, "qrlWallet", {
      configurable: true,
      writable: true,
      value: bridge,
    });
  };
  beforeEach(() => {
    mockEmbedded = false;
  });
  afterEach(() => {
    install(undefined);
  });

  it("applies the main process state and ignores the stored choice and the system", () => {
    install({ theme: { theme: "system", resolved: "light" } });
    localStorage.setItem(THEME_STORAGE_KEY, '"dark"');
    applyTheme();
    expect(root.dataset["theme"]).toBe("light");
    expect(currentThemeState()).toEqual({ theme: "system", resolved: "light" });
    expect(matchMedia).not.toHaveBeenCalled();
  });

  it.each([
    [{ theme: "light" }],
    [{ theme: "light", resolved: "x" }],
    ["light"],
    [undefined],
  ])("keeps browser behaviour for an invalid or missing state %j", (theme) => {
    install({ theme });
    expect(currentThemeState()).toEqual({ theme: "dark", resolved: "dark" });
  });

  it("keeps browser behaviour when the shell has no theme members", () => {
    install({});
    expect(currentThemeState()).toEqual({ theme: "dark", resolved: "dark" });
  });

  it("sends the choice through setTheme and shows it at once", () => {
    const setTheme = jest.fn().mockResolvedValue(undefined);
    install({ theme: { theme: "dark", resolved: "dark" }, setTheme });
    saveThemePreference("light");
    expect(setTheme).toHaveBeenCalledWith("light");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(currentThemeState()).toEqual({ theme: "light", resolved: "light" });
  });

  it("survives a rejecting setTheme", async () => {
    const setTheme = jest.fn().mockRejectedValue(new Error("denied"));
    install({ theme: { theme: "dark", resolved: "dark" }, setTheme });
    expect(() => {
      saveThemePreference("light");
    }).not.toThrow();
    await Promise.resolve();
  });

  it("follows onThemeChanged pushes, validates them, caches nothing and unsubscribes", () => {
    let push: (state: unknown) => void = () => undefined;
    const unsubscribe = jest.fn();
    const onThemeChanged = jest.fn((callback: (state: unknown) => void) => {
      push = callback;
      return unsubscribe;
    });
    install({ theme: { theme: "dark", resolved: "dark" }, onThemeChanged });
    const stop = initTheme();
    push({ theme: "system", resolved: "light" });
    expect(root.dataset["theme"]).toBe("light");
    push({ theme: "system" });
    expect(root.dataset["theme"]).toBe("light");
    expect(localStorage.getItem(SHELL_THEME_CACHE_KEY)).toBeNull();
    stop();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
