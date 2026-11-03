import { ROUTES, type RoutePath } from "@/router/routes";
import {
  backParent,
  currentBackPlatform,
  followsBrowserHistory,
  historyIndex,
  pageBack,
  type BackPlatform,
} from "@/router/pageBack";

let mockDesktop = false;
let mockInApp = false;
jest.mock("@/desktop/bridge", () => ({
  get isDesktop() {
    return mockDesktop;
  },
}));
jest.mock("@/utils/nativeApp", () => ({
  isInNativeApp: () => mockInApp,
}));

beforeEach(() => {
  mockDesktop = false;
  mockInApp = false;
});

const PLATFORMS: readonly BackPlatform[] = ["web", "desktop", "app"];
const WALLET_STATES = [false, true] as const;

/** The pages the sidebar and the mobile navigation link to. */
const MENU: readonly RoutePath[] = [
  ROUTES.HOME,
  ROUTES.ACCOUNT_LIST,
  ROUTES.TRANSFER,
  ROUTES.ADDRESS_BOOK,
  ROUTES.SETTINGS,
];

/** Routes that render outside the wallet layout and show no Back. */
const OUTSIDE: readonly RoutePath[] = [ROUTES.TELEGRAM, ROUTES.DEFAULT];

/** The route inventory: each sub-page's parent, by platform and wallet. */
function expectedParent(
  route: RoutePath,
  platform: BackPlatform,
  hasWallet: boolean,
): string | null {
  switch (route) {
    case ROUTES.CREATE_ACCOUNT:
    case ROUTES.IMPORT_ACCOUNT:
      return hasWallet ? ROUTES.ACCOUNT_LIST : ROUTES.HOME;
    case ROUTES.ADD_ACCOUNT:
      return ROUTES.ACCOUNT_LIST;
    case ROUTES.CREATE_TOKEN:
    case ROUTES.TOKEN_STATUS:
    case ROUTES.QR_VIEW:
    case ROUTES.TRANSACTION_HISTORY:
    case ROUTES.NFT_DETAIL:
    case ROUTES.TERMS:
    case ROUTES.PRIVACY:
    case ROUTES.LEGAL:
      return ROUTES.HOME;
    case ROUTES.DISCLAIMER:
    case ROUTES.SECURITY:
      return ROUTES.LEGAL;
    case ROUTES.DAPP_SESSIONS:
      return { web: ROUTES.SETTINGS, desktop: null, app: ROUTES.HOME }[
        platform
      ];
    default:
      return null;
  }
}

const allRoutes = Object.values(ROUTES);

describe("which pages show Back", () => {
  it.each(MENU)("%s is a menu destination with no Back", (route) => {
    for (const platform of PLATFORMS)
      for (const hasWallet of WALLET_STATES)
        expect(backParent(route, { platform, hasWallet })).toBeNull();
  });

  it.each(OUTSIDE)("%s is outside the wallet layout and has no Back", (route) => {
    for (const platform of PLATFORMS)
      expect(backParent(route, { platform })).toBeNull();
  });

  it("treats dApp connections as a menu destination on desktop only", () => {
    expect(backParent(ROUTES.DAPP_SESSIONS, { platform: "desktop" })).toBeNull();
    expect(backParent(ROUTES.DAPP_SESSIONS, { platform: "web" })).toBe(
      ROUTES.SETTINGS,
    );
    // The phone app's Settings is a native screen.
    expect(backParent(ROUTES.DAPP_SESSIONS, { platform: "app" })).toBe(
      ROUTES.HOME,
    );
  });

  it("gives every route the parent from the route inventory", () => {
    for (const route of allRoutes)
      for (const platform of PLATFORMS)
        for (const hasWallet of WALLET_STATES)
          expect([route, platform, hasWallet, backParent(route, { platform, hasWallet })]).toEqual([
            route,
            platform,
            hasWallet,
            expectedParent(route, platform, hasWallet),
          ]);
  });

  it("lists exactly these sub-pages on the web", () => {
    const subPages = allRoutes.filter(
      (route) => backParent(route, { platform: "web" }) !== null,
    );
    expect(subPages.sort()).toEqual(
      [
        ROUTES.CREATE_ACCOUNT,
        ROUTES.IMPORT_ACCOUNT,
        ROUTES.ADD_ACCOUNT,
        ROUTES.CREATE_TOKEN,
        ROUTES.TOKEN_STATUS,
        ROUTES.QR_VIEW,
        ROUTES.TRANSACTION_HISTORY,
        ROUTES.NFT_DETAIL,
        ROUTES.DAPP_SESSIONS,
        ROUTES.TERMS,
        ROUTES.PRIVACY,
        ROUTES.LEGAL,
        ROUTES.DISCLAIMER,
        ROUTES.SECURITY,
      ].sort(),
    );
  });

  it("follows parents to a menu destination without a loop", () => {
    const routePaths = new Set<string>(allRoutes);
    const isRoute = (path: string): path is RoutePath => routePaths.has(path);
    for (const platform of PLATFORMS)
      for (const hasWallet of WALLET_STATES)
        for (const route of allRoutes) {
          let current: RoutePath = route;
          const seen = new Set<string>([current]);
          let parent = backParent(current, { platform, hasWallet });
          while (parent !== null) {
            if (!isRoute(parent)) throw new Error(`${parent} is not a route`);
            expect(seen.has(parent)).toBe(false);
            seen.add(parent);
            current = parent;
            parent = backParent(current, { platform, hasWallet });
          }
          if (!OUTSIDE.includes(current))
            expect([...MENU, ROUTES.DAPP_SESSIONS]).toContain(current);
          // No chain is longer than two steps: Security, Imprint, Home.
          expect(seen.size).toBeLessThanOrEqual(3);
        }
  });
});

