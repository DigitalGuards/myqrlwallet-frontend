import { slice6Screens } from "./i18n-slice6-probes.mjs";
import { slice5Screens } from "./i18n-slice5-probes.mjs";
import { slice4Screens } from "./i18n-slice4-probes.mjs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { nativeStorageScreens } from "./i18n-native-storage-probes.mjs";
import { smokeLanguages } from "./i18n-smoke-options.mjs";
import { assertEmbeddedI18nCoverage } from "./i18n-coverage.mjs";
import { writeSmokeReport } from "./i18n-smoke-report.mjs";

const languages = smokeLanguages();
const html = await readFile("dist-embedded/index.html", "utf8");
const output = join(
  process.env.I18N_SCREENSHOT_DIR ?? join(tmpdir(), "fe-i18n"),
  "embedded",
);
await mkdir(output, { recursive: true });
const reportPath =
  process.env.I18N_REPORT_PATH ?? join(output, "smoke-results.json");
const results = [];
const report = { suite: "embedded", languages, status: "failed", results };
const started = performance.now();
await writeSmokeReport(reportPath, report);
const browser = await chromium.launch();
try {
  for (const language of languages) {
    const context = await browser.newContext({
      viewport: { width: 360, height: 800 },
      offline: true,
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
      const codeRequests = [];
      const errors = [];
      page.on("request", (request) => {
        if (
          ["script", "stylesheet", "font", "worker"].includes(
            request.resourceType(),
          ) &&
          !request.url().startsWith("data:")
        )
          codeRequests.push(request.url());
      });
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route("**/*", (route) =>
        route.request().isNavigationRequest()
          ? route.fulfill({ status: 200, contentType: "text/html", body: html })
          : route.abort(),
      );
      await page.goto("https://wallet.example/#/settings", {
        waitUntil: "domcontentloaded",
      });
      await page.locator("#root > *").first().waitFor();
      await page.waitForFunction(
        (language) => document.documentElement.lang === language,
        language,
      );
      const common = JSON.parse(
        await readFile(`src/locales/${language}/common.json`, "utf8"),
      );
      if (!(await page.locator("#wallet-language").count()))
        await page
          .getByRole("button", { name: common.settings, exact: true })
          .last()
          .click();
      await page.locator("#wallet-language").waitFor();
      assert.equal(
        await page.locator("#wallet-language").inputValue(),
        language,
      );
      results.push({ language, screen: "settings-language", problems: [] });
      for (const [name, label] of [
        ["transfer", common.send],
        ["accounts", common.wallets],
        ["contacts", common.contacts],
      ]) {
        await page
          .getByRole("button", { name: label, exact: true })
          .last()
          .click();
        await page.locator("[data-page-shell] h1").waitFor();
        const text = await page.locator("body").innerText();
        assert.doesNotMatch(
          text,
          /(?:common|home|settings|tokens|history|transfer|accounts|contacts|onboarding|dapps|telegram|notices|creation|nfts):[A-Za-z][\w.-]*|{{/,
        );
        await page.screenshot({
          path: join(output, `${language}-${name}-360.png`),
          fullPage: true,
          animations: "disabled",
        });
        results.push({ language, screen: name, problems: [] });
      }
      const onboarding = JSON.parse(
        await readFile(`src/locales/${language}/onboarding.json`, "utf8"),
      );
      for (const path of [
        "/create-account",
        "/import-account",
        "/add-account",
        "/terms",
        "/privacy",
        "/security",
        "/disclaimer",
        "/legal",
      ]) {
        await page.evaluate((path) => {
          for (const prefix of ["", "qrlwallet:v3:"])
            localStorage.setItem(
              `${prefix}ACTIVE_PAGE`,
              JSON.stringify({
                value: path,
                timestamp: Date.now(),
                version: "v1",
              }),
            );
          location.hash = path;
        }, path);
        await page.waitForURL(`**/#${path}`);
        const titles = {
          "/create-account": onboarding.createNew,
          "/import-account": onboarding.importTitle,
          "/add-account": onboarding.addAccounts,
          "/terms": "Terms of Use",
          "/privacy": "Privacy Policy",
          "/security": "Security and Vulnerability Disclosure Policy",
          "/disclaimer": "Disclaimer",
          "/legal": "Imprint",
        };
        await page
          .getByRole("heading", { name: titles[path], exact: true })
          .waitFor();
        const capture = async (name) => {
          const text = await page.locator("body").innerText();
          const labels = await page
            .locator("[aria-label], [title], [placeholder], [alt]")
            .evaluateAll((elements) =>
              elements.flatMap((element) =>
                ["aria-label", "title", "placeholder", "alt"].map(
                  (name) => element.getAttribute(name) ?? "",
                ),
              ),
            );
          assert.doesNotMatch(
            [text, ...labels].join("\n"),
            /(?:common|home|settings|tokens|history|transfer|accounts|contacts|onboarding|dapps|telegram|notices|creation|nfts):[A-Za-z][\w.-]*|{{/,
          );
          assert.equal(
            await page.evaluate(
              () => document.documentElement.scrollWidth > innerWidth + 1,
            ),
            false,
          );
          await page.screenshot({
            path: join(output, `${language}-${name}-360.png`),
            fullPage: true,
            animations: "disabled",
          });
          results.push({ language, screen: name, problems: [] });
        };
        if (path === "/create-account")
          await page
            .getByPlaceholder(onboarding.password, { exact: true })
            .waitFor();
        if (path === "/import-account") {
          for (const [method, label] of [
            ["mnemonic", onboarding.importMnemonic],
            ["file", onboarding.importEncrypted],
            ["hex", onboarding.importHex],
          ]) {
            await page.getByRole("tab", { name: label, exact: true }).click();
            await capture(`import-${method}`);
          }
        } else {
          if (
            [
              "/terms",
              "/privacy",
              "/security",
              "/disclaimer",
              "/legal",
            ].includes(path)
          ) {
            if (language === "en")
              assert.equal(
                await page
                  .getByText(common.englishOnly, { exact: true })
                  .count(),
                0,
              );
            else
              await page
                .getByText(common.englishOnly, { exact: true })
                .waitFor();
          }
          await capture(path.slice(1));
        }
      }
      const catalogs = Object.fromEntries(
        await Promise.all(
          [
            "dapps",
            "telegram",
            "accounts",
            "settings",
            "common",
            "creation",
            "nfts",
            "home",
            "tokens",
            "transfer",
          ].map(async (ns) => [
            ns,
            JSON.parse(
              await readFile(`src/locales/${language}/${ns}.json`, "utf8"),
            ),
          ]),
        ),
      );
      catalogs.code = language;
      const captureNew = async (name) => {
        const labels = await page
          .locator("[aria-label], [title], [placeholder], [alt]")
          .evaluateAll((elements) =>
            elements.flatMap((element) =>
              ["aria-label", "title", "placeholder", "alt"].map(
                (attribute) => element.getAttribute(attribute) ?? "",
              ),
            ),
          );
        assert.doesNotMatch(
          [await page.locator("body").innerText(), ...labels].join("\n"),
          /(?:common|home|settings|tokens|history|transfer|accounts|contacts|onboarding|dapps|telegram|notices|creation|nfts):[A-Za-z][\w.-]*|{{/,
        );
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth + 1,
          ),
          false,
        );
        await page.screenshot({
          path: join(output, `${language}-${name}-360.png`),
          fullPage: true,
          animations: "disabled",
        });
        results.push({ language, screen: name, problems: [] });
      };
      await slice4Screens({
        page,
        origin: "https://wallet.example",
        catalogs,
        address: `Q${"1".repeat(128)}`,
        embedded: true,
        full: false,
        snapshot: captureNew,
      });
      await slice6Screens({
        page,
        catalogs,
        snapshot: captureNew,
        embedded: true,
      });
      await slice5Screens({
        page,
        origin: "https://wallet.example",
        catalogs,
        snapshot: captureNew,
        address: `Q${"1".repeat(128)}`,
        output,
        embedded: true,
      });
      assert.deepEqual(codeRequests, []);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  }
  const nativeResults = await nativeStorageScreens({
    browser,
    html,
    output,
    languages,
  });
  results.push(
    ...nativeResults.map(({ language, flow, scenario }) => ({
      language,
      screen: `${flow}-${scenario}`,
      problems: [],
    })),
  );
  assertEmbeddedI18nCoverage(results, languages);
  console.log(
    `smoke-i18n-embedded: ${languages.length} languages rendered offline, zero external executable requests or page errors`,
  );
  report.status = "passed";
} finally {
  await browser.close();
  await writeSmokeReport(reportPath, {
    ...report,
    durationSeconds: (performance.now() - started) / 1000,
  });
}
