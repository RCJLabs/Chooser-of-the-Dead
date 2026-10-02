import AxeBuilder from '@axe-core/playwright';
import { type CaseSpec, type Destination, startShift } from '@cots/engine';
import { loadContent } from '@cots/testkit';
import { expect, type Page, test } from '@playwright/test';
import { FULL } from './urls';

/*
 * Kennings in the tallies (docs/tech-spec.md §77), played in Practice: on Day 18 the coach teaches the skalds'
 * tallies on the day's first soul and points at the rulebook's page of kennings; on Day 19 a forger's botched kenning
 * gets a one-time tip once read, and Look again says what each kenning on the tally meant. Practice seeds come from
 * the clock and Math.random, so the test pins both and works out the queue with the engine itself.
 */

// With reduced motion nothing is measured mid-slide: a soul walking up with its tally, or a tip fading in.
test.use({ baseURL: FULL, contextOptions: { reducedMotion: 'reduce' } });

const content = loadContent('dev-full');

const seedAt = (date: Date) => `practice:${date.getTime().toString(36)}:${Math.floor(0.5 * 1e9).toString(36)}`;
const queueFor = (day: number, date: Date): CaseSpec[] => [
  ...startShift(content, { mode: 'practice', seed: seedAt(date), day }).state.cases,
];

async function openPractice(page: Page, day: number, date: Date) {
  await page.clock.setFixedTime(date);
  await page.addInitScript(() => {
    Math.random = () => 0.5;
  });
  await page.goto('./');
  await page.getByTestId(`practice-${day}`).click();
  await expect(page.getByTestId('briefing-title')).toHaveText(`Day ${day} practice`);
}

const drawer = async (page: Page) => (await page.locator('.shift--drawer').count()) > 0;

async function stampAndSend(page: Page, dest: Destination) {
  if (await drawer(page)) await page.getByTestId('judge').click();
  await page.locator(`[data-dest="${dest}"]`).click();
  await page.getByTestId('send').click();
}

const needsClipping = (c: CaseSpec) => c.expect.procedures?.includes('proc.clip') === true;

async function expectAccessible(page: Page) {
  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  expect(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')).toBe(true);
}

test('Day 18: the skalds cut tallies in kennings, and the rulebook’s page says what each one means', async ({
  page,
}) => {
  const date = new Date('2027-03-01T12:00:00Z');
  const queue = queueFor(18, date);
  const first = queue[0] as CaseSpec;
  expect(first.archetype).toBe('arch.skald_saga');
  const carved = first.evidence.fields.filter((f) => f.item === 'tally' && f.kenning);
  expect(carved.length).toBeGreaterThan(0);
  await openPractice(page, 18, date);
  await expect(page.getByTestId('decree')).toContainText('cut in kennings');
  await page.getByTestId('begin').click();

  // The first soul's lesson: read its tally, then the rulebook's page of kennings, then judge.
  await expect(page.getByTestId('coach')).toHaveAttribute('data-step', 'd18.tally');
  if (await drawer(page)) await page.locator('[data-tab="tally"]').click();
  const tally = page.getByTestId('tally');
  for (const f of carved) await expect(tally.locator(`[data-field="${f.id}"]`)).toBeVisible();
  await page.getByTestId('coach-next').click();
  await expect(page.getByTestId('coach')).toHaveAttribute('data-step', 'd18.rules');
  if (await drawer(page)) await page.locator('[data-tab="rules"]').click();
  const kennings = page.getByTestId('kennings');
  await expect(kennings.locator('[data-kenning]')).toHaveCount(content.kennings?.length ?? 0);
  await expect(kennings.locator('[data-kenning="k.aegirsDaughters"]')).toContainText("Ægir's daughters");
  await expect(kennings.locator('[data-kenning="k.aegirsDaughters"]')).toContainText('the waves');
  await expect(kennings.locator('[data-kenning="k.elli"]')).toContainText('Old Age, who threw Thor to one knee');
  await expectAccessible(page);
  await page.getByTestId('coach-next').click();
  await expect(page.getByTestId('coach')).toHaveAttribute('data-step', 'd18.judge');
  if (needsClipping(first)) await page.getByTestId('clippers').click();
  await stampAndSend(page, first.expect.dest);
  await expect(page.getByTestId('soul-count')).toHaveText(`Soul 2 of ${queue.length}`);
});

test('Day 19: a forger’s botched kenning, once read, is pointed out once; Look again says what each kenning meant', async ({
  page,
}) => {
  // A day whose line has a soul with a botched kenning early, and no party before it.
  let found: { date: Date; queue: CaseSpec[]; at: number } | null = null;
  for (let i = 0; i < 300 && !found; i++) {
    const date = new Date(Date.UTC(2027, 2, 1, 12) + i * 3_600_000);
    const queue = queueFor(19, date);
    const at = queue.findIndex((c) => c.evidence.fields.some((f) => f.botched));
    if (at >= 0 && at < 4 && queue.slice(0, at + 1).every((c) => c.party === undefined)) found = { date, queue, at };
  }
  if (!found) throw new Error('no Day 19 practice line with a botched kenning early');
  const { date, queue, at } = found;
  const soul = queue[at] as CaseSpec;
  const lines = soul.evidence.fields.filter((f) => f.item === 'tally' && f.kenning);
  await openPractice(page, 19, date);
  await page.getByTestId('begin').click();
  for (const c of queue.slice(0, at)) {
    if (needsClipping(c)) await page.getByTestId('clippers').click();
    await stampAndSend(page, c.expect.dest);
  }
  await expect(page.getByTestId('soul-count')).toHaveText(`Soul ${at + 1} of ${queue.length}`);

  // Read, the botch is pointed out, once.
  if (await drawer(page)) await page.locator('[data-tab="tally"]').click();
  const tip = page.getByTestId('botch-tip');
  await expect(tip).toContainText("That kenning isn't on the rulebook's page");
  await expectAccessible(page);
  await page.getByTestId('botch-tip-ok').click();
  await expect(tip).toHaveCount(0);

  // Stamped wrong, Look again goes through the tally's kennings: the botch marked, the rest glossed.
  await stampAndSend(page, soul.expect.dest === 'VALHALLA' ? 'HEL' : 'VALHALLA');
  await page.getByTestId('citation-look').click();
  const review = page.getByTestId('review-kennings');
  await expect(review.locator('li')).toHaveCount(lines.length);
  await expect(review.getByTestId('review-botched')).toHaveText('No such kenning: a forger cut it');
  await expect(review.getByTestId('review-gloss')).toHaveCount(lines.filter((f) => !f.botched).length);
  await expectAccessible(page);
  await page.getByTestId('review-close').click();
});
