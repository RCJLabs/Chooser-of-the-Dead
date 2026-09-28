import AxeBuilder from '@axe-core/playwright';
import { type Destination, dailySeed, endlessRound, endlessSeed, solve, startShift } from '@cots/engine';
import { loadContent, loadDailyContent } from '@cots/testkit';
import { expect, type Page, test } from '@playwright/test';
import { FULL } from './urls';

/*
 * Accessibility (docs/tech-spec.md §35). Every screen, on the phone and the desktop, passes axe's WCAG 2.2
 * A and AA rules and its best practices; every control on a phone is at least 44 px each way; with the
 * text at 175% on a 360 px phone nothing is wider than the screen and the shift's controls stay in reach;
 * and screen readers hear citations, answers, verdicts and the sun running low.
 *
 * Automated checks find only some problems: someone who uses a screen reader should still play it.
 */

const RULES = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

// Daily #41, as daily.spec.ts plays it; the engine works out the right stamps.
const DATE = new Date('2027-01-10T12:00:00Z');
const N = 41;
// With the device's reduced motion the game stills every animation, so nothing is measured mid-fade: a notice that
// appears just as a scan starts (an achievement, on the summary) is already at its own colours.
test.use({ timezoneId: 'UTC', contextOptions: { reducedMotion: 'reduce' } });
const content = loadDailyContent();
const spec = content.daily;
if (!spec) throw new Error('No Daily in content');
const { state, ctx } = startShift(content, { mode: 'daily', seed: dailySeed(N), day: spec.day, dailyNumber: N });

// A soul whose lie confesses when questioned, and what shows the lie up.
const LIAR = state.cases.findIndex((c) => c.lies.some((l) => l.onQuestion === 'confess'));
const liar = (() => {
  const c = state.cases[LIAR];
  const lie = c?.lies.find((l) => l.onQuestion === 'confess');
  const x = c && lie ? solve(c.evidence.fields, ctx).contradictions.find((y) => y.lie === lie.field) : undefined;
  const other = x?.against.find((id) => id.startsWith('body.'));
  if (!lie || !other) throw new Error(`no confessing liar to call out in Daily #${N}`);
  return { lie: lie.field, with: other };
})();

/** How the screens are checked: axe everywhere; tap sizes on a phone; fitting when the text is large. */
interface Checks {
  readonly taps: boolean;
  readonly fit: boolean;
}

// (The page's own code, as text: these tests are typed without the browser's DOM.)

/** Controls smaller than 44 px each way (a checkbox counts its label; links inside running text don't count). */
const SMALL_TARGETS = `(() => {
  const out = [];
  const sel = 'button, a[href], input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab]';
  for (const el of document.querySelectorAll(sel)) {
    if (el.closest('[inert],[aria-hidden="true"]')) continue;
    const box = ((el.tagName === 'INPUT' && el.closest('label')) || el).getBoundingClientRect();
    if (box.width === 0 || box.height === 0 || getComputedStyle(el).visibility === 'hidden') continue;
    if (el.tagName === 'A' && getComputedStyle(el).display === 'inline') continue;
    if (box.width < 44 || box.height < 44) {
      out.push((el.getAttribute('data-testid') || el.textContent.trim().slice(0, 24)) + ' ' + Math.round(box.width) + 'x' + Math.round(box.height));
    }
  }
  return out;
})()`;

/** What doesn't fit the screen: the page scrolling sideways, or anything past its right edge. */
const OVERFLOW = `(() => {
  const out = [];
  const doc = document.documentElement;
  if (doc.scrollWidth > innerWidth || innerWidth > screen.width) out.push('the page is ' + doc.scrollWidth + ' px wide');
  const scrolls = (el) => {
    for (let p = el.parentElement; p; p = p.parentElement) if (/(auto|scroll)/.test(getComputedStyle(p).overflowX)) return true;
    return false;
  };
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('[aria-hidden="true"],svg,.sr-only')) continue;
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden' || st.position === 'fixed') continue;
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.right > screen.width + 1 && !scrolls(el)) {
      out.push((el.getAttribute('data-testid') || el.className || el.tagName) + ' reaches ' + Math.round(r.right) + ' px');
    }
  }
  return out.slice(0, 10);
})()`;

