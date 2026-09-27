import AxeBuilder from '@axe-core/playwright';
import { campaignQueue, type Destination, ENGINE_MAJOR, pleaOf, type RunState, runContext } from '@cots/engine';
import { loadContent, scenarioSave } from '@cots/testkit';
import { expect, type Page, test } from '@playwright/test';
import { FULL } from './urls';

/*
 * Pleas from ordinary souls (docs/tech-spec.md §59) in the full game: a save on the morning of a day when one of the
 * day's own souls asks for another hall, made in Node with every earlier soul judged rightly. The plea is on the desk
 * while that soul is there, with what granting it means at the last battle; granted, it's cited like any wrong stamp,
 * and the audit counts it.
 */

test.use({ baseURL: FULL });

const content = loadContent('dev-full');
const DAY = 8;

// The first seed whose Day 8 line has a soul who pleads (drawn from the run's seed and the day).
const { save, dest } = (() => {
  for (let i = 0; i < 40; i++) {
    const s = scenarioSave(content, `e2e-plea-${i}`, DAY, ENGINE_MAJOR);
    const run = s.mornings[s.mornings.length - 1] as RunState;
    // Not the day's last soul, whose stamp ends the shift before a citation can show.
    const queue = campaignQueue(run, { content, ctx: runContext(content, run) });
    const soul = queue.slice(0, -1).find((c) => c.plea);
    const plea = soul ? pleaOf(content, soul) : null;
    if (plea) return { save: s, dest: plea.dest };
  }
  throw new Error(`No seed in 40 has a soul who pleads on Day ${DAY}`);
})();

interface SavedSoul {
  readonly plea?: { readonly stamp: Destination };
  readonly expect: { readonly dest: Destination; readonly procedures?: readonly string[] };
  readonly evidence: {
    readonly look: { readonly name: string; readonly patronym: string; readonly gender: 'm' | 'f' };
  };
}

const isDrawer = async (page: Page) => (await page.locator('.shift--drawer').count()) > 0;

async function stampAndSend(page: Page, to: Destination, clip: boolean) {
  if (clip) await page.getByTestId('clippers').click();
  if (await isDrawer(page)) await page.getByTestId('judge').click();
  await page.locator(`[data-dest="${to}"]`).click();
  await page.getByTestId('send').click();
}

test('an ordinary soul pleads for another hall: said openly with what it means at the last battle, cited if granted', async ({
  page,
}) => {
  await page.addInitScript(
    (record) => localStorage.setItem('cots.campaign.0', record),
    JSON.stringify({ v: 1, rev: 1, savedAt: 0, save }),
  );
  await page.goto('./');
  await page.getByTestId('play-campaign').click();
  await page.getByTestId('continue-0').click();
  await expect(page.getByTestId('morning-title')).toHaveText(`Day ${DAY}`);
  while ((await page.getByTestId('scene-done').count()) === 0) await page.getByTestId('scene-choice').first().click();
  await page.getByTestId('scene-done').click();
  await page.getByTestId('to-gate').click();
  const queue = await page.evaluate<SavedSoul[]>(
    `JSON.parse(localStorage.getItem('cots.campaign.0') ?? 'null')?.save.queue ?? []`,
  );
  const at = queue.findIndex((c) => c.plea);
  expect(at).toBeGreaterThan(0);
  expect(queue.filter((c) => c.plea)).toHaveLength(1);

  for (const [i, c] of queue.entries()) {
    const clip = c.expect.procedures?.includes('proc.clip') === true;
    if (i === at) {
      const { name, patronym, gender } = c.evidence.look;
      const banner = page.getByTestId('plea-banner');
      await expect(banner).toContainText(`${name} ${patronym} asks for a`);
      await expect(banner).toContainText('a mistake all the same.');
      await expect(banner.getByTestId('plea-stands')).toHaveText(
        `Granted, ${gender === 'f' ? 'she' : 'he'}'ll stand with that hall's host at the last battle, not run from it.`,
      );
      const axe = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
        .analyze();
      expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
      expect(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')).toBe(true);
      // Granted: a wrong stamp all the same, cited on the spot.
      await stampAndSend(page, dest, false);
      await expect(page.getByTestId('citation-close')).toBeVisible();
      await page.getByTestId('citation-close').click();
      continue;
    }
    // Nobody else asks for anything.
    await expect(page.getByTestId('plea-banner')).toHaveCount(0);
    await stampAndSend(page, c.expect.dest, clip);
  }

  await expect(page.getByTestId('audit-title')).toHaveText(`Day ${DAY}: the audit`);
  await expect(page.getByTestId('audit-score')).toHaveText(`${queue.length - 1} of ${queue.length} judged rightly`);
});
