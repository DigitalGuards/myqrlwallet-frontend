import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import Web3 from "@theqrl/web3";

const contract = `Q${"3".repeat(128)}`;
const recipient = `Q${"2".repeat(128)}`;
const hash = `0x${"a".repeat(64)}`;
const abi = new Web3().qrl.abi;
const selector = (signature) => abi.encodeFunctionSignature(signature);

/** Check painted fields, values and copy after scrolling, including fixed overlays. */
export async function shortViewportProbe({ page, language, screen, output }) {
  await page.setViewportSize({ width: 360, height: 320 });
  await page.evaluate(() => document.fonts.ready);
  const records = await page.locator("[data-page-shell]").evaluate((root) => {
    const targets = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const element = node.parentElement;
      if (
        !element ||
        !node.textContent.trim() ||
        element.closest("style,script,.sr-only,[aria-hidden=true],[hidden]")
      )
        continue;
      targets.push({
        element,
        node,
        value: node.textContent.trim(),
        kind: "text",
      });
    }
    for (const element of root.querySelectorAll(
      "input,button,select,[role=checkbox]",
    )) {
      if (element.closest('[aria-hidden="true"], [hidden]')) continue;
      targets.push({
        element,
        value: element.matches("input,select")
          ? element.value
          : element.textContent.trim(),
        kind: element.tagName.toLowerCase(),
        name:
          element.getAttribute("name") ??
          element.getAttribute("aria-label") ??
          element.id,
      });
    }
    const records = [];
    for (const { element, node, value, kind, name } of targets) {
      element.scrollIntoView({
        block: "center",
        inline: "nearest",
        behavior: "instant",
      });
      const range = document.createRange();
      if (node) range.selectNodeContents(node);
      const rects = node
        ? [...range.getClientRects()]
        : [element.getBoundingClientRect()];
      let reachable = rects.length > 0;
      for (const rect of rects) {
        if (
          !rect.width ||
          !rect.height ||
          rect.left < -1 ||
          rect.right > innerWidth + 1 ||
          rect.top < 0 ||
          rect.bottom > innerHeight
        ) {
          reachable = false;
          continue;
        }
        for (const x of [
          rect.left + 1,
          (rect.left + rect.right) / 2,
          rect.right - 1,
        ]) {
          const hit = document.elementFromPoint(
            x,
            (rect.top + rect.bottom) / 2,
          );
          if (
            !hit ||
            !(
              element === hit ||
              element.contains(hit) ||
              (element.closest(":disabled,[aria-disabled=true]") &&
                hit.contains(element))
            )
          )
            reachable = false;
        }
        for (
          let ancestor = element.parentElement;
          ancestor;
          ancestor = ancestor.parentElement
        ) {
          const style = getComputedStyle(ancestor);
          const bounds = ancestor.getBoundingClientRect();
          if (
            /hidden|clip|auto|scroll/.test(style.overflowY) &&
            (rect.top < bounds.top - 1 || rect.bottom > bounds.bottom + 1)
          )
            reachable = false;
          if (
            /hidden|clip|auto|scroll/.test(style.overflowX) &&
            (rect.left < bounds.left - 1 || rect.right > bounds.right + 1)
          )
            reachable = false;
        }
      }
      const scrollOffsets = [];
      for (
        let ancestor = element.parentElement;
        ancestor;
        ancestor = ancestor.parentElement
      )
        if (ancestor.scrollTop)
          scrollOffsets.push({
            tag: ancestor.tagName,
            top: ancestor.scrollTop,
          });
      records.push({
        kind,
        name,
        value,
        reachable,
        scrollY,
        scrollOffsets,
        height: element.getBoundingClientRect().height,
      });
    }
    return records;
  });
  const result = {
    language,
    screen,
    width: 360,
    height: 320,
    requiresScrolling: records.some(
      (r) => r.scrollY > 0 || r.scrollOffsets.length > 0,
    ),
    allReachable: records.every((r) => r.reachable),
    records,
  };
  await writeFile(
    join(output, `${language}-${screen}-height.json`),
    JSON.stringify(result, null, 2),
  );
  await page.screenshot({
    path: join(output, `${language}-${screen}-360x320-bottom.png`),
    animations: "disabled",
  });
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    for (const element of document.querySelectorAll("*"))
      if (element.scrollTop) element.scrollTop = 0;
  });
  await page.screenshot({
    path: join(output, `${language}-${screen}-360x320-top.png`),
    animations: "disabled",
  });
  assert.deepEqual(
    records.filter((r) => !r.reachable),
    [],
    `${language}/${screen}: content unreachable at 360 x 320`,
  );
  await page.setViewportSize({ width: 360, height: 800 });
  return result;
}

