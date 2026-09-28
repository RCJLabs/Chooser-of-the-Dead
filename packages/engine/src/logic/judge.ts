import { type Destination, type ObservationDef, ruleDest, type Value } from '../content/types';
import type { DayCtx } from './context';
import { eval2, type Truth } from './pred';

export interface Judgment {
  readonly dest: Destination;
  readonly rule: string;
  /** Procedures the soul needs before it goes (absent when none, so older cases keep their shape). */
  readonly procedures?: readonly string[];
}

/**
 * The correct judgment for a complete truth: the first rule in force that holds, plus any procedures due. A rule whose
 * hall is named by a fact (docs/tech-spec.md §70) holds only where the fact names one.
 */
export function judge(truth: Truth, ctx: DayCtx): Judgment {
  for (const r of ctx.rules) {
    if (!eval2(r.when, truth, ctx)) continue;
    const dest = ruleDest(r, (f) => truth[f]);
    if (dest === undefined) continue;
    const procedures = ctx.procedures.filter((p) => eval2(p.when, truth, ctx)).map((p) => p.id);
    return { dest, rule: r.id, ...(procedures.length > 0 ? { procedures } : {}) };
  }
  throw new Error(`The rulebook for day ${ctx.day} has no rule that always applies`);
}

/** Same destination and same procedures (in rulebook order). */
export function sameJudgment(
  a: { readonly dest: Destination; readonly procedures?: readonly string[] },
  b: { readonly dest: Destination; readonly procedures?: readonly string[] },
): boolean {
  const pa = a.procedures ?? [];
  const pb = b.procedures ?? [];
  return a.dest === b.dest && pa.length === pb.length && pa.every((p, i) => p === pb[i]);
}

/** Adds derived facts (e.g. `fled`) to sampled ones, in content order. */
export function completeTruth(base: Readonly<Record<string, Value>>, ctx: DayCtx): Truth {
  const out: Record<string, Value> = { ...base };
  for (const id of ctx.derived) {
    const def = ctx.facts.get(id)?.def;
    if (def?.derived) out[id] = eval2(def.derived, out, ctx);
  }
  return out;
}

/**
 * The truth with one fact changed. Sampled facts recompute what derives from
 * them; a derived fact is overridden directly (used to ask "what if the lie
 * were true?").
 */
export function withOverride(truth: Truth, fact: string, value: Value, ctx: DayCtx): Truth {
  const def = ctx.facts.get(fact)?.def;
  if (def?.derived) return { ...truth, [fact]: value };
  const base: Record<string, Value> = {};
  for (const id of ctx.sampled) base[id] = truth[id] as Value;
  base[fact] = value;
  return completeTruth(base, ctx);
}

/** What an observation shows for a truth. */
export function observe(obs: ObservationDef, truth: Truth, ctx: DayCtx): Value {
  if ('fact' in obs.from) return truth[obs.from.fact] as Value;
  for (const m of obs.from.map) if (eval2(m.when, truth, ctx)) return m.value;
  return obs.from.otherwise;
}
