import { loadContent } from '@cots/testkit';
import { describe, expect, it } from 'vitest';
import type { Content, Destination, WordDef, WordLevel } from '../content/types';
import { partyAt } from '../gen/party';
import type { CaseSpec } from '../gen/types';
import { pleaOf } from './pleas';
import {
  campaignOf,
  campaignQueue,
  newRun,
  type RunAction,
  type RunEvent,
  soulName,
  stampRings,
  stepRun,
  storyOffer,
} from './run';
import { runContext } from './save';
import { type RunState, STATE_PATHS, stateValue } from './state';
import { foundOut, levelFor, liesCatchable, movedWord, ordinaryOffer, withWord, wordLevel } from './word';

// Word among the dead (docs/tech-spec.md §73).

const full = loadContent('dev-full');
const demo = loadContent('web-demo');
const word = campaignOf(full).word as WordDef;
const pleas = campaignOf(full).pleas;
if (!word || !pleas) throw new Error('no word among the dead in this build');
const level = (id: string) => word.levels.find((l) => l.id === id) as WordLevel;

/** The full game with the word's levels replaced by one that holds every word. */
const only = (l: Partial<WordLevel>): Content => {
  const { upTo: _, ...even } = level('word.even');
  return { ...full, campaign: { ...campaignOf(full), word: { ...word, levels: [{ ...even, ...l }] } } };
};

/** Steps a run through actions, keeping the day context current and failing on rejections. */
function drive(content: Content, run0: RunState, actions: readonly RunAction[]) {
  let run = run0;
  let ctx = runContext(content, run);
  const events: RunEvent[] = [];
  for (const a of actions) {
    const r = stepRun(run, a, { content, ctx });
    const bad = r.events.find((e) => e.e === 'rejected');
    if (bad && bad.e === 'rejected') throw new Error(`${a.t} rejected: ${bad.reason}`);
    if (r.state.day !== run.day) ctx = runContext(content, r.state);
    run = r.state;
    events.push(...r.events);
  }
  return { run, events };
}

/** The day's shift through its audit: every soul judged rightly but `soul`, stamped `stamped`. */
function judgedDay(content: Content, run: RunState, soul?: string, stamped?: Destination) {
  const ctx = runContext(content, run);
  const cases = stepRun(run, { t: 'beginShift', at: 0 }, { content, ctx }).state.shift?.cases ?? [];
  const actions: RunAction[] = [{ t: 'beginShift', at: 0 }];
  let at = 0;
  let party: { start: number; size: number } | null = null;
  cases.forEach((c, i) => {
    at += 20_000;
    party = partyAt(cases, i) ?? (party && i < party.start + party.size ? party : null);
    const k = party ? i - party.start : 0;
    if (party) actions.push({ t: 'shift', action: { t: 'turn', to: k, at } });
    const it = c.id === soul && stamped !== undefined;
    for (const id of it ? [] : (c.expect.procedures ?? [])) {
      const tool = ctx.procedures.find((p) => p.id === id)?.tool;
      if (tool) actions.push({ t: 'shift', action: { t: 'tool', tool, at } });
    }
    actions.push({ t: 'shift', action: { t: 'stamp', dest: it ? stamped : c.expect.dest, at } });
    if (!party || k === party.size - 1) actions.push({ t: 'shift', action: { t: 'send', at } });
  });
  return drive(content, run, actions);
}

/** Whether a soul asks for a hall: pleads (kin too) or offers rings, a story soul's written ask included. */
const asks = (content: Content, c: CaseSpec) => pleaOf(content, c) !== null || storyOffer(content, c) !== null;

/**
 * The first ordinary soul, not kin, that asks in a fresh run's lines under `content` and passes `ok`, on a day nobody
 * else in the line asks.
 */
function asking(content: Content, ok: (c: CaseSpec) => boolean) {
  for (let i = 0; i < 24; i++) {
    for (let day = pleas?.from ?? 7; day <= 15; day++) {
      const run: RunState = { ...newRun(content, `word-${i}`), day };
      const queue = campaignQueue(run, { content, ctx: runContext(content, run) });
      const askers = queue.filter((c) => asks(content, c) || c.kin);
      const soul = askers[0];
      if (askers.length === 1 && soul && !soul.script && !soul.kin && ok(soul)) return { run, soul };
    }
  }
  throw new Error('no ordinary soul asks as wanted in 24 seeds');
}

