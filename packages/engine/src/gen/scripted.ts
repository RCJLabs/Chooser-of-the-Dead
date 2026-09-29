import type { ArchetypeDef, ScriptedCaseDef } from '../content/types';
import type { DayCtx } from '../logic/context';
import { judge } from '../logic/judge';
import { Rng } from '../rng/rng';
import { dressCase, tierKnobs } from './generate';
import { pickLies, withLiars } from './lies';
import { sampleTruth } from './sample';
import type { CaseSpec } from './types';

/** Seeds a story soul gets before it counts as impossible (a content bug the compiler reports). */
export const SCRIPTED_ATTEMPTS = 64;

export type ScriptedResult =
  | { readonly ok: true; readonly case: CaseSpec }
  | { readonly ok: false; readonly why: string };

/**
 * The story soul `def` on this day. Its seed comes from its own id rather
 * than the run's, so it is the same soul in every run; the case id still
 * names the run. It is validated with the day's knobs, relaxed the way a
 * generated soul's second tier is (any effort, any visibility floor), since a
 * written soul sets its own difficulty.
 */
export function scriptedCase(def: ScriptedCaseDef, ctx: DayCtx, runSeed: string, procIndex: number): ScriptedResult {
  const arch: ArchetypeDef = {
    id: def.id,
    since: ctx.day,
    personas: def.personas,
    truth: def.truth,
    ...(def.require ? { require: def.require } : {}),
    lies: def.lies,
    ...(def.words ? { words: def.words } : {}),
  };
  const knobs = tierKnobs('widenBand', ctx.spec.queue.knobs);
  let why = 'no attempts';
  for (let a = 0; a < SCRIPTED_ATTEMPTS; a++) {
    const seed = `${ctx.content.genVersion}|scripted|${def.id}|${a}`;
    const rng = new Rng(seed);
    const sampled = sampleTruth(arch, ctx, rng.fork('truth'));
    if (!sampled.ok) {
      why = sampled.why;
      continue;
    }
    const planned = pickLies(arch, sampled.truth, ctx, knobs, rng.fork('lies'));
    const truth = withLiars(sampled.truth, planned, ctx);
    const expected = judge(truth, ctx);
    if (expected.dest !== def.expect) {
      why = `it would go to ${expected.dest}`;
      continue;
    }
    // A carver of the forger's trail wears the face the run gives him (docs/tech-spec.md §71).
    const look = (def.lookOf && ctx.trail?.looks[def.lookOf]) || def.look;
    const dressed = dressCase(arch, truth, expected, planned, look, def.lines ?? [], ctx, knobs, rng);
    if ('code' in dressed) {
      why = `${dressed.code}: ${dressed.detail}`;
      continue;
    }
    return {
      ok: true,
      case: {
        id: `${runSeed}:${ctx.day}:${def.id}`,
        day: ctx.day,
        procIndex,
        script: def.id,
        archetype: def.id,
        truth,
        lies: dressed.lies,
        evidence: dressed.evidence,
        expect: expected,
        meta: { seed, tier: 'scripted', ...dressed.meta, attempts: a + 1 },
      },
    };
  }
  return { ok: false, why: `story soul ${def.id} can't be made on day ${ctx.day} (last try: ${why})` };
}