/** Checks the screen as it is, with everything folded away opened first (and folded again after). */
async function check(page: Page, where: string, checks: Checks) {
  await page.evaluate(
    `window.__folded = [...document.querySelectorAll('details')].filter((d) => !d.open); window.__folded.forEach((d) => { d.open = true; })`,
  );
  const axe = await new AxeBuilder({ page }).withTags(RULES).analyze();
  // Each finding with axe's own reason (a contrast finding gives both colours and the ratio).
  const found = axe.violations.flatMap((v) =>
    v.nodes.map((n) => `${v.id}: ${n.target.join(' ')}: ${[...n.any, ...n.all].map((c) => c.message).join('; ')}`),
  );
  expect.soft(found, `axe on ${where}`).toEqual([]);
  if (checks.taps) expect.soft(await page.evaluate<string[]>(SMALL_TARGETS), `small targets on ${where}`).toEqual([]);
  if (checks.fit) expect.soft(await page.evaluate<string[]>(OVERFLOW), `too wide on ${where}`).toEqual([]);
  await page.evaluate(`(window.__folded || []).forEach((d) => { d.open = false; })`);
}

const isDrawer = async (page: Page) => (await page.locator('.shift--drawer').count()) > 0;

async function stampAndSend(page: Page, dest: Destination) {
  if (await isDrawer(page)) await page.getByTestId('judge').click();
  await page.locator(`[data-dest="${dest}"]`).click();
  await page.getByTestId('send').click();
}

async function lookAtEverything(page: Page) {
  const look = page.locator('.chip--look');
  while ((await look.count()) > 0) await look.first().click();
}

async function playScene(page: Page) {
  while ((await page.getByTestId('scene-done').count()) === 0) await page.getByTestId('scene-choice').first().click();
  await page.getByTestId('scene-done').click();
}

/** Today's campaign queue as saved: where each soul belongs. */
async function judgeTheDay(page: Page) {
  const raw = await page.evaluate<string | null>(`localStorage.getItem('cots.campaign.0')`);
  const queue = (JSON.parse(raw ?? 'null')?.save.queue ?? []) as { expect: { dest: Destination } }[];
  for (const c of queue) await stampAndSend(page, c.expect.dest);
}

/** The Daily: title, briefing, the shift and its tabs, pause, a citation, an answer, the summary, a report. */
async function walkDaily(page: Page, checks: Checks) {
  await page.clock.setFixedTime(DATE);
  await page.goto('./');
  await expect(page.getByTestId('play-daily')).toBeEnabled();
  await check(page, 'the title', checks);
  await page.getByTestId('play-daily').click();
  await check(page, 'the briefing', checks);
  await page.getByTestId('begin').click();
  await lookAtEverything(page);
  await check(page, 'the shift', checks);
  if (await isDrawer(page)) {
    for (const tab of await page.locator('[data-tab]').all()) {
      await tab.click();
      await check(page, `the ${await tab.getAttribute('data-tab')} tab`, checks);
    }
  }
  await page.getByTestId('pause').click();
  await check(page, 'the pause', checks);
  await page.getByTestId('resume').click();
  for (const [i, c] of state.cases.entries()) {
    await expect(page.getByTestId('soul-count')).toHaveText(`Soul ${i + 1} of ${state.cases.length}`);
    if (i === LIAR) {
      await lookAtEverything(page);
      for (const id of [liar.lie, liar.with]) {
        if ((await isDrawer(page)) && id.startsWith('testimony.')) await page.locator('[data-tab="words"]').click();
        await page.locator(`[data-field="${id}"]`).click();
      }
      if (await isDrawer(page)) await page.locator('[data-tab="words"]').click();
      await page.getByTestId('question').first().click();
      await expect(page.getByTestId('answer-close')).toBeFocused();
      await check(page, 'an answer', checks);
      await page.getByTestId('answer-close').click();
    }
    if (i === 0) {
      await stampAndSend(page, c.expect.dest === 'HEL' ? 'VALHALLA' : 'HEL');
      await expect(page.getByTestId('citation-close')).toBeFocused();
      await check(page, 'a citation', checks);
      await page.getByTestId('citation-close').click();
      continue;
    }
    await stampAndSend(page, c.expect.dest);
  }
  await expect(page.getByTestId('score')).toBeVisible();
  await check(page, 'the summary', checks);
  await page
    .getByRole('button', { name: /^Report the judgment/ })
    .first()
    .click();
  await check(page, 'a report', checks);
}

