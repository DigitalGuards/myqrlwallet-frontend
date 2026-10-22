import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { chromium } from "playwright";

const html = await readFile("dist-embedded/index.html", "utf8");
const browser = await chromium.launch();
try {
  for (const language of ["en", "de", "es", "ru", "zh-CN"]) {
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
      assert.deepEqual(codeRequests, []);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  }
  console.log(
    "smoke-i18n-embedded: 5 languages rendered offline, zero external executable requests or page errors",
  );
} finally {
  await browser.close();
}
