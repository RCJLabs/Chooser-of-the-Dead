import { campaignOf, type Destination, ENGINE_MAJOR, type Faction, resumeSave, standingFx } from '@cots/engine';
import { loadContent, scenarioSave } from '@cots/testkit';
import { expect, type Page, test } from '@playwright/test';
import { FULL } from './urls';

/*
 * The gods' requests (docs/tech-spec.md §42) in the full game. The demo stops before Day 4, so the test starts
 * from a save on Day 5's morning, made in Node with every earlier soul judged rightly, whose morning has two
 * gods asking for the same souls sent to different places. It does the first god's favour, which leaves the
 * other's undone.
 */

test.use({ baseURL: FULL });

const content = loadContent('dev-full');

const { save, asked, rival } = (() => {
  for (let i = 0; i < 40; i++) {
    const s = scenarioSave(content, `e2e-requests-${i}`, 5, ENGINE_MAJOR);
    const [a, r] = resumeSave(s, content, ENGINE_MAJOR).run.requests ?? [];
    if (a && r) return { save: s, asked: a, rival: r };
  }
  throw new Error('No seed in 40 has two requests on Day 5');
})();

const GOD: Partial<Record<Faction, string>> = { odin: 'Odin', freyja: 'Freyja', hel: 'Hel' };
const DEST: Partial<Record<Destination, string>> = { VALHALLA: 'Valhalla', FOLKVANGR: 'Fólkvangr', HEL: 'Hel' };
const god = (f: Faction) => GOD[f] ?? f;
const dest = (d: Destination) => DEST[d] ?? d;
const signed = (n: number) => (n > 0 ? `+${n}` : String(n));
const fx = (moves: Readonly<Partial<Record<Faction, number>>>) =>
  new Intl.ListFormat('en', { style: 'long', type: 'conjunction' }).format(
    Object.entries(moves)
      .filter(([, n]) => (n ?? 0) !== 0)
      .map(([f, n]) => `${god(f as Faction)} ${signed(n ?? 0)}`),
  );

async function stampAndSend(page: Page, to: Destination) {
  if ((await page.locator('.shift--drawer').count()) > 0) await page.getByTestId('judge').click();
  await page.locator(`[data-dest="${to}"]`).click();
  await page.getByTestId('send').click();
}

/** Today's queue as saved: where each soul belongs. */
async function answers(page: Page): Promise<Destination[]> {
  const raw = await page.evaluate(() => localStorage.getItem('cots.campaign.0'));
  const record = JSON.parse(raw ?? 'null') as { save: { queue: { expect: { dest: Destination } }[] | null } } | null;
  return (record?.save.queue ?? []).map((c) => c.expect.dest);
}

