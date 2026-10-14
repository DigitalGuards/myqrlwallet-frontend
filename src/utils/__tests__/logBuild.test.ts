import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

// Class: moving a restricted call into a shared sink leaves the violation there.
// Aliases can also hide that violation while keeping its effect.
it('requires zero lint violations throughout the slice, including the shared sink', () => {
  const script = String.raw`
    import assert from 'node:assert/strict';
    import { readFileSync } from 'node:fs';
    import { ESLint } from 'eslint';
    import ts from 'typescript';
    import { baseConfig } from './config/eslint.config.js';
    const eslint = new ESLint({ overrideConfigFile: true, overrideConfig: baseConfig });
    const checkReferences = (source, path) => {
      const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
      const visit = node => {
        if ((ts.isIdentifier(node) || ts.isStringLiteral(node)) && node.text === 'console') {
          const member = node.parent;
          assert.ok(
            ts.isIdentifier(node) &&
            (ts.isPropertyAccessExpression(member) || ts.isElementAccessExpression(member)) &&
            member.expression === node && ts.isCallExpression(member.parent) &&
            member.parent.expression === member,
            path + ': console must be the direct receiver of a lint-visible call'
          );
        }
        ts.forEachChild(node, visit);
      };
      visit(ast);
    };
    // Prove the check rejects the reported alias and related escape shapes.
    for (const source of [
      'const sink = console; sink.warn("diagnostic");',
      'createLogger(() => console);',
      'const { warn } = console; warn("diagnostic");',
      'const warn = console.warn.bind(console); warn("diagnostic");',
      'globalThis.console.warn("diagnostic");',
      'globalThis["console"].warn("diagnostic");',
    ]) assert.throws(() => checkReferences(source, 'alias-probe.ts'));
    const violations = [];
    for (const name of [
      'addressBook', 'embeddedMigration', 'embeddedMigrationBoot', 'embeddedRuntime',
      'errors', 'guards', 'log', 'logout', 'nativeBack', 'nativeWalletMutation',
      'navigation', 'useBackDismiss', 'walletEpoch', 'extension/extensionConnection',
      'formatting/balance', 'formatting/string',
    ]) {
      const path = 'src/utils/' + name + '.ts';
      const config = await eslint.calculateConfigForFile(path);
      assert.equal(config.rules['no-console'][0], 2, path);
      assert.deepEqual(config.rules['no-console'][1]?.allow ?? [], [], path);
      for (const level of ['log', 'info', 'warn', 'error']) {
        const [probe] = await eslint.lintText('console.' + level + '("diagnostic");', { filePath: path });
        assert.deepEqual(probe.messages.map(message => message.ruleId), ['no-console'], path + ': ' + level);
      }
      const source = readFileSync(path, 'utf8');
      checkReferences(source, path);
      const [actual] = await eslint.lintText(source, { filePath: path });
      violations.push(...actual.messages.map(message => ({
        path, line: message.line, rule: message.ruleId, message: message.message,
      })));
    }
    assert.deepEqual(violations, [], 'Every slice file must satisfy the unmodified lint rules');
    process.stdout.write('logger-lint: enabled\n');
  `;
  expect(
    execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
      cwd: resolve(__dirname, '../../..'),
      encoding: 'utf8',
      timeout: 60_000,
    })
  ).toBe('logger-lint: enabled\n');
}, 65_000);

const loggerBaseline = [
  'export default function log(message: string) {',
  '  logger.log(`[LOG]: ${message}`);',
  '}',
  '',
  'function write(level: "log" | "warn" | "error", values: unknown[]): void {',
  '  console[level](...values);',
  '}',
  '',
  '/** Shared diagnostic sink. Keep message arguments and severity intact. */',
  'export const logger = {',
  '  log(...values: unknown[]): void {',
  '    write("log", values);',
  '  },',
  '  warn(...values: unknown[]): void {',
  '    write("warn", values);',
  '  },',
  '  error(...values: unknown[]): void {',
  '    write("error", values);',
  '  },',
  '};',
  '',
  '/** Preserve diagnostic levels and structured details at the logging boundary. */',
  'export function logInfo(message: string, ...details: unknown[]): void {',
  '  logger.log(message, ...details);',
  '}',
  '',
  'export function logWarning(message: string, ...details: unknown[]): void {',
  '  logger.warn(message, ...details);',
  '}',
  '',
  'export function logError(message: string, ...details: unknown[]): void {',
  '  logger.error(message, ...details);',
  '}',
  '',
].join('\n');

