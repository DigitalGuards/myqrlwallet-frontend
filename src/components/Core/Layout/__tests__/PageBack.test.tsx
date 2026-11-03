/** @jest-environment jsdom */
import {
  fakeHistory,
  fakeRouterModule as mockRouterModule,
  useFakeLocation,
} from "@/test-utils/fakeRouterHistory";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useNavigate } from "react-router";
import RouteMonitor from "../../RouteMonitor/RouteMonitor";
import { PageShell } from "../PageShell";
import { PageBack, RouteBack } from "../PageBack";
import type { BackPlatform, PageBackConfig } from "@/router/pageBack";
import { ROUTES, type RoutePath } from "@/router/routes";
import {
  recordedRoutesForTests,
  resetNativeBackForTests,
  resolveNativeBack,
} from "@/utils/nativeBack";
import { applyLanguage } from "@/i18n";
import { EMBEDDED_GLOBAL_FLAG } from "@/utils/embeddedRuntime";

/**
 * The on-screen Back against a model of browser history, with the real
 * RouteMonitor recording the trail, and Android back resolved by the same
 * function the phone app's bridge calls. The pages run as the web wallet
 * unless a test sets another platform.
 */

jest.mock("react-router", () => mockRouterModule());
jest.mock("@/stores/store", () => ({
  useStore: () => ({ qrlStore: { qrlConnection: { isConnected: false } } }),
}));
jest.mock("@/utils/storage", () => ({
  StorageUtil: {
    getActivePage: () => Promise.resolve(""),
    setActivePage: () => Promise.resolve(),
  },
}));
jest.mock("@/router/router", () => ({
  ROUTES: jest.requireActual<typeof import("@/router/routes")>(
    "@/router/routes",
  ).ROUTES,
}));
jest.mock("mobx-react-lite", () => ({
  observer: (component: unknown) => component,
}));

const PAGES: Record<
  string,
  { route: RoutePath; title: string; links?: readonly string[] }
> = {
  "/": { route: ROUTES.HOME, title: "Home", links: ["/legal", "/create-token"] },
  "/legal": {
    route: ROUTES.LEGAL,
    title: "Imprint",
    links: ["/disclaimer", "/security"],
  },
  "/disclaimer": { route: ROUTES.DISCLAIMER, title: "Disclaimer" },
  "/security": { route: ROUTES.SECURITY, title: "Security", links: ["/legal"] },
  "/create-token": {
    route: ROUTES.CREATE_TOKEN,
    title: "Create token",
    links: ["/token-status"],
  },
  "/token-status": { route: ROUTES.TOKEN_STATUS, title: "Token status" },
  "/settings": { route: ROUTES.SETTINGS, title: "Settings" },
};

/** A page-specific Back for the token status page, when a test sets one. */
let tokenStatusBack: PageBackConfig | undefined;
/** Where the pages run. */
let platform: BackPlatform = "web";

function Page({ path }: { path: string }) {
  const navigate = useNavigate();
  const page = PAGES[path];
  if (!page) throw new Error(`No test page at ${path}`);
  const back =
    path === "/token-status" && tokenStatusBack ? (
      <PageBack {...tokenStatusBack} />
    ) : (
      <RouteBack route={page.route} platform={platform} />
    );
  return (
    <PageShell title={page.title} back={back}>
      {(page.links ?? []).map((link) => (
        <button
          key={link}
          type="button"
          onClick={() => {
            void navigate(link);
          }}
        >
          Open {link}
        </button>
      ))}
    </PageShell>
  );
}

/** The router's role: one page per location, remounted when it changes. */
function AppShell() {
  const { pathname } = useFakeLocation();
  return (
    <>
      <RouteMonitor />
      <Page key={pathname} path={pathname} />
    </>
  );
}

/** Loads the wallet onto browser history as it finds it. */
async function mount(urls: string[], at?: number) {
  fakeHistory.load(urls, at);
  await act(async () => {
    render(<AppShell />);
    await Promise.resolve();
  });
}

const here = () => {
  const { pathname, search } = fakeHistory.current();
  return `${pathname}${search}`;
};

async function open(path: string) {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: `Open ${path}` }));
    await Promise.resolve();
  });
}

async function pressBack() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await Promise.resolve();
  });
}

/** What the phone app's bridge does on NATIVE_BACK. */
function pressAndroidBack() {
  return resolveNativeBack((path, options) => {
    fakeHistory.navigate(path, options);
  }, here());
}

