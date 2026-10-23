import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export async function writeSmokeReport(path, report) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    JSON.stringify({ version: 1, ...report }, null, 2) + "\n",
  );
}
