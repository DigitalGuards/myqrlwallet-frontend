import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export function smokeResult(language, screen, problems = [], scenarios = []) {
  return {
    language,
    screen,
    pass: problems.length === 0,
    fail: problems.length > 0,
    problems,
    scenarios,
  };
}

export async function writeSmokeReport(path, report) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    JSON.stringify({ version: 2, durationSeconds: 0, ...report }, null, 2) +
      "\n",
  );
}
