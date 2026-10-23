import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { bannerVisibilityProbes } from "./i18n-banner-probes.mjs";
import { i18nLanguages } from "./i18n-smoke-options.mjs";

const rawKey =
  /(?:common|home|settings|tokens|history|transfer|accounts|contacts|onboarding|dapps|telegram|notices):[A-Za-z][\w.-]*|{{/;

/** Display-only session fixtures. No pairing handshake. */
export async function slice4Screens({
  page,
  origin,
  catalogs,
  snapshot,
  address,
  full = true,
  embedded = false,
}) {
  const c = catalogs.dapps;
  const go = async (path, title) => {
    await page.evaluate(
      ({ path, embedded }) => {
        for (const prefix of ["", "qrlwallet:v3:"])
          localStorage.setItem(
            `${prefix}ACTIVE_PAGE`,
            JSON.stringify({
              value: path,
              timestamp: Date.now(),
              version: "v1",
            }),
          );
        if (embedded) location.hash = path;
      },
      { path, embedded },
    );
    if (!embedded)
      await page.goto(`${origin}${path}`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: title, exact: true }).waitFor();
  };
  const clear = async () => {
    await page.evaluate(() => {
      const s = window.__APP_STORE__.dappConnectStore;
      s.activeSessions = [];
    });
  };
  await go("/qr-view", catalogs.accounts.qrTitle);
  await snapshot("qr-view");
  await go("/telegram", catalogs.telegram.title);
  await page
    .getByText(
      embedded ? catalogs.telegram.degraded : catalogs.telegram.operational,
      { exact: true },
    )
    .waitFor();
  await snapshot("telegram");
  await go("/dapp-sessions", c.sessionsTitle);
  await page.waitForFunction(() => Boolean(window.__APP_STORE__));
  await page.evaluate((address) => {
    window.__APP_STORE__.qrlStore.activeAccount.accountAddress = address;
  }, address);
  if (full) await snapshot("dapp-sessions-empty");
  const statuses = full
    ? [
        "connected",
        "connecting",
        "key_exchange",
        "reconnecting",
        "disconnected",
      ]
    : [catalogs.code === "de" ? "reconnecting" : "connected"];
  for (const status of statuses) {
    await page.evaluate(
      ({ address, status }) => {
        window.__APP_STORE__.dappConnectStore.activeSessions = [
          {
            id: "language-fixture",
            status,
            dappInfo: {
              name: "Example dApp",
              url: "https://dapp.example",
              chainId: "0x301825",
            },
            connectedAccount: address,
            createdAt: 1700000000000,
          },
        ];
      },
      { address, status },
    );
    await snapshot(`dapp-session-${status}`);
  }
  await clear();
  if (full) await bannerVisibilityProbes({ page, snapshot, address });
  await go("/settings", catalogs.common.settings);
}

/** Standalone boot errors render before the wallet store is constructed. */
export async function slice4NoticeProbes({
  browser,
  origin,
  output,
  languages = i18nLanguages,
}) {
  const results = [];
  for (const language of languages) {
    const c = JSON.parse(
      await readFile(`src/locales/${language}/notices.json`, "utf8"),
    );
    for (const kind of ["retired", "load-failed"]) {
      const context = await browser.newContext({
        viewport: { width: 360, height: 800 },
        userAgent: kind === "retired" ? "MyQRLWallet" : "Browser",
      });
      try {
        await context.addInitScript((language) => {
          for (const prefix of ["", "qrlwallet:v3:"])
            localStorage.setItem(
              `${prefix}WALLET_LANGUAGE`,
              JSON.stringify(language),
            );
        }, language);
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.route("**/*", (route) => {
          const url = route.request().url();
          if (kind === "load-failed" && /\/App-[^/]+\.js/.test(url))
            return route.abort();
          return url.startsWith(origin) ? route.continue() : route.abort();
        });
        await page.goto(origin, { waitUntil: "networkidle" });
        await page
          .getByRole("heading", {
            name: kind === "retired" ? c.update : c.loadFailed,
            exact: true,
          })
          .waitFor();
        assert.doesNotMatch(await page.locator("body").innerText(), rawKey);
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth + 1,
          ),
          false,
        );
        assert.deepEqual(errors, []);
        await page.screenshot({
          path: join(output, `${language}-notice-${kind}-360.png`),
          fullPage: true,
        });
        results.push({ language, screen: `notice-${kind}`, problems: [] });
      } finally {
        await context.close();
      }
    }
  }
  return results;
}
