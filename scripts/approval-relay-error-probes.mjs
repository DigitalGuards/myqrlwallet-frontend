import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";
import { address, consentURI, rpcAnswer } from "./approval-fixtures.mjs";

// Review reproductions through the actual SocketClient, service, store and modal.
// Only network responses and the synthetic active account are supplied here.
export async function relayErrorProbes({ origin, language, output }) {
  const settings = JSON.parse(
    await readFile(`src/locales/${language}/settings.json`, "utf8"),
  );
  const prefix = "Message signing failed: ";
  const diagnostic =
    "Invalid input: expected relay authorization token, received diagnostic-id-17";
  const recursive = prefix.repeat(12000) + "external relay error";
  const connectErrors = {
    collision: diagnostic,
    recursive,
    "pin-collision": "Incorrect PIN. 4 attempts remaining.",
    "wrapper-collision": "Message signing failed: upstream authorization-id-17",
  };
  const results = [];
  const browser = await chromium.launch();
  try {
    for (const kind of [
      "collision",
      "recursive",
      "pin-collision",
      "wrapper-collision",
      "join-collision",
      "join-timeout",
      "malformed-join",
    ]) {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
      });
      try {
        const page = await context.newPage();
        page.setDefaultTimeout(20000);
        const errors = [];
        let namespaceConnections = 0;
        let joins = 0;
        page.on("pageerror", (error) => errors.push(error.message));
        await page.route("**/*", async (route) => {
          const request = route.request();
          if (new URL(request.url()).origin === origin) return route.continue();
          const headers = {
            "access-control-allow-origin": "*",
            "access-control-allow-headers": "*",
            "access-control-allow-methods": "*",
          };
          if (request.method() === "OPTIONS")
            return route.fulfill({ status: 204, headers });
          if (
            request.method() === "POST" &&
            request.url().includes("/qrl-rpc")
          ) {
            const body = request.postDataJSON();
            const reply = (rpc) => ({
              jsonrpc: "2.0",
              id: rpc.id,
              result: rpcAnswer(rpc.method),
            });
            return route.fulfill({
              headers,
              contentType: "application/json",
              body: JSON.stringify(
                Array.isArray(body) ? body.map(reply) : reply(body),
              ),
            });
          }
          return route.fulfill({
            headers,
            contentType: "application/json",
            body: "{}",
          });
        });
        await page.routeWebSocket("**/*", (ws) => {
          assert(new URL(ws.url()).pathname.startsWith("/relay/"));
          ws.onMessage((message) => {
            const packet = String(message);
            if (packet === "40") {
              namespaceConnections++;
              if (Object.hasOwn(connectErrors, kind))
                ws.send(
                  "44" +
                    JSON.stringify({
                      message: connectErrors[kind],
                    }),
                );
              else ws.send('40{"sid":"namespace-fixture"}');
            }
            if (packet.startsWith("42")) {
              joins++;
              const id = /^42(\d+)/.exec(packet)?.[1];
              assert(id !== undefined);
              if (kind === "malformed-join")
                ws.send("43" + id + '[{"success":false}]');
              if (kind === "join-collision")
                ws.send("43" + id + '[{"success":false,"error":"No active account"}]');
            }
          });
          ws.send(
            '0{"sid":"engine-fixture","upgrades":[],"pingInterval":25000,"pingTimeout":20000,"maxPayload":1000000}',
          );
        });
        await context.addInitScript((language) => {
          for (const prefix of ["", "qrlwallet:v3:"])
            localStorage.setItem(
              `${prefix}WALLET_LANGUAGE`,
              JSON.stringify(language),
            );
        }, language);
        await page.goto(origin);
        await page.waitForFunction(
          (language) =>
            document.documentElement.lang === language &&
            Boolean(window.__APP_STORE__),
          language,
        );
        await page.waitForFunction(
          () =>
            Boolean(window.__APP_STORE__.qrlStore.qrlInstance) &&
            !window.__APP_STORE__.qrlStore.qrlAccounts.isLoading,
        );
        await page.waitForTimeout(500);
        await page.evaluate(
          ({ uri, address }) => {
            const { dappConnectStore, qrlStore } = window.__APP_STORE__;
            qrlStore.activeAccount.accountAddress = address;
            dappConnectStore.requestDesktopConnect(uri, "paste");
          },
          { uri: consentURI(false), address },
        );
        await page.getByRole("dialog").waitFor();
        await page.evaluate(() => document.fonts.ready);
        // Match the review reproduction: let the modal finish its opening
        // transition before scrolling painted tiles through the visibility gate.
        await page.waitForTimeout(500);
        await page.waitForFunction(() =>
          document.querySelector("[data-review-tile]"),
        );
        await page.evaluate(async () => {
          const seen = new Set();
          for (let i = 0; i < 2000; i++) {
            const tile = [
              ...document.querySelectorAll("[role=dialog] [data-review-tile]"),
            ].find((node) => !seen.has(node));
            if (!tile) break;
            tile.scrollIntoView({ block: "center", inline: "nearest" });
            await new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            );
            seen.add(tile);
          }
        });
        await page.screenshot({
          path: join(output, `relay-${kind}-before.png`),
        });
        await page
          .getByRole("button", { name: settings.connect, exact: true })
          .click();
        await page.getByRole("alert").waitFor();
        const displayed = await page.getByRole("alert").textContent();
        const expected =
          Object.hasOwn(connectErrors, kind)
            ? connectErrors[kind]
            : kind === "join-collision"
              ? "No active account"
              : kind === "join-timeout"
                ? "Relay join acknowledgement timeout"
                : "Failed to join channel";
        // A boolean assertion keeps a failing long-message report bounded.
        assert(
          displayed === expected,
          `${language}/${kind}: error bytes changed`,
        );
        assert.equal(await page.getByRole("dialog").count(), 1);
        assert.equal(
          await page
            .getByText("Unexpected Application Error!", { exact: true })
            .count(),
          0,
        );
        assert(namespaceConnections > 0);
        assert.equal(
          joins > 0,
          kind === "join-timeout" || kind === "malformed-join" || kind === "join-collision",
        );
        assert.deepEqual(errors, []);
        await page.screenshot({ path: join(output, `relay-${kind}.png`) });
        results.push({
          language,
          kind,
          exact: true,
          length: displayed.length,
          namespaceConnections,
          joins,
        });
      } finally {
        await context.close();
      }
    }
    await writeFile(
      join(output, "relay-errors.json"),
      JSON.stringify(results, null, 2),
    );
    console.log(
      `approval-relay-errors: ${language}, ${results.length} real connection paths passed`,
    );
    return results;
  } finally {
    await browser.close();
  }
}
