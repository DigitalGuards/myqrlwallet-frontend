/** @jest-environment jsdom */
import {
  DEFAULT_THEME,
  THEME_COLOR,
  THEME_CHANGED,
  THEME_STORAGE_KEY,
  applyTheme,
  applyThemeState,
  currentThemeState,
  type ResolvedTheme,
  type ThemePreference,
  initTheme,
  readThemePreference,
  resolveTheme,
  saveThemePreference,
} from "../preference";

type Listener = () => void;
let systemLight = false;
let mediaListeners: Listener[] = [];

function installMatchMedia() {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: () => ({
      get matches() {
        return systemLight;
      },
      addEventListener: (_type: string, listener: Listener) => {
        mediaListeners.push(listener);
      },
      removeEventListener: (_type: string, listener: Listener) => {
        mediaListeners = mediaListeners.filter((item) => item !== listener);
      },
    }),
  });
}

const root = document.documentElement;
const themeColor = () =>
  document.querySelector('meta[name="theme-color"]')?.getAttribute("content");

beforeEach(() => {
  localStorage.clear();
  // A storage event from elsewhere clears this window's own choice.
  const reset = initTheme();
  window.dispatchEvent(new StorageEvent("storage", { key: null }));
  reset();
  systemLight = false;
  mediaListeners = [];
  installMatchMedia();
  delete root.dataset["theme"];
  document.head.innerHTML = '<meta name="theme-color" content="#080d16">';
});

describe("theme preference", () => {
  it("defaults to system when nothing is saved and writes nothing", () => {
    expect(readThemePreference()).toBe("system");
    expect(currentThemeState().theme).toBe("system");
    expect(localStorage.length).toBe(0);
  });

  it("a user who never chose follows the system, live", () => {
    const stop = initTheme();
    systemLight = true;
    mediaListeners.forEach((listener) => {
      listener();
    });
    expect(root.dataset["theme"]).toBe("light");
    systemLight = false;
    mediaListeners.forEach((listener) => {
      listener();
    });
    expect(root.dataset["theme"]).toBeUndefined();
    expect(localStorage.length).toBe(0);
    stop();
  });

  it("a stored choice wins over the system", () => {
    systemLight = true;
    saveThemePreference("dark");
    expect(currentThemeState()).toEqual({ theme: "dark", resolved: "dark" });
  });

  it("saves and reads each choice", () => {
    for (const choice of ["light", "system", "dark"] as const) {
      saveThemePreference(choice);
      expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe(
        JSON.stringify(choice),
      );
      expect(readThemePreference()).toBe(choice);
    }
  });

  it.each(["not json", '"purple"', "42", "null", '{"theme":"light"}'])(
    "falls back to the default for the stored value %s",
    (stored) => {
      localStorage.setItem(THEME_STORAGE_KEY, stored);
      expect(readThemePreference()).toBe(DEFAULT_THEME);
    },
  );

  it("announces a save to this window", () => {
    const seen = jest.fn();
    window.addEventListener(THEME_CHANGED, seen);
    saveThemePreference("light");
    window.removeEventListener(THEME_CHANGED, seen);
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it("applies the choice for this page view when storage refuses the write", () => {
    const stop = initTheme();
    const set = jest
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("quota");
      });
    saveThemePreference("light");
    set.mockRestore();
    expect(root.dataset["theme"]).toBe("light");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    stop();
  });

  it("still announces when storage refuses the write", () => {
    const set = jest
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("quota");
      });
    const seen = jest.fn();
    window.addEventListener(THEME_CHANGED, seen);
    expect(() => {
      saveThemePreference("light");
    }).not.toThrow();
    window.removeEventListener(THEME_CHANGED, seen);
    set.mockRestore();
    expect(seen).toHaveBeenCalledTimes(1);
  });
});

describe("resolveTheme", () => {
  it("follows the system only for the system choice", () => {
    expect(resolveTheme("system", true)).toBe("light");
    expect(resolveTheme("system", false)).toBe("dark");
    expect(resolveTheme("dark", true)).toBe("dark");
    expect(resolveTheme("light", false)).toBe("light");
  });
});

