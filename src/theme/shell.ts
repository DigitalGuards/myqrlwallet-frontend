import { profileStorageKey } from "@/config/runtimeProfile";
import { IS_EMBEDDED_BUILD } from "@/utils/embeddedRuntime";
import { logger } from "@/utils/log";
import { isInNativeApp, sendToNative } from "@/utils/nativeApp";
import {
  SHELL_THEME_CACHE_NAME,
  THEME_CHANGED,
  SHELL_THEME_GLOBAL,
  parseThemeState,
  type ThemePreference,
  type ThemeState,
} from "./values";

/**
 * The shell's last state, kept for the next start. A copy of what the shell
 * said and never the user's choice: the browser code does not read this key.
 */
export const SHELL_THEME_CACHE_KEY = profileStorageKey(SHELL_THEME_CACHE_NAME);

/**
 * A native shell that leads the theme. The shell stores the choice and says
 * what it resolved to, so a wallet with an adapter never consults
 * prefers-color-scheme. The phone app is the first; the desktop app plugs in
 * here next without touching the callers.
 */
export interface ShellThemeAdapter {
  /** The state known before the shell has said anything this document. */
  initial(): ThemeState | null;
  /** The user picked a theme in the wallet's own Theme row. */
  report(theme: ThemePreference): void;
  /** Whether a state from this shell is kept for the next start. */
  readonly cache: boolean;
  /**
   * Listen for the shell stating a new theme outside the message path (a
   * push from the desktop main process). Returns the unsubscribe.
   */
  subscribe?(onState: (state: unknown) => void): () => void;
}

const phoneAdapter: ShellThemeAdapter = {
  cache: true,
  initial() {
    try {
      const injected = parseThemeState(
        Reflect.get(window, SHELL_THEME_GLOBAL),
      );
      if (injected) return injected;
    } catch {
      // Fall through to the cache.
    }
    try {
      const saved = localStorage.getItem(SHELL_THEME_CACHE_KEY);
      return saved === null ? null : parseThemeState(JSON.parse(saved));
    } catch {
      return null;
    }
  },
  report(theme) {
    sendToNative("THEME_CHANGED", { theme });
  },
};

/**
 * The desktop shell: its main process stores the choice and states it as
 * `window.qrlWallet.theme`, takes the wallet's choice through `setTheme` and
 * pushes changes through `onThemeChanged`. All three are optional, so an older
 * shell keeps browser behaviour. The main process is the source of truth, so
 * nothing is cached here.
 */
const desktopAdapter: ShellThemeAdapter = {
  cache: false,
  initial() {
    return parseThemeState(window.qrlWallet?.theme);
  },
  report(theme) {
    try {
      const sent = window.qrlWallet?.setTheme?.(theme);
      void Promise.resolve(sent).catch((error: unknown) => {
        logger.error("Could not send the theme to the shell:", error);
      });
    } catch (error) {
      logger.error("Could not send the theme to the shell:", error);
    }
  },
  subscribe(onState) {
    try {
      return window.qrlWallet?.onThemeChanged?.(onState) ?? (() => undefined);
    } catch {
      return () => undefined;
    }
  },
};

/** The adapter for the shell this document runs in, or null in a browser. */
export function activeShellAdapter(): ShellThemeAdapter | null {
  if (IS_EMBEDDED_BUILD || isInNativeApp()) return phoneAdapter;
  return desktopAdapter.initial() ? desktopAdapter : null;
}

let shellState: ThemeState | null = null;

/** The shell's state: this document's latest, else the injected global or cache. */
export function readShellThemeState(): ThemeState | null {
  if (shellState) return shellState;
  const adapter = activeShellAdapter();
  return adapter ? adapter.initial() : null;
}

/**
 * The shell stated the theme (SET_THEME, or a desktop push). Both fields must
 * validate. The state is cached for the next start and applied as given.
 */
export function applyShellTheme(value: unknown): boolean {
  const state = parseThemeState(value);
  if (!state) return false;
  shellState = state;
  if (activeShellAdapter()?.cache !== false) {
    try {
      localStorage.setItem(SHELL_THEME_CACHE_KEY, JSON.stringify(state));
    } catch {
      // The state still applies for this document.
    }
  }
  window.dispatchEvent(new Event(THEME_CHANGED));
  return true;
}

/** The user chose in the wallet's Theme row: show it now, tell the shell. */
export function reportShellTheme(
  adapter: ShellThemeAdapter,
  theme: ThemePreference,
): void {
  const current = readShellThemeState();
  // The shell answers with the resolved value; until then keep the colours
  // unless the choice names one.
  shellState = {
    theme,
    resolved: theme === "system" ? (current?.resolved ?? "dark") : theme,
  };
  adapter.report(theme);
  window.dispatchEvent(new Event(THEME_CHANGED));
}

/** Tests only. */
export function resetShellThemeForTests(): void {
  shellState = null;
}
