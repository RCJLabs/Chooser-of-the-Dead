import AxeBuilder from '@axe-core/playwright';
import { ENGINE_MAJOR, type RunSave, type RunState } from '@cots/engine';
import { loadContent, scenarioSave } from '@cots/testkit';
import { expect, type Page, test } from '@playwright/test';
import { FULL } from './urls';

/*
 * The Norns' weave (docs/tech-spec.md §53) in the full game:
 * - A new run can be woven once a run on the device has reached an ending; before then the option says so.
 * - A woven run says so on its mornings and its slot; the morning of the first day the weave changes names it, and
 *   the rulebook reads its rules in the weave's order, marking the rule it moved.
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

async function playScene(page: Page) {
  await expect(page.getByTestId('scene')).toBeVisible();
  while ((await page.getByTestId('scene-done').count()) === 0) await page.getByTestId('scene-choice').first().click();
  await page.getByTestId('scene-done').click();
  await expect(page.getByTestId('scene')).toHaveCount(0);
}

const isDrawer = async (page: Page) => (await page.locator('.shift--drawer').count()) > 0;

test('the weave opens once a run has reached an ending, and a woven run says so', async ({ page }) => {
  await page.goto('./');
  await page.getByTestId('play-campaign').click();
  await expect(page.getByTestId('weave-0')).toBeDisabled();
  await expect(page.getByTestId('slot-0')).toContainText('opens once a run reaches an ending');

  // An ending reached on this device (the last stand, say) opens it.
  await page.evaluate(() =>
    localStorage.setItem('cots.settings', JSON.stringify({ v: 1, endingsSeen: ['ending.lastStand'] })),
  );
  await page.reload();
  await page.getByTestId('play-campaign').click();
  await expect(page.getByTestId('weave-0')).toBeEnabled();
  await expect(page.getByTestId('slot-0')).not.toContainText('opens once a run reaches an ending');
  await page.getByTestId('weave-0').check();
  await expectAccessible(page);
  await page.getByTestId('new-0').click();
  await expect(page.getByTestId('morning-title')).toHaveText('Day 1');
  await expect(page.locator('.screen--morning > p.muted').first()).toContainText('· Woven');
  await page.getByTestId('campaign-quit').click();
  await expect(page.getByTestId('slot-0').getByTestId('slot-summary')).toContainText('· Woven');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('cots.campaign.0') ?? 'null'));
  // A new run's seed is fresh each time, so it may draw any of the build's weaves.
  expect((content.campaign?.weaving?.weaves ?? []).map((w) => w.id)).toContain(saved?.save.mornings[0].weave);
});

test('the clerk’s thread last: the morning names it, and the rulebook reads his rule after the halls', async ({
  page,
}) => {
  // Day 10 (the clerk's first day, the weave's first), every earlier soul judged rightly, woven so, with no day event.
  const base = scenarioSave(content, 'e2e-woven', 10, ENGINE_MAJOR);
  const morning: RunState = { ...(base.mornings.at(-1) as RunState), weave: 'weave.clerkLast', events: [] };
  const save: RunSave = { ...base, mornings: [...base.mornings.slice(0, -1), morning] };
  await page.addInitScript(
    (record) => localStorage.setItem('cots.campaign.0', record),
    JSON.stringify({ v: 1, rev: 1, savedAt: 0, save }),
  );
  await page.goto('./');
  await page.getByTestId('play-campaign').click();
  await page.getByTestId('continue-0').click();
  await expect(page.getByTestId('morning-title')).toHaveText('Day 10');
  await playScene(page);
  await expect(page.getByTestId('weave-note')).toContainText("The Norns' weave: The clerk's thread last");
  await expect(page.getByTestId('weave-note')).toContainText(
    'the baptized are his only when no other rule claims them.',
  );
  await expectAccessible(page);

  await page.getByTestId('to-gate').click();
  if (await isDrawer(page)) await page.locator('[data-tab="rules"]').click();
  const order = await page
    .locator('.rules .rules__order [data-rule]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-rule')));
  expect(order.indexOf('rule.transfer')).toBeGreaterThan(order.indexOf('rule.valhalla'));
  expect(order.at(-1)).toBe('rule.hel');
  await expect(page.locator('.rules [data-rule="rule.transfer"]').getByTestId('rule-woven')).toHaveText(
    "(the Norns' weave)",
  );
  await expect(page.locator('.rules [data-rule="rule.valhalla"]').getByTestId('rule-woven')).toHaveCount(0);
});
