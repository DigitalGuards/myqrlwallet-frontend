/**
 * The hosted build carries no native bridge. Inside an app version that still
 * loads qrlwallet.com it must show the update screen and keep every native
 * path off; the desktop app and plain browsers must never match.
 */
import { afterEach, describe, expect, it, jest } from "@jest/globals";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalNavigator = Object.getOwnPropertyDescriptor(
  globalThis,
  "navigator",
);

function environment(options: {
  userAgent: string;
  reactNative?: boolean;
  desktop?: boolean;
}) {
  const win: Record<string, unknown> = {};
  if (options.reactNative)
    win["ReactNativeWebView"] = { postMessage: () => undefined };
  if (options.desktop) win["qrlWallet"] = { addressScheme: "qip55-64" };
  Object.defineProperty(globalThis, "window", {
    value: win,
    configurable: true,
  });
  Object.defineProperty(globalThis, "navigator", {
    value: { userAgent: options.userAgent },
    configurable: true,
  });
}

function load(embedded: boolean): typeof import("@/utils/nativeApp") {
  let module: typeof import("@/utils/nativeApp") | undefined;
  jest.isolateModules(() => {
    jest.doMock("@/utils/embeddedRuntime", () => ({
      ...jest.requireActual<typeof import("@/utils/embeddedRuntime")>(
        "@/utils/embeddedRuntime",
      ),
      IS_EMBEDDED_BUILD: embedded,
    }));
    module =
      jest.requireActual<typeof import("@/utils/nativeApp")>(
        "@/utils/nativeApp",
      );
  });
  if (!module) throw new Error("nativeApp did not load");
  return module;
}

afterEach(() => {
  jest.dontMock("@/utils/embeddedRuntime");
  if (originalWindow)
    Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
  if (originalNavigator)
    Object.defineProperty(globalThis, "navigator", originalNavigator);
  else Reflect.deleteProperty(globalThis, "navigator");
});

describe("the hosted build inside an app", () => {
  it("treats an app that loads qrlwallet.com as retired and never as native", () => {
    environment({
      userAgent: "Mozilla/5.0 MyQRLWallet/1.4.2",
      reactNative: true,
    });
    const native = load(false);
    expect(native.isRetiredNativeApp()).toBe(true);
    expect(native.isInNativeApp()).toBe(false);
  });

  it("detects the bridge object alone and the user agent alone", () => {
    environment({ userAgent: "Mozilla/5.0", reactNative: true });
    expect(load(false).isRetiredNativeApp()).toBe(true);
    environment({ userAgent: "Mozilla/5.0 MyQRLWallet/1.3.4" });
    expect(load(false).isRetiredNativeApp()).toBe(true);
  });

  it("leaves browsers and the desktop app alone", () => {
    environment({ userAgent: "Mozilla/5.0 Chrome/150" });
    expect(load(false).isRetiredNativeApp()).toBe(false);
    environment({ userAgent: "Mozilla/5.0 MyQRLWallet/1.3.1", desktop: true });
    expect(load(false).isRetiredNativeApp()).toBe(false);
  });
});

describe("the embedded build inside the app", () => {
  it("is native and never retired", () => {
    environment({
      userAgent: "Mozilla/5.0 MyQRLWallet/1.4.2",
      reactNative: true,
    });
    const native = load(true);
    expect(native.isInNativeApp()).toBe(true);
    expect(native.isRetiredNativeApp()).toBe(false);
  });
});
