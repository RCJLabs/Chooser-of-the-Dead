import { loadContent } from '@cots/testkit';
import { describe, expect, it } from 'vitest';
import type { CaseSpec } from '../gen/types';
import { type DayCtx, soulCtx } from '../logic/context';
import { isPerceivable, solve } from '../logic/solver';
import { startShift } from '../shift/shift';
import { pressAnswer, SAID, saidFrom } from './press';

const full = loadContent('dev-full');
const press = full.press;
if (!press) throw new Error('the full build has no press.yaml');

/** Every soul of each day it's taught, for a few seeds, with the rules it's judged by. */
function* souls(seeds: number): Generator<{ c: CaseSpec; ctx: DayCtx }> {
  for (let day = press?.since ?? 1; day <= 20; day++) {
    for (let i = 0; i < seeds; i++) {
      const { state, ctx } = startShift(full, { mode: 'practice', seed: `press-sweep:${day}:${i}`, day });
      for (const c of state.cases) yield { c, ctx: soulCtx(ctx, c) };
    }
  }
}

const claims = (c: CaseSpec) =>
  c.evidence.fields.filter((f) => f.item === 'testimony' && f.says !== undefined && f.says.value !== null);

describe('pressing a soul on what it said', () => {
  it('says who can be pressed, and what saidFrom reads back', () => {
    expect(saidFrom(`${SAID}testimony.2`)).toBe('testimony.2');
    expect(saidFrom('testimony.2')).toBeNull();
  });

  // The fairness of pressing (docs/tech-spec.md §66), over every claim of every soul of every day it's taught.
  it('gives way only on a lie, holds the same whether the claim is true or not, and adds nothing unfair', () => {
    const tally = { claims: 0, gave: 0, held: 0, true: 0, slips: 0 };
    for (const { c, ctx } of souls(4)) {
      const perceivable = c.evidence.fields.filter((f) => isPerceivable(f, ctx));
      for (const f of claims(c)) {
        tally.claims++;
        const a = pressAnswer(c, f.id, ctx);
        expect(a, `${c.id} ${f.id}`).not.toBeNull();
        if (!a) continue;
        const lie = c.lies.find((l) => l.field === f.id);
        if (a.gave) {
          tally.gave++;
          // Only a lie gives way, with the answer it would give questioned, and never Loki's.
          expect(lie?.onQuestion).toBe(a.kind);
          expect(a.kind).not.toBe('deflect');
          continue;
        }
        tally.held++;
        expect(a.kind).toBe('hold');
        // The same claim from a soul that isn't lying about it holds in the same words.
        if (lie) {
          const honest: CaseSpec = { ...c, lies: c.lies.filter((l) => l !== lie) };
          const same = pressAnswer(honest, f.id, ctx);
          expect(same?.template).toBe(a.template);
          expect(same?.lines).toEqual(a.lines);
        }
        const said = a.said;
        if (!said?.says || said.says.value === null) continue;
        expect(saidFrom(said.id)).toBe(f.id);
        // Nothing the soul has already spoken of.
        expect(claims(c).some((x) => x.says?.fact === said.says?.fact)).toBe(false);
        const shownFalse = (fields: typeof perceivable) =>
          solve([...fields, said], ctx).contradictions.some((x) => x.lie === said.id);
        if (c.truth[said.says.fact] === said.says.value) {
          // True: nothing the player can see can seem to show it false.
          tally.true++;
          expect(shownFalse(perceivable), `${c.id} ${said.id}`).toBe(false);
          expect(c.lies.some((l) => l.via === 'tally')).toBe(false);
        } else {
          // A slip: only a liar holding to its lie, and the body or the ravens show it false.
          tally.slips++;
          expect(lie).toBeDefined();
          expect(shownFalse(perceivable.filter((x) => x.item !== 'tally')), `${c.id} ${said.id}`).toBe(true);
          expect(shownFalse(perceivable)).toBe(true);
        }
      }
    }
    // Enough of each to mean something, and the details aren't dead content.
    expect(tally.claims).toBeGreaterThan(1000);
    expect(tally.gave).toBeGreaterThan(20);
    expect(tally.true).toBeGreaterThan(5);
    expect(tally.slips).toBeGreaterThan(5);
  });

  it('answers the same every time, and nothing for what it never said', () => {
    for (const { c, ctx } of souls(1)) {
      for (const f of claims(c)) expect(pressAnswer(c, f.id, ctx)).toEqual(pressAnswer(c, f.id, ctx));
      const body = c.evidence.fields.find((f) => f.item === 'body');
      if (body) expect(pressAnswer(c, body.id, ctx)).toBeNull();
      expect(pressAnswer(c, 'testimony.99', ctx)).toBeNull();
    }
  });

  it('keeps away from the lines used lately', () => {
    const { c, ctx } = [...souls(1)].find(({ c }) => claims(c).length > 0) ?? {};
    if (!c || !ctx) throw new Error('no soul with a claim');
    const f = claims(c)[0];
    if (!f) throw new Error('no claim');
    const first = pressAnswer(c, f.id, ctx);
    if (!first || first.gave) return;
    const again = pressAnswer(c, f.id, ctx, [first.template]);
    // Another line if there's another that fits, else the same.
    expect(again?.kind).toBe('hold');
  });
});
