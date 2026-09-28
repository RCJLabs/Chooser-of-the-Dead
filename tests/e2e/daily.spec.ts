import { type CaseSpec, type Destination, dailySeed, solve, stampsFor, startShift } from '@cots/engine';
import { loadDailyContent } from '@cots/testkit';
import { expect, type Page, test } from '@playwright/test';

/*
 * The Daily Shift, played end to end in the built web demo. The test works
 * out the right stamps with the engine itself (the page never exposes them),
 * then plays like a careful player: look at everything, catch every lie,
 * question one, stamp and send.
 */

// Daily #41 (DAILY_EPOCH is 2026-12-01), in the browser's own timezone.
const DATE = new Date('2027-01-10T12:00:00Z');
const N = 41;
test.use({ timezoneId: 'UTC' });

const content = loadDailyContent();
const spec = content.daily;
if (!spec) throw new Error('No Daily in content');
const { state, ctx } = startShift(content, { mode: 'daily', seed: dailySeed(N), day: spec.day, dailyNumber: N });
const stamps = stampsFor(ctx);

/** Each contradiction a careful player can find: the lie and a field that shows it (body first). */
function catches(c: CaseSpec): { lie: string; with: string }[] {
  return solve(c.evidence.fields, ctx).contradictions.flatMap((x) => {
    const other = x.against.find((id) => id.startsWith('body.')) ?? x.against.find((id) => !id.startsWith('q:'));
    return other && other !== 'world' ? [{ lie: x.lie, with: other }] : [];
  });
}

const drawer = (page: Page) =>
  page
    .locator('.shift--drawer')
    .count()
    .then((n) => n > 0);

async function lookAtEverything(page: Page) {
  const look = page.locator('.chip--look');
  while ((await look.count()) > 0) await look.first().click();
}

/** Clicks an evidence item, switching drawer tabs when it lives on another one. */
async function pickField(page: Page, id: string) {
  if (await drawer(page)) {
    const tab = id.startsWith('testimony.')
      ? 'words'
      : id.startsWith('huginn.') || id.startsWith('muninn.')
        ? 'ravens'
        : null;
    if (tab) await page.locator(`[data-tab="${tab}"]`).click();
  }
  await page.locator(`[data-field="${id}"]`).click();
}

async function stampAndSend(page: Page, dest: Destination) {
  if (await drawer(page)) await page.getByTestId('judge').click();
  await page.locator(`[data-dest="${dest}"]`).click();
  await page.getByTestId('send').click();
}

async function openDaily(page: Page) {
  await page.clock.setFixedTime(DATE);
  await page.goto('./');
  await page.getByTestId('play-daily').click();
  await expect(page.getByTestId('briefing-title')).toHaveText(`Daily Shift #${N}`);
  await page.getByTestId('begin').click();
}

test('a careful player judges the whole Daily and shares a spoiler-free result', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openDaily(page);
  let questioned = false;

  for (const [i, c] of state.cases.entries()) {
    await expect(page.getByTestId('soul-count')).toHaveText(`Soul ${i + 1} of ${state.cases.length}`);
    await lookAtEverything(page);
    await page.getByTestId('flip').click();
    await lookAtEverything(page);
    await page.getByTestId('feather').click();

    for (const x of catches(c)) {
      await pickField(page, x.lie);
      await pickField(page, x.with);
      await expect(page.locator(`.evidence.is-lie:has([data-field="${x.lie}"])`)).toBeVisible();
      if (!questioned) {
        if (await drawer(page)) await page.locator('[data-tab="words"]').click();
        await page.getByTestId('question').first().click();
        await expect(page.getByRole('dialog')).toContainText('answers');
        await expect(page.getByTestId('answer-close')).toBeFocused();
        await page.getByTestId('answer-close').click();
        questioned = true;
      }
    }
    await stampAndSend(page, c.expect.dest);
  }

  expect(questioned).toBe(true);
  await expect(page.getByTestId('score')).toHaveText('8 of 8 judged rightly');
  await expect(page.getByTestId('verdict')).toHaveCount(8);
  const share = await page.getByTestId('share-text').inputValue();
  expect(share).toMatch(
    new RegExp(
      `^Chooser of the Slain · Daily #${N} \\(g1\\)\\n(🟩){8} 8/8 · \\d:\\d\\d to spare\\nhttp://localhost:4173/Chooser-of-the-Dead/$`,
    ),
  );
  for (const d of stamps) expect(share.toUpperCase()).not.toContain(d);
  // The summary and the share text agree on the sun left.
  const spare = /(\d:\d\d) to spare/.exec(share)?.[1];
  await expect(page.getByText(`${spare} of sun to spare`)).toBeVisible();

  // The result is kept: the title shows it, and a replay won't count.
  await page.getByTestId('home').click();
  await expect(page.getByTestId('daily-result')).toContainText('8/8');
  await expect(page.getByTestId('streak')).toHaveText('Streak 1 · best 1');
  await page.reload();
  await expect(page.getByTestId('daily-result')).toContainText('8/8');
  await expect(page.getByTestId('play-daily')).toHaveText("Play again (won't count)");
  expect(errors).toEqual([]);
});

test('a wrong stamp gets a citation that names what you missed', async ({ page }) => {
  await openDaily(page);
  const c = state.cases[0] as CaseSpec;
  const wrong = stamps.find((d) => d !== c.expect.dest) as Destination;
  await stampAndSend(page, wrong);
  const slip = page.getByRole('alertdialog');
  await expect(slip).toContainText('Citation');
  await expect(slip).toContainText(c.evidence.look.name);
  await expect(page.getByTestId('citation-close')).toBeFocused();
  await page.getByTestId('citation-close').click();
  await expect(page.getByTestId('soul-count')).toHaveText('Soul 2 of 8');
});

