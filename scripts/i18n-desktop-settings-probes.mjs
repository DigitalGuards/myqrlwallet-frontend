import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { i18nLanguages } from "./i18n-smoke-options.mjs";
import { smokeResult } from "./i18n-smoke-report.mjs";

/** Exercise the shipped renderer with a public, empty desktop bridge fixture. */
export async function desktopSettingsScreens({
  browser,
  origin,
  output,
  languages = i18nLanguages,
}) {
  const results = [];
  for (const language of languages) {
    const settings = JSON.parse(
      await readFile(`src/locales/${language}/settings.json`, "utf8"),
    );
    const common = JSON.parse(
      await readFile(`src/locales/${language}/common.json`, "utf8"),
    );
    for (const viewport of [
      { width: 360, height: 640 },
      { width: 1280, height: 800 },
    ]) {
      const screen = `desktop-settings-${viewport.width}x${viewport.height}`;
      const context = await browser.newContext({
        viewport,
        locale: "en-US",
        reducedMotion: "reduce",
      });
      try {
        await context.addInitScript((language) => {
          for (const prefix of ["", "qrlwallet:v3:"]) {
            const key = `${prefix}WALLET_LANGUAGE`;
            if (localStorage.getItem(key) === null)
              localStorage.setItem(key, JSON.stringify(language));
          }
          window.__desktopSettingsTest = { opens: 0, languages: [] };
          window.qrlWallet = {
            addressScheme: "qip55-64",
            listWallets: async () => ({ wallets: [], active: null }),
            onLockStateChanged: () => () => undefined,
            setLanguage: async (value) => {
              window.__desktopSettingsTest.languages.push(value);
            },
            openDesktopSettings: async () => {
              window.__desktopSettingsTest.opens++;
            },
          };
        }, language);
        const page = await context.newPage();
        page.setDefaultTimeout(15000);
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.route("**/*", (route) => {
          const request = route.request();
          const url = request.url();
          const headers = {
            "access-control-allow-origin": "*",
            "access-control-allow-headers": "*",
          };
          if (request.method() === "OPTIONS")
            return route.fulfill({ status: 204, headers });
          if (url.includes("qrl-rpc") && request.method() === "POST") {
            const reply = ({ id, method }) => ({
              jsonrpc: "2.0",
              id,
              result:
                {
                  net_listening: true,
                  net_version: "3151909",
                  qrl_chainId: "0x301825",
                  qrl_getBlockByNumber: {
                    hash: "0xd15407991193e6c23b733dc6bf9c628deaff8f9b6e252aa0d60030952b3e3ea4",
                    number: "0x0",
                  },
                }[method] ?? "0x0",
            });
            const input = request.postDataJSON();
            return route.fulfill({
              status: 200,
              headers,
              contentType: "application/json",
              body: JSON.stringify(
                Array.isArray(input) ? input.map(reply) : reply(input),
              ),
            });
          }
          if (url.startsWith(origin)) return route.continue();
          return route.fulfill({
            status: 200,
            headers,
            contentType: "application/json",
            body: "{}",
          });
        });
        await page.goto(origin, { waitUntil: "networkidle" });
        await page.waitForFunction(
          () => window.__APP_STORE__?.qrlStore.qrlConnection.isConnected,
        );
        await page
          .getByRole("button", { name: common.settings, exact: true })
          .last()
          .click();
        const view = page.locator("[data-page-shell]");
        await view
          .getByRole("combobox", { name: settings.language, exact: true })
          .waitFor();
        assert.equal(new URL(page.url()).hash, "#/settings");
        assert.equal(
          await page.evaluate(() => window.__desktopSettingsTest.opens),
          0,
        );
        assert.equal(await view.getByRole("button").count(), 1);
        assert.equal(await view.getByRole("combobox").count(), 1);
        assert.equal(await view.locator("section").count(), 2);
        assert.equal(await view.locator("input, [role=switch]").count(), 0);
        for (const key of [
          "network",
          "changePin",
          "autoLock",
          "showTokens",
          "showNfts",
          "export",
          "connections",
          "sessions",
        ])
          assert.equal(
            await view.getByText(settings[key], { exact: true }).count(),
            0,
            `${language}: unexpected ${key}`,
          );
        await view
          .getByRole("button", {
            name: `${settings.desktopSecurity} ${settings.desktopSecurityHint}`,
            exact: true,
          })
          .click();
        assert.equal(
          await page.evaluate(() => window.__desktopSettingsTest.opens),
          1,
        );
        assert.equal(new URL(page.url()).hash, "#/settings");

        const documentId = await page.evaluate(() => {
          window.__settingsDocumentId = Math.random();
          return window.__settingsDocumentId;
        });
        for (const target of [language === "en" ? "de" : "en", language]) {
          await page.locator("#wallet-language").selectOption(target);
          await page.waitForFunction(
            (target) =>
              document.documentElement.lang === target &&
              window.__desktopSettingsTest.languages.at(-1) === target,
            target,
          );
          assert.equal(
            await page.evaluate(() => window.__settingsDocumentId),
            documentId,
          );
        }
        await page.reload({ waitUntil: "networkidle" });
        await page.waitForFunction(
          () => window.__APP_STORE__?.qrlStore.qrlConnection.isConnected,
        );
        await view
          .getByRole("combobox", { name: settings.language, exact: true })
          .waitFor();
        assert.equal(
          await page.locator("#wallet-language").inputValue(),
          language,
        );
        assert.equal(new URL(page.url()).hash, "#/settings");
        assert.deepEqual(
          await page.evaluate(() => window.__desktopSettingsTest.languages),
          [language],
        );
        assert.equal(
          await page.evaluate(() => window.__desktopSettingsTest.opens),
          0,
        );
        await page.evaluate(() => {
          window.__APP_STORE__.qrlStore.qrlConnection.isConnected = false;
        });
        await page.evaluate(() => {
          window.__APP_STORE__.qrlStore.qrlConnection.isConnected = true;
        });
        await view
          .getByRole("heading", {
            name: common.settings,
            exact: true,
            level: 1,
          })
          .waitFor();
        await page.evaluate(() => document.fonts.ready);
        assert.doesNotMatch(
          await view.innerText(),
          /(?:common|settings):[A-Za-z][\w.-]*|{{/,
        );

        const problems = await view.evaluate((view) => {
          const problems = [];
          if (document.documentElement.scrollWidth > innerWidth + 1)
            problems.push("Document overflows");
          const nav = document.querySelector("nav.md\\:hidden");
          const bottom = nav?.getBoundingClientRect().height
            ? nav.getBoundingClientRect().top
            : innerHeight;
          for (const element of view.querySelectorAll(
            "button, select, label, p, h1, h2",
          )) {
            const rect = element.getBoundingClientRect();
            if (
              rect.left < -1 ||
              rect.right > innerWidth + 1 ||
              rect.top < -1 ||
              rect.bottom > bottom + 1
            )
              problems.push(`${element.tagName} outside available viewport`);
            if (element.scrollWidth > element.clientWidth + 2)
              problems.push(`${element.tagName} clips content`);
            if (element.tagName === "SELECT") continue;
            const walker = document.createTreeWalker(
              element,
              NodeFilter.SHOW_TEXT,
            );
            while (walker.nextNode()) {
              if (!walker.currentNode.textContent?.trim()) continue;
              const range = document.createRange();
              range.selectNodeContents(walker.currentNode);
              for (const text of range.getClientRects()) {
                if (
                  text.left < rect.left - 2 ||
                  text.right > rect.right + 2 ||
                  text.top < rect.top - 2 ||
                  text.bottom > rect.bottom + 2
                )
                  problems.push(`${element.tagName} clips text`);
              }
            }
          }
          return problems;
        });
        await page.screenshot({
          path: join(output, `${language}-${screen}.png`),
          fullPage: true,
          animations: "disabled",
        });
        results.push(
          smokeResult(
            language,
            screen,
            [...problems, ...errors],
            [
              "navigation",
              "security-window",
              "language-switch",
              "persistence",
              "route-restoration",
            ],
          ),
        );
        assert.deepEqual(problems, [], `${language}/${screen}: layout`);
        assert.deepEqual(errors, [], `${language}/${screen}: browser errors`);
      } finally {
        await context.close();
      }
    }
  }
  return results;
}
