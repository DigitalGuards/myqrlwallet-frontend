import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { requiredI18nPairs } from "./i18n-coverage.mjs";
import { i18nLanguages } from "./i18n-smoke-options.mjs";

const run = promisify(execFile);
const cwd = fileURLToPath(new URL("..", import.meta.url));
const scenarioSets = (records) =>
  records
    .map(({ language, screen, scenarios }) => ({
      language,
      screen,
      scenarios: [...scenarios].sort(),
    }))
    .sort((a, b) =>
      `${a.language}/${a.screen}`.localeCompare(`${b.language}/${b.screen}`),
    );

// Integration gate: build both bundles first. Run the actual default entrypoints
// so the observed scenario sets come from browser work independently of the matrices.
for (const suite of ["web", "embedded"]) {
  test(
    `${suite}: declared scenario sets match the full default run report`,
    { timeout: 660000 },
    async (t) => {
      const directory = await mkdtemp(join(tmpdir(), `i18n-full-${suite}-`));
      t.after(() => rm(directory, { recursive: true, force: true }));
      const reportPath = join(directory, "report.json");
      const script =
        suite === "web" ? "smoke-i18n.mjs" : "smoke-i18n-embedded.mjs";
      const { stdout } = await run(
        process.execPath,
        [join("scripts", script)],
        {
          cwd,
          env: {
            ...process.env,
            I18N_SCREENSHOT_DIR: directory,
            I18N_REPORT_PATH: reportPath,
          },
          timeout: 650000,
        },
      );
      const report = JSON.parse(await readFile(reportPath, "utf8"));
      assert.equal(report.version, 2);
      assert.equal(report.suite, suite);
      assert.equal(report.status, "passed");
      assert.deepEqual(report.languages, i18nLanguages);
      assert.deepEqual(
        scenarioSets(report.results),
        scenarioSets(requiredI18nPairs(suite)),
      );
      t.diagnostic(stdout.trim());
      t.diagnostic(
        `${suite}: full default smoke exited 0; all declared scenario sets match`,
      );
    },
  );
}
