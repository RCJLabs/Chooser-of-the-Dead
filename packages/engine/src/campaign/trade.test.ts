import { loadContent, scenarioSave } from '@cots/testkit';
import { describe, expect, it } from 'vitest';
import type { Content } from '../content/types';
import { ENGINE_MAJOR } from '../index';
import { fight, heldFronts } from './battle';
import { armsTonight, campaignOf, nightOutlook, type RunAction, sellPrice, stepRun } from './run';
import { resumeSave, runContext } from './save';
import type { RunState } from './state';

/*
 * Rings with a job late in the run, and a softer bottom (docs/tech-spec.md §56): arms for the last battle, upgrades
 * sold back, and a reprieve from the debt that would end a run, once.
 */

const full = loadContent('dev-full');
const arms = campaignOf(full).arms;

/** The run on a day's night, every soul judged rightly, with its purse and whatever else changed. */
function nightOf(content: Content, day: number, change: Partial<RunState> = {}): RunState {
  const run = resumeSave(scenarioSave(content, `trade-${day}`, day, ENGINE_MAJOR, 'night'), content, ENGINE_MAJOR).run;
  expect(run).toMatchObject({ day, phase: 'night' });
  return { ...run, ...change };
}

const step = (content: Content, run: RunState, action: RunAction) =>
  stepRun(run, action, { content, ctx: runContext(content, run) });

describe('arms for the last battle', () => {
  it('go on sale from their night, one lot a night, each dearer than the last', () => {
    expect(arms).toBeDefined();
    if (!arms) return;
    const before = nightOf(full, arms.from - 1, { rings: 500 });
    expect(armsTonight(before, full)).toBeNull();
    expect(step(full, before, { t: 'arm', front: 'front.wolf' }).events[0]).toMatchObject({ e: 'rejected' });

    const run = nightOf(full, arms.from, { rings: 500 });
    expect(armsTonight(run, full)).toEqual({ price: arms.prices[0], strength: arms.strength, bought: false });
    const bought = step(full, run, { t: 'arm', front: 'front.gate' });
    expect(bought.events).toEqual([
      { e: 'armed', front: 'front.gate', strength: arms.strength, price: arms.prices[0] },
    ]);
    expect(bought.state).toMatchObject({
      rings: 500 - (arms.prices[0] ?? 0),
      armed: { 'front.gate': arms.strength },
      armsBought: 1,
      trade: { arms: arms.prices[0], sold: 0 },
    });
    // One lot a night.
    expect(armsTonight(bought.state, full)?.bought).toBe(true);
    expect(step(full, bought.state, { t: 'arm', front: 'front.wolf' }).events[0]).toMatchObject({ e: 'rejected' });
    // The next night's lot costs more; a front not in the battle, or a purse too thin, can't be armed.
    const next = { ...bought.state, day: arms.from + 1, armedOn: arms.from };
    expect(armsTonight(next, full)?.price).toBe(arms.prices[1]);
    expect(step(full, next, { t: 'arm', front: 'front.moon' }).events[0]).toMatchObject({ e: 'rejected' });
    expect(step(full, { ...next, rings: 1 }, { t: 'arm', front: 'front.wolf' }).events[0]).toMatchObject({
      e: 'rejected',
    });
    // When the prices run out, so do the arms.
    expect(armsTonight({ ...next, armsBought: arms.prices.length }, full)).toBeNull();
  });

  it('are filed in the night’s accounts, which still add up', () => {
    if (!arms) return;
    const run = nightOf(full, arms.from, { rings: 500 });
    const bought = step(full, run, { t: 'arm', front: 'front.wolf' }).state;
    const after = step(full, bought, { t: 'endNight' }).state;
    const night = after.ledger.find((l) => l.day === arms.from)?.night;
    expect(night?.arms).toBe(arms.prices[0]);
    expect(after.trade).toBeUndefined();
    expect(after.armed).toEqual({ 'front.wolf': arms.strength });
  });

  it('add their strength at their front when the horn blows, and can hold a front that would fall', () => {
    const def = campaignOf(full).ragnarok;
    if (!def || !arms) return;
    // A host too small for the wolf, and no other to spare it souls: two lots short of its foe.
    const foe = def.fronts.find((f) => f.id === 'front.wolf')?.foe ?? 0;
    const worthy = Math.ceil((foe - 2 * arms.strength) / 2);
    const base = {
      ...nightOf(full, 20),
      einherjar: { worthy, unworthy: 0 },
      sent: { VALHALLA: worthy },
      misfits: {},
      naglfar: 0,
    };
    const wolf = (run: RunState) => fight(run, def, ['front.wolf']).fronts.find((f) => f.id === 'front.wolf');
    expect(wolf(base)).toMatchObject({ held: false, arms: 0 });
    const armed = { ...base, armed: { 'front.wolf': 2 * arms.strength } };
    expect(wolf(armed)).toMatchObject({ held: true, arms: 2 * arms.strength });
    expect(wolf(armed)?.strength).toBeGreaterThanOrEqual(foe);
    expect(heldFronts(fight(armed, def, ['front.wolf']))).toContain('front.wolf');
  });
});

