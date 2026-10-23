import assert from "node:assert/strict";
import { test } from "node:test";
import { requiredI18nPairs } from "./i18n-required-matrix.mjs";
import {
  assertSmokeResultSchema,
  assertShardReportSchema,
} from "./i18n-report-schema.mjs";
import { smokeResult } from "./i18n-smoke-report.mjs";

for (const suite of ["web", "embedded"]) {
  const pairs = requiredI18nPairs(suite);

  test(`${suite}: schema accepts exactly the declared scenarios in any order for every pair`, () => {
    for (const { language, screen, scenarios } of pairs) {
      const result = smokeResult(
        language,
        screen,
        [],
        [...scenarios].reverse(),
      );
      const original = structuredClone(result);
      assertSmokeResultSchema(result, `${language}/${screen}`, pairs);
      assert.deepEqual(
        result,
        original,
        "Schema validation must preserve the observed report",
      );
    }
  });

  test(`${suite}: schema rejects extra scenarios for every pair, including empty sets`, () => {
    for (const { language, screen, scenarios } of pairs) {
      const result = smokeResult(
        language,
        screen,
        [],
        [...scenarios, "undeclared-scenario"],
      );
      assert.throws(
        () => assertSmokeResultSchema(result, `${language}/${screen}`, pairs),
        /wrong scenario set/,
      );
    }
  });

  for (const { language, screen, scenarios } of pairs) {
    for (const omitted of scenarios) {
      test(`${suite}: schema rejects missing ${omitted} in ${language}/${screen}`, () => {
        const result = smokeResult(
          language,
          screen,
          [],
          scenarios.filter((scenario) => scenario !== omitted),
        );
        assert.throws(
          () => assertSmokeResultSchema(result, `${language}/${screen}`, pairs),
          /wrong scenario set/,
        );
        assert.throws(
          () =>
            assertShardReportSchema(
              {
                version: 2,
                suite,
                languages: [language],
                status: "passed",
                durationSeconds: 1,
                results: [result],
              },
              suite,
              language,
            ),
          /wrong scenario set/,
        );
      });
    }
  }

  for (const [name, scenarios, message] of [
    ["duplicate", ["unexpected", "unexpected"], /duplicate scenarios/],
    ["string", "unexpected", /expected an array of strings/],
    ["null", null, /expected an array of strings/],
    ["object", {}, /expected an array of strings/],
    ["nested array", [["unexpected"]], /expected string entries/],
    ["non-string entry", [1], /expected string entries/],
  ]) {
    test(`${suite}: schema rejects ${name} scenarios`, () => {
      const { language, screen } = pairs[0];
      const result = smokeResult(language, screen, [], scenarios);
      assert.throws(
        () => assertSmokeResultSchema(result, `${language}/${screen}`, pairs),
        message,
      );
    });
  }
}
