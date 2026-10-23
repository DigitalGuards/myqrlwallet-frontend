import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { smokeLanguages, i18nLanguages } from "./i18n-smoke-options.mjs";
import { assertFullI18nCoverage, requiredI18nPairs } from "./i18n-coverage.mjs";
import { checkI18nShards } from "./check-i18n-shards.mjs";
import { smokeResult, writeSmokeReport } from "./i18n-smoke-report.mjs";

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
  const results = requiredI18nPairs("web", ["de", "es"]).map(
    ({ language, screen }) => smokeResult(language, screen),
  );
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
      results: requiredI18nPairs(suite, [language]).map(
        ({ language, screen }) => smokeResult(language, screen),
      ),
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
      /invalid shard status/,
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
        r.results.push(smokeResult("en", "unexpected"));
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
      /unexpected or missing fields/,
    ],
    [
      "unknown report version",
      (r) => {
        r.version = 1;
      },
      /unsupported report version/,
    ],
    [
      "unknown language",
      (r) => {
        r.results[0].language = "fr";
      },
      /unknown language/,
    ],
    [
      "failed pair even when the shard claims success",
      (r) => {
        r.results[0].pass = false;
        r.results[0].fail = true;
      },
      /pair did not pass/,
    ],
    [
      "contradictory pass and fail flags",
      (r) => {
        r.results[0].fail = true;
      },
      /pass and fail must be opposites/,
    ],
    [
      "undeclared report field",
      (r) => {
        r.extra = "unexpected";
      },
      /unexpected or missing fields/,
    ],
    [
      "undeclared pair field",
      (r) => {
        r.results[0].extra = "unexpected";
      },
      /unexpected or missing fields/,
    ],
    [
      "negative duration",
      (r) => {
        r.durationSeconds = -1;
      },
      /finite nonnegative number/,
    ],
    [
      "object in the problem list",
      (r) => {
        r.results[0].problems = [{}];
      },
      /expected string entries/,
    ],
    [
      "array in the scenario list",
      (r) => {
        r.results[0].scenarios = [["zero"]];
      },
      /expected string entries/,
    ],
    ...["language", "screen"].flatMap((field) =>
      ["array", "object", "number", "null"].map((type) => [
        `${type} in place of pair ${field}`,
        (r) => {
          r.results[0][field] = {
            array: [r.results[0][field]],
            object: { value: r.results[0][field] },
            number: 1,
            null: null,
          }[type];
        },
        /expected a string/,
      ]),
    ),
    ...["pass", "fail"].flatMap((field) =>
      ["true", "false", 0, 1, [], {}, null].map((value) => [
        `${JSON.stringify(value)} in place of boolean ${field}`,
        (r) => {
          r.results[0][field] = value;
        },
        /expected a boolean/,
      ]),
    ),
    ...["suite", "status"].flatMap((field) =>
      ["array", "object"].map((type) => [
        `${type} in place of report ${field}`,
        (r) => {
          r[field] = type === "array" ? [r[field]] : { value: r[field] };
        },
        /expected a string/,
      ]),
    ),
    ...[
      "version",
      "suite",
      "languages",
      "status",
      "durationSeconds",
      "results",
    ].map((field) => [
      `missing report field ${field}`,
      (r) => {
        delete r[field];
      },
      /unexpected or missing fields/,
    ]),
    ...["language", "screen", "pass", "fail", "scenarios"].map((field) => [
      `missing pair field ${field}`,
      (r) => {
        delete r.results[0][field];
      },
      /unexpected or missing fields/,
    ]),
    [
      "array in the declared language list",
      (r) => {
        r.languages = [["en"]];
      },
      /expected string entries/,
    ],
    [
      "another declared job language",
      (r) => {
        r.languages = ["de"];
      },
      /wrong shard languages/,
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

  test(`${suite}: rejects duplicate entries across shards`, async (t) => {
    const directory = await reports(t, suite);
    const english = JSON.parse(
      await readFile(join(directory, "en.json"), "utf8"),
    );
    const path = join(directory, "de.json");
    const german = JSON.parse(await readFile(path, "utf8"));
    german.results.push(english.results[0]);
    await writeFile(path, JSON.stringify(german));
    await assert.rejects(
      checkI18nShards(directory, suite),
      /Unexpected language\/screen pair/,
    );
  });

  test(`${suite}: rejects a shard reporting all of another language's pairs`, async (t) => {
    const directory = await reports(t, suite);
    const english = JSON.parse(
      await readFile(join(directory, "en.json"), "utf8"),
    );
    english.results = requiredI18nPairs(suite, ["de"]).map(
      ({ language, screen }) => smokeResult(language, screen),
    );
    await writeFile(join(directory, "en.json"), JSON.stringify(english));
    await assert.rejects(
      checkI18nShards(directory, suite),
      /Unexpected language\/screen pair/,
    );
  });

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
