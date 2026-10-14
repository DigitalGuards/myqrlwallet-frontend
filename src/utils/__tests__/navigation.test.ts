import { afterEach, beforeEach, expect, it, jest } from "@jest/globals";
import type { To } from "react-router";

let mockNative = false;
let mockDesktop = false;
const mockOpenNativeSettings = jest.fn<() => void>();
const mockOpenDesktopSettings = jest.fn<() => Promise<void>>();

jest.mock("@/router/router", () => ({ ROUTES: { SETTINGS: "/settings" } }));
jest.mock("@/utils/nativeApp", () => ({
  isInNativeApp: () => mockNative,
  openNativeSettings: () => {
    mockOpenNativeSettings();
  },
}));
jest.mock("@/desktop/bridge", () => ({
  get isDesktop() {
    return mockDesktop;
  },
  desktopSigner: { openDesktopSettings: () => mockOpenDesktopSettings() },
}));

import { navigateTo } from "../navigation";

const navigate = jest.fn<(target: To | number) => void | Promise<void>>();

beforeEach(() => {
  jest.clearAllMocks();
  mockNative = false;
  mockDesktop = false;
  navigate.mockReturnValue(undefined);
  mockOpenDesktopSettings.mockResolvedValue(undefined);
});
afterEach(() => {
  jest.restoreAllMocks();
});

it("keeps mobile settings ahead of desktop and web routing", () => {
  mockNative = true;
  mockDesktop = true;
  navigateTo("/settings", navigate);
  expect(mockOpenNativeSettings).toHaveBeenCalledTimes(1);
  expect(mockOpenDesktopSettings).not.toHaveBeenCalled();
  expect(navigate).not.toHaveBeenCalled();
});

it("routes desktop settings through the signer", async () => {
  mockDesktop = true;
  navigateTo("/settings", navigate);
  await Promise.resolve();
  expect(mockOpenDesktopSettings).toHaveBeenCalledTimes(1);
  expect(navigate).not.toHaveBeenCalled();
});

it("keeps synchronous and asynchronous router calls intact", async () => {
  navigateTo("/settings", navigate);
  navigate.mockReturnValueOnce(Promise.resolve());
  navigateTo("/transfer", navigate);
  await Promise.resolve();
  expect(navigate.mock.calls).toEqual([["/settings"], ["/transfer"]]);
});

it.each(["desktop", "router"])(
  "reports a rejected %s navigation",
  async (kind) => {
    const failure = new Error("navigation rejected");
    const logged = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    mockDesktop = kind === "desktop";
    if (mockDesktop) mockOpenDesktopSettings.mockRejectedValueOnce(failure);
    else navigate.mockReturnValueOnce(Promise.reject(failure));

    navigateTo("/settings", navigate);
    await Promise.resolve();
    expect(logged).toHaveBeenCalledWith(
      mockDesktop
        ? "Navigation: desktop settings failed"
        : "Navigation: route change failed",
      failure,
    );
  },
);

it("keeps synchronous router errors visible to the caller", () => {
  const failure = new Error("route failed");
  navigate.mockImplementationOnce(() => {
    throw failure;
  });
  expect(() => {
    navigateTo("/transfer", navigate);
  }).toThrow(failure);
});
