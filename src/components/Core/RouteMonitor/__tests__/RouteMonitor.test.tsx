/** @jest-environment jsdom */
import { cleanup, render, waitFor } from "@testing-library/react";
import RouteMonitor from "../RouteMonitor";

const mockNavigate = jest.fn();
let mockConnected = false;
let mockPathname = "/transfer";
let mockSavedPage = "/";
let mockDesktop = false;
jest.mock("@/stores/store", () => ({
  useStore: () => ({
    qrlStore: { qrlConnection: { isConnected: mockConnected } },
  }),
}));
jest.mock("@/utils/storage", () => ({
  StorageUtil: {
    getActivePage: async () => mockSavedPage,
    setActivePage: async (path: string) => {
      mockSavedPage = path;
    },
  },
}));
jest.mock("@/desktop/bridge", () => ({
  get isDesktop() {
    return mockDesktop;
  },
}));
jest.mock("@/router/router", () => ({
  ROUTES: { HOME: "/", SETTINGS: "/settings" },
}));
jest.mock("mobx-react-lite", () => ({
  observer: (component: unknown) => component,
}));
jest.mock("react-router", () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => ({ pathname: mockPathname }),
}));

beforeEach(() => {
  mockNavigate.mockReset();
  mockConnected = false;
  mockPathname = "/transfer";
  mockSavedPage = "/";
  mockDesktop = false;
  jest.spyOn(window, "scrollTo").mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

it("preserves a direct route while network identity is loading", async () => {
  const view = render(<RouteMonitor />);
  await Promise.resolve();
  expect(mockNavigate).not.toHaveBeenCalled();
  expect(mockSavedPage).toBe("/transfer");
  mockConnected = true;
  view.rerender(<RouteMonitor />);
  await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/transfer"));
});

it("keeps the current route during a transient disconnect", async () => {
  mockConnected = true;
  mockSavedPage = "/transfer";
  const view = render(<RouteMonitor />);
  await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/transfer"));
  mockNavigate.mockClear();
  mockConnected = false;
  view.rerender(<RouteMonitor />);
  await Promise.resolve();
  expect(mockNavigate).not.toHaveBeenCalled();
});

it("retains the desktop settings recovery rule", async () => {
  mockDesktop = true;
  mockConnected = true;
  mockSavedPage = "/settings";
  render(<RouteMonitor />);
  await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/"));
});
