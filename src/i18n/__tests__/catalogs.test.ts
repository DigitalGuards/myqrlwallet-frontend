import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { languages } from "../languages";
import { namespaces } from "../index";

function flatten(value: unknown, prefix = ""): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`Invalid catalog: ${prefix}`);
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, entry]: [string, unknown]) => {
      const path = prefix ? `${prefix}.${key}` : key;
      if (typeof entry === "string") {
        if (!entry.trim()) throw new Error(`Empty translation: ${path}`);
        return [[path, entry]];
      }
      return Object.entries(flatten(entry, path));
    }),
  );
}
const readCatalog = (language: string, namespace: string) => {
  const value: unknown = JSON.parse(
    readFileSync(join("src/locales", language, `${namespace}.json`), "utf8"),
  );
  return flatten(value);
};
const placeholders = (text: string) =>
  [...text.matchAll(/{{\s*([^}]+?)\s*}}|<\/?([\w]+)\s*\/?\s*>/g)]
    .map((match) => match[1] ?? match[2])
    .sort();

for (const { code } of languages) {
  it(`${code} has exactly the source namespaces, keys, placeholders and markup`, () => {
    expect(
      readdirSync(join("src/locales", code))
        .filter((file) => file.endsWith(".json") && !file.startsWith("_"))
        .sort(),
    ).toEqual(namespaces.map((ns) => `${ns}.json`).sort());
    for (const ns of namespaces) {
      const english = readCatalog("en", ns);
      const translated = readCatalog(code, ns);
      expect(Object.keys(translated).sort()).toEqual(
        Object.keys(english).sort(),
      );
      for (const [key, text] of Object.entries(english)) {
        expect(placeholders(translated[key] ?? "")).toEqual(placeholders(text));
        for (const term of ["Quanta", "QRL 2.0", "MyQRLWallet", "PIN"]) {
          if (text.includes(term)) expect(translated[key]).toContain(term);
        }
      }
    }
  });
}

it("keeps English copy within the writing rules", () => {
  for (const ns of namespaces) {
    for (const value of Object.values(readCatalog("en", ns))) {
      expect(value).not.toMatch(/\u2014|rather than|instead of|, not /i);
    }
  }
});

it("ships importable translator notes for ambiguous and security-sensitive messages", () => {
  const notes = readCatalog("en", "_notes");
  const keys = new Set(
    namespaces.flatMap((ns) =>
      Object.keys(readCatalog("en", ns)).map(
        (key) => `${ns}:${key.replace(/_(one|few|many|other)$/, "")}`,
      ),
    ),
  );
  for (const [key, note] of Object.entries(notes)) {
    expect(keys.has(key)).toBe(true);
    expect(note.length).toBeGreaterThan(20);
    expect(note).not.toMatch(/\u2014/);
  }
  for (const key of [
    "settings:seedMismatch",
    "settings:exportDescription",
    "settings:credentialPin",
    "settings:lockout",
    "tokens:addReason",
    "tokens:fetchReason",
    "home:installMobile",
    "home:pairingFailed",
    "common:lock",
    "common:mainnet",
    "common:testnet",
  ])
    expect(notes[key]).toBeDefined();
});
