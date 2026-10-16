/** @jest-environment jsdom */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import type { ReactNode } from "react";
import MobileNav from "../MobileNav";
import { AppSidebar } from "../app-sidebar";
import { handleLogout } from "@/utils/logout";
import { desktopSigner } from "@/desktop/bridge";
import { deferred } from "@/test-utils/deferred";
import { logger } from "@/utils/log";

const mockNavigate = jest.fn(
  (_path: string): void | Promise<void> => undefined,
);
let mockDesktop = false;
jest.mock("react-router", () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => ({ pathname: "/" }),
}));
jest.mock("@/utils/logout", () => ({ handleLogout: jest.fn() }));
jest.mock("@/desktop/bridge", () => ({
  get isDesktop() {
    return mockDesktop;
  },
  desktopSigner: { lock: jest.fn() },
}));
jest.mock("@/utils/nativeApp", () => ({ isInNativeApp: () => false }));
jest.mock("@/router/router", () => ({
  ROUTES: {
    HOME: "/",
    TRANSFER: "/transfer",
    ACCOUNT_LIST: "/accounts",
    ADDRESS_BOOK: "/address-book",
    SETTINGS: "/settings",
    DAPP_SESSIONS: "/dapp-sessions",
  },
}));
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
  jest.resetAllMocks();
  mockDesktop = false;
});
afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

it.each([MobileNav, AppSidebar])(
  "keeps logout and its navigation fire-and-forget (%#)",
  async (Component) => {
    const navigation = deferred<undefined>();
    const logout = deferred<undefined>();
    const failure = new Error("Navigation unavailable");
    const report = jest
      .spyOn(logger, "error")
      .mockImplementation(() => undefined);
    const order: string[] = [];
    mockNavigate.mockImplementationOnce(() => {
      order.push("navigate");
      return navigation.promise;
    });
    jest.mocked(handleLogout).mockImplementationOnce((navigate) => {
      order.push("logout");
      navigate("/");
      order.push("after navigation");
      return logout.promise;
    });
    render(<Component />);
    fireEvent.click(screen.getByRole("button", { name: "Logout" }));
    expect(order).toEqual(["logout", "navigate", "after navigation"]);
    expect(mockNavigate).toHaveBeenCalledWith("/");
    await act(async () => {
      navigation.reject(failure);
      logout.resolve(undefined);
      await logout.promise;
    });
    expect(report).toHaveBeenCalledWith(
      "Failed to navigate after logout:",
      failure,
    );
    expect(handleLogout).toHaveBeenCalledTimes(1);
  },
);

it.each([MobileNav, AppSidebar])(
  "reports logout rejection (%#)",
  async (Component) => {
    const failure = new Error("Logout failed");
    const report = jest
      .spyOn(logger, "error")
      .mockImplementation(() => undefined);
    jest.mocked(handleLogout).mockRejectedValueOnce(failure);
    render(<Component />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Logout" }));
      await Promise.resolve();
    });
    expect(report).toHaveBeenCalledWith("Error during logout:", failure);
    expect(mockNavigate).not.toHaveBeenCalled();
  },
);

it("reports desktop lock rejection without logging out", async () => {
  mockDesktop = true;
  const failure = new Error("Signer unavailable");
  const report = jest
    .spyOn(logger, "error")
    .mockImplementation(() => undefined);
  jest.mocked(desktopSigner).lock.mockRejectedValueOnce(failure);
  render(<AppSidebar />);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Lock" }));
    await Promise.resolve();
  });
  expect(report).toHaveBeenCalledWith(
    "Failed to lock desktop wallet:",
    failure,
  );
  expect(handleLogout).not.toHaveBeenCalled();
});

it("starts home navigation on click and reports rejection", async () => {
  const failure = new Error("Navigation unavailable");
  const report = jest
    .spyOn(logger, "error")
    .mockImplementation(() => undefined);
  mockNavigate.mockRejectedValueOnce(failure);
  render(<AppSidebar />);
  await act(async () => {
    fireEvent.click(screen.getByText("Home"));
    expect(mockNavigate).toHaveBeenCalledWith("/");
    await Promise.resolve();
  });
  expect(report).toHaveBeenCalledWith("Failed to open home:", failure);
});