// Snapshot of origin/dev's logger at f0e2cda8. Lazy calls and info use the
// direct console expressions from the affected callers on that revision.
it('matches origin/dev diagnostics across all entrypoints and argument shapes', () => {
  const script = String.raw`
    import assert from 'node:assert/strict';
    import { readFileSync } from 'node:fs';
    import { runInNewContext } from 'node:vm';
    import ts from 'typescript';
    const baseline = ${JSON.stringify(loggerBaseline)};
    const current = readFileSync('src/utils/log.ts', 'utf8');
    const opaque = new Proxy({}, { get() { throw new Error('Argument inspected'); } });
    const inputs = [[], ['message', new Error('details'), 42],
      [undefined, null, false, 0, 1n, Symbol('diagnostic'), opaque]];
    const failure = new Error('Diagnostic failed');
    const compare = (entry, level, values, failureAt) => {
      const outcomes = [baseline, current].map((source, revision) => {
        const events = [];
        const console = Object.fromEntries(['log', 'info', 'warn', 'error'].map(name => [name,
          function (...args) {
            events.push(['call', name, this === console, ...args]);
            if (failureAt === 'call') throw failure;
            return 'console return value';
          },
        ]));
        for (const name of Object.keys(console)) {
          const method = console[name];
          Object.defineProperty(console, name, { get() {
            events.push(['lookup', name]);
            if (failureAt === 'lookup') throw failure;
            return method;
          }});
        }
        const exports = {};
        const code = ts.transpileModule(source, {
          compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
        }).outputText;
        runInNewContext(code, { console, exports });
        const argumentsForLog = () => {
          events.push(['arguments']);
          if (failureAt === 'arguments') throw failure;
          return values;
        };
        events.push(['before']);
        try {
          let result;
          if (entry === 'prefixed') result = exports.default('diagnostic');
          else if (entry === 'lazy') {
            if (revision === 0) console[level](...argumentsForLog());
            else result = exports.logger.write(level, argumentsForLog);
          } else if (level === 'info' && revision === 0) console.info(...values);
          else result = exports.logger[level](...values);
          events.push(['return', result]);
        } catch (error) {
          assert.equal(error, failure);
          events.push(['throw', error]);
        }
        events.push(['after']);
        return events;
      });
      assert.deepEqual(outcomes[1], outcomes[0], entry + ' ' + level + ' ' + failureAt);
    };
    for (const entry of ['eager', 'lazy']) {
      for (const level of ['log', 'info', 'warn', 'error']) {
        for (const values of inputs) {
          for (const failureAt of ['none', 'lookup', 'call', 'arguments']) {
            compare(entry, level, values, failureAt);
          }
        }
      }
    }
    for (const failureAt of ['none', 'lookup', 'call']) {
      compare('prefixed', 'log', [], failureAt);
    }
    process.stdout.write('logger-differential: 99 comparisons passed\n');
  `;
  expect(
    execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
      cwd: resolve(__dirname, '../../..'),
      encoding: 'utf8',
      timeout: 60_000,
    })
  ).toBe('logger-differential: 99 comparisons passed\n');
}, 65_000);

