import AxeBuilder from '@axe-core/playwright';
import {
  type CaseSpec,
  campaignQueue,
  type Destination,
  ENGINE_MAJOR,
  partyAt,
  type RunAction,
  type RunSave,
  type RunState,
  runContext,
} from '@cots/engine';
import { loadContent, scenarioSave } from '@cots/testkit';
import { expect, type Page, test } from '@playwright/test';
import { FULL } from './urls';

/*
 * The household as people (docs/tech-spec.md §74) in the full game, from saves made in Node with every earlier soul
 * judged rightly:
 * - Night 6: after the night's own scene, your mother writes to ask a favour, and the journal keeps it in play;
 * - Day 7: her friend Oddny at the desk asks for Freyja's meadow, and the desk says your mother asked too; granted
 *   (a wrong stamp all the same), your mother writes that night;
 * - Day 10: the desk says Ulf asked you to look at Steinar's back; looked at, you can tell Ulf the truth that night,
 *   and never looked at, you can't;
 * - Night 14: what they say of you at home, from the word among the dead.
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

/** Plays the scene showing through its first options, and closes it. */
async function playThrough(page: Page) {
  while ((await page.getByTestId('scene-done').count()) === 0) await page.getByTestId('scene-choice').first().click();
  await page.getByTestId('scene-done').click();
}

async function lookAtEverything(page: Page) {
  const look = page.locator('.chip--look');
  while ((await look.count()) > 0) await look.first().click();
}

/** `save` with its last morning changed: story flags written in, as the save would hold them. */
function withMorning(save: RunSave, change: Partial<RunState>): RunSave {
  const morning = save.mornings.at(-1) as RunState;
  return { ...save, mornings: [...save.mornings.slice(0, -1), { ...morning, ...change }] };
}

/**
 * The first seed whose `day`, with `flags` set that morning, has story soul `id` with only lone souls after it, and no
 * appeal to hear; and the save of that day's shift, every soul before it judged rightly (a party's members each in
 * turn, sent together).
 */
function atDesk(name: string, day: number, id: string, flags: Record<string, number>) {
  for (let i = 0; i < 40; i++) {
    const base = scenarioSave(content, `e2e-${name}-${i}`, day, ENGINE_MAJOR);
    const morning = base.mornings.at(-1) as RunState;
    const s = withMorning(base, { flags: { ...morning.flags, ...flags } });
    const run = s.mornings.at(-1) as RunState;
    if (run.appeal) continue;
    const ctx = runContext(content, run);
    const queue = campaignQueue(run, { content, ctx });
    const k = queue.findIndex((c) => c.script === id);
    if (k < 1 || queue.slice(k).some((c) => c.party !== undefined)) continue;
    const log: RunAction[] = [{ t: 'beginShift', at: 0 }];
    let at = 0;
    let party: { start: number; size: number } | null = null;
    for (const [j, c] of queue.slice(0, k).entries()) {
      at += 20_000;
      party = partyAt(queue, j) ?? (party && j < party.start + party.size ? party : null);
      const member = party ? j - party.start : 0;
      if (party) log.push({ t: 'shift', action: { t: 'turn', to: member, at } });
      for (const p of c.expect.procedures ?? []) {
        const tool = ctx.procedures.find((x) => x.id === p)?.tool;
        if (tool) log.push({ t: 'shift', action: { t: 'tool', tool, at } });
      }
      log.push({ t: 'shift', action: { t: 'stamp', dest: c.expect.dest, at } });
      if (!party || member === party.size - 1) log.push({ t: 'shift', action: { t: 'send', at } });
    }
    return { save: { ...s, log, queue } as RunSave, queue, k };
  }
  throw new Error(`No seed in 40 brings ${id} to the desk on Day ${day} with only lone souls after it`);
}

/** Judges the rest of the line rightly, through to the audit, and goes home for the night. */
async function finishDay(page: Page, rest: readonly CaseSpec[], day: number) {
  for (const c of rest) await stampAndSend(page, c.expect.dest, c.expect.procedures?.includes('proc.clip') === true);
  await expect(page.getByTestId('audit-title')).toHaveText(`Day ${day}: the audit`);
  await page.getByTestId('go-home').click();
  await expect(page.getByTestId('night-title')).toHaveText(`Night ${day}`);
}

