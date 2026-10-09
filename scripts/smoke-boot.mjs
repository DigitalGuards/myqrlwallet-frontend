// Boot smoke for the built web wallet. Serves dist/ exactly as prod does
// (static files, SPA fallback), opens it in headless Chromium with the RPC
// stubbed, and fails on anything a user would see as a bricked app: an
// uncaught exception, the home screen never reaching "Let's start", or
// the create-account page not rendering. CI runs it after `npm run build`
// so a dependency bump that type-checks and bundles but breaks at runtime
// is rejected before it can auto-merge to main.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = 4173;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const GENESIS = '0xd15407991193e6c23b733dc6bf9c628deaff8f9b6e252aa0d60030952b3e3ea4';

const rpcAnswer = (method) => {
  switch (method) {
    case 'net_listening': return true;
    case 'net_version': return '3151909';
    case 'qrl_chainId': return '0x301825';
    case 'qrl_getBlockByNumber': return { hash: GENESIS, number: '0x0' };
    case 'qrl_blockNumber': return '0x1';
    case 'qrl_gasPrice': return '0x3b9aca00';
    case 'web3_clientVersion': return 'smoke-boot';
    default: return '0x0';
  }
};

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--config', 'config/vite.config.ts', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { stdio: ['ignore', 'ignore', 'inherit'], detached: true });
const stop = () => { try { process.kill(-server.pid, 'SIGTERM'); } catch { /* already gone */ } };
const fail = (msg) => { console.error(`smoke-boot: FAIL ${msg}`); stop(); process.exit(1); };
setTimeout(() => fail('timed out after 120 s'), 120000).unref();

try {
  for (let i = 0; i < 40; i++) {
    try { await fetch(ORIGIN); break; } catch { await sleep(500); }
    if (i === 39) fail('vite preview did not start');
  }
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = req.url();
    if (url.startsWith(ORIGIN)) return route.continue();
    if (/\/qrl-rpc/.test(url) && req.method() === 'POST') {
      const body = req.postDataJSON();
      const reply = (r) => ({ jsonrpc: '2.0', id: r.id, result: rpcAnswer(r.method) });
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(Array.isArray(body) ? body.map(reply) : reply(body)) });
    }
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{}' });
  });

  await page.goto(`${ORIGIN}/`, { waitUntil: 'load' });
  await page.getByRole('link', { name: 'Create a new account' }).waitFor({ timeout: 20000 }).catch(async () => {
    fail(`home never showed "Create a new account"; page text: ${(await page.evaluate(() => document.body.innerText)).slice(0, 300).replace(/\s+/g, ' ')}`);
  });
  await page.getByRole('link', { name: 'Create a new account' }).click();
  await page.locator('input[type="password"]').first().waitFor({ timeout: 10000 }).catch(async () => {
    fail(`create-account page did not render a password field; page text: ${(await page.evaluate(() => document.body.innerText)).slice(0, 300).replace(/\s+/g, ' ')}`);
  });
  for (const viewport of [{ width: 320, height: 640 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    const pins = page.locator('input[aria-label^="PIN digit "]');
    await pins.nth(11).waitFor();
    const issues = await page.evaluate(() => {
      const problems = [];
      for (const element of document.querySelectorAll('body *')) {
        const rect = element.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility === 'visible' && rect.right > innerWidth + 0.5) {
          problems.push(`${element.tagName} extends to ${rect.right}`);
        }
      }
      const rows = new Set([...document.querySelectorAll('input[aria-label^="PIN digit "]')].map(input => input.parentElement));
      if (rows.size !== 2) problems.push(`expected two PIN rows, received ${rows.size}`);
      for (const row of rows) {
        if (row === null) {
          problems.push('PIN row is missing');
          continue;
        }
        const bounds = row.getBoundingClientRect();
        const cells = [...row.querySelectorAll('input')].map(input => input.getBoundingClientRect());
        if (cells.length !== 6) problems.push('PIN row must contain six cells');
        for (const cell of cells) {
          if (cell.left < bounds.left - 0.5 || cell.right > bounds.right + 0.5 || Math.abs(cell.top - bounds.top) > 0.5) {
            problems.push('PIN cell overflows or wraps');
          }
          if (cell.width < 36 || cell.height < 47) problems.push('PIN cell is too small to tap');
        }
      }
      return problems;
    });
    if (issues.length > 0) fail(`PIN layout at ${viewport.width}px: ${issues.join(' | ')}`);
  }
  if (pageErrors.length > 0) fail(`uncaught page errors: ${pageErrors.join(' | ').slice(0, 500)}`);
  console.log('smoke-boot: OK (home, create-account, PIN rows at 320x640 and 390x844)');
  await browser.close();
} finally {
  stop();
}
