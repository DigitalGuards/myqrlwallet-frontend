import assert from "node:assert/strict";
import { parseArgs } from "node:util";

export const i18nLanguages = ["en", "de", "es", "ru", "zh-CN"];

export function smokeLanguages(
  args = process.argv.slice(2),
  supported = i18nLanguages,
) {
  const { values } = parseArgs({
    args,
    options: { languages: { type: "string" } },
  });
  if (values.languages === undefined) return [...supported];
  const selected = values.languages.split(",").map((value) => value.trim());
  assert.equal(new Set(selected).size, selected.length, "Duplicate languages");
  for (const language of selected)
    assert.ok(
      supported.includes(language),
      `Unknown language: ${language}`,
    );
  // Keep the same order as the full run, regardless of CLI argument order.
  return supported.filter((language) => selected.includes(language));
}
