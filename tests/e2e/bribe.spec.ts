import AxeBuilder from '@axe-core/playwright';
import { type Destination, ENGINE_MAJOR, storyOffer } from '@cots/engine';
import { loadContent, scenarioSave } from '@cots/testkit';
import { expect, type Page, test } from '@playwright/test';
import { FULL } from './urls';

/*
 * A jarl's bribe (docs/tech-spec.md §47) in the full game: a save on the morning of the day a story soul jumps the
 * line with an offer, made in Node with every earlier soul judged rightly. He's first, his offer is on the desk while
 * he's there, and taking it is a wrong stamp all the same (a citation); his rings come at the audit, and the night
 * remembers them.
 */

test.use({ baseURL: FULL });

const content = loadContent('dev-full');
const offering = content.scripted?.find((d) => d.id === 'case.jarl');
const spec = content.days.find((d) => (d.queue.scripted ?? []).some((s) => s.case === offering?.id));
const save = scenarioSave(content, 'e2e-bribe', spec?.day ?? 1, ENGINE_MAJOR);

interface SavedSoul {
  readonly id: string;
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

test('a jarl’s bribe: first in line, his offer on the desk, a citation for taking it, his rings at the audit', async ({
  page,
}) => {
  if (!offering || !spec) throw new Error('no story soul in this build offers rings');
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
  // He jumped the line.
  const jarl = queue[0];
  expect(jarl?.script).toBe(offering.id);
  if (!jarl) return;
  const offer = storyOffer(content, jarl as Parameters<typeof storyOffer>[1]);
  if (!offer) throw new Error('no offer');
  const name = `${jarl.evidence.look.name} ${jarl.evidence.look.patronym}`;

  for (const [i, c] of queue.entries()) {
    const clip = c.expect.procedures?.includes('proc.clip') === true;
    if (i === 0) {
      // The offer, said openly while he's at the desk: the rings, the stamp, and what it still is.
      await expect(page.getByTestId('offer-banner')).toHaveText(
        `${name} offers you ${offer.rings} rings for a Valhalla stamp: paid at the audit, and a mistake all the same.`,
      );
      const axe = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
        .analyze();
      expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
      expect(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')).toBe(true);
      // Taken: a wrong stamp all the same, cited on the spot.
      await stampAndSend(page, offer.dest, false);
      await expect(page.getByTestId('citation-close')).toBeVisible();
      await page.getByTestId('citation-close').click();
      continue;
    }
    if (i === 1) await expect(page.getByTestId('offer-banner')).toHaveCount(0);
    await stampAndSend(page, c.expect.dest, clip);
  }

  await expect(page.getByTestId('audit-title')).toHaveText(`Day ${spec.day}: the audit`);
  await expect(page.getByTestId('audit-score')).toHaveText(`${queue.length - 1} of ${queue.length} judged rightly`);
  await expect(page.getByTestId('audit-paid').locator('td')).toHaveText([`Rings from ${name}`, `+${offer.rings}`]);

  // The night counts them in.
  await page.getByTestId('go-home').click();
  await expect(page.getByTestId('night-title')).toHaveText(`Night ${spec.day}`);
  while ((await page.getByTestId('scene-done').count()) === 0) await page.getByTestId('scene-choice').first().click();
  await expect(page.getByTestId('scene')).toContainText("You count the jarl's thirty rings into the pot");
});

test('a miser’s bribe on Day 13: forty rings for a stamp home, a citation for taking it, and Muninn remembers', async ({
  page,
}) => {
  // Hrapp Oddsson (docs/tech-spec.md §59) pays for the stamp that sends the living home. He waits his turn.
  const day13 = content.days.find((d) => (d.queue.scripted ?? []).some((s) => s.case === 'case.hrapp'));
  if (!day13) throw new Error('no miser in this build');
  const miserSave = scenarioSave(content, 'e2e-miser', day13.day, ENGINE_MAJOR);
  await page.addInitScript(
    (record) => localStorage.setItem('cots.campaign.0', record),
    JSON.stringify({ v: 1, rev: 1, savedAt: 0, save: miserSave }),
  );
  await page.goto('./');
  await page.getByTestId('play-campaign').click();
  await page.getByTestId('continue-0').click();
  await expect(page.getByTestId('morning-title')).toHaveText(`Day ${day13.day}`);
  while ((await page.getByTestId('scene-done').count()) === 0) await page.getByTestId('scene-choice').first().click();
  await page.getByTestId('scene-done').click();
  await page.getByTestId('to-gate').click();
  const queue = await page.evaluate<SavedSoul[]>(
    `JSON.parse(localStorage.getItem('cots.campaign.0') ?? 'null')?.save.queue ?? []`,
  );
  const at = queue.findIndex((c) => c.script === 'case.hrapp');
  expect(at).toBeGreaterThan(0);
  for (const [i, c] of queue.entries()) {
    const clip = c.expect.procedures?.includes('proc.clip') === true;
    if (i === at) {
      await expect(page.getByTestId('offer-banner')).toHaveText(
        'Hrapp Oddsson offers you 40 rings for a Return stamp: paid at the audit, and a mistake all the same.',
      );
      await stampAndSend(page, 'RETURN', false);
      await expect(page.getByTestId('citation-close')).toBeVisible();
      await page.getByTestId('citation-close').click();
      continue;
    }
    await stampAndSend(page, c.expect.dest, clip);
  }
  await expect(page.getByTestId('audit-paid').locator('td')).toHaveText(['Rings from Hrapp Oddsson', '+40']);
  await page.getByTestId('go-home').click();
  await expect(page.getByTestId('night-title')).toHaveText(`Night ${day13.day}`);
  while ((await page.getByTestId('scene-done').count()) === 0) await page.getByTestId('scene-choice').first().click();
  await expect(page.getByTestId('scene')).toContainText('you sent him home to his silver');
});
