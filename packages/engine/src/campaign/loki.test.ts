import { loadContent, scenarioSave } from '@cots/testkit';
import { describe, expect, it } from 'vitest';
import type { Destination, Value } from '../content/types';
import { dressForDay, generateDay } from '../gen/generate';
import type { CaseSpec } from '../gen/types';
import { ENGINE_MAJOR } from '../index';
import { createDayContext, type DayCtx } from '../logic/context';
import { solve } from '../logic/solver';
import { dayContext } from './events';
import { guiseOn, guiseOrder, lokiLearns } from './loki';
import { type RunAction, stepRun } from './run';
import { recordAction, resumeSave, runContext, startSave } from './save';
import type { RunState } from './state';

/*
 * Loki learns (docs/tech-spec.md §80): each day he's held at least once, he comes the next day in his next guise, with
 * its tell; missed, he keeps the one that worked. Only the guise he wears is shown, and only its laws are in force.
 */

const full = loadContent('dev-full');
const loki = full.campaign?.loki;
if (!loki) throw new Error('the full game has no Loki');
const guises = loki.guises.map((g) => g.id);
/** Each guise's sign, the observation tagged with it, and what it shows on Loki. */
const sign = (guise: string) => {
  const o = full.observations.find((x) => x.guise === guise);
  if (!o || !('map' in o.from)) throw new Error(`no sign for ${guise}`);
  return { key: o.key, mark: o.from.map[0]?.value as Value };
};
const signs = guises.map((g) => sign(g).key);
const isLoki = (c: CaseSpec) => c.truth[loki.fact] === true;
const body = (c: CaseSpec, key: string) => c.evidence.fields.find((f) => f.item === 'body' && f.obs?.key === key);

/** Plays the day the run is on: every soul stamped as `stamp` says, then the audit and the night. */
function playDay(run0: RunState, stamp: (c: CaseSpec) => Destination): { run: RunState; audited: RunState } {
  let run = run0;
  let audited = run0;
  const step = (a: RunAction) => {
    const r = stepRun(run, a, { content: full, ctx: runContext(full, run) });
    const bad = r.events.find((e) => e.e === 'rejected');
    if (bad && bad.e === 'rejected') throw new Error(`${a.t} rejected: ${bad.reason}`);
    run = r.state;
  };
  step({ t: 'beginShift', at: 0 });
  let at = 0;
  for (const c of run.shift?.cases ?? []) {
    at += 20_000;
    for (const id of c.expect.procedures ?? []) {
      const tool = runContext(full, run).procedures.find((p) => p.id === id)?.tool;
      if (tool) step({ t: 'shift', action: { t: 'tool', tool, at } });
    }
    step({ t: 'shift', action: { t: 'stamp', dest: stamp(c), at } });
    step({ t: 'shift', action: { t: 'send', at } });
  }
  audited = run;
  step({ t: 'endAudit' });
  step({ t: 'endNight' });
  return { run, audited };
}

const day12 = (seed: string) => scenarioSave(full, seed, 12, ENGINE_MAJOR).mornings.at(-1) as RunState;
const right = (c: CaseSpec) => c.expect.dest;
const letBy = (c: CaseSpec): Destination => (isLoki(c) ? 'VALHALLA' : c.expect.dest);

