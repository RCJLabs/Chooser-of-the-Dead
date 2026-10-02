import {
  completeTruth,
  type DayCtx,
  type Destination,
  eval2,
  type Field,
  factsIn,
  isPerceivable,
  judge,
  type ObsPattern,
  showsForgery,
  type Truth,
  type Value,
} from '@cots/engine';

export type OracleResult =
  | { readonly kind: 'determined'; readonly dest: Destination }
  | { readonly kind: 'undetermined' };

function obsMatches(p: ObsPattern, seen: ReadonlyMap<string, Value>): boolean {
  if ('all' in p) return p.all.every((q) => obsMatches(q, seen));
  const v = seen.get(p.obs);
  if (v === undefined) return false;
  return 'is' in p ? v === p.is : p.in.includes(v);
}

/** A constraint on whole worlds, and the open facts it reads (derived facts count as what they're made of). */
interface Check {
  readonly on: ReadonlySet<string>;
  readonly holds: (t: Truth) => boolean;
}

const UNDETERMINED: OracleResult = { kind: 'undetermined' };

/**
 * Brute force over every world the evidence allows, with the same answer as
 * `oracleSolveReference` (the definition) but without enumerating facts that
 * can't change it. Independent of the solver's propagation logic.
 *
 * - Constraints on one fact (what the body shows, a sign read through a law,
 *   what a raven says) narrow that fact before anything is enumerated.
 * - Open facts that constrain each other, through a fact law, a derived fact
 *   or lines of one saga tally, form a group. Groups are independent, so the
 *   worlds are every combination of each group's own worlds.
 * - The rules read one group (their facts are joined): only that group is
 *   enumerated, pruning a branch as soon as a law it has settled fails. Any
 *   other group only has to have some world, or there are no worlds at all.
 * - The tally, presumptions and the destination then work on that group's
 *   worlds exactly as the reference does on whole worlds.
 */
