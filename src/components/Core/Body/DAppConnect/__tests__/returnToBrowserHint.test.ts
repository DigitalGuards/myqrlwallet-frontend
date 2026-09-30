/**
 * @jest-environment jsdom
 *
 * Telling an iOS user to go back to their browser, and only then.
 *
 * The app hands a same-device user back to the dApp after an answered request.
 * Android backgrounds its own task, so the browser returns by itself. iOS has
 * no equivalent, so the wallet stays in front and the page has to say so.
 */
import { describe, expect, it } from "@jest/globals";
import { shouldPromptReturnToBrowser } from "../returnToBrowserHint";
import { isIOSNativeApp } from "@/utils/nativeApp";

const base = {
  isIOSNative: true,
  txProgress: "confirming" as const,
  returnsToDApp: true,
};

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

  it("stays hidden for a session that does not hand the user back", () => {
    // A QR-scanned session: the dApp is on another device, and the user is
    // already looking at the right screen.
    expect(
      shouldPromptReturnToBrowser({ ...base, returnsToDApp: false }),
    ).toBe(false);
  });
});

describe("isIOSNativeApp", () => {
  it("is true only inside the native app on an iOS device", () => {
    setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) MyQRLWallet/1.4.2");
    expect(isIOSNativeApp()).toBe(true);

    // iPadOS 13+ reports a desktop user agent; touch points are the tell.
    setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X) MyQRLWallet/1.4.2", 5);
    expect(isIOSNativeApp()).toBe(true);

    setUserAgent("Mozilla/5.0 (Linux; Android 14; Pixel) MyQRLWallet/1.4.2");
    expect(isIOSNativeApp()).toBe(false);

    // Same device, ordinary browser: no app to background, no hint to give.
    setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Safari/605.1.15");
    expect(isIOSNativeApp()).toBe(false);

    setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X) Chrome/140.0", 0);
    expect(isIOSNativeApp()).toBe(false);
  });
});
