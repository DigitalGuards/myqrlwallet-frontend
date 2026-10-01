#!/usr/bin/env node
/**
 * Independent check that the built embedded wallet really is one file.
 *
 * `config/vite.config.embedded.ts` already refuses to emit anything else, but
 * that check runs inside the build that produced the file. This one reads the
 * artifact from disk afterwards and shares no code with the build, so a bug in
 * the build's own guard cannot hide from both.
 *
 * It enforces the same rule set the build does:
 *
 *   1. no <script src=>                 no executable code comes from the network
 *   2. no fetching <link>               no stylesheet, preload, icon or manifest
 *   3. no document-relative URL         nothing resolves against the WebView baseUrl
 *   4. no /assets/ reference            no leftover pointer at a chunk directory
 *   5. no url() outside data:           the inline stylesheet fetches nothing
 *   6. a locked-down CSP                no 'self', no 'unsafe-eval', no remote script
 *   7. provenance that adds up          the recorded digests match the document
 *
 * Checks 6 and 7 are what catch the two failures that would otherwise be
 * silent: a build that kept index.html's development policy (where 'self' is
 * qrlwallet.com under the WebView baseUrl), and a build-info block describing
 * something other than the script actually shipped.
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
const failures = [];

// Minified application code contains tag-like text (React builds `<link ...>`
// strings for its error messages), so the bodies of the inline <script> and
// <style> elements are removed before the markup is scanned.
const markup = html
  .replace(/(<script\b[^>]*>)[\s\S]*?(<\/script\s*>)/gi, "$1$2")
  .replace(/(<style\b[^>]*>)[\s\S]*?(<\/style\s*>)/gi, "$1$2");

// 1. no remote script
if (/<script\b[^>]*\bsrc\s*=/i.test(markup)) {
  failures.push("the document loads a script from a URL (<script src=)");
}

// 2. no fetching link
for (const link of markup.matchAll(/<link\b[^>]*>/gi)) {
  const rel = link[0].match(/\brel\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s">]+))/i);
  const value = (rel?.[1] ?? rel?.[2] ?? rel?.[3] ?? "").toLowerCase();
  if (
    /^(stylesheet|modulepreload|preload|prefetch|manifest|icon|apple-touch-icon|preconnect|dns-prefetch)$/.test(
      value,
    )
  ) {
    failures.push(`the document has a fetching <link rel="${value}">`);
  }
}

// 3. no document-relative URL anywhere in the markup
for (const attribute of markup.matchAll(
  /\b(?:src|href|srcset|poster)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi,
)) {
  const value = attribute[1] ?? attribute[2] ?? attribute[3] ?? "";
  if (value.length === 0) continue;
  if (/^(?:https:|data:|mailto:|blob:|#)/i.test(value)) continue;
  failures.push(`the document has a relative URL: ${attribute[0]}`);
}

// 4. no chunk directory
if (markup.includes("/assets/")) {
  failures.push("the document still references /assets/");
}

// 5. the inline stylesheet fetches nothing
for (const style of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)) {
  const css = style[1] ?? "";
  if (/@import/i.test(css)) failures.push("the stylesheet uses @import");
  // A quoted value is consumed whole, so a `url(#id)` nested inside a
  // percent-encoded data: SVG is skipped with the data URI containing it.
  for (const reference of css.matchAll(
    /url\(\s*(?:"([^"]*)"|'([^']*)'|([^"')\s]*))\s*\)/gi,
  )) {
    const value = (reference[1] ?? reference[2] ?? reference[3] ?? "").trim();
    if (value.length === 0 || /^(?:data:|#)/i.test(value)) continue;
    failures.push(`the stylesheet fetches ${value}`);
  }
}

// 6. the policy is the locked-down one
const cspMetas = [
  ...markup.matchAll(
    /<meta\b[^>]*http-equiv\s*=\s*["']?Content-Security-Policy["']?[^>]*>/gi,
  ),
].map((match) => match[0]);
if (cspMetas.length !== 1) {
  failures.push(`expected exactly one CSP meta, found ${cspMetas.length}`);
} else {
  const meta = cspMetas[0];
  if (!/default-src\s+'none'/i.test(meta)) {
    failures.push("the CSP does not start from default-src 'none'");
  }
  for (const forbidden of ["'self'", "'unsafe-eval'", "http://", "ws://"]) {
    if (meta.includes(forbidden)) {
      failures.push(`the CSP still allows ${forbidden}`);
    }
  }
  if (/script-src\s[^;"]*'unsafe-inline'/i.test(meta)) {
    failures.push("the CSP allows 'unsafe-inline' scripts");
  }
  if (/script-src\s[^;"]*https:/i.test(meta)) {
    failures.push("the CSP allows a remote script source");
  }

  // Recompute a hash for every inline script the browser executes and require
  // the policy to name exactly those. A stale or missing hash blocks the whole
  // application, and a hash for a script that is no longer there is dead
  // policy that hides the fact.
  const executable = [];
  for (const element of html.matchAll(
    /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi,
  )) {
    const attributes = element[1] ?? "";
    if (/\bsrc\s*=/i.test(attributes)) continue;
    const type = attributes.match(
      /\btype\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i,
    );
    const value = (type?.[1] ?? type?.[2] ?? type?.[3] ?? "")
      .trim()
      .toLowerCase();
    // application/json and application/ld+json are data blocks: never
    // executed, never covered by script-src, so they need no hash.
    if (
      value === "" ||
      value === "module" ||
      value === "text/javascript" ||
      value === "application/javascript"
    ) {
      executable.push(element[2] ?? "");
    }
  }
  const expected = executable.map(
    (content) =>
      `sha256-${createHash("sha256").update(content, "utf8").digest("base64")}`,
  );
  const listed = [...meta.matchAll(/'(sha256-[A-Za-z0-9+/=]+)'/g)].map(
    (m) => m[1],
  );
  for (const hash of expected) {
    if (!listed.includes(hash)) {
      failures.push(`the CSP has no hash for one of the inline scripts (${hash})`);
    }
  }
  for (const hash of listed) {
    if (!expected.includes(hash)) {
      failures.push(`the CSP lists ${hash}, which matches no inline script`);
    }
  }
  console.log(
    `inline scripts: ${executable.length} executable, ${listed.length} hashed in the CSP`,
  );
  console.log(`CSP: ${(meta.match(/content\s*=\s*"([^"]*)"/i) ?? [])[1] ?? "?"}`);
}

// 7. the recorded digests describe this document
const documentDigest = createHash("sha256").update(bytes).digest("hex");
const recorded = readFileSync(digestPath, "utf8").trim().split(/\s+/)[0];
if (documentDigest !== recorded) {
  failures.push(
    `index.html.sha256 records ${recorded}, the file hashes to ${documentDigest}`,
  );
}

const buildInfoMatch = html.match(
  /<script type="application\/json" id="qrl-embedded-build-info">(.*?)<\/script>/s,
);
if (buildInfoMatch === null) {
  failures.push("the build-info block is missing");
} else {
  const info = JSON.parse(buildInfoMatch[1]);
  for (const field of ["commit", "builtAt", "appScriptSha256"]) {
    if (typeof info[field] !== "string" || info[field].length === 0) {
      failures.push(`the build-info block has no ${field}`);
    }
  }
  // Recompute the application script's digest from the document, so an
  // auditor never has to trust the recorded value or guess the framing.
  const appScript = html.match(
    /<script type="module" id="qrl-embedded-app">\n([\s\S]*?)\n<\/script>/,
  );
  if (appScript === null) {
    failures.push("the application script was not found by its id");
  } else {
    const digest = createHash("sha256").update(appScript[1]).digest("hex");
    if (digest !== info.appScriptSha256) {
      failures.push(
        `build info records appScriptSha256 ${info.appScriptSha256}, the script hashes to ${digest}`,
      );
    }
    if (Buffer.byteLength(appScript[1]) !== info.appScriptBytes) {
      failures.push("build info records the wrong appScriptBytes");
    }
  }
  console.log(
    `embedded build: ${info.commit} @ ${info.builtAt} (embedVideo=${info.embedVideo})\n` +
      `app script sha256: ${info.appScriptSha256} (verified against the document)`,
  );
}

console.log(`document sha256: ${documentDigest} (${bytes.length} bytes)`);

if (failures.length > 0) {
  console.error(`\n${htmlPath} is not self-contained:`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log("embedded output is self-contained");
