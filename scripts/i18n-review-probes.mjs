import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

/** Production-build regressions for the first language-support review. */
export async function reviewProbes(browser, origin) {
  async function visit(language, mode = "normal", key = "WALLET_SETTINGS") {
    const context = await browser.newContext({ locale: "de-DE" });
    await context.addInitScript(
      ({ language, key }) => {
        for (const prefix of ["", "qrlwallet:v3:"]) {
          localStorage.setItem(
            `${prefix}${key}`,
            JSON.stringify(
              key === "WALLET_SETTINGS"
                ? { value: { language }, timestamp: Date.now(), version: "v1" }
                : language,
            ),
          );
        }
      },
      { language, key },
    );
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    let downloads = 0;
    let rejectDownloads = mode === "reject";
    let release;
    let observed;
    const held = new Promise((resolve) => {
      observed = resolve;
    });
    const ready = new Promise((resolve) => {
      release = resolve;
    });
    await page.route("**/*", async (route) => {
      const request = route.request();
      const url = request.url();
      if (url.startsWith(origin)) {
        if (/\/assets\/de-[^/?]+\.js(?:\?.*)?$/.test(url)) {
          downloads++;
          observed();
          if (mode === "hold") await ready;
          if (rejectDownloads) return route.abort("failed");
        }
        return route.continue();
      }
      // Keep the review fixture independent of live services.
      return route.fulfill({
        status: 200,
        headers: { "access-control-allow-origin": "*" },
        contentType: "application/json",
        body: "{}",
      });
    });
    await page.goto(origin, { waitUntil: "domcontentloaded" });
    return {
      context,
      page,
      held,
      release,
      errors,
      allowRetry: () => {
        rejectDownloads = false;
      },
      downloads: () => downloads,
    };
  }

  for (const key of ["WALLET_SETTINGS", "WALLET_LANGUAGE"]) {
    for (const invalid of ["unsupported-language", {}, null, 42]) {
      const view = await visit(invalid, "normal", key);
      try {
        await view.page.waitForFunction(
          () => Boolean(document.querySelector("#root")?.textContent?.trim()),
          undefined,
          { timeout: 1500 },
        );
        await view.page.waitForFunction(
          () =>
            localStorage.getItem("WALLET_LANGUAGE") === '"en"' ||
            localStorage.getItem("qrlwallet:v3:WALLET_LANGUAGE") === '"en"',
        );
        assert.equal(
          await view.page.locator("html").getAttribute("lang"),
          "en",
          "Corrupt preference must become English",
        );
        assert.ok((await view.page.locator("#root").innerText()).length > 0);
        assert.deepEqual(view.errors, []);
      } finally {
        await view.context.close();
      }
    }
  }

  for (const outcome of ["before-timeout", "timeout", "reject"]) {
    const view = await visit("de", outcome === "reject" ? "reject" : "hold");
    try {
      await view.held;
      await view.page.locator("#root > *").first().waitFor({ timeout: 1500 });
      await view.page.waitForFunction(
        () => Boolean(document.querySelector("#root")?.textContent?.trim()),
        undefined,
        { timeout: 1500 },
      );
      assert.ok(
        (await view.page.locator("#root").innerText()).length > 0,
        "Catalog download must never empty the root",
      );
      assert.equal(await view.page.locator("html").getAttribute("lang"), "en");
      if (outcome === "before-timeout") {
        view.release();
        await view.page.waitForFunction(
          () => document.documentElement.lang === "de",
        );
      } else {
        await delay(3500);
        assert.equal(
          await view.page.locator("html").getAttribute("lang"),
          "en",
        );
        assert.equal(
          await view.page.evaluate(
            () =>
              localStorage.getItem("WALLET_LANGUAGE") ??
              localStorage.getItem("qrlwallet:v3:WALLET_LANGUAGE"),
          ),
          '"de"',
        );
        view.release();
        await delay(250);
        assert.equal(
          await view.page.locator("html").getAttribute("lang"),
          "en",
          "Late catalog must leave English active",
        );
        view.allowRetry();
        const previousDownloads = view.downloads();
        const documentId = await view.page.evaluate(() => {
          window.i18nRetryDocument = Math.random();
          return window.i18nRetryDocument;
        });
        await view.page
          .getByRole("button", { name: "Settings", exact: true })
          .last()
          .click();
        await view.page.locator("#wallet-language").selectOption("de");
        await view.page.waitForFunction(
          () => document.documentElement.lang === "de",
        );
        assert.equal(
          await view.page.evaluate(() => window.i18nRetryDocument),
          documentId,
        );
        assert.ok(
          view.downloads() > previousDownloads,
          "Retry must request the catalog again",
        );
        assert.equal(
          await view.page.locator("#wallet-language").isEnabled(),
          true,
        );
        await view.page.reload({ waitUntil: "domcontentloaded" });
        await view.page.waitForFunction(
          () => document.documentElement.lang === "de",
        );
      }
      assert.deepEqual(view.errors, []);
    } finally {
      view.release();
      await view.context.close();
    }
  }
  console.log(
    "i18n review probes: 8 corrupt preferences, immediate rendering, held/rejected/timed-out catalogs, late completion and retry passed",
  );
}
