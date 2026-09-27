import AxeBuilder from '@axe-core/playwright';
import {
  campaignQueue,
  type Destination,
  ENGINE_MAJOR,
  type NamedSoul,
  type RunSave,
  type RunState,
  runContext,
} from '@cots/engine';
import { loadContent, scenarioSave } from '@cots/testkit';
import { expect, type Page, test } from '@playwright/test';
import { FULL } from './urls';

/*
 * Souls who come back (docs/tech-spec.md §60) in the full game, from saves made in Node with every earlier soul judged
 * rightly:
 * - kin of a soul sent where it didn't belong come to the desk later, say so, and ask to join it;
 * - a story soul's widow asks for her husband's hall, and the night remembers where she went.
 */

test.use({ baseURL: FULL });

const content = loadContent('dev-full');

interface SavedSoul {
  readonly script?: string;
  readonly kin?: { readonly name: string };
  readonly expect: { readonly dest: Destination; readonly procedures?: readonly string[] };
  readonly evidence: {
    readonly look: { readonly name: string; readonly patronym: string; readonly gender: 'm' | 'f' };
  };
}

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

/** `save` with its last morning changed. */
function withMorning(save: RunSave, change: Partial<RunState>): RunSave {
  const morning = save.mornings.at(-1) as RunState;
  return { ...save, mornings: [...save.mornings.slice(0, -1), { ...morning, ...change }] };
}

/** Opens the first slot's save at its morning, plays the morning's scene, and goes to the gate; the day's queue. */
async function toGate(page: Page, save: RunSave, day: number): Promise<SavedSoul[]> {
  await page.addInitScript(
    (record) => localStorage.setItem('cots.campaign.0', record),
    JSON.stringify({ v: 1, rev: 1, savedAt: 0, save }),
  );
  await page.goto('./');
  await page.getByTestId('play-campaign').click();
  await page.getByTestId('continue-0').click();
  await expect(page.getByTestId('morning-title')).toHaveText(`Day ${day}`);
  while ((await page.getByTestId('scene-done').count()) === 0) await page.getByTestId('scene-choice').first().click();
  await page.getByTestId('scene-done').click();
  await page.getByTestId('to-gate').click();
  return page.evaluate<SavedSoul[]>(`JSON.parse(localStorage.getItem('cots.campaign.0') ?? 'null')?.save.queue ?? []`);
}

// A soul sent to Hel on Day 6 who belonged in Valhalla; on Day 9 its kin may come.
const WRONGED: NamedSoul = { name: 'Bjorn Ketilsson', day: 6, hall: 'HEL', runs: true };

const kinSave = (() => {
  for (let i = 0; i < 60; i++) {
    const s = withMorning(scenarioSave(content, `e2e-kin-${i}`, 9, ENGINE_MAJOR), { named: [WRONGED] });
    const run = s.mornings.at(-1) as RunState;
    const queue = campaignQueue(run, { content, ctx: runContext(content, run) });
    // Not the day's last soul (a citation can't show after the last stamp), and one who asks to join him.
    if (queue.slice(0, -1).some((c) => c.kin && c.plea)) return s;
  }
  throw new Error('No seed in 60 brings kin who ask on Day 9');
})();

test('kin of a soul sent where it didn’t belong: at the desk, saying so, and asking to join it', async ({ page }) => {
  const queue = await toGate(page, kinSave, 9);
  const at = queue.findIndex((c) => c.kin);
  expect(at).toBeGreaterThan(0);
  for (const [i, c] of queue.entries()) {
    const clip = c.expect.procedures?.includes('proc.clip') === true;
    if (i === at) {
      const { name, patronym, gender } = c.evidence.look;
      const relation = gender === 'f' ? 'wife' : 'cousin';
      await expect(page.getByTestId('kin-banner')).toHaveText(
        `${name} ${patronym} is Bjorn Ketilsson's ${relation}. You sent him to Hel's hall on Day 6, where he didn't belong.`,
      );
      await expect(page.getByTestId('plea-banner')).toContainText(
        `${name} ${patronym} asks for a Hel stamp, to be with him: a mistake all the same.`,
      );
      await expectAccessible(page);
      // Granted: a mistake all the same, cited on the spot.
      await stampAndSend(page, 'HEL', false);
      await expect(page.getByTestId('citation-close')).toBeVisible();
      await page.getByTestId('citation-close').click();
      continue;
    }
    await expect(page.getByTestId('kin-banner')).toHaveCount(0);
    await stampAndSend(page, c.expect.dest, clip);
  }
  await expect(page.getByTestId('audit-score')).toHaveText(`${queue.length - 1} of ${queue.length} judged rightly`);
});

test('Geir’s widow asks for his hall; granted, the night knows where she went', async ({ page }) => {
  // Geir Hallsson sent to Hel on Day 6 (docs/tech-spec.md §60): on Day 14 his widow asks to follow him there.
  const day14 = scenarioSave(content, 'e2e-widow', 14, ENGINE_MAJOR);
  const morning = day14.mornings.at(-1) as RunState;
  const save = withMorning(day14, { flags: { ...morning.flags, geir_hel: 1, geir_spared: 0 } });
  const queue = await toGate(page, save, 14);
  const at = queue.findIndex((c) => c.script === 'case.jofrid_hel');
  expect(at).toBeGreaterThan(0);
  expect(queue.some((c) => c.script === 'case.jofrid_valhalla')).toBe(false);
  for (const [i, c] of queue.entries()) {
    const clip = c.expect.procedures?.includes('proc.clip') === true;
    if (i === at) {
      await expect(page.getByTestId('plea-banner')).toHaveText(
        "Jofrid Arnorsdottir asks for a Hel stamp, to be with her husband, Geir: a mistake all the same. Granted, she'll stand with that hall's host at the last battle, not run from it.",
      );
      await stampAndSend(page, 'HEL', false);
      await expect(page.getByTestId('citation-close')).toBeVisible();
      await page.getByTestId('citation-close').click();
      continue;
    }
    await stampAndSend(page, c.expect.dest, clip);
  }
  await page.getByTestId('go-home').click();
  await expect(page.getByTestId('night-title')).toHaveText('Night 14');
  while ((await page.getByTestId('scene-done').count()) === 0) await page.getByTestId('scene-choice').first().click();
  await expect(page.getByTestId('scene')).toContainText(
    'A widow crossed my bridge this afternoon, asking for Geir Hallsson.',
  );
});
