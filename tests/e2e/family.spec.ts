import AxeBuilder from '@axe-core/playwright';
import { type Destination, ENGINE_MAJOR } from '@cots/engine';
import { loadContent, scenarioSave } from '@cots/testkit';
import { expect, type Page, test } from '@playwright/test';
import { FULL } from './urls';

/*
 * Family trouble money can't fix (docs/tech-spec.md §50, §51) in the full game, from saves made in Node with every
 * soul judged rightly:
 * - Ragna's chest on Night 10. Carrying her up the hill at dawn costs Day 11's shift two minutes of sun, which the
 *   option says, the morning says, and the sun shows at the desk.
 * - Solveig's boy on Day 16, back from the pass, asking openly for Rán, where his mother is. Granted, it's cited like
 *   any wrong stamp; that night the neighbours know.
 */

test.use({ baseURL: FULL });

const content = loadContent('dev-full');
const DAY = 10;
const save = scenarioSave(content, 'e2e-hill', DAY, ENGINE_MAJOR, 'night');
const sunS = content.days.find((d) => d.day === DAY + 1)?.sunS ?? 0;
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

async function expectAccessible(page: Page) {
  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  expect(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')).toBe(true);
}

test('Ragna’s chest: carried up the hill at dawn, for two minutes of the next day’s sun', async ({ page }) => {
  await page.addInitScript(
    (record) => localStorage.setItem('cots.campaign.0', record),
    JSON.stringify({ v: 1, rev: 1, savedAt: 0, save }),
  );
  await page.goto('./');
  await page.getByTestId('play-campaign').click();
  await page.getByTestId('continue-0').click();
  await expect(page.getByTestId('night-title')).toHaveText(`Night ${DAY}`);

  // The clerk's man first; then the letter from home, and what each answer costs.
  await page.getByTestId('scene-choice').first().click();
  await expect(page.getByTestId('scene')).toContainText('Lyfjaberg');
  const fly = page.getByTestId('scene-choice').filter({ hasText: 'Fly her up at dawn.' });
  await expect(fly.getByTestId('scene-sun')).toHaveText('(2:00 less sun tomorrow)');
  await expect(
    page.getByTestId('scene-choice').filter({ hasText: 'Let her rest' }).getByTestId('scene-sun'),
  ).toHaveCount(0);
  await expectAccessible(page);
  // Silver comes back.
  await page.getByTestId('scene-choice').filter({ hasText: 'Send the healer silver instead.' }).click();
  await expect(page.getByTestId('scene')).toContainText("The hill doesn't come down.");
  await fly.click();
  await expect(page.getByTestId('scene-sun-note')).toHaveText('2:00 less sun tomorrow.');
  await page.getByTestId('scene-done').click();
  await page.getByTestId('sleep').click();

  // The morning: late to the gate, and the day's sun two minutes short.
  await expect(page.getByTestId('morning-title')).toHaveText(`Day ${DAY + 1}`);
  await expect(page.getByTestId('scene')).toContainText('Eir');
  while ((await page.getByTestId('scene-done').count()) === 0) await page.getByTestId('scene-choice').first().click();
  await page.getByTestId('scene-done').click();
  await expect(page.getByTestId('dawn-note')).toHaveText('You were home at dawn: 2:00 less sun at the gate today.');
  await expect(page.locator('.briefing__queue')).toHaveText(`The sun sets in ${clock(sunS - 120)}.`);
  await expectAccessible(page);
  await page.getByTestId('to-gate').click();
  const [m, s] = ((await page.getByTestId('sun').textContent()) ?? '0:00').split(':').map(Number);
  const left = (m ?? 0) * 60 + (s ?? 0);
  expect(left).toBeLessThanOrEqual(sunS - 120);
  expect(left).toBeGreaterThan(sunS - 130);
});

interface SavedSoul {
  readonly script?: string;
  readonly expect: { readonly dest: Destination; readonly procedures?: readonly string[] };
  readonly evidence: { readonly look: { readonly name: string; readonly patronym: string } };
}

const isDrawer = async (page: Page) => (await page.locator('.shift--drawer').count()) > 0;

async function stampAndSend(page: Page, dest: Destination, clip: boolean) {
  if (clip) await page.getByTestId('clippers').click();
  if (await isDrawer(page)) await page.getByTestId('judge').click();
  await page.locator(`[data-dest="${dest}"]`).click();
  await page.getByTestId('send').click();
}

test('Solveig’s boy asks for Rán, openly: granted, it’s cited all the same, and the neighbours know', async ({
  page,
}) => {
  const PLEA_DAY = 16;
  const day16 = scenarioSave(content, 'e2e-plea', PLEA_DAY, ENGINE_MAJOR);
  await page.addInitScript(
    (record) => localStorage.setItem('cots.campaign.0', record),
    JSON.stringify({ v: 1, rev: 1, savedAt: 0, save: day16 }),
  );
  await page.goto('./');
  await page.getByTestId('play-campaign').click();
  await page.getByTestId('continue-0').click();
  await expect(page.getByTestId('morning-title')).toHaveText(`Day ${PLEA_DAY}`);
  while ((await page.getByTestId('scene-done').count()) === 0) await page.getByTestId('scene-choice').first().click();
  await page.getByTestId('scene-done').click();
  await page.getByTestId('to-gate').click();
  const queue = await page.evaluate<SavedSoul[]>(
    `JSON.parse(localStorage.getItem('cots.campaign.0') ?? 'null')?.save.queue ?? []`,
  );
  const at = queue.findIndex((c) => c.script === 'case.kari');
  expect(at).toBeGreaterThanOrEqual(0);

  for (const [i, c] of queue.entries()) {
    const clip = c.expect.procedures?.includes('proc.clip') === true;
    if (i === at) {
      const name = `${c.evidence.look.name} ${c.evidence.look.patronym}`;
      await expect(page.getByTestId('plea-banner')).toHaveText(
        `${name} asks for a Rán stamp, to be with his mother: a mistake all the same. Granted, he'll stand with that hall's host at the last battle, not run from it.`,
      );
      await expectAccessible(page);
      await stampAndSend(page, 'RAN', false);
      await expect(page.getByTestId('citation-close')).toBeVisible();
      await page.getByTestId('citation-close').click();
      continue;
    }
    if (i === at + 1 || i === 0) await expect(page.getByTestId('plea-banner')).toHaveCount(0);
    await stampAndSend(page, c.expect.dest, clip);
  }

  await expect(page.getByTestId('audit-score')).toHaveText(`${queue.length - 1} of ${queue.length} judged rightly`);
  await page.getByTestId('go-home').click();
  await expect(page.getByTestId('night-title')).toHaveText(`Night ${PLEA_DAY}`);
  await expect(page.getByTestId('scene')).toContainText('at a loom by the sea');
});
