// Theme values shared by the preference module, the shell adapters and the
// first-frame script. No imports, so the build config can load it too.

export const THEMES = ["dark", "light", "system"] as const;
export type ThemePreference = (typeof THEMES)[number];
export type ResolvedTheme = "dark" | "light";

/** What a shell reports: the choice and what it resolved to. */
export interface ThemeState {
  theme: ThemePreference;
  resolved: ResolvedTheme;
}

/** Window event for a change of the theme state inside this document. */
export const THEME_CHANGED = "qrl-wallet:theme-changed";

/** Storage names; the profile prefix is added where the key is built. */
export const THEME_STORAGE_NAME = "WALLET_THEME";
export const SHELL_THEME_CACHE_NAME = "WALLET_SHELL_THEME";

/** Global the phone shell injects before the document runs. */
export const SHELL_THEME_GLOBAL = "__QRL_SHELL_THEME__";

/**
 * The preference of a user who has not chosen. One constant: nothing writes it
 * to storage, so changing it reaches every user who never picked a theme.
 */
export const DEFAULT_THEME: ThemePreference = "dark";

/** Browser chrome colour per resolved theme, kept in step with the page. */
export const THEME_COLOR: Record<ResolvedTheme, string> = {
  dark: "#080d16",
  light: "#f3f4f7",
};

export function isThemePreference(value: unknown): value is ThemePreference {
  return THEMES.some((theme) => theme === value);
}

export function isResolvedTheme(value: unknown): value is ResolvedTheme {
  return value === "dark" || value === "light";
}

/** A shell state with both fields valid, else null. */
export function parseThemeState(value: unknown): ThemeState | null {
  if (typeof value !== "object" || value === null) return null;
  try {
    const theme: unknown = Reflect.get(value, "theme");
    const resolved: unknown = Reflect.get(value, "resolved");
    if (!isThemePreference(theme) || !isResolvedTheme(resolved)) return null;
    return { theme, resolved };
  } catch {
    // A hostile getter counts as an invalid state.
    return null;
  }
}

/** The resolved theme when no system setting is consulted. */
export function resolveTheme(
  preference: ThemePreference,
  systemPrefersLight: boolean,
): ResolvedTheme {
  if (preference === "system") return systemPrefersLight ? "light" : "dark";
  return preference;
}