describe("pageBack", () => {
  it("gives a menu destination no Back", () => {
    expect(pageBack(ROUTES.SETTINGS)).toBeUndefined();
    expect(
      pageBack(ROUTES.DAPP_SESSIONS, { platform: "desktop" }),
    ).toBeUndefined();
  });

  it("sets a sub-page's parent and leaves Back enabled", () => {
    expect(pageBack(ROUTES.DISCLAIMER)).toEqual({
      fallback: ROUTES.LEGAL,
      disabled: false,
      onBack: undefined,
    });
  });

  it("passes the held state, a closer parent and a custom walk through", () => {
    const onBack = jest.fn();
    expect(
      pageBack(ROUTES.NFT_DETAIL, {
        fallback: "/?collection=abc",
        disabled: true,
        onBack,
      }),
    ).toEqual({ fallback: "/?collection=abc", disabled: true, onBack });
  });

  it("passes the platform through, which decides how Back walks", () => {
    expect(pageBack(ROUTES.LEGAL, { platform: "desktop" })?.platform).toBe(
      "desktop",
    );
    expect(pageBack(ROUTES.LEGAL)?.platform).toBeUndefined();
  });

  it("reads the wallet state for the account pages", () => {
    expect(pageBack(ROUTES.IMPORT_ACCOUNT)?.fallback).toBe(ROUTES.HOME);
    expect(
      pageBack(ROUTES.IMPORT_ACCOUNT, { hasWallet: true })?.fallback,
    ).toBe(ROUTES.ACCOUNT_LIST);
  });
});

describe("the running platform", () => {
  it("detects desktop, the phone app and the web", () => {
    expect(currentBackPlatform()).toBe("web");
    mockInApp = true;
    expect(currentBackPlatform()).toBe("app");
    mockDesktop = true;
    expect(currentBackPlatform()).toBe("desktop");
  });

  it("keeps Back in step with browser history on the web only", () => {
    expect(followsBrowserHistory("web")).toBe(true);
    expect(followsBrowserHistory("desktop")).toBe(false);
    expect(followsBrowserHistory("app")).toBe(false);
    expect(followsBrowserHistory()).toBe(true);
    mockInApp = true;
    expect(followsBrowserHistory()).toBe(false);
    mockInApp = false;
    mockDesktop = true;
    expect(followsBrowserHistory()).toBe(false);
  });

  it("knows no history index without a browser", () => {
    expect(historyIndex()).toBeUndefined();
  });

  it("uses it when the caller leaves the platform out", () => {
    mockDesktop = true;
    expect(pageBack(ROUTES.DAPP_SESSIONS)).toBeUndefined();
    mockDesktop = false;
    mockInApp = true;
    expect(pageBack(ROUTES.DAPP_SESSIONS)?.fallback).toBe(ROUTES.HOME);
  });
});
