import {
  completeTruth,
  type DayCtx,
  type Destination,
  eval2,
  type Field,
  isPerceivable,
  judge,
  type ObsPattern,
  type Truth,
  type Value,
} from '@cots/engine';

import type { OracleResult } from './oracle';

function obsMatches(p: ObsPattern, seen: ReadonlyMap<string, Value>): boolean {
  if ('all' in p) return p.all.every((q) => obsMatches(q, seen));
  const v = seen.get(p.obs);
  if (v === undefined) return false;
  return 'is' in p ? v === p.is : p.in.includes(v);
}

/**
 * The oracle's definition, kept as the reference `oracleSolve` must match.
 * Brute force: enumerate every world consistent with what the player can
 * perceive and has been taught, let a consistent, unforged saga tally narrow
 * them, apply presumptions to facts nothing constrains, and see whether all
 * remaining worlds agree on the destination. Exact, and exponential in every
 * fact the evidence leaves open, which by Day 12 is over a second a soul.
 */
export function oracleSolveReference(fields: readonly Field[], ctx: DayCtx): OracleResult {
  const perceived = fields.filter((f) => isPerceivable(f, ctx));
  const seen = new Map<string, Value>();
  const direct = new Map<string, Value>();
  for (const f of perceived) {
    if (!f.obs) continue;
    seen.set(f.obs.key, f.obs.value);
    const def = ctx.observationByKey.get(f.obs.key);
    if (def && 'fact' in def.from) direct.set(def.from.fact, f.obs.value);
  }
  const statements = perceived.filter(
    (f) => (f.item === 'huginn' || f.item === 'muninn') && f.says && f.says.value !== null,
  );
  const forgerySeen = perceived.some((f) => f.tell !== undefined);
  // What the soul claims, aloud or on its tally: a liar (Day 16) is proven by these, below.
  const claims = perceived.filter(
    (f) => (f.item === 'testimony' || f.item === 'tally') && f.says && f.says.value !== null,
  );
  const liars = [...ctx.facts].filter(([, af]) => af.def.fromLies && !af.pinned).map(([id]) => id);

  // A fact only a party sets (docs/tech-spec.md §70) is certainly its inert value for a soul judged on its own.
  const fixed = (id: string) => ctx.facts.get(id)?.pinned || ctx.facts.get(id)?.def.fromParty === true;
  const vars = ctx.sampled.filter((id) => !fixed(id));
  const domains = vars.map((id) => {
    const all = ctx.facts.get(id)?.values ?? [];
    return direct.has(id) ? all.filter((v) => v === direct.get(id)) : all;
  });

  const consistent: Truth[] = [];
  const base: Record<string, Value> = {};
  for (const id of ctx.sampled) {
    const af = ctx.facts.get(id);
    if (af?.pinned) base[id] = af.values[0] as Value;
    else if (af?.def.fromParty) base[id] = af.def.inert;
  }
  const visit = (i: number): void => {
    if (i === vars.length) {
      const t = completeTruth(base, ctx);
      for (const law of ctx.signLaws) {
        if (obsMatches(law.if, seen) && !law.then.in.includes(t[law.then.fact] as Value)) return;
      }
      for (const law of ctx.factLaws) {
        if (eval2(law.if, t, ctx) && !law.then.in.includes(t[law.then.fact] as Value)) return;
      }
      for (const s of statements) if (t[s.says?.fact as string] !== s.says?.value) return;
      consistent.push(t);
      return;
    }
    for (const v of domains[i] ?? []) {
      base[vars[i] as string] = v;
      visit(i + 1);
    }
  };
  visit(0);

  // A saga tally narrows the worlds (it outranks presumptions) if all its lines can be true together;
  // otherwise, or once a forgery sign is seen, it counts for nothing.
  let worlds = consistent;
  const carved = forgerySeen ? [] : perceived.filter((f) => f.item === 'tally' && f.says && f.says.value !== null);
  if (carved.length > 0) {
    const agree = worlds.filter((t) => carved.every((line) => t[line.says?.fact as string] === line.says?.value));
    if (agree.length > 0) worlds = agree;
  }
  // A liar (Day 16) is a soul the evidence proves lied: a tally known to be forged, or claims false in every
  // world the evidence allows (claims that can't all be true together count). Nothing else makes one, not
  // even another presumption: until a lie is caught, the soul is honest.
  if (liars.length > 0) {
    const proven = forgerySeen || worlds.every((t) => claims.some((c) => t[c.says?.fact as string] !== c.says?.value));
    worlds = worlds.filter((t) => liars.every((id) => t[id] === proven));
  }
  for (const [id, af] of ctx.facts) {
    const p = af.def.presumption;
    if (p === undefined || af.def.derived || af.pinned) continue;
    const values = new Set(worlds.map((t) => t[id]));
    if (values.size === af.values.length) worlds = worlds.filter((t) => t[id] === p);
  }
  if (worlds.length === 0) return { kind: 'undetermined' };
  const dests = new Set(worlds.map((t) => judge(t, ctx).dest));
  if (dests.size !== 1) return { kind: 'undetermined' };
  return { kind: 'determined', dest: [...dests][0] as Destination };
}
