/** @jest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import MobileNav from "../MobileNav";
import { AppSidebar } from "../app-sidebar";
import { backParent, type BackPlatform } from "@/router/pageBack";
import { ROUTES, type RoutePath } from "@/router/routes";

/**
 * Menu destinations show no Back: the menu is their navigation. This opens
 * every item of the real sidebar and mobile navigation and checks the Back
 * table agrees, so a new menu item cannot quietly gain a Back.
 */

const mockNavigate = jest.fn((_path: string): void => undefined);
let mockDesktop = false;
jest.mock("react-router", () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => ({ pathname: "/" }),
}));
jest.mock("@/router/router", () => ({
  ROUTES: jest.requireActual<typeof import("@/router/routes")>(
    "@/router/routes",
  ).ROUTES,
}));
jest.mock("@/utils/logout", () => ({ handleLogout: jest.fn() }));
jest.mock("@/desktop/bridge", () => ({
  get isDesktop() {
    return mockDesktop;
  },
  desktopSigner: { lock: jest.fn() },
}));
jest.mock("@/utils/nativeApp", () => ({ isInNativeApp: () => false }));
jest.mock("@/stores/store", () => ({
  useStore: () => ({ dappConnectStore: { sessionCount: 0 } }),
}));
jest.mock("mobx-react-lite", () => ({
  observer: (component: unknown) => component,
}));
jest.mock("../../Header/MyQRLWalletLogo/MyQRLWalletLogo", () => ({
  __esModule: true,
  default: () => <span>Home</span>,
}));
jest.mock("@/components/UI/sidebar", () => {
  const Container = ({
    children,
    onClick,
  }: {
    children: ReactNode;
    onClick?: () => void;
  }) => <div onClick={onClick}>{children}</div>;
  const Button = ({
    children,
    onClick,
  }: {
    children: ReactNode;
    onClick?: () => void;
  }) => <button onClick={onClick}>{children}</button>;
  return {
    Sidebar: Container,
    SidebarContent: Container,
    SidebarFooter: Container,
    SidebarGroup: Container,
    SidebarGroupContent: Container,
    SidebarMenu: Container,
    SidebarMenuItem: Container,
    SidebarMenuButton: Button,
  };
});

beforeEach(() => {
  mockNavigate.mockClear();
  mockDesktop = false;
});
afterEach(cleanup);

const routePaths = new Set<string>(Object.values(ROUTES));
const isRoute = (path: string): path is RoutePath => routePaths.has(path);

/** Opens every menu item and returns where each one went. */
function menuTargets(menu: ReactNode): string[] {
  render(<>{menu}</>);
  for (const button of screen.getAllByRole("button")) {
    // Logout and Lock end the session; they are not destinations.
    if (/^(Logout|Lock)$/.test(button.textContent.trim())) continue;
    fireEvent.click(button);
  }
  const logo = screen.queryByText("Home");
  if (logo) fireEvent.click(logo);
  return [...new Set(mockNavigate.mock.calls.map(([path]) => path))];
}

it.each<[string, () => ReactNode, BackPlatform, readonly string[]]>([
  [
    "mobile navigation",
    () => <MobileNav />,
    "web",
    [ROUTES.TRANSFER, ROUTES.ACCOUNT_LIST, ROUTES.ADDRESS_BOOK, ROUTES.SETTINGS],
  ],
  [
    "web sidebar",
    () => <AppSidebar />,
    "web",
    [
      ROUTES.HOME,
      ROUTES.ACCOUNT_LIST,
      ROUTES.TRANSFER,
      ROUTES.ADDRESS_BOOK,
      ROUTES.SETTINGS,
    ],
  ],
  [
    "desktop sidebar",
    () => <AppSidebar />,
    "desktop",
    [
      ROUTES.HOME,
      ROUTES.ACCOUNT_LIST,
      ROUTES.TRANSFER,
      ROUTES.ADDRESS_BOOK,
      ROUTES.SETTINGS,
      ROUTES.DAPP_SESSIONS,
    ],
  ],
])("the %s links only to pages with no Back", (_name, menu, platform, expected) => {
  mockDesktop = platform === "desktop";
  const targets = menuTargets(menu());
  expect([...targets].sort()).toEqual([...expected].sort());
  for (const target of targets) {
    if (!isRoute(target)) throw new Error(`${target} is not a route`);
    for (const hasWallet of [false, true])
      expect([target, backParent(target, { platform, hasWallet })]).toEqual([
        target,
        null,
      ]);
  }
});