describe('Loki learns (docs/tech-spec.md §80)', () => {
  it('shows only the guise he wears: its sign and its laws, and no other’s; the first when nothing says', () => {
    const tagged = (ctx: DayCtx) => ({
      signs: ctx.observations.filter((o) => o.guise !== undefined).map((o) => o.key),
      laws: ctx.signLaws.filter((l) => l.guise !== undefined).map((l) => l.guise),
    });
    expect(tagged(createDayContext(full, 11, 'x'))).toEqual({ signs: [], laws: [] });
    const first = createDayContext(full, 13, 'x');
    expect(first.guise).toBe(guises[0]);
    expect(tagged(first)).toEqual({ signs: [signs[0]], laws: [guises[0], guises[0]] });
    for (const [i, g] of guises.entries()) {
      const ctx = createDayContext(full, 16, 'x', undefined, undefined, g);
      expect(ctx.guise).toBe(g);
      expect(tagged(ctx)).toEqual({ signs: [signs[i]], laws: [g, g] });
    }
    // The noon decree's afternoon is the same day: the same guise.
    expect(createDayContext(full, 19, 'x', undefined, undefined, guises[3]).noon?.ctx.guise).toBe(guises[3]);
  });

  it('makes every soul under the guise: Loki shows its tell, nobody else does, and the tell settles it', () => {
    for (const g of guises) {
      const { key, mark } = sign(g);
      let lokis = 0;
      for (const day of [13, 16, 20]) {
        for (const seed of ['a', 'b', 'c', 'd']) {
          const ctx = createDayContext(full, day, seed, undefined, undefined, g);
          for (const c of generateDay(`${seed}-${g}`, ctx).cases) {
            // No other guise's sign, ever; this one's on every soul, marked on Loki alone.
            for (const other of signs) if (other !== key) expect(body(c, other), `${g}: ${other}`).toBeUndefined();
            expect(body(c, key)?.obs?.value, `${g} day ${day}: ${c.archetype}`).toBe(isLoki(c) ? mark : 'none');
            // Everything looked at: Loki is held, and anyone else is cleared of being him without a presumption.
            const seen = solve(c.evidence.fields, ctx, { certainOnly: true });
            const detain = seen.rules.find((r) => r.rule === 'rule.detain')?.result;
            expect(detain, `${g} day ${day}: ${c.archetype}`).toBe(isLoki(c) ? 'T' : 'F');
            if (isLoki(c)) {
              lokis++;
              expect(c.expect.dest).toBe('DETAIN');
            }
          }
        }
      }
      expect(lokis, g).toBeGreaterThan(0);
    }
  });

  it('draws the order for the run: the first guise first, then the rest as the seed has them', () => {
    const orders = new Set<string>();
    for (const seed of ['p', 'q', 'r', 's', 't', 'u']) {
      const order = guiseOrder(full, seed).map((g) => g.id);
      expect(order[0]).toBe(guises[0]);
      expect([...order].sort()).toEqual([...guises].sort());
      expect(guiseOrder(full, seed).map((g) => g.id)).toEqual(order);
      orders.add(order.join());
    }
    expect(orders.size).toBeGreaterThan(1);
  });

  it('held on Day 12, he comes on Day 13 in his next guise; the run says so, and Day 12 is still as it was', () => {
    const seed = 'loki-held';
    const { run, audited } = playDay(day12(seed), right);
    const next = guiseOrder(full, seed)[1]?.id;
    expect(audited.ledger.at(-1)?.loki).toMatchObject({ guise: guises[0], missed: 0 });
    expect(audited.ledger.at(-1)?.loki?.caught).toBeGreaterThan(0);
    expect(run.day).toBe(13);
    expect(run.guises).toEqual([{ day: 13, guise: next }]);
    expect(run.flags[loki.flag]).toBe(guises.indexOf(next ?? ''));
    expect(guiseOn(run, full, 13)).toBe(next);
    expect(runContext(full, run).guise).toBe(next);
    // A day already played keeps the guise it had: an appeal, a replay, a report.
    expect(dayContext(full, run, 12).guise).toBe(guises[0]);
    // Day 13's line is made in the new guise.
    const begun = stepRun(run, { t: 'beginShift', at: 0 }, { content: full, ctx: runContext(full, run) }).state;
    for (const c of begun.shift?.cases ?? []) expect(body(c, sign(next ?? '').key)).toBeDefined();
  });

  it('let by, or never met, he keeps the guise that worked', () => {
    const { run, audited } = playDay(day12('loki-missed'), letBy);
    expect(audited.ledger.at(-1)?.loki).toMatchObject({ guise: guises[0], caught: 0 });
    expect(audited.ledger.at(-1)?.loki?.missed).toBeGreaterThan(0);
    expect(run.guises).toBeUndefined();
    expect(run.flags[loki.flag]).toBeUndefined();
    expect(runContext(full, run).guise).toBe(guises[0]);
    // A day without him changes nothing either.
    expect(lokiLearns({ day: 13, seed: 'x', guises: [] }, full, 0)).toBeNull();
  });

  it('takes the next guise in the run’s order each time, and the first again after the last', () => {
    const seed = 'loki-cycle';
    const order = guiseOrder(full, seed).map((g) => g.id);
    let run: Pick<RunState, 'guises' | 'seed' | 'day'> = { day: 12, seed, guises: [] };
    const worn: string[] = [];
    for (let day = 12; day < 12 + order.length; day++) {
      const learned = lokiLearns({ ...run, day }, full, 1);
      if (!learned) throw new Error(`nothing learned on day ${day}`);
      run = { ...run, day: day + 1, guises: learned.guises };
      worn.push(guiseOn(run, full, day + 1) ?? '');
    }
    expect(worn).toEqual([...order.slice(1), order[0]]);
    // There's no day after the last to wear one on.
    expect(lokiLearns({ day: full.campaign?.lastDay ?? 20, seed, guises: [] }, full, 1)).toBeNull();
  });

  it('dresses a Loki who waited in line for the next day in the guise he has learned', () => {
    const ctx12 = createDayContext(full, 12, 'wait');
    const lokiSoul = generateDay('wait', ctx12).cases.find(isLoki);
    if (!lokiSoul) throw new Error('no Loki on Day 12');
    expect(body(lokiSoul, signs[0] ?? '')?.obs?.value).toBe('stitched');
    for (const g of guises.slice(1)) {
      const dressed = dressForDay(lokiSoul, createDayContext(full, 13, 'wait', undefined, undefined, g));
      expect(dressed, g).not.toBeNull();
      expect(body(dressed as CaseSpec, signs[0] ?? ''), g).toBeUndefined();
      expect(body(dressed as CaseSpec, sign(g).key)?.obs?.value, g).toBe(sign(g).mark);
      expect(dressed?.expect.dest).toBe('DETAIN');
    }
  });

  it('is kept by the save: resumed, the run has the guise it learned', () => {
    const seed = 'loki-save';
    let save = startSave(full, seed, ENGINE_MAJOR);
    const morning = day12(seed);
    save = { ...save, mornings: [morning] };
    let run = morning;
    const record = (a: RunAction) => {
      const next = stepRun(run, a, { content: full, ctx: runContext(full, run) }).state;
      save = recordAction(save, run, a, next);
      run = next;
    };
    record({ t: 'beginShift', at: 0 });
    let at = 0;
    for (const c of run.shift?.cases ?? []) {
      at += 20_000;
      for (const id of c.expect.procedures ?? []) {
        const tool = runContext(full, run).procedures.find((p) => p.id === id)?.tool;
        if (tool) record({ t: 'shift', action: { t: 'tool', tool, at } });
      }
      record({ t: 'shift', action: { t: 'stamp', dest: c.expect.dest, at } });
      record({ t: 'shift', action: { t: 'send', at } });
    }
    record({ t: 'endAudit' });
    record({ t: 'endNight' });
    const resumed = resumeSave(save, full, ENGINE_MAJOR).run;
    expect(resumed.day).toBe(13);
    expect(resumed.guises).toEqual(run.guises);
    expect(runContext(full, resumed).guise).toBe(guiseOrder(full, seed)[1]?.id);
  });
});
