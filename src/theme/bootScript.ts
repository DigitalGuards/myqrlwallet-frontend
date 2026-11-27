import { THEME_COLOR, type ResolvedTheme, type ThemePreference } from "./values";

export interface BootScriptOptions {
  /**
   * browser: the desktop main process's state when `window.qrlWallet.theme`
   * exists, else the saved choice resolved with prefers-color-scheme.
   * phone: the shell's injected state, else its cached copy, else the
   * fallback. prefers-color-scheme is never consulted.
   */
  mode: "browser" | "phone";
  /** Storage key of the user's saved choice (THEME_STORAGE_KEY). */
  storageKey: string;
  /** Storage key of the shell cache (SHELL_THEME_CACHE_KEY). */
  cacheKey: string;
  /** DEFAULT_THEME. */
  defaultTheme: ThemePreference;
  /** SHELL_FALLBACK_RESOLVED: the phone result when the shell stated nothing. */
  shellFallback: ResolvedTheme;
  /** Name of the global the phone shell injects. */
  shellGlobal: string;
}

/**
 * The classic script that sets the theme attribute before the first frame.
 *
 * It runs synchronously in <head>, so the browser has not painted yet when it
 * has run. It repeats the resolution in src/theme/preference.ts in plain ES5
 * because nothing can be imported this early; bootScript.test.ts runs both over
 * one matrix so they cannot drift. Every read is guarded: a failure leaves the
 * stylesheet default, which is dark.
 */
export function buildThemeBootScript(options: BootScriptOptions): string {
  const j = (value: string): string => JSON.stringify(value);
  const colors = JSON.stringify(THEME_COLOR);
  const phone = `var s=w[${j(options.shellGlobal)}];` +
    `if(valid(s)){r=s.resolved}else{` +
    `try{var c=JSON.parse(localStorage.getItem(${j(options.cacheKey)}));` +
    `if(valid(c))r=c.resolved}catch(e){}}` +
    `if(!r)r=${j(options.shellFallback)};`;
  const browser = `var q=w.qrlWallet;if(q&&valid(q.theme))r=q.theme.resolved;else{var p=${j(options.defaultTheme)};` +
    `try{var v=JSON.parse(localStorage.getItem(${j(options.storageKey)}));` +
    `if(v==="dark"||v==="light"||v==="system")p=v}catch(e){}` +
    `r=p==="system"?(w.matchMedia&&w.matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"):p}`;
  return (
    `(function(){try{var w=window,r=null;` +
    `function valid(x){return !!x&&typeof x==="object"&&` +
    `(x.theme==="dark"||x.theme==="light"||x.theme==="system")&&` +
    `(x.resolved==="dark"||x.resolved==="light")}` +
    (options.mode === "phone" ? phone : browser) +
    `if(r==="light")document.documentElement.setAttribute("data-theme","light");` +
    `var m=document.querySelector('meta[name="theme-color"]');` +
    `if(m)m.setAttribute("content",${colors}[r])}catch(e){}})();`
  );
}
