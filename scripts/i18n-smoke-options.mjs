import assert from "node:assert/strict";
import { parseArgs } from "node:util";

export const i18nLanguages = ["en", "de", "es", "ru", "zh-CN"];

export function smokeLanguages(args = process.argv.slice(2)) {
  const { values } = parseArgs({
    args,
    options: { languages: { type: "string" } },
  });
  if (values.languages === undefined) return [...i18nLanguages];
  const selected = values.languages.split(",").map((value) => value.trim());
  assert.equal(new Set(selected).size, selected.length, "Duplicate languages");
  for (const language of selected)
    assert.ok(
      i18nLanguages.includes(language),
      `Unknown language: ${language}`,
    );
  // Keep the same order as the full run, regardless of CLI argument order.
  return i18nLanguages.filter((language) => selected.includes(language));
}
