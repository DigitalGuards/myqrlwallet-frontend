// Headless Chromium only. Synthetic reviews, local RPC replies, no signatures.
import { approvalCopy, approvalLanguages, runApprovalLanguages } from "./approval-languages.mjs";
import { installApprovalObserver } from "./approval-observer.mjs";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright";
import {
  address,
  adversarialFixtures,
  consentURI,
  collisionFixtures,
  fixture,
  ignoredNetworkFields,
  methods,
  rpcAnswer,
  roundTwoFixtures,
} from "./approval-fixtures.mjs";
import { measureParity } from './approval-parity.mjs';

const port = process.env.APPROVAL_PORT || '4176';
const origin = `http://localhost:${port}`;
const output =
  process.env.APPROVAL_ARTIFACTS || join(tmpdir(), "approval-visibility");
const started = Date.now();
const baseline = process.env.APPROVAL_BASELINE === "1";
if (!process.env.APPROVAL_LANGUAGE && !baseline) {
  await runApprovalLanguages(output);
  process.exit(0);
}
const language = process.env.APPROVAL_LANGUAGE || "en";
assert(approvalLanguages.includes(language), "Unsupported approval probe language");
const t = await approvalCopy(language);
const caseFilter = process.env.APPROVAL_CASE;
const checksOnly = process.env.APPROVAL_CHECKS_ONLY === "1";
const parityOnly = process.env.APPROVAL_PARITY_ONLY === '1';
const results = [];
const english = [];
let collapsedControls = 0;
const changes = [];
const zeroAreaReports = [];
const emptyCases = [];
const networkReviews = [];
const overflowControls = [];
const queuedReviews = [];
const chainChecks = [];
let chainReadControl;
function holdChainRead() {
  let release;
  const response = new Promise((resolve) => { release = resolve; });
  chainReadControl = { response, release, calls: 0 };
  return chainReadControl;
}
const server = spawn(
  process.execPath,
  [
    "node_modules/vite/bin/vite.js",
    "--config",
    "config/vite.config.ts",
    "preview",
    "--host",
    "localhost",
    "--port",
    port,
    "--strictPort",
    ...(process.env.APPROVAL_DIST ? ["--outDir", process.env.APPROVAL_DIST] : []),
  ],
  { stdio: ["ignore", "ignore", "inherit"] },
);
let context;
try {
  await mkdir(output, { recursive: true });
  for (let attempt = 0; ; attempt++) {
    if (server.exitCode !== null) throw new Error(`Preview exited (${server.exitCode})`);
    try {
      await fetch(origin);
      break;
    } catch (error) {
      if (error.cause?.message === "bad port" || attempt > 40)
        throw new Error(`Preview failed to start on port ${port}`, { cause: error });
      await sleep(250);
    }
  }
  // A temporary extension exercises real browser zoom through chrome.tabs,
  // without pinch scaling or changing the application's CSS.
  const extension = await mkdtemp(join(tmpdir(), "approval-zoom-"));
  await writeFile(
    join(extension, "manifest.json"),
    JSON.stringify({
      manifest_version: 3,
      name: "Headless approval zoom probe",
      version: "1.0",
      permissions: ["tabs"],
      background: { service_worker: "worker.js" },
    }),
  );
  await writeFile(
    join(extension, "worker.js"),
    "chrome.runtime.onInstalled.addListener(() => {});",
  );
  context = await chromium.launchPersistentContext(
    await mkdtemp(join(tmpdir(), "approval-browser-")),
    {
      channel: "chromium",
      headless: true,
      args: [
        `--disable-extensions-except=${extension}`,
        `--load-extension=${extension}`,
      ],
    },
  );
  const worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent("serviceworker"));
  const page = await context.newPage();
  const errors = [];
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
    if (request.method() === "POST" && request.url().includes("/qrl-rpc")) {
      const body = request.postDataJSON();
      const reply = async (rpc) => {
        const control = rpc.method === "qrl_chainId" && chainReadControl;
        if (control) control.calls++;
        return {
          jsonrpc: "2.0",
          id: rpc.id,
          ...(control ? await control.response : { result: rpcAnswer(rpc.method) }),
        };
      };
      return route.fulfill({
        headers,
        contentType: "application/json",
        body: JSON.stringify(
          Array.isArray(body) ? await Promise.all(body.map(reply)) : await reply(body),
        ),
      });
    }
    return route.fulfill({
      headers,
      contentType: "application/json",
      body: "{}",
    });
  });
  await context.addInitScript((language) => {
    for (const prefix of ["", "qrlwallet:v3:"])
      localStorage.setItem(`${prefix}WALLET_LANGUAGE`, JSON.stringify(language));
  }, language);
  await page.goto(origin);
  await page.waitForFunction((language) => document.documentElement.lang === language && Boolean(window.__APP_STORE__), language);
  await page.evaluate((labels) => { window.__approvalLabels = labels; }, { approve: t("Approve"), connect: t("Connect") });
  await page.evaluate(() => document.fonts.ready);
  await installApprovalObserver(page);

  async function open(method, maximal, id, empty = false, supplied) {
    const approval = supplied ?? fixture(method, maximal);
    await page.evaluate(
      ({ approval, uri, address, id, empty }) => {
        const { dappConnectStore: store, qrlStore } = window.__APP_STORE__;
        qrlStore.activeAccount.accountAddress = address;
        if (empty) {
          if (approval.method === "qrl_signMessage")
            approval.params = [address, "0x"];
          else if (approval.method === "qrl_requestAccounts")
            qrlStore.activeAccount.accountAddress = "";
          else approval.params = undefined;
        }
        if (approval.method === "consent") {
          store.requestDesktopConnect(uri, 'link');
        } else {
          const pending = {
            ...approval,
            id,
            sessionId: "visibility-probe",
            timestamp: Date.now(),
          };
          store.pendingRequests = [pending];
          store.currentApproval = pending;
          store.approvalModalOpen = true;
        }
      },
      {
        approval,
        uri: consentURI(maximal),
        address,
        id,
        empty,
      },
    );
    await page.getByRole("dialog").waitFor();
    await page.waitForTimeout(400);
    assert.equal(
      await page
        .getByText(t("Cannot decode this request"), { exact: true })
        .count(),
      0,
    );
    if (!baseline && ["wallet_addQrlChain", "wallet_switchQrlChain"].includes(method)) {
      const chainId = method === "wallet_switchQrlChain" && !empty
        ? approval.params[0].chainId
        : undefined;
      const region = page.getByRole("region", { name: t("Request details") });
      assert.equal(
        await region.textContent(),
        chainId === undefined ? "" : `${t("Requested chain ID")}${chainId}`,
        `${method}: unexpected network review content`,
      );
      const values = await region.locator("dd").evaluateAll((elements) =>
        elements.map((element) => ({
          text: element.textContent,
          direction: getComputedStyle(element).direction,
          monospace: getComputedStyle(element).fontFamily.includes("mono"),
        })),
      );
      assert.deepEqual(values, chainId === undefined ? [] : [
        { text: chainId, direction: "ltr", monospace: true },
      ]);
      const markup = await page.getByRole("dialog").evaluate((dialog) => dialog.outerHTML);
      for (const untrusted of [
        "chainName", "rpcUrls", "\u202e",
        ignoredNetworkFields.chainName, ...ignoredNetworkFields.rpcUrls,
      ]) {
        assert.ok(!markup.includes(untrusted), `${method}: ignored network field rendered`);
      }
      assert.equal(await region.locator("pre").count(), 0);
      networkReviews.push({ method, maximal, empty, chainId: chainId ?? null });
    }
  }

  async function close() {
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "hidden" });
  }

  async function fittedEnglish(label) {
    return page.getByRole("dialog").evaluate((dialog, label) => {
      const round = (number) => Math.round(number * 64) / 64;
      const bounds = (rect) =>
        [rect.x, rect.y, rect.width, rect.height].map(round);
      const text = [];
      const walker = document.createTreeWalker(dialog, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (
          !node.textContent.trim() ||
          node.parentElement.closest("[aria-hidden=true],.sr-only")
        )
          continue;
        // JSX interpolation can split an unchanged painted text run into
        // adjacent DOM text nodes. Compare the complete run and line bounds.
        if (node.previousSibling?.nodeType === Node.TEXT_NODE) continue;
        let last = node;
        let value = node.textContent;
        while (last.nextSibling?.nodeType === Node.TEXT_NODE) {
          last = last.nextSibling;
          value += last.textContent;
        }
        const range = document.createRange();
        range.setStart(node, 0);
        range.setEnd(last, last.textContent.length);
        const rects = [];
        for (const rect of range.getClientRects()) {
          if (!rect.width || !rect.height) continue;
          const previous = rects.at(-1);
          if (previous && previous.y === rect.y && previous.height === rect.height && Math.abs(previous.right - rect.left) < 0.02)
            rects[rects.length - 1] = new DOMRect(previous.x, previous.y, rect.right - previous.x, rect.height);
          else rects.push(rect);
        }
        if (rects.length) text.push({ value, bounds: rects.map(bounds) });
      }
      return {
        label,
        dialog: bounds(dialog.getBoundingClientRect()),
        text,
        controls: [...dialog.querySelectorAll("button,input")].map(
          (element) => ({
            value: element.textContent,
            disabled: element.disabled,
            bounds: bounds(element.getBoundingClientRect()),
          }),
        ),
      };
    }, label);
  }

  async function inspectAndRead(consent, primaryText, primaryLabel, approvalPending = false) {
    if (primaryText === "Empty message (0 bytes).") primaryText = t(primaryText);
    return page.evaluate(async ({ consent, primaryText, primaryLabel, approvalPending }) => {
      const dialog = document.querySelector("[role=dialog]");
      const region = dialog.querySelector("[data-review-region]");
      const button = [...dialog.querySelectorAll("button")].find(
        (el) => el.textContent.trim() === (consent ? window.__approvalLabels.connect : window.__approvalLabels.approve),
      );
      const frame = () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        );
      const visible = (element, rect = element.getBoundingClientRect(), content = false) => {
        if (rect.width <= 0 || rect.height <= 0) return false;
        if (
          rect.bottom < 0 ||
          rect.top > innerHeight ||
          rect.right < 0 ||
          rect.left > innerWidth
        )
          return false;
        let top = 0,
          left = 0,
          right = innerWidth,
          bottom = innerHeight;
        for (
          let parent = content ? element : element.parentElement;
          parent;
          parent = parent.parentElement
        ) {
          const style = getComputedStyle(parent),
            box = parent.getBoundingClientRect();
          if (style.display === "none" || style.visibility === "hidden")
            return false;
          if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
            top = Math.max(top, box.top + parent.clientTop);
            bottom = Math.min(
              bottom,
              box.top + parent.clientTop + parent.clientHeight,
            );
          }
          if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) {
            left = Math.max(left, box.left + parent.clientLeft);
            right = Math.min(
              right,
              box.left + parent.clientLeft + parent.clientWidth,
            );
          }
        }
        return (
          rect.top >= top - 0.02 &&
          rect.bottom <= bottom + 0.02 &&
          rect.left >= left - 0.02 &&
          rect.right <= right + 0.02
        );
      };
      const blocks = [...dialog.querySelectorAll("[data-review-block]")];
      const assertHorizontalFit = () => {
        for (const block of blocks) {
          const bounds = block.getBoundingClientRect();
          for (const element of [block, ...block.querySelectorAll(":not([data-review-tile])")]) {
            if (element.scrollWidth > element.clientWidth)
              throw new Error(`Horizontal content overflow: ${element.textContent.slice(0, 60)} ${JSON.stringify({ width: element.getBoundingClientRect().width, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, font: getComputedStyle(element).font, minWidth: getComputedStyle(element).minWidth })}`);
            const rect = element.getBoundingClientRect();
            if (rect.width && (rect.left < bounds.left - 0.02 || rect.right > bounds.right + 0.02))
              throw new Error(`Descendant outside review block: ${element.tagName} in ${block.textContent.slice(0, 60)}`);
          }
          const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
          while (walker.nextNode()) {
            const node = walker.currentNode;
            const range = document.createRange();
            range.selectNodeContents(node);
            // Line fragments independently catch text clipped inside a fitting
            // parent rectangle, including inline and nested scrolling content.
            for (const rect of range.getClientRects()) {
              if (!rect.width) continue;
              let left = Math.max(0, bounds.left), right = Math.min(innerWidth, bounds.right);
              for (let parent = node.parentElement; parent; parent = parent.parentElement) {
                if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(parent).overflowX)) {
                  const box = parent.getBoundingClientRect();
                  left = Math.max(left, box.left + parent.clientLeft);
                  right = Math.min(right, box.left + parent.clientLeft + parent.clientWidth);
                }
              }
              if (rect.left < left - 0.51 || rect.right > right + 0.51)
                throw new Error(`Horizontally clipped text: ${node.textContent.slice(0, 60)}`);
            }
          }
        }
        if ([dialog, region, ...blocks].some((el) => el.scrollLeft !== 0))
          throw new Error("Review required horizontal scrolling");
      };
      assertHorizontalFit();
      const glyphs = [];
      const seenGlyphs = new Set();
      const labelGlyphs = [];
      const seenLabelGlyphs = new Set();
      let primaryWidth;
      let labelLines;
      const trackCharacters = (node, target) => {
        let offset = 0;
        for (const character of node.textContent) {
          const range = document.createRange();
          range.setStart(node, offset);
          offset += character.length;
          range.setEnd(node, offset);
          // The empty-message label can wrap at collapsible spaces. Count its
          // painted glyphs; signed whitespace is represented by hex digits.
          if (character.trim()) target.push({ range, element: node.parentElement });
        }
      };
      if (primaryText !== undefined) {
        const walker = document.createTreeWalker(region, NodeFilter.SHOW_TEXT);
        let node;
        while (walker.nextNode()) {
          if (walker.currentNode.textContent === primaryText && walker.currentNode.parentElement.closest("[data-review-block]")) {
            node = walker.currentNode;
            break;
          }
        }
        if (!node) throw new Error("Primary signed content missing from required blocks");
        primaryWidth = (node.parentElement.closest(".review-tree-entry") ?? node.parentElement).getBoundingClientRect().width;
        trackCharacters(node, glyphs);
        if (primaryLabel !== undefined) {
          const label = node.parentElement.closest(".review-tree-entry")?.firstElementChild;
          if (label?.textContent !== primaryLabel || label.firstChild?.nodeType !== Node.TEXT_NODE)
            throw new Error(`Deepest value must have full path label: ${primaryLabel}`);
          trackCharacters(label.firstChild, labelGlyphs);
          const range = document.createRange();
          range.selectNodeContents(label);
          labelLines = [...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0).length;
        }
      }
      const sampleGlyphs = () => {
        for (const [characters, seenCharacters] of [[glyphs, seenGlyphs], [labelGlyphs, seenLabelGlyphs]]) {
          characters.forEach(({ range, element }, index) => {
            if (visible(element, range.getBoundingClientRect(), true)) seenCharacters.add(index);
          });
        }
      };
      const previous = window.__reviewProbeCoverage;
      if (previous?.dialog !== dialog) throw new Error("Missing observer from dialog mount");
      // Read every tile again to measure glyph coverage during this call. The
      // mount observer also remembers valid frames before the reader started.
      const seen = new Set();
      const assertGated = () => {
        if (previous.violations.length)
          throw new Error(`Enabled before every detail was visible: ${JSON.stringify(previous.violations)}`);
        if (tiles().some((tile) => !previous.seen.has(tile)) && !button.disabled)
          throw new Error("Enabled with unread content");
      };
      const tiles = () => [...dialog.querySelectorAll("[data-review-tile]")];
      for (const block of dialog.querySelectorAll("[data-review-block]")) {
        if (!block.querySelector("[data-review-tile]"))
          throw new Error(`Zero-area review block: ${block.textContent}`);
      }
      // Independent observer records intervening frames too. Geometric and
      // hit-test assertions below independently verify each scroll destination.
      const coverage = new IntersectionObserver(
        (entries) => {
          sampleGlyphs();
          for (const entry of entries) {
            if (
              entry.isIntersecting &&
              entry.intersectionRatio === 1 &&
              entry.boundingClientRect.height > 0 &&
              entry.boundingClientRect.width > 0
            )
              seen.add(entry.target);
          }
        },
        { root: null, threshold: [1] },
      );
      for (const tile of tiles()) coverage.observe(tile);
      // Give both real observers their initial delivery before scrolling.
      // Geometry sampled and scrolled away in the same JS task was never an
      // IntersectionObserver observation, particularly after a value change.
      await frame();
      sampleGlyphs();
      const initiallyDisabled = button.disabled;
      if (!tiles().length) throw new Error("Missing coverage targets");
      assertGated();
      if (region.clientHeight < Math.min(128, region.scrollHeight) - 1)
        throw new Error("Details minimum collapsed");
      const modes = {
        dialog: dialog.scrollHeight > dialog.clientHeight,
        details: region.scrollHeight > region.clientHeight,
      };
      let steps = 0;
      while (true) {
        const unseen = tiles().find((tile) => !seen.has(tile));
        if (!unseen) break;
        if (steps++ > 20000) throw new Error("Review did not converge");
        unseen.scrollIntoView({ block: "center", inline: "nearest" });
        await frame();
        sampleGlyphs();
        if (!visible(unseen))
          throw new Error(
            `Clipped tile: ${unseen.parentElement.textContent.slice(0, 100)} ${unseen.style.cssText}`,
          );
        assertGated();
      }
      coverage.disconnect();
      for (let settle = 0; settle < 10 && button.disabled && !approvalPending; settle++)
        await frame();
      if (button.disabled !== approvalPending)
        throw new Error(
          `Unexpected approval state after every detail was visible (pending=${approvalPending}): ${JSON.stringify([...dialog.querySelectorAll("[data-review-block]")].map((element) => ({ text: element.textContent.slice(0, 40), width: element.clientWidth, height: element.clientHeight, tiles: element.querySelectorAll("[data-review-tile]").length })))}`,
        );
      assertHorizontalFit();
      if (seenGlyphs.size !== glyphs.length)
        throw new Error(`Enabled with clipped primary characters: ${seenGlyphs.size}/${glyphs.length}`);
      if (seenLabelGlyphs.size !== labelGlyphs.length)
        throw new Error(`Enabled with clipped path characters: ${seenLabelGlyphs.size}/${labelGlyphs.length}`);
      // All controls, including dismissal, must be painted and reachable too.
      for (const control of dialog.querySelectorAll("button, input, summary")) {
        control.scrollIntoView({ block: "center", inline: "nearest" });
        await frame();
        if (!visible(control))
          throw new Error(`Clipped control: ${control.textContent}`);
        const r = control.getBoundingClientRect();
        const hit = document.elementFromPoint(
          r.x + r.width / 2,
          r.y + r.height / 2,
        );
        // Disabled buttons deliberately pass pointer events to their parent.
        const disabledPassthrough = control.disabled &&
          getComputedStyle(control).pointerEvents === "none" && hit?.contains(control);
        if (!hit || (!control.contains(hit) && !disabledPassthrough))
          throw new Error(`Covered control: ${control.textContent}`);
      }
      const box = dialog.getBoundingClientRect();
      if (
        box.left < 0 ||
        box.right > innerWidth + 1 ||
        box.top < 0 ||
        box.bottom > innerHeight + 1
      )
        throw new Error("Dialog outside viewport");
      if (dialog.scrollWidth > dialog.clientWidth + 1)
        throw new Error(`Horizontal dialog overflow: ${JSON.stringify([...dialog.querySelectorAll("*")].filter((el) => el.scrollWidth > el.clientWidth && !el.closest("details:not([open])")).map((el) => ({ text: el.textContent.slice(0, 60), tag: el.tagName, client: el.clientWidth, scroll: el.scrollWidth })))}`);
      return {
        blocks: dialog.querySelectorAll("[data-review-block]").length,
        tiles: tiles().length,
        steps,
        initiallyDisabled,
        enabledAfter: !button.disabled,
        horizontalFit: true,
        primaryCharacters: glyphs.length,
        seenCharacters: seenGlyphs.size,
        primaryWidth,
        primaryLabel,
        labelCharacters: labelGlyphs.length,
        seenLabelCharacters: seenLabelGlyphs.size,
        labelLines,
        modes,
        cssViewport: [innerWidth, innerHeight],
      };
    }, { consent, primaryText, primaryLabel, approvalPending });
  }

  async function attemptPendingApproval() {
    const button = page.getByRole("button", { name: t("Approve"), exact: true });
    assert.equal(await button.isDisabled(), true);
    await button.evaluate((element) => element.click());
    await page.getByRole("dialog").dispatchEvent("submit");
    const pin = page.getByPlaceholder(t("Enter PIN"), { exact: true });
    await pin.fill("123456");
    await pin.press("Enter");
    await pin.fill("");
    assert.equal(await page.getByText(t("No encrypted seed found"), { exact: true }).count(), 0);
    assert.equal(await page.getByText(t("Please enter your PIN"), { exact: true }).count(), 0);
    assert.equal(await button.isDisabled(), true);
  }

  async function checkDelayedChain(viewport, kind) {
    const label = `chain-${kind}-${viewport.width}x${viewport.height}-${viewport.zoom}x`;
    const first = holdChainRead();
    const approval = fixture("qrl_signTypedData");
    // Keep the domain warning above the visible bottom of the review, even
    // at desktop height, so a late warning needs fresh real observations.
    approval.params[1].message.text = "Review before signing. ".repeat(40);
    await open(approval.method, false, label, false, approval);
    assert(first.calls > 0, "Expected a pending chain read");
    await page.getByText(t("Checking the network..."), { exact: true }).waitFor();
    const pending = await inspectAndRead(false, undefined, undefined, true);
    await attemptPendingApproval();
    await page.locator("#approval-chain-hint").scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(output, `${label}-pending.png`) });
    let failed, retry, ready = first;
    if (kind === "failure-retry") {
      first.release({ error: { code: -32603, message: "Synthetic network failure" } });
      const failure = page.getByRole("alert");
      await failure.waitFor();
      assert.equal(await failure.textContent(), t("The wallet could not check its network, so this request cannot be approved yet."));
      assert.equal(await failure.getAttribute("data-review-block"), "true");
      failed = await inspectAndRead(false, undefined, undefined, true);
      await attemptPendingApproval();
      await failure.scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(output, `${label}-failed.png`) });
      ready = holdChainRead();
      await page.getByRole("button", { name: t("Retry"), exact: true }).click();
      await page.getByText(t("Checking the network..."), { exact: true }).waitFor();
      retry = await inspectAndRead(false, undefined, undefined, true);
      await attemptPendingApproval();
      assert(ready.calls > 0, "Retry must start a new chain read");
    }
    await page.locator("[data-review-region]").evaluate(async (region) => {
      region.scrollTop = region.scrollHeight;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    const mismatch = kind !== "match";
    ready.release({ result: mismatch ? "0x1" : "0x301825" });
    await page.getByText(t("Checking the network..."), { exact: true }).waitFor({ state: "hidden" });
    chainReadControl = undefined;
    if (mismatch) {
      const warning = page.getByRole("alert");
      await warning.waitFor();
      assert.equal(await warning.textContent(), t("The signed domain chain ID ({{domain}}) differs from the connected chain ({{connected}}). Only sign if you expect this chain.", { domain: "3151909", connected: "1" }));
      assert.equal(await warning.evaluate((element) => {
        const region = element.closest("[data-review-region]");
        return element.getBoundingClientRect().bottom <= region.getBoundingClientRect().top;
      }), true, "The new warning must start offscreen");
      await attemptPendingApproval();
    } else {
      assert.equal(await page.getByRole("alert").count(), 0);
    }
    const reviewed = await inspectAndRead(false);
    await page.getByRole("button", { name: t("Approve"), exact: true }).click();
    await page.getByText(t("Please enter your PIN"), { exact: true }).waitFor();
    chainChecks.push({ label, pending, failed, retry, mismatch, reviewed, reachedPinCheck: true });
    await close();
    console.log(`approval-visibility: ${label} passed`);
  }

  const viewports = baseline
    ? [{ width: 1280, height: 800, zoom: 1 }]
    : [
        { width: 320, height: 320, zoom: 1 },
        { width: 360, height: 320, zoom: 1 },
        { width: 360, height: 640, zoom: 1 },
        { width: 390, height: 844, zoom: 1 },
        { width: 1280, height: 800, zoom: 1 },
        { width: 360, height: 640, zoom: 2 },
      ];
  if (parityOnly) {
    await measureParity({ page, open, close, output, baseline, language });
  }
  for (const viewport of checksOnly || parityOnly ? [] : viewports) {
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    await worker.evaluate(
      async ({ origin, zoom }) => {
        const tabs = await chrome.tabs.query({ url: `${origin}/*` });
        for (const tab of tabs) await chrome.tabs.setZoom(tab.id, zoom);
      },
      { origin, zoom: viewport.zoom },
    );
    await page.waitForFunction(
      (width) => innerWidth === width,
      viewport.width / viewport.zoom,
    );
    assert.equal(
      await page.evaluate(() => innerWidth),
      viewport.width / viewport.zoom,
      "Browser zoom did not change layout viewport",
    );
    for (const maximal of baseline ? [false] : [false, true]) {
      for (const method of methods) {
        const label = `${method}-${maximal ? "max" : "short"}-${viewport.width}x${viewport.height}-${viewport.zoom}x`;
        if (caseFilter && !new RegExp(caseFilter).test(label)) continue;
        await open(method, maximal, results.length + 1);
        if (baseline) {
          results.push({
            label,
            text: await page.getByRole("dialog").innerText(),
          });
        } else {
          const measured = await inspectAndRead(method === "consent").catch(
            async (error) => {
              await page.screenshot({
                path: join(output, `${label}-failure.png`),
              });
              throw new Error(`${label}: ${error.message}`);
            },
          );
          results.push({ label, ...measured });
        }
        if (language === "en" && !maximal && viewport.width === 1280)
          english.push(await fittedEnglish(label));
        await close();
        console.log(`approval-visibility: ${label} passed`);
      }
    }
    for (const { name, approval, primaryText, primaryLabel } of baseline ? [] : [...adversarialFixtures(), ...roundTwoFixtures()]) {
      const label = `${name}-${viewport.width}x${viewport.height}-${viewport.zoom}x`;
      if (caseFilter && !new RegExp(caseFilter).test(label)) continue;
      await open(approval.method, false, label, false, approval);
      const measured = await inspectAndRead(false, primaryText, primaryLabel).catch(async (error) => {
        await page.screenshot({ path: join(output, `${label}-failure.png`) });
        throw new Error(`${label}: ${error.message}`);
      });
      if (name.startsWith("typed-nested") && viewport.width === 320 && viewport.zoom === 1) {
        // Shallow grid columns preserve the base layout. The independent
        // character-range coverage check proves the deep column fits every
        // glyph, including the complete wrapped path, at its available width.
        assert(measured.primaryWidth > 0, `${label}: leaf has no reading width`);
        assert.equal(measured.primaryLabel, "value.value.value.value.value.value.value.value.value.value");
        assert(measured.labelLines > 1, `${label}: full path must wrap within the narrow column`);
        assert.equal(measured.seenLabelCharacters, measured.primaryLabel.length, `${label}: full path was not fully visible`);
      }
      await page.screenshot({ path: join(output, `${label}.png`) });
      await page.getByRole("button", { name: t("Approve"), exact: true }).click();
      await page.getByText(t("Please enter your PIN"), { exact: true }).waitFor();
      results.push({ label, ...measured, reachedPinCheck: true });
      await close();
      console.log(`approval-visibility: ${label} passed`);
    }
  }

  if (!baseline && !caseFilter && !parityOnly) {
    await worker.evaluate(async (origin) => {
      for (const tab of await chrome.tabs.query({ url: `${origin}/*` }))
        await chrome.tabs.setZoom(tab.id, 1);
    }, origin);
    await measureParity({ page, open, close, output, baseline, language });
    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await worker.evaluate(async ({ origin, zoom }) => {
        for (const tab of await chrome.tabs.query({ url: `${origin}/*` }))
          await chrome.tabs.setZoom(tab.id, zoom);
      }, { origin, zoom: viewport.zoom });
      await page.waitForFunction((width) => innerWidth === width, viewport.width / viewport.zoom);
      for (const kind of ["match", "mismatch", "failure-retry"]) {
        await checkDelayedChain(viewport, kind).catch(async (error) => {
          await page.screenshot({ path: join(output, `chain-${kind}-failure.png`) });
          throw error;
        });
      }
    }
    await worker.evaluate(async (origin) => {
      for (const tab of await chrome.tabs.query({ url: `${origin}/*` }))
        await chrome.tabs.setZoom(tab.id, 1);
    }, origin);
    for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      for (const secondId of ['1', '2']) {
        const [first, second] = collisionFixtures();
        await open(first.method, false, 1, false, first);
        await page.evaluate(({ second, secondId }) => {
          window.__APP_STORE__.dappConnectStore.pendingRequests.push({ ...second,
            id: secondId, sessionId: 'visibility-probe', timestamp: Date.now() });
        }, { second, secondId });
        await inspectAndRead(false);
        await page.evaluate(() => {
          const dialog = document.querySelector('[role=dialog]');
          window.__previousReviewTiles = [...dialog.querySelectorAll('[data-review-tile]')];
          dialog.querySelector('[data-review-region]').scrollTop = 0;
          dialog.scrollTop = 0;
        });
        await page.getByRole('button', { name: t("Reject"), exact: true }).click();
        await page.waitForTimeout(400);
        const before = await page.evaluate(async () => {
          const dialog = document.querySelector('[role=dialog]');
          const block = [...dialog.querySelectorAll('[data-review-block]')].find((el) => el.textContent === 'ordera1b23');
          const region = dialog.querySelector('[data-review-region]');
          const current = window.__APP_STORE__.dappConnectStore.currentApproval;
          const initiallyDisabled = [...dialog.querySelectorAll('button')].find((el) => el.textContent.trim() === window.__approvalLabels.approve).disabled;
          // A fresh dialog can autofocus PIN at the bottom. Independently
          // record those real observations, then reproduce the reviewer's top
          // scroll position with the changed order field far below the region.
          const review = window.__reviewProbeCoverage;
          if (review?.dialog !== dialog) throw new Error('Missing queued-dialog observer');
          const seen = review.seen;
          const coverage = new IntersectionObserver((entries) => {
            for (const entry of entries)
              if (entry.isIntersecting && entry.intersectionRatio === 1 &&
                  entry.boundingClientRect.height > 0 && entry.boundingClientRect.width > 0)
                seen.add(entry.target);
          }, { threshold: [1] });
          for (const tile of dialog.querySelectorAll('[data-review-tile]')) coverage.observe(tile);
          const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          await frame();
          region.scrollTop = 0;
          dialog.scrollTop = 0;
          await frame();
          coverage.disconnect();
          return { id: current.id, idType: typeof current.id,
            initiallyDisabled,
            inheritedTiles: window.__previousReviewTiles.some((tile) => tile.isConnected),
            changedFieldTop: block.getBoundingClientRect().top,
            regionBottom: region.getBoundingClientRect().bottom };
        });
        assert.equal(before.id, secondId);
        assert.equal(before.idType, 'string');
        assert.equal(before.initiallyDisabled, true);
        assert.equal(before.inheritedTiles, false);
        assert(before.changedFieldTop > before.regionBottom, 'Changed field must start offscreen');
        const button = page.getByRole('button', { name: t("Approve"), exact: true });
        assert.equal(await button.isDisabled(), true, 'Second request inherited approval');
        await button.evaluate((el) => el.click());
        assert.equal(await page.getByText(t("Please enter your PIN"), { exact: true }).count(), 0);
        const read = await inspectAndRead(false);
        await button.click();
        await page.getByText(t("Please enter your PIN"), { exact: true }).waitFor();
        queuedReviews.push({ viewport, ...before, ...read, reachedPinAfterOwnReview: true });
        await page.screenshot({ path: join(output, `queued-${secondId}-${viewport.width}.png`) });
        await close();
      }
    }
    await page.setViewportSize({ width: 360, height: 320 });
    await page.waitForFunction(() => innerWidth === 360);
    for (const kind of ["descendant-scroll", "descendant-rect", "resize"]) {
      const { approval, primaryText } = adversarialFixtures().find((entry) => entry.name === "typed-nested-token-2000");
      await open(approval.method, false, `overflow-${kind}`, false, approval);
      await inspectAndRead(false, primaryText);
      await page.evaluate((primaryText) => {
        const walker = document.createTreeWalker(document.querySelector("[data-review-region]"), NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          if (walker.currentNode.textContent === primaryText) {
            walker.currentNode.parentElement.dataset.probeLeaf = "";
            return;
          }
        }
        throw new Error("Missing overflow control leaf");
      }, primaryText);
      const styles = await page.addStyleTag({
        content: kind === "descendant-scroll"
          ? "[data-probe-leaf] { display:block;width:40px;white-space:nowrap;overflow:hidden; }"
          : `${kind === "resize" ? "@media (max-width:340px) {" : ""} [data-probe-leaf] { display:block;transform:translateX(-500px); } ${kind === "resize" ? "}" : ""}`,
      });
      if (kind === "resize") await page.setViewportSize({ width: 320, height: 320 });
      await page.waitForFunction(() => document.querySelector("[data-probe-leaf]").closest("[data-review-block]").querySelectorAll("[data-review-tile]").length === 0);
      assert.equal(await page.getByRole("button", { name: t("Approve"), exact: true }).isDisabled(), true);
      await page.getByRole("dialog").locator("input").first().press("Enter");
      assert.equal(await page.getByText(t("Please enter your PIN"), { exact: true }).count(), 0);
      await styles.evaluate((el) => el.remove());
      await page.setViewportSize({ width: 360, height: 320 });
      await page.waitForFunction(() => document.querySelector("[data-probe-leaf]").closest("[data-review-block]").querySelectorAll("[data-review-tile]").length > 0);
      overflowControls.push({ kind, disabledDuringOverflow: true, ...(await inspectAndRead(false, primaryText)) });
      await close();
    }
    for (const kind of ["message", "identity", "chain-warning", "switch-chain-id"]) {
      // Use the matrix's narrow CSS width for a valid 256-bit replacement ID.
      // At wider viewports it can be fully observed before Playwright polls.
      await page.setViewportSize({ width: kind === "switch-chain-id" ? 180 : 360, height: 320 });
      const method =
        kind === "switch-chain-id" ? "wallet_switchQrlChain"
          : kind === "chain-warning" ? "qrl_signTypedData" : "qrl_signMessage";
      await open(method, false, `change-${kind}`);
      await inspectAndRead(false);
      if (kind === "switch-chain-id") {
        await page.getByRole("dialog").evaluate((dialog) => { dialog.scrollTop = 0; });
      }
      await page.evaluate((kind) => {
        const approval = window.__APP_STORE__.dappConnectStore.currentApproval;
        if (kind === "message") approval.params[1] = `0x${"6869".repeat(512)}`;
        else if (kind === "identity")
          approval.dappInfo.url = `https://changed.example/${"a".repeat(1200)}`;
        else if (kind === "switch-chain-id")
          approval.params[0].chainId = `0x${"fF".repeat(32)}`;
        else approval.params[1].domain.chainId = "1";
      }, kind);
      await page.waitForFunction(() =>
        [...document.querySelectorAll("button")].some(
          (button) =>
            button.textContent.trim() === window.__approvalLabels.approve && button.disabled,
        ),
      ).catch(async (error) => {
        await page.screenshot({ path: join(output, `change-${kind}-failure.png`) });
        throw new Error(`Changed-content control ${kind}: ${error.message}`);
      });
      if (kind === "switch-chain-id")
        assert.equal(await page.locator("[data-review-region] dl").evaluate((block) => {
          const dialog = block.closest("[role=dialog]");
          const region = block.closest("[data-review-region]");
          return block.getBoundingClientRect().bottom > Math.min(dialog.getBoundingClientRect().bottom, region.getBoundingClientRect().bottom);
        }), true, "Changed chain ID must start partly outside the visible review");
      if (kind === "chain-warning") await page.getByRole("alert").waitFor();
      changes.push({ kind, ...(await inspectAndRead(false)) });
      await close();
    }
    await page.setViewportSize({ width: 360, height: 320 });
    for (const method of [
      "qrl_signMessage",
      "qrl_requestAccounts",
      "wallet_addQrlChain",
      "wallet_switchQrlChain",
    ]) {
      await open(method, false, `empty-${method}`, true);
      emptyCases.push({ method, ...(await inspectAndRead(false)) });
      await close();
    }
    // Inject before mounting: previously observed content cannot mask collapse.
    const collapse = await page.addStyleTag({
      content:
        "[data-review-region] { height:0!important;min-height:0!important;max-height:0!important;padding:0!important;overflow:hidden!important; }",
    });
    for (const method of methods) {
      await open(method, false, `collapsed-${method}`);
      assert.equal(
        await page
          .locator("[data-review-region]")
          .evaluate((el) => el.getBoundingClientRect().height),
        0,
      );
      zeroAreaReports.push(
        await page.locator("[data-review-region]").evaluate(async () => {
          // Reproduce the zero-area IO trap inside a positive-area root.
          // The actual review region remains collapsed throughout this check.
          const root = document.createElement("div");
          root.style.cssText =
            "position:fixed;top:0;left:0;width:10px;height:10px;overflow:hidden";
          const zero = document.createElement("span");
          zero.style.cssText =
            "position:absolute;top:1px;left:1px;height:0;width:1px";
          root.append(zero);
          document.body.append(root);
          return new Promise((resolve) => {
            const observer = new IntersectionObserver(
              ([entry]) => {
                observer.disconnect();
                root.remove();
                resolve({
                  height: entry.boundingClientRect.height,
                  ratio: entry.intersectionRatio,
                  intersecting: entry.isIntersecting,
                });
              },
              { root, threshold: [1] },
            );
            observer.observe(zero);
          });
        }),
      );
      const button = page.getByRole("button", {
        name: t(method === "consent" ? "Connect" : "Approve"),
        exact: true,
      });
      assert.equal(
        await button.isDisabled(),
        true,
        `${method}: zero-height negative control enabled`,
      );
      await close();
      collapsedControls++;
    }
    await collapse.evaluate((el) => el.remove());
    if (!checksOnly) {
      assert(results.some((result) => result.modes.dialog));
      assert(results.some((result) => result.modes.details));
      assert(results.some((result) => !result.initiallyDisabled));
    }
    assert(
      zeroAreaReports.every(
        (entry) =>
          entry.height === 0 && entry.ratio === 1 && entry.intersecting,
      ),
      JSON.stringify(zeroAreaReports),
    );
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(await page.evaluate(() => window.__reviewProbeViolations), [],
    "An action enabled with unseen content during the probe");
  assert(results.length > 0 || checksOnly || parityOnly, "No probe cases selected");
  const durationSeconds = (Date.now() - started) / 1000;
  await writeFile(
    join(output, baseline ? "english-base.json" : "results.json"),
    JSON.stringify(
      {
        language,
        durationSeconds,
        collapsedControls,
        zeroAreaReports,
        changes,
        emptyCases,
        networkReviews,
        overflowControls,
        queuedReviews,
        chainChecks,
        results,
      },
      null,
      2,
    ),
  );
  await writeFile(
    join(output, baseline ? "english-base-bounds.json" : "english-bounds.json"),
    JSON.stringify(english, null, 2),
  );
  if (process.env.APPROVAL_BASE_BOUNDS) {
    const expected = JSON.parse(
      await readFile(process.env.APPROVAL_BASE_BOUNDS, "utf8"),
    );

    let matched = 0;
    for (const actual of english) {
      const reference = expected.find((entry) => entry.label === actual.label);
      assert(reference, `Missing English base: ${actual.label}`);
      assert.deepEqual({ ...actual, text: undefined }, { ...reference, text: undefined },
        `English dialog/control bounds changed: ${actual.label}`);
      assert.deepEqual(actual.text.map((run) => run.value), reference.text.map((run) => run.value),
        `English copy changed: ${actual.label}`);
      for (let i = 0; i < actual.text.length; i++) {
        const measured = actual.text[i].bounds;
        const expectedBounds = reference.text[i].bounds;
        assert.equal(measured.length, expectedBounds.length, "English text wrapping changed");
        for (let line = 0; line < measured.length; line++)
          for (let coordinate = 0; coordinate < 4; coordinate++)
            // Adjacent JSX text fragments can round one Chromium layout unit
            // differently from the same interpolated sentence. All control
            // geometry and line counts remain exact; the visibility assertions
            // continue to require complete intersections with positive area.
            assert(Math.abs(measured[line][coordinate] - expectedBounds[line][coordinate]) <= 1 / 64,
              `English painted text bounds changed: ${actual.label}/${actual.text[i].value}`);
      }
      matched++;
    }
    assert.equal(matched, 8, "Incomplete English fitted comparison");
    console.log(
      "approval-visibility: 8 English screens match pinned base text and dialog/control bounds; text-run rounding is within 1/64 CSS pixel",
    );
  }
  console.log(
    `approval-visibility: ${results.length} cases, ${networkReviews.length} network content checks, ${chainChecks.length} chain checks, ${collapsedControls} collapsed controls, ${overflowControls.length} overflow controls, ${queuedReviews.length} queued reviews; ${durationSeconds}s`,
  );
} finally {
  await context?.close();
  server.kill();
}
