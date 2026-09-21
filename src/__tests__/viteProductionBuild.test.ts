import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";

interface BuildResult {
  mode: string;
  desktop: boolean;
  base: string;
  sourcemap: boolean;
  code: string;
}

interface BuildReport {
  builds: BuildResult[];
  seedErrors: string[];
}

// Exercise the installed ESM compiler in Node, outside Jest's module transforms.
// All bundles stay in memory and the fixture has no network or application imports.
const buildScript = String.raw`
  import { build, loadConfigFromFile } from 'vite';

  const fixtureId = 'virtual:diagnostic-fixture';
  const fixtureSource = [
    'globalThis.keepEffect("before");',
    'console.log("diagnostic-log", globalThis.keepEffect("console-argument"));',
    'console.warn("diagnostic-warn");',
    'console.error("diagnostic-error");',
    'debugger;',
    'globalThis.keepEffect("after");',
  ].join('\n');
  const report = { builds: [], seedErrors: [] };

  for (const mode of ['production', 'development', 'staging']) {
    for (const desktop of [false, true]) {
      process.env.VITE_DESKTOP = desktop ? '1' : '0';
      let resolvedConfig;
      const result = await build({
        configFile: 'config/vite.config.ts',
        mode,
        logLevel: 'silent',
        plugins: [{
          name: 'diagnostic-fixture',
          resolveId: (id) => id === fixtureId ? id : undefined,
          load: (id) => id === fixtureId ? fixtureSource : undefined,
          configResolved: (config) => { resolvedConfig = config; },
        }],
        build: {
          write: false,
          copyPublicDir: false,
          rolldownOptions: { input: fixtureId },
        },
      });
      const code = result.output.filter((item) => item.type === 'chunk')
        .map((item) => item.code).join('\n');
      report.builds.push({
        mode, desktop, code,
        base: resolvedConfig.base,
        sourcemap: resolvedConfig.build.sourcemap,
      });
    }
  }

  process.env.VITE_SEED = 'public-test-placeholder';
  for (const mode of ['production', 'development', 'staging']) {
    try {
      await loadConfigFromFile(
        { command: 'build', mode }, 'config/vite.config.ts', undefined, 'silent'
      );
      report.seedErrors.push('');
    } catch (error) {
      report.seedErrors.push(error.message);
    }
  }
  process.stdout.write(JSON.stringify(report));
`;

describe("Vite production diagnostic stripping", () => {
  let report: BuildReport;

  beforeAll(() => {
    report = JSON.parse(
      execFileSync(
        process.execPath,
        ["--input-type=module", "--eval", buildScript],
        {
          cwd: resolve(__dirname, "../.."),
          env: { ...process.env, VITE_SEED: "", NODE_ENV: "production" },
          encoding: "utf8",
          timeout: 60_000,
          maxBuffer: 2 * 1024 * 1024,
        },
      ),
    ) as BuildReport;
  }, 65_000);

  it.each(["production", "development", "staging"])(
    "preserves the %s mode policy in web and desktop output",
    (mode) => {
      const builds = report.builds.filter((build) => build.mode === mode);
      expect(builds).toHaveLength(2);
      for (const build of builds) {
        const effects: string[] = [];
        const logs: unknown[][] = [];
        const capture = (...args: unknown[]) => logs.push(args);
        runInNewContext(build.code, {
          keepEffect: (value: string) => effects.push(value),
          console: { log: capture, warn: capture, error: capture },
        });

        if (mode === "production") {
          expect(build.code).not.toMatch(/console\.|diagnostic-|\bdebugger\b/);
          expect(logs).toEqual([]);
          // Match the former esbuild.drop policy: console argument evaluation
          // is removed along with the call, and other side effects remain.
          expect(effects).toEqual(["before", "after"]);
        } else {
          expect(build.code).toMatch(/\bdebugger\b/);
          expect(logs.map((args) => args[0])).toEqual([
            "diagnostic-log",
            "diagnostic-warn",
            "diagnostic-error",
          ]);
          expect(effects).toEqual(["before", "console-argument", "after"]);
        }
        expect(build.base).toBe(build.desktop ? "./" : "/");
        expect(build.sourcemap).toBe(mode !== "production");
      }
    },
  );

  it("retains the browser-visible seed guard in every mode", () => {
    expect(report.seedErrors).toHaveLength(3);
    for (const error of report.seedErrors) {
      expect(error).toContain("VITE_SEED is browser-visible.");
    }
  });
});