/** The primer, a practice day's lesson, and Endless to its end. */
async function walkModes(page: Page, checks: Checks) {
  await page.goto('./');
  await page.getByTestId('play-primer').click();
  await check(page, "the primer's briefing", checks);
  await page.getByTestId('begin').click();
  await check(page, 'the primer', checks);
  await page.goto('./');
  await page.getByTestId('practice-3').click();
  await page.getByTestId('begin').click();
  await expect(page.getByTestId('coach')).toBeVisible();
  await check(page, "a practice day's lesson", checks);
  await page.goto('./');
  await page.getByTestId('endless-start').click();
  await check(page, "Endless's briefing", checks);
  await page.getByTestId('begin').click();
  // Stamps at random until three wrong ones end the run; a round that ends first goes on to the next.
  while ((await page.getByTestId('endless-over').count()) === 0) {
    if (await page.getByTestId('begin').count()) {
      await page.getByTestId('begin').click();
      continue;
    }
    if (await isDrawer(page)) await page.getByTestId('judge').click();
    await page.locator('[data-dest]').first().click();
    await page.getByTestId('send').click();
    if (await page.getByTestId('citation-close').count()) await page.getByTestId('citation-close').click();
  }
  await check(page, 'the end of an Endless run', checks);
}

/**
 * Endless as a run, in the full game (docs/tech-spec.md §68): the choice between rounds, a round under a curse (a sun,
 * a score), and the end. Endless #91's first break offers the sun.
 */
async function walkEndlessRun(page: Page, checks: Checks) {
  const seed = endlessSeed(91);
  const full = loadContent('dev-full');
  await page.clock.setFixedTime(new Date('2027-03-01T12:00:00Z'));
  await page.goto('./');
  await page.getByTestId('endless-today').click();
  await page.getByTestId('begin').click();
  for (const c of endlessRound(full, seed, 0).cases) await stampAndSend(page, c.expect.dest);
  await expect(page.getByTestId('endless-offer')).toBeVisible();
  await check(page, 'the choice between Endless rounds', checks);
  await page.getByTestId('curse').click();
  await expect(page.getByTestId('endless-picks')).toBeVisible();
  await check(page, 'an Endless briefing under a curse', checks);
  await page.getByTestId('begin').click();
  if (await page.getByTestId('coach-skip').count()) await page.getByTestId('coach-skip').click();
  await lookAtEverything(page);
  await check(page, 'the desk in a round under the sun, with a score', checks);
  for (const c of endlessRound(full, seed, 1).cases.slice(0, 3)) {
    await stampAndSend(page, c.expect.dest === 'HEL' ? 'VALHALLA' : 'HEL');
    if (await page.getByTestId('citation-close').count()) await page.getByTestId('citation-close').click();
  }
  await expect(page.getByTestId('endless-over')).toBeVisible();
  await check(page, 'the end of an Endless run with a score', checks);
}

/** A campaign day: the slots, the morning and its scene, the journal, the audit, the night and its scene. */
async function walkCampaign(page: Page, checks: Checks) {
  await page.goto('./');
  await page.getByTestId('play-campaign').click();
  await check(page, 'the save slots', checks);
  await page.getByTestId('new-0').click();
  await expect(page.getByTestId('morning-title')).toHaveText('Day 1');
  await check(page, "the morning's scene", checks);
  await playScene(page);
  await check(page, 'the morning', checks);
  await page.getByTestId('journal-open').click();
  await check(page, 'the journal', checks);
  await page.getByTestId('journal-close').click();
  await page.getByTestId('to-gate').click();
  await judgeTheDay(page);
  await expect(page.getByTestId('audit-title')).toBeVisible();
  await check(page, 'the audit', checks);
  await page.getByTestId('go-home').click();
  await check(page, "the night's scene", checks);
  await playScene(page);
  await check(page, 'the night', checks);
}

