import assert from "node:assert/strict";
import { assertApprovalIdentity } from "./i18n-approval-identity.mjs";
import { assertApprovalBounds } from "./i18n-approval-bounds.mjs";
import { approvalMetadataCases } from "../src/services/dappConnect/__tests__/approvalMetadataFixtures.ts";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const rawKey =
  /(?:common|home|settings|tokens|history|transfer|accounts|contacts|onboarding|dapps|telegram|notices):[A-Za-z][\w.-]*|{{/;

/** Display-only synthetic requests. No pairing handshake, signature or broadcast. */
export async function slice4Screens({
  page,
  origin,
  catalogs,
  snapshot,
  address,
  full = true,
  embedded = false,
}) {
  const c = catalogs.dapps;
  const go = async (path, title) => {
    await page.evaluate(
      ({ path, embedded }) => {
        for (const prefix of ["", "qrlwallet:v3:"])
          localStorage.setItem(
            `${prefix}ACTIVE_PAGE`,
            JSON.stringify({
              value: path,
              timestamp: Date.now(),
              version: "v1",
            }),
          );
        if (embedded) location.hash = path;
      },
      { path, embedded },
    );
    if (!embedded)
      await page.goto(`${origin}${path}`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: title, exact: true }).waitFor();
  };
  const clear = async () => {
    await page.evaluate(() => {
      const s = window.__APP_STORE__.dappConnectStore;
      s.pendingRequests = [];
      s.currentApproval = null;
      s.approvalModalOpen = false;
      s.resetTxProgress();
      s.desktopConnectUri = null;
      s.activeSessions = [];
    });
    await page.getByRole("dialog").waitFor({ state: "hidden" });
  };
  await go("/qr-view", catalogs.accounts.qrTitle);
  await snapshot("qr-view");
  await go("/telegram", catalogs.telegram.title);
  await page
    .getByText(
      embedded ? catalogs.telegram.degraded : catalogs.telegram.operational,
      { exact: true },
    )
    .waitFor();
  await snapshot("telegram");
  await go("/dapp-sessions", c.sessionsTitle);
  await page.waitForFunction(() => Boolean(window.__APP_STORE__));
  await page.evaluate((address) => {
    window.__APP_STORE__.qrlStore.activeAccount.accountAddress = address;
  }, address);
  if (full) await snapshot("dapp-sessions-empty");
  const statuses = full
    ? [
        "connected",
        "connecting",
        "key_exchange",
        "reconnecting",
        "disconnected",
      ]
    : [catalogs.code === "de" ? "reconnecting" : "connected"];
  for (const status of statuses) {
    await page.evaluate(
      ({ address, status }) => {
        window.__APP_STORE__.dappConnectStore.activeSessions = [
          {
            id: "language-fixture",
            status,
            dappInfo: {
              name: "Example dApp",
              url: "https://dapp.example",
              chainId: "0x301825",
            },
            connectedAccount: address,
            createdAt: 1700000000000,
          },
        ];
      },
      { address, status },
    );
    await snapshot(`dapp-session-${status}`);
  }
  await clear();
  // The native app's QR scan supplies pairing consent; web and desktop use this dialog.
  if (!embedded) {
    for (const source of full ? ["paste", "link", "deeplink"] : ["link"]) {
      await page.evaluate((source) => {
        const s = window.__APP_STORE__.dappConnectStore;
        s.desktopConnectUri = "qrlconnect://?q=display-fixture";
        s.desktopConnectSource = source;
      }, source);
      await page
        .getByRole("heading", { name: c.consentTitle, exact: true })
        .waitFor();
      await snapshot(`dapp-consent-${source}`);
      if (full && source === "paste") {
        // Invalid synthetic URI fails before a relay is contacted.
        await page
          .getByRole("button", { name: catalogs.settings.connect, exact: true })
          .click();
        await page.getByRole("alert").waitFor();
        await snapshot("dapp-consent-error");
      }
      await clear();
    }
  }
  const typed = (chain = true) => ({
    types: {
      QRLDomain: [
        { name: "name", type: "string" },
        ...(chain ? [{ name: "chainId", type: "uint256" }] : []),
      ],
      Challenge: [
        { name: "challengeText", type: "string" },
        { name: "accounts", type: "address[]" },
      ],
    },
    primaryType: "Challenge",
    domain: chain
      ? { name: "Example domain", chainId: "1" }
      : { name: "Example domain" },
    message: {
      challengeText: "Authenticate 123",
      accounts: [address, address, address],
    },
  });
  const tx = {
    from: address,
    to: address,
    value: "0x1",
    gas: "0x5208",
    data: "0xabcd",
    chainId: "0x301825",
  };
  const approvals = [
    ["qrl_requestAccounts", [], "connectAccount"],
    ["qrl_sendTransaction", [tx], "sendTransaction"],
    ["qrl_signTransaction", [tx], "signTransaction"],
    ["qrl_signMessage", [address, "0x68656c6c6f"], "signMessage"],
    ["qrl_signTypedData", [address, typed()], "signTypedData"],
    [
      "wallet_addQrlChain",
      [{ chainId: "0x301825", chainName: "Example network" }],
      "addNetwork",
    ],
    ["wallet_switchQrlChain", [{ chainId: "0x301825" }], "switchNetwork"],
  ];
  let id = 0;
  const show = async (
    method,
    params,
    metadata = {
      name: "Example dApp",
      url: "https://dapp.example",
      chainId: "0x301825",
    },
  ) => {
    await page.evaluate(
      ({ method, params, id, metadata }) => {
        const s = window.__APP_STORE__.dappConnectStore;
        const approval = {
          id,
          method,
          params,
          sessionId: "language-fixture",
          timestamp: Date.now(),
          dappInfo: metadata,
        };
        s.resetTxProgress();
        s.pendingRequests = [approval];
        s.currentApproval = approval;
        s.approvalModalOpen = true;
      },
      { method, params, id: ++id, metadata },
    );
    await page.getByRole("dialog").waitFor();
  };
  const approvalSnapshot = async (name, method) => {
    await snapshot(name);
    const identity = await assertApprovalIdentity(page, {
      language: catalogs.code,
      method,
    });
    console.log(
      `approval-identity: ${JSON.stringify({ screen: name, ...identity })}`,
    );
  };
  for (const [method, params, key] of approvals) {
    await show(method, params);
    await page.getByText(c[key], { exact: true }).waitFor();
    if (method.includes("Transaction"))
      await page
        .getByText(embedded ? c.feeUnavailable : c.maxFee, { exact: true })
        .waitFor();
    await approvalSnapshot(`approval-${method}`, method);
    if (method === "qrl_signTypedData") {
      await page.getByText("challengeText", { exact: true }).waitFor();
      assert.ok(
        (await page.getByRole("dialog").innerText()).includes(
          '"Authenticate 123"',
        ),
      );
      const region = page.getByRole("region", { name: c.requestDetails });
      await region.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      await approvalSnapshot("approval-typed-bottom", method);
      await page.getByText(c.fullPayload, { exact: true }).click();
      assert.ok(
        (await page.locator("pre").innerText()).includes(
          '"challengeText": "Authenticate 123"',
        ),
      );
      if (full) await approvalSnapshot("approval-typed-canonical", method);
    }
    if (full && method === "qrl_signMessage") {
      await page.getByRole("button", { name: c.approve, exact: true }).click();
      await page.getByText(c.pinRequired, { exact: true }).waitFor();
      await approvalSnapshot("approval-pin-error", method);
    }
    await clear();
  }
  for (const { name, metadata } of approvalMetadataCases) {
    for (const [method, params, key] of approvals) {
      await show(method, params, metadata);
      await page.getByText(c[key], { exact: true }).waitFor();
      if (method.includes("Transaction"))
        await page
          .getByText(embedded ? c.feeUnavailable : c.maxFee, { exact: true })
          .waitFor();
      await snapshot(`approval-${name}-${method}`);
      const bounds = await assertApprovalBounds(page, {
        language: catalogs.code,
        method,
        metadata,
        approve: c.approve,
      });
      console.log(
        `approval-bounds: ${JSON.stringify({ fixture: name, ...bounds })}`,
      );
      await clear();
    }
  }
  if (full) {
    for (const [name, method, params] of [
      ["binary", "qrl_signMessage", [address, "0xff00e280ae"]],
      ["no-chain", "qrl_signTypedData", [address, typed(false)]],
      ["invalid-message", "qrl_signMessage", [address, "invalid"]],
      ["invalid-typed", "qrl_signTypedData", [address, {}]],
    ]) {
      await show(method, params);
      await approvalSnapshot(`approval-${name}`, method);
      await clear();
    }
    for (const progress of [
      "signing",
      "broadcasting",
      "confirming",
      "confirmed",
      "failed",
      "unknown",
    ]) {
      await show("qrl_sendTransaction", [tx]);
      await page.evaluate((progress) => {
        window.__APP_STORE__.dappConnectStore.setTxProgress(
          progress,
          `0x${"ab".repeat(32)}`,
          progress === "unknown"
            ? "Transaction was broadcast, but confirmation is unavailable. Check the explorer before sending again."
            : "Insufficient funds for this transaction.",
        );
      }, progress);
      await approvalSnapshot(`approval-${progress}`, "qrl_sendTransaction");
      await clear();
    }
  }
  await go("/settings", catalogs.common.settings);
}

/** Standalone boot errors render before the wallet store is constructed. */
export async function slice4NoticeProbes({ browser, origin, output }) {
  const results = [];
  for (const language of ["en", "de", "es", "ru", "zh-CN"]) {
    const c = JSON.parse(
      await readFile(`src/locales/${language}/notices.json`, "utf8"),
    );
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
        page.on("pageerror", (error) => errors.push(error.message));
        await page.route("**/*", (route) => {
          const url = route.request().url();
          if (kind === "load-failed" && /\/App-[^/]+\.js/.test(url))
            return route.abort();
          return url.startsWith(origin) ? route.continue() : route.abort();
        });
        await page.goto(origin, { waitUntil: "networkidle" });
        await page
          .getByRole("heading", {
            name: kind === "retired" ? c.update : c.loadFailed,
            exact: true,
          })
          .waitFor();
        assert.doesNotMatch(await page.locator("body").innerText(), rawKey);
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth + 1,
          ),
          false,
        );
        assert.deepEqual(errors, []);
        await page.screenshot({
          path: join(output, `${language}-notice-${kind}-360.png`),
          fullPage: true,
        });
        results.push({ language, screen: `notice-${kind}`, problems: [] });
      } finally {
        await context.close();
      }
    }
  }
  return results;
}
