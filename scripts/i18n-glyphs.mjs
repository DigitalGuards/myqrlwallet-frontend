import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { smokeLanguages } from "./i18n-smoke-options.mjs";

const samples = {
  en: "Wallet send receive",
  de: "Überweisung Straße ÄÖÜäöüß",
  es: "Envío español ÁÉÍÓÚÜÑáéíóúüñ¿¡",
  ru: "АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдеёжзийклмнопрстуфхцчшщъыьэюя",
  "zh-CN": "钱包余额发送接收设置语言中文交易账户备份签名",
};

/** Check real rasterized glyphs before any layout or translation probes run. */
export async function assertLanguageGlyphs(browser, languages) {
  const page = await browser.newPage();
  try {
    for (const language of languages) {
      assert.ok(
        Object.hasOwn(samples, language),
        "Unknown glyph-check language",
      );
      const missing = await page.evaluate(
        ({ language, sample }) => {
          document.documentElement.lang = language;
          const canvas = document.createElement("canvas");
          canvas.width = 160;
          canvas.height = 96;
          const context = canvas.getContext("2d", { willReadFrequently: true });
          const failures = [];
          for (const family of ["sans-serif", "system-ui", "monospace"]) {
            context.font = `48px ${family}`;
            context.fillStyle = "black";
            const render = (text) => {
              context.clearRect(0, 0, canvas.width, canvas.height);
              context.fillText(text, 8, 64);
              return context.getImageData(0, 0, canvas.width, canvas.height)
                .data;
            };
            // Noncharacters plus an unassigned codepoint exercise the browser's
            // missing-glyph fallback. Compare each character, so partial script
            // coverage cannot hide a missing glyph inside a longer string.
            const controls = ["\uFFFF", "\u{10FFFF}", "\u0378"].map(render);
            for (const glyph of new Set(sample.replace(/\s/g, ""))) {
              const pixels = render(glyph);
              if (
                !pixels.some((value) => value !== 0) ||
                controls.some((control) =>
                  pixels.every((value, index) => value === control[index]),
                )
              )
                failures.push(`${glyph} (${family})`);
            }
          }
          return failures;
        },
        { language, sample: samples[language] },
      );
      assert.equal(
        missing.length,
        0,
        `i18n-glyphs: ${language}: missing glyphs: ${missing.join(", ")}; install the smoke language fonts before measuring layout`,
      );
      console.log(`i18n-glyphs: ${language}: required script samples rendered`);
    }
  } finally {
    await page.close();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const languages = smokeLanguages();
  const browser = await chromium.launch();
  try {
    await assertLanguageGlyphs(browser, languages);
  } finally {
    await browser.close();
  }
}
