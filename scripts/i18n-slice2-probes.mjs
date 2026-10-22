import assert from "node:assert/strict";

/** Synthetic display states only: this probe never unlocks a seed or sends a transaction. */
export async function slice2Screens({
  page,
  origin,
  catalogs,
  snapshot,
  address,
  full = true,
}) {
  const recipient = `Q${"2".repeat(128)}`;
  const hash = `0x${"a".repeat(64)}`;
  const go = async (path) => {
    await page.evaluate((path) => {
      for (const prefix of ["", "qrlwallet:v3:"])
        localStorage.setItem(
          `${prefix}ACTIVE_PAGE`,
          JSON.stringify({ value: path, timestamp: Date.now(), version: "v1" }),
        );
    }, path);
    await page.goto(`${origin}${path}`, { waitUntil: "networkidle" });
    await page.locator("[data-page-shell] h1").waitFor();
  };
  const click = (name) =>
    page.getByRole("button", { name, exact: true }).click();
  if (!full) {
    await go("/address-book");
    await snapshot("contacts-empty");
    await click(catalogs.contacts.add);
    await snapshot("contacts-add");
    await click(catalogs.common.cancel);
    await go("/account-list");
    await snapshot("accounts");
    await page
      .getByRole("button", { name: catalogs.accounts.showQr, exact: true })
      .first()
      .click();
    await snapshot("accounts-qr");
    await click(catalogs.common.close);
    await go("/transfer");
    await snapshot("transfer");
    await page
      .getByPlaceholder(catalogs.transfer.enterAmount, { exact: true })
      .fill("0");
    await page
      .getByText(catalogs.transfer.positiveAmount, { exact: true })
      .waitFor();
    await snapshot("transfer-error");
    await go("/tx-history");
    await snapshot("history-full-empty");
    await go("/settings");
    return;
  }
  await go("/address-book");
  await snapshot("contacts-empty");
  await click(catalogs.contacts.add);
  await snapshot("contacts-add");
  await click(catalogs.contacts.save);
  await page
    .getByText(catalogs.contacts.nameRequired, { exact: true })
    .waitFor();
  await snapshot("contacts-error");
  await page.locator("#ab-name").fill("Savings");
  await page.locator("#ab-address").fill(recipient);
  await click(catalogs.contacts.save);
  await page.getByText("Savings", { exact: true }).waitFor();
  await snapshot("contacts");
  await page.getByTitle(catalogs.contacts.rename, { exact: true }).click();
  await snapshot("contacts-rename");
  await click(catalogs.common.cancel);
  await page.getByTitle(catalogs.contacts.delete, { exact: true }).click();
  await snapshot("contacts-delete");
  await click(catalogs.common.cancel);

  await go("/account-list");
  await snapshot("accounts");
  await page
    .getByRole("button", { name: catalogs.accounts.showQr, exact: true })
    .first()
    .click();
  await snapshot("accounts-qr");
  await click(catalogs.common.close);

  await go("/transfer");
  await snapshot("transfer");
  await page
    .getByRole("button", {
      name: catalogs.transfer.send.replace("{{asset}}", "Quanta"),
      exact: true,
    })
    .scrollIntoViewIfNeeded();
  await snapshot("transfer-form-bottom");
  await page.getByTitle(catalogs.transfer.addressBook, { exact: true }).click();
  await snapshot("transfer-contacts");
  await page.getByRole("button", { name: /Savings/ }).click();
  await page
    .getByPlaceholder(catalogs.transfer.enterAmount, { exact: true })
    .fill("0");
  await page
    .getByText(catalogs.transfer.positiveAmount, { exact: true })
    .waitFor();
  await snapshot("transfer-error");
  await page
    .getByPlaceholder(catalogs.transfer.enterAmount, { exact: true })
    .fill("1");
  await snapshot("transfer-recipient");
  for (const [state, signer] of [
    ["preparing", "seed"],
    ["awaiting-approval", "mobile"],
    ["awaiting-approval", "extension"],
    ["awaiting-approval", "desktop"],
    ["pending", "seed"],
    ["timeout", "seed"],
    ["rejected", "seed"],
    ["failed", "seed"],
    ["confirmed", "seed"],
  ]) {
    await page.evaluate(
      ({ state, signer, address, recipient, hash }) => {
        const store = window.__APP_STORE__;
        if (!store) throw new Error("Missing fixture store");
        store.qrlStore.transactionStatus = {
          state,
          txHash: ["pending", "timeout", "confirmed"].includes(state)
            ? hash
            : null,
          receipt:
            state === "confirmed"
              ? {
                  transactionHash: hash,
                  blockHash: `0x${"b".repeat(64)}`,
                  blockNumber: 42n,
                  gasUsed: 21000n,
                  effectiveGasPrice: 100n,
                  status: 1n,
                }
              : null,
          error:
            state === "rejected"
              ? "The approval request was cancelled."
              : state === "timeout"
                ? "Still waiting for confirmation after 5 minutes. Check History or the explorer before sending again."
                : state === "failed"
                  ? "Transaction execution failed. The transfer was reverted."
                  : null,
          details: {
            from: address,
            to: recipient,
            amount: "1.234567",
            asset: "Quanta",
            blockchain: store.qrlStore.qrlConnection.blockchain,
            signer,
          },
        };
      },
      { state, signer, address, recipient, hash },
    );
    await snapshot(`transfer-${state}-${signer}`);
  }
  await page.evaluate(() =>
    window.__APP_STORE__.qrlStore.resetTransactionStatus(),
  );

  let historyState = "rows";
  await page.route("**/tx-history", (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    return route.fulfill({
      status: historyState === "error" ? 501 : 200,
      headers: { "access-control-allow-origin": "*" },
      contentType: "application/json",
      body: JSON.stringify({
        transactions:
          historyState === "rows"
            ? [
                {
                  ID: "1",
                  InOut: 0,
                  TxType: "0x2",
                  Address: address,
                  From: address,
                  To: recipient,
                  TxHash: hash,
                  TimeStamp: "0x42",
                  Amount: "1.234567",
                  PaidFees: "0.000021",
                  BlockNumber: "0x42",
                  Status: "0x1",
                },
              ]
            : [],
      }),
    });
  });
  await go("/tx-history");
  await page
    .getByRole("button", { name: catalogs.history.viewDetails, exact: true })
    .waitFor();
  await snapshot("history-full");
  await click(catalogs.history.viewDetails);
  await snapshot("history-details");
  await page
    .getByRole("button", { name: catalogs.common.close, exact: true })
    .scrollIntoViewIfNeeded();
  await snapshot("history-details-bottom");
  await click(catalogs.common.close);
  await page
    .getByPlaceholder(catalogs.history.search, { exact: true })
    .fill("missing");
  await snapshot("history-filter-empty");
  historyState = "empty";
  await go("/tx-history");
  await snapshot("history-full-empty");
  historyState = "error";
  await go("/tx-history");
  await page
    .getByRole("alert")
    .filter({ hasText: catalogs.history.unavailable })
    .waitFor();
  await snapshot("history-full-error");
  assert.equal(await page.locator("html").getAttribute("lang"), catalogs.code);
  await go("/settings");
}
