import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type CaseSpec, type Destination, endlessRound, endlessSeed, endlessTwist } from '@cots/engine';
import { loadContent } from '@cots/testkit';
import { expect, type Page, test } from '@playwright/test';

/*
 * Endless on the web demo: rounds of five souls on each day's rules in turn,
 * until three wrong stamps. Today's run is numbered like the Daily (2027-03-01
 * is #91) and its seed is the same for everyone, so the test works out each
 * round, and the right answers, with the engine itself.
 */

test.use({ timezoneId: 'UTC' });

const content = loadContent('web-demo');
const DATE = new Date('2027-03-01T12:00:00Z');
const N = 91;
const SEED = endlessSeed(N);
const strings = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../../content/packs/demo/strings/en.json'), 'utf8'),
) as Record<string, string>;

const drawer = async (page: Page) => (await page.locator('.shift--drawer').count()) > 0;

async function stampAndSend(page: Page, dest: Destination) {
  if (await drawer(page)) await page.getByTestId('judge').click();
  await page.locator(`[data-dest="${dest}"]`).click();
  await page.getByTestId('send').click();
}

const wrong = (c: CaseSpec): Destination => (c.expect.dest === 'HEL' ? 'VALHALLA' : 'HEL');

async function playRound(page: Page, round: number) {
  await page.getByTestId('begin').click();
  for (const c of endlessRound(content, SEED, round).cases) await stampAndSend(page, c.expect.dest);
}

async function openToday(page: Page) {
  await page.clock.setFixedTime(DATE);
  await page.goto('./');
  await expect(page.getByTestId('endless-today')).toHaveText(`Endless #${N}`);
  await page.getByTestId('endless-today').click();
}

test('today’s Endless: resumed after a reload, recorded once, shared without spoilers', async ({ page }) => {
  await openToday(page);
  await expect(page.getByTestId('briefing-title')).toHaveText("Endless, round 1: Day 1's rules");
  await expect(page.getByTestId('endless-twist')).toHaveCount(0);
  await playRound(page, 0);

  // Straight on to Day 2's rules, with the score so far.
  await expect(page.getByTestId('briefing-title')).toHaveText("Endless, round 2: Day 2's rules");
  await expect(page.getByTestId('endless-status')).toHaveText('5 souls judged rightly · strikes 0 of 3');
  await page.getByTestId('begin').click();
  const round = endlessRound(content, SEED, 1).cases;
  await stampAndSend(page, wrong(round[0] as CaseSpec));
  await expect(page.getByTestId('strikes')).toHaveText('Strikes 1/3');
  await page.getByTestId('citation-close').click();

  // A reload keeps the run. Today's can only be carried on, not begun again.
  await page.reload();
  await expect(page.getByTestId('endless-saved')).toHaveText(`Endless #${N} · 5 souls judged rightly · strikes 1 of 3`);
  await expect(page.getByTestId('endless-today')).toHaveCount(0);
  await expect(page.getByTestId('endless-start')).toHaveCount(0);
  await page.getByTestId('endless-resume').click();
  await page.getByTestId('resume').click();
  await expect(page.getByTestId('soul-count')).toHaveText('Soul 2 of 5');
  await expect(page.getByTestId('strikes')).toHaveText('Strikes 1/3');
  await stampAndSend(page, wrong(round[1] as CaseSpec));
  await page.getByTestId('citation-close').click();
  await stampAndSend(page, wrong(round[2] as CaseSpec));

  // The third strike ends it; the share text says how many and how far, never where anyone went.
  await expect(page.getByTestId('endless-over')).toHaveText('Three strikes');
  await expect(page.getByTestId('endless-run')).toHaveText(`Endless #${N}`);
  await expect(page.getByTestId('endless-score')).toHaveText("5 souls judged rightly, as far as Day 2's rules.");
  await expect(page.getByTestId('endless-record')).toHaveText('A new best.');
  const text = `Chooser of the Slain · Endless #${N} (g${content.genVersion})\n5 souls judged rightly · round 2, Day 2's rules`;
  await expect(page.getByTestId('share-text')).toHaveValue(`${text}\nhttp://localhost:4173/Chooser-of-the-Dead/`);

  // Today's is done: the title card keeps its result to share, and offers only a free run.
  await page.getByTestId('home').click();
  await expect(page.getByTestId('endless-today-result')).toContainText('Today: 5 souls judged rightly, round 2');
  await expect(page.getByTestId('endless-today')).toHaveCount(0);
  await expect(page.getByTestId('endless-best')).toHaveText('Best: 5 souls');
  await page.reload();
  await expect(page.getByTestId('endless-saved')).toHaveCount(0);
  await page.getByTestId('endless-today-share').click();
  await expect(page.getByTestId('share-text')).toHaveValue(`${text}\nhttp://localhost:4173/Chooser-of-the-Dead/`);

  // A free run has a seed of its own, and is saved like any other.
  await page.getByTestId('endless-start').click();
  await expect(page.getByTestId('briefing-title')).toHaveText("Endless, round 1: Day 1's rules");
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByTestId('endless-saved')).toHaveText('Free run · 0 souls judged rightly · strikes 0 of 3');
  await expect(page.getByTestId('endless-resume')).toHaveText('Resume round 1');
});

test('a paused run can be left for the title screen, and waits there', async ({ page }) => {
  await openToday(page);
  await page.getByTestId('begin').click();
  await stampAndSend(page, (endlessRound(content, SEED, 0).cases[0] as CaseSpec).expect.dest);
  await page.getByTestId('pause').click();
  await expect(page.getByTestId('leave-note')).toHaveText('Your run waits for you on the title screen.');
  await page.getByTestId('leave-shift').click();
  await expect(page.getByTestId('endless-saved')).toHaveText(`Endless #${N} · 1 soul judged rightly · strikes 0 of 3`);
  await page.getByTestId('endless-resume').click();
  await page.getByTestId('resume').click();
  await expect(page.getByTestId('soul-count')).toHaveText('Soul 2 of 5');
});

test('a round past the last new rule brings a twist: its own decree, the same rules', async ({ page }) => {
  await openToday(page);
  for (const r of [0, 1, 2]) {
    await expect(page.getByTestId('briefing-title')).toHaveText(`Endless, round ${r + 1}: Day ${r + 1}'s rules`);
    await playRound(page, r);
  }
  const twist = endlessTwist(content, SEED, 3);
  expect(twist).not.toBeNull();
  await expect(page.getByTestId('briefing-title')).toHaveText("Endless, round 4: Day 3's rules");
  await expect(page.getByTestId('endless-twist')).toHaveText("Nothing new on Day 3's rules today, so a twist:");
  await expect(page.getByTestId('decree')).toHaveText(strings[twist?.decree ?? ''] ?? '');
  await expect(page.getByTestId('endless-status')).toHaveText('15 souls judged rightly · strikes 0 of 3');
  await playRound(page, 3);
  await expect(page.getByTestId('briefing-title')).toHaveText("Endless, round 5: Day 3's rules");
});