/** In the full game, the quickest ending (ending.spec.ts's): demoted after a second night in debt. */
async function walkEnding(page: Page, checks: Checks) {
  await page.goto('./');
  await page.getByTestId('play-campaign').click();
  await page.getByTestId('new-0').click();
  await expect(page.getByTestId('morning-title')).toHaveText('Day 1');
  await page.evaluate(`(() => {
    const record = JSON.parse(localStorage.getItem('cots.campaign.0'));
    record.rev += 1;
    const morning = record.save.mornings[record.save.mornings.length - 1];
    morning.rings = -200;
    morning.debtNights = 1;
    // Skögul's reprieve already spent (docs/tech-spec.md §56), so the debt ends the run.
    morning.flags = { ...morning.flags, skogul_paid: 1 };
    localStorage.setItem('cots.campaign.0', JSON.stringify(record));
  })()`);
  await page.reload();
  await page.getByTestId('play-campaign').click();
  await page.getByTestId('continue-0').click();
  await playScene(page);
  await page.getByTestId('to-gate').click();
  await judgeTheDay(page);
  await page.getByTestId('go-home').click();
  await playScene(page);
  await page.getByTestId('sleep').click();
  await check(page, 'the warning before sleeping into the ending', checks);
  await page.getByTestId('sleep-anyway').click();
  await expect(page.getByTestId('ending-title')).toBeVisible();
  await check(page, 'an ending', checks);
}

test.describe('every screen, as the phone and the desktop show it', () => {
  const checks = (project: string): Checks => ({ taps: project === 'phone', fit: false });
  test('the Daily', async ({ page }, info) => walkDaily(page, checks(info.project.name)));
  test('the primer, practice and Endless', async ({ page }, info) => walkModes(page, checks(info.project.name)));
  test('a campaign day', async ({ page }, info) => walkCampaign(page, checks(info.project.name)));
  test.describe('the full game', () => {
    test.use({ baseURL: FULL });
    test('an ending', async ({ page }, info) => walkEnding(page, checks(info.project.name)));
    test('Endless as a run', async ({ page }, info) => walkEndlessRun(page, checks(info.project.name)));
  });
});

for (const scale of [1, 1.75]) {
  test.describe(`a 360 px phone with the text at ${scale * 100}%`, () => {
    test.use({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    test.beforeEach(async ({ page }, info) => {
      test.skip(info.project.name !== 'phone', 'the viewport is set here; one run is enough');
      await page.addInitScript(
        `(() => { const s = JSON.parse(localStorage.getItem('cots.settings') || '{"v":1}'); s.v = 1; s.textScale = ${scale}; localStorage.setItem('cots.settings', JSON.stringify(s)); })()`,
      );
    });
    const checks: Checks = { taps: true, fit: true };
    test('the Daily', async ({ page }) => walkDaily(page, checks));
    test('the primer, practice and Endless', async ({ page }) => walkModes(page, checks));
    test('a campaign day', async ({ page }) => walkCampaign(page, checks));
    test.describe('the full game', () => {
      test.use({ baseURL: FULL });
      test('an ending', async ({ page }) => walkEnding(page, checks));
      test('Endless as a run', async ({ page }) => walkEndlessRun(page, checks));
    });
  });
}

test.describe('large text on a phone', () => {
  test.use({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

  test('the shift scrolls like a page, with the sun, Pause and Judge always in reach', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone', 'the viewport is set here; one run is enough');
    await page.addInitScript(
      `(() => { const s = JSON.parse(localStorage.getItem('cots.settings') || '{"v":1}'); s.v = 1; s.textScale = 1.75; localStorage.setItem('cots.settings', JSON.stringify(s)); })()`,
    );
    await page.goto('./');
    await expect(page.locator('html')).toHaveAttribute('data-text', 'large');
    await page.getByTestId('practice-3').click();
    await page.getByTestId('begin').click();
    await page.getByTestId('coach-skip').click();
    await lookAtEverything(page);
    const inView = async (testId: string) => {
      const box = await page.getByTestId(testId).boundingBox();
      expect(box, testId).not.toBeNull();
      expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(360);
      expect(box?.y ?? -1).toBeGreaterThanOrEqual(0);
      expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(740);
    };
    for (const where of ['top', 'bottom']) {
      await page.evaluate(
        where === 'top' ? 'window.scrollTo(0, 0)' : 'window.scrollTo(0, document.documentElement.scrollHeight)',
      );
      for (const id of ['sun', 'soul-count', 'pause', 'judge', 'compare']) await inView(id);
    }
    // The evidence can be read in full: the words run on down the page rather than inside a sliver of it.
    const panel = await page
      .locator('.drawer__panel')
      .evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight }));
    expect(panel.scroll).toBeLessThanOrEqual(panel.client + 1);
    // The next soul starts at the top again.
    await stampAndSend(page, 'HEL');
    if (await page.getByTestId('citation-close').count()) await page.getByTestId('citation-close').click();
    await expect(page.getByTestId('soul-count')).toHaveText(/^Soul 2 of /);
    await expect.poll(() => page.evaluate<number>('Math.round(window.scrollY)')).toBe(0);
  });

  test('the default size keeps the shift on one screen', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone', 'the viewport is set here; one run is enough');
    await page.goto('./');
    await expect(page.locator('html')).not.toHaveAttribute('data-text', /./);
    await page.getByTestId('practice-3').click();
    await page.getByTestId('begin').click();
    expect(await page.evaluate<number>('document.documentElement.scrollHeight')).toBeLessThanOrEqual(740);
  });
});

