import { type CaseSpec, type Destination, pressAnswer, soulCtx, startShift } from '@cots/engine';
import { loadContent } from '@cots/testkit';
import { expect, type Page, test } from '@playwright/test';
import { FULL } from './urls';

/*
 * Pressing a soul on what it said (docs/tech-spec.md §66), in Day 3 practice of the full game: a liar that gives
 * way, a liar that holds and lets something slip that the body shows false, patience, and the tip that teaches it.
 * Practice seeds come from the clock and Math.random, so the test pins both and asks the engine what each soul
 * will do. The Daily has no pressing at all.
 */

const content = loadContent('dev-full');
const DATE = new Date('2027-03-01T12:00:00Z');
const SEED = `practice:${DATE.getTime().toString(36)}:${Math.floor(0.5 * 1e9).toString(36)}`;
const DAY = content.press?.since ?? 3;
const { state, ctx } = startShift(content, { mode: 'practice', seed: SEED, day: DAY });
const queue: readonly CaseSpec[] = state.cases;

/** The first soul, and its lying claim, that answers as `want` says when pressed. */
function soulWhere(want: (c: CaseSpec, field: string) => boolean): { i: number; field: string } {
  for (const [i, c] of queue.entries()) {
    for (const l of c.lies) if (!l.via && want(c, l.field)) return { i, field: l.field };
  }
  throw new Error(`no such soul in Day ${DAY} practice`);
}
const answer = (c: CaseSpec, field: string) => pressAnswer(c, field, soulCtx(ctx, c));
const slips = soulWhere((c, f) => {
  const said = answer(c, f)?.said?.says;
  return said !== undefined && c.truth[said.fact] !== said.value && said.fact === 'woundsFront';
});
const gives = soulWhere((c, f) => answer(c, f)?.gave === true);

const drawer = async (page: Page) => (await page.locator('.shift--drawer').count()) > 0;

async function openPractice(page: Page) {
  await page.clock.setFixedTime(DATE);
  await page.addInitScript(() => {
    Math.random = () => 0.5;
  });
  await page.goto('./');
  await page.getByTestId(`practice-${DAY}`).click();
  await page.getByTestId('begin').click();
}

async function stampAndSend(page: Page, dest: Destination) {
  if (await drawer(page)) await page.getByTestId('judge').click();
  await page.locator(`[data-dest="${dest}"]`).click();
  await page.getByTestId('send').click();
}

async function lookAtEverything(page: Page) {
  const look = page.locator('.chip--look');
  while ((await look.count()) > 0) await look.first().click();
}

test.describe('in practice', () => {
  test.use({ baseURL: FULL });

  test('a liar holds and lets slip what the body shows false; another gives way; each takes two', async ({ page }) => {
    await openPractice(page);
    for (const [i, c] of queue.entries()) {
      await expect(page.getByTestId('soul-count')).toHaveText(`Soul ${i + 1} of ${queue.length}`);
      if (i === slips.i) {
        // The tip, once, with the soul's words, before the first press.
        await expect(page.getByTestId('press-tip')).toContainText('New: press a soul on something it said');
        await page.getByTestId('press-tip-ok').click();
        await expect(page.getByTestId('press-tip')).toHaveCount(0);

        const claim = page.locator(`.evidence:has([data-field="${slips.field}"])`);
        await expect(page.getByTestId('patience')).toHaveText("They'll take 2 more presses.");
        await claim.getByTestId('press').click();
        await expect(page.locator('#answer-title')).toHaveText(`${c.evidence.look.name} holds to it`);
        await expect(page.getByTestId('answer-added')).toContainText('One wound, and it was in my chest.');
        await page.getByTestId('answer-close').click();
        await expect(claim.locator('.evidence__badge')).toHaveText('Held to it');
        await expect(page.getByTestId('patience')).toHaveText("They'll take one more press.");

        // What it added is a claim like any other: shown false against the chest, then questioned.
        const said = page.locator(`[data-field="said.${slips.field}"]`);
        await expect(said).toBeVisible();
        await lookAtEverything(page);
        await said.click();
        await page.locator('[data-field="body.front.woundsFront"]').click();
        await expect(page.locator('.toast').last()).toHaveText('Caught: that was a lie.');
        await page.locator(`.evidence:has([data-field="said.${slips.field}"])`).getByTestId('question').click();
        await expect(page.locator('#answer-title')).toHaveText(`${c.evidence.look.name} answers`);
        await page.getByTestId('answer-close').click();
      }
      if (i === gives.i) {
        const claim = page.locator(`.evidence:has([data-field="${gives.field}"])`);
        await claim.getByTestId('press').click();
        await expect(page.locator('#answer-title')).toHaveText(`${c.evidence.look.name} gives way`);
        await page.getByTestId('answer-close').click();
        await expect(claim.locator('.evidence__badge')).toHaveText('Gave way');
        // The tip was put away: it never comes back.
        await expect(page.getByTestId('press-tip')).toHaveCount(0);
      }
      await stampAndSend(page, c.expect.dest);
    }
    await expect(page.getByTestId('score')).toHaveText(`${queue.length} of ${queue.length} judged rightly`);
    // Both lies were caught: one shown false through what slipped out, one given up.
    await expect(page.getByText('2 lies caught')).toBeVisible();
  });
});

test('the Daily plays as it always has: no soul is pressed there', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2027-01-10T12:00:00Z'));
  await page.goto('./');
  await page.getByTestId('play-daily').click();
  await page.getByTestId('begin').click();
  await expect(page.locator('.words .evidence').first()).toBeVisible();
  await expect(page.getByTestId('press')).toHaveCount(0);
  await expect(page.getByTestId('patience')).toHaveCount(0);
});
