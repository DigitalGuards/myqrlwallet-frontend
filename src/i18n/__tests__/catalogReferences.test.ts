import english from "@/locales/en";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  catalogReferences,
  productionSources,
  unusedCatalogKeys,
} from "./catalogReferences";

it("references every catalog key from production code", () => {
  expect(
    unusedCatalogKeys(english, catalogReferences(productionSources("src"))),
  ).toEqual([]);
});

it("rejects an orphan even when it is mentioned by a test", () => {
  const references = catalogReferences(productionSources("src"));
  expect(
    unusedCatalogKeys(
      { common: { unusedTranslatorExample: "Unused" } },
      references,
    ),
  ).toEqual(["common:unusedTranslatorExample"]);
  expect(
    unusedCatalogKeys(
      { common: { connectedDapps_one: "One", connectedDapps_other: "Many" } },
      references,
    ),
  ).toEqual([]);
});

it("ignores incidental strings while following translation calls and key models", () => {
  const directory = mkdtempSync(join(tmpdir(), "catalog-reference-"));
  try {
    const path = join(directory, "example.tsx");
    writeFileSync(
      path,
      `
      const { t } = useTranslation("common");
      const incidental = "orphan";
      // t("commentOnly")
      t("used");
      const items = [{ labelKey: "dynamic" }];
      t(item.labelKey);
      <Trans i18nKey="component" />;
    `,
    );
    expect(
      unusedCatalogKeys(
        {
          common: {
            orphan: "Unused",
            commentOnly: "Unused",
            used: "Used",
            dynamic: "Used",
            component: "Used",
          },
        },
        catalogReferences([path]),
      ),
    ).toEqual(["common:commentOnly", "common:orphan"]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
