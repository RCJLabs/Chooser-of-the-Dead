import { loadContent } from '@cots/testkit';
import { describe, expect, it } from 'vitest';
import { generateDay } from '../gen/generate';
import { linkParties } from '../gen/party';
import { createDayContext } from '../logic/context';
import {
  ENDLESS_SOULS,
  endlessContext,
  endlessDay,
  endlessRound,
  endlessSeed,
  endlessShareText,
  endlessSpec,
  endlessTwist,
} from './endless';
import { startShift } from './shift';

const full = loadContent('dev-full');
const demo = loadContent('web-demo');

describe('Endless', () => {
  it('walks the days in order, then stays on the last', () => {
    const days = full.days.map((d) => d.day);
    const last = Math.max(...days);
    expect(Array.from({ length: days.length }, (_, r) => endlessDay(full, r))).toEqual(days);
    expect(endlessDay(full, days.length + 5)).toBe(last);
    // The demo walks only the demo's days.
    expect([0, 1, 2, 3, 9].map((r) => endlessDay(demo, r))).toEqual([1, 2, 3, 3, 3]);
  });

  it('never brings a day’s noon decree: a round is the start of its day', () => {
    const noonDays = full.days.filter((d) => d.noon).map((d) => d.day);
    expect(noonDays.length).toBeGreaterThan(0);
    const rounds = Array.from({ length: full.days.length + 2 }, (_, r) => r).filter((r) =>
      noonDays.includes(endlessDay(full, r)),
    );
    expect(rounds.length).toBeGreaterThan(0);
    for (const r of rounds) {
      expect(endlessSpec(full, 'e', r).noon).toBeUndefined();
      expect(endlessContext(full, 'e', r).noon).toBeUndefined();
      expect(endlessRound(full, 'e', r).cases.some((c) => c.noon)).toBe(false);
    }
  });

  it('plays the start of each round’s own queue, so a day’s new rule comes first', () => {
    for (const round of [0, 7, 11, 19, 25]) {
      const r = endlessRound(full, 'e', round);
      expect(r.cases).toHaveLength(ENDLESS_SOULS);
      const ctx = endlessContext(full, 'e', round);
      // The day's first souls, with any parties its day forms among them (docs/tech-spec.md §69): the same souls, in
      // the same order.
      const plain = generateDay(r.seed, ctx).cases.slice(0, ENDLESS_SOULS);
      expect(r.cases).toEqual(linkParties(plain, ctx, r.seed));
      expect(r.cases.map((c) => c.id)).toEqual(plain.map((c) => c.id));
      const teach = ctx.spec.queue.teachFirst;
      if (teach && !r.twist) expect(r.cases[0]?.archetype).toBe(teach);
    }
  });

  it('is the same every time for a seed, and different rounds differ', () => {
    expect(endlessRound(full, 'e', 3)).toEqual(endlessRound(full, 'e', 3));
    expect(endlessRound(full, 'e', 3).seed).not.toBe(endlessRound(full, 'e', 4).seed);
  });

  it('starts a shift whose day context is the round’s', () => {
    const r = endlessRound(full, 'e', 12);
    const { state, ctx } = startShift(full, { mode: 'practice', seed: r.seed, day: r.day, untimed: true }, r.cases);
    expect(ctx.day).toBe(r.day);
    expect(ctx.params).toEqual(createDayContext(full, r.day, r.seed).params);
    expect(state.cases).toEqual(r.cases);
  });

  it('numbers the day’s run like the Daily, and shares only how many, how far and any assists', () => {
    expect(endlessSeed(41)).toBe('endless:41');
    expect(endlessShareText({ title: 'T', label: 'Endless #41', genVersion: 2, judged: 23, round: 8, day: 9 })).toBe(
      "T · Endless #41 (g2)\n23 souls judged rightly · round 9, Day 9's rules",
    );
    // An assisted run says so, as an assisted Daily does.
    expect(
      endlessShareText({
        title: 'T',
        label: 'L',
        genVersion: 1,
        judged: 1,
        round: 0,
        day: 1,
        assists: { tracker: true },
      }),
    ).toBe("T · L (g1)\n1 soul judged rightly · round 1, Day 1's rules · rule tracker");
  });
});

// These generate souls on every day a twist can come to: seconds on a busy CI runner.
describe('Endless twists', { timeout: 30_000 }, () => {
  const rounds = (n: number) => Array.from({ length: n }, (_, r) => r);

  it('come to rounds that bring nothing new: days without a teaching soul, and every round past the last day', () => {
    const twisted = rounds(26).filter((r) => endlessTwist(full, 'e', r) !== null);
    // Days 9, 19 and 20 are rounds 8, 18 and 19 (Day 18 teaches kennings: docs/tech-spec.md §77); from round 20 on,
    // every round is past Day 20.
    expect(twisted).toEqual([8, 18, 19, 20, 21, 22, 23, 24, 25]);
    expect(rounds(8).filter((r) => endlessTwist(demo, 'e', r) !== null)).toEqual([3, 4, 5, 6, 7]);
  });

  it('read their own decree, keep the day’s rules, and use only what the day has', () => {
    for (const r of [8, 18, 25, 40]) {
      const twist = endlessTwist(full, 'e', r);
      const spec = endlessSpec(full, 'e', r);
      expect(twist).not.toBeNull();
      expect(spec.decree).toBe(twist?.decree);
      expect(twist?.since).toBeLessThanOrEqual(endlessDay(full, r));
      expect(endlessContext(full, 'e', r).rules).toEqual(createDayContext(full, endlessDay(full, r), 'x').rules);
    }
    for (const r of [3, 4, 5, 6]) expect(endlessTwist(demo, 'e', r)?.since).toBeLessThanOrEqual(3);
  });

  it('don’t put the day’s teaching soul first: past Day 3, the demo’s rounds open on different souls', () => {
    expect(endlessSpec(demo, 'e', 3).queue.teachFirst).toBeUndefined();
    const first = new Set(Array.from({ length: 12 }, (_, i) => endlessRound(demo, 'e', 3 + i).cases[0]?.archetype));
    expect(first.size).toBeGreaterThan(1);
  });

  it('each makes fair souls on every day it can come to', () => {
    for (const twist of full.twists ?? []) {
      for (const day of full.days.map((d) => d.day).filter((d) => d >= twist.since)) {
        const base = full.days.find((d) => d.day === day);
        if (!base) continue;
        const spec = {
          ...base,
          decree: twist.decree,
          queue: {
            ...base.queue,
            knobs: { ...base.queue.knobs, ...twist.knobs },
            mix: { ...base.queue.mix, ...twist.mix },
          },
        };
        const seed = `twist-${twist.id}-${day}`;
        const cases = generateDay(seed, createDayContext(full, day, seed, spec)).cases;
        expect(cases.length, `${twist.id} on day ${day}`).toBeGreaterThanOrEqual(ENDLESS_SOULS);
      }
    }
  });

  it('change how the souls come', () => {
    const lies = (twisted: boolean) => {
      let n = 0;
      for (let s = 0; s < 20; s++) {
        const seed = `lies-${s}`;
        const base = full.days.find((d) => d.day === 19);
        if (!base) throw new Error('no Day 19');
        const liars = full.twists?.find((t) => t.id === 'twist.liars');
        const spec = twisted
          ? { ...base, queue: { ...base.queue, knobs: { ...base.queue.knobs, ...liars?.knobs } } }
          : base;
        for (const c of generateDay(seed, createDayContext(full, 19, seed, spec)).cases) n += c.lies.length;
      }
      return n;
    };
    expect(lies(true)).toBeGreaterThan(lies(false));
  });
});
