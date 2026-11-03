import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import {
  recordedIndexesForTests,
  recordedRoutesForTests,
  registerBackDismiss,
  registerPageBack,
  recordRoute,
  registeredOverlayCount,
  resetNativeBackForTests,
  resolveNativeBack,
  resolveRouteBack,
} from "@/utils/nativeBack";

const navigate = jest.fn(
  (_path: string, _options?: { replace: true }) => undefined,
);

/** Stand-in for RouteMonitor: record where every navigation lands. */
const recordingNavigate = jest.fn(
  (path: string, options?: { replace: true }) => {
    recordRoute(path, options?.replace ? "REPLACE" : "PUSH");
  },
);

beforeEach(() => {
  jest.clearAllMocks();
  resetNativeBackForTests();
});

describe("overlays answer back first", () => {
  it("closes the topmost overlay and reports handled", () => {
    const outer = jest.fn(() => true);
    const inner = jest.fn(() => true);
    registerBackDismiss(outer);
    registerBackDismiss(inner);

    expect(resolveNativeBack(navigate, "/transfer")).toBe("handled");
    expect(inner).toHaveBeenCalledTimes(1);
    // The outer overlay is still open and answers the next press.
    expect(outer).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("closes one overlay per press", () => {
    const outer = jest.fn(() => true);
    const inner = jest.fn(() => true);
    const closeOuter = registerBackDismiss(outer);
    const closeInner = registerBackDismiss(inner);

    expect(resolveNativeBack(navigate, "/")).toBe("handled");
    closeInner();
    expect(resolveNativeBack(navigate, "/")).toBe("handled");
    closeOuter();
    expect(resolveNativeBack(navigate, "/")).toBe("at-root");
  });

  it("passes down when an overlay declines", () => {
    const declines = jest.fn(() => false);
    registerBackDismiss(declines);
    recordRoute("/");
    recordRoute("/settings");

    expect(resolveNativeBack(navigate, "/settings")).toBe("handled");
    expect(declines).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith("/");
  });

  it("drops an overlay that throws and keeps going", () => {
    const broken = jest.fn(() => {
      throw new Error("render is gone");
    });
    const below = jest.fn(() => true);
    registerBackDismiss(below);
    registerBackDismiss(broken);
    const logged = jest.spyOn(console, "error").mockImplementation(() => {});

    expect(resolveNativeBack(navigate, "/")).toBe("handled");
    expect(below).toHaveBeenCalledTimes(1);
    expect(registeredOverlayCount()).toBe(1);
    logged.mockRestore();
  });

  it("unregisters exactly the overlay that closed", () => {
    const first = registerBackDismiss(() => true);
    registerBackDismiss(() => true);
    expect(registeredOverlayCount()).toBe(2);

    first();
    expect(registeredOverlayCount()).toBe(1);
  });
});

describe("route navigation when nothing is open", () => {
  it("walks back through the in-memory stack", () => {
    // Browser history cannot tell an in-app screen from the site that
    // opened the wallet, so this stack is the record of where the user
    // came from.
    recordRoute("/");
    recordRoute("/account-list");
    recordRoute("/transfer");

    expect(resolveNativeBack(navigate, "/transfer")).toBe("handled");
    expect(navigate).toHaveBeenCalledWith("/account-list");
  });

  it("ignores a repeated route", () => {
    recordRoute("/");
    recordRoute("/settings");
    recordRoute("/settings");

    expect(resolveNativeBack(navigate, "/settings")).toBe("handled");
    expect(navigate).toHaveBeenCalledWith("/");
  });

  it("falls back to Home from a route with no recorded history", () => {
    expect(resolveNativeBack(navigate, "/settings")).toBe("handled");
    expect(navigate).toHaveBeenCalledWith("/");
  });

  it("reports at-root on Home with nothing open, and changes nothing", () => {
    recordRoute("/");

    expect(resolveNativeBack(navigate, "/")).toBe("at-root");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("reaches Home through the stack, then reports at-root", () => {
    recordRoute("/");
    recordRoute("/address-book");

    expect(resolveNativeBack(navigate, "/address-book")).toBe("handled");
    expect(navigate).toHaveBeenCalledWith("/");
    expect(resolveNativeBack(navigate, "/")).toBe("at-root");
  });

  it("keeps the stack bounded over a long session", () => {
    for (let index = 0; index < 200; index += 1) recordRoute(`/route-${index}`);

    // Still resolves, and the oldest entries were dropped rather than kept.
    expect(resolveNativeBack(navigate, "/route-199")).toBe("handled");
    expect(navigate).toHaveBeenCalledWith("/route-198");
  });
});

describe("the on-screen Back target", () => {
  it("goes to the previous in-app screen, query included", () => {
    recordRoute("/", "POP");
    recordRoute("/?collection=abc", "PUSH");
    recordRoute("/nft/abc/1", "PUSH");

    expect(resolveRouteBack(recordingNavigate, "/nft/abc/1", "/")).toBe(true);
    expect(recordingNavigate).toHaveBeenCalledWith("/?collection=abc");
    expect(recordedRoutesForTests()).toEqual(["/", "/?collection=abc"]);
  });

  it("replaces a deep link with its parent when nothing came before", () => {
    // A deep link, a fresh load and a reload all start the trail at the
    // current page: browser history state survives a reload, this does not.
    recordRoute("/disclaimer", "POP");

    expect(resolveRouteBack(recordingNavigate, "/disclaimer", "/legal")).toBe(
      true,
    );
    expect(recordingNavigate).toHaveBeenCalledWith("/legal", { replace: true });
    expect(recordedRoutesForTests()).toEqual(["/legal"]);
  });

  it("walks a chain of parents to a menu page without a loop", () => {
    recordRoute("/disclaimer", "POP");
    resolveRouteBack(recordingNavigate, "/disclaimer", "/legal");
    resolveRouteBack(recordingNavigate, "/legal", "/");

    expect(recordingNavigate.mock.calls).toEqual([
      ["/legal", { replace: true }],
      ["/", { replace: true }],
    ]);
    expect(recordedRoutesForTests()).toEqual(["/"]);
  });

  it("walks the visits back one by one and never forward", () => {
    recordRoute("/", "POP");
    recordRoute("/legal", "PUSH");
    recordRoute("/security", "PUSH");
    recordRoute("/legal", "PUSH");
    recordRoute("/disclaimer", "PUSH");

    const visited: string[] = [];
    let current = "/disclaimer";
    const fallbacks: Record<string, string> = {
      "/disclaimer": "/legal",
      "/security": "/legal",
      "/legal": "/",
    };
    for (let press = 0; press < 10 && current !== "/"; press += 1) {
      resolveRouteBack(
        (path, options) => {
          recordingNavigate(path, options);
          current = path;
        },
        current,
        fallbacks[current],
      );
      visited.push(current);
    }
    expect(visited).toEqual(["/legal", "/security", "/legal", "/"]);
  });

  it("does nothing when the parent is the page itself", () => {
    recordRoute("/legal", "POP");

    expect(resolveRouteBack(recordingNavigate, "/legal", "/legal")).toBe(false);
    expect(resolveRouteBack(recordingNavigate, "/legal")).toBe(false);
    expect(recordingNavigate).not.toHaveBeenCalled();
    expect(recordedRoutesForTests()).toEqual(["/legal"]);
  });

  it("never steps browser history without the browser's history", () => {
    // The desktop and phone apps, and Android back, pass none.
    recordRoute("/", "POP");
    recordRoute("/create-token", "PUSH");
    resolveRouteBack(navigate, "/create-token", "/");
    resolveRouteBack(navigate, "/", "/");

    for (const [target] of navigate.mock.calls) {
      expect(typeof target).toBe("string");
    }
  });
});

describe("the web wallet keeps in step with the browser's Back", () => {
  const back = jest.fn();

  it("steps back when the previous screen is the entry right behind", () => {
    recordRoute("/", "POP", 0);
    recordRoute("/legal", "PUSH", 1);
    recordRoute("/disclaimer", "PUSH", 2);

    expect(
      resolveRouteBack(recordingNavigate, "/disclaimer", "/legal", {
        index: 2,
        back,
      }),
    ).toBe(true);
    expect(back).toHaveBeenCalledTimes(1);
    expect(recordingNavigate).not.toHaveBeenCalled();

    // The router's POP takes the page left off the trail.
    recordRoute("/legal", "POP", 1);
    expect(recordedRoutesForTests()).toEqual(["/", "/legal"]);
    expect(recordedIndexesForTests()).toEqual([0, 1]);
  });

  it("ignores a second press while the step back is still on its way", () => {
    recordRoute("/", "POP", 0);
    recordRoute("/legal", "PUSH", 1);

    const step = { index: 1, back };
    expect(resolveRouteBack(recordingNavigate, "/legal", "/", step)).toBe(
      true,
    );
    // A double click lands before the browser's popstate: one step only,
    // so the tab cannot leave the wallet for the page before it.
    expect(resolveRouteBack(recordingNavigate, "/legal", "/", step)).toBe(
      true,
    );
    expect(back).toHaveBeenCalledTimes(1);
    expect(recordingNavigate).not.toHaveBeenCalled();

    // Once the router reports the POP, Back works again.
    recordRoute("/", "POP", 0);
    recordRoute("/legal", "PUSH", 1);
    resolveRouteBack(recordingNavigate, "/legal", "/", step);
    expect(back).toHaveBeenCalledTimes(2);
  });

  it("acts again after a short wait when no POP arrives", () => {
    jest.useFakeTimers();
    try {
      recordRoute("/", "POP", 0);
      recordRoute("/legal", "PUSH", 1);
      const step = { index: 1, back };
      resolveRouteBack(recordingNavigate, "/legal", "/", step);
      jest.advanceTimersByTime(1000);
      resolveRouteBack(recordingNavigate, "/legal", "/", step);
      expect(back).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it("takes the parent when the previous screen is not right behind", () => {
    recordRoute("/", "POP", 0);
    recordRoute("/legal", "PUSH", 1);
    // The same screen pushed again: the entry behind it is that screen.
    recordRoute("/legal", "PUSH", 2);

    expect(
      resolveRouteBack(recordingNavigate, "/legal", "/", { index: 2, back }),
    ).toBe(true);
    expect(back).not.toHaveBeenCalled();
    expect(recordingNavigate).toHaveBeenCalledWith("/", { replace: true });
    expect(recordedRoutesForTests()).toEqual(["/"]);
  });

  it("takes the parent with nothing recorded before the page", () => {
    // A reload on the third entry of the tab: the entries behind it are
    // from an earlier load.
    recordRoute("/disclaimer", "POP", 2);

    expect(
      resolveRouteBack(recordingNavigate, "/disclaimer", "/legal", {
        index: 2,
        back,
      }),
    ).toBe(true);
    expect(back).not.toHaveBeenCalled();
    expect(recordingNavigate).toHaveBeenCalledWith("/legal", { replace: true });
  });

  it("takes the parent when the browser keeps no index for the entry", () => {
    recordRoute("/", "POP", 0);
    recordRoute("/dapp-sessions", "PUSH", 1);
    // A dApp's link changed only the fragment: an entry with no state.
    recordRoute("/dapp-sessions", "POP", undefined);

    expect(
      resolveRouteBack(recordingNavigate, "/dapp-sessions", "/settings", {
        index: undefined,
        back,
      }),
    ).toBe(true);
    expect(back).not.toHaveBeenCalled();
    expect(recordingNavigate).toHaveBeenCalledWith("/settings", {
      replace: true,
    });
  });

  it("counts a POP as one step back only onto the entry recorded below", () => {
    recordRoute("/legal", "POP", 0);
    recordRoute("/security", "PUSH", 1);
    recordRoute("/legal", "PUSH", 2);
    recordRoute("/disclaimer", "PUSH", 3);
    // Three entries back at once, onto the first Imprint: the screen below
    // the top has the same path but is another entry.
    recordRoute("/legal", "POP", 0);

    expect(recordedRoutesForTests()).toEqual(["/legal"]);
    expect(recordedIndexesForTests()).toEqual([0]);
  });
});

describe("recording follows the router", () => {
  it("drops the screen a browser back left", () => {
    recordRoute("/", "POP");
    recordRoute("/nft/abc/1", "PUSH");
    recordRoute("/", "POP");

    expect(recordedRoutesForTests()).toEqual(["/"]);
    // Android back on Home therefore leaves the app, and never opens the
    // NFT page again.
    expect(resolveNativeBack(navigate, "/")).toBe("at-root");
  });

  it("starts over after a browser move it cannot follow", () => {
    // A step forward, a jump of several entries, or a browser back after a
    // reload: none is one step back, so Back must take the parent.
    recordRoute("/", "POP");
    recordRoute("/legal", "POP");
    expect(recordedRoutesForTests()).toEqual(["/legal"]);

    recordRoute("/", "POP");
    recordRoute("/legal", "PUSH");
    recordRoute("/security", "PUSH");
    recordRoute("/legal", "PUSH");
    recordRoute("/disclaimer", "PUSH");
    recordRoute("/security", "POP");
    expect(recordedRoutesForTests()).toEqual(["/security"]);
  });

  it("keeps the trail on a POP to the screen already shown", () => {
    // A link that changes only the fragment, such as a dApp's
    // #qrlconnect= link into an open wallet tab.
    recordRoute("/", "POP");
    recordRoute("/dapp-sessions", "PUSH");
    recordRoute("/dapp-sessions", "POP");

    expect(recordedRoutesForTests()).toEqual(["/", "/dapp-sessions"]);
  });

  it("swaps the top on a replace and merges it into an equal screen below", () => {
    recordRoute("/", "POP");
    recordRoute("/?collection=abc", "PUSH");
    recordRoute("/?collection=def", "REPLACE");
    expect(recordedRoutesForTests()).toEqual(["/", "/?collection=def"]);

    recordRoute("/", "REPLACE");
    expect(recordedRoutesForTests()).toEqual(["/"]);
  });

  it("starts with a replace when nothing is recorded yet", () => {
    recordRoute("/legal", "REPLACE");

    expect(recordedRoutesForTests()).toEqual(["/legal"]);
  });

  it("collapses a restore of the page already shown", () => {
    recordRoute("/create-token", "POP");
    recordRoute("/create-token", "REPLACE");
    recordRoute("/create-token", "PUSH");

    expect(recordedRoutesForTests()).toEqual(["/create-token"]);
  });
});

describe("Android back agrees with the page's on-screen Back", () => {
  it.each([
    // The router keeps an escape that the reported fragment decodes, as
    // Firefox reports it.
    ["a decoded fragment", "/token-status?name=My%20Token", "/token-status?name=My Token"],
    // The router keeps a backtick that the browser escapes in the fragment.
    ["an escaped fragment", "/token-status?name=a`b", "/token-status?name=a%60b"],
  ])("finds the page through %s", (_name, routerPath, hashPath) => {
    recordRoute("/", "POP");
    recordRoute(routerPath, "PUSH");
    registerPageBack({ path: routerPath, fallback: "/", disabled: true });

    expect(resolveNativeBack(navigate, hashPath)).toBe("handled");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("sets the page shown aside on the trail whatever its spelling", () => {
    recordRoute("/", "POP");
    recordRoute("/legal?from=a%20b", "PUSH");

    expect(resolveNativeBack(navigate, "/legal?from=a b#top")).toBe("handled");
    expect(navigate).toHaveBeenCalledWith("/");
  });

  it("uses the page's parent when the trail is empty", () => {
    recordRoute("/disclaimer", "POP");
    registerPageBack({ path: "/disclaimer", fallback: "/legal", disabled: false });

    expect(resolveNativeBack(navigate, "/disclaimer")).toBe("handled");
    expect(navigate).toHaveBeenCalledWith("/legal", { replace: true });
  });

  it("holds while the page holds its Back", () => {
    recordRoute("/", "POP");
    recordRoute("/token-status", "PUSH");
    registerPageBack({ path: "/token-status", fallback: "/", disabled: true });

    expect(resolveNativeBack(navigate, "/token-status")).toBe("handled");
    expect(navigate).not.toHaveBeenCalled();
    expect(recordedRoutesForTests()).toEqual(["/", "/token-status"]);
  });

  it("closes an open overlay before honouring a held page", () => {
    const close = jest.fn(() => true);
    registerPageBack({ path: "/token-status", fallback: "/", disabled: true });
    registerBackDismiss(close);

    expect(resolveNativeBack(navigate, "/token-status")).toBe("handled");
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("ignores a registration left by the page being replaced", () => {
    recordRoute("/settings", "POP");
    registerPageBack({ path: "/disclaimer", fallback: "/legal", disabled: true });

    expect(resolveNativeBack(navigate, "/settings")).toBe("handled");
    expect(navigate).toHaveBeenCalledWith("/");
  });

  it("forgets a page Back once its control unmounts", () => {
    recordRoute("/disclaimer", "POP");
    const unregister = registerPageBack({
      path: "/disclaimer",
      fallback: "/legal",
      disabled: true,
    });
    unregister();

    expect(resolveNativeBack(navigate, "/disclaimer")).toBe("handled");
    // No page Back left: the default last resort, Home.
    expect(navigate).toHaveBeenCalledWith("/");
  });
});
