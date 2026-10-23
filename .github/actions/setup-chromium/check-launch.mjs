import { chromium } from "playwright";

const watchdog = setTimeout(() => {
  console.error("Chromium launch check timed out after 15 seconds.");
  process.exit(1);
}, 15_000);

try {
  const browser = await chromium.launch({ headless: true, timeout: 10_000 });
  await browser.close();
  clearTimeout(watchdog);
  console.log("Chromium launch check passed.");
} catch (error) {
  console.error(`Chromium launch check failed: ${error.message}`);
  process.exit(1);
}
