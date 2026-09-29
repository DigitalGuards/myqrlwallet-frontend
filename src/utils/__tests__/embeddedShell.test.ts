/**
 * @jest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

const mockState = { inNativeApp: true, embedded: true };
const mockOpenExternalUrl = jest.fn((_url: string) => undefined);
const mockLogToNative = jest.fn((_message: string) => undefined);

// Every member is an arrow so the mocks are dereferenced when called, not
// when jest hoists this factory above their declarations.
jest.mock("@/utils/nativeApp", () => ({
  openExternalUrl: (url: string) => mockOpenExternalUrl(url),
  logToNative: (message: string) => mockLogToNative(message),
  isInNativeApp: () => mockState.inNativeApp,
}));

jest.mock("@/utils/embeddedRuntime", () => ({
  isEmbeddedRuntime: () => mockState.embedded,
  // The embedded build folds this to true and the minifier drops the reload.
  IS_EMBEDDED_BUILD: true,
}));

import {
  installEmbeddedShell,
  reloadDocument,
  resetEmbeddedShellForTests,
} from "@/utils/embeddedShell";

const clickAnchor = (html: string): boolean => {
  document.body.innerHTML = html;
  const anchor = document.querySelector("a");
  if (anchor === null) throw new Error("fixture has no anchor");
  const event = new MouseEvent("click", {
    bubbles: true,
    cancelable: true,
    button: 0,
  });
  anchor.dispatchEvent(event);
  return event.defaultPrevented;
};

beforeEach(() => {
  jest.clearAllMocks();
  mockState.embedded = true;
  mockState.inNativeApp = true;
  resetEmbeddedShellForTests();
  document.body.innerHTML = "";
});

afterEach(() => {
  resetEmbeddedShellForTests();
});

describe("reloadDocument", () => {
  it("refuses in the embedded build and reports that it did not reload", () => {
    // jsdom would log "Not implemented: navigation" if a reload were attempted.
    expect(reloadDocument()).toBe(false);
  });
});

describe("external link interception", () => {
  it("hands an external link to the native bridge instead of the WebView", () => {
    installEmbeddedShell();
    const prevented = clickAnchor(
      '<a href="https://qrlwallet.com/.well-known/security.txt" target="_blank">security.txt</a>',
    );

    expect(prevented).toBe(true);
    expect(mockOpenExternalUrl).toHaveBeenCalledWith(
      "https://qrlwallet.com/.well-known/security.txt",
    );
  });

  it("covers every external link, including the explorer and the PGP key", () => {
    installEmbeddedShell();
    for (const href of [
      "https://qrlwallet.com/pgp-key.txt",
      "https://zondscan.com/tx/0xabc",
      "https://digitalguards.nl/",
    ]) {
      mockOpenExternalUrl.mockClear();
      expect(clickAnchor(`<a href="${href}">link</a>`)).toBe(true);
      expect(mockOpenExternalUrl).toHaveBeenCalledWith(href);
    }
  });

  it("catches a link nested inside other markup", () => {
    installEmbeddedShell();
    document.body.innerHTML =
      '<a href="https://zondscan.com/"><span id="inner">go</span></a>';
    const inner = document.getElementById("inner");
    const event = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 0,
    });
    inner?.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(mockOpenExternalUrl).toHaveBeenCalledWith("https://zondscan.com/");
  });

  it("leaves in-app hash routes to the router", () => {
    installEmbeddedShell();
    for (const href of ["#/settings", "#/", "#"]) {
      expect(clickAnchor(`<a href="${href}">route</a>`)).toBe(false);
    }
    expect(mockOpenExternalUrl).not.toHaveBeenCalled();
  });

  it("intercepts a root-relative link, which would fetch the live site", () => {
    installEmbeddedShell();
    // Under the WebView baseUrl this resolves against qrlwallet.com, so it is
    // an escape from the shipped document just like an absolute URL.
    expect(clickAnchor('<a href="/pgp-key.txt">key</a>')).toBe(true);
    // Resolved against the document, which in the WebView is qrlwallet.com.
    expect(mockOpenExternalUrl).toHaveBeenCalledWith(
      `${window.location.origin}/pgp-key.txt`,
    );
  });

  it("does nothing outside the embedded runtime", () => {
    mockState.embedded = false;
    installEmbeddedShell();
    expect(clickAnchor('<a href="https://zondscan.com/">link</a>')).toBe(false);
    expect(mockOpenExternalUrl).not.toHaveBeenCalled();
  });

  it("leaves modified clicks alone", () => {
    installEmbeddedShell();
    document.body.innerHTML = '<a href="https://zondscan.com/">link</a>';
    const event = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 0,
      metaKey: true,
    });
    document.querySelector("a")?.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});