export function oracleSolve(fields: readonly Field[], ctx: DayCtx): OracleResult {
  const perceived = fields.filter((f) => isPerceivable(f, ctx));
  const seen = new Map<string, Value>();
  const direct = new Map<string, Value>();
  for (const f of perceived) {
    if (!f.obs) continue;
    seen.set(f.obs.key, f.obs.value);
    const def = ctx.observationByKey.get(f.obs.key);
    if (def && 'fact' in def.from) direct.set(def.from.fact, f.obs.value);
  }
  const says = (f: Field) => f.says as { readonly fact: string; readonly value: Value };
  const statements = perceived
    .filter((f) => (f.item === 'huginn' || f.item === 'muninn') && f.says && f.says.value !== null)
    .map(says);
  // A tell under the lens, or a botched kenning (docs/tech-spec.md §77).
  const forgerySeen = perceived.some(showsForgery);
  const carved = forgerySeen
    ? []
    : perceived.filter((f) => f.item === 'tally' && f.says && f.says.value !== null).map(says);

  // Pinned facts are constants; every other sampled fact is open, with the values still possible.
  const base: Record<string, Value> = {};
  const domain = new Map<string, Value[]>();
  for (const id of ctx.sampled) {
    const af = ctx.facts.get(id);
    if (!af) continue;
    if (af.pinned) base[id] = af.values[0] as Value;
    // A fact only a party sets (docs/tech-spec.md §70) is certainly its inert value for a soul judged on its own.
    else if (af.def.fromParty) base[id] = af.def.inert;
    else domain.set(id, direct.has(id) ? af.values.filter((v) => v === direct.get(id)) : af.values.slice());
  }

  /** The open facts a fact's value rests on: itself, or what a derived fact is computed from. */
  const roots = (fact: string, out: Set<string> = new Set()): Set<string> => {
    const def = ctx.facts.get(fact)?.def;
    if (def?.derived) for (const f of factsIn(def.derived, ctx)) roots(f, out);
    else if (domain.has(fact)) out.add(fact);
    return out;
  };

  let impossible = false;
  const checks: Check[] = [];
  /** A constraint on one fact: narrows an open fact, tests a constant, or checks a derived fact per world. */
  const constrain = (fact: string, allowed: readonly Value[]): void => {
    const af = ctx.facts.get(fact);
    if (!af) impossible = true;
    else if (af.def.derived) checks.push({ on: roots(fact), holds: (t) => allowed.includes(t[fact] as Value) });
    else if (af.pinned) impossible ||= !allowed.includes(af.values[0] as Value);
    else if (af.def.fromParty) impossible ||= !allowed.includes(af.def.inert);
    else
      domain.set(
        fact,
        (domain.get(fact) ?? []).filter((v) => allowed.includes(v)),
      );
  };
  for (const law of ctx.signLaws) if (obsMatches(law.if, seen)) constrain(law.then.fact, law.then.in);
  for (const s of statements) constrain(s.fact, [s.value]);
  for (const law of ctx.factLaws) {
    const on = roots(law.then.fact);
    for (const f of factsIn(law.if, ctx)) roots(f, on);
    checks.push({ on, holds: (t) => !eval2(law.if, t, ctx) || law.then.in.includes(t[law.then.fact] as Value) });
  }
  // What the soul claims, aloud or on its tally. Whether it lied is decided from these below, so a liar fact
  // (Day 16) only joins the claims' facts into one group here.
  const claims = perceived
    .filter((f) => (f.item === 'testimony' || f.item === 'tally') && f.says && f.says.value !== null)
    .map(says);
  const liars = [...ctx.facts].filter(([, af]) => af.def.fromLies && !af.pinned).map(([id]) => id);
  for (const id of liars) {
    const on = roots(id);
    for (const c of claims) roots(c.fact, on);
    checks.push({ on, holds: () => true });
  }
  if (impossible || [...domain.values()].some((d) => d.length === 0)) return UNDETERMINED;

  // Group the open facts: union-find, joining the facts of each check, of the tally and of the rules.
  const parent = new Map<string, string>([...domain.keys()].map((f) => [f, f]));
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r) as string;
    return r;
  };
  const join = (facts: Iterable<string>): void => {
    let first: string | undefined;
    for (const f of facts) {
      if (first === undefined) first = f;
      else parent.set(find(f), find(first));
    }
  };
  for (const c of checks) join(c.on);
  const tallyOn = new Set<string>();
  for (const line of carved) roots(line.fact, tallyOn);
  join(tallyOn);
  const judged = new Set<string>();
  for (const r of ctx.rules) for (const f of factsIn(r.when, ctx)) roots(f, judged);
  join(judged);
  const groupOf = (facts: ReadonlySet<string>): string | undefined => {
    for (const f of facts) return find(f);
    return undefined;
  };

  // Every open fact at its first possible value: a stand-in for facts outside the group being enumerated.
  const fill: Record<string, Value> = { ...base };
  for (const [f, d] of domain) fill[f] = d[0] as Value;
  // Checks on constants alone hold in every world or in none.
  if (checks.some((c) => c.on.size === 0 && !c.holds(completeTruth(fill, ctx)))) return UNDETERMINED;

  /** Enumerates one group's facts, pruning each branch at the first check it settles that fails. */
  const worldsOf = (facts: readonly string[], own: readonly Check[], firstOnly: boolean): Truth[] => {
    const at = new Map(facts.map((f, i) => [f, i]));
    const byDepth: Check[][] = facts.map(() => []);
    for (const c of own) {
      let last = 0;
      for (const f of c.on) last = Math.max(last, at.get(f) ?? 0);
      byDepth[last]?.push(c);
    }
    const out: Truth[] = [];
    const truth: Record<string, Value> = { ...fill };
    const visit = (i: number): boolean => {
      if (i === facts.length) {
        out.push(completeTruth(truth, ctx));
        return firstOnly;
      }
      const f = facts[i] as string;
      for (const v of domain.get(f) ?? []) {
        truth[f] = v;
        const due = byDepth[i] ?? [];
        if (due.length > 0) {
          const t = completeTruth(truth, ctx);
          if (!due.every((c) => c.holds(t))) continue;
        }
        if (visit(i + 1)) return true;
      }
      truth[f] = fill[f] as Value;
      return false;
    };
    visit(0);
    return out;
  };

  const groups = new Map<string, string[]>();
  for (const f of domain.keys()) {
    const g = find(f);
    const list = groups.get(g);
    if (list) list.push(f);
    else groups.set(g, [f]);
  }
  const ruled = groupOf(judged);
  const ownChecks = (g: string) => checks.filter((c) => groupOf(c.on) === g);
  for (const [g, facts] of groups) {
    if (g === ruled) continue;
    const own = ownChecks(g);
    if (own.length > 0 && worldsOf(facts, own, true).length === 0) return UNDETERMINED;
  }

  let worlds =
    ruled === undefined ? [completeTruth(fill, ctx)] : worldsOf(groups.get(ruled) ?? [], ownChecks(ruled), false);

  // A saga tally narrows the worlds if all its lines can be true together; otherwise it counts for nothing.
  if (carved.length > 0 && ruled !== undefined && groupOf(tallyOn) === ruled) {
    const agree = worlds.filter((t) => carved.every((line) => t[line.fact] === line.value));
    if (agree.length > 0) worlds = agree;
  }
  // A liar (Day 16) is a soul the evidence proves lied: a tally known to be forged, or claims false in every
  // world the evidence allows (claims that can't all be true together count). Nothing else makes one, not
  // even another presumption: until a lie is caught, the soul is honest.
  const proven = forgerySeen || worlds.every((t) => claims.some((c) => t[c.fact] !== c.value));
  for (const id of liars) if (find(id) === ruled) worlds = worlds.filter((t) => t[id] === proven);
  // Presumptions fill facts nothing constrains (only the rules' group can change the destination).
  for (const [id, af] of ctx.facts) {
    const p = af.def.presumption;
    if (p === undefined || af.def.derived || af.pinned || !domain.has(id) || find(id) !== ruled) continue;
    const values = new Set(worlds.map((t) => t[id]));
    if (values.size === af.values.length) worlds = worlds.filter((t) => t[id] === p);
  }
  if (worlds.length === 0) return UNDETERMINED;
  const dests = new Set(worlds.map((t) => judge(t, ctx).dest));
  if (dests.size !== 1) return UNDETERMINED;
  return { kind: 'determined', dest: [...dests][0] as Destination };
}
