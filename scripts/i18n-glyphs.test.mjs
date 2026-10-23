import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

function glyphCheck(languages, fontconfig = process.env.FONTCONFIG_FILE) {
  const env = { ...process.env };
  delete env.DISPLAY;
  delete env.WAYLAND_DISPLAY;
  if (fontconfig) env.FONTCONFIG_FILE = fontconfig;
  return spawnSync(
    process.execPath,
    ["scripts/i18n-glyphs.mjs", "--languages", languages],
    {
      env,
      encoding: "utf8",
      timeout: 30_000,
    },
  );
}

test("installed fonts render Latin, accented Latin, Cyrillic and Chinese in Chromium", () => {
  const result = glyphCheck("en,de,es,ru,zh-CN");
  assert.equal(result.status, 0, result.stderr);
  for (const language of ["en", "de", "es", "ru", "zh-CN"])
    assert.ok(
      result.stdout.includes(
        `i18n-glyphs: ${language}: required script samples rendered`,
      ),
    );
});

test("Chromium launches with Latin/Cyrillic fonts alone and rejects missing Chinese glyphs", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "i18n-glyphs-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const fonts = join(directory, "fonts");
  const cache = join(directory, "cache");
  await mkdir(fonts);
  await mkdir(cache);
  const source = execFileSync(
    "fc-match",
    ["--format", "%{file}", "DejaVu Sans"],
    { encoding: "utf8" },
  );
  await copyFile(source, join(fonts, "latin.ttf"));
  const config = join(directory, "fonts.conf");
  const xml = (value) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
  await writeFile(
    config,
    `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">
<fontconfig><dir>${xml(fonts)}</dir><cachedir>${xml(cache)}</cachedir></fontconfig>
`,
  );
  const latin = glyphCheck("en,de,es,ru", config);
  assert.equal(latin.status, 0, latin.stderr);
  const chinese = glyphCheck("zh-CN", config);
  assert.equal(chinese.status, 1, chinese.stderr);
  assert.match(chinese.stderr, /i18n-glyphs: zh-CN: missing glyphs/);
});
