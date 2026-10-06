/**
 * Android hardware back, routed into the page.
 *
 * The native shell used to swallow BACK: it called `goBack()` and returned
 * true unconditionally, so back never left the app, an open modal stayed open,
 * and because the wallet's hash routes replace history one press landed on the
 * bare base entry. The app now asks the page what back should mean and acts on
 * the answer.
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
 *   2. the previous in-app route from the stack this module keeps
 *   3. Home, when the current route is not Home
 *   4. otherwise, at root
 *
 * An overlay dismisses through its own close path, so a signing or approval
 * sheet cancels or rejects exactly as its X button does. Nothing here can
 * approve anything.
 */

/** Returns true when the overlay actually closed and back is now spent. */
export type BackDismissHandler = () => boolean;

export type NativeBackOutcome = "handled" | "at-root";

interface RegisteredOverlay {
  readonly id: number;
  readonly dismiss: BackDismissHandler;
}

/** Most recently registered last, so the topmost overlay answers first. */
let overlays: RegisteredOverlay[] = [];
let nextOverlayId = 1;

/**
 * In-memory route history.
 *
 * The hash router replaces history entries, so `history.back()` cannot walk
 * the wallet's own routes. This stack is the substitute. It holds paths only,
 * never state, and is capped so a long session cannot grow it without bound.
 */
const MAX_ROUTE_STACK = 32;
let routeStack: string[] = [];

/** The route the wallet treats as root. */
export const HOME_ROUTE = "/";

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

/** Record a route the user navigated to. */
export function recordRoute(path: string): void {
  const last = routeStack[routeStack.length - 1];
  if (last === path) return;
  routeStack.push(path);
  if (routeStack.length > MAX_ROUTE_STACK) routeStack.shift();
}

/**
 * Answer one native back request.
 *
 * `navigate` is the router's navigate. It is only called for outcome
 * "handled", so a caller that reports at-root has changed nothing.
 */
export function resolveNativeBack(
  navigate: (path: string) => void,
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
      console.error("[back] an overlay failed to dismiss", error);
      overlays = overlays.filter((entry) => entry.id !== overlay.id);
      continue;
    }
    if (dismissed) return "handled";
  }

  // Drop the current route, then go to whatever preceded it.
  while (routeStack.length > 0 && routeStack[routeStack.length - 1] === currentPath) {
    routeStack.pop();
  }
  const previous = routeStack[routeStack.length - 1];
  if (previous !== undefined && previous !== currentPath) {
    routeStack.pop();
    navigate(previous);
    return "handled";
  }

  if (currentPath !== HOME_ROUTE) {
    navigate(HOME_ROUTE);
    return "handled";
  }

  return "at-root";
}

/** Test seam: forget every overlay and the recorded routes. */
export function resetNativeBackForTests(): void {
  overlays = [];
  routeStack = [];
  nextOverlayId = 1;
}

/** Test seam: how many overlays are currently registered. */
export function registeredOverlayCount(): number {
  return overlays.length;
}
