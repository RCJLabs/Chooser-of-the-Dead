import {
  type CaseSpec,
  type Destination,
  type EndlessPick,
  endlessOffer,
  endlessRound,
  endlessSeed,
} from '@cots/engine';
import { loadContent } from '@cots/testkit';
import { expect, type Page, test } from '@playwright/test';
import { FULL } from './urls';

/*
 * Endless as a run, in the full game (docs/tech-spec.md §68): between rounds, one of three boons, or the curse on
 * offer, which makes every soul judged rightly after it score one more. A day's run offers everyone the same, so the
 * test works out each offer, and the right stamps, with the engine itself. The demo's Endless has no boons
 * (endless.spec.ts).
 */

test.use({ baseURL: FULL, timezoneId: 'UTC' });

const content = loadContent('dev-full');

const drawer = async (page: Page) => (await page.locator('.shift--drawer').count()) > 0;

async function stampAndSend(page: Page, dest: Destination) {
  if (await drawer(page)) await page.getByTestId('judge').click();
  await page.locator(`[data-dest="${dest}"]`).click();
  await page.getByTestId('send').click();
}

const wrong = (c: CaseSpec): Destination => (c.expect.dest === 'HEL' ? 'VALHALLA' : 'HEL');

async function playRound(page: Page, seed: string, round: number) {
  await page.getByTestId('begin').click();
  for (const c of endlessRound(content, seed, round).cases) await stampAndSend(page, c.expect.dest);
}

/** Today's run on a given date (numbered like the Daily: 2027-03-01 is #91). */
async function openToday(page: Page, n: number, date: string) {
  await page.clock.setFixedTime(new Date(`${date}T12:00:00Z`));
  await page.goto('./');
  await expect(page.getByTestId('endless-today')).toHaveText(`Endless #${n}`);
  await page.getByTestId('endless-today').click();
}

const shown = (page: Page, testId: string) =>
  page.getByTestId(testId).evaluateAll((els) => els.map((e) => e.getAttribute('data-boon')));

test('between rounds, a boon or a curse for a higher score; kept through a reload, and shared', async ({ page }) => {
  // Endless #91 offers the sun at its first break.
  const n = 91;
  const seed = endlessSeed(n);
  await openToday(page, n, '2027-03-01');
  await expect(page.getByTestId('briefing-title')).toHaveText("Endless, round 1: Day 1's rules");
  await expect(page.getByTestId('endless-offer')).toHaveCount(0);
  await expect(page.getByTestId('endless-status')).toHaveText('Score 0 · 0 souls judged rightly · strikes 0 of 3');
  await playRound(page, seed, 0);

  // Before round 2: three boons and a curse, drawn for today's run. Nothing begins until one is taken.
  const offer = endlessOffer(content, seed, 1, [], 0);
  await expect(page.getByTestId('briefing-title')).toHaveText("Endless, round 2: Day 2's rules");
  await expect(page.getByTestId('endless-status')).toHaveText('Score 5 · 5 souls judged rightly · strikes 0 of 3');
  await expect(page.getByTestId('endless-offer')).toBeVisible();
  await expect(page.getByTestId('begin')).toBeDisabled();
  expect(await shown(page, 'boon')).toEqual(offer?.boons.map((b) => b.id));
  expect(await shown(page, 'curse')).toEqual(['curse.sun']);
  await expect(page.getByTestId('boon').first()).toBeFocused();
  await expect(page.locator('.endless-offer__curse')).toHaveText(
    'Or take a curse, and every soul judged rightly from now on scores 2 instead of 1:',
  );
  await page.getByTestId('curse').click();

  // The curse is on the run: the round has a sun now (Day 2's pace for five souls), and a soul scores 2.
  await expect(page.getByTestId('endless-offer')).toHaveCount(0);
  await expect(page.getByTestId('begin')).toBeEnabled();
  await expect(page.getByTestId('begin')).toBeFocused();
  await expect(page.getByTestId('endless-picks')).toContainText('The sun rises');
  await expect(page.getByTestId('endless-worth')).toHaveText('A soul judged rightly scores 2.');
  await expect(page.getByText('5 souls · 4:40 of sun')).toBeVisible();

  // A reload keeps what was taken; the choice isn't offered again.
  await page.reload();
  await expect(page.getByTestId('endless-saved')).toHaveText(
    `Endless #${n} · Score 5 · 5 souls judged rightly · strikes 0 of 3`,
  );
  await page.getByTestId('endless-resume').click();
  await expect(page.getByTestId('endless-offer')).toHaveCount(0);
  await expect(page.getByTestId('endless-picks')).toContainText('The sun rises');
  await page.getByTestId('begin').click();
  await expect(page.getByTestId('sun')).toHaveText(/^\d:\d\d$/);
  await expect(page.getByTestId('endless-points')).toHaveText('Score 5');
  const round = endlessRound(content, seed, 1).cases;
  await stampAndSend(page, (round[0] as CaseSpec).expect.dest);
  await expect(page.getByTestId('endless-points')).toHaveText('Score 7');

  // Three wrong stamps and it's over: the score, how far, and the curse taken, never where anyone went.
  for (const c of round.slice(1, 3)) {
    await stampAndSend(page, wrong(c));
    await page.getByTestId('citation-close').click();
  }
  await stampAndSend(page, wrong(round[3] as CaseSpec));
  await expect(page.getByTestId('endless-over')).toHaveText('Out of strikes');
  await expect(page.getByTestId('endless-score')).toHaveText(
    "Score 7: 6 souls judged rightly, as far as Day 2's rules.",
  );
  await expect(page.getByTestId('endless-record')).toHaveText('A new best.');
  await expect(page.getByTestId('endless-picks')).toContainText('The sun rises');
  const text = `Chooser of the Slain · Endless #${n} (g${content.genVersion})\nScore 7 · 6 souls judged rightly · round 2, Day 2's rules · 1 curse`;
  expect((await page.getByTestId('share-text').inputValue()).startsWith(text)).toBe(true);

  // The title card keeps today's result, and the best is a score.
  await page.getByTestId('home').click();
  await expect(page.getByTestId('endless-today-result')).toContainText('Today: score 7, round 2');
  await expect(page.getByTestId('endless-best')).toHaveText('Best score: 7');
});

