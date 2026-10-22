import assert from "node:assert/strict";
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { slice5Matrix } from "./i18n-slice5-matrix.mjs";

const output = process.env.I18N_SCREENSHOT_DIR ?? join(tmpdir(), "fe-i18n-s5");
const origin = "http://localhost:4176";
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
    "4176",
    "--strictPort",
  ],
  { stdio: ["ignore", "ignore", "inherit"] },
);
const started = performance.now();
let browser;
try {
  for (let attempt = 0; attempt < 40; attempt++) {
    if (server.exitCode !== null) throw new Error("Preview exited");
    try {
      await fetch(origin);
      break;
    } catch {
      await delay(250);
    }
    if (attempt === 39) throw new Error("Preview did not start");
  }
  browser = await chromium.launch();
  const results = await slice5Matrix(
    browser,
    origin,
    output,
    process.env.I18N_BASELINE === "1" ? ["en"] : undefined,
  );
  assert.deepEqual(
    results.filter((result) => result.problems.length),
    [],
    "Slice 5 control overflow",
  );
  console.log(
    `slice5 smoke: OK (${results.length} screens, ${((performance.now() - started) / 1000).toFixed(1)}s)`,
  );
} finally {
  console.log(
    `slice5 smoke duration: ${((performance.now() - started) / 1000).toFixed(1)}s`,
  );
  await browser?.close();
  server.kill();
}
