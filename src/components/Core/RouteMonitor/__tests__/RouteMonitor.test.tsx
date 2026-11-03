/** @jest-environment jsdom */
import { act, cleanup, render, waitFor } from "@testing-library/react";
import RouteMonitor from "../RouteMonitor";
import { deferred } from "@/test-utils/deferred";
import { logger } from "@/utils/log";
import { recordRoute } from "@/utils/nativeBack";

const mockNavigate = jest.fn(
  (_path: string, _options?: { replace: true }): void | Promise<void> =>
    undefined,
);
const mockGetActivePage = jest.fn(() => Promise.resolve(mockSavedPage));
const mockSetActivePage = jest.fn((path: string) => {
  mockSavedPage = path;
  return Promise.resolve();
});
let mockConnected = false;
let mockPathname = "/transfer";
let mockSearch = "";
let mockNavigationType = "POP";
let mockSavedPage: unknown = "/";
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
  useLocation: () => ({ pathname: mockPathname, search: mockSearch }),
  useNavigationType: () => mockNavigationType,
}));
const restore = { replace: true };

beforeEach(() => {
  mockNavigate.mockReset();
  mockGetActivePage.mockClear();
  mockSetActivePage.mockClear();
  jest.mocked(recordRoute).mockClear();
  mockConnected = false;
  mockPathname = "/transfer";
  mockSearch = "";
  mockNavigationType = "POP";
  mockSavedPage = "/";
  mockDesktop = false;
  jest.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  // The browser router's record of the entry shown: its index is 4.
  window.history.replaceState({ usr: null, key: "k4", idx: 4 }, "");
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
  expect(recordRoute).toHaveBeenCalledWith("/transfer", "POP", 4);
  expect(mockNavigate).not.toHaveBeenCalled();

  // The effect retains the connection value captured when its read began.
  mockConnected = false;
  view.rerender(<RouteMonitor />);
  await act(async () => {
    savedPage.resolve("/accounts");
    await savedPage.promise;
  });
  // Another page than the one shown: a push, so /transfer stays one Back
  // away.
  expect(mockNavigate.mock.calls).toEqual([["/accounts"]]);
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
  expect(recordRoute).toHaveBeenCalledWith("/transfer", "POP", 4);
});

it("reports a failed write while recording back history immediately", async () => {
  const failure = new Error("Route write failed");
  const write = deferred<undefined>();
  const report = jest
    .spyOn(logger, "error")
    .mockImplementation(() => undefined);
  mockSetActivePage.mockReturnValueOnce(write.promise);
  render(<RouteMonitor />);
  expect(recordRoute).toHaveBeenCalledWith("/transfer", "POP", 4);
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
    expect(mockNavigate).toHaveBeenCalledWith("/transfer", restore);
  });
});

it("keeps the current route during a transient disconnect", async () => {
  mockConnected = true;
  mockSavedPage = "/transfer";
  const view = render(<RouteMonitor />);
  await waitFor(() => {
    expect(mockNavigate).toHaveBeenCalledWith("/transfer", restore);
  });
  mockNavigate.mockClear();
  mockConnected = false;
  view.rerender(<RouteMonitor />);
  await Promise.resolve();
  expect(mockNavigate).not.toHaveBeenCalled();
});

it.each([false, true])(
  "restores settings with desktop: %s",
  async (desktop) => {
    mockDesktop = desktop;
    mockConnected = true;
    mockSavedPage = "/settings";
    render(<RouteMonitor />);
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("/settings");
    });
  },
);

it.each([-1, { pathname: "/tokens", search: "?view=all" }])(
  "passes a stored navigation target through without conversion: %j",
  async (page) => {
    mockConnected = true;
    mockSavedPage = page;
    render(<RouteMonitor />);
    await waitFor(() => {
      expect(mockNavigate.mock.calls).toEqual([[page]]);
    });
  },
);

it("records each screen with its query and how the router reached it", () => {
  mockPathname = "/";
  mockSearch = "?collection=abc";
  mockNavigationType = "PUSH";
  const view = render(<RouteMonitor />);
  expect(recordRoute).toHaveBeenLastCalledWith("/?collection=abc", "PUSH", 4);

  // Closing the collection changes only the query: still a new screen.
  mockSearch = "";
  mockNavigationType = "POP";
  view.rerender(<RouteMonitor />);
  expect(recordRoute).toHaveBeenLastCalledWith("/", "POP", 4);
  expect(recordRoute).toHaveBeenCalledTimes(2);
  // The saved page stays the pathname alone.
  expect(mockSetActivePage).toHaveBeenLastCalledWith("/");
});

it("records the history index on the web wallet only", () => {
  // The desktop app runs a hash router and walks the trail by path.
  mockDesktop = true;
  render(<RouteMonitor />);
  expect(recordRoute).toHaveBeenCalledWith("/transfer", "POP", undefined);
});

it("records no index when the browser keeps none for the entry", () => {
  // A link that changes only the fragment makes an entry with no state.
  window.history.replaceState(null, "");
  render(<RouteMonitor />);
  expect(recordRoute).toHaveBeenCalledWith("/transfer", "POP", undefined);
});

it("opens a new page at its top, and keeps the position on a query change", () => {
  // The app's scroll container, as index.html and src/index.css make it.
  const root = document.createElement("div");
  root.id = "root";
  document.body.append(root);
  try {
    root.scrollTop = 400;
    const view = render(<RouteMonitor />);
    expect(root.scrollTop).toBe(0);
    expect(window.scrollTo).toHaveBeenCalledWith(0, 0);

    // A collection opened on the same page changes only the query.
    root.scrollTop = 400;
    mockSearch = "?collection=abc";
    view.rerender(<RouteMonitor />);
    expect(root.scrollTop).toBe(400);

    mockPathname = "/terms";
    view.rerender(<RouteMonitor />);
    expect(root.scrollTop).toBe(0);
  } finally {
    root.remove();
  }
});

describe("the restore on connect", () => {
  it("pushes a stored page other than the one opened, which stays one Back away", async () => {
    // A dApp's link opened /dapp-sessions; the last session ended on Settings.
    mockConnected = true;
    mockPathname = "/dapp-sessions";
    mockSavedPage = "/settings";
    render(<RouteMonitor />);
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalled();
    });
    expect(mockNavigate.mock.calls).toEqual([["/settings"]]);
  });

  it.each([
    ["the stored page", "/transfer", "/transfer"],
    ["Home with nothing stored", "/", ""],
  ])("replaces the entry when %s is the page shown", async (_name, shown, saved) => {
    mockConnected = true;
    mockPathname = shown;
    mockSavedPage = saved;
    render(<RouteMonitor />);
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalled();
    });
    expect(mockNavigate.mock.calls).toEqual([[shown, restore]]);
  });

  it("compares with the page shown when the stored page arrives", async () => {
    const savedPage = deferred<string>();
    mockConnected = true;
    mockGetActivePage.mockReturnValueOnce(savedPage.promise);
    const view = render(<RouteMonitor />);
    mockPathname = "/terms";
    view.rerender(<RouteMonitor />);
    await act(async () => {
      savedPage.resolve("/terms");
      await savedPage.promise;
    });
    expect(mockNavigate.mock.calls).toEqual([["/terms", restore]]);
    // The restore ran once, for the connection, and not for the move.
    expect(mockGetActivePage).toHaveBeenCalledTimes(1);
  });
});
