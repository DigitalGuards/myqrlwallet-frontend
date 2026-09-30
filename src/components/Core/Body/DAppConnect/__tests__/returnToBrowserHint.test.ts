/**
 * @jest-environment jsdom
 *
 * Telling an iOS user to go back to their browser, and only then.
 *
 * The app hands a same-device user back to the dApp after an answered request.
 * Android backgrounds its own task, so the browser returns by itself. iOS has
 * no equivalent, so the wallet stays in front and the page has to say so.
 */
import { afterEach, describe, expect, it } from "@jest/globals";
import { shouldPromptReturnToBrowser } from "../returnToBrowserHint";
import { isIOSNativeApp, nativeAppPlatform } from "@/utils/nativeApp";

const base = {
  isIOSNative: true,
  txProgress: "confirming" as const,
  handedBackToDApp: true,
};

/**
 * What the app injects. Its WebView forces one hardcoded iPhone user agent on
 * every platform, so the declared field is the only honest signal.
 */
function setInjectedPlatform(platform: string | null): void {
  const bridge =
    platform === null
      ? undefined
      : {
          postMessage: () => undefined,
          injectedObjectJson: () =>
            JSON.stringify({
              qrlWalletCapabilities: {
                bridgeVersion: 1,
                addressScheme: "qip55-64",
                platform,
              },
            }),
        };
  Object.defineProperty(window, "ReactNativeWebView", {
    configurable: true,
    value: bridge,
  });
}

function setUserAgent(value: string, maxTouchPoints = 0): void {
  Object.defineProperty(navigator, "userAgent", {
    configurable: true,
    get: () => value,
  });
  Object.defineProperty(navigator, "maxTouchPoints", {
    configurable: true,
    get: () => maxTouchPoints,
  });
}

describe("the return-to-browser hint", () => {
  it("shows once the dApp has its answer", () => {
    for (const txProgress of ["confirming", "confirmed", "unknown"] as const) {
      expect(shouldPromptReturnToBrowser({ ...base, txProgress })).toBe(true);
    }
  });

  it("stays hidden before the dApp has anything, and on a failure", () => {
    // Nothing to go back to yet, and a failure is the wallet's to explain.
    for (const txProgress of [
      "idle",
      "signing",
      "broadcasting",
      "failed",
    ] as const) {
      expect(shouldPromptReturnToBrowser({ ...base, txProgress })).toBe(false);
    }
  });

  it("stays hidden on Android and in a browser, where nothing needs saying", () => {
    expect(
      shouldPromptReturnToBrowser({ ...base, isIOSNative: false }),
    ).toBe(false);
  });

  it("stays hidden until the answer actually reached the dApp", () => {
    // Either the session does not hand the user back at all (a QR-scanned
    // session, where the dApp is on another device), or the answer is still
    // held for an absent relay. Sending the user back to a dApp that is still
    // waiting is worse than saying nothing.
    expect(
      shouldPromptReturnToBrowser({ ...base, handedBackToDApp: false }),
    ).toBe(false);
  });
});

describe("the platform the page acts on", () => {
  afterEach(() => {
    setInjectedPlatform(null);
  });

  it("believes the app over the user agent it forges", () => {
    // The app's WebView sets an iPhone user agent on Android too, so sniffing
    // it showed the iOS-only hint on a phone that returns by itself.
    setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 15_0) MyQRLWallet/1.4.2");
    setInjectedPlatform("android");
    expect(nativeAppPlatform()).toBe("android");
    expect(isIOSNativeApp()).toBe(false);

    setInjectedPlatform("ios");
    expect(nativeAppPlatform()).toBe("ios");
    expect(isIOSNativeApp()).toBe(true);

    // A value the app never sends is not a platform.
    setInjectedPlatform("web");
    expect(nativeAppPlatform()).toBe("ios"); // falls back to the user agent
  });

  it("falls back to the user agent for an app build without the field", () => {
    setInjectedPlatform(null);
    setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) MyQRLWallet/1.4.2");
    expect(isIOSNativeApp()).toBe(true);

    // iPadOS 13+ reports a desktop user agent; touch points are the tell.
    setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X) MyQRLWallet/1.4.2", 5);
    expect(isIOSNativeApp()).toBe(true);

    setUserAgent("Mozilla/5.0 (Linux; Android 14; Pixel) MyQRLWallet/1.4.2");
    expect(nativeAppPlatform()).toBe("android");
    expect(isIOSNativeApp()).toBe(false);
  });

  it("is nothing at all outside the native app", () => {
    // Same device, ordinary browser: no app to background, no hint to give.
    setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Safari/605.1.15");
    expect(nativeAppPlatform()).toBeNull();
    expect(isIOSNativeApp()).toBe(false);

    setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X) Chrome/140.0", 0);
    expect(nativeAppPlatform()).toBeNull();
    expect(isIOSNativeApp()).toBe(false);
  });
});
