import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** Reproduce missing translation chunks against the production bundle. */
export async function bootNoticeFailureProbes({ browser, origin, output }) {
  const english = JSON.parse(
    await readFile("src/locales/en/notices.json", "utf8"),
  );
  const results = [];
  for (const language of ["en", "de", "es", "ru", "zh-CN"]) {
    const translated = JSON.parse(
      await readFile(`src/locales/${language}/notices.json`, "utf8"),
    );
    for (const failure of language === "en"
      ? ["reviewer", "translation-runtime"]
      : ["translation-runtime", "catalog"]) {
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
          const missing = [];
          page.on("pageerror", (error) => errors.push(error.message));
          await page.route("**/*", async (route) => {
            const url = route.request().url();
            if (!url.startsWith(`${origin}/`)) return route.abort();
            if (kind === "load-failed" && /\/App-[^/]+\.js$/.test(url))
              return route.fulfill({
                status: 404,
                body: "Missing wallet chunk",
              });
            if (
              (failure === "reviewer" &&
                /\/useTranslation-[^/]+\.js$/.test(url)) ||
              (failure === "translation-runtime" &&
                /\/(?:useTranslation|i18n)-[^/]+\.js$/.test(url))
            ) {
              missing.push(url);
              return route.fulfill({
                status: 404,
                body: "Missing translation chunk",
              });
            }
            if (
              failure === "catalog" &&
              route.request().resourceType() === "script"
            ) {
              const response = await route.fetch();
              const body = await response.text();
              if (
                body.includes(JSON.stringify(translated.retired).slice(1, -1))
              ) {
                missing.push(url);
                return route.fulfill({
                  status: 404,
                  body: "Missing language catalog",
                });
              }
              return route.fulfill({ response });
            }
            return route.continue();
          });
          await page.goto(origin, { waitUntil: "networkidle" });
          await page
            .getByRole("heading", {
              name: kind === "retired" ? english.update : english.loadFailed,
              exact: true,
            })
            .waitFor({ timeout: 5000 });
          assert.ok(
            failure === "reviewer" || missing.length > 0,
            `${language}/${kind}/${failure}: the 404 probe must intercept a translation chunk`,
          );
          assert.deepEqual(
            errors,
            [],
            `${language}/${kind}/${failure}: uncaught errors`,
          );
          if (kind === "retired") {
            assert.ok(
              (await page.locator("body").innerText()).includes(
                english.retired,
              ),
            );
            assert.equal(
              await page
                .getByRole("link", { name: "Google Play", exact: true })
                .getAttribute("href"),
              "https://play.google.com/store/apps/details?id=com.chiefdg.myqrlwallet",
            );
            assert.equal(
              await page
                .getByRole("link", { name: "myqrlwallet.com", exact: true })
                .getAttribute("href"),
              "https://myqrlwallet.com",
            );
            assert.equal(
              await page.evaluate(() => Boolean(window.__APP_STORE__)),
              false,
            );
          } else {
            assert.ok(
              (await page.locator("body").innerText()).includes(english.reload),
            );
          }
          const screen = `notice-${kind}-${failure}-404`;
          if (output)
            await page.screenshot({
              path: join(output, `${language}-${screen}-360.png`),
            });
          results.push({ language, screen, problems: [] });
        } finally {
          await context.close();
        }
      }
    }
  }
  return results;
}