test('a god asks a favour in the morning: its terms, its count at the desk, and the audit that settles it', async ({
  page,
}) => {
  expect(rival.from).toBe(asked.from);
  // Every error the page raises, including those the browser reports without an exception (a ResizeObserver loop).
  await page.addInitScript(`window.__errors = []; addEventListener('error', (e) => __errors.push(String(e.message)));`);
  await page.addInitScript(
    (record) => localStorage.setItem('cots.campaign.0', record),
    JSON.stringify({ v: 1, rev: 1, savedAt: 0, save }),
  );
  await page.goto('./');
  await page.getByTestId('play-campaign').click();
  await page.getByTestId('continue-0').click();
  await expect(page.getByTestId('morning-title')).toHaveText('Day 5');
  while ((await page.getByTestId('scene-done').count()) === 0) await page.getByTestId('scene-choice').first().click();
  await page.getByTestId('scene-done').click();

  // The morning says, in so many words, what the favour is worth and what it still costs.
  const cards = page.getByTestId('request');
  await expect(cards).toHaveCount(2);
  const card = cards.first();
  await expect(card.locator('h2')).toHaveText(`${god(asked.god)} asks a favour`);
  await expect(card).toContainText(
    `Send ${asked.n === 1 ? 'one soul who belongs' : `${asked.n} souls who belong`} in ${dest(asked.from)} to ${dest(asked.to)} today, and ${god(asked.god)} will remember it: ${fx(asked.reward)}.`,
  );
  await expect(card).toContainText(
    `standing moved as it always is: ${fx(standingFx(campaignOf(content), asked.from, asked.to))}.`,
  );
  await expect(cards.nth(1).locator('h2')).toHaveText(`${god(rival.god)} asks a favour`);
  await expect(card).toContainText(
    "Each is still a soul sent wrong: no wage, a citation (and a fine, once the day's warnings are used)",
  );
  // With the no-fines assist, set on this same page, the terms say so; then back as they were for the day.
  await page.getByTestId('morning-assists').locator('summary').click();
  await page.getByTestId('setting-no-fines').check();
  await expect(card).toContainText('Each is still a soul sent wrong: no wage and a citation, and standing moved');
  await page.getByTestId('setting-no-fines').uncheck();
  await expect(card).toContainText('a fine, once the day');

  // At the desk, each request keeps count.
  await page.getByTestId('to-gate').click();
  const progress = page.getByTestId('request-progress');
  const count = (r: typeof asked, done: number) => `${god(r.god)}'s request: ${done} of ${r.n} sent to ${dest(r.to)}`;
  await expect(progress).toHaveText([count(asked, 0), count(rival, 0)]);
  let favours = 0;
  for (const belongs of await answers(page)) {
    if (belongs === asked.from && favours < asked.n) {
      await stampAndSend(page, asked.to);
      // Still a mistake: the citation comes as it always does.
      await page.getByTestId('citation-close').click();
      favours++;
      if (favours < asked.n) await expect(progress.first()).toHaveText(count(asked, favours));
    } else await stampAndSend(page, belongs);
  }
  expect(favours).toBe(asked.n);

  // The audit settles both: one done, and the rival's souls all went to the other god.
  await expect(page.getByTestId('audit-title')).toHaveText('Day 5: the audit');
  await expect(page.getByTestId('request-results').locator('li')).toHaveText([
    `${god(asked.god)}'s request: done. ${fx(asked.reward)}.`,
    `${god(rival.god)}'s request: not done (0 of ${rival.n}).`,
  ]);
  const table = page.getByTestId('standing');
  await expect(table.locator('th').nth(2)).toHaveText('Requests');
  await expect(
    table
      .locator('tr', { hasText: god(asked.god) })
      .locator('td')
      .nth(2),
  ).toHaveText(signed(asked.reward[asked.god] ?? 0));
  await expect(page.getByText('Requests: what a god gave for a favour done in full')).toBeVisible();

  // The extra column still fits the smallest phone. Wider than that (large text), the table scrolls in its own box,
  // never the page, and a column scrolled to comes to rest against the names, never half under them.
  await page.setViewportSize({ width: 360, height: 740 });
  const box = page.locator('.ledger-scroll');
  const overflow = async () => ({
    box: await box.evaluate((el) => el.scrollWidth - el.clientWidth),
    page: (await page.evaluate('document.documentElement.scrollWidth - innerWidth')) as number,
  });
  expect(await overflow()).toEqual({ box: 0, page: 0 });
  // Text at 175%, as the settings set it.
  await page.evaluate(
    `document.documentElement.style.fontSize = '175%'; document.documentElement.dataset.text = 'large'`,
  );
  await expect.poll(async () => (await overflow()).box).toBeGreaterThan(0);
  expect((await overflow()).page).toBe(0);
  // The box refits to the larger text in the frame after it grows (its snap stop is the held column's width): wait
  // for that before scrolling, or a slow machine snaps to the old width in between.
  await expect
    .poll(() =>
      box.evaluate((el) => el.style.getPropertyValue('--held') === `${el.querySelector('th')?.offsetWidth ?? 0}px`),
    )
    .toBe(true);
  const halfHidden = () =>
    box.evaluate((el) => {
      const edge = el.querySelector('th')?.getBoundingClientRect().right ?? 0;
      return [...el.querySelectorAll('th.num')]
        .map((th) => th.getBoundingClientRect())
        .filter((r) => r.left < edge - 1 && r.right > edge + 1).length;
    });
  const max = await box.evaluate((el) => el.scrollWidth - el.clientWidth);
  for (const left of [7, 30, 55, 90, 140, max]) {
    await box.evaluate((el, x) => el.scrollTo({ left: x, behavior: 'instant' }), left);
    expect(await halfHidden(), `scrolled to ${left}`).toBe(0);
  }
  // Fitting the box to its table as the text grows raises no error.
  expect(await page.evaluate('__errors')).toEqual([]);
});
