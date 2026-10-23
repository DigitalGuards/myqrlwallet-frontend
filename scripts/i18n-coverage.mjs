import assert from "node:assert/strict";
import { i18nLanguages } from "./i18n-smoke-options.mjs";
import { assertSmokeResultSchema } from "./i18n-report-schema.mjs";
import { requiredI18nPairs } from "./i18n-required-matrix.mjs";
export { requiredI18nPairs } from "./i18n-required-matrix.mjs";

/** Keep the complete reviewed matrix mandatory, including every language. */
export function assertFullI18nCoverage(results, languages = i18nLanguages) {
  return assertI18nCoverage(results, requiredI18nPairs("web", languages));
}

export function assertEmbeddedI18nCoverage(results, languages = i18nLanguages) {
  return assertI18nCoverage(results, requiredI18nPairs("embedded", languages));
}

export function assertI18nCoverage(results, requiredPairs) {
  assert.ok(Array.isArray(results), "Expected an array of smoke results");
  results.forEach((result, index) =>
    assertSmokeResultSchema(result, `results[${index}]`, requiredPairs),
  );
  const key = ({ language, screen }) => `${language}/${screen}`;
  const expected = new Set(requiredPairs.map(key));
  assert.equal(expected.size, requiredPairs.length, "Duplicate required pairs");
  const completed = new Set();
  for (const result of results) {
    const pair = key(result);
    assert.ok(expected.has(pair), `Unexpected language/screen pair: ${pair}`);
    assert.ok(!completed.has(pair), `Duplicate language/screen pair: ${pair}`);
    assert.equal(result.pass, true, `${pair}: pair did not pass`);
    assert.equal(result.fail, false, `${pair}: pair failed`);
    assert.deepEqual(result.problems, [], `${pair}: smoke problems`);
    completed.add(pair);
  }
  const missing = [...expected].filter((pair) => !completed.has(pair));
  assert.deepEqual(
    missing,
    [],
    `Missing required pairs: ${missing.join(", ")}`,
  );
  return completed.size;
}
