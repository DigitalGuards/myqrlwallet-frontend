import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

export const bannerStates = [
  "connected",
  "connecting",
  "key_exchange",
  "reconnecting",
  "disconnected",
];

// Read the production validator's bound so the fixture follows metadata changes.
const metadata = await readFile(
  "src/services/dappConnect/dappMetadata.ts",
  "utf8",
);
const bound = /const MAX_DAPP_NAME_LENGTH = (\d+);/.exec(metadata);
assert.ok(bound, "Missing dApp metadata name bound");
export const maximalDappName = "W".repeat(Number(bound[1]));

/** Exercise the real button with a display-only disconnect recorder. */
export async function bannerVisibilityProbes({ page, snapshot, address }) {
  const viewport = page.viewportSize();
  await page.setViewportSize({ width: 360, height: 320 });
  await page.evaluate(() => {
    const store = window.__APP_STORE__.dappConnectStore;
    window.bannerProbe = { disconnect: store.disconnectSession, calls: [] };
    store.disconnectSession = (id) => window.bannerProbe.calls.push(id);
  });
  try {
    for (const status of bannerStates) {
      await page.evaluate(
        ({ status, name, address }) => {
          window.__APP_STORE__.dappConnectStore.activeSessions = [
            {
              id: "banner-language-fixture",
              status,
              originatorInfoReceived: true,
              dappInfo: {
                name,
                url: "https://dapp.example",
                chainId: "0x301825",
              },
              connectedAccount: address,
              createdAt: 1700000000000,
            },
          ];
          window.scrollTo(0, 0);
        },
        { status, name: maximalDappName, address },
      );
      const row = page.locator("div.space-y-1.px-4.pb-2 > div");
      await row.getByText(maximalDappName, { exact: true }).waitFor();
      await page.evaluate(() => document.fonts.ready);
      const problems = await row.evaluate((element) => {
        const button = element.querySelector("button");
        const rect = button.getBoundingClientRect();
        const findings = [];
        if (
          rect.left < 0 ||
          rect.right > innerWidth ||
          rect.top < 0 ||
          rect.bottom > innerHeight
        )
          findings.push("Disconnect leaves the viewport");
        for (const x of [rect.left + 1, rect.right - 1])
          for (const y of [rect.top + 1, rect.bottom - 1])
            if (!button.contains(document.elementFromPoint(x, y)))
              findings.push("Disconnect is covered or clipped");
        const walker = document.createTreeWalker(
          element.firstElementChild,
          NodeFilter.SHOW_TEXT,
        );
        while (walker.nextNode()) {
          const node = walker.currentNode;
          if (!node.textContent.trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          for (const text of range.getClientRects()) {
            if (text.left < 0 || text.right > innerWidth)
              findings.push("Banner text leaves the viewport");
            if (
              text.left < rect.right &&
              text.right > rect.left &&
              text.top < rect.bottom &&
              text.bottom > rect.top
            )
              findings.push("Banner text covers Disconnect");
          }
        }
        return findings;
      });
      assert.deepEqual(problems, [], `${status}: ${problems.join("; ")}`);
      await snapshot(`dapp-banner-max-${status}`);
      await row.locator("button").click();
    }
    assert.deepEqual(
      await page.evaluate(() => window.bannerProbe.calls),
      bannerStates.map(() => "banner-language-fixture"),
      "Every banner state must dispatch a real Disconnect click",
    );
  } finally {
    await page.evaluate(() => {
      const store = window.__APP_STORE__.dappConnectStore;
      store.disconnectSession = window.bannerProbe.disconnect;
      store.activeSessions = [];
      delete window.bannerProbe;
    });
    await page.setViewportSize(viewport);
  }
}
