import { loadContent } from '@cots/testkit';
import { describe, expect, it } from 'vitest';
import type { OriginDef } from '../content/types';
import { familyDefs, fedAtHome, memberDef, originOf, scenesFor } from './origin';
import {
  billForecast,
  billTotal,
  defaultBills,
  economyOf,
  newRun,
  nightOutlook,
  sellPrice,
  shiftMods,
  shopFor,
  stepRun,
} from './run';
import { isRunSave, resumeSave, runContext, startSave } from './save';
import { type RunState, stateValue } from './state';

// Who the chooser was in life (docs/tech-spec.md §72).

const full = loadContent('dev-full');
const demo = loadContent('web-demo');
const origins = full.campaign?.origins ?? [];
const origin = (id: string) => origins.find((o) => o.id === id) as OriginDef;
const startRings = full.campaign?.startRings ?? 0;

/** The run on the night of `day`, begun as `id`, with nothing bought or played. */
const night = (id: string | undefined, day: number, over: Partial<RunState> = {}): RunState => ({
  ...newRun(full, 'origin-test', id ? { origin: id } : {}),
  day,
  phase: 'night',
  ...over,
});

describe('origins', () => {
  it('ship four in the full game, each with a perk, someone at home and three scenes; none in the demo', () => {
    expect(origins.map((o) => o.id)).toEqual(['shieldmaiden', 'seeress', 'trader', 'thrall']);
    for (const o of origins) {
      expect(Object.keys(o.perk).length).toBeGreaterThan(0);
      expect(o.member?.adult).toBe(true);
      expect(o.scenes).toHaveLength(3);
    }
    expect(demo.campaign?.origins).toBeUndefined();
    expect(() => newRun(demo, 'x', { origin: 'trader' })).toThrow(/no origin "trader"/);
  });

  it('begin a run with someone more at home, rings to start, and the origin kept', () => {
    for (const o of origins) {
      const run = newRun(full, 'x', { origin: o.id });
      expect(run.origin).toBe(o.id);
      expect(run.rings).toBe(startRings + (o.perk.startRings ?? 0));
      expect(run.family.map((m) => m.id)).toEqual([...(full.campaign?.family ?? []).map((f) => f.id), o.member?.id]);
      expect(run.family.at(-1)).toEqual({ id: o.member?.id, status: 'well', cold: 0, hungry: 0, sickNights: 0 });
      expect(originOf(run, full)).toBe(o);
      expect(familyDefs(run, full).at(-1)).toBe(o.member);
      expect(memberDef(full, o.member?.id ?? '')).toBe(o.member);
      expect(stateValue(run, `origin.${o.id}`)).toBe(1);
      expect(stateValue(run, `member.${o.member?.id}.well`)).toBe(1);
    }
    const plain = newRun(full, 'x');
    expect(plain.origin).toBeUndefined();
    expect(plain.rings).toBe(startRings);
    expect(stateValue(plain, 'origin.trader')).toBe(0);
    expect(familyDefs(plain, full)).toEqual(full.campaign?.family);
  });

  it('refuse an origin the build lacks, and the vertical slice', () => {
    expect(() => newRun(full, 'x', { origin: 'jarl' })).toThrow(/no origin "jarl"/);
    expect(() => newRun(full, 'x', { origin: 'trader', slice: 'play' })).toThrow(/without an origin/);
  });

  it('only ever change speed or money: tools, free questions and sun at the desk', () => {
    const plain = shiftMods(night(undefined, 5), full);
    const shield = shiftMods(night('shieldmaiden', 5), full);
    expect(shield.toolCostS).toEqual({ flip: 0, feather: 4 });
    expect(shield.freeQuestions ?? 0).toBe(plain.freeQuestions ?? 0);
    expect(shiftMods(night('seeress', 5), full).freeQuestions).toBe(
      (plain.freeQuestions ?? 0) + (origin('seeress').perk.freeQuestions ?? 0),
    );
    expect(shiftMods(night('thrall', 5), full).sunS).toBe((plain.sunS ?? 0) + (origin('thrall').perk.sunS ?? 0));
    expect(shiftMods(night('trader', 5), full)).toEqual(plain);
    // An upgrade that's quicker still wins; one that's slower doesn't slow her down.
    const bier = shiftMods(night('shieldmaiden', 5, { upgrades: ['up.oiledBier'] }), full);
    expect(bier.toolCostS?.flip).toBe(0);
  });

  it('sell the trader’s daughter upgrades for less, and sell back half what she paid', () => {
    const list = shopFor(night(undefined, 5), full);
    const trader = shopFor(night('trader', 5), full);
    const pct = origin('trader').perk.shopPct ?? 100;
    expect(pct).toBeLessThan(100);
    expect(trader.map((u) => u.id)).toEqual(list.map((u) => u.id));
    for (const u of trader) {
      expect(u.price).toBe(Math.floor(((list.find((x) => x.id === u.id)?.price ?? 0) * pct) / 100));
    }
    const horn = trader.find((u) => u.id === 'up.meadHorn');
    if (!horn) throw new Error('no horn of mead on sale');
    const env = { content: full, ctx: runContext(full, night('trader', 5)) };
    const bought = stepRun(night('trader', 5, { rings: 100 }), { t: 'buy', item: horn.id }, env).state;
    expect(bought.rings).toBe(100 - horn.price);
    expect(sellPrice(bought, full, horn.id)).toBe(Math.floor((horn.price * (full.campaign?.sellBack ?? 0)) / 100));
  });

  it('leave upgrades out of the shop that would do nothing for who she was', () => {
    const ids = shopFor(night('shieldmaiden', 5), full).map((u) => u.id);
    expect(ids).not.toContain('up.oiledBier');
    expect(ids).not.toContain('up.swanFeather');
    expect(ids).toContain('up.meadHorn');
    expect(shopFor(night('thrall', 5), full).map((u) => u.id)).toContain('up.oiledBier');
  });

  it('bring someone who keeps themselves while well, and is one more to feed once sick', () => {
    for (const o of origins) expect(o.member?.ownKeep).toBe(true);
    const env = { content: full, ctx: runContext(full, night(undefined, 5)) };
    const economy = economyOf(env);
    const plain = night(undefined, 5);
    const thrall = night('thrall', 5);
    const food = (run: RunState) => billTotal(run, economy, defaultBills(run), full).food;
    // Well, Kormak is off the food bill, tonight and in the nights ahead, and never goes hungry for want of it.
    expect(fedAtHome(thrall, full).map((m) => m.id)).not.toContain('kormak');
    expect(food(thrall)).toBe(food(plain));
    expect(billForecast(thrall, full)).toEqual(billForecast(plain, full));
    const unfed = { ...defaultBills(thrall), food: false };
    const hungry = nightOutlook(thrall, env, unfed).members.find((n) => n.member.id === 'kormak');
    expect(hungry?.member.hungry).toBe(0);
    expect(nightOutlook(thrall, env, unfed).members.find((n) => n.member.id === 'mother')?.member.hungry).toBe(1);
    // Sick, he's fed and needs medicine like anyone.
    const sick = night('thrall', 5, {
      family: thrall.family.map((m) => (m.id === 'kormak' ? { ...m, status: 'sick' as const, sickNights: 1 } : m)),
    });
    expect(food(sick)).toBe(food(plain) + economy.costs.food);
    expect(nightOutlook(sick, env, { ...defaultBills(sick), food: false }).members.at(-1)?.member.hungry).toBe(1);
  });

  it('let an adult brought home die of what the family can', () => {
    const thrall = night('thrall', 5);
    // Sick two nights without medicine: an adult dies (docs/build-plan.md §1).
    const sick = night('thrall', 5, {
      family: thrall.family.map((m) => (m.id === 'kormak' ? { ...m, status: 'sick' as const, sickNights: 1 } : m)),
    });
    const env = { content: full, ctx: runContext(full, sick) };
    const set = stepRun(sick, { t: 'bills', bills: { ...defaultBills(sick), medicine: [] } }, env).state;
    const after = stepRun(set, { t: 'endNight' }, env).state;
    expect(after.family.find((m) => m.id === 'kormak')).toMatchObject({ status: 'gone', gone: 'died' });
    expect(stateValue(after, 'member.kormak.died')).toBe(1);
  });

  it('play their scenes after the day’s own, only in runs begun with them', () => {
    const own = full.days.find((d) => d.day === 1)?.scenes?.night;
    expect(scenesFor(night(undefined, 1), full, 'night')).toEqual([own]);
    // Letters from home (docs/tech-spec.md §74) come after them: household.test.ts.
    const letters = new Set((full.campaign?.letters ?? []).map((l) => l.scene));
    for (const o of origins) {
      for (const sc of o.scenes) {
        const day = full.days.find((d) => d.day === sc.day)?.scenes?.[sc.at];
        expect(scenesFor(night(o.id, sc.day), full, sc.at).filter((id) => !letters.has(id))).toEqual([
          ...(day ? [day] : []),
          sc.scene,
        ]);
      }
    }
    expect(scenesFor(night('trader', 2), full, 'night')).toEqual([full.days.find((d) => d.day === 2)?.scenes?.night]);
    expect(scenesFor(night('trader', 1), full, 'morning')).toEqual([
      full.days.find((d) => d.day === 1)?.scenes?.morning,
    ]);
  });

  it('keep saves without an origin as they were, and replay one begun with an origin exactly', () => {
    const plain = startSave(full, 'origin-save', 1);
    expect(isRunSave(plain)).toBe(true);
    expect(plain.mornings[0]?.origin).toBeUndefined();
    const save = startSave(full, 'origin-save', 1, { origin: 'seeress' });
    expect(isRunSave(save)).toBe(true);
    expect(JSON.parse(JSON.stringify(save))).toEqual(save);
    const { run } = resumeSave(save, full, 1);
    expect(run.origin).toBe('seeress');
    expect(run.family.map((m) => m.id)).toContain('heid');
  });
});
