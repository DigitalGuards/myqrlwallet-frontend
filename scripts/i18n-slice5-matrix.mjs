import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { slice5Screens } from "./i18n-slice5-probes.mjs";
import { assetLayoutProbes } from "./i18n-asset-layout-probes.mjs";
import { i18nLanguages } from "./i18n-smoke-options.mjs";

export async function slice5Matrix(
  browser,
  origin,
  output,
  languages = i18nLanguages,
) {
  const results = [];
  const address = `Q${"1".repeat(128)}`;
  await mkdir(output, { recursive: true });
  for (const language of languages) {
    const catalogs = Object.fromEntries(
      await Promise.all(
        [
          "creation",
          "nfts",
          "home",
          "common",
          "settings",
          "transfer",
          "tokens",
        ].map(async (ns) => [
          ns,
          JSON.parse(
            await readFile(`src/locales/${language}/${ns}.json`, "utf8"),
          ),
        ]),
      ),
    );
    catalogs.code = language;
    const context = await browser.newContext({
      viewport: { width: 360, height: 800 },
      locale: "en-US",
      reducedMotion: "reduce",
    });
    try {
      await context.addInitScript(
        ({ address, language }) => {
          if (sessionStorage.getItem("slice5-fixture")) return;
          sessionStorage.setItem("slice5-fixture", "1");
          const save = (key, value) =>
            localStorage.setItem(
              key,
              JSON.stringify({ value, timestamp: Date.now(), version: "v1" }),
            );
          for (const prefix of ["", "qrlwallet:v3:"]) {
            localStorage.setItem(
              `${prefix}WALLET_LANGUAGE`,
              JSON.stringify(language),
            );
            save(`${prefix}WALLET_SETTINGS`, {
              showTokensCard: true,
              showNftsCard: true,
              autoLockTimeout: 900000,
            });
          }
          for (const network of ["TEST_NET", "TEST_NET_V3"]) {
            save(`${network}_QIP55_ACCOUNT_LIST`, [
              { address, source: "seed" },
            ]);
            save(`${network}_QIP55_ACTIVE_ACCOUNT`, address);
            save(`${network}_ENCRYPTED_SEEDS`, [
              {
                address,
                encryptedSeed: "invalid-ui-fixture",
                lastAccessed: Date.now(),
              },
            ]);
          }
        },
        { address, language },
      );
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route("**/*", (route) => {
        const request = route.request();
        if (request.url().startsWith(origin)) return route.continue();
        const headers = {
          "access-control-allow-origin": "*",
          "access-control-allow-headers": "*",
          "access-control-allow-methods": "*",
        };
        if (request.method() === "OPTIONS")
          return route.fulfill({ status: 204, headers });
        let body = {};
        if (request.method() === "POST" && request.url().includes("/qrl-rpc")) {
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
                  baseFeePerGas: "0x3b9aca00",
                },
                qrl_getBalance: "0xab54a98ceb1f0ad2",
                qrl_blockNumber: "0x1",
                qrl_gasPrice: "0x3b9aca00",
              }[rpc.method] ?? "0x0",
          });
          const rpc = request.postDataJSON();
          body = Array.isArray(rpc) ? rpc.map(answer) : answer(rpc);
        } else if (request.url().includes("tx-history"))
          body = { transactions: [] };
        return route.fulfill({
          status: 200,
          headers,
          contentType: "application/json",
          body: JSON.stringify(body),
        });
      });
      const snapshot = async (screen, scenario) => {
        await page.evaluate(() => document.fonts.ready);
        const copy = await page.locator("body").innerText();
        const labels = await page
          .locator("[aria-label],[title],[alt],[placeholder]")
          .evaluateAll((elements) =>
            elements.flatMap((element) =>
              ["aria-label", "title", "alt", "placeholder"].map(
                (attribute) => element.getAttribute(attribute) ?? "",
              ),
            ),
          );
        assert.doesNotMatch(
          [copy, ...labels].join("\n"),
          /(?:common|home|settings|tokens|history|transfer|accounts|contacts|onboarding|dapps|telegram|notices|creation|nfts):[A-Za-z][\w.-]*|{{/,
        );
        const problems = await page.evaluate(() => {
          const findings = [];
          if (document.documentElement.scrollWidth > innerWidth + 1)
            findings.push("Document overflows");
          for (const el of document.querySelectorAll(
            "button,a,input,select,h1,h2,[role=alert],[role=dialog]",
          )) {
            if (el.closest('[aria-hidden="true"], [hidden]')) continue;
            const r = el.getBoundingClientRect();
            if (!r.width || !r.height) continue;
            if (r.left < -1 || r.right > innerWidth + 1)
              findings.push(
                `${el.tagName} outside viewport: ${el.textContent.trim().slice(0, 60)}`,
              );
            if (el.matches("button,a")) {
              const walker = document.createTreeWalker(
                el,
                NodeFilter.SHOW_TEXT,
              );
              while (walker.nextNode()) {
                const node = walker.currentNode;
                if (
                  !node.textContent.trim() ||
                  node.parentElement.closest(".sr-only,[aria-hidden=true]")
                )
                  continue;
                const range = document.createRange();
                range.selectNodeContents(node);
                for (const text of range.getClientRects())
                  if (
                    text.width &&
                    (text.left < r.left - 2 ||
                      text.right > r.right + 2 ||
                      text.top < r.top - 2 ||
                      text.bottom > r.bottom + 2)
                  )
                    findings.push(
                      `${el.tagName} clips: ${node.textContent.trim()}`,
                    );
              }
            }
          }
          return findings;
        });
        await page.screenshot({
          path: join(output, `${language}-${screen}-360.png`),
          fullPage: true,
          animations: "disabled",
        });
        // These two screens are exercised in both the zero-balance and success
        // flows. Preserve both checks within one language/screen result.
        const previous =
          scenario &&
          results.find(
            (result) =>
              result.language === language && result.screen === screen,
          );
        if (previous) {
          assert.ok(
            !previous.scenarios.includes(scenario),
            "Duplicate scenario",
          );
          previous.scenarios.push(scenario);
          previous.problems.push(...problems);
        } else {
          results.push({
            language,
            screen,
            problems,
            ...(scenario ? { scenarios: [scenario] } : {}),
          });
        }
        if (problems.length)
          console.error(`${language}/${screen}: ${problems.join("; ")}`);
        assert.deepEqual(errors, [], `${language}/${screen}: browser errors`);
        await assetLayoutProbes({ page, screen, catalogs, output });
      };
      await page.goto(origin, { waitUntil: "networkidle" });
      await page.locator("[data-page-shell] h1").waitFor();
      try {
        await slice5Screens({
          page,
          origin,
          catalogs,
          snapshot,
          address,
          output,
        });
      } catch (error) {
        await page.screenshot({
          path: join(output, `${language}-failure.png`),
          fullPage: true,
        });
        await writeFile(
          join(output, `${language}-failure.txt`),
          await page.locator("body").innerText(),
        );
        throw error;
      }
    } finally {
      await writeFile(
        join(output, "slice5-layout-results.json"),
        JSON.stringify(results, null, 2),
      );
      await context.close();
    }
  }
  return results;
}
