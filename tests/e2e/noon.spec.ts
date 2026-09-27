import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { campaignQueue, type Destination, ENGINE_MAJOR, judge, type RunState, runContext } from '@cots/engine';
import { loadContent, scenarioSave } from '@cots/testkit';
import { expect, type Page, test } from '@playwright/test';
import { FULL } from './urls';

/*
 * A noon decree (docs/tech-spec.md §45) in the full game: a save on the decree's day, made in Node with every
 * earlier soul judged rightly. The raven brings Freyja's new whim before noon; from noon the rulebook has it, and
 * the first soul after noon, stamped as the morning's whim would have it, is cited.
 */

test.use({ baseURL: FULL });

const content = loadContent('dev-full');
const strings: Record<string, string> = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../../content/packs/campaign/strings/en.json'), 'utf8'),
);
// Day 19's decree, which redraws Freyja's whim (Day 18's redraws Odin's claim, below).
const day = content.days.find((d) => d.noon?.redraw.includes('freyjaWhim'))?.day ?? 0;

// The first seed whose first soul after noon would have gone elsewhere under the morning's whim.
const { save, queue, first, notice, before, after, text, morningDest } = (() => {
  for (let i = 0; i < 20; i++) {
    const s = scenarioSave(content, `e2e-noon-${i}`, day, ENGINE_MAJOR);
    const run = s.mornings[s.mornings.length - 1] as RunState;
    const ctx = runContext(content, run);
    const noon = ctx.noon;
    const q = campaignQueue(run, { content, ctx });
    const k = q.findIndex((c) => c.noon);
    const c = q[k];
    if (!noon || !c || judge(c.truth, ctx).dest === c.expect.dest) continue;
    const whim = (x: typeof ctx) => strings[x.paramChoices.freyjaWhim?.text ?? ''] ?? '';
    return {
      save: s,
      queue: q,
      first: k,
      notice: noon.notice,
      before: whim(ctx),
      after: whim(noon.ctx),
      text: strings[noon.text] ?? '',
      morningDest: judge(c.truth, ctx).dest,
    };
  }
  throw new Error('No seed in 20 has a first soul after noon that the decree changes');
})();

const isDrawer = async (page: Page) => (await page.locator('.shift--drawer').count()) > 0;

async function stampAndSend(page: Page, dest: Destination, clip: boolean) {
  if (clip) await page.getByTestId('clippers').click();
  if (await isDrawer(page)) await page.getByTestId('judge').click();
  await page.locator(`[data-dest="${dest}"]`).click();
  await page.getByTestId('send').click();
}

/** Freyja's whim as the rulebook shows it for the soul at the desk. */
async function rulebookWhim(page: Page): Promise<string> {
  if (await isDrawer(page)) await page.locator('[data-tab="rules"]').click();
  const whim = page.locator('.rules [data-testid="whim"]').first();
  await expect(whim).toBeVisible();
  return whim.innerText();
}

