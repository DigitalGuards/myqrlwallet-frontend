// Built-wallet translation and layout smoke with synthetic public data and stubbed RPC.
import { reviewProbes } from "./i18n-review-probes.mjs";
import { helperRouteProbes } from "./i18n-helper-route-probes.mjs";
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

const output = process.env.I18N_SCREENSHOT_DIR ?? join(tmpdir(), "fe-i18n");
const origin = "http://localhost:4175";
const address = `Q${"1".repeat(128)}`;
const languages = ["en", "de", "es", "ru", "zh-CN"];
const server = spawn(
  process.execPath,
  [
    "node_modules/vite/bin/vite.js",
    "--config",
    "config/vite.config.ts",
    "preview",
    "--host",
    "localhost",
    "--port",
    "4175",
    "--strictPort",
  ],
  { stdio: ["ignore", "ignore", "inherit"] },
);
let browser;
const results = [];
const timeout = setTimeout(() => {
  server.kill();
  process.exit(1);
}, 180000);

try {
  await mkdir(output, { recursive: true });
  for (let attempt = 0; attempt < 40; attempt++) {
    if (server.exitCode !== null) throw new Error("Preview server exited");
    try {
      await fetch(origin);
      break;
    } catch {
      await delay(250);
    }
    if (attempt === 39) throw new Error("Preview did not start");
  }
  browser = await chromium.launch();
  await helperRouteProbes(browser, origin);
  await reviewProbes(browser, origin);
  for (const language of languages) {
    const catalogs = Object.fromEntries(
      await Promise.all(
        ["common", "home", "settings", "tokens", "history"].map(async (ns) => [
          ns,
          JSON.parse(
            await readFile(`src/locales/${language}/${ns}.json`, "utf8"),
          ),
        ]),
      ),
    );
    const context = await browser.newContext({
      viewport: { width: 360, height: 800 },
      locale: "en-US",
      reducedMotion: "reduce",
    });
    await context.addInitScript(
      ({ language, address }) => {
        if (sessionStorage.getItem("i18n-fixture")) return;
        sessionStorage.setItem("i18n-fixture", "1");
        const save = (key, value) =>
          localStorage.setItem(
            key,
            JSON.stringify({ value, timestamp: Date.now(), version: "v1" }),
          );
        for (const prefix of ["", "qrlwallet:v3:"])
          save(`${prefix}WALLET_SETTINGS`, {
            language,
            showTokensCard: true,
            showNftsCard: true,
            autoLockTimeout: 900000,
          });
        for (const network of ["TEST_NET", "TEST_NET_V3"]) {
          save(`${network}_QIP55_ACCOUNT_LIST`, [{ address, source: "seed" }]);
          save(`${network}_QIP55_ACTIVE_ACCOUNT`, address);
          // Only inventory metadata, with no usable secret or signing capability.
          save(`${network}_ENCRYPTED_SEEDS`, [
            {
              address,
              encryptedSeed: "invalid-ui-fixture",
              lastAccessed: Date.now(),
            },
          ]);
        }
      },
      { language, address },
    );
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on("console", (message) => {
      if (message.type() === "error") console.error(message.text());
    });
    const scripts = new Set();
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      if (request.resourceType() === "script") scripts.add(request.url());
    });
    await page.route("**/*", async (route) => {
      const request = route.request();
      const url = request.url();
      if (url.startsWith(origin)) return route.continue();
      const headers = {
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "*",
        "access-control-allow-methods": "*",
      };
      if (request.method() === "OPTIONS")
        return route.fulfill({ status: 204, headers });
      if (/\/qrl-rpc/.test(url) && request.method() === "POST") {
        const answer = (rpc) => ({
          jsonrpc: "2.0",
          id: rpc.id,
          result:
            {
              net_listening: true,
              net_version: "3151909",
              qrl_chainId: "0x301825",
              qrl_getBlockByNumber: {
                hash: "0xd15407991193e6c23b733dc6bf9c628deaff8f9b6e252aa0d60030952b3e3ea4",
                number: "0x0",
              },
              qrl_getBalance: "0xab54a98ceb1f0ad2",
              qrl_blockNumber: "0x1",
              qrl_gasPrice: "0x3b9aca00",
            }[rpc.method] ?? "0x0",
        });
        const data = request.postDataJSON();
        return route.fulfill({
          status: 200,
          headers,
          contentType: "application/json",
          body: JSON.stringify(
            Array.isArray(data) ? data.map(answer) : answer(data),
          ),
        });
      }
      return route.fulfill({
        status: 200,
        headers,
        contentType: "application/json",
        body: JSON.stringify(
          url.includes("tx-history") ? { transactions: [] } : {},
        ),
      });
    });
    const snapshot = async (name) => {
      await page.evaluate(() => document.fonts.ready);
      assert.ok(
        !(await page.locator("body").innerText()).includes("{{"),
        `${language}/${name}: unresolved interpolation`,
      );
      await delay(150);
      const problems = await page.evaluate(() => {
        const findings = [];
        if (document.documentElement.scrollWidth > innerWidth + 1)
          findings.push("Document overflows");
        for (const element of document.querySelectorAll(
          'button, a, select, input, h1, h2, [role="alert"], [role="dialog"], nav span',
        )) {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          if (!rect.width || !rect.height || style.visibility === "hidden")
            continue;
          if (element.closest('[aria-hidden="true"]')) continue;
          if (rect.right > innerWidth + 1 || rect.left < -1)
            findings.push(
              `${element.tagName}: ${element.textContent?.trim().slice(0, 60)} outside viewport`,
            );
          // Absolute, aria-hidden navigation markers can extend past a button.
          // Check the rendered text itself so decoration cannot hide real failures.
          let clipped =
            element.tagName === "SELECT" &&
            element.scrollWidth > element.clientWidth + 2;
          if (["BUTTON", "A"].includes(element.tagName)) {
            const walker = document.createTreeWalker(
              element,
              NodeFilter.SHOW_TEXT,
            );
            while (walker.nextNode()) {
              const node = walker.currentNode;
              const parent = node.parentElement;
              if (
                !node.textContent?.trim() ||
                !parent ||
                parent.closest('[aria-hidden="true"], [hidden], .sr-only') ||
                getComputedStyle(parent).visibility === "hidden"
              )
                continue;
              const range = document.createRange();
              range.selectNodeContents(node);
              for (const textRect of range.getClientRects()) {
                if (
                  textRect.width &&
                  textRect.height &&
                  (textRect.left < rect.left - 2 ||
                    textRect.right > rect.right + 2 ||
                    textRect.top < rect.top - 2 ||
                    textRect.bottom > rect.bottom + 2)
                )
                  clipped = true;
              }
            }
          }
          if (clipped)
            findings.push(
              `${element.tagName}: ${element.textContent?.trim().slice(0, 60)} clips content`,
            );
        }
        return findings;
      });
      await page.screenshot({
        path: join(output, `${language}-${name}-360.png`),
        fullPage: true,
        animations: "disabled",
      });
      results.push({ language, screen: name, problems });
      assert.deepEqual(
        problems,
        [],
        `${language}/${name}: ${problems.join("; ")}`,
      );
      assert.deepEqual(errors, [], `${language}/${name}: browser errors`);
    };
    await page.goto(origin, { waitUntil: "networkidle" });
    await page
      .getByRole("heading", { name: catalogs.home.activeAccount, exact: true })
      .waitFor();
    assert.equal(await page.locator("html").getAttribute("lang"), language);
    await page.getByText(catalogs.tokens.empty, { exact: true }).waitFor();
    await snapshot("home");
    await page
      .getByText(catalogs.home.noNfts, { exact: true })
      .scrollIntoViewIfNeeded();
    await snapshot("home-collectibles");
    await page
      .getByRole("button", { name: catalogs.tokens.add, exact: true })
      .first()
      .click();
    await page
      .getByRole("menuitem", { name: catalogs.tokens.addExisting, exact: true })
      .waitFor();
    await snapshot("tokens-menu");
    await page
      .getByRole("menuitem", { name: catalogs.tokens.addExisting, exact: true })
      .click();
    await page
      .getByRole("heading", { name: catalogs.tokens.add, exact: true })
      .waitFor();
    await snapshot("tokens-add");
    await page
      .getByRole("button", { name: catalogs.common.close, exact: true })
      .click();
    // Each non-English dictionary has a distinct signature. Check actual fetched scripts.
    const scriptBodies = await Promise.all(
      [...scripts].map(async (url) => (await fetch(url)).text()),
    );
    assert.ok(
      scriptBodies.some((body) =>
        body.includes(
          JSON.stringify(catalogs.home.seoDescription).slice(1, -1),
        ),
      ),
      `${language} catalog was absent from fetched scripts`,
    );
    for (const other of languages.filter(
      (value) => value !== "en" && value !== language,
    )) {
      const otherCatalog = JSON.parse(
        await readFile(`src/locales/${other}/home.json`, "utf8"),
      );
      assert.ok(
        !scriptBodies.some((body) =>
          body.includes(
            JSON.stringify(otherCatalog.seoDescription).slice(1, -1),
          ),
        ),
        `${other} loaded before selection`,
      );
    }
    await page
      .getByRole("button", { name: catalogs.home.receive, exact: true })
      .click();
    await page
      .getByRole("heading", { name: catalogs.home.receiveQuanta })
      .waitFor();
    await page
      .getByRole("button", { name: catalogs.common.showAddress, exact: true })
      .click();
    await snapshot("receive");
    await page
      .getByRole("button", { name: catalogs.common.close, exact: true })
      .click();
    await page
      .getByRole("button", { name: catalogs.home.history, exact: true })
      .click();
    await page.getByRole("heading", { name: catalogs.history.title }).waitFor();
    await snapshot("history");
    await page
      .getByRole("button", { name: catalogs.common.close, exact: true })
      .click();
    await page
      .getByRole("button", { name: catalogs.common.settings, exact: true })
      .last()
      .click();
    await page
      .getByRole("combobox", { name: catalogs.settings.language, exact: true })
      .waitFor();
    await snapshot("settings");
    await page.locator("#wallet-language").scrollIntoViewIfNeeded();
    await snapshot("settings-language");
    await page
      .getByRole("button", {
        name: new RegExp(`^${catalogs.settings.changePin}`),
      })
      .click();
    await snapshot("settings-pin");
    await page
      .getByRole("button", { name: new RegExp(`^${catalogs.settings.export}`) })
      .first()
      .click();
    await page
      .locator("#export-wallet-panel")
      .evaluate((element) => element.scrollIntoView({ block: "start" }));
    await snapshot("settings-export");
    await page
      .getByRole("button", { name: catalogs.settings.connectDapp, exact: true })
      .click();
    await page
      .getByPlaceholder(catalogs.settings.pasteCode)
      .scrollIntoViewIfNeeded();
    await snapshot("settings-connect");
    const documentId = await page.evaluate(() => {
      window.i18nDocumentId = Math.random();
      return window.i18nDocumentId;
    });
    await page
      .locator("#wallet-language")
      .selectOption(language === "en" ? "de" : "en");
    await page.waitForFunction(
      (target) => document.documentElement.lang === target,
      language === "en" ? "de" : "en",
    );
    assert.equal(
      await page.evaluate(() => window.i18nDocumentId),
      documentId,
      "Language switch reloaded the document",
    );
    await page.locator("#wallet-language").selectOption(language);
    await page.waitForFunction(
      (target) => document.documentElement.lang === target,
      language,
    );
    await page.reload({ waitUntil: "networkidle" });
    assert.equal(await page.locator("html").getAttribute("lang"), language);
    await page.evaluate(() => {
      for (const key of Object.keys(localStorage)) {
        if (
          /QIP55_ACCOUNT_LIST|QIP55_ACTIVE_ACCOUNT|ENCRYPTED_SEEDS|ACTIVE_PAGE/.test(
            key,
          )
        )
          localStorage.removeItem(key);
      }
    });
    await page.goto(origin, { waitUntil: "networkidle" });
    await page
      .getByRole("link", { name: catalogs.home.createAccount, exact: true })
      .waitFor();
    await snapshot("home-onboarding");
    await context.close();
  }
  await writeFile(
    join(output, "layout-results.json"),
    JSON.stringify(results, null, 2),
  );
  console.log(
    `smoke-i18n: OK (${results.length} screenshots at 360 px, lazy loading, live switching, persistence, no page errors)`,
  );
} finally {
  clearTimeout(timeout);
  await browser?.close();
  server.kill();
  await writeFile(
    join(output, "layout-results.json"),
    JSON.stringify(results, null, 2),
  );
}
