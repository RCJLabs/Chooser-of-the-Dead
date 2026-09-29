import AxeBuilder from '@axe-core/playwright';
import {
  type CaseSpec,
  campaignQueue,
  type Destination,
  ENGINE_MAJOR,
  pleaOf,
  type RunAction,
  type RunSave,
  type RunState,
  runContext,
} from '@cots/engine';
import { catchLie, loadContent, scenarioSave } from '@cots/testkit';
import { expect, type Page, test } from '@playwright/test';
import { FULL } from './urls';

/*
 * Word among the dead (docs/tech-spec.md §73) in the full game, from saves made in Node with every earlier soul judged
 * rightly:
 * - an ordinary soul that asks stands where it asked to go only if it told the truth, and once a lie of its own is
 *   caught at the desk, the desk says so; granted, the audit says how far the word moved, and where it stands;
 * - two mornings later, the dead know, and the morning says so, with where the word stands.
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

async function stampAndSend(page: Page, to: Destination, clip: boolean) {
  if (clip) await page.getByTestId('clippers').click();
  if (await isDrawer(page)) await page.getByTestId('judge').click();
  await page.locator(`[data-dest="${to}"]`).click();
  await page.getByTestId('send').click();
}

async function load(page: Page, save: RunSave) {
  await page.addInitScript(
    (record) => localStorage.setItem('cots.campaign.0', record),
    JSON.stringify({ v: 1, rev: 1, savedAt: 0, save }),
  );
  await page.goto('./');
  await page.getByTestId('play-campaign').click();
  await page.getByTestId('continue-0').click();
}

/**
 * The first seed whose Day 7 or 8 line (before parties form) has an ordinary soul, not the day's last, that pleads and
 * tells a lie a careful player can catch without turning to anyone; and the save of that day's shift, every soul before
 * it judged rightly, and the lie caught.
 */
const found = (() => {
  for (let i = 0; i < 60; i++) {
    for (const day of [7, 8]) {
      const s = scenarioSave(content, `e2e-word-${i}`, day, ENGINE_MAJOR);
      const run = s.mornings.at(-1) as RunState;
      const ctx = runContext(content, run);
      const queue = campaignQueue(run, { content, ctx });
      const k = queue.findIndex(
        (c, j) =>
          j < queue.length - 1 && !c.script && !c.kin && c.plea && c.lies.length > 0 && catchLie(c, ctx, 0).length > 0,
      );
      const soul = queue[k];
      const plea = soul ? pleaOf(content, soul) : null;
      if (!soul || !plea) continue;
      const log: RunAction[] = [{ t: 'beginShift', at: 0 }];
      let at = 0;
      for (const c of queue.slice(0, k)) {
        at += 20_000;
        for (const id of c.expect.procedures ?? []) {
          const tool = ctx.procedures.find((p) => p.id === id)?.tool;
          if (tool) log.push({ t: 'shift', action: { t: 'tool', tool, at } });
        }
        log.push({ t: 'shift', action: { t: 'stamp', dest: c.expect.dest, at } });
        log.push({ t: 'shift', action: { t: 'send', at } });
      }
      at += 20_000;
      for (const action of catchLie(soul, ctx, at)) log.push({ t: 'shift', action });
      return { save: { ...s, log, queue } as RunSave, queue, k, soul, dest: plea.dest, day };
    }
  }
  throw new Error('No seed in 60 has an ordinary soul who pleads and lies on Day 7 or 8');
})();

test('a soul that asks and lies: it stands only if it told the truth, the desk says once it’s caught, and the audit says how the word moved', async ({
  page,
}) => {
  const { save, queue, k, soul, dest, day } = found;
  await load(page, save);
  // A shift left mid-way opens paused.
  await page.getByTestId('resume').click();
  const { name, patronym, gender } = soul.evidence.look;
  const banner = page.getByTestId('plea-banner');
  await expect(banner).toContainText(`${name} ${patronym} asks for a`);
  const he = gender === 'f' ? 'she' : 'he';
  await expect(banner.getByTestId('plea-stands')).toHaveText(
    `Granted, ${he}'ll stand with that hall's host at the last battle, not run from it, if ${he} told you the truth.`,
  );
  // Caught in a lie already: granted, the dead will know.
  await expect(banner.getByTestId('plea-lied')).toHaveText(
    `${gender === 'f' ? 'She' : 'He'} has lied to you already. Granted, the dead will find it out, and ${he}'ll run at the last battle.`,
  );
  await expectAccessible(page);

  // Granted all the same: a wrong stamp, cited on the spot.
  await stampAndSend(page, dest, false);
  await expect(page.getByTestId('citation-close')).toBeVisible();
  await page.getByTestId('citation-close').click();
  for (const c of queue.slice(k + 1) as CaseSpec[]) {
    await stampAndSend(page, c.expect.dest, c.expect.procedures?.includes('proc.clip') === true);
  }
  await expect(page.getByTestId('audit-title')).toHaveText(`Day ${day}: the audit`);
  const moved = page.getByTestId('word-moved');
  await expect(moved).toContainText('The word among the dead goes a step softer:');
  await expect(moved).toContainText('Each ask you grant moves it a step softer, and each you refuse, a step sterner.');
  await expectAccessible(page);
});

/** `save` with its last morning changed. */
function withMorning(save: RunSave, change: Partial<RunState>): RunSave {
  const morning = save.mornings.at(-1) as RunState;
  return { ...save, mornings: [...save.mornings.slice(0, -1), { ...morning, ...change }] };
}

test('two mornings after, the dead know it, and the morning says where the word stands', async ({ page }) => {
  const save = withMorning(scenarioSave(content, 'e2e-word-found', 10, ENGINE_MAJOR), {
    word: 2,
    found: [
      { name: 'Geir Hallsson', day: 8, hall: 'VALHALLA', on: 10 },
      // Found out on an earlier morning: not news today.
      { name: 'Thora Ketilsdottir', day: 7, hall: 'HEL', on: 9 },
    ],
  });
  await load(page, save);
  await expect(page.getByTestId('morning-title')).toHaveText('Day 10');
  const news = page.getByTestId('found-news');
  await expect(news.getByTestId('found')).toHaveText([
    "Geir Hallsson, whom you sent to Valhalla on Day 8, lied to you at the desk. The dead know it now, and say you can be fooled. At the last battle, he'll run.",
  ]);
  await expectAccessible(page);
  // Past the morning's scene, where the day's news is.
  while ((await page.getByTestId('scene-done').count()) === 0) await page.getByTestId('scene-choice').first().click();
  await page.getByTestId('scene-done').click();
  await expect(page.getByTestId('word-line')).toHaveText(
    'Word among the dead: Soft. The dead say you can be moved. More of them ask you for a hall, some bring rings, and more of them lie to you.',
  );
  await expectAccessible(page);
});

test('before the pleas’ first day, the morning says nothing of the word', async ({ page }) => {
  await load(page, scenarioSave(content, 'e2e-word-early', 5, ENGINE_MAJOR));
  await expect(page.getByTestId('morning-title')).toHaveText('Day 5');
  while ((await page.getByTestId('scene-done').count()) === 0) await page.getByTestId('scene-choice').first().click();
  await page.getByTestId('scene-done').click();
  await expect(page.getByTestId('to-gate')).toBeVisible();
  await expect(page.getByTestId('word-line')).toHaveCount(0);
});
