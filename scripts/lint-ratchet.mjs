#!/usr/bin/env node
// Existing lint debt, including tests, is a set of exact file/rule pairs.
// Regeneration removes resolved pairs; CI compares allowances with a Git base.
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { ESLint } from "eslint";
import { parser } from "typescript-eslint";
import {
  baseConfig,
  lintRatchet,
  strictFiles,
} from "../config/eslint.config.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const configPath = path.join(root, "config/eslint.config.js");
const { values } = parseArgs({
  options: { check: { type: "boolean" }, "base-ref": { type: "string" } },
});
const check = values.check ?? false;
const baseRef = values["base-ref"];
if (baseRef !== undefined && !baseRef.trim()) {
  throw new Error("--base-ref must be a Git ref");
}
const start = "// BEGIN LINT RATCHET";
const end = "// END LINT RATCHET";
const source = await readFile(configPath, "utf8");
const { from, to } = blockBounds(source);
const previous = collectPairs(lintRatchet);

if (baseRef !== undefined) {
  const git = (args) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" });
  const commit = git([
    "rev-parse",
    "--verify",
    "--end-of-options",
    `${baseRef}^{commit}`,
  ]).trim();
  const baseSource = git(["show", `${commit}:config/eslint.config.js`]);
  const bounds = blockBounds(baseSource, true);
  if (bounds === null) {
    console.log(
      `lint-ratchet: ${baseRef} has no ratchet block yet; initial baseline allowed`,
    );
  } else {
    // Read only the literal data block. Never execute a historical config or
    // depend on its imports matching the current installation.
    const block = baseSource.slice(bounds.from + start.length, bounds.to);
    const baseline = collectPairs(parseRatchet(block));
    const grown = [...previous].filter((pair) => !baseline.has(pair)).sort();
    if (grown.length) {
      console.error(
        `lint-ratchet: ${grown.length} pairs added against ${baseRef}; only removals are allowed:\n${grown.join("\n")}`,
      );
      process.exit(1);
    }
    console.log(
      `lint-ratchet: shrink-only comparison passed against ${baseRef} (${commit})`,
    );
  }
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

function blockBounds(text, allowMissing = false) {
  const from = text.indexOf(start);
  const to = text.indexOf(end);
  if (allowMissing && from === -1 && to === -1) return null;
  if (
    from < 0 ||
    to < from ||
    text.indexOf(start, from + 1) !== -1 ||
    text.indexOf(end, to + 1) !== -1
  ) {
    throw new Error(
      "Expected one lint ratchet block in config/eslint.config.js",
    );
  }
  return { from, to };
}

function parseRatchet(block) {
  const { body } = parser.parseForESLint(block, {
    sourceType: "module",
    ecmaVersion: "latest",
  }).ast;
  const statement = body[0];
  const declaration = statement?.declaration;
  if (
    body.length !== 1 ||
    statement.type !== "ExportNamedDeclaration" ||
    declaration?.type !== "VariableDeclaration" ||
    declaration.kind !== "const" ||
    declaration.declarations.length !== 1 ||
    declaration.declarations[0].id.type !== "Identifier" ||
    declaration.declarations[0].id.name !== "lintRatchet"
  ) {
    throw new Error(
      "Expected an exported const lintRatchet data block in the base config",
    );
  }
  return readLiteral(declaration.declarations[0].init);
}

function readLiteral(node) {
  if (node?.type === "Literal" && typeof node.value === "string")
    return node.value;
  if (node?.type === "ArrayExpression") return node.elements.map(readLiteral);
  if (node?.type === "ObjectExpression") {
    const entries = node.properties.map((property) => {
      if (
        property.type !== "Property" ||
        property.computed ||
        property.method ||
        property.shorthand ||
        property.kind !== "init"
      ) {
        throw new Error("Ratchet objects must contain literal properties");
      }
      const key =
        property.key.type === "Identifier"
          ? property.key.name
          : readLiteral(property.key);
      return [key, readLiteral(property.value)];
    });
    if (new Set(entries.map(([key]) => key)).size !== entries.length) {
      throw new Error("Duplicate property in the base ratchet");
    }
    return Object.fromEntries(entries);
  }
  throw new Error("Ratchet data must contain only arrays, objects and strings");
}

function collectPairs(entries) {
  if (!Array.isArray(entries)) throw new Error("Ratchet must be an array");
  const pairs = new Set();
  for (const entry of entries) {
    if (
      !entry ||
      !Array.isArray(entry.files) ||
      entry.files.length !== 1 ||
      Object.keys(entry).sort().join() !== "files,rules" ||
      !entry.rules ||
      typeof entry.rules !== "object" ||
      Array.isArray(entry.rules)
    ) {
      throw new Error(
        "Ratchet entries must contain one exact file and its rules",
      );
    }
    const [file] = entry.files;
    if (
      typeof file !== "string" ||
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
      if (severity !== "off" || pairs.has(pair)) {
        throw new Error(`Invalid or duplicate ratchet pair: ${pair}`);
      }
      pairs.add(pair);
    }
  }
  return pairs;
}
