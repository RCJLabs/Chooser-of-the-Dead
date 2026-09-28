import { type CaseSpec, type Destination, startShift } from '@cots/engine';
import { loadContent } from '@cots/testkit';
import { expect, type Page, test } from '@playwright/test';
import { FULL } from './urls';

/*
 * Showing the mistake (docs/tech-spec.md §67), in Day 3 practice of the full game: a wrong stamp's citation opens
 * the soul again, with what decided it, what wasn't looked at and the rule, while the sun waits; the summary opens
 * it again too, and the soul can be tried again on its own, for nothing. Practice seeds come from the clock and
 * Math.random, so the test pins both and asks the engine for the queue.
 */

const content = loadContent('dev-full');
const DATE = new Date('2027-03-01T12:00:00Z');
const SEED = `practice:${DATE.getTime().toString(36)}:${Math.floor(0.5 * 1e9).toString(36)}`;
const DAY = 3;
const queue: readonly CaseSpec[] = startShift(content, { mode: 'practice', seed: SEED, day: DAY }).state.cases;
// The last soul, stamped where it doesn't belong without a look at it.
const WRONG = queue.length - 1;
const wrongSoul = queue[WRONG];
if (!wrongSoul) throw new Error('no souls');
const wrongDest: Destination = wrongSoul.expect.dest === 'HEL' ? 'VALHALLA' : 'HEL';
const name = `${wrongSoul.evidence.look.name} ${wrongSoul.evidence.look.patronym}`;

const drawer = async (page: Page) => (await page.locator('.shift--drawer').count()) > 0;

async function stampAndSend(page: Page, dest: Destination) {
  if (await drawer(page)) await page.getByTestId('judge').click();
  await page.locator(`[data-dest="${dest}"]`).click();
  await page.getByTestId('send').click();
}

async function checkReview(page: Page) {
  const review = page.getByTestId('review');
  await expect(review.locator('#review-title')).toHaveText(`${name}, again`);
  await expect(review).toContainText(`You sent them to ${wrongDest === 'HEL' ? 'Hel' : 'Valhalla'}.`);
  await expect(review).toContainText('The rule that decided it');
  // Nothing was looked at: everything that decided the soul was missed, and marked on the body too.
  const proof = review.getByTestId('review-proof').locator('li');
  await expect(proof).toHaveCount(wrongSoul?.meta.proof.length ?? 0);
  await expect(proof.filter({ hasText: "You didn't look" })).toHaveCount(wrongSoul?.meta.proof.length ?? 0);
  await expect(review.locator('.review__mark.is-missed').first()).toBeVisible();
}

