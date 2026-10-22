import ts from "typescript";
import { resolve } from "node:path";

it("rejects missing and misspelled keys, including calls with a default value", () => {
  const fixture = resolve("src/i18n/typecheck-fixture.ts");
  const source = `
    import { i18n } from './index';
    const t = i18n.getFixedT('en', 'home');
    t('activeAccount');
    t('activAccount');
    t('missing', { defaultValue: 'fallback' });
  `;
  const options: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    resolveJsonModule: true,
    allowSyntheticDefaultImports: true,
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    baseUrl: ".",
    paths: { "@/*": ["src/*"] },
  };
  const host = ts.createCompilerHost(options);
  const original = host.getSourceFile.bind(host);
  host.getSourceFile = (name, languageVersion, onError, shouldCreate) =>
    name === fixture
      ? ts.createSourceFile(name, source, languageVersion, true)
      : original(name, languageVersion, onError, shouldCreate);
  const program = ts.createProgram(
    [fixture, resolve("src/i18n/i18next.d.ts")],
    options,
    host,
  );
  const errors = ts
    .getPreEmitDiagnostics(program)
    .filter(
      (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
    );
  expect(errors).toHaveLength(2);
  expect(errors.every((error) => error.file?.fileName === fixture)).toBe(true);
  expect(
    errors
      .map((error) => ts.flattenDiagnosticMessageText(error.messageText, "\n"))
      .join("\n"),
  ).toMatch(/activAccount/);
  expect(
    errors
      .map((error) => ts.flattenDiagnosticMessageText(error.messageText, "\n"))
      .join("\n"),
  ).toMatch(/missing/);
}, 30000);
