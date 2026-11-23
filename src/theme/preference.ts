import { profileStorageKey } from "@/config/runtimeProfile";

export const THEMES = ["dark", "light", "system"] as const;
export type ThemePreference = (typeof THEMES)[number];
export type ResolvedTheme = "dark" | "light";

export const DEFAULT_THEME: ThemePreference = "dark";
export const THEME_STORAGE_KEY = profileStorageKey("WALLET_THEME");
export const THEME_CHANGED = "qrl-wallet:theme-changed";

/** Browser chrome colour per resolved theme, kept in step with the page. */
export const THEME_COLOR: Record<ResolvedTheme, string> = {
  dark: "#080d16",
  light: "#ffffff",
};

export function isThemePreference(value: unknown): value is ThemePreference {
  return THEMES.some((theme) => theme === value);
}

// The choice made in this window. It outranks storage so a refused write
// (full or blocked storage) still applies for this page view. A change from
// another tab clears it.
let chosen: ThemePreference | null = null;

/** The choice in effect: this window's own, else the saved one. */
export function currentThemePreference(): ThemePreference {
  return chosen ?? readThemePreference();
}

/** The saved choice. Missing, unreadable or unknown values mean the default. */
export function readThemePreference(): ThemePreference {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === null) return DEFAULT_THEME;
    const value: unknown = JSON.parse(saved);
    return isThemePreference(value) ? value : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

/** Persist the choice and tell this document. Storage failures leave the choice unsaved. */
export function saveThemePreference(preference: ThemePreference): void {
  chosen = preference;
  try {
    const serialized = JSON.stringify(preference);
    if (localStorage.getItem(THEME_STORAGE_KEY) !== serialized) {
      localStorage.setItem(THEME_STORAGE_KEY, serialized);
    }
  } catch {
    // The choice still applies for this page view.
  }
  window.dispatchEvent(new Event(THEME_CHANGED));
}

const LIGHT_QUERY = "(prefers-color-scheme: light)";

function systemMedia(): MediaQueryList | null {
  return typeof window.matchMedia === "function"
    ? window.matchMedia(LIGHT_QUERY)
    : null;
}

export function resolveTheme(
  preference: ThemePreference,
  systemPrefersLight: boolean,
): ResolvedTheme {
  if (preference === "system") return systemPrefersLight ? "light" : "dark";
  return preference;
}

/** Set the attribute the stylesheet keys on, and the theme-color meta. */
export function applyTheme(preference: ThemePreference): ResolvedTheme {
  const resolved = resolveTheme(preference, systemMedia()?.matches ?? false);
  const root = document.documentElement;
  // Dark is the stylesheet default and carries no attribute.
  if (resolved === "light") root.dataset["theme"] = "light";
  else delete root.dataset["theme"];
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", THEME_COLOR[resolved]);
  return resolved;
}

/**
 * Apply the saved choice now and keep it current: this window's saves, saves
 * from another tab, and the system setting while the choice is "system".
 */
export function initTheme(): () => void {
  const sync = () => {
    applyTheme(currentThemePreference());
  };
  sync();
  const media = systemMedia();
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === THEME_STORAGE_KEY) {
      chosen = null;
      sync();
    }
  };
  media?.addEventListener("change", sync);
  window.addEventListener(THEME_CHANGED, sync);
  window.addEventListener("storage", onStorage);
  return () => {
    media?.removeEventListener("change", sync);
    window.removeEventListener(THEME_CHANGED, sync);
    window.removeEventListener("storage", onStorage);
  };
}
