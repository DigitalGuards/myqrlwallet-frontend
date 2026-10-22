import assert from "node:assert/strict";
import requiredScreens from "./i18n-required-screens.json" with { type: "json" };

/** Keep the complete reviewed matrix mandatory, including every language. */
export function assertFullI18nCoverage(results) {
  const completed = new Set(
    results.map(({ language, screen }) => `${language}/${screen}`),
  );
  const missing = ["en", "de", "es", "ru", "zh-CN"].flatMap((language) =>
    requiredScreens
      .filter((screen) => !completed.has(`${language}/${screen}`))
      .map((screen) => `${language}/${screen}`),
  );
  assert.deepEqual(
    missing,
    [],
    `Full language smoke is missing ${missing.length} required checks: ${missing.join(", ")}`,
  );
}
