import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const address = `Q${"1".repeat(128)}`;
const setupWeb =
  "You are connected to the blockchain. Create a new account, import an existing account, or connect a wallet you already use: your browser extension or the MyQRLWallet mobile app.";
const catalogKey =
  /(?:common|home|settings|tokens|history|transfer|accounts|contacts):[A-Za-z][\w.-]*/;

/** Exercise real routes, including the shared navigation in unconverted pages. */
export async function helperRouteProbes(browser, origin) {
  const routerSource = await readFile("src/router/router.tsx", "utf8");
  const routes = [...routerSource.matchAll(/^  (\w+): "(\/[^"]*)",$/gm)]
    // Telegram has its own layout, with no consumers of the converted helpers.
    .filter(([, name]) => name !== "TELEGRAM")
    .map(([, , path]) =>
      path.replace(":contractAddress", address).replace(":tokenId", "1"),
    );
  assert.ok(
    routes.includes("/add-account") && routes.includes("/account-list"),
  );
  const records = [];
  for (const width of [390, 1280]) {
    for (const active of [false, true]) {
      for (const path of active
        ? routes
        : [
            "/",
            "/add-account",
            "/account-list",
            "/transfer",
            "/tx-history",
            "/address-book",
          ]) {
        const context = await browser.newContext({
          locale: "en-US",
          viewport: { width, height: 844 },
          reducedMotion: "reduce",
        });
        try {
          await context.addInitScript(
            ({ address, active, path }) => {
              const save = (key, value) =>
                localStorage.setItem(
                  key,
                  JSON.stringify({
                    value,
                    timestamp: Date.now(),
                    version: "v1",
                  }),
                );
              for (const prefix of ["", "qrlwallet:v3:"]) {
                localStorage.setItem(`${prefix}WALLET_LANGUAGE`, '"en"');
                save(`${prefix}ACTIVE_PAGE`, path);
              }
              if (active) {
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
              }
            },
            { address, active, path },
          );
          const page = await context.newPage();
          page.setDefaultTimeout(10000);
          const errors = [];
          page.on("pageerror", (error) => errors.push(error.message));
          await page.route("**/*", async (route) => {
            const request = route.request();
            if (request.url().startsWith(`${origin}/`)) return route.continue();
            const headers = {
              "access-control-allow-origin": "*",
              "access-control-allow-headers": "*",
              "access-control-allow-methods": "*",
            };
            if (request.method() === "OPTIONS")
              return route.fulfill({ status: 204, headers });
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
            let body = {};
            if (
              request.method() === "POST" &&
              request.url().includes("/qrl-rpc")
            ) {
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
          await page.goto(`${origin}${path}`, { waitUntil: "networkidle" });
          await page.locator("[data-page-shell] h1").waitFor();
          assert.equal(
            new URL(page.url()).pathname,
            path,
            "Requested route must render",
          );
          assert.equal(await page.locator("html").getAttribute("lang"), "en");
          if (["/", "/add-account", "/account-list"].includes(path)) {
            if (!active || path !== "/") {
              await page
                .getByRole("link", {
                  name: "Create a new account",
                  exact: true,
                })
                .waitFor();
            } else
              await page
                .getByRole("heading", { name: "Active account", exact: true })
                .waitFor();
          }
          const visible = await page.locator("body").innerText();
          const name = `${path}, ${active ? "active" : "empty"}, ${width}px`;
          const labels = await page
            .locator("[aria-label], [title], [alt], [placeholder]")
            .evaluateAll((elements) =>
              elements.flatMap((element) =>
                ["aria-label", "title", "alt", "placeholder"].map(
                  (attribute) => element.getAttribute(attribute) ?? "",
                ),
              ),
            );
          assert.doesNotMatch(
            [visible, ...labels].join("\n"),
            catalogKey,
            name,
          );
          if (
            (!active && ["/", "/account-list"].includes(path)) ||
            path === "/add-account"
          ) {
            assert.equal(
              await page
                .locator("[data-page-shell] header p")
                .first()
                .innerText(),
              setupWeb,
              name,
            );
          }
          if (active && path === "/account-list")
            assert.ok(visible.includes(setupWeb), name);
          // These map values have no namespace, so also check their translated labels.
          for (const label of ["Send", "Wallets", "Contacts", "Settings"]) {
            assert.ok(
              visible.includes(label),
              `${name}: missing navigation label ${label}`,
            );
          }
          assert.deepEqual(errors, [], name);
          records.push({ path, active, width });
        } finally {
          await context.close();
        }
      }
    }
  }
  console.log(
    `i18n helper routes: ${records.length} English route states passed, with no visible catalog keys`,
  );
}
