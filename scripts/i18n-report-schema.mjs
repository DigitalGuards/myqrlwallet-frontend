import assert from "node:assert/strict";
import { i18nLanguages } from "./i18n-smoke-options.mjs";

function exactFields(value, fields, label) {
  assert.ok(
    value !== null && typeof value === "object" && !Array.isArray(value),
    `${label}: expected an object`,
  );
  assert.deepEqual(
    Object.keys(value).sort(),
    [...fields].sort(),
    `${label}: unexpected or missing fields (expected ${fields.join(", ")})`,
  );
}

function stringList(value, label) {
  assert.ok(Array.isArray(value), `${label}: expected an array of strings`);
  for (const item of value)
    assert.equal(typeof item, "string", `${label}: expected string entries`);
}

export function assertSmokeResultSchema(result, label) {
  exactFields(
    result,
    ["language", "screen", "pass", "fail", "problems", "scenarios"],
    label,
  );
  assert.equal(
    typeof result.language,
    "string",
    `${label}.language: expected a string`,
  );
  assert.ok(
    i18nLanguages.includes(result.language),
    `${label}: unknown language`,
  );
  assert.equal(
    typeof result.screen,
    "string",
    `${label}.screen: expected a string`,
  );
  assert.equal(
    typeof result.pass,
    "boolean",
    `${label}.pass: expected a boolean`,
  );
  assert.equal(
    typeof result.fail,
    "boolean",
    `${label}.fail: expected a boolean`,
  );
  assert.notEqual(
    result.pass,
    result.fail,
    `${label}: pass and fail must be opposites`,
  );
  stringList(result.problems, `${label}.problems`);
  stringList(result.scenarios, `${label}.scenarios`);
  assert.equal(
    new Set(result.scenarios).size,
    result.scenarios.length,
    `${label}: duplicate scenarios`,
  );
}

export function assertShardReportSchema(report, suite, language) {
  const label = `${language}.json`;
  exactFields(
    report,
    ["version", "suite", "languages", "status", "results", "durationSeconds"],
    label,
  );
  assert.equal(report.version, 2, `${label}: unsupported report version`);
  assert.equal(
    typeof report.suite,
    "string",
    `${label}.suite: expected a string`,
  );
  assert.equal(report.suite, suite, `${label}: wrong smoke suite`);
  stringList(report.languages, `${label}.languages`);
  assert.deepEqual(
    report.languages,
    [language],
    `${label}: wrong shard languages`,
  );
  assert.equal(
    typeof report.status,
    "string",
    `${label}.status: expected a string`,
  );
  assert.ok(
    ["passed", "failed"].includes(report.status),
    `${label}: invalid shard status`,
  );
  assert.ok(
    typeof report.durationSeconds === "number" &&
      Number.isFinite(report.durationSeconds) &&
      report.durationSeconds >= 0,
    `${label}.durationSeconds: expected a finite nonnegative number`,
  );
  assert.ok(
    Array.isArray(report.results),
    `${label}.results: expected an array`,
  );
  report.results.forEach((result, index) =>
    assertSmokeResultSchema(result, `${label}.results[${index}]`),
  );
}
