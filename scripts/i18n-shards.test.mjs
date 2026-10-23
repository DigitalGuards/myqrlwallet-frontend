import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { smokeLanguages, i18nLanguages } from "./i18n-smoke-options.mjs";
import { assertFullI18nCoverage, requiredI18nPairs } from "./i18n-coverage.mjs";
import { checkI18nShards } from "./check-i18n-shards.mjs";
import { writeSmokeReport } from "./i18n-smoke-report.mjs";

test("language selection preserves the full default and canonical subset order", () => {
  assert.deepEqual(smokeLanguages([]), ["en", "de", "es", "ru", "zh-CN"]);
  assert.deepEqual(smokeLanguages(["--languages", "es, de"]), ["de", "es"]);
  assert.deepEqual(smokeLanguages(["--languages=zh-CN"]), ["zh-CN"]);
});

test("invalid language selections fail instead of silently reducing coverage", () => {
  for (const args of [
    ["--languages", ""],
    ["--languages", "de,"],
    ["--languages", "fr"],
    ["--languages", "de,de"],
    ["--languages"],
    ["--language", "de"],
    ["de"],
  ])
    assert.throws(() => smokeLanguages(args), undefined, JSON.stringify(args));
});

test("local subset coverage still requires every selected screen", () => {
  const results = requiredI18nPairs("web", ["de", "es"]).map((pair) => ({
    ...pair,
    problems: [],
  }));
  assertFullI18nCoverage(results, ["de", "es"]);
  assert.throws(
    () => assertFullI18nCoverage(results),
    /Missing required pairs/,
  );
  assert.throws(
    () => assertFullI18nCoverage(results.slice(1), ["de", "es"]),
    /Missing required pairs/,
  );
});

async function reports(t, suite) {
  const directory = await mkdtemp(join(tmpdir(), "i18n-shards-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const language of i18nLanguages) {
    await writeSmokeReport(join(directory, `${language}.json`), {
      suite,
      languages: [language],
      status: "passed",
      results: requiredI18nPairs(suite, [language]).map((pair) => ({
        ...pair,
        problems: [],
      })),
    });
  }
  return directory;
}

for (const suite of ["web", "embedded"]) {
  test(`${suite}: all five reports cover the complete manifest exactly once`, async (t) => {
    const directory = await reports(t, suite);
    assert.equal(
      await checkI18nShards(directory, suite),
      requiredI18nPairs(suite).length,
    );
  });

  for (const [name, mutate, message] of [
    [
      "failed shard with complete results",
      (r) => {
        r.status = "failed";
      },
      /shard did not pass/,
    ],
    [
      "skipped shard",
      (r) => {
        r.status = "skipped";
      },
      /shard did not pass/,
    ],
    [
      "missing pair",
      (r) => {
        r.results.pop();
      },
      /Missing required pairs/,
    ],
    [
      "duplicate replacing a missing pair",
      (r) => {
        r.results[1] = r.results[0];
      },
      /Duplicate language\/screen pair/,
    ],
    [
      "extra pair",
      (r) => {
        r.results.push({ language: "en", screen: "unexpected", problems: [] });
      },
      /Unexpected language\/screen pair/,
    ],
    [
      "overlapping shard",
      (r) => {
        r.languages = ["en", "de"];
      },
      /wrong shard languages/,
    ],
    [
      "wrong language results",
      (r) => {
        r.results[0].language = "de";
      },
      /Unexpected language\/screen pair/,
    ],
    [
      "wrong suite",
      (r) => {
        r.suite = "other";
      },
      /wrong smoke suite/,
    ],
    [
      "reported browser problem",
      (r) => {
        r.results[0].problems.push("overflow");
      },
      /smoke problems/,
    ],
    [
      "missing problem field",
      (r) => {
        delete r.results[0].problems;
      },
      /smoke problems/,
    ],
    [
      "unknown report version",
      (r) => {
        r.version = 2;
      },
      /unsupported report version/,
    ],
  ]) {
    test(`${suite}: rejects ${name}`, async (t) => {
      const directory = await reports(t, suite);
      const path = join(directory, "en.json");
      const report = JSON.parse(await readFile(path, "utf8"));
      mutate(report);
      await writeFile(path, JSON.stringify(report));
      await assert.rejects(checkI18nShards(directory, suite), message);
    });
  }

  test(`${suite}: missing, extra and malformed report files fail`, async (t) => {
    const directory = await reports(t, suite);
    const path = join(directory, "en.json");
    const report = await readFile(path, "utf8");
    await rm(path);
    await assert.rejects(
      checkI18nShards(directory, suite),
      /Expected exactly one report/,
    );
    await writeFile(path, report);
    await writeFile(join(directory, "extra.json"), report);
    await assert.rejects(
      checkI18nShards(directory, suite),
      /Expected exactly one report/,
    );
    await rm(join(directory, "extra.json"));
    await writeFile(path, "{");
    await assert.rejects(checkI18nShards(directory, suite), SyntaxError);
  });
}

test("coverage CLI returns failure for an incomplete shard collection", async (t) => {
  const directory = await reports(t, "web");
  const args = [
    "scripts/check-i18n-shards.mjs",
    "--suite",
    "web",
    "--directory",
    directory,
  ];
  const passed = spawnSync(process.execPath, args, { encoding: "utf8" });
  assert.equal(passed.status, 0, passed.stderr);
  await rm(join(directory, "zh-CN.json"));
  const failed = spawnSync(process.execPath, args, { encoding: "utf8" });
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /Expected exactly one report/);
});

test("a new failed report overwrites a previous success", async (t) => {
  const directory = await reports(t, "web");
  await writeSmokeReport(join(directory, "en.json"), {
    suite: "web",
    languages: ["en"],
    status: "failed",
    results: [],
  });
  await assert.rejects(checkI18nShards(directory, "web"), /shard did not pass/);
});
