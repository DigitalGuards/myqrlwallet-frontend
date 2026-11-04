import assert from "node:assert/strict";
import { lstat, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
  approvalLanguages,
  assertCompleteApprovalLanguage,
} from "./approval-languages.mjs";

// CI runs the approval visibility smoke as one job per language, and each job
// uploads its APPROVAL_ARTIFACTS directory as approval-visibility-<language>.
// The aggregate requires every language exactly once, passed and complete, so
// a dropped or reduced matrix entry cannot pass.
export async function checkApprovalShards(directory) {
  const expectedArtifacts = approvalLanguages
    .map((language) => `approval-visibility-${language}`)
    .sort();
  const artifacts = await readdir(directory, { withFileTypes: true });
  assert.deepEqual(
    artifacts.map((entry) => entry.name).sort(),
    expectedArtifacts,
    "Expected exactly one artifact directory per approval language; an artifact is missing or unexpected",
  );
  for (const artifact of artifacts)
    assert.ok(
      artifact.isDirectory(),
      `${artifact.name}: expected an artifact directory`,
    );
  for (const language of approvalLanguages) {
    const artifact = `approval-visibility-${language}`;
    const path = join(directory, artifact, "results.json");
    assert.ok(
      (await lstat(path)).isFile(),
      `${artifact}: expected a regular results.json`,
    );
    const report = JSON.parse(await readFile(path, "utf8"));
    assert.deepEqual(
      report.failures,
      [],
      `${language}: the approval probe reported failures`,
    );
    assert.ok(
      Array.isArray(report.languages) && report.languages.length === 1,
      `${artifact}: expected results for exactly one language`,
    );
    const [result] = report.languages;
    assert.equal(
      result.language,
      language,
      `${artifact}: results belong to another language`,
    );
    assert.equal(result.exitCode, 0, `${language}: the probe did not exit 0`);
    assertCompleteApprovalLanguage(language, result);
  }
  console.log(
    `approval-shards: all ${approvalLanguages.length} languages passed the complete approval visibility matrix`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const { values } = parseArgs({
    options: { directory: { type: "string" } },
  });
  assert.ok(values.directory, "--directory is required");
  await checkApprovalShards(values.directory);
}
