import { loadContent, oracleSolve } from '@cots/testkit';
import { describe, expect, it } from 'vitest';
import { createDayContext } from '../logic/context';
import { solve } from '../logic/solver';
import { generateDay } from './generate';
import { kenningOf, kenningsToday, skaldTally } from './kennings';
import type { CaseSpec } from './types';

/*
 * Kennings in the tallies (docs/tech-spec.md §77): from Day 18 a skald may have cut a soul's saga tally, honest or
 * forged alike, in the kennings and sayings on the rulebook's page; a forger faking a skald's hand may botch one, and
 * read, the botch gives the forgery away as a tell under the lens does.
 */

const content = loadContent('dev-full');
const SEEDS = Array.from({ length: 24 }, (_, i) => `kennings-${i}`);

function day(n: number): { cases: readonly CaseSpec[]; ctx: ReturnType<typeof createDayContext> }[] {
  return SEEDS.map((seed) => {
    const ctx = createDayContext(content, n, seed);
    return { cases: generateDay(seed, ctx).cases, ctx };
  });
}

const lines = (c: CaseSpec) => c.evidence.fields.filter((f) => f.item === 'tally' && f.says);
const forged = (c: CaseSpec) => c.evidence.fields.some((f) => f.tell !== undefined);
const strings = new Map((content.tallies ?? []).map((t) => [t.msg, t]));

describe('kennings in the tallies', () => {
  it('come on Day 18, and never before: no skald cuts a tally earlier, and the rulebook has no page', () => {
    for (const n of [11, 14, 17]) {
      for (const { cases, ctx } of day(n)) {
        expect(kenningsToday(ctx)).toBe(false);
        for (const c of cases) expect(c.evidence.fields.filter((f) => f.kenning || f.botched)).toEqual([]);
      }
    }
    for (const n of [18, 19, 20]) expect(kenningsToday(createDayContext(content, n, 'k'))).toBe(true);
  });

  it("teach on Day 18's first soul: a skald's honest tally, every line on the rulebook's page", () => {
    for (const { cases } of day(18)) {
      const first = cases[0] as CaseSpec;
      expect(first.archetype).toBe('arch.skald_saga');
      expect(forged(first)).toBe(false);
      expect(lines(first).length).toBeGreaterThan(0);
      for (const f of lines(first)) {
        const k = kenningOf(content, f);
        expect(k?.botched).toBe(false);
        expect(content.kennings?.map((x) => x.id)).toContain(f.kenning);
      }
      expect(skaldTally(first)).toBe('kennings');
    }
  });

  it("cut honest and forged tallies alike, so the carving proves nothing; only a forger's botches", () => {
    let honest = 0;
    let honestSkald = 0;
    let fakes = 0;
    let fakesSkald = 0;
    let botched = 0;
    for (const n of [18, 19, 20]) {
      for (const { cases } of day(n)) {
        // The teaching soul's tally is always a skald's: count the rest.
        for (const c of cases.filter((x) => x.archetype !== 'arch.skald_saga')) {
          const carved = lines(c);
          if (carved.length === 0) continue;
          const skald = skaldTally(c) !== null;
          if (forged(c)) {
            fakes++;
            if (skald) fakesSkald++;
          } else {
            honest++;
            if (skald) honestSkald++;
          }
          for (const f of carved.filter((x) => x.botched)) {
            botched++;
            // Only on a forged tally, a skald's line whose kenning has a forger's botch, carved in one of its words.
            expect(forged(c)).toBe(true);
            const tpl = (content.tallies ?? []).find((t) => t.botched?.includes(f.text?.msg ?? ''));
            expect(tpl?.skald).toBe(true);
            expect(f.kenning).toBe(tpl?.kenning);
            expect(strings.has(f.text?.msg ?? '')).toBe(false);
          }
        }
      }
    }
    // The day's rate (60%) for both, within what chance allows; and the botches came.
    expect(honest).toBeGreaterThan(100);
    expect(fakes).toBeGreaterThan(60);
    expect(honestSkald / honest).toBeGreaterThan(0.45);
    expect(honestSkald / honest).toBeLessThan(0.75);
    expect(fakesSkald / fakes).toBeGreaterThan(0.45);
    expect(fakesSkald / fakes).toBeLessThan(0.75);
    expect(botched).toBeGreaterThan(10);
  });

  it('read, a botched kenning shows the tally forged without the lens: not believed, and from Day 16 a liar', () => {
    let checked = 0;
    for (const { cases, ctx } of day(19)) {
      for (const c of cases) {
        const botch = c.evidence.fields.find((f) => f.botched);
        if (!botch) continue;
        // The tally's own lines, the lens unused.
        const read = lines(c);
        const believed = solve(read, ctx);
        const fact = botch.says?.fact as string;
        expect(believed.beliefs.get(fact)?.support ?? []).not.toContain(botch.id);
        expect(believed.beliefs.get('liar')).toMatchObject({ values: [true], level: 4 });
        // Without the botch seen, the same lines are believed whole, as a skald's would be.
        const unseen = read.filter((f) => f.id !== botch.id);
        if (unseen.length > 0) {
          const whole = solve(unseen, ctx);
          expect(whole.beliefs.get('liar')?.values).not.toEqual([true]);
        }
        // The oracle agrees on every soul's full evidence.
        const full = solve(c.evidence.fields, ctx).judgment;
        const oracle = oracleSolve(c.evidence.fields, ctx);
        expect(full.kind).toBe('determined');
        expect(oracle).toMatchObject({ kind: 'determined', dest: full.kind === 'determined' ? full.dest : '' });
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(3);
  });
});
