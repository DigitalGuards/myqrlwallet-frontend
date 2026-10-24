import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const approvalLanguages = ["en", "de", "es", "ru", "zh-CN"];

/** Run the complete visibility probe separately for each language, with isolated evidence. */
export async function runApprovalLanguages(output) {
  const started = performance.now();
  const languages = [];
  await mkdir(output, { recursive: true });
  const concurrency = Number(process.env.APPROVAL_JOBS || "1");
  assert(
    Number.isInteger(concurrency) &&
      concurrency >= 1 &&
      concurrency <= approvalLanguages.length,
    "APPROVAL_JOBS must be between 1 and 5",
  );
  let next = 0;
  const failures = [];
  const workers = Array.from({ length: concurrency }, async () => {
    while (next < approvalLanguages.length) {
      const index = next++;
      const language = approvalLanguages[index];
      try {
        const directory = join(output, language);
        const code = await new Promise((resolve, reject) => {
          const child = spawn(process.execPath, [process.argv[1]], {
            stdio: "inherit",
            env: {
              ...process.env,
              APPROVAL_LANGUAGE: language,
              APPROVAL_PORT: String(
                Number(process.env.APPROVAL_PORT || "4176") + index,
              ),
              APPROVAL_ARTIFACTS: directory,
              ...(language === "en" ? {} : { APPROVAL_BASE_BOUNDS: "" }),
            },
          });
          child.on("error", reject);
          child.on("exit", (code) => resolve(code));
        });
        assert.equal(code, 0, `${language} approval visibility probe failed`);
        const result = JSON.parse(
          await readFile(join(directory, "results.json"), "utf8"),
        );
        if (
          !process.env.APPROVAL_CASE &&
          !process.env.APPROVAL_CHECKS_ONLY &&
          !process.env.APPROVAL_PARITY_ONLY
        ) {
          assert.equal(
            result.results.length,
            204,
            `${language}: incomplete method/layout matrix`,
          );
          assert.equal(
            result.chainChecks.length,
            18,
            `${language}: incomplete chain checks`,
          );
          assert.equal(
            result.collapsedControls,
            8,
            `${language}: incomplete collapsed controls`,
          );
          assert.equal(
            result.overflowControls.length,
            3,
            `${language}: incomplete overflow controls`,
          );
          assert.equal(
            result.queuedReviews.length,
            4,
            `${language}: incomplete queued requests`,
          );
          assert.equal(
            result.changes.length,
            4,
            `${language}: incomplete changed-content checks`,
          );
          assert.equal(
            result.emptyCases.length,
            4,
            `${language}: incomplete empty-content checks`,
          );
        }
        languages.push({ language, exitCode: code, ...result });
        console.log(
          `approval-visibility: ${language} completed in ${result.durationSeconds}s`,
        );
      } catch (error) {
        failures.push({ language, error: String(error) });
      }
    }
  });
  const settled = await Promise.allSettled(workers);
  for (const result of settled)
    if (result.status === "rejected") throw result.reason;
  languages.sort(
    (a, b) =>
      approvalLanguages.indexOf(a.language) -
      approvalLanguages.indexOf(b.language),
  );
  const durationSeconds = (performance.now() - started) / 1000;
  await writeFile(
    join(output, "results.json"),
    JSON.stringify({ durationSeconds, languages, failures }, null, 2),
  );
  assert.deepEqual(failures, [], "All-language approval matrix failures");
  assert.equal(
    languages.length,
    approvalLanguages.length,
    "Incomplete language matrix",
  );
  console.log(
    `approval-visibility: all ${languages.length} languages passed in ${durationSeconds.toFixed(3)}s`,
  );
}

/** Only wallet-owned probe expectations pass through this lookup. Fixture data stays verbatim. */
export async function approvalCopy(language) {
  const messages = new Map();
  for (const namespace of ["common", "settings", "transfer", "dapps"]) {
    const source = JSON.parse(
      await readFile(`src/locales/en/${namespace}.json`, "utf8"),
    );
    const translated = JSON.parse(
      await readFile(`src/locales/${language}/${namespace}.json`, "utf8"),
    );
    for (const [key, value] of Object.entries(source))
      messages.set(value, translated[key]);
  }
  return (source, values = {}) => {
    assert(messages.has(source), `Missing approval probe copy: ${source}`);
    return messages
      .get(source)
      .replace(/{{(\w+)}}/g, (_, key) => String(values[key]));
  };
}
