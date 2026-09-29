/**
 * Runtime detection for the embedded (app-shipped) wallet build.
 *
 * The mobile app ships the wallet as one self-contained document and hands it
 * to its WebView with `baseUrl: "https://qrlwallet.com/"`. The wallet keeps
 * that origin (so localStorage, IndexedDB and relay CORS behave exactly as on
 * the live site) while every byte of executable code comes from the signed app
 * binary. Nothing else is served to that WebView from that origin, so any
 * navigation that leaves the document (a path navigation, a reload, a plain
 * link to an internal route) would fetch the live server and defeat the point.
 *
 * `config/vite.config.embedded.ts` writes `window.__QRL_EMBEDDED__ = true`
 * into <head> ahead of the app script, and every code path that could leave
 * the document asks this helper first. The flag name is exported so the build
 * and the runtime check cannot drift apart.
 */
export const EMBEDDED_GLOBAL_FLAG = "__QRL_EMBEDDED__";

type EmbeddedScope = { [EMBEDDED_GLOBAL_FLAG]?: unknown };

/**
 * True when this document is the app-shipped single-file build.
 *
 * `scope` exists for tests; production callers pass nothing and get `window`.
 */
export function isEmbeddedRuntime(scope?: EmbeddedScope): boolean {
  const target =
    scope ??
    (typeof window === "undefined" ? undefined : (window as EmbeddedScope));
  return target?.[EMBEDDED_GLOBAL_FLAG] === true;
}

/**
 * The inline <head> script the embedded build injects. Kept here so the
 * assignment and the read above always name the same global.
 */
export const EMBEDDED_FLAG_SCRIPT = `window.${EMBEDDED_GLOBAL_FLAG}=true`;
