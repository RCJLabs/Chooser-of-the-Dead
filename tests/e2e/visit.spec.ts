import AxeBuilder from '@axe-core/playwright';
import { type Destination, ENGINE_MAJOR } from '@cots/engine';
import { loadContent, scenarioSave } from '@cots/testkit';
import { expect, type Page, test } from '@playwright/test';
import { FULL } from './urls';

/*
 * Someone at the desk (docs/tech-spec.md §46) in the full game: a save on the morning of the day a god comes to
 * the desk, made in Node with every earlier soul judged rightly. He comes once his souls have been sent, the sun
 * is held while he talks (the pause keys don't start it), and what he's told reaches the audit as the story's.
 */

test.use({ baseURL: FULL });

const content = loadContent('dev-full');
const dayOf = (scene: string) => content.days.find((d) => (d.queue.visits ?? []).some((v) => v.scene === scene));
const spec = dayOf('scene.d18.desk');
const visit = spec?.queue.visits?.[0];
const save = scenarioSave(content, 'e2e-desk', spec?.day ?? 1, ENGINE_MAJOR);

interface SavedSoul {
  readonly expect: { readonly dest: Destination; readonly procedures?: readonly string[] };
}

const isDrawer = async (page: Page) => (await page.locator('.shift--drawer').count()) > 0;

async function stampAndSend(page: Page, c: SavedSoul) {
  if (c.expect.procedures?.includes('proc.clip')) await page.getByTestId('clippers').click();
  if (await isDrawer(page)) await page.getByTestId('judge').click();
  await page.locator(`[data-dest="${c.expect.dest}"]`).click();
  await page.getByTestId('send').click();
}

test('someone at the desk: Odin comes after his souls, the sun held while he talks, his words at the audit', async ({
  page,
}) => {
  if (!spec || !visit) throw new Error('no one comes to the desk in this build');
  await page.addInitScript(
    (record) => localStorage.setItem('cots.campaign.0', record),
    JSON.stringify({ v: 1, rev: 1, savedAt: 0, save }),
  );
  await page.goto('./');
  await page.getByTestId('play-campaign').click();
  await page.getByTestId('continue-0').click();
  await expect(page.getByTestId('morning-title')).toHaveText(`Day ${spec.day}`);
  while ((await page.getByTestId('scene-done').count()) === 0) await page.getByTestId('scene-choice').first().click();
  await page.getByTestId('scene-done').click();
  await page.getByTestId('to-gate').click();
  const queue = await page.evaluate<SavedSoul[]>(
    `JSON.parse(localStorage.getItem('cots.campaign.0') ?? 'null')?.save.queue ?? []`,
  );
  expect(queue.length).toBeGreaterThan(visit.at);

  const desk = page.getByTestId('desk-visit');
  for (const [i, c] of queue.entries()) {
    if (i < visit.at) await expect(desk).toHaveCount(0);
    if (i === visit.at) {
      await expect(desk).toBeVisible();
      await expect(desk.getByRole('dialog')).toHaveAccessibleName('Someone at the desk');
      await expect(desk).toContainText('Nobody in this line knows me in this hat.');
      // Within the accessibility checks, and within the screen.
      const axe = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
        .analyze();
      expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
      expect(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')).toBe(true);
      // The sun is held while he's here, not a pause the player can lift: no pause screen, and P does nothing.
      await expect(page.getByTestId('resume')).toHaveCount(0);
      const held = await page.getByTestId('sun').innerText();
      await page.keyboard.press('p');
      await page.waitForTimeout(1500);
      await expect(page.getByTestId('sun')).toHaveText(held);
      await expect(desk).toBeVisible();
      while ((await desk.getByTestId('scene-done').count()) === 0)
        await desk.getByTestId('scene-choice').first().click();
      await expect(desk.getByTestId('scene-note')).toContainText('Odin');
      await desk.getByTestId('scene-done').click();
      await expect(desk).toHaveCount(0);
      // The sun runs again once he's gone.
      await expect(page.getByTestId('sun')).not.toHaveText(held, { timeout: 5000 });
    }
    await stampAndSend(page, c);
  }

  // What he was told reaches the day's standing at the audit, in the story's column.
  await expect(page.getByTestId('audit-title')).toHaveText(`Day ${spec.day}: the audit`);
  const odin = await page
    .getByTestId('standing')
    .locator('tr', { hasText: 'Odin' })
    .locator('td')
    .evaluateAll((cells) => cells.map((td) => td.textContent ?? ''));
  expect(odin[odin.length - 2]).toBe('+1');
});

test('Hel at the desk on the day of the spear mark: she comes after her souls, and what she’s told reaches the audit', async ({
  page,
}) => {
  // One of the gods who come to the desk since §59; the others are Freyja (Day 11) and Loki in a shawl (Day 15).
  const hel = dayOf('scene.d17.desk');
  const at = hel?.queue.visits?.[0]?.at ?? 0;
  if (!hel) throw new Error('Hel doesn’t come to the desk in this build');
  const helSave = scenarioSave(content, 'e2e-desk-hel', hel.day, ENGINE_MAJOR);
  await page.addInitScript(
    (record) => localStorage.setItem('cots.campaign.0', record),
    JSON.stringify({ v: 1, rev: 1, savedAt: 0, save: helSave }),
  );
  await page.goto('./');
  await page.getByTestId('play-campaign').click();
  await page.getByTestId('continue-0').click();
  await expect(page.getByTestId('morning-title')).toHaveText(`Day ${hel.day}`);
  while ((await page.getByTestId('scene-done').count()) === 0) await page.getByTestId('scene-choice').first().click();
  await page.getByTestId('scene-done').click();
  await page.getByTestId('to-gate').click();
  const queue = await page.evaluate<SavedSoul[]>(
    `JSON.parse(localStorage.getItem('cots.campaign.0') ?? 'null')?.save.queue ?? []`,
  );
  const desk = page.getByTestId('desk-visit');
  for (const [i, c] of queue.entries()) {
    if (i < at) await expect(desk).toHaveCount(0);
    if (i === at) {
      await expect(desk.getByRole('dialog')).toHaveAccessibleName('Someone at the desk');
      await expect(desk).toContainText('I came to see the new rule work');
      const axe = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
        .analyze();
      expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
      await desk.getByTestId('scene-choice').filter({ hasText: 'a cheat' }).click();
      while ((await desk.getByTestId('scene-done').count()) === 0)
        await desk.getByTestId('scene-choice').first().click();
      // Both gods will remember it.
      await expect(desk.getByTestId('scene-note').filter({ hasText: 'Hel' })).toHaveCount(1);
      await expect(desk.getByTestId('scene-note').filter({ hasText: 'Odin' })).toHaveCount(1);
      await desk.getByTestId('scene-done').click();
      await expect(desk).toHaveCount(0);
    }
    await stampAndSend(page, c);
  }
  // Hel +1 and Odin -1, in the story's column at the audit.
  await expect(page.getByTestId('audit-title')).toHaveText(`Day ${hel.day}: the audit`);
  const row = async (god: string) =>
    page
      .getByTestId('standing')
      .locator('tr', { hasText: god })
      .locator('td')
      .evaluateAll((cells) => cells.map((td) => td.textContent ?? ''));
  const h = await row('Hel');
  expect(h[h.length - 2]).toBe('+1');
  const o = await row('Odin');
  expect(o[o.length - 2]).toBe('-1');
});
