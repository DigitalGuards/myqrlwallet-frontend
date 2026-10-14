/** @jest-environment jsdom */

import { cleanup, fireEvent, render } from "@testing-library/react";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  Sidebar,
  SidebarMenuSkeleton,
  SidebarProvider,
  SidebarTrigger,
} from "../sidebar";

jest.mock("@/utils", () =>
  jest.requireActual<typeof import("@/utils/cn")>("@/utils/cn"),
);
jest.mock("@/hooks/use-mobile", () => ({
  useIsMobile: jest.fn(() => false),
}));

beforeEach(() => {
  jest.mocked(useIsMobile).mockReturnValue(false);
  document.cookie = "sidebar_state=; path=/; max-age=0";
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

it("toggles the desktop state and cookie through the trigger and shortcut", () => {
  const view = render(
    <SidebarProvider data-testid="provider" style={{ color: "red" }}>
      <SidebarTrigger />
      <Sidebar>Navigation</Sidebar>
    </SidebarProvider>,
  );
  const provider = view.getByTestId("provider");
  expect(provider.style.getPropertyValue("--sidebar-width")).toBe("5rem");
  expect(provider.style.getPropertyValue("--sidebar-width-icon")).toBe("10rem");
  expect(provider.style.color).toBe("red");
  fireEvent.click(view.getByRole("button", { name: "Toggle Sidebar" }));
  expect(view.container.querySelector('[data-state="collapsed"]')).toBeTruthy();
  expect(document.cookie).toBe("sidebar_state=false");

  fireEvent.keyDown(window, { key: "b", ctrlKey: true });
  expect(view.container.querySelector('[data-state="expanded"]')).toBeTruthy();
  expect(document.cookie).toBe("sidebar_state=true");
  view.unmount();
  fireEvent.keyDown(window, { key: "b", ctrlKey: true });
  expect(document.cookie).toBe("sidebar_state=true");
});

it("calls the controlled handler before writing the desktop cookie", () => {
  const onOpenChange = jest.fn((_open: boolean) => {
    expect(document.cookie).toBe("");
  });
  const view = render(
    <SidebarProvider open onOpenChange={onOpenChange}>
      <SidebarTrigger />
      <Sidebar>Navigation</Sidebar>
    </SidebarProvider>,
  );
  fireEvent.click(view.getByRole("button", { name: "Toggle Sidebar" }));
  expect(onOpenChange).toHaveBeenCalledWith(false);
  expect(document.cookie).toBe("sidebar_state=false");
  expect(view.container.querySelector('[data-state="expanded"]')).toBeTruthy();
});

it("toggles the mobile sheet while retaining the desktop cookie and callback", () => {
  jest.mocked(useIsMobile).mockReturnValue(true);
  document.cookie = "sidebar_state=true; path=/";
  const onOpenChange = jest.fn();
  const view = render(
    <SidebarProvider onOpenChange={onOpenChange}>
      <SidebarTrigger />
      <Sidebar>Navigation</Sidebar>
    </SidebarProvider>,
  );
  fireEvent.click(view.getByRole("button", { name: "Toggle Sidebar" }));
  expect(
    view
      .getByRole("dialog", { name: "Sidebar" })
      .style.getPropertyValue("--sidebar-width"),
  ).toBe("10rem");
  fireEvent.keyDown(window, { key: "b", metaKey: true });
  expect(view.queryByRole("dialog", { name: "Sidebar" })).toBeNull();
  expect(document.cookie).toBe("sidebar_state=true");
  expect(onOpenChange).not.toHaveBeenCalled();
});

it("keeps the skeleton width stable across renders", () => {
  const random = jest.spyOn(Math, "random").mockReturnValue(0.5);
  const view = render(<SidebarMenuSkeleton />);
  const skeleton = view.container.querySelector<HTMLElement>(
    '[data-sidebar="menu-skeleton-text"]',
  );
  expect(skeleton?.style.getPropertyValue("--skeleton-width")).toBe("70%");
  random.mockReturnValue(0.9);
  view.rerender(<SidebarMenuSkeleton />);
  expect(skeleton?.style.getPropertyValue("--skeleton-width")).toBe("70%");
  expect(random).toHaveBeenCalledTimes(1);
});
