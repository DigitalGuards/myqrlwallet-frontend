import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { i18nLanguages } from "./i18n-smoke-options.mjs";
import { assertI18nCoverage, requiredI18nPairs } from "./i18n-coverage.mjs";

export async function checkI18nShards(directory, suite) {
  const requiredPairs = requiredI18nPairs(suite);
  const expectedFiles = i18nLanguages
    .map((language) => `${language}.json`)
    .sort();
  assert.deepEqual(
    (await readdir(directory)).sort(),
    expectedFiles,
    "Expected exactly one report file per language; a shard is missing or unexpected",
  );
  const results = [];
  for (const language of i18nLanguages) {
    const report = JSON.parse(
      await readFile(join(directory, `${language}.json`), "utf8"),
    );
    assert.equal(report.version, 1, `${language}: unsupported report version`);
    assert.equal(report.suite, suite, `${language}: wrong smoke suite`);
    assert.equal(report.status, "passed", `${language}: shard did not pass`);
    assert.deepEqual(
      report.languages,
      [language],
      `${language}: wrong shard languages`,
    );
    assertI18nCoverage(report.results, requiredI18nPairs(suite, [language]));
    results.push(...report.results);
  }
  const count = assertI18nCoverage(results, requiredPairs);
  console.log(
    `i18n-shards: ${suite}: all ${i18nLanguages.length} shards passed; ${count} required pairs covered exactly once`,
  );
  return count;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const { values } = parseArgs({
    options: { directory: { type: "string" }, suite: { type: "string" } },
  });
  assert.ok(values.directory, "--directory is required");
  await checkI18nShards(values.directory, values.suite);
}
