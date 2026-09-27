import {
  campaignOf,
  campaignQueue,
  type Destination,
  ENGINE_MAJOR,
  type NamedSoul,
  pleaOf,
  type RunSave,
  type RunState,
  runContext,
} from '@cots/engine';
import { loadContent, scenarioSave } from '@cots/testkit';
import { expect, type Page, test } from '@playwright/test';
import { FULL } from './urls';

/*
 * The most crowded soul on the smallest phone the game supports (docs/tech-spec.md §61): two gods' requests, the noon
 * decree's line, and kin who ask to join a soul sent wrong, all above one soul on Day 19. The notes above a soul once
 * shrank its body to half its size and cut a tool off it. Now the body and what the soul says keep their room, the
 * shift scrolls instead, and the action bar stays on the screen.
 */

test.use({ baseURL: FULL, viewport: { width: 360, height: 740 } });

const content = loadContent('dev-full');
const DAY = 19;
const WRONGED: NamedSoul = { name: 'Bjorn Ketilsson', day: 6, hall: 'HEL', runs: true };

// Day 19's morning, with two gods' requests, and a seed that brings kin who ask for a hall after noon. Varying only
// the morning's seed keeps the search cheap: the save before it is made once.
const { save, at } = (() => {
  const base = scenarioSave(content, 'e2e-crowded', DAY, ENGINE_MAJOR);
  const morning = base.mornings.at(-1) as RunState;
  const requests = (campaignOf(content).requests?.list ?? []).slice(0, 2).map(({ since: _, until: __, ...r }) => r);
  for (let i = 0; i < 200; i++) {
    const run: RunState = { ...morning, seed: `e2e-crowded-${i}`, named: [WRONGED], requests };
    const queue = campaignQueue(run, { content, ctx: runContext(content, run) });
    const noon = queue.findIndex((c) => c.noon);
    const k = queue.findIndex((c, j) => c.kin && pleaOf(content, c) && noon >= 0 && j > noon);
    if (k >= 0) return { save: { ...base, mornings: [...base.mornings.slice(0, -1), run] } as RunSave, at: k };
  }
  throw new Error(`No seed in 200 brings kin who ask after noon on Day ${DAY}`);
})();

interface SavedSoul {
  readonly expect: { readonly dest: Destination; readonly procedures?: readonly string[] };
}

async function passVisit(page: Page) {
  const desk = page.getByTestId('desk-visit');
  if ((await desk.count()) === 0) return;
  while ((await desk.getByTestId('scene-done').count()) === 0) await desk.getByTestId('scene-choice').first().click();
  await desk.getByTestId('scene-done').click();
}

test('the most crowded soul keeps its body, its tools and its words on a small phone, and Judge on the screen', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'phone', 'a phone layout');
  await page.addInitScript(
    (record) => localStorage.setItem('cots.campaign.0', record),
    JSON.stringify({ v: 1, rev: 1, savedAt: 0, save }),
  );
  await page.goto('./');
  await page.getByTestId('play-campaign').click();
  await page.getByTestId('continue-0').click();
  await expect(page.getByTestId('morning-title')).toHaveText(`Day ${DAY}`);
  while ((await page.getByTestId('scene-done').count()) === 0) await page.getByTestId('scene-choice').first().click();
  await page.getByTestId('scene-done').click();
  await page.getByTestId('to-gate').click();
  const queue = await page.evaluate<SavedSoul[]>(
    `JSON.parse(localStorage.getItem('cots.campaign.0') ?? 'null')?.save.queue ?? []`,
  );
  for (const c of queue.slice(0, at)) {
    await passVisit(page);
    if (c.expect.procedures?.includes('proc.clip')) await page.getByTestId('clippers').click();
    await page.getByTestId('judge').click();
    await page.locator(`[data-dest="${c.expect.dest}"]`).click();
    await page.getByTestId('send').click();
  }
  await passVisit(page);

  // Everything at once above the soul: the requests, the decree's line, whose kin it is and what it asks.
  await expect(page.getByTestId('request-progress')).toHaveCount(2);
  await expect(page.getByTestId('noon-since')).toBeVisible();
  await expect(page.getByTestId('kin-banner')).toBeVisible();
  await expect(page.getByTestId('plea-banner')).toBeVisible();

  // Measured in the page (the tests have no DOM types, so as a script): the body, its tools, the words, Judge.
  const layout = (await page.evaluate(`(() => {
    const box = (sel) => document.querySelector(sel)?.getBoundingClientRect() ?? null;
    const stage = box('figure.stage');
    const tools = [...document.querySelectorAll('figure.stage .btn--tool')].map((b) => b.getBoundingClientRect());
    const judge = box('[data-testid="judge"]');
    return {
      rem: parseFloat(getComputedStyle(document.documentElement).fontSize),
      vh: innerHeight,
      stage: stage ? stage.height : 0,
      tools: tools.length,
      toolsInside: stage !== null && tools.every((t) => t.top >= stage.top - 0.5 && t.bottom <= stage.bottom + 0.5),
      panel: box('.drawer__panel')?.height ?? 0,
      judge: judge ? { top: judge.top, bottom: judge.bottom } : null,
    };
  })()`)) as {
    rem: number;
    vh: number;
    stage: number;
    tools: number;
    toolsInside: boolean;
    panel: number;
    judge: { top: number; bottom: number } | null;
  };
  // The body no smaller than its tools, all of them on it; a few lines of what the soul says.
  expect(layout.stage).toBeGreaterThanOrEqual(10 * layout.rem - 1);
  expect(layout.tools).toBeGreaterThan(0);
  expect(layout.toolsInside).toBe(true);
  expect(layout.panel).toBeGreaterThanOrEqual(7 * layout.rem - 1);
  // Judge on the screen, wherever the shift is scrolled.
  expect(layout.judge !== null && layout.judge.top >= 0 && layout.judge.bottom <= layout.vh).toBe(true);
  await page.evaluate(`document.querySelector('.shift')?.scrollTo({ top: 1e6, behavior: 'instant' })`);
  const judge = await page.getByTestId('judge').boundingBox();
  expect(judge !== null && judge.y >= 0 && judge.y + judge.height <= layout.vh).toBe(true);
  // And the page itself is as wide as the screen.
  expect(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')).toBe(true);
});