/** Display fixtures and stubbed reads only. No usable seed, signing or broadcast. */
export async function slice5Screens({
  page,
  origin,
  catalogs,
  snapshot,
  address,
  output,
  embedded = false,
}) {
  const c = catalogs.creation;
  const n = catalogs.nfts;
  const go = async (path) => {
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
    await page.locator("[data-page-shell] h1").waitFor();
  };
  const source = async (source) =>
    page.evaluate(
      ({ address, source }) => {
        const q = window.__APP_STORE__.qrlStore;
        q.activeAccount.accountAddress = address;
        q.qrlAccounts = {
          ...q.qrlAccounts,
          accounts: [{ accountAddress: address, source }],
        };
      },
      { address, source },
    );
  const click = (name) =>
    page.getByRole("button", { name, exact: true }).first().click();
  await go("/create-token");
  await source("seed");
  await snapshot("creation-form");
  for (const id of [
    "mintable",
    "changeInitialRecipient",
    "setMaxWalletAmount",
    "setMaxTransactionLimit",
  ])
    await page.locator(`#${id}`).click();
  await page.locator('[name="tokenName"]').fill("Example Token");
  await page.locator('[name="tokenSymbol"]').fill("EX");
  await page.locator('[name="initialSupply"]').fill("1000000");
  await page.locator('[name="maxSupply"]').fill("1000000000000000000");
  await page.locator('[name="recipientAddress"]').fill(recipient);
  await page.locator('[name="maxWalletAmount"]').fill("1000");
  await page.locator('[name="maxTransactionLimit"]').fill("100");
  for (let index = 0; index < 6; index++)
    await page
      .locator('input[type="password"]')
      .nth(index)
      .fill(String(index + 1));
  await snapshot("creation-all-fields");
  await shortViewportProbe({
    page,
    language: catalogs.code,
    screen: "creation-form",
    output,
  });
  await page.locator('[name="tokenName"]').fill("");
  await page.locator('[name="tokenSymbol"]').fill("");
  await page.locator('[name="decimals"]').fill("0");
  await page.locator('[name="recipientAddress"]').fill("invalid");
  await page.getByText(c.recipientInvalid, { exact: true }).waitFor();
  await snapshot("creation-validation");
  await shortViewportProbe({
    page,
    language: catalogs.code,
    screen: "creation-errors",
    output,
  });
  await source("extension");
  await page.getByText(c.remoteHint, { exact: true }).waitFor();
  await snapshot("creation-remote-signer");
  await source("seed");
  await go("/token-status");
  await snapshot("creation-status-idle");
  for (const state of ["creating", "failed", "success"]) {
    await page.evaluate(
      ({ state, contract, hash }) => {
        const s = window.__APP_STORE__.tokenStore;
        s.creatingToken = {
          creating: state === "creating",
          name: "Example Token",
          error:
            state === "failed"
              ? "Token creation confirmation timed out."
              : undefined,
        };
        if (state === "success")
          s.createdToken = {
            name: "Example Token",
            symbol: "EX",
            decimals: 18,
            address: contract,
            tx: hash,
            blockHash: hash,
            blockNumber: 42,
            gasUsed: "21000",
            effectiveGasPrice: "1000000000",
          };
      },
      { state, contract, hash },
    );
    await snapshot(`creation-status-${state}`);
  }
  await go(`/nft/${contract}/42`);
  await snapshot("nft-missing");
  await page.evaluate(
    ({ contract }) => {
      window.__APP_STORE__.nftStore.nftList = [
        {
          contractAddress: contract,
          tokenId: "42",
          standard: "ERC1155",
          balance: "7",
          name: "Example NFT",
          collectionName: "Example Collection",
          collectionSymbol: "EX",
          description: "External metadata stays verbatim: <b>0xff</b>",
          fetchedAt: Date.now(),
        },
      ];
    },
    { contract },
  );
  await page.locator("#nft-to").waitFor();
  await snapshot("nft-details");
  await page.evaluate(() => {
    window.__APP_STORE__.nftStore.nftList =
      window.__APP_STORE__.nftStore.nftList.map((nft) => ({
        ...nft,
        standard: "ERC721",
      }));
  });
  await snapshot("nft-details-721");
  await shortViewportProbe({
    page,
    language: catalogs.code,
    screen: "nft-transfer-721",
    output,
  });
  await page.evaluate(() => {
    window.__APP_STORE__.nftStore.nftList =
      window.__APP_STORE__.nftStore.nftList.map((nft) => ({
        ...nft,
        standard: "ERC1155",
      }));
  });
  await page.locator("#nft-to").fill(recipient);
  await page.locator("#nft-amount").fill("2");
  await page.locator('form button[type="submit"]').waitFor();
  for (let index = 0; index < 3; index++)
    await page
      .locator('input[type="password"]')
      .nth(index)
      .fill(String(index + 1));
  await snapshot("nft-transfer");
  await shortViewportProbe({
    page,
    language: catalogs.code,
    screen: "nft-transfer",
    output,
  });
  for (const [value, key] of [
    ["1.5", "wholeAmount"],
    ["0", "positiveAmount"],
    ["8", "insufficient"],
    ["1", "pinRequired"],
  ]) {
    await page.locator("#nft-amount").fill(value);
    await click(catalogs.home.transfer);
    await page
      .getByText(n[key].replace("{{balance}}", "7"), { exact: true })
      .waitFor();
    await snapshot(`nft-transfer-${key}`);
    await shortViewportProbe({
      page,
      language: catalogs.code,
      screen: `nft-transfer-${key}`,
      output,
    });
  }
  await page.locator("#nft-to").fill("invalid");
  await snapshot("nft-transfer-invalid-recipient");
  await shortViewportProbe({
    page,
    language: catalogs.code,
    screen: "nft-transfer-invalid-recipient",
    output,
  });
  await page.locator("#nft-to").fill(address);
  // The recipient hook may block self-send before submission; both presentations stay visible.
  await snapshot("nft-transfer-self");
  await shortViewportProbe({
    page,
    language: catalogs.code,
    screen: "nft-transfer-self",
    output,
  });
  await page.locator("#nft-to").fill(recipient);
  await source("extension");
  await click(catalogs.home.transfer);
  await page.getByText(n.extensionUnsupported, { exact: true }).waitFor();
  await snapshot("nft-transfer-extension");
  await shortViewportProbe({
    page,
    language: catalogs.code,
    screen: "nft-transfer-extension",
    output,
  });
  await source("seed");
  for (const state of ["pending", "confirmed"]) {
    await page.evaluate(
      ({ state, hash }) => {
        window.__APP_STORE__.qrlStore.transactionStatus = {
          state,
          txHash: hash,
          receipt: null,
          error: null,
        };
      },
      { state, hash },
    );
    await snapshot(`nft-transfer-${state}`);
  }
  await go("/");
  await source("seed");
  await click(catalogs.home.addNft);
  await snapshot("nft-import-empty");
  if (embedded) {
    await click(catalogs.common.close);
    return;
  }
  let mode = "hold";
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  const routeRpc = async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const request = route.request().postDataJSON();
    if (
      Array.isArray(request) ||
      !["qrl_getCode", "qrl_call"].includes(request.method)
    )
      return route.fallback();
    if (mode === "hold") await held;
    const data = request.params?.[0]?.data ?? request.params?.[0]?.input ?? "";
    let result = "0x";
    let error;
    if (mode === "detection-error")
      error = { code: -32000, message: "External RPC detail 0xff" };
    else if (request.method === "qrl_getCode")
      result = mode === "unsupported" ? "0x" : "0x6000";
    else if (data.startsWith(selector("supportsInterface(bytes4)")))
      result = abi.encodeParameter("bool", data.slice(10, 18) === "d9b67a26");
    else if (data.startsWith(selector("balanceOf(address,uint256)")))
      result = abi.encodeParameter("uint256", mode === "zero" ? "0" : "7");
    else if (data.startsWith(selector("uri(uint256)")))
      result = abi.encodeParameter("string", "");
    else error = { code: -32000, message: "Unsupported fixture read" };
    await route.fulfill({
      status: 200,
      headers: { "access-control-allow-origin": "*" },
      contentType: "application/json",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        ...(error ? { error } : { result }),
      }),
    });
  };
  await page.route("**/qrl-rpc/**", routeRpc);
  await page.locator("#nft-contract").fill(contract);
  await page.getByText(n.detecting, { exact: true }).waitFor();
  await snapshot("nft-import-detecting");
  mode = "unsupported";
  release();
  await page.getByText(n.unsupported, { exact: true }).waitFor();
  await snapshot("nft-import-unsupported");
  for (const next of ["detection-error", "zero", "success"]) {
    mode = next;
    await page.locator("#nft-contract").fill("");
    await page.locator("#nft-contract").fill(contract);
    if (next === "detection-error") {
      await page.getByRole("alert").waitFor();
      await snapshot("nft-import-detection-error");
    } else {
      await page.locator("#nft-token-id").waitFor();
      await snapshot("nft-import-detected");
      await page
        .locator('[role="dialog"] button')
        .filter({ hasText: n.add })
        .click();
      await page.getByText(n.id1155, { exact: true }).waitFor();
      await snapshot("nft-import-id-error");
      await page.locator("#nft-token-id").fill("42");
      await page
        .locator('[role="dialog"] button')
        .filter({ hasText: n.add })
        .click();
      if (next === "zero") {
        await page.getByText(n.zeroBalance, { exact: true }).waitFor();
        await snapshot("nft-import-owner-error");
        await page.locator("#nft-token-id").fill("");
      } else {
        await page.getByRole("dialog").waitFor({ state: "hidden" });
        await snapshot("nft-import-success");
      }
    }
  }
  await page.unroute("**/qrl-rpc/**", routeRpc);
}
