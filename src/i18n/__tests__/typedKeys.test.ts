import ts from "typescript";
import { resolve } from "node:path";

it("rejects missing and misspelled keys, including calls with a default value", () => {
  const fixture = resolve("src/i18n/typecheck-fixture.ts");
  const source = `
    import { i18n } from './index';
    const t = i18n.getFixedT('en', 'home');
    t('activeAccount');
    i18n.getFixedT('en', 'dapps')('sessionsSubtitle');
    i18n.getFixedT('en', 'telegram')('security');
    i18n.getFixedT('en', 'notices')('unsupportedV3');
    i18n.getFixedT('en', 'dapps')('missingApproval', { defaultValue: 'fallback' });
    i18n.getFixedT('en', 'telegram')('missingTelegram');
    i18n.getFixedT('en', 'notices')('missingNotice');
    t('activAccount');
    t('missing', { defaultValue: 'fallback' });
    i18n.getFixedT('en', 'transfer')('recipientChanged');
    i18n.getFixedT('en', 'accounts')('active');
    i18n.getFixedT('en', 'contacts')('addTitle');
    i18n.getFixedT('en', 'history')('detailsTitle');
    i18n.getFixedT('en', 'transfer')('recipentChanged');
    i18n.getFixedT('en', 'accounts')('missingAccount', { defaultValue: 'fallback' });
    i18n.getFixedT('en', 'contacts')('missingContact');
    i18n.getFixedT('en', 'history')('detailTitle');
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
  expect(errors).toHaveLength(9);
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
