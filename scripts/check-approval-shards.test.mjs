import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { approvalLanguages } from "./approval-languages.mjs";
import { checkApprovalShards } from "./check-approval-shards.mjs";
import { smokeLanguages } from "./i18n-smoke-options.mjs";

const many = (length) => Array.from({ length }, () => ({}));

function completeLanguage(language) {
  return {
    language,
    exitCode: 0,
    results: many(204),
    chainChecks: many(18),
    collapsedControls: 8,
    overflowControls: many(3),
    queuedReviews: many(4),
    changes: many(4),
    emptyCases: many(4),
  };
}

/** Lay out downloaded artifacts as download-artifact does with merge-multiple: false. */
async function collection(edit = () => {}) {
  const directory = await mkdtemp(join(tmpdir(), "approval-shards-"));
  const reports = Object.fromEntries(
    approvalLanguages.map((language) => [
      language,
      { durationSeconds: 1, languages: [completeLanguage(language)], failures: [] },
    ]),
  );
  edit(reports);
  for (const [language, report] of Object.entries(reports)) {
    const artifact = join(directory, `approval-visibility-${language}`);
    await mkdir(artifact);
    await writeFile(join(artifact, "results.json"), JSON.stringify(report));
  }
  return directory;
}

test("approval language selection follows the run order and rejects bad input", () => {
  assert.deepEqual(smokeLanguages([], approvalLanguages), approvalLanguages);
  assert.deepEqual(
    smokeLanguages(["--languages", "ru,de"], approvalLanguages),
    ["de", "ru"],
  );
  for (const args of [
    ["--languages", ""],
    ["--languages", "fr"],
    ["--languages", "en,en"],
  ])
    assert.throws(
      () => smokeLanguages(args, approvalLanguages),
      undefined,
      JSON.stringify(args),
    );
});

test("five complete language results pass", async () => {
  const directory = await collection();
  try {
    await checkApprovalShards(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("missing, extra, failed, foreign and incomplete results fail", async () => {
  const cases = {
    "missing language": (reports) => {
      delete reports.de;
    },
    "extra artifact": (reports) => {
      reports.fr = reports.en;
    },
    "reported failure": (reports) => {
      reports.es.failures = [{ language: "es", error: "probe failed" }];
    },
    "no language results": (reports) => {
      reports.ru.languages = [];
    },
    "another language": (reports) => {
      reports["zh-CN"].languages = [completeLanguage("ru")];
    },
    "two languages in one artifact": (reports) => {
      reports.en.languages.push(completeLanguage("de"));
    },
    "nonzero exit": (reports) => {
      reports.de.languages[0].exitCode = 1;
    },
    "short method/layout matrix": (reports) => {
      reports.en.languages[0].results.pop();
    },
    "missing chain checks": (reports) => {
      reports.es.languages[0].chainChecks = many(17);
    },
    "missing collapsed controls": (reports) => {
      reports.ru.languages[0].collapsedControls = 7;
    },
  };
  for (const [name, edit] of Object.entries(cases)) {
    const directory = await collection(edit);
    try {
      await assert.rejects(checkApprovalShards(directory), undefined, name);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
});

test("a symlinked report fails", async () => {
  const directory = await collection();
  try {
    const artifact = join(directory, "approval-visibility-de");
    await rm(join(artifact, "results.json"));
    await symlink(
      join(directory, "approval-visibility-en", "results.json"),
      join(artifact, "results.json"),
    );
    await assert.rejects(checkApprovalShards(directory));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the CLI exits 0 for a complete collection and 1 otherwise", async () => {
  const complete = await collection();
  const incomplete = await collection((reports) => {
    delete reports["zh-CN"];
  });
  try {
    const run = (directory) =>
      spawnSync(
        process.execPath,
        ["scripts/check-approval-shards.mjs", "--directory", directory],
        { encoding: "utf8" },
      );
    assert.equal(run(complete).status, 0);
    assert.equal(run(incomplete).status, 1);
  } finally {
    await rm(complete, { recursive: true, force: true });
    await rm(incomplete, { recursive: true, force: true });
  }
});
