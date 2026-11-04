import { chromium } from "playwright";

const watchdog = setTimeout(() => {
  console.error("Chromium launch check timed out after 15 seconds.");
  process.exit(1);
}, 15_000);

// An empty channel launches the headless shell, as chromium.launch() does in
// the language and boot smokes; "chromium" launches the full build.
const channel = process.env.CHROMIUM_CHANNEL || undefined;

try {
  const browser = await chromium.launch({ channel, headless: true, timeout: 10_000 });
  await browser.close();
  clearTimeout(watchdog);
  console.log(`Chromium launch check passed (${channel ?? "headless shell"}).`);
} catch (error) {
  console.error(`Chromium launch check failed: ${error.message}`);
  process.exit(1);
}
