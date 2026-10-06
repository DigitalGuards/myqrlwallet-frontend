import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import {
  registerBackDismiss,
  recordRoute,
  registeredOverlayCount,
  resetNativeBackForTests,
  resolveNativeBack,
} from "@/utils/nativeBack";

const navigate = jest.fn((_path: string) => undefined);

beforeEach(() => {
  jest.clearAllMocks();
  resetNativeBackForTests();
});

describe("overlays answer back first", () => {
  it("closes the topmost overlay and reports handled", () => {
    const outer = jest.fn(() => true);
    const inner = jest.fn(() => true);
    registerBackDismiss(outer);
    registerBackDismiss(inner);

    expect(resolveNativeBack(navigate, "/transfer")).toBe("handled");
    expect(inner).toHaveBeenCalledTimes(1);
    // The outer overlay is still open and answers the next press.
    expect(outer).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("closes one overlay per press", () => {
    const outer = jest.fn(() => true);
    const inner = jest.fn(() => true);
    const closeOuter = registerBackDismiss(outer);
    const closeInner = registerBackDismiss(inner);

    expect(resolveNativeBack(navigate, "/")).toBe("handled");
    closeInner();
    expect(resolveNativeBack(navigate, "/")).toBe("handled");
    closeOuter();
    expect(resolveNativeBack(navigate, "/")).toBe("at-root");
  });

  it("passes down when an overlay declines", () => {
    const declines = jest.fn(() => false);
    registerBackDismiss(declines);
    recordRoute("/");
    recordRoute("/settings");

    expect(resolveNativeBack(navigate, "/settings")).toBe("handled");
    expect(declines).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith("/");
  });

  it("drops an overlay that throws and keeps going", () => {
    const broken = jest.fn(() => {
      throw new Error("render is gone");
    });
    const below = jest.fn(() => true);
    registerBackDismiss(below);
    registerBackDismiss(broken);
    const logged = jest.spyOn(console, "error").mockImplementation(() => {});

    expect(resolveNativeBack(navigate, "/")).toBe("handled");
    expect(below).toHaveBeenCalledTimes(1);
    expect(registeredOverlayCount()).toBe(1);
    logged.mockRestore();
  });

  it("unregisters exactly the overlay that closed", () => {
    const first = registerBackDismiss(() => true);
    registerBackDismiss(() => true);
    expect(registeredOverlayCount()).toBe(2);

    first();
    expect(registeredOverlayCount()).toBe(1);
  });
});

describe("route navigation when nothing is open", () => {
  it("walks back through the in-memory stack", () => {
    // The hash router replaces history entries, so this stack is the only
    // record of where the user came from.
    recordRoute("/");
    recordRoute("/account-list");
    recordRoute("/transfer");

    expect(resolveNativeBack(navigate, "/transfer")).toBe("handled");
    expect(navigate).toHaveBeenCalledWith("/account-list");
  });

  it("ignores a repeated route", () => {
    recordRoute("/");
    recordRoute("/settings");
    recordRoute("/settings");

    expect(resolveNativeBack(navigate, "/settings")).toBe("handled");
    expect(navigate).toHaveBeenCalledWith("/");
  });

  it("falls back to Home from a route with no recorded history", () => {
    expect(resolveNativeBack(navigate, "/settings")).toBe("handled");
    expect(navigate).toHaveBeenCalledWith("/");
  });

  it("reports at-root on Home with nothing open, and changes nothing", () => {
    recordRoute("/");

    expect(resolveNativeBack(navigate, "/")).toBe("at-root");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("reaches Home through the stack, then reports at-root", () => {
    recordRoute("/");
    recordRoute("/address-book");

    expect(resolveNativeBack(navigate, "/address-book")).toBe("handled");
    expect(navigate).toHaveBeenCalledWith("/");
    expect(resolveNativeBack(navigate, "/")).toBe("at-root");
  });

  it("keeps the stack bounded over a long session", () => {
    for (let index = 0; index < 200; index += 1) recordRoute(`/route-${index}`);

    // Still resolves, and the oldest entries were dropped rather than kept.
    expect(resolveNativeBack(navigate, "/route-199")).toBe("handled");
    expect(navigate).toHaveBeenCalledWith("/route-198");
  });
});