describe('word among the dead', () => {
  it('has three levels: stern at -2 and below, even about 0 (the campaign as it was), soft at 2 and above', () => {
    expect([-3, -2, -1, 0, 1, 2, 3].map((w) => wordLevel(word, w).id)).toEqual([
      'word.stern',
      'word.stern',
      'word.even',
      'word.even',
      'word.even',
      'word.soft',
      'word.soft',
    ]);
    // A run whose word hasn't moved, and every save from before it was kept, plays as the campaign did before it.
    expect(levelFor(full, {})).toMatchObject({ id: 'word.even', asks: pleas?.chance, lies: 100 });
    expect(level('word.even').offers).toBeUndefined();
    // Only the softest brings offers; a sterner word, fewer asks and fewer lies.
    expect(level('word.soft').offers).toBeGreaterThan(0);
    expect(level('word.stern').asks).toBeLessThan(level('word.even').asks);
    expect(level('word.stern').lies).toBeLessThan(100);
    expect(level('word.soft').asks).toBeGreaterThan(level('word.even').asks);
    expect(level('word.soft').lies).toBeGreaterThan(100);
    expect(movedWord(word, 3, 2)).toBe(3);
    expect(movedWord(word, -3, -1)).toBe(-3);
    expect(movedWord(word, 0, -2)).toBe(-2);
    // The demo keeps no word.
    expect(demo.campaign?.word).toBeUndefined();
    expect(levelFor(demo, { word: 3 })).toBeUndefined();
  });

  it('reads as a state path', () => {
    const run = newRun(full, 'word-path');
    expect(stateValue(run, 'word')).toBe(0);
    expect(stateValue({ ...run, word: -2 }, 'word')).toBe(-2);
    expect(STATE_PATHS.test('word')).toBe(true);
  });

  it('sets how often the day’s souls lie: a share of the day’s lie rate, after a noon decree too', () => {
    const day = campaignOf(full).lastDay - 1;
    const run: RunState = { ...newRun(full, 'word-lies'), day };
    const base = runContext(full, run);
    const noon = base.noon;
    if (!noon) throw new Error(`Day ${day} has no noon decree`);
    const rate = base.spec.queue.knobs.lieRate;
    for (const [w, id] of [
      [-3, 'word.stern'],
      [3, 'word.soft'],
    ] as const) {
      const ctx = runContext(full, { ...run, word: w });
      const share = (r: number) => Math.floor((r * level(id).lies) / 100);
      expect(ctx.spec.queue.knobs.lieRate).toBe(share(rate));
      expect(ctx.noon?.ctx.spec.queue.knobs.lieRate).toBe(share(noon.ctx.spec.queue.knobs.lieRate));
      // Nothing else about the day changes.
      expect({ ...ctx.spec.queue.knobs, lieRate: rate }).toEqual(base.spec.queue.knobs);
      expect(ctx.rules).toEqual(base.rules);
    }
    // Even: the same day.
    expect(runContext(full, { ...run, word: 1 })).toEqual(base);
    expect(withWord(base, undefined)).toBe(base);
  });

  it('makes a stern word’s days hold fewer liars than a soft word’s', () => {
    const liars = (w: number) => {
      let n = 0;
      for (let i = 0; i < 3; i++) {
        for (const day of [9, 13, 17]) {
          const run: RunState = { ...newRun(full, `word-liars-${i}`), day, word: w };
          const queue = campaignQueue(run, { content: full, ctx: runContext(full, run) });
          n += queue.filter((c) => !c.script && c.lies.length > 0).length;
        }
      }
      return n;
    };
    expect(liars(-3)).toBeLessThan(liars(3));
  }, 60_000);

  it('sets how often a soul asks, and only a soul whose lies can all be caught at the desk asks', () => {
    const always = only({ asks: 100 });
    const never = only({ asks: 0 });
    let days = 0;
    let asked = 0;
    for (let i = 0; i < 4; i++) {
      for (let day = pleas?.from ?? 7; day <= 15; day++) {
        const run: RunState = { ...newRun(full, `word-asks-${i}`), day };
        const ctx = runContext(always, run);
        const queue = campaignQueue(run, { content: always, ctx });
        // Ordinary souls that ask (kin ask for the soul they came for, and the story's own are written).
        const own = queue.filter((c) => !c.script && !c.kin && (c.plea || c.offer));
        for (const c of own) expect(liesCatchable(c, ctx)).toBe(true);
        if (!queue.some((c) => c.kin || (c.script && pleaOf(full, c)))) {
          days++;
          if (own.length > 0) asked++;
        }
        const quiet = campaignQueue(run, { content: never, ctx: runContext(never, run) });
        expect(quiet.filter((c) => !c.script && !c.kin && (c.plea || c.offer))).toEqual([]);
      }
    }
    // Every day a soul of the day's own could ask, one does.
    expect(asked).toBeGreaterThan(days / 2);
  }, 60_000);

  it('tells a lie it can’t catch from one it can', () => {
    const { run, soul } = asking(only({ asks: 100, lies: 200 }), (c) => c.lies.length > 0);
    const ctx = runContext(full, run);
    expect(liesCatchable(soul, ctx)).toBe(true);
    // Without the field that shows it false, the same lie can't be caught.
    const shown = new Set(soul.lies.map((l) => l.field));
    const bare = {
      ...soul,
      evidence: { ...soul.evidence, fields: soul.evidence.fields.filter((f) => shown.has(f.id)) },
    };
    expect(liesCatchable(bare, ctx)).toBe(false);
    expect(liesCatchable({ ...soul, lies: [] }, ctx)).toBe(true);
  });

  it('brings offers on a level that has them: rings for a hall the offers allow, paid at the audit', () => {
    const content = only({ asks: 100, offers: 100 });
    const { run, soul } = asking(content, (c) => c.offer !== undefined && c.lies.length === 0);
    const offer = ordinaryOffer(soul);
    if (!offer) throw new Error('no offer');
    expect(word.offers.some((o) => o.from === soul.expect.dest && o.to === offer.dest && o.rings === offer.rings)).toBe(
      true,
    );
    expect(pleaOf(content, soul)).toBeNull();
    expect(storyOffer(content, soul)).toEqual(offer);
    expect(stampRings(content, soul, offer.dest)).toBe(offer.rings);
    expect(stampRings(content, soul, soul.expect.dest)).toBe(0);
    // On a level without offers, the same day's soul pleads instead.
    const pled = campaignQueue(run, { content: only({ asks: 100 }), ctx: runContext(full, run) });
    expect(pled.find((c) => c.id === soul.id)?.plea).toBeDefined();

    const refused = judgedDay(content, run, soul.id, soul.expect.dest).run;
    const taken = judgedDay(content, run, soul.id, offer.dest).run;
    const l = taken.ledger.at(-1);
    // A mistake all the same, with the rings paid at the audit as a story soul's are.
    expect(l?.wrong).toBe(1);
    expect(l?.mistakes).toEqual([expect.objectContaining({ stamped: offer.dest, paid: offer.rings })]);
    expect(taken.storyRings - refused.storyRings).toBe(offer.rings);
    const filed = { name: soulName(soul), belongs: soul.expect.dest, to: offer.dest, offer: offer.rings };
    expect(l?.pleas).toEqual([{ ...filed, granted: true }]);
    expect(refused.ledger.at(-1)?.pleas).toEqual([{ ...filed, granted: false }]);
    // It bought the hall; it didn't want it: it runs at the last battle. And it doesn't appeal.
    expect(taken.misfits?.[offer.dest] ?? 0).toBe((refused.misfits?.[offer.dest] ?? 0) + 1);
    expect(taken.appeal?.case.id).not.toBe(soul.id);
    // The word: a step softer for the offer taken, a step sterner for it refused.
    expect(l?.word).toEqual({ by: 1, now: 1 });
    expect(refused.ledger.at(-1)?.word).toEqual({ by: -1, now: -1 });
  });

  it('moves a step for each ask answered: softer granted, sterner refused, neither for a third hall', () => {
    const content = only({ asks: 100 });
    const { run, soul } = asking(content, (c) => c.plea !== undefined && c.lies.length === 0);
    const plea = pleaOf(content, soul);
    if (!plea) throw new Error('no plea');
    const granted = judgedDay(content, run, soul.id, plea.dest).run;
    expect(granted.word).toBe(1);
    expect(granted.ledger.at(-1)?.word).toEqual({ by: 1, now: 1 });
    expect(granted.ledger.at(-1)?.pleas?.[0]).not.toHaveProperty('lied');
    // An honest plea granted stands, as before the word.
    expect(granted.named).toContainEqual({ name: soulName(soul), day: run.day, hall: plea.dest, runs: false });
    expect(granted.found).toBeUndefined();
    const refused = judgedDay(content, run, soul.id, soul.expect.dest).run;
    expect(refused.word).toBe(-1);
    const third = ['VALHALLA', 'HEL', 'RAN', 'FOLKVANGR'].find(
      (d) => d !== plea.dest && d !== soul.expect.dest && runContext(full, run).destinations.has(d as Destination),
    ) as Destination;
    const elsewhere = judgedDay(content, run, soul.id, third).run;
    expect(elsewhere.word).toBeUndefined();
    expect(elsewhere.ledger.at(-1)?.word).toEqual({ by: 0, now: 0 });
    // At its bound, it goes no further.
    const soft = judgedDay(content, { ...run, word: word.max }, soul.id, plea.dest).run;
    expect(soft.word).toBe(word.max);
    expect(soft.ledger.at(-1)?.word).toEqual({ by: 0, now: word.max });
  });

  it('finds out a soul that asked and lied: granted, it runs at the last battle, and two mornings later the dead know', () => {
    const content = only({ asks: 100, lies: 200 });
    const { run, soul } = asking(content, (c) => c.plea !== undefined && c.lies.length > 0);
    const plea = pleaOf(content, soul);
    if (!plea) throw new Error('no plea');
    const refused = judgedDay(content, run, soul.id, soul.expect.dest).run;
    const granted = judgedDay(content, run, soul.id, plea.dest).run;
    const name = soulName(soul);
    expect(granted.ledger.at(-1)?.pleas).toEqual([
      { name, belongs: soul.expect.dest, to: plea.dest, granted: true, lied: true },
    ]);
    // Not the soul that stands where it asked to: one that runs, with the misfits, and never with the worthy.
    expect(granted.misfits?.[plea.dest] ?? 0).toBe((refused.misfits?.[plea.dest] ?? 0) + 1);
    expect(granted.named).toContainEqual({ name, day: run.day, hall: plea.dest, runs: true });
    if (plea.dest === 'VALHALLA') expect(granted.einherjar.worthy).toBe(refused.einherjar.worthy);
    // It got what it asked for, so it doesn't appeal.
    expect(granted.appeal?.case.id).not.toBe(soul.id);
    const due = run.day + word.found.after;
    expect(granted.found).toEqual([{ name, day: run.day, hall: plea.dest, on: due }]);

    // The next morning, nothing yet; the one after, the dead know, and the word goes a step softer.
    const night = (r: RunState) => drive(content, r, [{ t: 'endAudit' }, { t: 'endNight' }]);
    const next = night(granted);
    expect(next.events.filter((e) => e.e === 'found')).toEqual([]);
    const played = judgedDay(content, next.run);
    const after = night(played.run);
    expect(after.run.day).toBe(due);
    expect(after.events.filter((e) => e.e === 'found')).toEqual([{ e: 'found', name, day: run.day, hall: plea.dest }]);
    expect(after.run.word).toBe(movedWord(word, played.run.word ?? 0, 1));
    expect(after.run.found).toEqual([{ name, day: run.day, hall: plea.dest, on: due }]);
    // Told once.
    expect(foundOut(after.run, content, due).told).toEqual([]);
  }, 60_000);

  it('tells on the morning after a jump what the days jumped over would have', () => {
    const run: RunState = {
      ...newRun(full, 'word-jump'),
      day: 12,
      word: 0,
      found: [{ name: 'Geir Hallsson', day: 3, hall: 'VALHALLA', on: 5 }],
    };
    const { run: told, told: found } = foundOut(run, full, 3);
    expect(found).toEqual([{ name: 'Geir Hallsson', day: 3, hall: 'VALHALLA', on: 12 }]);
    expect(told.word).toBe(1);
    expect(foundOut(run, demo, 3).told).toEqual([]);
  });
});
