/** @jest-environment jsdom */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import TelegramControlCenter from "../TelegramControlCenter";
import { deferred } from "@/test-utils/deferred";
import { logger } from "@/utils/log";

const mockNavigate = jest.fn(
  (_path: string): void | Promise<void> => undefined,
);
const mockFetch = jest.fn(() => Promise.resolve({ ok: true }));
jest.mock("react-router", () => ({ useNavigate: () => mockNavigate }));
jest.mock("../config", () => ({ serverUrl: "https://wallet.example/api/" }));

const originalFetch = Object.getOwnPropertyDescriptor(globalThis, "fetch");
beforeEach(() => {
  mockNavigate.mockReset();
  mockFetch.mockReset().mockResolvedValue({ ok: true });
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: mockFetch,
  });
});
afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  Reflect.deleteProperty(window, "Telegram");
  if (originalFetch) Object.defineProperty(globalThis, "fetch", originalFetch);
  else Reflect.deleteProperty(globalThis, "fetch");
});

it("calls the valid bridge with its receiver before starting the status request", async () => {
  const order: string[] = [];
  const receivers: unknown[] = [];
  const webApp = {
    ready(this: unknown) {
      order.push("ready");
      receivers.push(this);
    },
    expand(this: unknown) {
      order.push("expand");
      receivers.push(this);
    },
    openLink: jest.fn(function (this: unknown, _url: string) {
      receivers.push(this);
    }),
  };
  Object.defineProperty(window, "Telegram", {
    configurable: true,
    value: { WebApp: webApp },
  });
  mockFetch.mockImplementationOnce(() => {
    order.push("fetch");
    return Promise.resolve({ ok: true });
  });
  render(<TelegramControlCenter />);
  expect(order).toEqual(["ready", "expand", "fetch"]);
  expect(screen.getByText("Checking network")).toBeTruthy();
  await screen.findByText("Operational");
  fireEvent.click(screen.getByRole("button", { name: /Activity/ }));
  expect(webApp.openLink).toHaveBeenCalledWith(
    new URL("/tx-history", window.location.origin).toString(),
  );
  expect(receivers).toEqual([webApp, webApp, webApp]);
  expect(mockNavigate).not.toHaveBeenCalled();
});

const invalidBridges: unknown[] = [
  undefined,
  null,
  [],
  "invalid",
  { WebApp: null },
  { WebApp: [] },
  {
    WebApp: { ready: true, expand: () => undefined, openLink: () => undefined },
  },
  { WebApp: { ready: () => undefined, expand: 1, openLink: () => undefined } },
  {
    WebApp: {
      ready: () => undefined,
      expand: () => undefined,
      openLink: "invalid",
    },
  },
];

it.each(invalidBridges)(
  "ignores an invalid bridge and keeps local navigation available (%j)",
  async (telegram: unknown) => {
    Object.defineProperty(window, "Telegram", {
      configurable: true,
      value: telegram,
    });
    render(<TelegramControlCenter />);
    fireEvent.click(screen.getByRole("button", { name: /Open wallet/ }));
    expect(mockNavigate).toHaveBeenCalledWith("/");
    await screen.findByText("Operational");
  },
);

it.each([false, true])(
  "reports degraded health after status failure (rejected: %s)",
  async (rejected) => {
    if (rejected) mockFetch.mockRejectedValueOnce(new Error("Unavailable"));
    else mockFetch.mockResolvedValueOnce({ ok: false });
    render(<TelegramControlCenter />);
    await screen.findByText("Degraded");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  },
);

it("starts navigation immediately and reports its rejection without another attempt", async () => {
  const navigation = deferred<undefined>();
  const failure = new Error("Navigation failed");
  const report = jest
    .spyOn(logger, "error")
    .mockImplementation(() => undefined);
  mockNavigate.mockReturnValueOnce(navigation.promise);
  render(<TelegramControlCenter />);
  await screen.findByText("Operational");
  fireEvent.click(screen.getByRole("button", { name: /Alerts and settings/ }));
  expect(mockNavigate).toHaveBeenCalledWith("/settings");
  expect(report).not.toHaveBeenCalled();
  await act(async () => {
    navigation.reject(failure);
    await navigation.promise.catch(() => undefined);
  });
  expect(report).toHaveBeenCalledWith("Failed to open wallet page:", failure);
  expect(mockNavigate).toHaveBeenCalledTimes(1);
});
