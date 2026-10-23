import assert from "node:assert/strict";
import { address, fixture, methods } from "./approval-fixtures.mjs";

/** Scroll through short synthetic reviews. The independent full visibility matrix is smoke:approvals. */
async function readReview(page, action) {
  await page.evaluate(async () => {
    const dialog = document.querySelector("[role=dialog]");
    const frame = () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
    const seen = new Set();
    for (let i = 0; i < 1000; i++) {
      const tile = [...dialog.querySelectorAll("[data-review-tile]")].find(
        (node) => !seen.has(node),
      );
      if (!tile) break;
      tile.scrollIntoView({ block: "center", inline: "nearest" });
      await frame();
      seen.add(tile);
    }
  });
  await page.getByRole("button", { name: action, exact: true }).waitFor();
  assert.equal(
    await page.getByRole("button", { name: action, exact: true }).isEnabled(),
    true,
  );
}

/** Display fixtures only. The invalid consent code fails before any relay handshake. */
export async function slice6Screens({ page, catalogs, snapshot, full = true, embedded = false }) {
  const c = catalogs.dapps;
  let id = 0;
  const clear = async () => {
    await page.evaluate(() => {
      const s = window.__APP_STORE__.dappConnectStore;
      s.pendingRequests = [];
      s.currentApproval = null;
      s.approvalModalOpen = false;
      s.clearDesktopConnect();
      s.resetTxProgress();
    });
    await page.getByRole("dialog").waitFor({ state: "hidden" });
  };
  const show = async (approval) => {
    await page.evaluate(
      ({ approval, id, address }) => {
        const { dappConnectStore: s, qrlStore } = window.__APP_STORE__;
        qrlStore.activeAccount.accountAddress = address;
        const pending = {
          ...approval,
          id,
          sessionId: "language-approval-fixture",
          timestamp: Date.now(),
        };
        s.pendingRequests = [pending];
        s.currentApproval = pending;
        s.approvalModalOpen = true;
      },
      { approval, id: ++id, address },
    );
    await page.getByRole("dialog").waitFor();
    await page.waitForTimeout(400);
  };
  for (const source of full ? ["paste", "link", "deeplink"] : ["link"]) {
    await page.evaluate(
      ({ source, address }) => {
        const { dappConnectStore, qrlStore } = window.__APP_STORE__;
        qrlStore.activeAccount.accountAddress = address;
        dappConnectStore.requestDesktopConnect(
          "qrlconnect://?q=display-fixture",
          source,
        );
      },
      { source, address },
    );
    await page
      .getByRole("heading", { name: c.consentTitle, exact: true })
      .waitFor();
    await page.waitForTimeout(400);
    await snapshot(`dapp-consent-${source}`);
    if (full && source === "paste") {
      await readReview(page, catalogs.settings.connect);
      await page
        .getByRole("button", { name: catalogs.settings.connect, exact: true })
        .click();
      await page.getByRole("alert").waitFor();
      await snapshot("dapp-consent-error");
    }
    await clear();
  }
  if (full) {
    await page.evaluate(() => {
      const { dappConnectStore, qrlStore } = window.__APP_STORE__;
      qrlStore.activeAccount.accountAddress = "";
      window.__slice6Provider = qrlStore.qrlInstance;
      window.__slice6Loading = qrlStore.qrlAccounts.isLoading;
      qrlStore.qrlInstance ??= {};
      qrlStore.qrlAccounts.isLoading = false;
      dappConnectStore.requestDesktopConnect(
        "qrlconnect://?q=display-fixture",
        "paste",
      );
    });
    await page.getByText(c.accountRequired, { exact: true }).waitFor();
    await snapshot("dapp-consent-no-account");
    await clear();
    await page.evaluate(() => {
      window.__APP_STORE__.qrlStore.qrlInstance = window.__slice6Provider;
      window.__APP_STORE__.qrlStore.qrlAccounts.isLoading =
        window.__slice6Loading;
      delete window.__slice6Provider;
      delete window.__slice6Loading;
    });
  }
  for (const method of methods.filter((method) => method !== "consent")) {
    await show(fixture(method));
    await snapshot(`approval-${method}`);
    if (full && !embedded && method === "qrl_signMessage") {
      await readReview(page, c.approve);
      await page.getByRole("button", { name: c.approve, exact: true }).click();
      await page.getByText(c.pinRequired, { exact: true }).waitFor();
      await snapshot("approval-pin-error");
    }
    if (full && method === "qrl_signTypedData") {
      await page.getByText(c.fullPayload, { exact: true }).click();
      assert(
        (await page.locator("pre").innerText()).includes('"text": "Hello"'),
      );
      await snapshot("approval-typed-canonical");
    }
    await clear();
  }
  if (!full) return;
  for (const [name, hex] of [
    ["binary", "0xff"],
    ["invisible", "0x200920"],
    ["empty", "0x"],
    ["invalid-message", "invalid"],
  ]) {
    const approval = fixture("qrl_signMessage");
    approval.params = [address, hex];
    await show(approval);
    await snapshot(`approval-${name}`);
    await clear();
  }
  for (const kind of ["no-chain", "mismatch", "invalid-typed"]) {
    const approval = fixture("qrl_signTypedData");
    if (kind === "invalid-typed") approval.params[1] = {};
    else if (kind === "mismatch") approval.params[1].domain.chainId = "1";
    else {
      approval.params[1].types.QRLDomain = [{ name: "name", type: "string" }];
      delete approval.params[1].domain.chainId;
    }
    await show(approval);
    await snapshot(`approval-${kind}`);
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
    await show(fixture("qrl_sendTransaction"));
    await page.evaluate((progress) => {
      window.__APP_STORE__.dappConnectStore.setTxProgress(
        progress,
        `0x${"ab".repeat(32)}`,
        progress === "unknown"
          ? "Transaction was broadcast, but confirmation is unavailable. Check the explorer before sending again."
          : "This transaction would fail on chain: External reason 123",
      );
    }, progress);
    await snapshot(`approval-progress-${progress}`);
    await clear();
  }
}
