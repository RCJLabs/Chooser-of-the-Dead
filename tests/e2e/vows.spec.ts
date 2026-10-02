import AxeBuilder from '@axe-core/playwright';
import {
  type CaseSpec,
  campaignQueue,
  type Destination,
  ENGINE_MAJOR,
  type RunSave,
  type RunState,
  resumeSave,
  runContext,
  type SoulState,
  unprovenAt,
  vowOffer,
} from '@cots/engine';
import { loadContent, scenarioSave } from '@cots/testkit';
import { expect, type Page, test } from '@playwright/test';
import { FULL } from './urls';

/*
 * Vows at the cup (docs/tech-spec.md §75) and proven stamps (§76) in the full game, from saves made in Node:
 * - Night 5: three vows for tomorrow and a way to swear none; one sworn is in the save, said the next morning and kept
 *   in sight at the desk; kept, the audit pays it;
 * - Day 6 sworn to judge without Skögul's help: a hint breaks it at once, and the audit says so and what it cost;
 * - a soul stamped rightly on a guess: the toast, the audit's row and the look again say what didn't prove it.
 */

test.use({ baseURL: FULL });

const content = loadContent('dev-full');

async function expectAccessible(page: Page) {
  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  expect(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')).toBe(true);
}

const isDrawer = async (page: Page) => (await page.locator('.shift--drawer').count()) > 0;

async function stampAndSend(page: Page, c: CaseSpec) {
  if (c.expect.procedures?.includes('proc.clip')) await page.getByTestId('clippers').click();
  if (await isDrawer(page)) await page.getByTestId('judge').click();
  await page.locator(`[data-dest="${c.expect.dest}"]`).click();
  await page.getByTestId('send').click();
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

/** Today's queue as the save in slot 0 holds it, once the shift has begun. */
async function savedQueue(page: Page): Promise<CaseSpec[]> {
  const raw = await page.evaluate(() => localStorage.getItem('cots.campaign.0'));
  const record = JSON.parse(raw ?? 'null') as { save: { queue: CaseSpec[] | null } } | null;
  return record?.save.queue ?? [];
}

/** `save` with its last morning changed. */
function withMorning(save: RunSave, change: Partial<RunState>): RunSave {
  const morning = save.mornings.at(-1) as RunState;
  return { ...save, mornings: [...save.mornings.slice(0, -1), { ...morning, ...change }] };
}

const bare: SoulState = {
  seen: [],
  view: 'front',
  flipped: false,
  tools: [],
  flagged: [],
  questioned: [],
  stamp: null,
};

test('Night 5: three vows for tomorrow; one sworn is said in the morning, kept in sight at the desk, and paid', async ({
  page,
}) => {
  // A night whose offer has a vow that judging every soul rightly, quickly and without help keeps.
  const kinds = ['clean', 'alone', 'silent', 'sun'];
  let found: { save: RunSave; id: string } | null = null;
  // The night as the save resumes it: its morning, and the day played since.
  const night = (save: RunSave) => resumeSave(save, content, ENGINE_MAJOR).run;
  for (let i = 0; i < 20 && !found; i++) {
    const save = scenarioSave(content, `e2e-vows-${i}`, 5, ENGINE_MAJOR, 'night');
    const vow = vowOffer(night(save), content).find((v) => kinds.includes(v.kind));
    if (vow) found = { save, id: vow.id };
  }
  if (!found) throw new Error('no night offers a vow judging rightly keeps');
  const { save, id } = found;
  const offer = vowOffer(night(save), content);
  await load(page, save);
  await expect(page.getByTestId('night-title')).toHaveText('Night 5');
  await playScenes(page);

  const card = page.getByTestId('vows');
  await expect(card).toContainText('At the cup');
  await expect(card).toContainText('Broken, it costs Odin -1.');
  await expect(card.getByTestId('vow')).toHaveCount(offer.length);
  await expect(page.getByTestId('vow-none')).toBeChecked();
  await expectAccessible(page);
  await card.locator(`[data-vow="${id}"]`).check();
  await expect(card.locator(`[data-vow="${id}"]`)).toBeChecked();
  // Sworn, it's in the save: a reload finds it so.
  await page.reload();
  await page.getByTestId('play-campaign').click();
  await page.getByTestId('continue-0').click();
  await expect(page.getByTestId('vows').locator(`[data-vow="${id}"]`)).toBeChecked();
  await page.getByTestId('sleep').click();

  await expect(page.getByTestId('morning-title')).toHaveText('Day 6');
  await playScenes(page);
  await expect(page.getByTestId('vow-morning')).toContainText('Last night you swore at the cup: “');
  await page.getByTestId('to-gate').click();
  await expect(page.getByTestId('vow-desk')).toHaveAttribute('data-broken', 'no');
  await expect(page.getByTestId('vow-desk')).toContainText('Your vow: ');
  for (const c of await savedQueue(page)) await stampAndSend(page, c);

  await expect(page.getByTestId('audit-title')).toHaveText('Day 6: the audit');
  await expect(page.getByTestId('vow-result')).toHaveAttribute('data-kept', 'yes');
  await expect(page.getByTestId('vow-result')).toContainText('You kept your vow');
  await expect(page.getByTestId('audit-vow-rings')).toContainText('Your vow at the cup, kept');
  await expectAccessible(page);
});

test('Day 6 sworn to judge without Skögul’s help: a hint breaks it; a right stamp on a guess is lucky', async ({
  page,
}) => {
  // A morning with no appeal whose first soul, a lone one, the body's front doesn't settle.
  let found: { save: RunSave; first: CaseSpec } | null = null;
  for (let i = 0; i < 40 && !found; i++) {
    const save = scenarioSave(content, `e2e-vows-alone-${i}`, 6, ENGINE_MAJOR);
    const run = save.mornings.at(-1) as RunState;
    if (run.appeal) continue;
    const ctx = runContext(content, run);
    const first = campaignQueue(run, { content, ctx })[0];
    if (first && first.party === undefined && unprovenAt([first], [bare], 0, ctx) !== null) {
      found = { save: withMorning(save, { vow: 'vow.alone' }), first };
    }
  }
  if (!found) throw new Error('no Day 6 morning whose first soul the front of its body leaves open');
  const { save, first } = found;
  await load(page, save);
  await playScenes(page);
  await expect(page.getByTestId('vow-morning')).toContainText("I'll judge without Skögul's help.");
  await page.getByTestId('to-gate').click();
  const queue = await savedQueue(page);
  expect(queue[0]?.id).toBe(first.id);

  // Skögul's help, asked: the vow is broken on the spot.
  await expect(page.getByTestId('vow-desk')).toHaveAttribute('data-broken', 'no');
  await page.getByTestId('hint').click();
  await expect(page.getByTestId('vow-desk')).toHaveAttribute('data-broken', 'yes');
  await expect(page.getByTestId('vow-desk')).toHaveText('Your vow: no help from Skögul. Broken.');
  await expectAccessible(page);

  // The first soul stamped rightly without a look: right, and said to be a guess.
  await stampAndSend(page, first);
  await expect(page.locator('.toast').last()).toHaveText(
    `Sent to ${DEST[first.expect.dest]}. Right, but what you'd seen didn't prove it.`,
  );
  for (const c of queue.slice(1)) await stampAndSend(page, c);
  await expect(page.getByTestId('audit-title')).toHaveText('Day 6: the audit');
  await expect(page.getByTestId('vow-result')).toHaveAttribute('data-kept', 'no');
  await expect(page.getByTestId('vow-result')).toHaveText(
    "You broke your vow: “I'll judge without Skögul's help.”It cost you: Odin -1.",
  );
  await expect(page.getByTestId('standing').locator('thead')).toContainText('Vow');

  // At the audit: the guess marked on its row, the grade says what Flawless asks, and a look again says why.
  const row = page.getByTestId('verdict').first();
  await expect(row.getByTestId('lucky-note')).toHaveText('(right, but a guess)');
  await expect(page.getByTestId('day-grade-why')).toContainText('proves every stamp');
  await row.getByTestId('look-again').click();
  await expect(page.getByTestId('review')).toContainText(
    `${DEST[first.expect.dest]} was right, but what you'd seen didn't prove it.`,
  );
  await expectAccessible(page);
  await page.getByTestId('review-close').click();
});

const DEST: Readonly<Record<Destination, string>> = {
  VALHALLA: 'Valhalla',
  HEL: 'Hel',
  RETURN: 'Return',
  FOLKVANGR: 'Fólkvangr',
  RAN: 'Rán',
  TRANSFER: 'Transfer',
  DETAIN: 'Detain',
};
