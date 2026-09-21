/** @jest-environment jsdom */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, render, waitFor } from "@testing-library/react";
import { HelmetProvider } from "react-helmet-async";
import { SEO } from "../SEO";

const DEFAULT_TITLE =
  "MyQRLWallet | Web Wallet for QRL, the Post-Quantum Blockchain";
const TITLE_SELECTORS = [
  'meta[name="title"]',
  'meta[property="og:title"]',
  'meta[name="twitter:title"]',
];

afterEach(cleanup);

describe("wallet title separators", () => {
  it("uses the pipe in the initial HTML title, title metadata and no-script heading", () => {
    const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");
    const page = new DOMParser().parseFromString(html, "text/html");
    expect(page.title).toBe(DEFAULT_TITLE);
    for (const selector of TITLE_SELECTORS) {
      expect(page.querySelector(selector)?.getAttribute("content")).toBe(
        DEFAULT_TITLE,
      );
    }
    expect(page.querySelector("noscript h1")?.textContent).toBe(DEFAULT_TITLE);
  });

  it("keeps the hydrated default title and social titles aligned", async () => {
    render(
      <HelmetProvider>
        <SEO />
      </HelmetProvider>,
    );
    await waitFor(() => expect(document.title).toBe(DEFAULT_TITLE));
    for (const selector of TITLE_SELECTORS) {
      expect(document.querySelector(selector)?.getAttribute("content")).toBe(
        DEFAULT_TITLE,
      );
    }
  });

  it("preserves the pipe separator for route-specific titles", async () => {
    render(
      <HelmetProvider>
        <SEO title="Send QRL" />
      </HelmetProvider>,
    );
    await waitFor(() => expect(document.title).toBe("Send QRL | MyQRLWallet"));
    for (const selector of TITLE_SELECTORS) {
      expect(document.querySelector(selector)?.getAttribute("content")).toBe(
        "Send QRL | MyQRLWallet",
      );
    }
  });
});