test('leaving the page pauses the sun, and a reload resumes the same Daily', async ({ page }) => {
  await openDaily(page);
  for (const c of state.cases.slice(0, 2)) await stampAndSend(page, c.expect.dest);
  await expect(page.getByTestId('soul-count')).toHaveText('Soul 3 of 8');

  await page.evaluate('window.dispatchEvent(new Event("blur"))');
  await expect(page.getByTestId('resume')).toBeVisible();
  const frozen = await page.getByTestId('sun').textContent();
  await page.waitForTimeout(1500);
  await expect(page.getByTestId('sun')).toHaveText(frozen ?? '');
  await page.getByTestId('resume').click();

  // The feather's 10 s penalty makes a reset clock (6:00) stand out.
  await page.getByTestId('feather').click();
  const before = seconds(await page.getByTestId('sun').textContent());
  expect(before).toBeLessThanOrEqual(350);
  await page.reload();
  await expect(page.getByTestId('play-daily')).toHaveText("Resume today's shift");
  await page.getByTestId('play-daily').click();
  await expect(page.getByTestId('resume')).toBeVisible();
  await page.getByTestId('resume').click();
  await expect(page.getByTestId('soul-count')).toHaveText('Soul 3 of 8');
  // Same timeline: at most the 5 s heartbeat is refunded.
  const after = seconds(await page.getByTestId('sun').textContent());
  expect(after).toBeLessThanOrEqual(before + 6);
  expect(after).toBeGreaterThanOrEqual(before - 6);
});

test('a paused Daily can be left for the title screen, and waits there as it was', async ({ page }) => {
  await openDaily(page);
  await stampAndSend(page, (state.cases[0] as CaseSpec).expect.dest);
  await expect(page.getByTestId('soul-count')).toHaveText('Soul 2 of 8');
  await page.getByTestId('pause').click();
  await expect(page.getByTestId('leave-note')).toHaveText(
    "Today's shift waits for you on the title screen, paused where you left it.",
  );
  await page.getByTestId('leave-shift').click();
  await expect(page.getByTestId('play-daily')).toHaveText("Resume today's shift");
  await page.getByTestId('play-daily').click();
  await page.getByTestId('resume').click();
  await expect(page.getByTestId('soul-count')).toHaveText('Soul 2 of 8');
});

function seconds(text: string | null): number {
  const [m, s] = (text ?? '').split(':').map(Number);
  return (m ?? 0) * 60 + (s ?? 0);
}

test('a reload right after the last send keeps the result', async ({ page }) => {
  await openDaily(page);
  for (const c of state.cases) await stampAndSend(page, c.expect.dest);
  await page.reload();
  await expect(page.getByTestId('daily-result')).toContainText('8/8');
  await expect(page.getByTestId('play-daily')).toHaveText("Play again (won't count)");
});

test('an earlier Daily from the archive plays for its own sake, and counts for nothing', async ({ page }) => {
  const past = 20;
  const old = startShift(content, { mode: 'daily', seed: dailySeed(past), day: spec.day, dailyNumber: past }).state;
  await page.clock.setFixedTime(DATE);
  await page.goto('./');
  await page.getByTestId('daily-archive').locator('summary').click();
  await expect(page.getByTestId('archive-pick')).toHaveValue(String(N - 1));
  await page.getByTestId('archive-pick').selectOption(String(past));
  await page.getByTestId('archive-play').click();
  await expect(page.getByTestId('briefing-title')).toHaveText(`Daily Shift #${past} (2026-12-20, from the archive)`);
  await page.getByTestId('begin').click();
  for (const c of old.cases) await stampAndSend(page, c.expect.dest);
  await expect(page.getByTestId('score')).toHaveText('8 of 8 judged rightly');
  expect(await page.getByTestId('share-text').inputValue()).toMatch(
    new RegExp(`^Chooser of the Slain · Daily #${past} \\(archive\\) \\(g1\\)\\n(🟩){8} 8/8`),
  );

  // Nothing recorded: today's Daily is still to play, and there's no streak.
  await page.getByTestId('home').click();
  await expect(page.getByTestId('play-daily')).toHaveText(`Daily Shift #${N}`);
  await expect(page.getByTestId('daily-result')).toHaveCount(0);
  await expect(page.getByTestId('streak')).toHaveCount(0);
});

test('keyboard only: look, turn over, stamp with number keys, send with Enter', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'keyboard play is for the desk layout');
  await page.clock.setFixedTime(DATE);
  await page.goto('./');
  // The button waits for saved Daily progress to load; a disabled button can't take focus.
  await expect(page.getByTestId('play-daily')).toBeEnabled();
  await page.getByTestId('play-daily').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('begin')).toBeFocused();
  await page.keyboard.press('Enter');
  for (const [i, c] of state.cases.entries()) {
    await expect(page.getByTestId('soul-count')).toHaveText(`Soul ${i + 1} of ${state.cases.length}`);
    const look = page.locator('.chip--look');
    while ((await look.count()) > 0) {
      await look.first().focus();
      await page.keyboard.press('Enter');
    }
    await page.keyboard.press('f');
    await page.keyboard.press('t');
    await page.keyboard.press(String(stamps.indexOf(c.expect.dest) + 1));
    await expect(page.getByTestId('send')).toBeFocused();
    await page.keyboard.press('Enter');
  }
  await expect(page.getByTestId('score')).toHaveText('8 of 8 judged rightly');
});