beforeEach(() => {
  resetNativeBackForTests();
  tokenStatusBack = undefined;
  platform = "web";
  jest.spyOn(window, "scrollTo").mockImplementation(() => undefined);
});
afterEach(async () => {
  cleanup();
  jest.restoreAllMocks();
  resetNativeBackForTests();
  await applyLanguage("en");
});

type Scenario = {
  /** Browser history as the wallet finds it, showing the last entry. */
  urls: string[];
  /** In-app links followed after the load. */
  opens: string[];
  /** Where one Back press must land. */
  expected: string;
  /**
   * How Back gets there on the web: a step back through browser history
   * when the previous screen is the entry right behind, else a replace.
   */
  step: "POP" | "REPLACE";
};

const scenarios: Record<string, Scenario> = {
  "in-app history": {
    urls: ["/"],
    opens: ["/legal", "/disclaimer"],
    expected: "/legal",
    step: "POP",
  },
  "a deep link": {
    urls: ["/disclaimer"],
    opens: [],
    expected: "/legal",
    step: "REPLACE",
  },
  // Browser history survives a reload, the in-app trail does not. The
  // entry behind the page is another screen, and Back still takes the
  // parent.
  "a reload": {
    urls: ["/create-token", "/disclaimer"],
    opens: [],
    expected: "/legal",
    step: "REPLACE",
  },
};

describe.each(Object.entries(scenarios))("after %s", (_name, scenario) => {
  async function arrive() {
    await mount(scenario.urls);
    for (const path of scenario.opens) await open(path);
    expect(here()).toBe("/disclaimer");
  }

  it("Back lands on the expected screen, in step with browser history", async () => {
    await arrive();
    const entriesBefore = fakeHistory.length();
    const indexBefore = fakeHistory.index();
    await pressBack();
    expect(here()).toBe(scenario.expected);
    expect(fakeHistory.action()).toBe(scenario.step);
    expect(fakeHistory.length()).toBe(entriesBefore);
    // One entry back onto a screen of this page load, or none at all: the
    // entry behind the first screen can belong to another site.
    expect(fakeHistory.index()).toBe(
      scenario.step === "POP" ? indexBefore - 1 : indexBefore,
    );
  });

  it("Android back lands on the same screen", async () => {
    await arrive();
    expect(pressAndroidBack()).toBe("handled");
    expect(here()).toBe(scenario.expected);
  });
});

it("replaces a deep-linked page with its parent, so it cannot come back", async () => {
  await mount(["/disclaimer"]);
  await pressBack();
  expect(here()).toBe("/legal");
  expect(fakeHistory.action()).toBe("REPLACE");
  await pressBack();
  expect(here()).toBe("/");
  expect(fakeHistory.action()).toBe("REPLACE");
  expect(fakeHistory.length()).toBe(1);
  // Home is a menu destination.
  expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
  expect(recordedRoutesForTests()).toEqual(["/"]);
});

it("walks every visit back once and stops at the menu page", async () => {
  await mount(["/"]);
  for (const path of ["/legal", "/security", "/legal", "/disclaimer"])
    await open(path);
  const landed: string[] = [];
  while (screen.queryByRole("button", { name: "Back" })) {
    await pressBack();
    landed.push(here());
  }
  expect(landed).toEqual(["/legal", "/security", "/legal", "/"]);
  expect(pressAndroidBack()).toBe("at-root");
});

it("keeps the browser's own Back in step on the web", async () => {
  await mount(["/"]);
  await open("/legal");
  await open("/disclaimer");
  await pressBack();
  expect(here()).toBe("/legal");
  expect(fakeHistory.action()).toBe("POP");
  // The browser's Back goes on to Home, and its Forward returns to the
  // page Back left, as the browser's own Back would have it.
  fakeHistory.back();
  expect(here()).toBe("/");
  fakeHistory.forward();
  fakeHistory.forward();
  expect(here()).toBe("/disclaimer");
  expect(recordedRoutesForTests()).toEqual(["/disclaimer"]);
});

it.each([
  ["the desktop app", "desktop", false],
  ["the phone app", "app", false],
  ["the app-shipped document in a browser", "web", true],
] as const)(
  "walks the trail in %s and pushes the previous screen",
  async (_name, where, embedded) => {
    platform = where;
    if (embedded) Reflect.set(window, EMBEDDED_GLOBAL_FLAG, true);
    try {
      await mount(["/"]);
      await open("/legal");
      await open("/disclaimer");
      await pressBack();
      expect(here()).toBe("/legal");
      expect(fakeHistory.action()).toBe("PUSH");
      expect(fakeHistory.length()).toBe(4);
      await pressBack();
      expect(here()).toBe("/");
      expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
    } finally {
      Reflect.deleteProperty(window, EMBEDDED_GLOBAL_FLAG);
    }
  },
);

