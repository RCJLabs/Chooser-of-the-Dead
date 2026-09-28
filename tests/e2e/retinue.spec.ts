import AxeBuilder from '@axe-core/playwright';
import { type CaseSpec, type Destination, ENGINE_MAJOR, judge, partyAt, runContext, soulCtx } from '@cots/engine';
import { loadContent, scenarioSave } from '@cots/testkit';
import { expect, type Page, test } from '@playwright/test';
import { FULL } from './urls';

/*
 * A jarl's retinue (docs/tech-spec.md §70) in the full game: a save on the morning of Day 9, made in Node, whose line
 * brings a jarl and her hearth-man right behind the jarl who jumps the queue. Left to herself, the hearth-man would go
 * to another hall; sworn to a jarl bound for Valhalla, she goes where her jarl goes. Stamped where her own evidence
 * would send her, she's cited, and the citation says why.
 */

test.use({ baseURL: FULL });

const content = loadContent('dev-full');
const save = scenarioSave(content, 'e2e-retinue-14', 9, ENGINE_MAJOR);
const morning = save.mornings[save.mornings.length - 1];
if (!morning) throw new Error('no morning');
const ctx = runContext(content, morning);

const isDrawer = async (page: Page) => (await page.locator('.shift--drawer').count()) > 0;

async function stamp(page: Page, dest: Destination) {
  if (await isDrawer(page)) await page.getByTestId('judge').click();
  await page.locator(`[data-dest="${dest}"]`).click();
}

test('a retinue: its rule new on Day 9, the jarl marked, and a man who stood by her going where she goes', async ({
  page,
}) => {
  await page.addInitScript(
    (record) => localStorage.setItem('cots.campaign.0', record),
    JSON.stringify({ v: 1, rev: 1, savedAt: 0, save }),
  );
  await page.goto('./');
  await page.getByTestId('play-campaign').click();
  await page.getByTestId('continue-0').click();
  await expect(page.getByTestId('morning-title')).toHaveText('Day 9');
  while ((await page.getByTestId('scene-done').count()) === 0) await page.getByTestId('scene-choice').first().click();
  await page.getByTestId('scene-done').click();
  // The morning says what's new in the rulebook.
  await expect(page.getByTestId('rulebook-changes')).toContainText('goes where his jarl goes');
  await page.getByTestId('to-gate').click();
  const queue = await page.evaluate<CaseSpec[]>(
    `JSON.parse(localStorage.getItem('cots.campaign.0') ?? 'null')?.save.queue ?? []`,
  );
  // Jarl Asgaut first, then a jarl and her hearth-man.
  expect(partyAt(queue, 1)).toEqual({ start: 1, size: 2 });
  const [jarl, man] = queue.slice(1, 3) as [CaseSpec, CaseSpec];
  expect(jarl.party?.lord).toEqual({ at: 0, fact: 'lordHall' });
  expect(man.expect.rule).toBe('rule.retinue');
  expect(man.expect.dest).toBe(jarl.expect.dest);
  const own = judge({ ...man.truth, lordHall: 'none' }, soulCtx(ctx, man)).dest;
  expect(own).not.toBe(man.expect.dest);

  await stamp(page, (queue[0] as CaseSpec).expect.dest);
  await page.getByTestId('send').click();

  // Together at the desk: named for the jarl, who is marked as one.
  await expect(page.getByTestId('party-title')).toContainText(`Jarl ${jarl.evidence.look.name}`);
  await expect(page.getByTestId('party-title')).toContainText('hearth-men');
  const members = page.getByTestId('party-member');
  await expect(members.nth(0).getByTestId('party-lord')).toHaveText('jarl');
  await expect(page.getByTestId('party-lord')).toHaveCount(1);
  // The first party's tip, then the first retinue's.
  await page.getByTestId('party-tip-ok').click();
  await expect(page.getByTestId('retinue-tip')).toContainText('goes where the jarl goes');
  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  expect(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')).toBe(true);
  await page.getByTestId('retinue-tip-ok').click();
  await expect(page.getByTestId('retinue-tip')).toHaveCount(0);

  // The jarl stamped rightly; her man where his own evidence would send him.
  await stamp(page, jarl.expect.dest);
  await expect(page.getByTestId('send')).toContainText(`Next: ${man.evidence.look.name}`);
  await page.getByTestId('send').click();
  await expect(members.nth(1)).toHaveAttribute('aria-current', 'true');
  await stamp(page, own);
  await page.getByTestId('send').click();
  await expect(page.locator('.toast')).toHaveText('Sent together: 1 of 2 judged rightly.');
  // Cited, with the rule that sent him after his jarl.
  await expect(page.getByTestId('citation-close')).toBeVisible();
  await expect(page.locator('.dialog__rule')).toContainText('goes where his jarl goes');
  await page.getByTestId('citation-close').click();
  await expect(page.getByTestId('party')).toHaveCount(0);
});
