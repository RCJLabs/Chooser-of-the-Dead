import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { REGION_KEYS } from '@cots/art';
import {
  type CaseSpec,
  ENGINE_MAJOR,
  guiseOrder,
  type RunAction,
  type RunSave,
  recordAction,
  resumeSave,
  runContext,
  stepRun,
} from '@cots/engine';
import { loadContent, scenarioSave } from '@cots/testkit';
import { expect, type Page, test } from '@playwright/test';
import { FULL } from './urls';

/*
 * Loki learns (docs/tech-spec.md §80), in the full game, from a save made in Node at the audit of Day 12 with every
 * soul judged rightly, Loki among them: the audit says he knows he was held, and on Day 13 Huginn's news names his
 * next guise and its tell, the rulebook's laws for it come in and the lips' go out, and the line comes dressed for it.
 */

// Reduced motion: a save loaded in a fresh browser earns achievements, and an axe scan during the notice's fade-in
// reads its half-faded words as low contrast.
test.use({ baseURL: FULL, contextOptions: { reducedMotion: 'reduce' } });

const content = loadContent('dev-full');
const strings: Record<string, string> = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../../content/packs/campaign/strings/en.json'), 'utf8'),
);
const core: Record<string, string> = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../../content/packs/core/strings/en.json'), 'utf8'),
);

async function expectAccessible(page: Page) {
  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  expect(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')).toBe(true);
}

/** Plays every scene showing through its first options. */
async function playScenes(page: Page) {
  while ((await page.getByTestId('scene').count()) > 0) {
    while ((await page.getByTestId('scene-done').count()) === 0) await page.getByTestId('scene-choice').first().click();
    await page.getByTestId('scene-done').click();
  }
}

/** Day 12 played in Node, every soul judged rightly (each procedure done first), up to its audit. */
function heldOnDay12(seed: string): RunSave {
  let save = scenarioSave(content, seed, 12, ENGINE_MAJOR);
  let run = resumeSave(save, content, ENGINE_MAJOR).run;
  const apply = (action: RunAction) => {
    const env = { content, ctx: runContext(content, run), ...(save.queue ? { queue: save.queue } : {}) };
    const next = stepRun(run, action, env).state;
    save = recordAction(save, run, action, next);
    run = next;
  };
  apply({ t: 'beginShift', at: 0 });
  let at = 0;
  for (const c of run.shift?.cases ?? []) {
    at += 1000;
    for (const id of c.expect.procedures ?? []) {
      const tool = runContext(content, run).procedures.find((p) => p.id === id)?.tool;
      if (tool) apply({ t: 'shift', action: { t: 'tool', tool, at } });
    }
    apply({ t: 'shift', action: { t: 'stamp', dest: c.expect.dest, at } });
    apply({ t: 'shift', action: { t: 'send', at } });
  }
  return save;
}

test('held on Day 12, Loki knows it; on Day 13 he comes in his next guise, told at dawn and worn in the line', async ({
  page,
}) => {
  const seed = 'e2e-loki';
  const save = heldOnDay12(seed);
  const audited = resumeSave(save, content, ENGINE_MAJOR).run;
  expect(audited.phase).toBe('audit');
  expect(audited.ledger.at(-1)?.loki?.caught).toBeGreaterThan(0);
  const [lips, next] = guiseOrder(content, seed);
  if (!lips || !next) throw new Error('Loki has no guises');
  const lawsOf = (guise: string) => content.signLaws.filter((l) => l.guise === guise).map((l) => strings[l.text]);
  const sign = content.observations.find((o) => o.guise === next.id);
  if (!sign) throw new Error(`no sign for ${next.id}`);

  await page.addInitScript(
    (record) => {
      if (localStorage.getItem('cots.campaign.0') === null) localStorage.setItem('cots.campaign.0', record);
    },
    JSON.stringify({ v: 1, rev: 1, savedAt: 0, save }),
  );
  await page.goto('./');
  await page.getByTestId('play-campaign').click();
  await page.getByTestId('continue-0').click();

  // The audit: held, he knows it, and he'll come another way.
  await expect(page.getByTestId('audit-title')).toHaveText('Day 12: the audit');
  await expect(page.getByTestId('loki-note')).toHaveText(core['ui.audit.lokiLearns'] ?? '');
  await expectAccessible(page);
  await page.getByTestId('go-home').click();
  await playScenes(page);
  await page.getByTestId('sleep').click();

  // Dawn: Huginn's news of the guise, its laws in force and the lips' gone.
  await expect(page.getByTestId('morning-title')).toHaveText('Day 13');
  await playScenes(page);
  const news = page.getByTestId('guise-news');
  await expect(news).toContainText(strings[next.news] ?? next.news);
  const badge = (key: string) => core[`ui.campaign.${key}.badge`] ?? key;
  await expect(news.getByTestId('guise-law')).toHaveText(lawsOf(next.id).map((l) => `${badge('new')} ${l}`));
  await expect(news.getByTestId('guise-law-gone')).toHaveText(lawsOf(lips.id).map((l) => `${badge('repealed')} ${l}`));
  await expectAccessible(page);

  // The line comes dressed for it: the first soul shows the guise's sign, marked or plain, where its region is.
  await page.getByTestId('to-gate').click();
  const raw = await page.evaluate(() => localStorage.getItem('cots.campaign.0'));
  const first = (JSON.parse(raw ?? 'null') as { save: { queue: CaseSpec[] | null } } | null)?.save.queue?.[0];
  const field = first?.evidence.fields.find((f) => f.item === 'body' && f.obs?.key === sign.key);
  expect(field?.obs?.value).toBeDefined();
  const region = Object.entries(REGION_KEYS).find(([, keys]) => keys.includes(sign.key))?.[0];
  await page.locator(`.stage .hotspot[data-region="${region}"]`).click();
  await expect(page.locator('.clues')).toContainText(strings[`obs.${sign.key}.${String(field?.obs?.value)}`] ?? '');
});
