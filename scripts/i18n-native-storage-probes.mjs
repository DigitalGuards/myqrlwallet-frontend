import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Public deterministic fixture only. Never fund this account.
const hexSeed = `0x010000${"12".repeat(48)}`;
const address = `Q${"1".repeat(128)}`;
const network = {
  bridgeVersion: 1,
  addressScheme: "qip55-64",
  networkProfile: "v3-private",
  chainId: "0x301825",
  genesisHash:
    "0xd15407991193e6c23b733dc6bf9c628deaff8f9b6e252aa0d60030952b3e3ea4",
};
const format = (template, reason) => template.replace("{{reason}}", reason);

export async function nativeStorageScreens({ browser, html, output }) {
  const results = [];
  for (const language of ["en", "de", "es", "ru", "zh-CN"]) {
    const c = JSON.parse(
      await readFile(`src/locales/${language}/onboarding.json`, "utf8"),
    );
    const common = JSON.parse(
      await readFile(`src/locales/${language}/common.json`, "utf8"),
    );
    for (const flow of ["create", "import"]) {
      const path = flow === "create" ? "/create-account" : "/import-account";
      const context = await browser.newContext({
        viewport: { width: 360, height: 800 },
        userAgent: "MyQRLWallet language test",
        offline: true,
      });
      try {
        await context.addInitScript(
          ({ language, path, network }) => {
            for (const prefix of ["", "qrlwallet:v3:"]) {
              localStorage.setItem(
                `${prefix}WALLET_LANGUAGE`,
                JSON.stringify(language),
              );
              localStorage.setItem(
                `${prefix}ACTIVE_PAGE`,
                JSON.stringify({
                  value: path,
                  timestamp: Date.now(),
                  version: "v1",
                }),
              );
            }
            window.__nativeStorageTest = {
              respond: false,
              requests: [],
              languages: [],
            };
            window.ReactNativeWebView = {
              injectedObjectJson: () =>
                JSON.stringify({ qrlWalletCapabilities: network }),
              postMessage(raw) {
                const message = JSON.parse(raw);
                if (message.type === "LANGUAGE_CHANGED")
                  window.__nativeStorageTest.languages.push(message);
                if (
                  !["DEVICE_CREDENTIAL_REQUEST", "SEED_STORED"].includes(
                    message.type,
                  )
                )
                  return;
                const state = window.__nativeStorageTest;
                state.requests.push({ ...message, at: performance.now() });
                if (!state.respond) return;
                const payload = {
                  documentId: message.payload.documentId,
                  requestId: message.payload.requestId,
                };
                const detail =
                  message.type === "DEVICE_CREDENTIAL_REQUEST"
                    ? {
                        type: "DEVICE_CREDENTIAL_RESPONSE",
                        payload: {
                          ...payload,
                          credential: message.payload.candidate,
                        },
                      }
                    : {
                        type: "SEED_STORED_RESPONSE",
                        payload: { ...payload, success: false },
                      };
                setTimeout(
                  () =>
                    window.dispatchEvent(
                      new CustomEvent("nativeMessage", { detail }),
                    ),
                  0,
                );
              },
            };
          },
          { language, path, network },
        );
        const page = await context.newPage();
        const errors = [];
        const codeRequests = [];
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("request", (request) => {
          if (
            ["script", "stylesheet", "font", "worker"].includes(
              request.resourceType(),
            ) &&
            !/^(data:|blob:)/.test(request.url())
          )
            codeRequests.push(request.url());
        });
        await page.route("**/*", (route) => {
          const request = route.request();
          if (request.isNavigationRequest())
            return route.fulfill({
              status: 200,
              contentType: "text/html",
              body: html,
            });
          const headers = {
            "access-control-allow-origin": "*",
            "access-control-allow-headers": "*",
            "access-control-allow-methods": "*",
          };
          if (request.method() === "OPTIONS")
            return route.fulfill({ status: 204, headers });
          if (
            request.method() === "POST" &&
            request.url().includes("qrl-rpc")
          ) {
            const reply = ({ id, method }) => ({
              jsonrpc: "2.0",
              id,
              result:
                {
                  net_listening: true,
                  net_version: String(Number(network.chainId)),
                  qrl_chainId: network.chainId,
                  qrl_getBlockByNumber: {
                    hash: network.genesisHash,
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
          return route.abort();
        });
        await page.goto(`https://wallet.example/#${path}`, {
          waitUntil: "domcontentloaded",
        });
        if (flow === "create") {
          await page
            .getByPlaceholder(c.password, { exact: true })
            .fill("Password1!");
          await page
            .getByPlaceholder(c.passwordRepeat, { exact: true })
            .fill("Password1!");
          await page.evaluate(
            ({ address, hexSeed }) => {
              window.__APP_STORE__.qrlStore.qrlInstance.accounts.create =
                () => ({ address, seed: hexSeed });
            },
            { address, hexSeed },
          );
        } else {
          await page
            .getByRole("tab", { name: c.importHex, exact: true })
            .click();
          await page
            .getByPlaceholder(c.hexPlaceholder, { exact: true })
            .fill(hexSeed);
          await page
            .getByRole("button", { name: c.importTitle, exact: true })
            .click();
        }
        const pinLabel = (position) =>
          common.pinDigit.replace("{{position}}", String(position));
        for (let position = 1; position <= 6; position++)
          for (let group = 0; group < 2; group++)
            await page
              .getByLabel(pinLabel(position), { exact: true })
              .nth(group)
              .fill(String(position));
        const submit = page.getByRole("button", {
          name: flow === "create" ? c.create : c.setPin,
          exact: true,
        });
        const suffix = flow === "create" ? c.createFailed : c.setupFailed;
        const inventory = () =>
          page.evaluate(() =>
            Object.fromEntries(
              Object.entries(localStorage).filter(([key]) =>
                /ENCRYPTED_SEEDS|QIP55_ACTIVE_ACCOUNT/.test(key),
              ),
            ),
          );
        await submit.click();
        const timeoutText = format(
          suffix,
          format(c.cryptoErrorReason, c.nativeStorageUnconfirmed),
        );
        const timeout = page.getByText(timeoutText, { exact: true });
        await timeout.waitFor();
        assert.deepEqual(await inventory(), {});
        const elapsed = await page.evaluate(
          () => performance.now() - window.__nativeStorageTest.requests[0].at,
        );
        assert.ok(
          elapsed >= 3000,
          "Credential timeout must retain its three-second deadline",
        );
        const capture = async (scenario, displayed) => {
          assert.equal(
            await page.evaluate(
              () => document.documentElement.scrollWidth > innerWidth + 1,
            ),
            false,
          );
          await displayed.scrollIntoViewIfNeeded();
          await page.screenshot({
            path: join(output, `${language}-${flow}-${scenario}-360.png`),
            fullPage: true,
          });
          results.push({
            language,
            flow,
            scenario,
            displayed: await displayed.innerText(),
          });
        };
        await capture("credential-timeout", timeout);
        assert.deepEqual(
          await page.evaluate(() =>
            window.__nativeStorageTest.requests.map(({ type }) => type),
          ),
          ["DEVICE_CREDENTIAL_REQUEST"],
        );
        // Retry the same form after a timeout; native now confirms the device
        // credential and rejects the seed backup, exactly as in the review.
        await page.evaluate(() => {
          window.__nativeStorageTest.respond = true;
        });
        await page.getByLabel(pinLabel(6), { exact: true }).nth(1).fill("5");
        await page.getByLabel(pinLabel(6), { exact: true }).nth(1).fill("6");
        await submit.click();
        const backup = page.getByText(
          format(suffix, format(c.errorReason, c.nativeSeedBackupFailed)),
          { exact: true },
        );
        await backup.waitFor();
        await capture("backup-failure", backup);
        const requests = await page.evaluate(
          () => window.__nativeStorageTest.requests,
        );
        assert.deepEqual(
          requests.map(({ type }) => type),
          [
            "DEVICE_CREDENTIAL_REQUEST",
            "DEVICE_CREDENTIAL_REQUEST",
            "SEED_STORED",
          ],
        );
        const stored = Object.entries(await inventory());
        assert.equal(
          stored.length,
          1,
          "Failed backup keeps the local encrypted seed without activating the account",
        );
        assert.match(stored[0][0], /ENCRYPTED_SEEDS/);
        const seeds = JSON.parse(stored[0][1]).value;
        assert.equal(seeds.length, 1);
        assert.equal(seeds[0].encryptedSeed, requests[2].payload.encryptedSeed);
        assert.equal(seeds[0].revision, requests[2].payload.revision);
        assert.equal(JSON.parse(seeds[0].encryptedSeed).version, "pin_v5");
        assert.deepEqual(codeRequests, []);
        const languageMessages = await page.evaluate(
          () => window.__nativeStorageTest.languages,
        );
        assert.equal(languageMessages.length, 1, "one startup language signal");
        assert.equal(languageMessages[0].type, "LANGUAGE_CHANGED");
        assert.equal(languageMessages[0].payload.language, language);
        assert.equal(typeof languageMessages[0].payload.documentId, "string");
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    }
  }
  await writeFile(
    join(output, "native-storage-results.json"),
    JSON.stringify(results, null, 2) + "\n",
  );
  console.log(
    "native-storage: creation and import timeout/backup failures passed in 5 languages",
  );
}
