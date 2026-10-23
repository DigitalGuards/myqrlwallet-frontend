// Headless Chromium only. Synthetic reviews, local RPC replies, no signatures.
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
  ],
  { stdio: "ignore" },
);
let context;
try {
  await mkdir(output, { recursive: true });
  for (let attempt = 0; ; attempt++) {
    try {
      await fetch(origin);
      break;
    } catch {
      if (attempt > 40) throw new Error("Preview failed to start");
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
  await page.goto(origin);
  await page.getByRole("link", { name: "Create a new account" }).waitFor();
  await page.evaluate(() => document.fonts.ready);

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
        .getByText("Cannot decode this request", { exact: true })
        .count(),
      0,
    );
    if (!baseline && ["wallet_addQrlChain", "wallet_switchQrlChain"].includes(method)) {
      const chainId = method === "wallet_switchQrlChain" && !empty
        ? approval.params[0].chainId
        : undefined;
      const region = page.getByRole("region", { name: "Request details" });
      assert.equal(
        await region.textContent(),
        chainId === undefined ? "" : `Requested chain ID${chainId}`,
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
        const range = document.createRange();
        range.selectNodeContents(node);
        const rects = [...range.getClientRects()].filter(
          (rect) => rect.width > 0 && rect.height > 0,
        );
        if (rects.length)
          text.push({ value: node.textContent, bounds: rects.map(bounds) });
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

  async function inspectAndRead(consent, primaryText, primaryLabel) {
    return page.evaluate(async ({ consent, primaryText, primaryLabel }) => {
      const dialog = document.querySelector("[role=dialog]");
      const region = dialog.querySelector("[data-review-region]");
      const button = [...dialog.querySelectorAll("button")].find(
        (el) => el.textContent.trim() === (consent ? "Connect" : "Approve"),
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
              throw new Error(`Horizontal content overflow: ${element.textContent.slice(0, 60)}`);
            const rect = element.getBoundingClientRect();
            if (rect.width && (rect.left < bounds.left - 0.02 || rect.right > bounds.right + 0.02))
              throw new Error(`Descendant outside review block: ${element.textContent.slice(0, 60)}`);
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
      const seen = previous?.dialog === dialog ? previous.seen : new Set();
      window.__reviewProbeCoverage = { dialog, seen };
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
              visible(entry.target)
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
      if (tiles().some((tile) => !seen.has(tile)) && !button.disabled)
        throw new Error("Enabled before every detail was visible");
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
        if (tiles().some((tile) => !seen.has(tile)) && !button.disabled)
          throw new Error("Enabled with unread content");
      }
      coverage.disconnect();
      for (let settle = 0; settle < 10 && button.disabled; settle++)
        await frame();
      if (button.disabled)
        throw new Error(
          `Still gated after every detail was visible: ${JSON.stringify([...dialog.querySelectorAll("[data-review-block]")].map((element) => ({ text: element.textContent.slice(0, 40), width: element.clientWidth, height: element.clientHeight, tiles: element.querySelectorAll("[data-review-tile]").length })))}`,
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
        if (!hit || !control.contains(hit))
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
        throw new Error("Horizontal dialog overflow");
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
    }, { consent, primaryText, primaryLabel });
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
    await measureParity({ page, open, close, output, baseline });
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
        if (!maximal && viewport.width === 1280)
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
      await page.getByRole("button", { name: "Approve", exact: true }).click();
      await page.getByText("Please enter your PIN", { exact: true }).waitFor();
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
    await measureParity({ page, open, close, output, baseline });
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
        await page.getByRole('button', { name: 'Reject', exact: true }).click();
        await page.waitForTimeout(400);
        const before = await page.evaluate(async () => {
          const dialog = document.querySelector('[role=dialog]');
          const block = [...dialog.querySelectorAll('[data-review-block]')].find((el) => el.textContent === 'ordera1b23');
          const region = dialog.querySelector('[data-review-region]');
          const current = window.__APP_STORE__.dappConnectStore.currentApproval;
          const initiallyDisabled = [...dialog.querySelectorAll('button')].find((el) => el.textContent.trim() === 'Approve').disabled;
          // A fresh dialog can autofocus PIN at the bottom. Independently
          // record those real observations, then reproduce the reviewer's top
          // scroll position with the changed order field far below the region.
          const seen = new Set();
          window.__reviewProbeCoverage = { dialog, seen };
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
        const button = page.getByRole('button', { name: 'Approve', exact: true });
        assert.equal(await button.isDisabled(), true, 'Second request inherited approval');
        await button.evaluate((el) => el.click());
        assert.equal(await page.getByText('Please enter your PIN', { exact: true }).count(), 0);
        const read = await inspectAndRead(false);
        await button.click();
        await page.getByText('Please enter your PIN', { exact: true }).waitFor();
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
      assert.equal(await page.getByRole("button", { name: "Approve", exact: true }).isDisabled(), true);
      await page.getByRole("dialog").locator("input").first().press("Enter");
      assert.equal(await page.getByText("Please enter your PIN", { exact: true }).count(), 0);
      await styles.evaluate((el) => el.remove());
      await page.setViewportSize({ width: 360, height: 320 });
      await page.waitForFunction(() => document.querySelector("[data-probe-leaf]").closest("[data-review-block]").querySelectorAll("[data-review-tile]").length > 0);
      overflowControls.push({ kind, disabledDuringOverflow: true, ...(await inspectAndRead(false, primaryText)) });
      await close();
    }
    for (const kind of ["message", "identity", "chain-warning", "switch-chain-id"]) {
      const method =
        kind === "switch-chain-id" ? "wallet_switchQrlChain"
          : kind === "chain-warning" ? "qrl_signTypedData" : "qrl_signMessage";
      await open(method, false, `change-${kind}`);
      await inspectAndRead(false);
      await page.evaluate((kind) => {
        const approval = window.__APP_STORE__.dappConnectStore.currentApproval;
        if (kind === "message") approval.params[1] = `0x${"6869".repeat(512)}`;
        else if (kind === "identity")
          approval.dappInfo.url = `https://changed.example/${"a".repeat(300)}`;
        else if (kind === "switch-chain-id")
          approval.params[0].chainId = `0x${"fF".repeat(32)}`;
        else approval.params[1].domain.chainId = "1";
      }, kind);
      await page.waitForFunction(() =>
        [...document.querySelectorAll("button")].some(
          (button) =>
            button.textContent.trim() === "Approve" && button.disabled,
        ),
      );
      changes.push({ kind, ...(await inspectAndRead(false)) });
      await close();
    }
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
        name: method === "consent" ? "Connect" : "Approve",
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
  assert(results.length > 0 || checksOnly || parityOnly, "No probe cases selected");
  const durationSeconds = (Date.now() - started) / 1000;
  await writeFile(
    join(output, baseline ? "english-base.json" : "results.json"),
    JSON.stringify(
      {
        durationSeconds,
        collapsedControls,
        zeroAreaReports,
        changes,
        emptyCases,
        networkReviews,
        overflowControls,
        queuedReviews,
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
    const exceptions = [
      "wallet_switchQrlChain",
      "qrl_requestAccounts",
    ];
    let matched = 0;
    for (const actual of english) {
      if (exceptions.some((method) => actual.label.startsWith(method)))
        continue;
      const reference = expected.find((entry) => entry.label === actual.label);
      assert(reference, `Missing English base: ${actual.label}`);
      assert.deepEqual(
        actual,
        reference,
        `English fitted bounds/copy changed: ${actual.label}`,
      );
      matched++;
    }
    assert.equal(matched, 6, "Incomplete English fitted comparison");
    console.log(
      "approval-visibility: 6 fitted English screens match base text, text-range bounds and controls exactly; account address and validated switch ID are the 2 explicit value-display additions",
    );
  }
  console.log(
    `approval-visibility: ${results.length} cases, ${networkReviews.length} network content checks, ${collapsedControls} collapsed controls, ${overflowControls.length} overflow controls, ${queuedReviews.length} queued reviews; ${durationSeconds}s`,
  );
} finally {
  await context?.close();
  server.kill();
}
