import ts from "typescript";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function productionSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (/^(?:__tests__|test-utils|locales)$/.test(entry.name)) return [];
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return productionSources(path);
    return /\.tsx?$/.test(path) && !/\.(?:test|spec|d)\.tsx?$/.test(path)
      ? [path]
      : [];
  });
}

/** Count code references, including typed key models and Trans component tags. */
export function catalogReferences(paths: string[]): Set<string> {
  const references = new Set<string>();
  for (const path of paths) {
    const source = ts.createSourceFile(
      path,
      readFileSync(path, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    const namespaces = new Set<string>();
    const keyProperties = new Set<string>();
    const literals = (node: ts.Node, visit: (text: string) => void) => {
      if (ts.isStringLiteralLike(node)) visit(node.text);
      ts.forEachChild(node, (child) => {
        literals(child, visit);
      });
    };
    const scanNamespaces = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "t"
      ) {
        const key = node.arguments[0];
        if (key && ts.isPropertyAccessExpression(key))
          keyProperties.add(key.name.text);
      }
      if (
        ts.isCallExpression(node) &&
        node.expression.getText(source) === "useTranslation"
      ) {
        const ns = node.arguments[0];
        if (ns) literals(ns, (text) => namespaces.add(text));
        else namespaces.add("common");
      }
      if (
        ts.isJsxAttribute(node) &&
        node.name.getText(source) === "ns" &&
        node.initializer
      )
        literals(node.initializer, (text) => namespaces.add(text));
      if (
        ts.isTypeReferenceNode(node) &&
        node.typeName.getText(source) === "TFunction"
      ) {
        const ns = node.typeArguments?.[0];
        if (ns) literals(ns, (text) => namespaces.add(text));
        else namespaces.add("common");
      }
      ts.forEachChild(node, scanNamespaces);
    };
    scanNamespaces(source);
    const add = (text: string) => {
      if (
        /^(common|home|settings|tokens|history|transfer|accounts|contacts|onboarding):[\w.]+$/.test(
          text,
        )
      )
        references.add(text);
      else for (const ns of namespaces) references.add(`${ns}:${text}`);
    };
    const visit = (node: ts.Node) => {
      // Follow properties passed to t(), such as navigation's item.labelKey.
      if (
        ts.isPropertyAssignment(node) &&
        keyProperties.has(node.name.getText(source))
      )
        literals(node.initializer, add);
      // Fully qualified literals also cover typed navigation/error/status models.
      if (
        ts.isStringLiteralLike(node) &&
        /^(common|home|settings|tokens|history|transfer|accounts|contacts|onboarding):[\w.]+$/.test(
          node.text,
        )
      )
        add(node.text);
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "t" &&
        node.arguments[0]
      ) {
        literals(node.arguments[0], add);
      }
      if (
        ts.isJsxAttribute(node) &&
        node.name.getText(source) === "i18nKey" &&
        node.initializer
      )
        literals(node.initializer, add);
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return references;
}

export function unusedCatalogKeys(
  catalogs: Record<string, Record<string, string>>,
  references: Set<string>,
): string[] {
  return Object.entries(catalogs)
    .flatMap(([namespace, catalog]) =>
      Object.keys(catalog)
        .filter(
          (key) =>
            !references.has(
              `${namespace}:${key.replace(/_(one|few|many|other)$/, "")}`,
            ),
        )
        .map((key) => `${namespace}:${key}`),
    )
    .sort();
}
