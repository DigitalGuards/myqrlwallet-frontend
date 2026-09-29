/**
 * Keeping the app-shipped document in the WebView.
 *
 * The embedded document is injected into the WebView as a string under the
 * qrlwallet.com baseUrl and is served by no origin. Any navigation that leaves
 * it is unrecoverable from the page's point of view: a reload fetches the live
 * site, replacing the audited bundle that came out of the signed app binary,
 * and an external link opened in the same WebView strands the user on a page
 * with no way back to the wallet.
 *
 * What this module can and cannot do, measured rather than assumed:
 *
 *   - Our own reload call is compiled out. `IS_EMBEDDED_BUILD` is a build
 *     constant, so the minifier removes the `window.location.reload()` branch
 *     entirely and the embedded bundle contains no reload call of ours. The
 *     build asserts the emitted document has none at all.
 *   - External links are intercepted in the capture phase, before React Router
 *     or the browser sees the click, and handed to the native bridge. One
 *     listener covers every link in the app, including ones added later.
 *   - `window.location.reload`, `.assign`, `.replace` and `location` itself
 *     CANNOT be replaced: they are non-configurable own properties, and
 *     `Object.defineProperty` throws `Cannot redefine property`. This was
 *     verified in Chromium rather than assumed, so no page-side lock on
 *     third-party code is possible. The last line of defence is the native
 *     shell refusing main-frame navigations after the initial load.
 *
 * Anything that still manages to unload the document is reported to the native
 * side, so an escape is observable instead of silent.
 */
import { IS_EMBEDDED_BUILD, isEmbeddedRuntime } from "./embeddedRuntime";
import { isInNativeApp, logToNative, openExternalUrl } from "./nativeApp";

/**
 * Reload the document, unless doing so would throw the wallet away.
 *
 * Returns whether the reload was issued, so callers can fall back to an
 * in-place reset. In the embedded build the whole body below the guard is
 * dropped at build time, because `IS_EMBEDDED_BUILD` folds to a constant.
 */
export function reloadDocument(): boolean {
  if (IS_EMBEDDED_BUILD || isEmbeddedRuntime()) return false;
  window.location.reload();
  return true;
}

/** Links that stay inside the document: in-app routes and fragments. */
function isInDocumentHref(href: string): boolean {
  return href.length === 0 || href.startsWith("#");
}

/**
 * Hand an external link to the native browser instead of the WebView.
 *
 * Runs in the capture phase so it wins over React Router's own click handler
 * and over the browser default. `openExternalUrl` re-validates the URL and
 * routes it through the OPEN_URL bridge message when the native app is
 * present, so a link can never replace the wallet document with a web page.
 */
function interceptExternalClick(event: MouseEvent): void {
  if (event.defaultPrevented || event.button !== 0) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

  const target = event.target;
  if (!(target instanceof Element)) return;
  const anchor = target.closest("a[href]");
  if (!(anchor instanceof HTMLAnchorElement)) return;

  const href = anchor.getAttribute("href") ?? "";
  if (isInDocumentHref(href)) return;

  // `anchor.href` is resolved against the document, so a stray relative path
  // is caught here too: under the WebView baseUrl it would resolve to the live
  // site and be just as much of an escape as an absolute URL.
  const resolved = anchor.href;
  if (resolved.startsWith(`${window.location.origin}/#`)) return;

  event.preventDefault();
  event.stopPropagation();
  openExternalUrl(resolved);
}

let installed = false;

/**
 * Install the embedded-document protections. Safe to call more than once and
 * a no-op outside the embedded runtime, so the hosted and desktop builds are
 * unaffected.
 */
export function installEmbeddedShell(): void {
  if (installed || typeof window === "undefined") return;
  if (!isEmbeddedRuntime()) return;
  installed = true;

  document.addEventListener("click", interceptExternalClick, { capture: true });

  // Detection, not prevention: the page cannot stop a navigation it did not
  // start, so record it for whoever reads the native log.
  window.addEventListener("pagehide", () => {
    if (isInNativeApp()) {
      logToNative(
        "embedded document is unloading: the shipped wallet is being replaced",
      );
    }
  });
}

/** Test seam: forget that the listeners were installed. */
export function resetEmbeddedShellForTests(): void {
  installed = false;
  document.removeEventListener("click", interceptExternalClick, {
    capture: true,
  });
}