test.describe('in practice', () => {
  test.use({ baseURL: FULL });

  test('a citation opens the soul again while the sun waits; the summary does too, and it can be tried again', async ({
    page,
  }) => {
    await page.clock.setFixedTime(DATE);
    await page.addInitScript(() => {
      Math.random = () => 0.5;
    });
    await page.goto('./');
    await page.getByTestId(`practice-${DAY}`).click();
    await page.getByTestId('begin').click();
    for (const [i, c] of queue.entries()) {
      await expect(page.getByTestId('soul-count')).toHaveText(`Soul ${i + 1} of ${queue.length}`);
      await stampAndSend(page, i === WRONG ? wrongDest : c.expect.dest);
    }
    // The last soul's citation comes after the shift ends: it's opened again from the summary.
    await expect(page.getByTestId('score')).toHaveText(`${queue.length - 1} of ${queue.length} judged rightly`);
    const row = page.getByTestId('verdict').nth(WRONG);
    await row.getByTestId('look-again').click();
    await checkReview(page);
    await page.getByTestId('review-close').click();
    await expect(page.getByTestId('review')).toHaveCount(0);

    // Tried again on its own, with no sun: it counts for nothing, and it's back to the summary.
    await row.getByTestId('look-again').click();
    await page.getByTestId('review-again').click();
    await expect(page.getByTestId('again-banner')).toHaveText(`Again: ${wrongSoul.evidence.look.name}, with no sun`);
    await expect(page.getByTestId('soul-count')).toHaveText('Soul 1 of 1');
    await stampAndSend(page, wrongSoul.expect.dest);
    await expect(page.locator('.toast').last()).toHaveText(/^Right this time/);
    await expect(page.getByTestId('score')).toHaveText(`${queue.length - 1} of ${queue.length} judged rightly`);
  });

  test('mid-shift, the citation opens the soul again and the sun waits until it is put away', async ({ page }) => {
    await page.clock.setFixedTime(DATE);
    await page.addInitScript(() => {
      Math.random = () => 0.5;
    });
    await page.goto('./');
    await page.getByTestId(`practice-${DAY}`).click();
    await page.getByTestId('begin').click();
    // The first soul stamped wrong: its citation comes at once, with souls still waiting.
    const first = queue[0];
    if (!first) throw new Error('no souls');
    const wrong: Destination = first.expect.dest === 'HEL' ? 'VALHALLA' : 'HEL';
    await stampAndSend(page, wrong);
    await page.getByTestId('citation-look').click();
    await expect(page.getByTestId('review')).toBeVisible();
    await expect(page.locator('.shift')).toHaveClass(/is-paused/);
    // There's no trying again until the shift is over.
    await expect(page.getByTestId('review-again')).toHaveCount(0);
    await expect(page.getByTestId('review')).toContainText('The sun waits while you look.');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('review')).toHaveCount(0);
    await expect(page.locator('.shift')).not.toHaveClass(/is-paused/);
    await expect(page.getByTestId('soul-count')).toHaveText(`Soul 2 of ${queue.length}`);
  });
});

test('the audit opens a mistake again, and it can be tried again for nothing', async ({ page }) => {
  // The web demo's campaign, pinned as the appeal test pins it: the first soul belongs in Valhalla.
  await page.clock.setFixedTime(new Date('2027-01-10T12:00:00Z'));
  await page.addInitScript('Math.random = () => 0.01;');
  await page.goto('./');
  await page.getByTestId('play-campaign').click();
  await page.getByTestId('new-0').click();
  await expect(page.getByTestId('scene')).toBeVisible();
  while ((await page.getByTestId('scene-done').count()) === 0) await page.getByTestId('scene-choice').first().click();
  await page.getByTestId('scene-done').click();
  await page.getByTestId('to-gate').click();
  const raw = await page.evaluate(() => localStorage.getItem('cots.campaign.0'));
  const record = JSON.parse(raw ?? 'null') as { save: { queue: { expect: { dest: Destination } }[] } };
  const [first, ...rest] = record.save.queue.map((c) => c.expect.dest);
  expect(first).toBe('VALHALLA');
  await stampAndSend(page, 'HEL');
  await page.getByTestId('citation-close').click();
  for (const dest of rest) await stampAndSend(page, dest);
  await expect(page.getByTestId('audit-title')).toHaveText('Day 1: the audit');
  const purse = await page.getByTestId('audit-rings').textContent();

  await page.getByTestId('verdict').first().getByTestId('look-again').click();
  await expect(page.getByTestId('review').locator('#review-title')).toHaveText('Grim Hrafnsson, again');
  await expect(page.getByTestId('review')).toContainText('You sent them to Hel. They belonged in Valhalla.');
  await page.getByTestId('review-again').click();
  await expect(page.getByTestId('again-banner')).toHaveText('Again: Grim, with no sun');
  await stampAndSend(page, 'VALHALLA');
  await expect(page.locator('.toast').last()).toHaveText('Right this time: Valhalla.');
  // Back at the audit, with nothing changed.
  await expect(page.getByTestId('audit-title')).toHaveText('Day 1: the audit');
  await expect(page.getByTestId('audit-rings')).toHaveText(purse ?? '');
  await expect(page.getByTestId('verdict').first()).toHaveClass(/is-wrong/);
});
