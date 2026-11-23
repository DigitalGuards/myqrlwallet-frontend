declare const __QRL_LIGHT_THEME__: boolean | undefined;

/**
 * Whether this build offers the theme choice. The build flag
 * VITE_ENABLE_LIGHT_THEME=1 turns it on (config/vite.config.ts); production
 * builds leave it unset, and the desktop and app-embedded builds force it off.
 * Without it there is no Theme row and nothing applies a saved theme.
 */
export const LIGHT_THEME_ENABLED =
  typeof __QRL_LIGHT_THEME__ !== "undefined" && __QRL_LIGHT_THEME__;
