#!/usr/bin/env node
/**
 * Independent check that the built embedded wallet really is one file.
 *
 * `config/vite.config.embedded.ts` already refuses to emit anything else, but
 * that check runs inside the build that produced the file. This one reads the
 * artifact from disk afterwards, shares no code with the build, and asserts
 * the three properties the mobile app depends on:
 *
 *   1. no <script src=>            - no executable code comes from the network
 *   2. no <link> to a .js or .css  - no stylesheet or module is fetched
 *   3. no /assets/ reference       - no leftover pointer at a chunk directory
 *
 * It also verifies the recorded digest and the build-info block, so a CI run
 * fails if the sidecar and the document ever disagree.
 *
 * Usage: node scripts/check-embedded-output.mjs [dist-embedded]
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const outDir = process.argv[2] ?? "dist-embedded";
const htmlPath = join(outDir, "index.html");
const digestPath = join(outDir, "index.html.sha256");

const bytes = readFileSync(htmlPath);
const html = bytes.toString("utf8");

// Minified application code contains tag-like text (React builds `<link ...>`
// strings for its error messages), so the bodies of the inline <script> and
// <style> elements are removed before the markup is scanned.
const markup = html
  .replace(/(<script\b[^>]*>)[\s\S]*?(<\/script\s*>)/gi, "$1$2")
  .replace(/(<style\b[^>]*>)[\s\S]*?(<\/style\s*>)/gi, "$1$2");

const failures = [];

if (/<script\b[^>]*\bsrc\s*=/i.test(markup)) {
  failures.push("the document loads a script from a URL (<script src=)");
}
if (/<link\b[^>]*\bhref\s*=\s*["'][^"']*\.(?:js|mjs|css)\b/i.test(markup)) {
  failures.push("the document links a .js or .css file (<link href=)");
}
if (markup.includes("/assets/")) {
  failures.push("the document still references /assets/");
}

const digest = createHash("sha256").update(bytes).digest("hex");
const recorded = readFileSync(digestPath, "utf8").trim().split(/\s+/)[0];
if (digest !== recorded) {
  failures.push(`index.html.sha256 records ${recorded}, the file hashes to ${digest}`);
}

const buildInfo = html.match(
  /<script type="application\/json" id="qrl-embedded-build-info">(.*?)<\/script>/s,
);
if (buildInfo === null) {
  failures.push("the build-info block is missing");
} else {
  const info = JSON.parse(buildInfo[1]);
  for (const field of ["commit", "builtAt", "appScriptSha256"]) {
    if (typeof info[field] !== "string" || info[field].length === 0) {
      failures.push(`the build-info block has no ${field}`);
    }
  }
  console.log(
    `embedded build: ${info.commit} @ ${info.builtAt}\n` +
      `app script sha256: ${info.appScriptSha256}`,
  );
}

console.log(`document sha256: ${digest} (${bytes.length} bytes)`);

if (failures.length > 0) {
  console.error(`\n${htmlPath} is not self-contained:`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log("embedded output is self-contained");
