import { loadContent } from '@cots/testkit';
import { describe, expect, it } from 'vitest';
import type { Content } from '../content/types';
import { Rng } from '../rng/rng';
import {
  BOONS_OFFERED,
  canPick,
  type EndlessPick,
  endlessConfig,
  endlessOffer,
  hasBoons,
  roundSunS,
  runRules,
  tallyEvent,
} from './boons';
import { ENDLESS_STRIKES, endlessContext, endlessDay, endlessRound, endlessShareText } from './endless';
import { hintsLeft, patienceLeft, type ShiftEvent, startShift, stepShift, type Verdict } from './shift';

const full = loadContent('dev-full');
const demo = loadContent('web-demo');

const pick = (round: number, id: string): EndlessPick => ({ round, id });
const ids = (xs: readonly { id: string }[]) => xs.map((x) => x.id);
const boon = (content: Content, id: string) => {
  const b = content.boons?.find((x) => x.id === id);
  if (!b) throw new Error(`no ${id}`);
  return b;
};

describe('Endless as a run: what the picks add up to', () => {
  it('starts as Endless always has: three strikes, a soul worth one, no sun, no hints', () => {
    expect(runRules(full, [])).toEqual({
      strikes: ENDLESS_STRIKES,
      worth: 1,
      bounty: 0,
      curses: 0,
      oath: false,
      sun: false,
      sunCut: 0,
      sunS: 0,
      toolPct: 100,
      freeQuestions: 0,
      patience: 0,
      hints: 0,
    });
  });

  it('adds up boons and curses; each curse makes a soul worth one more', () => {
    const r = runRules(full, [
      pick(1, 'boon.shield'),
      pick(2, 'curse.sun'),
      pick(3, 'boon.eye'),
      pick(4, 'curse.hel'),
      pick(5, 'boon.hands'),
      pick(6, 'curse.heavy'),
      pick(7, 'boon.eye'),
      pick(8, 'curse.hurry'),
      pick(9, 'curse.tyr'),
      pick(10, 'boon.bounty'),
    ]);
    expect(r).toMatchObject({ strikes: 3, worth: 6, curses: 5, sun: true, oath: true, hints: 6, bounty: 1 });
    // Half and double: as they were.
    expect(r.toolPct).toBe(100);
    expect(r.sunCut).toBe(25);
  });

  it('counts nothing for a pick this build no longer has, and never leaves the run without a strike to take', () => {
    expect(runRules(full, [pick(1, 'boon.gone')])).toEqual(runRules(full, []));
    const harsh = { ...full, boons: [...(full.boons ?? []), { ...boon(full, 'curse.hel'), id: 'curse.x', max: 9 }] };
    const r = runRules(harsh, [pick(1, 'curse.x'), pick(2, 'curse.x'), pick(3, 'curse.x'), pick(4, 'curse.x')]);
    expect(r.strikes).toBe(1);
  });

  it('only the full game has boons: the demo’s Endless is as it was', () => {
    expect(hasBoons(full)).toBe(true);
    expect(hasBoons(demo)).toBe(false);
    expect(endlessOffer(demo, 'e', 1, [], 0)).toBeNull();
    const ctx = endlessContext(demo, 'e', 1);
    expect(endlessConfig(ctx, 'e', 1, runRules(demo, []), 0)).toEqual({
      mode: 'practice',
      seed: 'e|endless|1',
      day: ctx.day,
      untimed: true,
    });
  });
});