test.describe('what screen readers hear', () => {
  test('a citation and an answer are read out with their dialogs, not just their titles', async ({ page }) => {
    await page.clock.setFixedTime(DATE);
    await page.goto('./');
    await page.getByTestId('play-daily').click();
    await page.getByTestId('begin').click();
    const first = state.cases[0];
    if (!first) throw new Error('no souls');
    await stampAndSend(page, first.expect.dest === 'HEL' ? 'VALHALLA' : 'HEL');
    const citation = page.getByRole('alertdialog');
    await expect(citation).toHaveAccessibleName('Citation');
    await expect(citation).toHaveAccessibleDescription(new RegExp(`^${first.evidence.look.name} belonged in `));
    await page.getByTestId('citation-close').click();
    for (const [i, c] of state.cases.entries()) {
      if (i === 0) continue;
      if (i === LIAR) {
        await lookAtEverything(page);
        for (const id of [liar.lie, liar.with]) {
          if ((await isDrawer(page)) && id.startsWith('testimony.')) await page.locator('[data-tab="words"]').click();
          await page.locator(`[data-field="${id}"]`).click();
        }
        if (await isDrawer(page)) await page.locator('[data-tab="words"]').click();
        await page.getByTestId('question').first().click();
        const answer = page.getByRole('dialog');
        await expect(answer).toHaveAccessibleName(`${c.evidence.look.name} answers`);
        const said = await page.locator('#answer-lines').innerText();
        expect(said.length).toBeGreaterThan(0);
        await expect(answer).toHaveAccessibleDescription(said.replace(/\s+/g, ' ').trim());
        await page.getByTestId('answer-close').click();
      }
      await stampAndSend(page, c.expect.dest);
    }
    // The last verdict is said as the summary opens: one live region for every screen, made before its message.
    await expect(page.getByTestId('score')).toBeVisible();
    const region = page.locator('.toast-region');
    await expect(region).toHaveCount(1);
    await expect(region).toHaveAttribute('role', 'status');
    await expect(region).toContainText('Sent to');
    expect(await region.evaluate((el) => el.closest('main') === null)).toBe(true);
  });

  test('the sun says when a minute is left, and when it sets', async ({ page }) => {
    await page.clock.install({ time: DATE });
    await page.goto('./');
    await page.getByTestId('play-daily').click();
    await page.getByTestId('begin').click();
    const toast = page.locator('.toast-region');
    // (A toast shows for 2.6 s: each step stops just after the moment it's said.)
    await page.clock.runFor('04:59');
    await expect(toast).not.toContainText('A minute of sun left.');
    await page.clock.runFor(1500);
    await expect(toast).toContainText('A minute of sun left.');
    await page.clock.runFor(59_000);
    await expect(toast).toContainText('Dusk has fallen. Finish this soul.');
  });
});
