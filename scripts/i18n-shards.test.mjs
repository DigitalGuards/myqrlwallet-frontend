import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
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
    ({ language, screen, scenarios }) =>
      smokeResult(language, screen, [], scenarios),
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

function reportPath(directory, suite, language) {
  return join(directory, `i18n-${suite}-${language}`, `${language}.json`);
}

async function reports(t, suite) {
  const directory = await mkdtemp(join(tmpdir(), "i18n-shards-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const language of i18nLanguages) {
    await writeSmokeReport(reportPath(directory, suite, language), {
      suite,
      languages: [language],
      status: "passed",
      results: requiredI18nPairs(suite, [language]).map(
        ({ language, screen, scenarios }) =>
          smokeResult(language, screen, [], scenarios),
      ),
    });
  }
  return directory;
}

for (const suite of ["web", "embedded"]) {
  const artifactFixtures = [
    [
      "duplicate failed report in an additional artifact",
      async (directory) => {
        const report = JSON.parse(
          await readFile(reportPath(directory, suite, "en"), "utf8"),
        );
        report.status = "failed";
        report.results[0] = smokeResult("en", report.results[0].screen, [
          "overflow",
        ]);
        await writeSmokeReport(
          join(directory, `i18n-${suite}-en-duplicate`, "en.json"),
          report,
        );
      },
      /Expected exactly one artifact directory/,
    ],
    [
      "extra artifact",
      (directory) => mkdir(join(directory, `i18n-${suite}-extra`)),
      /Expected exactly one artifact directory/,
    ],
    [
      "missing artifact",
      (directory) =>
        rm(join(directory, `i18n-${suite}-zh-CN`), { recursive: true }),
      /Expected exactly one artifact directory/,
    ],
    [
      "mismatched artifact name with the expected artifact count",
      (directory) =>
        rename(
          join(directory, `i18n-${suite}-en`),
          join(directory, `i18n-${suite}-fr`),
        ),
      /Expected exactly one artifact directory/,
    ],
    [
      "mismatched report filename",
      (directory) =>
        rename(
          reportPath(directory, suite, "en"),
          join(directory, `i18n-${suite}-en`, "de.json"),
        ),
      /expected exactly one report named en.json/,
    ],
    [
      "mismatched report language",
      async (directory) => {
        const german = await readFile(
          reportPath(directory, suite, "de"),
          "utf8",
        );
        await writeFile(reportPath(directory, suite, "en"), german);
      },
      /wrong shard languages/,
    ],
    [
      "duplicate failed report inside an expected artifact",
      async (directory) => {
        const report = JSON.parse(
          await readFile(reportPath(directory, suite, "en"), "utf8"),
        );
        report.status = "failed";
        await writeSmokeReport(
          join(directory, `i18n-${suite}-en`, "failed.json"),
          report,
        );
      },
      /expected exactly one report named en.json/,
    ],
    [
      "missing report inside an expected artifact",
      (directory) => rm(reportPath(directory, suite, "en")),
      /expected exactly one report named en.json/,
    ],
    [
      "unmerged collection with a loose report",
      async (directory) =>
        writeFile(
          join(directory, "en.json"),
          await readFile(reportPath(directory, suite, "en")),
        ),
      /Expected exactly one artifact directory/,
    ],
    [
      "hidden extra file inside an artifact",
      (directory) =>
        writeFile(join(directory, `i18n-${suite}-en`, ".extra"), "unexpected"),
      /expected exactly one report named en.json/,
    ],
    [
      "nested report directory",
      async (directory) => {
        const path = reportPath(directory, suite, "en");
        await rm(path);
        await mkdir(path);
      },
      /expected a regular report file/,
    ],
    [
      "report symlink",
      async (directory) => {
        const path = reportPath(directory, suite, "en");
        await rm(path);
        await symlink(reportPath(directory, suite, "de"), path);
      },
      /expected a regular report file/,
    ],
    [
      "artifact symlink",
      async (directory) => {
        const path = join(directory, `i18n-${suite}-en`);
        await rm(path, { recursive: true });
        await symlink(join(directory, `i18n-${suite}-de`), path);
      },
      /expected an artifact directory/,
    ],
  ];

  for (const [name, mutate, message] of artifactFixtures) {
    test(`${suite}: artifact fixture rejects ${name} through the API and CLI`, async (t) => {
      const directory = await reports(t, suite);
      await mutate(directory);
      await assert.rejects(checkI18nShards(directory, suite), message);
      const result = spawnSync(
        process.execPath,
        [
          "scripts/check-i18n-shards.mjs",
          "--suite",
          suite,
          "--directory",
          directory,
        ],
        { encoding: "utf8" },
      );
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, message);
    });
  }

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
    [
      "extra scenario in a complete report",
      (r) => {
        r.results[0].scenarios.push("undeclared-scenario");
      },
      /wrong scenario set/,
    ],
    ...["nft-import-detected", "nft-import-id-error"]
      .filter((screen) =>
        requiredI18nPairs(suite, ["en"]).some((pair) => pair.screen === screen),
      )
      .flatMap((screen) =>
        ["zero", "success"].map((omitted) => [
          `missing ${omitted} scenario for ${screen} with all pairs present`,
          (r) => {
            const result = r.results.find((pair) => pair.screen === screen);
            result.scenarios = result.scenarios.filter(
              (scenario) => scenario !== omitted,
            );
          },
          /wrong scenario set/,
        ]),
      ),
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
      const path = reportPath(directory, suite, "en");
      const report = JSON.parse(await readFile(path, "utf8"));
      mutate(report);
      await writeFile(path, JSON.stringify(report));
      await assert.rejects(checkI18nShards(directory, suite), message);
    });
  }

  test(`${suite}: rejects duplicate entries across shards`, async (t) => {
    const directory = await reports(t, suite);
    const english = JSON.parse(
      await readFile(reportPath(directory, suite, "en"), "utf8"),
    );
    const path = reportPath(directory, suite, "de");
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
      await readFile(reportPath(directory, suite, "en"), "utf8"),
    );
    english.results = requiredI18nPairs(suite, ["de"]).map(
      ({ language, screen, scenarios }) =>
        smokeResult(language, screen, [], scenarios),
    );
    await writeFile(
      reportPath(directory, suite, "en"),
      JSON.stringify(english),
    );
    await assert.rejects(
      checkI18nShards(directory, suite),
      /Unexpected language\/screen pair/,
    );
  });

  test(`${suite}: missing, extra and malformed report files fail`, async (t) => {
    const directory = await reports(t, suite);
    const path = reportPath(directory, suite, "en");
    const report = await readFile(path, "utf8");
    await rm(path);
    await assert.rejects(
      checkI18nShards(directory, suite),
      /expected exactly one report/,
    );
    await writeFile(path, report);
    await writeFile(join(directory, `i18n-${suite}-en`, "extra.json"), report);
    await assert.rejects(
      checkI18nShards(directory, suite),
      /expected exactly one report/,
    );
    await rm(join(directory, `i18n-${suite}-en`, "extra.json"));
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
  await rm(reportPath(directory, "web", "zh-CN"));
  const failed = spawnSync(process.execPath, args, { encoding: "utf8" });
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /expected exactly one report/);
});

test("a new failed report overwrites a previous success", async (t) => {
  const directory = await reports(t, "web");
  await writeSmokeReport(reportPath(directory, "web", "en"), {
    suite: "web",
    languages: ["en"],
    status: "failed",
    results: [],
  });
  await assert.rejects(checkI18nShards(directory, "web"), /shard did not pass/);
});