describe("applyThemeState", () => {
  const state = (theme: ThemePreference, resolved: ResolvedTheme) => ({
    theme,
    resolved,
  });
  it("marks light on the root and updates theme-color", () => {
    expect(applyThemeState(state("light", "light"))).toBe("light");
    expect(root.dataset["theme"]).toBe("light");
    expect(themeColor()).toBe(THEME_COLOR.light);
  });

  it("leaves dark without an attribute", () => {
    applyThemeState(state("light", "light"));
    expect(applyThemeState(state("dark", "dark"))).toBe("dark");
    expect(root.dataset["theme"]).toBeUndefined();
    expect(themeColor()).toBe(THEME_COLOR.dark);
  });

  it("treats a missing matchMedia as a dark system", () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: undefined,
    });
    localStorage.setItem(THEME_STORAGE_KEY, '"system"');
    expect(applyTheme()).toBe("dark");
  });
});

describe("initTheme", () => {
  it("applies the saved choice and stays dark with none", () => {
    const stop = initTheme();
    expect(root.dataset["theme"]).toBeUndefined();
    stop();
    localStorage.setItem(THEME_STORAGE_KEY, '"light"');
    const stopLight = initTheme();
    expect(root.dataset["theme"]).toBe("light");
    stopLight();
  });

  it("applies a save made in this window", () => {
    const stop = initTheme();
    saveThemePreference("light");
    expect(root.dataset["theme"]).toBe("light");
    saveThemePreference("dark");
    expect(root.dataset["theme"]).toBeUndefined();
    stop();
  });

  it("follows system changes while the choice is system", () => {
    localStorage.setItem(THEME_STORAGE_KEY, '"system"');
    const stop = initTheme();
    expect(root.dataset["theme"]).toBeUndefined();
    systemLight = true;
    mediaListeners.forEach((listener) => {
      listener();
    });
    expect(root.dataset["theme"]).toBe("light");
    systemLight = false;
    mediaListeners.forEach((listener) => {
      listener();
    });
    expect(root.dataset["theme"]).toBeUndefined();
    stop();
  });

  it("announces a system change to the pages that follow the theme", () => {
    localStorage.setItem(THEME_STORAGE_KEY, '"system"');
    const stop = initTheme();
    const seen = jest.fn();
    window.addEventListener(THEME_CHANGED, seen);
    systemLight = true;
    mediaListeners.forEach((listener) => {
      listener();
    });
    window.removeEventListener(THEME_CHANGED, seen);
    expect(seen).toHaveBeenCalledTimes(1);
    expect(root.dataset["theme"]).toBe("light");
    stop();
  });

  it("announces no system change while the choice is explicit", () => {
    for (const choice of ['"dark"', '"light"']) {
      localStorage.setItem(THEME_STORAGE_KEY, choice);
      const stop = initTheme();
      const seen = jest.fn();
      window.addEventListener(THEME_CHANGED, seen);
      systemLight = !systemLight;
      mediaListeners.forEach((listener) => {
        listener();
      });
      window.removeEventListener(THEME_CHANGED, seen);
      expect(seen).not.toHaveBeenCalled();
      stop();
    }
  });

  it("ignores system changes under an explicit choice", () => {
    localStorage.setItem(THEME_STORAGE_KEY, '"dark"');
    const stop = initTheme();
    systemLight = true;
    mediaListeners.forEach((listener) => {
      listener();
    });
    expect(root.dataset["theme"]).toBeUndefined();
    stop();
  });

  it("follows a change from another tab and stops after cleanup", () => {
    const stop = initTheme();
    localStorage.setItem(THEME_STORAGE_KEY, '"light"');
    window.dispatchEvent(
      new StorageEvent("storage", { key: THEME_STORAGE_KEY }),
    );
    expect(root.dataset["theme"]).toBe("light");
    stop();
    expect(mediaListeners).toHaveLength(0);
    localStorage.setItem(THEME_STORAGE_KEY, '"dark"');
    window.dispatchEvent(
      new StorageEvent("storage", { key: THEME_STORAGE_KEY }),
    );
    expect(root.dataset["theme"]).toBe("light");
  });
});