test('Night 6: after the night’s own scene, your mother writes to ask a favour, and the journal keeps it', async ({
  page,
}) => {
  await load(page, scenarioSave(content, 'e2e-household-6', 6, ENGINE_MAJOR, 'night'));
  await expect(page.getByTestId('night-title')).toHaveText('Night 6');
  await playThrough(page);
  const scene = page.getByTestId('scene');
  await expect(scene).toContainText('A late raven brings a letter from your mother');
  await expect(scene).toContainText('Oddny Grimsdottir died this week.');
  await page.getByTestId('scene-choice').filter({ hasText: 'Promise to look for her.' }).click();
  await expect(scene).toContainText("You don't write what you'll do when you find her.");
  await expectAccessible(page);
  await page.getByTestId('scene-done').click();
  await expect(scene).toHaveCount(0);
  await page.getByTestId('journal-open').click();
  await expect(page.getByTestId('journal-threads')).toContainText(
    "Your mother asked you to send Oddny Grimsdottir to Freyja's meadow, if she comes to your gate.",
  );
  await page.getByTestId('journal-close').click();
});

test('Day 7: Oddny asks for the meadow and the desk says your mother asked too; granted, your mother writes', async ({
  page,
}) => {
  const { save, queue, k } = atDesk('household-7', 7, 'case.oddny', { errand_oddny: 1 });
  await load(page, save);
  // A shift left mid-way opens paused.
  await page.getByTestId('resume').click();
  await expect(page.getByTestId('errand-banner')).toHaveText(
    "Ragna, your mother, asked you to send Oddny Grimsdottir to Freyja's meadow.",
  );
  await expect(page.getByTestId('plea-banner')).toContainText('Oddny Grimsdottir asks for a Fólkvangr stamp');
  await expectAccessible(page);

  // Granted: a wrong stamp, cited on the spot.
  await stampAndSend(page, 'FOLKVANGR', false);
  await expect(page.getByTestId('citation-close')).toBeVisible();
  await page.getByTestId('citation-close').click();
  await finishDay(page, queue.slice(k + 1), 7);
  await playThrough(page);
  const scene = page.getByTestId('scene');
  await expect(scene).toContainText('Hild at the well dreamed of Oddny dancing');
  await expectAccessible(page);
  await playThrough(page);
  await expect(scene).toHaveCount(0);
});

test('Day 10: the desk says Ulf asked you to look at Steinar’s back; looked at, you can tell Ulf the truth', async ({
  page,
}) => {
  const { save, queue, k } = atDesk('household-10', 10, 'case.steinar', { errand_steinar: 1 });
  await load(page, save);
  await page.getByTestId('resume').click();
  await expect(page.getByTestId('errand-banner')).toHaveText(
    "Ulf, your brother, asked you to look at Steinar Kolsson's back: did he run at the ford?",
  );
  await expectAccessible(page);
  await page.getByTestId('flip').click();
  await lookAtEverything(page);
  await stampAndSend(page, (queue[k] as CaseSpec).expect.dest, false);
  await finishDay(page, queue.slice(k + 1), 10);
  await playThrough(page);
  const scene = page.getByTestId('scene');
  await expect(scene).toContainText('Did you see him?');
  await expect(scene).toContainText("You saw the wound. It was in his back, and he told you it wasn't.");
  await page.getByTestId('scene-choice').filter({ hasText: 'Tell Ulf the truth.' }).click();
  await expect(scene).toContainText('Then his mother keeps her coin, and I keep this');
  await expectAccessible(page);
  await page.getByTestId('scene-done').click();
  await expect(scene).toHaveCount(0);
});

test('Night 10: never having looked at his back, you can’t tell Ulf how Steinar died', async ({ page }) => {
  const base = scenarioSave(content, 'e2e-household-blind', 10, ENGINE_MAJOR, 'night');
  const morning = base.mornings.at(-1) as RunState;
  await load(page, withMorning(base, { flags: { ...morning.flags, errand_steinar: 1, steinar_judged: 1 } }));
  await expect(page.getByTestId('night-title')).toHaveText('Night 10');
  await playThrough(page);
  const scene = page.getByTestId('scene');
  await expect(scene).toContainText('You never looked at his back.');
  await expect(scene.getByTestId('scene-choice')).toHaveText([
    "Tell Ulf you didn't look.",
    'Tell Ulf he died facing them.',
  ]);
  await page.getByTestId('scene-choice').first().click();
  await expect(scene).toContainText('Then nobody knows but him');
  await expectAccessible(page);
});

test('Night 14: word comes from home of what they say of you at the well', async ({ page }) => {
  const base = scenarioSave(content, 'e2e-household-14', 14, ENGINE_MAJOR, 'night');
  await load(page, withMorning(base, { word: -3 }));
  await expect(page.getByTestId('night-title')).toHaveText('Night 14');
  // The night's own scene first, then the letter.
  await playThrough(page);
  const scene = page.getByTestId('scene');
  await expect(scene).toContainText('comes late');
  await expect(scene).toContainText("They say at the well that the new chooser at Odin's gate can't be moved.");
  await expectAccessible(page);
});
