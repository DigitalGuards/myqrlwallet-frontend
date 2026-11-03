/** @jest-environment jsdom */
import { readdirSync } from "node:fs";
import { slice6ErrorParity, slice6Languages } from "./slice6ErrorParity";

slice6ErrorParity("en");

// One file per language replaces a describe.each over all five, so a missing
// file would silently drop a language.
it("keeps one slice 6 error parity file per language", () => {
  const files = readdirSync(__dirname).filter((name) =>
    /^slice6ErrorParity\..+\.test\.tsx$/u.test(name),
  );
  const expected = slice6Languages.map(
    (language) => `slice6ErrorParity.${language}.test.tsx`,
  );
  expect([...files].sort()).toEqual([...expected].sort());
});
