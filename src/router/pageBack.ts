import { isDesktop } from "@/desktop/bridge";
import { isEmbeddedRuntime } from "@/utils/embeddedRuntime";
import { isRecord } from "@/utils/guards";
import { isInNativeApp } from "@/utils/nativeApp";
import { ROUTES, type RoutePath } from "./routes";

/**
 * Which pages show a Back control, and where it goes when nothing came
 * before.
 *
 * Menu destinations (the pages the sidebar and the mobile navigation link
 * to) show no Back: the menu is their navigation. Every other wallet page is
 * a sub-page, reached from inside another page. Its Back returns to the
 * previous in-app screen, and when there is none (a deep link, a fresh load,
 * a reload) it goes to the parent named here. Parents always lead to a menu
 * destination, so following them never loops.
 */

/** Where the wallet runs: the hosted web page, the desktop app or the phone app. */
export type BackPlatform = "web" | "desktop" | "app";

export interface BackContext {
  /** Detected from the running build when left out. */
  readonly platform?: BackPlatform;
  /** True once the wallet holds an account. */
  readonly hasWallet?: boolean;
}

/** The PageShell `back` setting of a sub-page. */
export interface PageBackConfig {
  /** Where Back goes when no earlier in-app screen was recorded. */
  readonly fallback: string;
  /** Holds Back while an action runs or a step must be finished first. */
  readonly disabled?: boolean;
  /**
   * Replaces the walk back, for a page that keeps its own way back (the NFT
   * detail page returns to its collection view). Android back still walks
   * the recorded trail to the same screen.
   */
  readonly onBack?: () => void;
  /** Where the wallet runs, which decides how Back walks. Detected when left out. */
  readonly platform?: BackPlatform;
}

export interface PageBackOptions extends BackContext {
  readonly disabled?: boolean;
  readonly onBack?: () => void;
  /** A closer parent the page knows, such as an NFT's open collection. */
  readonly fallback?: string;
}

/** The running build's platform. */
export function currentBackPlatform(): BackPlatform {
  if (isDesktop) return "desktop";
  if (isInNativeApp()) return "app";
  return "web";
}

/**
 * True on the web wallet in a browser tab. Its browser router shares
 * history with the browser's own Back, so the on-screen Back steps that
 * history back when the previous screen is the entry right behind. The
 * desktop app, the phone app and the app-shipped document run a hash router
 * and walk the trail.
 */
export function followsBrowserHistory(
  platform: BackPlatform = currentBackPlatform(),
): boolean {
  return platform === "web" && !isEmbeddedRuntime();
}

/**
 * The router's index of the current history entry, or undefined when it is
 * not known. React Router keeps it in `history.state.idx`: 0 for the first
 * entry it makes in a tab, one more for each push, the same for a replace,
 * and a reload keeps it.
 */
export function historyIndex(): number | undefined {
  if (typeof window === "undefined") return undefined;
  const state: unknown = window.history.state;
  if (!isRecord(state)) return undefined;
  const index = state["idx"];
  return typeof index === "number" && Number.isInteger(index)
    ? index
    : undefined;
}

type ParentRule =
  | string
  | null
  | ((context: BackContext) => string | null);

const walletsOrOnboarding = ({ hasWallet = false }: BackContext): string =>
  // Before the first account exists, Home is the onboarding page.
  hasWallet ? ROUTES.ACCOUNT_LIST : ROUTES.HOME;

/** Null marks a menu destination, or a route outside the wallet layout. */
const PARENTS: Readonly<Record<RoutePath, ParentRule>> = {
  [ROUTES.HOME]: null,
  [ROUTES.ACCOUNT_LIST]: null,
  [ROUTES.TRANSFER]: null,
  [ROUTES.ADDRESS_BOOK]: null,
  [ROUTES.SETTINGS]: null,
  // A sidebar item on desktop. The web wallet reaches it after a dApp
  // connects and lists the same sessions in Settings. The phone app's
  // Settings is a native screen, so its way back is Home.
  [ROUTES.DAPP_SESSIONS]: ({ platform = currentBackPlatform() }) =>
    platform === "desktop"
      ? null
      : platform === "app"
        ? ROUTES.HOME
        : ROUTES.SETTINGS,
  [ROUTES.CREATE_ACCOUNT]: walletsOrOnboarding,
  [ROUTES.IMPORT_ACCOUNT]: walletsOrOnboarding,
  [ROUTES.ADD_ACCOUNT]: ROUTES.ACCOUNT_LIST,
  [ROUTES.CREATE_TOKEN]: ROUTES.HOME,
  [ROUTES.TOKEN_STATUS]: ROUTES.HOME,
  [ROUTES.QR_VIEW]: ROUTES.HOME,
  [ROUTES.TRANSACTION_HISTORY]: ROUTES.HOME,
  // The page narrows this to the collection it belongs to.
  [ROUTES.NFT_DETAIL]: ROUTES.HOME,
  // Footer links on every page, outside the menu.
  [ROUTES.TERMS]: ROUTES.HOME,
  [ROUTES.PRIVACY]: ROUTES.HOME,
  [ROUTES.LEGAL]: ROUTES.HOME,
  // Reached from the other legal pages; the imprint links all of them.
  [ROUTES.DISCLAIMER]: ROUTES.LEGAL,
  [ROUTES.SECURITY]: ROUTES.LEGAL,
  // Outside the wallet layout: the Telegram page has its own shell, and an
  // unknown path redirects Home.
  [ROUTES.TELEGRAM]: null,
  [ROUTES.DEFAULT]: null,
};

/** The parent a page's Back falls back to, or null when it shows no Back. */
export function backParent(
  route: RoutePath,
  context: BackContext = {},
): string | null {
  const rule = PARENTS[route];
  return typeof rule === "function" ? rule(context) : rule;
}

/** PageShell's `back` for a route, or undefined for a page with no Back. */
export function pageBack(
  route: RoutePath,
  options: PageBackOptions = {},
): PageBackConfig | undefined {
  const parent = backParent(route, options);
  if (parent === null) return undefined;
  return {
    fallback: options.fallback ?? parent,
    disabled: options.disabled === true,
    onBack: options.onBack,
    platform: options.platform,
  };
}