describe('Endless as a run: the offer between rounds', () => {
  it('comes before every round but the first', () => {
    expect(endlessOffer(full, 'e', 0, [], 0)).toBeNull();
    expect(endlessOffer(full, 'e', 1, [], 0)).not.toBeNull();
  });

  it('first offers the three boons Day 2 allows, and a curse', () => {
    const offer = endlessOffer(full, 'e', 1, [], 0);
    expect(ids(offer?.boons ?? [])).toEqual(['boon.shield', 'boon.eye', 'boon.bounty']);
    expect(['curse.sun', 'curse.hel', 'curse.tyr']).toContain(offer?.curse?.id);
  });

  it('is drawn from the seed and the round: the same for everyone who chose the same', () => {
    const picks = [pick(1, 'curse.sun'), pick(2, 'boon.shield')];
    for (const seed of ['endless:91', 'endless:92', 'x']) {
      for (const round of [3, 4, 9, 25]) {
        expect(endlessOffer(full, seed, round, picks, 1)).toEqual(endlessOffer(full, seed, round, picks, 1));
      }
    }
    // Different seeds offer different things somewhere.
    const offers = new Set(
      Array.from({ length: 12 }, (_, i) => JSON.stringify(endlessOffer(full, `s${i}`, 5, picks, 0))),
    );
    expect(offers.size).toBeGreaterThan(1);
  });

  it('shows the boons in the pack’s order', () => {
    const order = ids(full.boons ?? []);
    for (let i = 0; i < 20; i++) {
      const offer = endlessOffer(full, `o${i}`, 6, [pick(1, 'curse.sun')], 1);
      const shown = ids(offer?.boons ?? []);
      expect(shown).toHaveLength(BOONS_OFFERED);
      expect([...shown].sort((a, b) => order.indexOf(a) - order.indexOf(b))).toEqual(shown);
    }
  });

  it('offers mending only after a strike, sun boons only under the sun, presses only once souls are pressed', () => {
    const seen = (round: number, picks: EndlessPick[], strikes: number) => {
      const out = new Set<string>();
      for (let i = 0; i < 60; i++) {
        const o = endlessOffer(full, `v${i}`, round, picks, strikes);
        for (const b of o?.boons ?? []) out.add(b.id);
        if (o?.curse) out.add(o.curse.id);
      }
      return out;
    };
    const early = seen(1, [], 0);
    expect(early.has('boon.mending')).toBe(false);
    expect(early.has('boon.tongues')).toBe(false); // Day 2's rules: no pressing yet
    expect(seen(1, [], 1).has('boon.mending')).toBe(true);
    const later = seen(4, [pick(1, 'boon.eye')], 0);
    for (const id of ['boon.linger', 'boon.hands', 'boon.bragi', 'curse.hurry', 'curse.heavy']) {
      expect(later.has(id)).toBe(false);
    }
    expect(later.has('boon.tongues')).toBe(true);
    const sunny = seen(4, [pick(1, 'curse.sun')], 0);
    for (const id of ['boon.linger', 'boon.hands', 'boon.bragi', 'curse.hurry', 'curse.heavy']) {
      expect(sunny.has(id)).toBe(true);
    }
    expect(sunny.has('curse.sun')).toBe(false);
  });

  it('never offers a curse that would end the run on the spot, nor anything past its limit', () => {
    // Two strikes of three: one fewer would end it.
    for (let i = 0; i < 40; i++) expect(endlessOffer(full, `h${i}`, 3, [], 2)?.curse?.id).not.toBe('curse.hel');
    const shielded = [pick(1, 'boon.shield')];
    for (let i = 0; i < 40; i++) {
      const o = endlessOffer(full, `h${i}`, 3, shielded, 2);
      expect(ids(o?.boons ?? [])).not.toContain('boon.shield');
    }
    expect(Array.from({ length: 40 }, (_, i) => endlessOffer(full, `h${i}`, 3, shielded, 2)?.curse?.id)).toContain(
      'curse.hel',
    );
  });

  it('runs out of curses once all are taken, and still offers boons', () => {
    const all = (full.boons ?? []).filter((b) => b.kind === 'curse').map((b, i) => pick(i + 1, b.id));
    const o = endlessOffer(full, 'e', all.length + 1, all, 0);
    expect(o?.curse).toBeNull();
    expect(o?.boons.length).toBe(BOONS_OFFERED);
  });

  it('lets a run take only what’s on the offer, once a round', () => {
    const offer = endlessOffer(full, 'e', 1, [], 0);
    const first = offer?.boons[0]?.id ?? '';
    expect(canPick(full, 'e', 1, [], 0, first)).toBe(true);
    expect(canPick(full, 'e', 1, [], 0, 'boon.linger')).toBe(false);
    expect(canPick(full, 'e', 1, [pick(1, first)], 0, first)).toBe(false);
    expect(canPick(full, 'e', 0, [], 0, first)).toBe(false);
  });

  it('keeps its promises over long runs: every pick legal, the run never ended by one, the offer never empty', () => {
    for (let n = 0; n < 12; n++) {
      const rng = new Rng(`walk${n}`);
      const seed = `endless:${n}`;
      let picks: EndlessPick[] = [];
      let strikes = 0;
      for (let round = 1; round < 40; round++) {
        const rules = runRules(full, picks);
        if (rng.chance(1, 4) && strikes + 1 < rules.strikes) strikes++;
        const offer = endlessOffer(full, seed, round, picks, strikes);
        expect(offer).not.toBeNull();
        const choices = [...(offer?.boons ?? []), ...(offer?.curse ? [offer.curse] : [])];
        const chosen = rng.pick(choices);
        expect(canPick(full, seed, round, picks, strikes, chosen.id)).toBe(true);
        picks = [...picks, pick(round, chosen.id)];
        const after = runRules(full, picks);
        expect(after.strikes).toBeGreaterThan(strikes);
        expect(picks.filter((p) => p.id === chosen.id).length).toBeLessThanOrEqual(chosen.max ?? 99);
        if (chosen.needs === 'sun') expect(rules.sun).toBe(true);
        expect(chosen.since).toBeLessThanOrEqual(endlessDay(full, round));
      }
    }
  });
});

