import { logger } from "./log";
/**
 * Back, resolved by the page: Android hardware back and the on-screen Back
 * control of sub-pages share this module, so both reach the same screen.
 *
 * The native shell used to swallow BACK: it called `goBack()` and returned
 * true unconditionally, so back never left the app and an open modal stayed
 * open. The app now asks the page what back should mean and acts on the
 * answer.
 *
 * Contract with the native side:
 *   native -> page  `{ type: "NATIVE_BACK", payload: { documentId } }`
 *   page  -> native `{ type: "BACK_HANDLED" }`  something was closed, or the
 *                                               page navigated back a route
 *                   `{ type: "BACK_AT_ROOT" }`  Home with nothing open, so the
 *                                               app may background itself
 *
 * Exactly one answer is sent per request.
 *
 * Resolution order, topmost first:
 *   1. the most recently registered open overlay, which dismisses itself
 *   2. a page whose on-screen Back is disabled: nothing happens, as a tap on
 *      that control does nothing
 *   3. the previous in-app route from the stack this module keeps
 *   4. the parent route of a page with an on-screen Back, the same target
 *      that control uses when the stack has nothing to go back to
 *   5. Home, when the current route is not Home
 *   6. otherwise, at root
 *
 * An overlay dismisses through its own close path, so a signing or approval
 * sheet cancels or rejects exactly as its X button does. Nothing here can
 * approve anything.
 */

/** Returns true when the overlay actually closed and back is now spent. */
export type BackDismissHandler = () => boolean;

export type NativeBackOutcome = "handled" | "at-root";

/** How the router reached a location, as react-router reports it. */
export type RouteAction = "PUSH" | "REPLACE" | "POP";

/** The router's navigate. `replace` swaps the current history entry. */
export type RouteNavigate = (path: string, options?: { replace: true }) => void;

interface RegisteredOverlay {
  readonly id: number;
  readonly dismiss: BackDismissHandler;
}

/** Most recently registered last, so the topmost overlay answers first. */
let overlays: RegisteredOverlay[] = [];
let nextOverlayId = 1;

/**
 * In-memory route history: the in-app screens of this page load, oldest
 * first, as `pathname + search`.
 *
 * Browser history cannot answer "is there an earlier in-app screen": the
 * entry before the first one belongs to another site, and history state
 * survives a reload. This stack starts empty on every load and skips
 * repeats, so it holds exactly the screens the user moved through. It holds
 * paths only, never state, and is capped so a long session cannot grow it
 * without bound.
 */
const MAX_ROUTE_STACK = 32;
let routeStack: string[] = [];

/** The route the wallet treats as root. */
export const HOME_ROUTE = "/";

/** The on-screen Back of the page currently shown, as that control reports it. */
export interface PageBackTarget {
  /** The page's path (`pathname + search`) when it registered. */
  readonly path: string;
  /** Where Back goes when the stack holds no earlier screen. */
  readonly fallback: string;
  /** True while the page holds Back, for example during a send. */
  readonly disabled: boolean;
}

interface RegisteredPageBack {
  readonly id: number;
  readonly target: PageBackTarget;
}

let pageBacks: RegisteredPageBack[] = [];
let nextPageBackId = 1;

/**
 * Register an open overlay. Call the returned function when it closes.
 *
 * The handler returns whether it closed something: an overlay that declines
 * (a step that must not be skipped, say) passes back down the stack.
 */
export function registerBackDismiss(dismiss: BackDismissHandler): () => void {
  const id = nextOverlayId;
  nextOverlayId += 1;
  overlays.push({ id, dismiss });
  return () => {
    overlays = overlays.filter((overlay) => overlay.id !== id);
  };
}

/**
 * Register the shown page's on-screen Back, so Android back reaches the same
 * screen. Call the returned function when the control unmounts.
 */
export function registerPageBack(target: PageBackTarget): () => void {
  const id = nextPageBackId;
  nextPageBackId += 1;
  pageBacks.push({ id, target });
  return () => {
    pageBacks = pageBacks.filter((entry) => entry.id !== id);
  };
}

