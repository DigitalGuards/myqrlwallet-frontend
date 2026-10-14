#!/usr/bin/env node
// Existing lint debt, including tests, is a set of exact file/rule pairs.
// Regeneration removes resolved pairs and refuses additions.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import {
  baseConfig,
  lintRatchet,
  strictFiles,
} from "../config/eslint.config.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const configPath = path.join(root, "config/eslint.config.js");
const check = process.argv.includes("--check");
if (process.argv.slice(2).some((arg) => arg !== "--check")) {
  throw new Error("Usage: node scripts/lint-ratchet.mjs [--check]");
}
const start = "// BEGIN LINT RATCHET";
const end = "// END LINT RATCHET";
const source = await readFile(configPath, "utf8");
const from = source.indexOf(start);
const to = source.indexOf(end);
if (
  from < 0 ||
  to < from ||
  source.indexOf(start, from + 1) !== -1 ||
  source.indexOf(end, to + 1) !== -1
) {
  throw new Error("Expected one lint ratchet block in config/eslint.config.js");
}

const eslint = new ESLint({
  cwd: root,
  // Inline suppressions are recorded in the ratchet with every other finding.
  allowInlineConfig: false,
  overrideConfigFile: true,
  overrideConfig: baseConfig,
});
const results = await eslint.lintFiles(strictFiles);
const current = new Map();
let reports = 0;
for (const result of results) {
  const file = path.relative(root, result.filePath).split(path.sep).join("/");
  for (const message of result.messages) {
    if (message.fatal || !message.ruleId) {
      throw new Error(`${file}:${message.line}: ${message.message}`);
    }
    if (!current.has(file)) current.set(file, new Set());
    current.get(file).add(message.ruleId);
    reports += 1;
  }
}

const previous = new Set();
for (const entry of lintRatchet) {
  if (
    entry.files.length !== 1 ||
    Object.keys(entry).sort().join() !== "files,rules"
  ) {
    throw new Error(
      "Ratchet entries must contain one exact file and its rules",
    );
  }
  const [file] = entry.files;
  if (
    !(
      file.startsWith("src/") ||
      file.startsWith("config/") ||
      file.startsWith("public/")
    ) ||
    /[*?{}[\]!]/u.test(file) ||
    file.includes("\\") ||
    path.posix.normalize(file) !== file
  ) {
    throw new Error(
      `Ratchet file must be an exact src/, config/, or public/ path: ${file}`,
    );
  }
  for (const [rule, severity] of Object.entries(entry.rules)) {
    const pair = `${file}: ${rule}`;
    if (severity !== "off" || previous.has(pair)) {
      throw new Error(`Invalid or duplicate ratchet pair: ${pair}`);
    }
    previous.add(pair);
  }
}
const pairs = new Set(
  [...current].flatMap(([file, rules]) =>
    [...rules].map((rule) => `${file}: ${rule}`),
  ),
);
const added = [...pairs].filter((pair) => !previous.has(pair)).sort();
const stale = [...previous].filter((pair) => !pairs.has(pair)).sort();
if (added.length) {
  console.error(
    `lint-ratchet: fix ${added.length} new file/rule pairs:\n${added.join("\n")}`,
  );
  process.exit(1);
}
if (check && stale.length) {
  console.error(
    `lint-ratchet: remove ${stale.length} stale pairs with npm run lint:ratchet:update:\n${stale.join("\n")}`,
  );
  process.exit(1);
}

const lines = [start, "export const lintRatchet = ["];
for (const file of [...current.keys()].sort()) {
  const filesLine = `    files: [${JSON.stringify(file)}],`;
  lines.push("  {");
  if (filesLine.length <= 80) {
    lines.push(filesLine);
  } else {
    lines.push("    files: [", `      ${JSON.stringify(file)},`, "    ],");
  }
  lines.push("    rules: {");
  for (const rule of [...current.get(file)].sort()) {
    lines.push(`      ${JSON.stringify(rule)}: "off",`);
  }
  lines.push("    },", "  },");
}
lines.push("];", end);
const block = lines.join("\n");
const oldBlock = source.slice(from, to + end.length);
if (check && oldBlock !== block) {
  console.error(
    "lint-ratchet: block must be sorted and canonical; run npm run lint:ratchet:update",
  );
  process.exit(1);
}
if (!check && oldBlock !== block) {
  await writeFile(
    configPath,
    source.slice(0, from) + block + source.slice(to + end.length),
  );
}
console.log(
  `lint-ratchet: OK (${pairs.size} pairs, ${current.size} files, ${reports} reports${check ? "" : `, ${stale.length} pairs removed`})`,
);
