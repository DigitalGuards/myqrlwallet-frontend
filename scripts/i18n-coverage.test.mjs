import assert from "node:assert/strict";
import { test } from "node:test";
import { assertI18nCoverage, requiredI18nPairs } from "./i18n-coverage.mjs";
import { smokeResult } from "./i18n-smoke-report.mjs";

for (const suite of ["web", "embedded"]) {
  const pairs = requiredI18nPairs(suite);
  const results = () =>
    pairs.map(({ language, screen }) => smokeResult(language, screen));

  test(`${suite}: coverage accepts every required pair with strict boolean outcomes`, () => {
    assert.equal(assertI18nCoverage(results(), pairs), pairs.length);
  });

  for (const field of ["language", "screen"]) {
    test(`${suite}: coverage rejects array-coerced ${field} before building keys`, () => {
      const records = results();
      records[0][field] = [records[0][field]];
      assert.throws(
        () => assertI18nCoverage(records, pairs),
        /expected a string/,
      );
    });
    test(`${suite}: coverage never calls an object's ${field} coercion`, () => {
      const records = results();
      const value = records[0][field];
      let coerced = false;
      records[0][field] = {
        toString() {
          coerced = true;
          return value;
        },
      };
      assert.throws(
        () => assertI18nCoverage(records, pairs),
        /expected a string/,
      );
      assert.equal(coerced, false);
    });
  }

  test(`${suite}: coverage rejects failed pairs, duplicates and missing pairs`, () => {
    const failed = results();
    failed[0] = smokeResult(failed[0].language, failed[0].screen, ["overflow"]);
    assert.throws(() => assertI18nCoverage(failed, pairs), /pair did not pass/);
    const duplicate = results();
    duplicate.push(duplicate[0]);
    assert.throws(
      () => assertI18nCoverage(duplicate, pairs),
      /Duplicate language\/screen pair/,
    );
    assert.throws(
      () => assertI18nCoverage(results().slice(1), pairs),
      /Missing required pairs/,
    );
  });
}