test('Skögul’s hints as a boon, and Týr’s oath: a Compare that finds nothing is a strike', async ({ page }) => {
  // Endless #96 offers Skögul's eye at its first break and Týr's oath at its second.
  const n = 96;
  const seed = endlessSeed(n);
  await openToday(page, n, '2027-03-06');
  await playRound(page, seed, 0);
  await page.locator('[data-boon="boon.eye"]').click();
  await expect(page.getByTestId('endless-picks')).toContainText("Skögul's eye");

  // Endless has no hints, but these: three, for any round.
  await page.getByTestId('begin').click();
  await expect(page.getByTestId('hints-left')).toContainText('(3 left)');
  await page.getByTestId('hint').click();
  await expect(page.locator('.toast')).toContainText('Skögul');
  await expect(page.getByTestId('hints-left')).toContainText('(2 left)');
  for (const c of endlessRound(content, seed, 1).cases) await stampAndSend(page, c.expect.dest);

  const picks: EndlessPick[] = [{ round: 1, id: 'boon.eye' }];
  expect(endlessOffer(content, seed, 2, picks, 0)?.curse?.id).toBe('curse.tyr');
  await page.getByTestId('curse').click();
  await expect(page.getByTestId('endless-worth')).toHaveText('A soul judged rightly scores 2.');
  await page.getByTestId('begin').click();
  // The hints left carry over from round to round.
  await expect(page.getByTestId('hints-left')).toContainText('(2 left)');

  // Two claims that are both true never contradict each other: under the oath, comparing them is a strike.
  const soul = endlessRound(content, seed, 2).cases[0] as CaseSpec;
  const lies = new Set(soul.lies.map((l) => l.field));
  const truths = soul.evidence.fields
    .filter((f) => f.item === 'testimony' && f.says && !lies.has(f.id))
    .map((f) => f.id);
  expect(truths.length).toBeGreaterThanOrEqual(2);
  const look = page.locator('.chip--look');
  while ((await look.count()) > 0) await look.first().click();
  if (await drawer(page)) await page.locator('[data-tab="words"]').click();
  await page.getByTestId('compare').click();
  await expect(page.getByTestId('oath-note')).toHaveText("Under Týr's oath, a miss is a strike.");
  await page.locator(`[data-field="${truths[0]}"]`).first().click();
  await page.locator(`[data-field="${truths[1]}"]`).first().click();
  await expect(page.locator('.toast')).toHaveText("Nothing contradicts there. Under Týr's oath, that's a strike.");
  await expect(page.getByTestId('strikes')).toHaveText('Strikes 1/3');
});

test('a run that ends in a round under the sun takes its sun with it', async ({ page }) => {
  // Endless #91 offers the sun at its first break. The clock is the test's, so the sun can be run down.
  const seed = endlessSeed(91);
  await page.clock.install({ time: new Date('2027-03-01T12:00:00Z') });
  await page.goto('./');
  await page.getByTestId('endless-today').click();
  await playRound(page, seed, 0);
  await page.getByTestId('curse').click();
  await page.getByTestId('begin').click();
  const round = endlessRound(content, seed, 1).cases;
  for (const c of round.slice(0, 2)) {
    await stampAndSend(page, wrong(c));
    await page.getByTestId('citation-close').click();
  }
  await stampAndSend(page, wrong(round[2] as CaseSpec));
  await expect(page.getByTestId('endless-over')).toBeVisible();

  // Everything said from now on, past where the round's sun would have set: nothing about the sun.
  await page.evaluate(
    `(() => { window.__said = []; new MutationObserver(() => { for (const t of document.querySelectorAll('.toast, [role=status]')) window.__said.push(t.textContent); }).observe(document.body, { subtree: true, childList: true, characterData: true }); })()`,
  );
  await page.clock.runFor('07:00');
  await expect(page.getByTestId('endless-over')).toBeVisible();
  expect((await page.evaluate<string[]>('window.__said')).join(' ')).not.toMatch(/sun|[Dd]usk/);
});
