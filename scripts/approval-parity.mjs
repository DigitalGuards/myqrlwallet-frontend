import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parityFixtures } from './approval-fixtures.mjs';

// Capture initial geometry before any review scrolling. Baseline mode runs this
// same probe against an unchanged origin/dev build through the caller's cwd.
export async function measureParity({ page, open, close, output, baseline }) {
  const results = [];
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    for (const { name, approval, maximal = false, empty = false } of parityFixtures()) {
      await open(approval.method, maximal, `parity-${name}`, empty, approval);
      const measured = await page.getByRole('dialog').evaluate((dialog) => {
        const region = dialog.querySelector('[role=region]');
        const button = [...dialog.querySelectorAll('button')].find((el) => ['Approve', 'Connect'].includes(el.textContent.trim()));
        const elements = [dialog, ...dialog.querySelectorAll('*')].filter((el) => {
          if (el.closest('[aria-hidden=true],.sr-only') || el.getBoundingClientRect().height <= 0) return false;
          const closed = el.closest('details:not([open])');
          return !closed || el === closed || closed.querySelector('summary')?.contains(el);
        });
        const scrolling = elements.filter((el) => {
          const style = getComputedStyle(el);
          return (/(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight) ||
            (/(auto|scroll)/.test(style.overflowX) && el.scrollWidth > el.clientWidth);
        }).length;
        const clipped = elements.some((el) => {
          const style = getComputedStyle(el);
          return /(hidden|clip)/.test(style.overflow) &&
            (el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight);
        });
        return {
          dialogHeight: dialog.getBoundingClientRect().height,
          regionHeight: region.getBoundingClientRect().height,
          enabled: !button.disabled,
          scrolling,
          fitted: scrolling === 0 && !clipped,
        };
      });
      results.push({ name, viewport: `${viewport.width}x${viewport.height}`, ...measured });
      if (/typed-(array|record|first-level)/.test(name))
        await page.screenshot({ path: join(output, `parity-${name}-${viewport.width}.png`) });
      await close();
    }
  }
  await writeFile(join(output, 'parity.json'), JSON.stringify(results, null, 2));
  if (!baseline) {
    // Captured from origin/dev 0aa0559 with these same fixtures and fonts.
    const base = JSON.parse(await readFile(process.env.APPROVAL_PARITY_BASE ??
      new URL('./approval-parity-baseline.json', import.meta.url), 'utf8'));
    assert.equal(results.length, base.length, 'Incomplete parity matrix');
    const failures = [];
    for (const before of base) {
      const after = results.find((row) => row.name === before.name && row.viewport === before.viewport);
      assert(after, `Missing parity fixture: ${before.name} ${before.viewport}`);
      if (before.fitted && (after.dialogHeight !== before.dialogHeight || after.regionHeight !== before.regionHeight || !after.enabled))
        failures.push({ before, after });
    }
    await writeFile(join(output, 'parity-failures.json'), JSON.stringify(failures, null, 2));
    assert.deepEqual(failures, [], 'Fitted layout parity');
  }
  console.log(`approval-visibility: ${results.length} initial parity measurements`);
  return results;
}
