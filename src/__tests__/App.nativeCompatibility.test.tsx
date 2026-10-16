/** @jest-environment jsdom */
import type React from "react";
import { act, render, screen } from "@testing-library/react";
import App from "../App";
import { isUnsupportedV3Context } from "../config/runtimeProfile";

const mockInitializeBlockchain = jest
  .fn<Promise<void>, []>()
  .mockResolvedValue(undefined);

jest.mock("../config/runtimeProfile", () => ({
  isUnsupportedV3Context: jest.fn(),
  V3_UNSUPPORTED_SIGNER_MESSAGE: "Update the native app",
}));
jest.mock("../stores/store", () => ({
  store: {
    qrlStore: { initializeBlockchain: () => mockInitializeBlockchain() },
  },
  StoreProvider: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock("../router/router", () => ({
  AppRouter: () => <div>Qualified wallet</div>,
}));

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  jest.mocked(isUnsupportedV3Context).mockReturnValue(true);
  window.ReactNativeWebView = { postMessage: jest.fn() };
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  delete window.ReactNativeWebView;
});

it("also waits for delayed creation of the native bridge", () => {
  delete window.ReactNativeWebView;
  jest
    .spyOn(navigator, "userAgent", "get")
    .mockReturnValue("MyQRLWallet/1.3.0");
  render(<App />);
  act(() => {
    jest.advanceTimersByTime(200);
  });
  expect(screen.queryByText("Qualified wallet")).toBeNull();
  window.ReactNativeWebView = { postMessage: jest.fn() };
  jest.mocked(isUnsupportedV3Context).mockReturnValue(false);
  act(() => {
    jest.advanceTimersByTime(100);
  });
  expect(screen.getByText("Qualified wallet")).toBeTruthy();
  expect(mockInitializeBlockchain).toHaveBeenCalledTimes(1);
});

it("retries delayed injection while keeping the wallet gated", () => {
  render(<App />);
  expect(screen.queryByText("Qualified wallet")).toBeNull();
  act(() => {
    jest.advanceTimersByTime(200);
  });
  expect(mockInitializeBlockchain).not.toHaveBeenCalled();
  jest.mocked(isUnsupportedV3Context).mockReturnValue(false);
  act(() => {
    jest.advanceTimersByTime(100);
  });
  expect(screen.getByText("Qualified wallet")).toBeTruthy();
  expect(mockInitializeBlockchain).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});

it("ends retries for an old build and cancels timers on unmount", () => {
  const view = render(<App />);
  act(() => {
    jest.advanceTimersByTime(10000);
  });
  expect(screen.queryByText("Qualified wallet")).toBeNull();
  expect(mockInitializeBlockchain).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
  view.unmount();
  const second = render(<App />);
  expect(jest.getTimerCount()).toBe(1);
  second.unmount();
  expect(jest.getTimerCount()).toBe(0);
});
