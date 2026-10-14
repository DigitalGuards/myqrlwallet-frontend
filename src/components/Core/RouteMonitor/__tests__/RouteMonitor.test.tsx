/** @jest-environment jsdom */
import { act, cleanup, render, waitFor } from "@testing-library/react";
import RouteMonitor from "../RouteMonitor";
import { deferred } from "@/test-utils/deferred";
import { logger } from "@/utils/log";
import { recordRoute } from "@/utils/nativeBack";

const mockNavigate = jest.fn(
  (_path: string): void | Promise<void> => undefined,
);
const mockGetActivePage = jest.fn(() => Promise.resolve(mockSavedPage));
const mockSetActivePage = jest.fn((path: string) => {
  mockSavedPage = path;
  return Promise.resolve();
});
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
    getActivePage: () => mockGetActivePage(),
    setActivePage: (path: string) => mockSetActivePage(path),
  },
}));
jest.mock("@/utils/nativeBack", () => ({ recordRoute: jest.fn() }));
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
  mockGetActivePage.mockClear();
  mockSetActivePage.mockClear();
  jest.mocked(recordRoute).mockClear();
  mockConnected = false;
  mockPathname = "/transfer";
  mockSavedPage = "/";
  mockDesktop = false;
  jest.spyOn(window, "scrollTo").mockImplementation(() => undefined);
});

it("starts route persistence and records back history while restoration is pending", async () => {
  const savedPage = deferred<string>();
  const savedWrite = deferred<undefined>();
  mockConnected = true;
  mockGetActivePage.mockReturnValueOnce(savedPage.promise);
  mockSetActivePage.mockReturnValueOnce(savedWrite.promise);
  const view = render(<RouteMonitor />);
  expect(mockGetActivePage).toHaveBeenCalledTimes(1);
  expect(mockSetActivePage).toHaveBeenCalledWith("/transfer");
  expect(recordRoute).toHaveBeenCalledWith("/transfer");
  expect(mockNavigate).not.toHaveBeenCalled();

  // The effect retains the connection value captured when its read began.
  mockConnected = false;
  view.rerender(<RouteMonitor />);
  await act(async () => {
    savedPage.resolve("/accounts");
    await savedPage.promise;
  });
  expect(mockNavigate).toHaveBeenCalledWith("/accounts");
  savedWrite.resolve(undefined);
});

it("reports restoration failures without starting another read or navigation", async () => {
  const failure = new Error("Route storage unavailable");
  const report = jest
    .spyOn(logger, "error")
    .mockImplementation(() => undefined);
  mockConnected = true;
  mockGetActivePage.mockRejectedValueOnce(failure);
  render(<RouteMonitor />);
  await waitFor(() => {
    expect(report).toHaveBeenCalledWith(
      "Failed to restore active page:",
      failure,
    );
  });
  expect(mockGetActivePage).toHaveBeenCalledTimes(1);
  expect(mockNavigate).not.toHaveBeenCalled();
  expect(recordRoute).toHaveBeenCalledWith("/transfer");
});

it("reports a failed write while recording back history immediately", async () => {
  const failure = new Error("Route write failed");
  const write = deferred<undefined>();
  const report = jest
    .spyOn(logger, "error")
    .mockImplementation(() => undefined);
  mockSetActivePage.mockReturnValueOnce(write.promise);
  render(<RouteMonitor />);
  expect(recordRoute).toHaveBeenCalledWith("/transfer");
  await act(async () => {
    write.reject(failure);
    await write.promise.catch(() => undefined);
  });
  expect(report).toHaveBeenCalledWith("Failed to save active page:", failure);
});

it.each(["/accounts", ""])(
  "reports rejected navigation from stored route %s",
  async (page) => {
    const failure = new Error("Navigation failed");
    const report = jest
      .spyOn(logger, "error")
      .mockImplementation(() => undefined);
    mockConnected = true;
    mockSavedPage = page;
    mockNavigate.mockRejectedValueOnce(failure);
    render(<RouteMonitor />);
    await waitFor(() => {
      expect(report).toHaveBeenCalledWith(
        "Failed to restore active page:",
        failure,
      );
    });
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith(page || "/");
  },
);
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
  await waitFor(() => {
    expect(mockNavigate).toHaveBeenCalledWith("/transfer");
  });
});

it("keeps the current route during a transient disconnect", async () => {
  mockConnected = true;
  mockSavedPage = "/transfer";
  const view = render(<RouteMonitor />);
  await waitFor(() => {
    expect(mockNavigate).toHaveBeenCalledWith("/transfer");
  });
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
  await waitFor(() => {
    expect(mockNavigate).toHaveBeenCalledWith("/");
  });
});
