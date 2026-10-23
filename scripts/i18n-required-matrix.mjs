import assert from "node:assert/strict";
import requiredScreens from "./i18n-required-screens.json" with { type: "json" };
import embeddedScreens from "./i18n-required-embedded-screens.json" with { type: "json" };
import { i18nLanguages } from "./i18n-smoke-options.mjs";

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
        ? Object.entries(requiredScreens)
        : [
            ...Object.entries(embeddedScreens.common),
            ...Object.entries(embeddedScreens.byLanguage[language]),
          ];
    return screens.map(([screen, scenarios]) => {
      assert.ok(
        Array.isArray(scenarios) &&
          scenarios.every((scenario) => typeof scenario === "string"),
        `${suite}/${screen}: required scenarios must be an array of strings`,
      );
      assert.equal(
        new Set(scenarios).size,
        scenarios.length,
        `${suite}/${screen}: duplicate required scenarios`,
      );
      return { language, screen, scenarios: [...scenarios] };
    });
  });
}