describe('Endless as a run: the round it makes', () => {
  it('has no sun until the run takes it, then its day’s own pace for five souls', () => {
    const ctx1 = endlessContext(full, 'e', 0);
    const plain = endlessConfig(ctx1, 'e', 0, runRules(full, []), 0);
    expect(plain.untimed).toBe(true);
    expect(plain.mods).toEqual({ hints: 0 });
    const sun = runRules(full, [pick(1, 'curse.sun')]);
    expect(roundSunS(ctx1, sun)).toBe(300); // Day 1: 360 s for 6 souls
    expect(roundSunS(endlessContext(full, 'e', 19), sun)).toBe(250); // Day 20: 1,100 s for 20-24
    const cfg = endlessConfig(ctx1, 'e', 0, sun, 0);
    expect(cfg.untimed).toBeUndefined();
    expect(cfg.sunS).toBe(300);
    const { state } = startShift(full, cfg, endlessRound(full, 'e', 0).cases, ctx1);
    expect(state.sunMs).toBe(300_000);
  });

  it('cuts and lengthens the sun, and changes what the tools and questions cost', () => {
    const ctx = endlessContext(full, 'e', 7); // Day 8: every tool
    const rules = runRules(full, [
      pick(1, 'curse.sun'),
      pick(2, 'curse.hurry'),
      pick(3, 'boon.linger'),
      pick(4, 'boon.hands'),
      pick(5, 'boon.bragi'),
    ]);
    const cfg = endlessConfig(ctx, 'e', 7, rules, 0);
    expect(cfg.sunS).toBe(Math.floor((roundSunS(ctx, runRules(full, [pick(1, 'curse.sun')])) * 75) / 100));
    expect(cfg.mods).toMatchObject({
      sunS: 60,
      freeQuestions: 2,
      toolCostS: { flip: 1, feather: 5, registry: 2, runeLens: 4, clippers: 1 },
    });
    const { state } = startShift(full, cfg, endlessRound(full, 'e', 7).cases, ctx);
    expect(state.sunMs).toBe(((cfg.sunS ?? 0) + 60) * 1000);
  });

  it('never makes a round shorter than two minutes of sun', () => {
    const rules = runRules(full, [pick(1, 'curse.sun'), pick(2, 'curse.hurry')]);
    for (let round = 0; round < 22; round++) {
      expect(roundSunS(endlessContext(full, 'e', round), rules)).toBeGreaterThanOrEqual(120);
    }
  });

  it('never changes the souls: a round’s are its seed’s and its round’s, whatever the run took', () => {
    const every = (full.boons ?? []).map((b, i) => pick(i + 1, b.id));
    for (const round of [0, 3, 11, 19, 24]) {
      const ctx = endlessContext(full, 'e', round);
      const r = endlessRound(full, 'e', round);
      const bare = startShift(full, endlessConfig(ctx, 'e', round, runRules(full, []), 0), r.cases, ctx).state;
      const loaded = startShift(full, endlessConfig(ctx, 'e', round, runRules(full, every), 9), r.cases, ctx).state;
      expect(loaded.cases).toEqual(bare.cases);
      expect(loaded.config.seed).toBe(bare.config.seed);
    }
  });

  it('gives the run’s hints, and no more', () => {
    const ctx = endlessContext(full, 'e', 2);
    const cfg = endlessConfig(ctx, 'e', 2, runRules(full, [pick(1, 'boon.eye')]), 1);
    const { state } = startShift(full, cfg, endlessRound(full, 'e', 2).cases, ctx);
    let st = stepShift(state, { t: 'begin', at: 0 }, ctx).state;
    expect(hintsLeft(st)).toBe(1);
    const first = stepShift(st, { t: 'hint', at: 1 }, ctx);
    expect(first.events.map((e) => e.e)).toEqual(['hint']);
    st = first.state;
    expect(hintsLeft(st)).toBe(0);
    const second = stepShift(st, { t: 'hint', at: 2 }, ctx);
    expect(second.events).toEqual([{ e: 'rejected', reason: 'no hints left' }]);
    // Other shifts have no limit, as before.
    expect(hintsLeft(startShift(full, { mode: 'practice', seed: 'p', day: 2 }).state)).toBeUndefined();
  });

  it('lets each soul be pressed more with loose tongues', () => {
    const ctx = endlessContext(full, 'e', 4);
    const r = endlessRound(full, 'e', 4);
    const plain = startShift(full, endlessConfig(ctx, 'e', 4, runRules(full, []), 0), r.cases, ctx).state;
    const loose = startShift(
      full,
      endlessConfig(ctx, 'e', 4, runRules(full, [pick(3, 'boon.tongues')]), 0),
      r.cases,
      ctx,
    ).state;
    const begin = (s: typeof plain) => stepShift(s, { t: 'begin', at: 0 }, ctx).state;
    expect(patienceLeft(begin(loose), ctx)).toBe(patienceLeft(begin(plain), ctx) + 1);
  });
});

