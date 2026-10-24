import assert from "node:assert/strict";
import { ExtendedSeed, MLDSA87, toChecksumAddress } from "@theqrl/wallet.js";

// Public deterministic fixture only. Never fund this account. No signing or broadcast.
const hexSeed = `0x010000${"12".repeat(48)}`;
const wallet = MLDSA87.newWalletFromExtendedSeed(
  new ExtendedSeed(Buffer.from(hexSeed.slice(2), "hex")),
);
const phrase = wallet.getMnemonic();
const fixtureAddress = toChecksumAddress(wallet.getAddressStr());
wallet.zeroize();

export async function slice3Screens({ page, origin, catalogs, snapshot }) {
  const c = catalogs.onboarding;
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
    page.getByRole("button", { name, exact: true }).first().click();
  const fillPin = async (value, group = 0) => {
    for (const [index, digit] of [...value].entries())
      await page
        .getByLabel(
          catalogs.common.pinDigit.replace("{{position}}", String(index + 1)),
          { exact: true },
        )
        .nth(group)
        .fill(digit);
  };
  const cleanInventory = () =>
    page.evaluate(() => {
      for (const key of Object.keys(localStorage))
        if (/QIP55_ACCOUNT_LIST|QIP55_ACTIVE_ACCOUNT|ENCRYPTED_SEEDS/.test(key))
          localStorage.removeItem(key);
    });
  await cleanInventory();
  await go("/add-account");
  await snapshot("add-account");
  await go("/create-account");
  await page.getByPlaceholder(c.password, { exact: true }).waitFor();
  await snapshot("create-account");
  await page.getByPlaceholder(c.password, { exact: true }).fill("short");
  await page.getByText(c.passwordMin, { exact: true }).waitFor();
  await snapshot("create-password-error");
  await page.getByPlaceholder(c.password, { exact: true }).fill("Password1!");
  await page
    .getByPlaceholder(c.passwordRepeat, { exact: true })
    .fill("Password1!");
  await fillPin("123456");
  await fillPin("654321", 1);
  await page.getByText(c.pinMismatch, { exact: true }).waitFor();
  await snapshot("create-pin-error");
  await fillPin("123456", 1);
  await page.evaluate(
    ({ hexSeed, fixtureAddress }) => {
      window.__APP_STORE__.qrlStore.qrlInstance.accounts.create = () => ({
        address: fixtureAddress,
        seed: hexSeed,
      });
    },
    { hexSeed, fixtureAddress },
  );
  await click(c.create);
  await page
    .getByRole("heading", { name: c.recoveryTitle, exact: true })
    .waitFor();
  await page.getByText(phrase.split(" ")[0], { exact: true }).first().waitFor();
  await snapshot("recovery-phrase");
  await page
    .getByRole("button", { name: c.downloadUnencrypted, exact: true })
    .scrollIntoViewIfNeeded();
  await snapshot("recovery-downloads");
  await click(c.viewQr);
  await snapshot("recovery-address-qr");
  await click(catalogs.common.close);
  await click(c.downloadUnencrypted);
  await snapshot("recovery-unencrypted-warning");
  await click(catalogs.common.cancel);
  await click(c.done);
  await snapshot("recovery-backup-confirmation");
  await click(c.goBack);
  // Every recovery word, its order, and the copied hex seed are data in all languages.
  const words = await page
    .locator(".font-data .text-foreground")
    .allTextContents();
  assert.equal(words.join(" "), phrase);
  await cleanInventory();
  await go("/import-account");
  await snapshot("import-mnemonic");
  await click(c.importTitle);
  await page.getByText(c.mnemonicRequired, { exact: true }).waitFor();
  await snapshot("import-mnemonic-error");
  await page.getByRole("tab", { name: c.importEncrypted, exact: true }).click();
  await snapshot("import-file");
  await page.locator("#walletFile").setInputFiles({
    name: "invalid.json",
    mimeType: "application/json",
    buffer: Buffer.from("not json"),
  });
  await page.getByText(c.fileInvalid, { exact: true }).waitFor();
  await snapshot("import-file-error");
  const keystore = {
    version: 1,
    crypto: {
      cipher: "aes-256-gcm",
      cipherparams: { iv: "00".repeat(12) },
      ciphertext: "00".repeat(67),
      kdf: "argon2id",
      kdfparams: { m: 300000, t: 2, p: 1, dklen: 32, salt: "00".repeat(16) },
    },
  };
  await page.locator("#walletFile").setInputFiles({
    name: "extension-backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        keystores: [keystore, { ...keystore, address: fixtureAddress }],
      }),
    ),
  });
  await page
    .getByText(c.keystoreBounds.replace("{{number}}", "1"), { exact: true })
    .waitFor();
  await snapshot("import-file-kdf-bounds");
  keystore.crypto.kdfparams.m = 4096;
  await page.locator("#walletFile").setInputFiles({
    name: "extension-backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        keystores: [keystore, { ...keystore, address: fixtureAddress }],
      }),
    ),
  });
  await page.getByText(c.extensionPassword, { exact: true }).waitFor();
  await snapshot("import-file-accounts");
  await page.getByRole("combobox").click();
  await snapshot("import-file-account-picker");
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: c.importHex, exact: true }).click();
  await snapshot("import-hex");
  await page
    .getByPlaceholder(c.hexPlaceholder, { exact: true })
    .fill("invalid");
  await click(c.importTitle);
  await page.getByText(c.hexFormat, { exact: true }).waitFor();
  await snapshot("import-hex-error");
  await page.getByPlaceholder(c.hexPlaceholder, { exact: true }).fill(hexSeed);
  await click(c.importTitle);
  await page
    .getByRole("heading", { name: c.setTransactionPin, exact: true })
    .waitFor();
  await snapshot("pin-setup");
  await fillPin("123456");
  await fillPin("654321", 1);
  await page.getByText(c.pinMismatch, { exact: true }).waitFor();
  await snapshot("pin-setup-error");
  await fillPin("123456", 1);
  await click(c.setPin);
  await page.getByRole("heading", { name: c.imported, exact: true }).waitFor();
  await snapshot("import-success");
  await go("/import-account");
  await page
    .getByPlaceholder(c.mnemonicPlaceholder, { exact: true })
    .fill(phrase);
  await click(c.importTitle);
  await page
    .getByRole("heading", { name: c.enterWalletPin, exact: true })
    .waitFor();
  await snapshot("pin-entry");
  await fillPin("999999");
  await click(c.importWallet);
  await page
    .getByText(
      (catalogs.code === "ru"
        ? catalogs.settings.incorrectPin_few
        : catalogs.settings.incorrectPin_other
      ).replace("{{count}}", "4"),
      { exact: true },
    )
    .waitFor();
  await snapshot("pin-entry-error");
  // A structurally valid, unauthenticatable device envelope exercises recovery.
  await page.evaluate(
    ({ fixtureAddress }) => {
      const encryptedSeed = JSON.stringify({
        version: "pin_v5",
        deviceKeyVersion: "device_v1",
        timestamp: 1,
        iv: "00".repeat(12),
        encryptedData: "00".repeat(32),
      });
      for (const network of ["TEST_NET", "TEST_NET_V3"])
        localStorage.setItem(
          `${network}_ENCRYPTED_SEEDS`,
          JSON.stringify({
            value: [
              {
                address: fixtureAddress,
                encryptedSeed,
                lastAccessed: Date.now(),
              },
            ],
            timestamp: Date.now(),
            version: "v1",
          }),
        );
    },
    { fixtureAddress },
  );
  await go("/create-account");
  await page.getByPlaceholder(c.password, { exact: true }).fill("Password1!");
  await page
    .getByPlaceholder(c.passwordRepeat, { exact: true })
    .fill("Password1!");
  await fillPin("123456");
  await click(c.create);
  await page.getByRole("alert", { name: c.recoveryLabel }).waitFor();
  await page
    .getByRole("alert", { name: c.recoveryLabel })
    .scrollIntoViewIfNeeded();
  await snapshot("pin-recovery");
  await page
    .getByRole("button", { name: c.create, exact: true })
    .scrollIntoViewIfNeeded();
  await snapshot("pin-recovery-bottom");
  const legalPages = [
    "/terms",
    "/privacy",
    "/security",
    "/disclaimer",
    "/legal",
  ];
  for (const path of legalPages) {
    await go(path);
    const notice = page.getByText(catalogs.common.englishOnly, { exact: true });
    if (catalogs.code === "en") assert.equal(await notice.count(), 0);
    else await notice.waitFor();
    await snapshot(`legal-${path.slice(1)}`);
  }
}