// Run the installed ESM compiler outside Jest's transforms. The direct console
// fixture records the policy used by origin/dev before routing through logger.
const buildScript = String.raw`
  import assert from 'node:assert/strict';
  import { readFileSync } from 'node:fs';
  import { runInNewContext } from 'node:vm';
  import ts from 'typescript';
  import { build, loadConfigFromFile } from 'vite';

  const mode = process.argv[1];
  const fixtureId = 'virtual:shared-logger-fixture';
  const serveConfig = await loadConfigFromFile({ command: 'serve', mode }, 'config/vite.config.ts');
  assert.equal(serveConfig.config.define.__QRL_DIAGNOSTICS__, 'true');
  // Every converted call must put its diagnostic expressions in the lazy
  // argument producer. Check all affected functions, including catch handlers.
  for (const name of [
    'embeddedMigration', 'embeddedMigrationBoot', 'logout', 'nativeBack',
    'nativeWalletMutation', 'walletEpoch', 'navigation', 'extension/extensionConnection',
  ]) {
    const path = 'src/utils/' + name + '.ts';
    const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest);
    let calls = 0;
    const visit = node => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
          node.expression.expression.getText(source) === 'logger') {
        calls += 1;
        assert.equal(node.expression.name.text, 'write', path);
        assert.equal(node.arguments.length, 2, path);
        assert.ok(ts.isStringLiteral(node.arguments[0]), path);
        assert.ok(ts.isArrowFunction(node.arguments[1]), path);
        assert.ok(ts.isArrayLiteralExpression(node.arguments[1].body), path);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    assert.ok(calls > 0, path);
  }
  const calls = [
    'globalThis.mark("before");',
    'SINK.log("Connected to extension with accounts:", ["Q" + "a".repeat(128)]);',
    'SINK.info("migration complete");',
    'SINK.warn("warning");',
    'SINK.error("cleanup failed", new Error("failure"));',
    'LEGACY',
    'globalThis.mark("after");',
  ].join('\n');

  for (const desktop of [false, true]) {
    process.env.VITE_DESKTOP = desktop ? '1' : '0';
    const outcomes = [];
    for (const shared of [false, true]) {
      const source = shared
        ? 'import log, { logger } from "/src/utils/log.ts";\n' +
          calls.replaceAll('SINK', 'logger').replace('LEGACY', 'log("legacy diagnostic");')
        : calls.replaceAll('SINK', 'console')
          .replace('LEGACY', 'console.log("[LOG]: legacy diagnostic");');
      const result = await build({
        configFile: 'config/vite.config.ts', mode, logLevel: 'silent',
        plugins: [{
          name: 'shared-logger-fixture',
          resolveId: id => id === fixtureId ? id : undefined,
          load: id => id === fixtureId ? source : undefined,
        }],
        build: { write: false, copyPublicDir: false, rolldownOptions: { input: fixtureId } },
      });
      const code = result.output.filter(item => item.type === 'chunk')
        .map(item => item.code).join('\n');
      const diagnostics = [], marks = [];
      const console = Object.fromEntries(['log', 'info', 'warn', 'error'].map(level => [
        level, function (...args) {
          assert.equal(this, console);
          diagnostics.push([level, ...args.map(value => value?.message ?? value)]);
        },
      ]));
      runInNewContext(code, { console, mark: value => marks.push(value) });
      assert.deepEqual(marks, ['before', 'after']);
      assert.equal(diagnostics.length, mode === 'production' ? 0 : 5);
      if (mode === 'production') assert.doesNotMatch(code, /\bconsole\b/);
      outcomes.push(JSON.stringify(diagnostics));
    }
    assert.equal(outcomes[0], outcomes[1]);

    // Class: production logging must remove argument reads, coercions and
    // throws along with the diagnostic. Active modes keep their exact order.
    for (const throws of [false, true]) {
      const outcomes = [];
      for (const shared of [false, true]) {
        const statements = ['log', 'info', 'warn', 'error'].map(level => {
          const args = 'globalThis.argument(' + JSON.stringify(level) + ')';
          return 'try { ' + (shared
            ? 'logger.write(' + JSON.stringify(level) + ', () => [' + args + ']);'
            : 'console.' + level + '(' + args + ');') +
            ' globalThis.mark("completed"); } catch (error) { globalThis.mark(error.message); }';
        }).join('\n');
        const source = (shared ? 'import { logger } from "/src/utils/log.ts";\n' : '') + statements;
        const result = await build({
          configFile: 'config/vite.config.ts', mode, logLevel: 'silent',
          plugins: [{
            name: 'diagnostic-arguments',
            resolveId: id => id === fixtureId ? id : undefined,
            load: id => id === fixtureId ? source : undefined,
          }],
          build: { write: false, copyPublicDir: false, rolldownOptions: { input: fixtureId } },
        });
        const code = result.output.filter(item => item.type === 'chunk').map(item => item.code).join('\n');
        const events = [];
        const console = Object.fromEntries(['log', 'info', 'warn', 'error'].map(level => [
          level, function (value) { assert.equal(this, console); events.push(['sink', level, value]); },
        ]));
        for (const level of Object.keys(console)) {
          const sink = console[level];
          Object.defineProperty(console, level, { get() { events.push(['lookup', level]); return sink; } });
        }
        runInNewContext(code, {
          console,
          argument: level => {
            events.push(['argument', level]);
            if (throws) throw new Error('argument failed');
            return 'diagnostic ' + level;
          },
          mark: value => events.push(['mark', value]),
        });
        if (mode === 'production') {
          assert.deepEqual(events, Array.from({ length: 4 }, () => ['mark', 'completed']));
          assert.doesNotMatch(code, /\bconsole\b/);
        }
        outcomes.push(JSON.stringify(events));
      }
      assert.equal(outcomes[0], outcomes[1]);
    }
  }
  process.stdout.write('logger-build: OK\n');
`;

it.each(['production', 'development', 'staging'])(
  'preserves %s diagnostic policy through every shared logger method in web and desktop',
  (mode) => {
    expect(
      execFileSync(process.execPath, ['--input-type=module', '--eval', buildScript, mode], {
        cwd: resolve(__dirname, '../../..'),
        env: { ...process.env, VITE_SEED: '', NODE_ENV: 'production' },
        encoding: 'utf8',
        timeout: 60_000,
      })
    ).toBe('logger-build: OK\n');
  },
  65_000
);