describe('Endless as a run: the score', () => {
  const verdict = (correct: boolean, caught: number): Verdict => ({
    index: 0,
    stamped: 'HEL',
    expected: correct ? 'HEL' : 'VALHALLA',
    rule: 'r',
    correct,
    missed: [],
    caught,
    lies: caught,
    atMs: 0,
  });
  const judged = (correct: boolean, caught = 0): ShiftEvent => ({ e: 'judged', verdict: verdict(correct, caught) });

  it('scores a soul judged rightly its worth, and the bounty when its lie was caught first', () => {
    const rules = runRules(full, [pick(1, 'curse.sun'), pick(2, 'boon.bounty'), pick(3, 'curse.tyr')]);
    expect(tallyEvent(rules, judged(true))).toEqual({ right: 1, points: 3, strikes: 0, hints: 0 });
    expect(tallyEvent(rules, judged(true, 1))).toEqual({ right: 1, points: 4, strikes: 0, hints: 0 });
    expect(tallyEvent(rules, judged(false, 1))).toEqual({ right: 0, points: 0, strikes: 1, hints: 0 });
  });

  it('makes a Compare that finds nothing a strike only under Týr’s oath', () => {
    const miss: ShiftEvent = { e: 'noConflict', a: 'x', b: 'y', penaltyMs: 10_000 };
    expect(tallyEvent(runRules(full, []), miss)).toBeNull();
    expect(tallyEvent(runRules(full, [pick(1, 'curse.tyr')]), miss)).toEqual({
      right: 0,
      points: 0,
      strikes: 1,
      hints: 0,
    });
  });

  it('counts the hints used, and nothing for other events', () => {
    const rules = runRules(full, []);
    expect(tallyEvent(rules, { e: 'hint', field: 'f', penaltyMs: 0 })).toEqual({
      right: 0,
      points: 0,
      strikes: 0,
      hints: 1,
    });
    expect(tallyEvent(rules, { e: 'begun' })).toBeNull();
    expect(tallyEvent(rules, { e: 'done', endedBy: 'dusk' })).toBeNull();
  });

  it('shares the score and the curses when the run has them, and reads as before when it hasn’t', () => {
    const base = { title: 'T', label: 'Endless #91', genVersion: 1, judged: 23, round: 8, day: 9 };
    expect(endlessShareText(base)).toBe("T · Endless #91 (g1)\n23 souls judged rightly · round 9, Day 9's rules");
    expect(endlessShareText({ ...base, score: 41, curses: 2, assists: { tracker: true } })).toBe(
      "T · Endless #91 (g1)\nScore 41 · 23 souls judged rightly · round 9, Day 9's rules · 2 curses, rule tracker",
    );
    expect(endlessShareText({ ...base, score: 23, curses: 0 })).toBe(
      "T · Endless #91 (g1)\nScore 23 · 23 souls judged rightly · round 9, Day 9's rules",
    );
  });
});
