import type { ArchetypeDef, Pred, TruthConstraint, Value } from '../content/types';
import type { DayCtx } from '../logic/context';
import { completeTruth } from '../logic/judge';
import { eval2, type Truth } from '../logic/pred';
import type { Rng } from '../rng/rng';
import { weightedPick } from './pick';

export function allows(c: TruthConstraint | undefined, v: Value): boolean {
  if (!c) return true;
  if ('is' in c) return v === c.is;
  if ('in' in c) return c.in.includes(v);
  return typeof v === 'number' && (c.gte === undefined || v >= c.gte) && (c.lte === undefined || v <= c.lte);
}

interface Requirements {
  /** Allowed values per fact, from requirements simple enough to sample directly. */
  readonly allowed: Map<string, Value[]>;
  /** Everything else, checked after sampling. */
  readonly residual: Pred[];
  readonly impossible: boolean;
}

/** Turns simple requirements (e.g. Freyja's whim) into per-fact constraints so sampling hits them directly. */
export function compileRequirements(reqs: readonly Pred[] | undefined, ctx: DayCtx): Requirements {
  const allowed = new Map<string, Value[]>();
  const residual: Pred[] = [];
  let impossible = false;

  const restrict = (fact: string, keep: (v: Value) => boolean): void => {
    const current = allowed.get(fact) ?? [...(ctx.facts.get(fact)?.values ?? [])];
    allowed.set(fact, current.filter(keep));
  };

  const add = (p: Pred, negated: boolean): void => {
    if ('param' in p || 'ref' in p) {
      const q = 'param' in p ? ctx.params[p.param] : ctx.predicates.get(p.ref);
      if (q) add(q, negated);
      else if (!negated) impossible = true; // an undefined condition is false, so requiring it can't succeed
      return;
    }
    if ('not' in p) {
      add(p.not, !negated);
      return;
    }
    if ('all' in p && !negated) {
      for (const q of p.all) add(q, false);
      return;
    }
    if ('fact' in p && !ctx.facts.get(p.fact)?.def.derived) {
      const test = (v: Value): boolean => {
        if ('is' in p) return v === p.is;
        if ('in' in p) return p.in.includes(v);
        return typeof v === 'number' && (p.gte === undefined || v >= p.gte) && (p.lte === undefined || v <= p.lte);
      };
      restrict(p.fact, negated ? (v) => !test(v) : test);
      return;
    }
    residual.push(negated ? { not: p } : p);
  };

  for (const p of reqs ?? []) add(p, false);
  return { allowed, residual, impossible };
}

export type SampleResult = { readonly ok: true; readonly truth: Truth } | { readonly ok: false; readonly why: string };

/** Samples a complete truth for an archetype, then checks world constraints and residual requirements. */
export function sampleTruth(arch: ArchetypeDef, ctx: DayCtx, rng: Rng): SampleResult {
  const reqs = compileRequirements(arch.require, ctx);
  if (reqs.impossible) return { ok: false, why: 'requirement has no definition today' };

  const base: Record<string, Value> = {};
  for (const id of ctx.sampled) {
    const af = ctx.facts.get(id);
    if (!af) continue;
    // Whether the soul lies is set once its lies are planned (see withLiars).
    if (af.def.fromLies) {
      base[id] = false;
      continue;
    }
    // Only a party sets it (docs/tech-spec.md §70), never the draw: no soul's other facts change for it.
    if (af.def.fromParty) {
      base[id] = af.def.inert;
      continue;
    }
    const req = reqs.allowed.get(id);
    const candidates = af.values.filter((v) => allows(arch.truth[id], v) && (!req || req.includes(v)));
    if (candidates.length === 0) return { ok: false, why: `no allowed value for ${id}` };
    const prior = af.def.prior;
    const weights = candidates.map((v) => (prior ? (prior[String(v)] ?? 0) : 1));
    base[id] = weightedPick(candidates, weights, rng);
  }

  const truth = completeTruth(base, ctx);
  for (const w of ctx.content.world) {
    if (eval2(w.if, truth, ctx) && !eval2(w.then, truth, ctx)) return { ok: false, why: `breaks ${w.id}` };
  }
  for (const p of reqs.residual) {
    if (!eval2(p, truth, ctx)) return { ok: false, why: 'requirement not met' };
  }
  return { ok: true, truth };
}
