import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { decreeDaysFor, draftsTonight, ENGINE_MAJOR, type RunSave, resumeSave } from '@cots/engine';
import { loadContent, scenarioSave } from '@cots/testkit';
import { expect, type Page, test } from '@playwright/test';
import { FULL } from './urls';

/*
 * Tomorrow's decree, sealed (docs/tech-spec.md §79), in the full game, from a save made in Node on the night before
 * one of the run's decree days: Odin's clerks send up two drafts, each with what it decrees and what sealing it does,
 * and sending them back is the default. One picked is in the save; sealed as the night ends, it's the morning's
 * decree, and the morning says so.
 */

// Reduced motion: a save loaded in a fresh browser earns achievements, and an axe scan during the notice's fade-in
// reads its half-faded words as low contrast.
test.use({ baseURL: FULL, contextOptions: { reducedMotion: 'reduce' } });

const content = loadContent('dev-full');
const strings: Record<string, string> = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../../content/packs/campaign/strings/en.json'), 'utf8'),
);

async function expectAccessible(page: Page) {
  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  expect(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')).toBe(true);
}

async function load(page: Page, save: RunSave) {
  // Into an empty slot only: a reload must find what the game saved since, not this save again.
  await page.addInitScript(
    (record) => {
      if (localStorage.getItem('cots.campaign.0') === null) localStorage.setItem('cots.campaign.0', record);
    },
    JSON.stringify({ v: 1, rev: 1, savedAt: 0, save }),
  );
  await page.goto('./');
  await page.getByTestId('play-campaign').click();
  await page.getByTestId('continue-0').click();
}

/** Plays every scene showing through its first options. */
async function playScenes(page: Page) {
  while ((await page.getByTestId('scene').count()) > 0) {
    while ((await page.getByTestId('scene-done').count()) === 0) await page.getByTestId('scene-choice').first().click();
    await page.getByTestId('scene-done').click();
  }
}

test('the night before a decree day: two drafts and sending them back; one sealed is the morning’s decree', async ({
  page,
}) => {
  // A run whose first decree day comes before Day 15, so that a draft decrees Freyja's whim alone.
  const seed = Array.from({ length: 40 }, (_, i) => `e2e-sealed-${i}`).find(
    (s) => (decreeDaysFor(content, s)[0] ?? 99) < 15,
  );
  if (!seed) throw new Error('no run draws a decree day before Day 15');
  const day = decreeDaysFor(content, seed)[0] ?? 0;
  const save = scenarioSave(content, seed, day - 1, ENGINE_MAJOR, 'night');
  const drafts = draftsTonight(resumeSave(save, content, ENGINE_MAJOR).run, content);
  const freyja = drafts.find((d) => d.def.id === 'draft.freyja');
  const odin = drafts.find((d) => d.def.id === 'draft.odin');
  if (!freyja || !odin) throw new Error('no drafts tonight');
  const whim = (d: typeof freyja) => d.texts.map((k) => strings[k] ?? k);

  await load(page, save);
  await expect(page.getByTestId('night-title')).toHaveText(`Night ${day - 1}`);
  await playScenes(page);

  // Two drafts, each the decree it would make and what sealing it does; sent back, unless one is picked.
  const card = page.getByTestId('decrees');
  await expect(card.getByRole('heading')).toHaveText("Tomorrow's decree");
  await expect(card.getByTestId('draft')).toHaveCount(2);
  await expect(page.getByTestId('draft-none')).toBeChecked();
  const label = (id: string) => card.locator('label', { has: page.locator(`[data-draft="${id}"]`) });
  await expect(label('draft.freyja').getByTestId('draft-line')).toHaveText(whim(freyja));
  await expect(label('draft.odin').getByTestId('draft-line')).toHaveText(whim(odin));
  await expect(label('draft.freyja')).toContainText('Sealed: Freyja +1 and Odin -1.');
  await expect(label('draft.odin')).toContainText('Sealed: Odin +1 and Freyja -1.');
  await expectAccessible(page);

  await card.locator('[data-draft="draft.freyja"]').check();
  await expect(card.locator('[data-draft="draft.freyja"]')).toBeChecked();
  // Picked, it's in the save: a reload finds it so.
  await page.reload();
  await page.getByTestId('play-campaign').click();
  await page.getByTestId('continue-0').click();
  await expect(page.getByTestId('decrees').locator('[data-draft="draft.freyja"]')).toBeChecked();
  await page.getByTestId('sleep').click();

  // Sealed as the night ended: the morning's decree is the draft's, and the morning says it was sealed.
  await expect(page.getByTestId('morning-title')).toHaveText(`Day ${day}`);
  await playScenes(page);
  await expect(page.getByTestId('sealed-morning')).toHaveText("You sealed today's decree last night: Freyja's draft.");
  await expect(page.getByTestId('whim')).toHaveText(whim(freyja));
  await expectAccessible(page);
});