test('a noon decree: the raven before noon, the new whim from noon, and a stamp by the old one cited', async ({
  page,
}) => {
  expect(before).not.toBe(after);
  await page.addInitScript(
    (record) => localStorage.setItem('cots.campaign.0', record),
    JSON.stringify({ v: 1, rev: 1, savedAt: 0, save }),
  );
  await page.goto('./');
  await page.getByTestId('play-campaign').click();
  await page.getByTestId('continue-0').click();
  await expect(page.getByTestId('morning-title')).toHaveText(`Day ${day}`);
  while ((await page.getByTestId('scene-done').count()) === 0) await page.getByTestId('scene-choice').first().click();
  await page.getByTestId('scene-done').click();
  await page.getByTestId('to-gate').click();
  const saved = await page.evaluate<{ id: string }[]>(
    `JSON.parse(localStorage.getItem('cots.campaign.0') ?? 'null')?.save.queue ?? []`,
  );
  expect(saved.map((c) => c.id)).toEqual(queue.map((c) => c.id));

  for (const [i, c] of queue.entries()) {
    await expect(page.getByTestId('soul-count')).toHaveText(`Soul ${i + 1} of ${queue.length}`);
    const clip = c.expect.procedures?.includes('proc.clip') === true;
    if (i === 0) {
      // The morning's whim, and no raven yet.
      expect(await rulebookWhim(page)).toBe(before);
      await expect(page.getByTestId('noon-raven')).toHaveCount(0);
    }
    if (i === first - notice) {
      // The raven comes with the news: the soul at the desk and the next are still the morning's.
      await expect(page.getByTestId('noon-raven')).toContainText(text);
      await expect(page.getByTestId('noon-raven')).toContainText(after);
      expect(await rulebookWhim(page)).toBe(before);
      // Read out as it comes (a live region), within the accessibility checks, and within the screen.
      await expect(page.locator('.shift__noon-region')).toHaveAttribute('role', 'status');
      const axe = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
        .analyze();
      expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
      expect(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')).toBe(true);
    }
    if (i === first) {
      await expect(page.getByTestId('noon-raven')).toHaveCount(0);
      await expect(page.getByTestId('noon-since')).toHaveText(`Since noon: ${after}`);
      expect(await rulebookWhim(page)).toBe(after);
      // Stamped as the morning's whim would have it: a citation.
      await stampAndSend(page, morningDest, clip);
      await expect(page.getByTestId('citation-close')).toBeVisible();
      await page.getByTestId('citation-close').click();
      continue;
    }
    await stampAndSend(page, c.expect.dest, clip);
  }

  await expect(page.getByTestId('audit-title')).toHaveText(`Day ${day}: the audit`);
  await expect(page.getByTestId('audit-score')).toHaveText(`${queue.length - 1} of ${queue.length} judged rightly`);
});

test('Day 18: Odin at the desk after the third soul, and at noon his raven with a new claim', async ({ page }) => {
  // Odin's day (docs/tech-spec.md §59): his visit, then his decree. A save on its morning, every soul judged rightly.
  const d18 = content.days.find((d) => d.noon?.redraw.includes('odinClaim'));
  const visit = d18?.queue.visits?.[0];
  if (!d18?.noon || !visit) throw new Error('no decree of Odin’s in this build');
  const s = scenarioSave(content, 'e2e-noon-odin', d18.day, ENGINE_MAJOR);
  const run = s.mornings[s.mornings.length - 1] as RunState;
  const ctx = runContext(content, run);
  const q = campaignQueue(run, { content, ctx });
  const k = q.findIndex((c) => c.noon);
  const claim = strings[ctx.noon?.ctx.paramChoices.odinClaim?.text ?? ''] ?? '';
  expect(claim).not.toBe('');
  expect(k - d18.noon.notice).toBeGreaterThan(visit.at);
  await page.addInitScript(
    (record) => localStorage.setItem('cots.campaign.0', record),
    JSON.stringify({ v: 1, rev: 1, savedAt: 0, save: s }),
  );
  await page.goto('./');
  await page.getByTestId('play-campaign').click();
  await page.getByTestId('continue-0').click();
  await expect(page.getByTestId('morning-title')).toHaveText(`Day ${d18.day}`);
  while ((await page.getByTestId('scene-done').count()) === 0) await page.getByTestId('scene-choice').first().click();
  await page.getByTestId('scene-done').click();
  await page.getByTestId('to-gate').click();
  const desk = page.getByTestId('desk-visit');
  for (const [i, c] of q.entries()) {
    if (i === visit.at) {
      await expect(desk).toContainText('Nobody in this line knows me in this hat.');
      while ((await desk.getByTestId('scene-done').count()) === 0)
        await desk.getByTestId('scene-choice').first().click();
      await desk.getByTestId('scene-done').click();
    }
    if (i === k - d18.noon.notice) {
      await expect(page.getByTestId('noon-raven')).toContainText(strings[d18.noon.text] ?? '');
      await expect(page.getByTestId('noon-raven')).toContainText(claim);
    }
    if (i === k) await expect(page.getByTestId('noon-since')).toHaveText(`Since noon: ${claim}`);
    await stampAndSend(page, c.expect.dest, c.expect.procedures?.includes('proc.clip') === true);
  }
  await expect(page.getByTestId('audit-score')).toHaveText(`${q.length} of ${q.length} judged rightly`);
});
