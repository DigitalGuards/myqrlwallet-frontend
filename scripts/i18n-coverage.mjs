import assert from "node:assert/strict";
import requiredScreens from "./i18n-required-screens.json" with { type: "json" };
import embeddedScreens from "./i18n-required-embedded-screens.json" with { type: "json" };
import { i18nLanguages } from "./i18n-smoke-options.mjs";

/** Keep the complete reviewed matrix mandatory, including every language. */
export function assertFullI18nCoverage(results, languages = i18nLanguages) {
  return assertI18nCoverage(results, requiredI18nPairs("web", languages));
}

export function assertEmbeddedI18nCoverage(results, languages = i18nLanguages) {
  return assertI18nCoverage(results, requiredI18nPairs("embedded", languages));
}

export function requiredI18nPairs(suite, languages = i18nLanguages) {
  assert.ok(
    ["web", "embedded"].includes(suite),
    `Unknown smoke suite: ${suite}`,
  );
  return languages.flatMap((language) => {
    assert.ok(
      i18nLanguages.includes(language),
      `Unknown language: ${language}`,
    );
    const screens =
      suite === "web"
        ? requiredScreens
        : [...embeddedScreens.common, ...embeddedScreens.byLanguage[language]];
    return screens.map((screen) => ({ language, screen }));
  });
}

export function assertI18nCoverage(results, requiredPairs) {
  assert.ok(Array.isArray(results), "Expected an array of smoke results");
  const key = ({ language, screen }) => `${language}/${screen}`;
  const expected = new Set(requiredPairs.map(key));
  assert.equal(expected.size, requiredPairs.length, "Duplicate required pairs");
  const completed = new Set();
  for (const result of results) {
    const pair = key(result);
    assert.ok(expected.has(pair), `Unexpected language/screen pair: ${pair}`);
    assert.ok(!completed.has(pair), `Duplicate language/screen pair: ${pair}`);
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
