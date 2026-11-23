import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { isArray, isRecord } from "@/utils/guards";

interface BuildResult {
  mode: string;
  desktop: boolean;
  base: string;
  sourcemap: boolean;
  lightTheme: string;
  code: string;
}

interface BuildReport {
  builds: BuildResult[];
  seedErrors: string[];
  flagged: { desktop: boolean; lightTheme: string }[];
  embeddedLightTheme: string;
  embeddedWithFlag: string;
}

function isBuildResult(value: unknown): value is BuildResult {
  return (
    isRecord(value) &&
    typeof value["mode"] === "string" &&
    typeof value["desktop"] === "boolean" &&
    typeof value["base"] === "string" &&
    typeof value["sourcemap"] === "boolean" &&
    typeof value["lightTheme"] === "string" &&
    typeof value["code"] === "string"
  );
}

function isBuildReport(value: unknown): value is BuildReport {
  return (
    isRecord(value) &&
    isArray(value["builds"]) &&
    value["builds"].every(isBuildResult) &&
    isArray(value["flagged"]) &&
    value["flagged"].every(
      (entry) =>
        isRecord(entry) &&
        typeof entry["desktop"] === "boolean" &&
        typeof entry["lightTheme"] === "string",
    ) &&
    typeof value["embeddedLightTheme"] === "string" &&
    typeof value["embeddedWithFlag"] === "string" &&
    isArray(value["seedErrors"]) &&
    value["seedErrors"].every((error) => typeof error === "string")
  );
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
  const report = { builds: [], flagged: [], embeddedLightTheme: '', embeddedWithFlag: '', seedErrors: [] };

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
        lightTheme: String(resolvedConfig.define.__QRL_LIGHT_THEME__),
      });
    }
  }

  // The light theme flag set: on for the web build only.
  process.env.VITE_ENABLE_LIGHT_THEME = '1';
  report.flagged = [];
  for (const desktop of [false, true]) {
    process.env.VITE_DESKTOP = desktop ? '1' : '0';
    let resolvedConfig;
    await build({
      configFile: 'config/vite.config.ts',
      mode: 'production',
      logLevel: 'silent',
      plugins: [{
        name: 'diagnostic-fixture',
        resolveId: (id) => id === fixtureId ? id : undefined,
        load: (id) => id === fixtureId ? fixtureSource : undefined,
        configResolved: (config) => { resolvedConfig = config; },
      }],
      build: { write: false, copyPublicDir: false, rolldownOptions: { input: fixtureId } },
    });
    report.flagged.push({ desktop, lightTheme: String(resolvedConfig.define.__QRL_LIGHT_THEME__) });
  }
  // The app-embedded document refuses the flag outright, and resolves with the
  // theme constant false when the flag is absent.
  delete process.env.VITE_DESKTOP;
  const loadEmbedded = async () => {
    try {
      const embedded = await loadConfigFromFile(
        { command: 'build', mode: 'production' }, 'config/vite.config.embedded.ts', undefined, 'silent'
      );
      return String(embedded.config.define.__QRL_LIGHT_THEME__);
    } catch (error) {
      return 'error: ' + error.message;
    }
  };
  report.embeddedWithFlag = await loadEmbedded();
  delete process.env.VITE_ENABLE_LIGHT_THEME;
  report.embeddedLightTheme = await loadEmbedded();

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
    const parsed: unknown = JSON.parse(
      execFileSync(
        process.execPath,
        ["--input-type=module", "--eval", buildScript],
        {
          cwd: resolve(__dirname, "../.."),
          env: {
            ...process.env,
            VITE_SEED: "",
            VITE_ENABLE_LIGHT_THEME: "",
            NODE_ENV: "production",
          },
          encoding: "utf8",
          timeout: 60_000,
          maxBuffer: 2 * 1024 * 1024,
        },
      ),
    );
    if (!isBuildReport(parsed)) throw new Error("Invalid Vite build report");
    report = parsed;
  }, 65_000);

  it.each([
    null,
    [],
    {},
    { builds: [], seedErrors: [null] },
    { builds: [null], seedErrors: [] },
    {
      builds: [
        { mode: "production", desktop: false, base: "/", sourcemap: false },
      ],
      seedErrors: [],
    },
    {
      builds: [
        {
          mode: "production",
          desktop: "false",
          base: "/",
          sourcemap: false,
          code: "",
        },
      ],
      seedErrors: [],
    },
  ])("rejects malformed build reports: %p", (value) => {
    expect(isBuildReport(value)).toBe(false);
  });

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

  it.each(["production", "development", "staging"])(
    "leaves the light theme off in every %s build without its flag",
    (mode) => {
      const builds = report.builds.filter((build) => build.mode === mode);
      expect(builds.map((build) => build.lightTheme)).toEqual(["false", "false"]);
    },
  );

  it("turns the light theme on only for the web build when the flag is set", () => {
    expect(report.flagged).toEqual([
      { desktop: false, lightTheme: "true" },
      { desktop: true, lightTheme: "false" },
    ]);
  });

  it("keeps the light theme off in the embedded build", () => {
    expect(report.embeddedLightTheme).toBe("false");
    expect(report.embeddedWithFlag).toContain(
      "VITE_ENABLE_LIGHT_THEME is set but is not part of the embedded profile",
    );
  });

  it("retains the browser-visible seed guard in every mode", () => {
    expect(report.seedErrors).toHaveLength(3);
    for (const error of report.seedErrors) {
      expect(error).toContain("VITE_SEED is browser-visible.");
    }
  });
});
