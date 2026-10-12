// Run after npm run build. All external requests are fulfilled locally.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright";

const origin = "http://localhost:4175";
const output =
  process.env.DAPP_APPROVAL_ARTIFACTS || "/tmp/dapp-approval-smoke";
const address = `Q${"a".repeat(128)}`;
const payload = {
  types: {
    QRLDomain: [
      { name: "name", type: "string" },
      { name: "chainId", type: "uint256" },
    ],
    Recipients: [{ name: "accounts", type: "address[]" }],
  },
  primaryType: "Recipients",
  domain: { name: "Approval layout test", chainId: "3151909" },
  message: {
    accounts: Array.from(
      { length: 12 },
      (_, index) => `Q${(index + 1).toString(16).padStart(128, "0")}`,
    ),
  },
};
const approvals = [
  { method: "qrl_signTypedData", params: [address, payload] },
  {
    method: "qrl_signMessage",
    params: [address, `0x${"68656c6c6f20".repeat(200)}`],
  },
  {
    method: "qrl_sendTransaction",
    params: [
      {
        from: address,
        to: address,
        value: "0x0",
        data: `0x${"ab".repeat(1000)}`,
      },
    ],
  },
  {
    method: "qrl_signTransaction",
    params: [{ from: address, to: address, value: "0x0" }],
  },
  { method: "qrl_requestAccounts", params: [] },
];
const rpcAnswer = (method) => {
  switch (method) {
    case "net_listening":
      return true;
    case "net_version":
      return "3151909";
    case "qrl_chainId":
      return "0x301825";
    case "qrl_getBlockByNumber":
      return {
        hash: `0x${"a".repeat(64)}`,
        number: "0x1",
        baseFeePerGas: "0x3b9aca00",
      };
    case "qrl_gasPrice":
      return "0x3b9aca00";
    case "qrl_maxPriorityFeePerGas":
      return "0x1";
    case "qrl_estimateGas":
      return "0x5208";
    default:
      return "0x0";
  }
};

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
    "4175",
    "--strictPort",
  ],
  { stdio: "ignore" },
);
let browser;
try {
  await mkdir(output, { recursive: true });
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      await fetch(origin);
      break;
    } catch {
      if (attempt === 39) throw new Error("Preview server did not start");
      await sleep(250);
    }
  }
  browser = await chromium.launch();
  const page = await browser.newPage();
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
        contentType: "application/json",
        headers,
        body: JSON.stringify(
          Array.isArray(body) ? body.map(reply) : reply(body),
        ),
      });
    }
    return route.fulfill({
      contentType: "application/json",
      headers,
      body: "{}",
    });
  });
  await page.goto(origin);
  await page.getByRole("link", { name: "Create a new account" }).waitFor();
  const measurements = [];

  async function measure(kind, viewport, colorScheme, consent = false) {
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    await page.waitForTimeout(400);
    const body = page.getByRole("region", {
      name: consent ? "Connection details" : "Request details",
    });
    // Start at the top, then exercise real wheel scrolling in the review body.
    await body.evaluate((element) => {
      element.scrollTop = 0;
    });
    const bounds = await dialog.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const buttons = [...element.querySelectorAll("button")].map((button) => {
        const box = button.getBoundingClientRect();
        const hit = document.elementFromPoint(
          box.x + box.width / 2,
          box.y + box.height / 2,
        );
        return {
          text: button.textContent.trim(),
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
          reachable: hit !== null && button.contains(hit),
        };
      });
      return {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        pageScrollY: window.scrollY,
        buttons,
      };
    });
    assert(
      bounds.y >= 0 && bounds.y + bounds.height <= viewport.height,
      `${kind}: vertical overflow`,
    );
    assert(
      bounds.x >= 0 && bounds.x + bounds.width <= viewport.width,
      `${kind}: horizontal overflow`,
    );
    assert(
      bounds.height <= viewport.height * 0.9 + 1,
      `${kind}: exceeds height cap`,
    );
    assert.equal(bounds.pageScrollY, 0, `${kind}: page scrolled`);
    for (const label of consent
      ? ["Cancel", "Connect", "Close"]
      : ["Reject", "Approve", "Close"]) {
      const button = bounds.buttons.find(
        (candidate) => candidate.text === label,
      );
      assert(
        button?.reachable,
        `${kind}: ${label} cannot be reached with the mouse`,
      );
      assert(
        button.y >= 0 && button.y + button.height <= viewport.height,
        `${kind}: ${label} outside viewport`,
      );
    }
    const scroll = await body.evaluate((element) => ({
      height: element.clientHeight,
      content: element.scrollHeight,
    }));
    if (scroll.content > scroll.height) {
      await body.hover();
      await page.mouse.wheel(0, 400);
      await page.waitForFunction(
        (label) =>
          (document.querySelector(`[aria-label="${label}"]`)?.scrollTop ?? 0) >
          0,
        consent ? "Connection details" : "Request details",
      );
      for (const button of bounds.buttons) {
        const box = await dialog
          .getByRole("button", { name: button.text, exact: true })
          .boundingBox();
        assert(
          box && Math.abs(box.y - button.y) < 1,
          `${kind}: footer/header moved while scrolling`,
        );
      }
    }
    await body.evaluate((element) => {
      element.scrollTop = 0;
    });
    await page.screenshot({
      path: `${output}/${kind}-${viewport.width}-${colorScheme}.png`,
    });
    measurements.push({ kind, viewport, colorScheme, ...bounds, body: scroll });
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    assert.equal(
      await page.evaluate(
        () => window.__APP_STORE__?.dappConnectStore.currentApproval ?? null,
      ),
      null,
    );
  }

  for (const viewport of [
    { width: 1100, height: 800 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    for (const colorScheme of ["dark", "light"]) {
      await page.emulateMedia({ colorScheme });
      for (const approval of approvals) {
        await page.evaluate(
          ({ approval, address }) => {
            const store = window.__APP_STORE__;
            if (!store) throw new Error("Wallet store unavailable");
            store.qrlStore.activeAccount.accountAddress = address;
            const pending = {
              ...approval,
              id: 1,
              sessionId: "layout-test",
              dappInfo: {
                name: "QRL Connect Test dApp",
                url: "https://dapp.example",
                chainId: "0x301825",
              },
              timestamp: Date.now(),
            };
            store.dappConnectStore.pendingRequests = [pending];
            store.dappConnectStore.currentApproval = pending;
            store.dappConnectStore.approvalModalOpen = true;
          },
          { approval, address },
        );
        await measure(approval.method, viewport, colorScheme);
      }
      await page.evaluate(() => {
        const store = window.__APP_STORE__;
        if (!store) throw new Error("Wallet store unavailable");
        store.dappConnectStore.desktopConnectUri =
          "qrlconnect://?q=layout-fixture";
        store.dappConnectStore.desktopConnectSource = "link";
      });
      await measure("connect-consent", viewport, colorScheme, true);
    }
  }
  assert.deepEqual(errors, []);
  await writeFile(
    `${output}/measurements.json`,
    `${JSON.stringify(measurements, null, 2)}\n`,
  );
  console.log(
    `smoke-dapp-approvals: OK (${measurements.length} layouts; mouse access, body scrolling, Escape rejection)`,
  );
  console.log(
    JSON.stringify(
      measurements.filter((entry) => entry.kind === "qrl_signTypedData"),
    ),
  );
} finally {
  await browser?.close();
  server.kill();
}
