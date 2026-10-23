import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { i18nLanguages } from "./i18n-smoke-options.mjs";
import { assertI18nCoverage, requiredI18nPairs } from "./i18n-coverage.mjs";
import { assertShardReportSchema } from "./i18n-report-schema.mjs";

export async function checkI18nShards(directory, suite) {
  const requiredPairs = requiredI18nPairs(suite);
  const expectedArtifacts = i18nLanguages
    .map((language) => `i18n-${suite}-${language}`)
    .sort();
  const artifacts = await readdir(directory, { withFileTypes: true });
  assert.deepEqual(
    artifacts.map((entry) => entry.name).sort(),
    expectedArtifacts,
    "Expected exactly one artifact directory per language; an artifact is missing or unexpected",
  );
  for (const artifact of artifacts)
    assert.ok(
      artifact.isDirectory(),
      `${artifact.name}: expected an artifact directory`,
    );
  const reports = [];
  for (const language of i18nLanguages) {
    const artifact = `i18n-${suite}-${language}`;
    const artifactDirectory = join(directory, artifact);
    const files = await readdir(artifactDirectory, { withFileTypes: true });
    assert.deepEqual(
      files.map((entry) => entry.name),
      [`${language}.json`],
      `${artifact}: expected exactly one report named ${language}.json`,
    );
    assert.ok(files[0].isFile(), `${artifact}: expected a regular report file`);
    const report = JSON.parse(
      await readFile(join(artifactDirectory, `${language}.json`), "utf8"),
    );
    assertShardReportSchema(report, suite, language);
    assert.equal(report.status, "passed", `${language}: shard did not pass`);
    assertI18nCoverage(report.results, requiredI18nPairs(suite, [language]));
    reports.push(report);
  }
  // Combine only after every artifact and its own report have passed.
  const results = reports.flatMap((report) => report.results);
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
