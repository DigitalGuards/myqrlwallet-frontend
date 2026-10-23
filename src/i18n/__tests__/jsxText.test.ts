import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import coverage from "../coverage.json";
import { jsxTextFindings } from "./jsxText";

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "__tests__") return [];
    const file = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(file);
    return /\.tsx$/.test(file) && !/\.(test|spec)\.tsx$/.test(file)
      ? [file]
      : [];
  });
}

it("keeps converted JSX translated except the original approval error fallback", () => {
  const files = [
    ...sourceFiles("src/components"),
    "src/App.tsx",
    "src/router/router.tsx",
  ].filter((file) => coverage.some((scope) => file.startsWith(scope)));
  expect(files.length).toBeGreaterThan(25);
  expect(
    files
      .flatMap((file) => jsxTextFindings(readFileSync(file, "utf8"), file))
      .map((finding) => finding.replace(/:\d+: /, ": ")),
  ).toEqual([
    // Error details retain the base English rendering until producers carry origin and keys.
    "src/components/Core/Body/DAppConnect/DAppApprovalModal.tsx: Transaction status is unavailable.",
  ]);
});

it("leaves visible copy outside coverage only in the five legal pages", () => {
  const files = sourceFiles("src").filter(
    (file) => !coverage.some((scope) => file.startsWith(scope)),
  );
  expect(
    files
      .filter(
        (file) => jsxTextFindings(readFileSync(file, "utf8"), file).length > 0,
      )
      .sort(),
  ).toEqual([
    "src/components/Core/Body/Disclaimer/Disclaimer.tsx",
    "src/components/Core/Body/Legal/Legal.tsx",
    "src/components/Core/Body/Privacy/Privacy.tsx",
    "src/components/Core/Body/Security/Security.tsx",
    "src/components/Core/Body/Terms/Terms.tsx",
  ]);
});

it.each([
  "<p>Forgotten copy</p>",
  '<input placeholder="Enter an address" />',
  '<button aria-label={active ? "Hide" : "Show"} />',
  "<p>{`${count} tokens`}</p>",
  '<p>{busy && "Loading"}</p>',
  'const column = { header: "Balance" };',
])(
  "rejects literal JSX text, attributes, conditional copy and columns: %s",
  (source) => {
    expect(jsxTextFindings(source).length).toBeGreaterThan(0);
  },
);

it("allows translations, product terms, data and non-copy attributes", () => {
  expect(
    jsxTextFindings(
      '<div className="flex" data-testid="panel"><p>{t("home:receive")}</p><p>Quanta</p><span>{address}</span></div>',
    ),
  ).toEqual([]);
});
