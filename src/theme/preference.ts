import { profileStorageKey } from "@/config/runtimeProfile";
import {
  activeShellAdapter,
  applyShellTheme,
  readShellThemeState,
  reportShellTheme,
} from "./shell";
import {
  DEFAULT_THEME,
  SHELL_FALLBACK_RESOLVED,
  THEME_CHANGED,
  THEME_COLOR,
  THEMES,
  THEME_STORAGE_NAME,
  isThemePreference,
  resolveTheme,
  type ResolvedTheme,
  type ThemePreference,
  type ThemeState,
} from "./values";

export { THEMES, DEFAULT_THEME, THEME_COLOR, THEME_CHANGED, isThemePreference, resolveTheme };
export type { ResolvedTheme, ThemePreference, ThemeState };

export const THEME_STORAGE_KEY = profileStorageKey(THEME_STORAGE_NAME);

// The choice made in this window. It outranks storage so a refused write
// (full or blocked storage) still applies for this page view. A change from
// another tab clears it.
let chosen: ThemePreference | null = null;

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

const LIGHT_QUERY = "(prefers-color-scheme: light)";

function systemMedia(): MediaQueryList | null {
  return typeof window.matchMedia === "function"
    ? window.matchMedia(LIGHT_QUERY)
    : null;
}

/**
 * The choice and its resolved theme. A shell leads when there is one: its
 * resolved value is used as given and the system setting is never consulted.
 * Without a shell: this window's own choice, else the saved one, resolved
 * with prefers-color-scheme.
 */
export function currentThemeState(): ThemeState {
  if (activeShellAdapter()) {
    return (
      readShellThemeState() ?? {
        theme: DEFAULT_THEME,
        resolved: SHELL_FALLBACK_RESOLVED,
      }
    );
  }
  const theme = chosen ?? readThemePreference();
  return {
    theme,
    resolved: resolveTheme(theme, systemMedia()?.matches ?? false),
  };
}

/** The choice in effect. */
export function currentThemePreference(): ThemePreference {
  return currentThemeState().theme;
}

/**
 * Persist the choice and tell this document. Storage failures leave the choice
 * unsaved. With a shell the choice goes to the shell, which stores it.
 */
export function saveThemePreference(preference: ThemePreference): void {
  const adapter = activeShellAdapter();
  if (adapter) {
    reportShellTheme(adapter, preference);
    return;
  }
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

/** Set the attribute the stylesheet keys on, and the theme-color meta. */
export function applyThemeState(state: ThemeState): ResolvedTheme {
  const root = document.documentElement;
  // Dark is the stylesheet default and carries no attribute.
  if (state.resolved === "light") root.dataset["theme"] = "light";
  else delete root.dataset["theme"];
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", THEME_COLOR[state.resolved]);
  return state.resolved;
}

/** Apply the choice in effect now. */
export function applyTheme(): ResolvedTheme {
  return applyThemeState(currentThemeState());
}

/** A save from another tab: drop this window's own choice and tell listeners. */
function onStorage(event: StorageEvent): void {
  if (event.key === null || event.key === THEME_STORAGE_KEY) {
    chosen = null;
    window.dispatchEvent(new Event(THEME_CHANGED));
  }
}

/**
 * Apply the choice now and keep it current: this window's saves, saves from
 * another tab, the shell's statements, and the system setting while the
 * choice is "system" (never with a shell, which resolves it itself).
 */
export function initTheme(): () => void {
  applyTheme();
  const media = activeShellAdapter() ? null : systemMedia();
  // A system flip goes through the same event as every other change, so the
  // pages that react to the theme (the Theme row, the background video) hear it.
  const onSystemChange = () => {
    // Only the System choice follows the OS; under Dark or Light nothing moved.
    if (currentThemeState().theme === "system") {
      window.dispatchEvent(new Event(THEME_CHANGED));
    }
  };
  media?.addEventListener("change", onSystemChange);
  window.addEventListener(THEME_CHANGED, applyTheme);
  window.addEventListener("storage", onStorage);
  const unsubscribe = activeShellAdapter()?.subscribe?.(applyShellTheme);
  return () => {
    unsubscribe?.();
    media?.removeEventListener("change", onSystemChange);
    window.removeEventListener(THEME_CHANGED, applyTheme);
    window.removeEventListener("storage", onStorage);
  };
}

/**
 * For useSyncExternalStore: change notifications for the Theme row. A save
 * from another tab reaches it through initTheme's storage listener.
 */
export function subscribeTheme(onChange: () => void): () => void {
  window.addEventListener(THEME_CHANGED, onChange);
  return () => {
    window.removeEventListener(THEME_CHANGED, onChange);
  };
}

/** Tests only: forget this window's own choice. */
export function resetThemeChoiceForTests(): void {
  chosen = null;
}
