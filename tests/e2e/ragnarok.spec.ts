import AxeBuilder from '@axe-core/playwright';
import {
  type Battle,
  ENGINE_MAJOR,
  EPILOGUE_SECTIONS,
  epilogueFor,
  fight,
  heldFronts,
  type NamedSoul,
  namedIn,
  type RunSave,
  type RunState,
  resumeSave,
  runContext,
  stepRun,
} from '@cots/engine';
import { loadContent, scenarioSave } from '@cots/testkit';
import { expect, type Page, test } from '@playwright/test';
import { FULL } from './urls';

/*
 * The last battle (docs/tech-spec.md §54) in the full game: after the last night, the horn. The hosts, and the fronts
 * in the order they'll be held, each saying as it's ordered whether it will hold; where the chooser rides (§58); the
 * battle front by front; then the ending, with the battle in its report.
 */

test.use({ baseURL: FULL });

const content = loadContent('dev-full');
const def = content.campaign?.ragnarok;
const LAST = content.campaign?.lastDay ?? 20;

// The last day's night, every soul judged rightly (their nails left long: the scenario jumper doesn't clip them), with
// hardly anyone in Freyja's host, so the fire can't be held, and the wolf and Hel's gate want the same souls. And five souls
// sent to Hel by mistake, who'll run from her legion: four of them named (as a run begun before souls were named would
// name only its later ones).
const base = scenarioSave(content, 'e2e-ragnarok', LAST, ENGINE_MAJOR, 'night');
const lastMorning = base.mornings.at(-1) as RunState;
const RUNNERS: readonly NamedSoul[] = [
  { name: 'Bjorn Ketilsson', day: 2, hall: 'HEL', runs: true },
  { name: 'Ulfhild Grimsdottir', day: 7, hall: 'HEL', runs: true },
  { name: 'Hallvard Sveinsson', day: 12, hall: 'HEL', runs: true },
  { name: 'Torunn Oddsdottir', day: 15, hall: 'HEL', runs: true },
];
const save: RunSave = {
  ...base,
  mornings: [
    ...base.mornings.slice(0, -1),
    {
      ...lastMorning,
      sent: { ...lastMorning.sent, FOLKVANGR: 0 },
      misfits: { ...lastMorning.misfits, HEL: 5 },
      named: [...(lastMorning.named ?? []), ...RUNNERS],
    },
  ],
};
const night = resumeSave(save, content, ENGINE_MAJOR).run;
const horn = stepRun(night, { t: 'endNight' }, { content, ctx: runContext(content, night) }).state;
const ids = def?.fronts.map((f) => f.id) ?? [];
const gateFirst = ['front.gate', ...ids.filter((id) => id !== 'front.gate')];
const battle = (order: readonly string[], ride?: string): Battle | undefined =>
  def ? fight(horn, def, order, ride) : undefined;
const RIDE = def?.ride?.strength ?? 0;