/** The registered Back of the page at `currentPath`, if it has one. */
function pageBackAt(currentPath: string): PageBackTarget | undefined {
  const latest = pageBacks[pageBacks.length - 1];
  // A registration left over from the previous page during a route change
  // does not apply to this one.
  return latest?.target.path === currentPath ? latest.target : undefined;
}

/**
 * Record a route the user navigated to.
 *
 * `action` is how the router got there. A browser back (POP) to the screen
 * below the top removes the screen it left, so the stack keeps matching the
 * way back. A replace swaps the top. Anything else is a visit; a repeat of
 * the top is skipped.
 */
export function recordRoute(path: string, action: RouteAction = "PUSH"): void {
  const top = routeStack.length - 1;
  if (action === "REPLACE" && top >= 0) {
    routeStack[top] = path;
    // Replacing a screen with the one below it leaves one entry for both.
    if (routeStack[top - 1] === path) routeStack.pop();
    return;
  }
  if (action === "POP" && top >= 1 && routeStack[top - 1] === path) {
    routeStack.pop();
    return;
  }
  if (routeStack[top] === path) return;
  routeStack.push(path);
  if (routeStack.length > MAX_ROUTE_STACK) routeStack.shift();
}

/** Stack depth once the entries for the screen being left are set aside. */
function depthBelow(currentPath: string): number {
  let depth = routeStack.length;
  while (depth > 0 && routeStack[depth - 1] === currentPath) depth -= 1;
  return depth;
}

/**
 * Go back one in-app screen from `currentPath`.
 *
 * Goes to the previous screen on the stack. With none recorded (a deep link,
 * a fresh load or a reload), goes to `fallback` and replaces the current
 * entry, so the screen being left cannot come back on a later back. Always
 * an in-app path: this never steps browser history, which could leave the
 * wallet for the site that opened it.
 *
 * Returns false, having changed nothing, when there is nowhere to go.
 */
export function resolveRouteBack(
  navigate: RouteNavigate,
  currentPath: string,
  fallback?: string,
): boolean {
  const depth = depthBelow(currentPath);
  const previous = routeStack[depth - 1];
  if (previous !== undefined) {
    routeStack.length = depth - 1;
    navigate(previous);
    return true;
  }
  if (fallback === undefined || fallback === currentPath) return false;
  routeStack.length = depth;
  navigate(fallback, { replace: true });
  return true;
}

/**
 * Answer one native back request.
 *
 * `navigate` is the router's navigate. It is only called for outcome
 * "handled", so a caller that reports at-root has changed nothing.
 */
export function resolveNativeBack(
  navigate: RouteNavigate,
  currentPath: string,
): NativeBackOutcome {
  for (let index = overlays.length - 1; index >= 0; index -= 1) {
    const overlay = overlays[index];
    if (overlay === undefined) continue;
    let dismissed = false;
    try {
      dismissed = overlay.dismiss();
    } catch (error) {
      // A broken overlay must not strand back. Drop it and keep going.
      logger.error("[back] an overlay failed to dismiss", error);
      overlays = overlays.filter((entry) => entry.id !== overlay.id);
      continue;
    }
    if (dismissed) return "handled";
  }

  const page = pageBackAt(currentPath);
  // The on-screen Back is held, so hardware back holds too.
  if (page?.disabled === true) return "handled";
  if (resolveRouteBack(navigate, currentPath, page?.fallback)) return "handled";

  if (currentPath !== HOME_ROUTE) {
    routeStack.length = depthBelow(currentPath);
    navigate(HOME_ROUTE);
    return "handled";
  }

  return "at-root";
}

/** Test seam: forget every overlay, page Back and recorded route. */
export function resetNativeBackForTests(): void {
  overlays = [];
  pageBacks = [];
  routeStack = [];
  nextOverlayId = 1;
  nextPageBackId = 1;
}

/** Test seam: how many overlays are currently registered. */
export function registeredOverlayCount(): number {
  return overlays.length;
}

/** Test seam: the recorded routes, oldest first. */
export function recordedRoutesForTests(): readonly string[] {
  return [...routeStack];
}