describe('upgrades sold back', () => {
  it('bring back their share of the price at night, and are gone', () => {
    const share = campaignOf(full).sellBack ?? 0;
    const item = campaignOf(full).shop[0];
    expect(share).toBeGreaterThan(0);
    if (!item) return;
    const run = nightOf(full, 5, { rings: 3, upgrades: [item.id] });
    const rings = Math.floor((item.price * share) / 100);
    expect(sellPrice(run, full, item.id)).toBe(rings);
    const sold = step(full, run, { t: 'sell', item: item.id });
    expect(sold.events).toEqual([{ e: 'sold', item: item.id, rings }]);
    expect(sold.state).toMatchObject({ rings: 3 + rings, upgrades: [], trade: { arms: 0, sold: rings } });
    // Not twice, not what the run hasn't got, not by day.
    expect(step(full, sold.state, { t: 'sell', item: item.id }).events[0]).toMatchObject({ e: 'rejected' });
    expect(step(full, { ...run, phase: 'morning' }, { t: 'sell', item: item.id }).events[0]).toMatchObject({
      e: 'rejected',
    });
    const night = step(full, sold.state, { t: 'endNight' }).state.ledger.find((l) => l.day === 5)?.night;
    expect(night?.sold).toBe(rings);
  });
});

describe('the reprieve', () => {
  const reprieve = campaignOf(full).reprieve;
  // A night that ends two nights below the debt floor: demoted, but for the reprieve.
  const broke = () => nightOf(full, 6, { rings: -200, debtNights: 1 });

  it('pays the debt that would end the run, once: the purse set, the nights in debt started over', () => {
    expect(reprieve).toBeDefined();
    if (!reprieve) return;
    const run = broke();
    const outlook = nightOutlook(run, { content: full, ctx: runContext(full, run) });
    expect(outlook).toMatchObject({ rings: reprieve.rings, debtNights: 0, ends: null, reprieve: true });
    const saved = step(full, run, { t: 'endNight' });
    const paid = saved.events.find((e) => e.e === 'reprieve');
    expect(paid).toBeDefined();
    expect(saved.state).toMatchObject({ phase: 'morning', day: 7, rings: reprieve.rings, debtNights: 0, ending: null });
    expect(saved.state.flags[reprieve.flag]).toBe(1);
    // The night's accounts say what it paid, and still come to the purse.
    const night = saved.state.ledger.find((l) => l.day === 6)?.night;
    expect(night?.rings).toBe(reprieve.rings);
    expect(night?.reprieve).toBe(paid && 'rings' in paid ? paid.rings : NaN);
    // Twice in a run, the debt ends it.
    const again = nightOf(full, 6, { rings: -200, debtNights: 1, flags: { [reprieve.flag]: 1 } });
    expect(nightOutlook(again, { content: full, ctx: runContext(full, again) }).ends?.ending).toBe(reprieve.ending);
    expect(step(full, again, { t: 'endNight' }).state.ending).toBe(reprieve.ending);
  });

  it('never comes under the oath', () => {
    if (!reprieve) return;
    const sworn: RunState = { ...broke(), oath: true };
    expect(step(full, sworn, { t: 'endNight' }).state.ending).toBe(reprieve.ending);
  });
});