async function expectAccessible(page: Page) {
  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  expect(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')).toBe(true);
}

/** The fronts the screen says will hold, in the content's order. */
async function holding(page: Page): Promise<string[]> {
  const shown = await page
    .getByTestId('front')
    .evaluateAll((els) => els.map((e) => [e.getAttribute('data-front'), e.getAttribute('data-held')]));
  return ids.filter((id) => shown.some(([f, held]) => f === id && held === 'true'));
}

test('after the last night, the horn: the fronts held in the order set, the battle, then the ending', async ({
  page,
}) => {
  // What the engine says of this run, as ordered and with the gate first: the order decides the wolf or the gate. Riding
  // to the wolf (docs/tech-spec.md §58) holds it too; the fire, with hardly anyone in Freyja's host, falls whatever.
  const asListed = heldFronts(battle(ids) as Battle);
  const withGate = heldFronts(battle(gateFirst) as Battle);
  const ridden = heldFronts(battle(gateFirst, 'front.wolf') as Battle);
  expect(asListed).toContain('front.wolf');
  expect(asListed).not.toContain('front.gate');
  expect(withGate).toContain('front.gate');
  expect(withGate).not.toContain('front.wolf');
  expect(ridden).toEqual(expect.arrayContaining(['front.wolf', 'front.gate']));
  expect(ridden).not.toContain('front.fire');

  await page.addInitScript(
    (record) => localStorage.setItem('cots.campaign.0', record),
    JSON.stringify({ v: 1, rev: 1, savedAt: 0, save }),
  );
  await page.goto('./');
  await page.getByTestId('play-campaign').click();
  await page.getByTestId('continue-0').click();
  await expect(page.getByTestId('night-title')).toHaveText(`Night ${LAST}`);
  await expect(page.getByTestId('scene')).toBeVisible();
  while ((await page.getByTestId('scene-done').count()) === 0) await page.getByTestId('scene-choice').first().click();
  await page.getByTestId('scene-done').click();
  await page.getByTestId('sleep').click();

  // The horn: the hosts, and the fronts in the content's order to start with.
  await expect(page.getByTestId('ragnarok-title')).toHaveText('Ragnarök');
  await expect(page.getByTestId('host')).toHaveCount(def?.hosts.length ?? 0);
  await expect(page.locator('[data-host="host.freyja"]')).toContainText("Freyja's host");
  // Each host names who'll run from it (three, and how many more) and the story's own souls who'll stand.
  const ran = 'Bjorn Ketilsson (Day 2), Ulfhild Grimsdottir (Day 7), Hallvard Sveinsson (Day 12), and 2 more';
  const hel = page.locator('[data-host="host.hel"]');
  await expect(hel).toContainText('5 who will run');
  await expect(hel.getByTestId('host-runs')).toHaveText(`Who will run: ${ran}.`);
  const helStory = namedIn(horn, 'HEL').story;
  expect(helStory.length).toBeGreaterThan(0);
  await expect(hel.getByTestId('host-stand')).toContainText(`${helStory[0]?.name} (Day ${helStory[0]?.day})`);
  await expect(page.locator('[data-host="host.freyja"]').getByTestId('host-runs')).toHaveCount(0);
  await expect(page.getByTestId('front')).toHaveCount(ids.length);
  expect(await holding(page)).toEqual(asListed);
  await expect(page.getByTestId('fronts-held')).toHaveText(
    `As ordered, ${asListed.length} of ${ids.length} fronts hold.`,
  );
  await expectAccessible(page);

  // Hel's gate held first: it holds now, and the fire falls. At the top its "Earlier" is off, and the focus moves on.
  const gate = page.locator('[data-front="front.gate"]');
  while (!(await gate.getByTestId('front-earlier').isDisabled())) await gate.getByTestId('front-earlier').click();
  await expect(gate.getByTestId('front-later')).toBeFocused();
  await expect(page.getByTestId('front').first()).toHaveAttribute('data-front', 'front.gate');
  expect(await holding(page)).toEqual(withGate);
  await expect(gate.getByTestId('front-verdict')).toHaveText('Holds');
  await expect(page.locator('[data-front="front.fire"]').getByTestId('front-verdict')).toHaveText('Falls');
  await expect(page.locator('[data-front="front.wolf"]').getByTestId('front-verdict')).toHaveText('Falls');

  // Where the chooser rides: until it's chosen, the horn waits. Riding to the wolf holds it along with the gate.
  await expect(page.getByTestId('sound-horn')).toBeDisabled();
  await expect(page.getByTestId('ride-first')).toHaveText('Choose where you ride before you sound the horn.');
  await expect(page.getByTestId('ride')).toContainText(
    `You ride out too, to one front of your choosing, and you're worth ${RIDE} there.`,
  );
  await page.getByTestId('ride-front.wolf').check();
  expect(await holding(page)).toEqual(ridden);
  await expect(page.locator('[data-testid="front"][data-front="front.wolf"]')).toContainText(`you ${RIDE}`);
  await expect(page.getByTestId('ride-first')).toHaveCount(0);
  await expectAccessible(page);

  // The horn sounded: each front as it went, then the ending, with the battle in its report.
  await page.getByTestId('sound-horn').click();
  await expect(page.getByTestId('battle-title')).toBeFocused();
  await expect(page.getByTestId('battle-front')).toHaveCount(ids.length);
  for (const id of ids) {
    await expect(page.locator(`[data-testid="battle-front"][data-front="${id}"]`)).toHaveAttribute(
      'data-held',
      String(ridden.includes(id)),
    );
  }
  const gateBattle = page.locator('[data-testid="battle-front"][data-front="front.gate"]');
  await expect(gateBattle).toContainText('Garm never got through');
  await expect(gateBattle.getByTestId('front-ran')).toHaveText(`${ran} ran.`);
  await expect(gateBattle.getByTestId('front-stood')).toContainText(`${helStory[0]?.name} (Day ${helStory[0]?.day})`);
  await expect(
    page.locator('[data-testid="battle-front"][data-front="front.fire"]').getByTestId('front-ran'),
  ).toHaveCount(0);
  await expect(page.getByTestId('achievement-note')).toHaveCount(0);
  await expectAccessible(page);
  await page.getByTestId('to-ending').click();
  const ended = stepRun(
    horn,
    { t: 'marshal', order: gateFirst, ride: 'front.wolf' },
    { content, ctx: runContext(content, horn) },
  ).state;
  expect(ended.ending).not.toBeNull();
  await expect(page.getByTestId('ending-title')).toBeVisible();
  // The ending's words run to paragraphs, then the epilogue (docs/tech-spec.md §55): what the engine says became of
  // everyone, slot by slot, under its section's heading.
  expect(await page.getByTestId('ending-text').locator('p').count()).toBeGreaterThan(1);
  const said = epilogueFor(ended, content.campaign);
  expect(said.length).toBeGreaterThan(0);
  const epilogue = page.getByTestId('epilogue');
  await expect(epilogue.getByRole('heading', { name: 'What became of them' })).toBeVisible();
  await expect(epilogue.getByTestId('epilogue-line')).toHaveCount(said.length);
  const bySection = EPILOGUE_SECTIONS.flatMap((s) => said.filter((l) => l.section === s).map((l) => l.slot));
  expect(
    await epilogue.getByTestId('epilogue-line').evaluateAll((els) => els.map((e) => e.getAttribute('data-slot'))),
  ).toEqual(bySection);
  // Thorvald, sent home each time the jumper met him, slept through the horn.
  await expect(epilogue.locator('[data-slot="epi.thorvald"]')).toContainText('slept through all of it');
  await expect(page.getByTestId('battle-report')).toContainText('The last battle');
  await expect(page.locator('[data-testid="battle-report"] [data-front="front.fire"]')).toHaveAttribute(
    'data-held',
    'false',
  );
  await expect(
    page.locator('[data-testid="battle-report"] [data-front="front.gate"]').getByTestId('report-ran'),
  ).toHaveText(`${ran} ran.`);
  await expect(page.getByTestId('battle-marks')).toBeVisible();
  // The ending's achievements waited for it (not a word of them over the battle), and go once read.
  await expect(page.getByTestId('achievement-note')).toBeVisible();
  await expect(page.getByTestId('achievement-note')).toHaveCount(0, { timeout: 20_000 });
  await expectAccessible(page);

  // The ending is kept: opened again, the slot goes straight to it.
  await page.getByTestId('ending-slots').click();
  await page.getByTestId('continue-0').click();
  await expect(page.getByTestId('ending-title')).toBeVisible();
});