it("continues from where a browser back landed", async () => {
  await mount(["/"]);
  await open("/legal");
  await open("/disclaimer");
  // The browser's own Back, on the web.
  fakeHistory.back();
  expect(here()).toBe("/legal");
  await pressBack();
  expect(here()).toBe("/");
});

/**
 * Browser moves the trail cannot follow. Each lands on a page whose
 * previous browser entry is not the screen below it on the trail, so both
 * backs must take the page's parent, and never the page ahead.
 */
const unfollowedMoves: Record<
  string,
  { arrive: () => Promise<void>; at: string; parent: string }
> = {
  // Home -> Imprint -> Disclaimer, then a reload on Disclaimer (a phone
  // that discards the tab does the same) and the browser's Back. Browser
  // history survives a reload, the trail does not.
  "a reload and a browser back": {
    arrive: async () => {
      await mount(["/", "/legal", "/disclaimer"]);
      fakeHistory.back();
    },
    at: "/legal",
    parent: "/",
  },
  // Two entries back at once, from the long-press menu of browser Back.
  "a jump of two entries": {
    arrive: async () => {
      await mount(["/"]);
      for (const path of ["/legal", "/security", "/legal", "/disclaimer"])
        await open(path);
      fakeHistory.go(-2);
    },
    at: "/security",
    parent: "/legal",
  },
};

describe.each(Object.entries(unfollowedMoves))("after %s", (_name, move) => {
  it("Back replaces the page with its parent", async () => {
    await move.arrive();
    expect(here()).toBe(move.at);
    await pressBack();
    expect(here()).toBe(move.parent);
    expect(fakeHistory.action()).toBe("REPLACE");
  });

  it("Android back lands on the same parent", async () => {
    await move.arrive();
    expect(here()).toBe(move.at);
    expect(pressAndroidBack()).toBe("handled");
    expect(here()).toBe(move.parent);
  });
});

it("shows no Back on a menu destination", async () => {
  await mount(["/settings"]);
  expect(screen.getByRole("heading", { name: "Settings" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
});

it("places Back above the title, inside the page frame", async () => {
  await mount(["/disclaimer"]);
  const back = screen.getByRole("button", { name: "Back" });
  const heading = screen.getByRole("heading", { level: 1 });
  const header = heading.closest("header");
  expect(header?.contains(back)).toBe(false);
  expect(header?.parentElement?.firstElementChild).toBe(
    back.closest("[data-page-back]"),
  );
  expect(back.getAttribute("type")).toBe("button");
});

it("works from the keyboard", async () => {
  const user = userEvent.setup();
  await mount(["/"]);
  await open("/create-token");
  await user.tab();
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Back" }),
  );
  await user.keyboard("{Enter}");
  expect(here()).toBe("/");

  await open("/legal");
  await open("/disclaimer");
  await user.tab();
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Back" }),
  );
  await user.keyboard(" ");
  expect(here()).toBe("/legal");
});

it("holds both backs while the page holds its Back", async () => {
  tokenStatusBack = { fallback: ROUTES.HOME, disabled: true };
  await mount(["/"]);
  await open("/create-token");
  await open("/token-status");
  const back = screen.getByRole("button", { name: "Back" });
  expect(back).toHaveProperty("disabled", true);
  await pressBack();
  expect(here()).toBe("/token-status");
  expect(pressAndroidBack()).toBe("handled");
  expect(here()).toBe("/token-status");
});

it("lets a page replace the walk back", async () => {
  const onBack = jest.fn();
  tokenStatusBack = { fallback: ROUTES.HOME, onBack };
  await mount(["/token-status"]);
  await pressBack();
  expect(onBack).toHaveBeenCalledTimes(1);
  expect(here()).toBe("/token-status");
});

it.each([
  ["de", "Zurück"],
  ["es", "Volver"],
  ["ru", "Назад"],
  ["zh-CN", "返回"],
  ["en", "Back"],
] as const)("is labelled in %s", async (language, label) => {
  await mount(["/disclaimer"]);
  await act(async () => {
    await applyLanguage(language);
  });
  const back = screen.getByRole("button", { name: label });
  expect(back.textContent).toBe(label);
});
