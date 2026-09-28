import AxeBuilder from '@axe-core/playwright';
import { type CaseSpec, type Destination, ENGINE_MAJOR, partyAt } from '@cots/engine';
import { loadContent, scenarioSave } from '@cots/testkit';
import { expect, type Page, test } from '@playwright/test';
import { FULL } from './urls';

/*
 * Linked souls (docs/tech-spec.md §69) in the full game: a save on the morning of Day 11, made in Node, whose line has
 * two souls who fell in one fight right behind the day's first soul. They stand at the desk together: the player turns
 * between them, catches what one says of the other against the other's own hands, questions it, and sends them on
 * together.
 */

test.use({ baseURL: FULL });

const content = loadContent('dev-full');
const save = scenarioSave(content, 'e2e-party-95', 11, ENGINE_MAJOR);

const isDrawer = async (page: Page) => (await page.locator('.shift--drawer').count()) > 0;

async function stamp(page: Page, dest: Destination) {
  if (await isDrawer(page)) await page.getByTestId('judge').click();
  await page.locator(`[data-dest="${dest}"]`).click();
}

/** Looks the member at the desk over until `field` is in view: each "look" chip in turn. */
async function lookFor(page: Page, field: string) {
  const look = page.locator('.chip--look');
  while ((await page.locator(`.clues [data-field="${field}"]`).count()) === 0 && (await look.count()) > 0) {
    await look.first().click();
  }
}

test('a party at the desk: turned between, one’s lie about the other caught and questioned, sent on together', async ({
  page,
}) => {
  await page.addInitScript(
    (record) => localStorage.setItem('cots.campaign.0', record),
    JSON.stringify({ v: 1, rev: 1, savedAt: 0, save }),
  );
  await page.goto('./');
  await page.getByTestId('play-campaign').click();
  await page.getByTestId('continue-0').click();
  await expect(page.getByTestId('morning-title')).toHaveText('Day 11');
  while ((await page.getByTestId('scene-done').count()) === 0) await page.getByTestId('scene-choice').first().click();
  await page.getByTestId('scene-done').click();
  await page.getByTestId('to-gate').click();
  const queue = await page.evaluate<CaseSpec[]>(
    `JSON.parse(localStorage.getItem('cots.campaign.0') ?? 'null')?.save.queue ?? []`,
  );
  // The day's first soul, then the two who fell together.
  const span = partyAt(queue, 1);
  expect(span).toEqual({ start: 1, size: 2 });
  const [first, second] = queue.slice(1, 3) as [CaseSpec, CaseSpec];
  const lie = first.lies.find((l) => l.about === 1);
  if (!lie) throw new Error('no lie about a companion in this line');
  expect(lie.fact).toBe('grip');

  const head = queue[0] as CaseSpec;
  await stamp(page, head.expect.dest);
  await page.getByTestId('send').click();

  // Together at the desk: what brought them, and each of them to turn to.
  await expect(page.getByTestId('party-title')).toContainText('Fell together at');
  const members = page.getByTestId('party-member');
  await expect(members).toHaveCount(2);
  await expect(members.nth(0)).toHaveAttribute('aria-current', 'true');
  await expect(members.nth(0)).toContainText(first.evidence.look.name);
  await expect(members.nth(1)).toContainText(second.evidence.look.name);
  // The first party's tip, once.
  await expect(page.getByTestId('party-tip')).toBeVisible();
  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  expect(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')).toBe(true);
  await page.getByTestId('party-tip-ok').click();
  await expect(page.getByTestId('party-tip')).toHaveCount(0);

  // The keys turn between them too.
  await page.keyboard.press(']');
  await expect(members.nth(1)).toHaveAttribute('aria-current', 'true');
  await page.keyboard.press('[');
  await expect(members.nth(0)).toHaveAttribute('aria-current', 'true');

  // The second's hands, looked at.
  await members.nth(1).click();
  await lookFor(page, 'body.front.grip');
  // What the first says of the second's weapon, against the second's own hands: caught.
  await members.nth(0).click();
  if (await isDrawer(page)) await page.locator('[data-tab="words"]').click();
  await page.getByTestId('compare').click();
  await page.locator(`[data-field="${lie.field}"]`).first().click();
  await members.nth(1).click();
  await page.locator('.clues [data-field="body.front.grip"]').click();
  await expect(page.locator('.toast')).toHaveText('Caught: that was a lie.');

  // Marked on the one who told it, who can be questioned on it.
  await members.nth(0).click();
  if (await isDrawer(page)) await page.locator('[data-tab="words"]').click();
  await expect(page.locator(`[data-field="${lie.field}"]`).first()).toBeVisible();
  await page.getByTestId('question').first().click();
  await expect(page.locator('.dialog--answer h2')).toContainText(first.evidence.look.name);
  await page.getByTestId('answer-close').click();

  // Stamped and sent on: the first goes on to the second, and the last sends them both.
  await stamp(page, first.expect.dest);
  await expect(page.getByTestId('send')).toContainText(`Next: ${second.evidence.look.name}`);
  await page.getByTestId('send').click();
  await expect(members.nth(1)).toHaveAttribute('aria-current', 'true');
  await expect(page.getByTestId('party-stamp')).toHaveCount(1);
  await stamp(page, second.expect.dest);
  // (On a phone, the last one is held to send, as a single soul is.)
  await expect(page.getByTestId('send')).toContainText(/[Ss]end all 2/);
  await page.getByTestId('send').click();
  await expect(page.locator('.toast')).toHaveText('Sent together: 2 of 2 judged rightly.');
  await expect(page.getByTestId('party')).toHaveCount(0);
});
