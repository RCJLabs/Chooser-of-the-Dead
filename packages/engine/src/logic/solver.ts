import { type Destination, isDestination, type ObsPattern, type Pred, type Value } from '../content/types';
import type { Field } from '../gen/types';
import type { DayCtx } from './context';
import { eval2, eval3, factsIn, type Tri } from './pred';

/**
 * What the player can know about a fact. Levels follow the trust ladder
 * (docs/tech-spec.md §3.1): 4 = established by a body sign, a raven or a
 * confession; 1 = presumed; 0 = unknown.
 */
export interface Belief {
  readonly values: readonly Value[];
  readonly level: number;
  /** Field ids (plus 'world' and 'q:<lie>') that established it. */
  readonly support: readonly string[];
}

export interface Contradiction {
  /** The testimony field that is shown to be false. */
  readonly lie: string;
  readonly fact: string;
  readonly against: readonly string[];
}

export type SolveJudgment =
  | {
      readonly kind: 'determined';
      readonly dest: Destination;
      readonly rule: string;
      /** Procedures known to be due (absent when none). */
      readonly procedures?: readonly string[];
    }
  | { readonly kind: 'undetermined'; readonly rule: string; readonly blocking: readonly string[] };

export interface SolveResult {
  readonly judgment: SolveJudgment;
  readonly beliefs: ReadonlyMap<string, Belief>;
  readonly contradictions: readonly Contradiction[];
  /** Established evidence that disagrees with itself. Never happens in a fair case (F2). */
  readonly conflicts: readonly { readonly fact: string; readonly support: readonly string[] }[];
  readonly rules: readonly { readonly rule: string; readonly result: Tri }[];
}

/**
 * What a soul's party settles about it (docs/tech-spec.md §70): the hall a sworn man's jarl is bound for, as far as
 * the jarl's own evidence goes. Certain (trust 4); `support` names what settled it.
 */
export interface Given {
  readonly fact: string;
  readonly values: readonly Value[];
  readonly support: readonly string[];
}

export interface SolveOptions {
  /** What questioning would reveal: lie field id -> the fact's true value. */
  readonly reveals?: ReadonlyMap<string, { readonly fact: string; readonly value: Value }>;
  /** The "trusting" bot: what the soul says (aloud or on its tally) overrides everything else. */
  readonly trustTestimony?: boolean;
  /**
   * Only what can't be wrong, for the rule tracker: no presumptions, and the saga tally isn't believed
   * (it may be forged, with the sign not yet seen). Lies caught against it still count.
   */
  readonly certainOnly?: boolean;
  /**
   * Claims the soul gave up, questioned or pressed (docs/tech-spec.md §66): each is a caught lie whatever else is
   * seen, and a confession (a value, not null) establishes the truth like a raven (trust 4).
   */
  readonly retracted?: ReadonlyMap<string, { readonly fact: string; readonly value: Value } | null>;
  /**
   * What the soul said of a companion that the companion's own evidence shows false (docs/tech-spec.md §69): each
   * claim's field id, and the companion's fields that show it (as `@<member>:<field>`). A claim among the fields
   * given is a caught lie like any other: from Day 16 it proves the soul a liar.
   */
  readonly crossCaught?: ReadonlyMap<string, readonly string[]>;
  /**
   * Facts the soul's party settles (docs/tech-spec.md §70). A fact only a party sets (`fromParty`) is otherwise
   * certainly its `inert` value: a soul no retinue brings is sworn to no one here.
   */
  readonly given?: readonly Given[];
}

export function isPerceivable(f: Field, ctx: DayCtx): boolean {
  if (f.view === 'back' && !ctx.tools.has('flip')) return false;
  if (f.tool !== undefined && !ctx.tools.has(f.tool)) return false;
  return true;
}

function union(a: readonly string[], b: readonly string[]): string[] {
  if (b.length === 0) return a.slice();
  const out = a.slice();
  for (const x of b) if (!out.includes(x)) out.push(x);
  return out;
}

type Seen = ReadonlyMap<string, { readonly value: Value; readonly field: string }>;

/**
 * What a predicate being `want` says about single facts, where it says anything definite:
 * "never fled" (fled = woundsBack >= 1, false) means woundsBack is 0.
 */
function inverse(p: Pred, want: boolean, ctx: DayCtx): { fact: string; values: Value[] }[] {
  if ('all' in p) return want || p.all.length === 1 ? p.all.flatMap((q) => inverse(q, want, ctx)) : [];
  if ('any' in p) return !want || p.any.length === 1 ? p.any.flatMap((q) => inverse(q, want, ctx)) : [];
  if ('not' in p) return inverse(p.not, !want, ctx);
  if (!('fact' in p)) return [];
  const af = ctx.facts.get(p.fact);
  if (!af || af.def.derived) return [];
  return [{ fact: p.fact, values: af.values.filter((v) => eval2(p, { [p.fact]: v }, ctx) === want) }];
}

function matchObs(p: ObsPattern, seen: Seen): string[] | null {
  if ('all' in p) {
    const ids: string[] = [];
    for (const q of p.all) {
      const r = matchObs(q, seen);
      if (!r) return null;
      ids.push(...r);
    }
    return ids;
  }
  const s = seen.get(p.obs);
  if (!s) return null;
  if ('is' in p) return s.value === p.is ? [s.field] : null;
  return p.in.includes(s.value) ? [s.field] : null;
}

/**
 * Works out the judgment from the player's point of view: only perceivable
 * fields, only taught laws, the trust ladder and presumptions. Sound but
 * conservative; the brute-force oracle in testkit checks it.
 */
export function solve(fields: readonly Field[], ctx: DayCtx, opts: SolveOptions = {}): SolveResult {
  const beliefs = new Map<string, Belief>();
  const asserted = new Map<string, Belief>(); // statements about derived facts
  const forced = new Map<string, Belief>(); // trusting bot only
  const conflicts: { fact: string; support: string[] }[] = [];

  for (const [id, af] of ctx.facts) {
    if (af.def.derived) continue;
    if (af.def.fromParty && !af.pinned) {
      const g = opts.given?.find((x) => x.fact === id);
      beliefs.set(
        id,
        g
          ? { values: af.values.filter((v) => g.values.includes(v)), level: 4, support: g.support.slice() }
          : { values: [af.def.inert], level: 4, support: ['world'] },
      );
      continue;
    }
    beliefs.set(id, { values: af.values, level: af.pinned ? 4 : 0, support: af.pinned ? ['world'] : [] });
  }

  const view = (fact: string): Belief => {
    const f = forced.get(fact);
    if (f) return f;
    const af = ctx.facts.get(fact);
    const derived = af?.def.derived;
    if (!derived) return beliefs.get(fact) ?? { values: [], level: 0, support: [] };
    const inputs = [...factsIn(derived, ctx)].map(view);
    const tri = eval3(derived, (id) => view(id).values, ctx);
    let values: Value[] = tri === 'T' ? [true] : tri === 'F' ? [false] : [false, true];
    let level = inputs.reduce((m, b) => Math.min(m, b.level), 4);
    let support = inputs.reduce<string[]>((s, b) => union(s, b.support), []);
    const a = asserted.get(fact);
    if (a) {
      const both = values.filter((v) => a.values.includes(v));
      if (both.length < values.length) {
        values = both;
        level = Math.max(level, a.level);
        support = union(support, a.support);
      }
    }
    return { values, level, support };
  };
  const valuesOf = (fact: string) => view(fact).values;

  /** Narrows a fact to `allowed`. Returns true if anything changed. */
  const narrow = (fact: string, allowed: readonly Value[], level: number, support: readonly string[]): boolean => {
    const af = ctx.facts.get(fact);
    if (!af) return false;
    const map = af.def.derived ? asserted : beliefs;
    const b = map.get(fact) ?? { values: af.values, level: 0, support: [] };
    const next = b.values.filter((v) => allowed.includes(v));
    if (next.length === 0) {
      conflicts.push({ fact, support: union(b.support, support) });
      return false;
    }
    const changed = next.length < b.values.length;
    map.set(fact, {
      values: next,
      level: Math.max(b.level, level),
      support: changed ? union(b.support, support) : b.support.slice(),
    });
    return changed;
  };

  /**
   * A statement that a fact has a value. A statement about a derived fact constrains what it's made of too
   * ("never fled" means no wound in the back), so the laws can reason from it.
   */
  const state = (fact: string, value: Value, level: number, support: readonly string[]): boolean => {
    let changed = narrow(fact, [value], level, support);
    const def = ctx.facts.get(fact)?.def;
    if (def?.derived && typeof value === 'boolean') {
      for (const c of inverse(def.derived, value, ctx)) if (narrow(c.fact, c.values, level, support)) changed = true;
    }
    return changed;
  };

  const perceived = fields.filter((f) => isPerceivable(f, ctx));
  const seen = new Map<string, { value: Value; field: string }>();
  for (const f of perceived) if (f.obs) seen.set(f.obs.key, { value: f.obs.value, field: f.id });

  // Body signs read directly (a weapon in hand is a weapon in hand).
  for (const f of perceived) {
    if (!f.obs) continue;
    const def = ctx.observationByKey.get(f.obs.key);
    if (def && 'fact' in def.from) narrow(def.from.fact, [f.obs.value], 4, [f.id]);
  }
  // Body signs read through a taught law.
  for (const law of ctx.signLaws) {
    const used = matchObs(law.if, seen);
    if (used) narrow(law.then.fact, law.then.in, 4, used);
  }
  // The ravens never lie.
  for (const f of perceived) {
    if ((f.item === 'huginn' || f.item === 'muninn') && f.says && f.says.value !== null) {
      state(f.says.fact, f.says.value, 4, [f.id]);
    }
  }
  // What the soul confessed.
  for (const [id, r] of opts.retracted ?? []) if (r) state(r.fact, r.value, 4, [`q:${id}`]);
  if (opts.trustTestimony) {
    // The trusting bot believes what the soul says and what its tally says.
    for (const f of perceived) {
      if ((f.item === 'testimony' || f.item === 'tally') && f.says && f.says.value !== null) {
        forced.set(f.says.fact, { values: [f.says.value], level: 5, support: [f.id] });
      }
    }
  }

  const propagate = (): void => {
    for (let round = 0; round < 16; round++) {
      let changed = false;
      for (const law of ctx.factLaws) {
        if (eval3(law.if, valuesOf, ctx) !== 'T') continue;
        const premises = [...factsIn(law.if, ctx)].map(view);
        const support = premises.reduce<string[]>((s, b) => union(s, b.support), []);
        // A conclusion is only as trusted as its weakest premise (a tally line counts less than a body sign).
        const level = premises.reduce((m, b) => Math.min(m, b.level), 4);
        if (narrow(law.then.fact, law.then.in, level, support)) changed = true;
      }
      if (!changed) return;
    }
  };
  propagate();

  const contradictions: Contradiction[] = [];

  // The saga tally (trust 3) is believed whole or not at all, as the decree says of a forged one.
  // A line established evidence refutes is a lie to catch; then, or once a forgery sign is seen, or if
  // its lines can't all be true together with the evidence, the tally counts for nothing.
  const carved = perceived.filter((f) => f.item === 'tally' && f.says && f.says.value !== null);
  let refuted = false;
  for (const f of carved) {
    const says = f.says as { fact: string; value: Value };
    const b = view(says.fact);
    if (b.level >= 3 && !b.values.includes(says.value)) {
      refuted = true;
      if (!opts.trustTestimony) contradictions.push({ lie: f.id, fact: says.fact, against: b.support });
    }
  }
  const forgerySeen = perceived.some((f) => f.tell !== undefined);
  if (carved.length > 0 && !refuted && !forgerySeen && !opts.trustTestimony && !opts.certainOnly) {
    const saved = { beliefs: new Map(beliefs), asserted: new Map(asserted), conflicts: conflicts.length };
    let whole = true;
    for (const f of carved) {
      const says = f.says as { fact: string; value: Value };
      const b = view(says.fact);
      if (b.level >= 3 && !b.values.includes(says.value)) whole = false;
      else {
        // So lines that can't all be true are caught.
        state(says.fact, says.value, 3, [f.id]);
        propagate();
      }
      if (!whole || conflicts.length > saved.conflicts) {
        whole = false;
        break;
      }
    }
    if (!whole) {
      beliefs.clear();
      for (const [k, v] of saved.beliefs) beliefs.set(k, v);
      asserted.clear();
      for (const [k, v] of saved.asserted) asserted.set(k, v);
      conflicts.length = saved.conflicts;
    }
  }

  if (!opts.trustTestimony) {
    for (const f of perceived) {
      if (f.item !== 'testimony' || !f.says || f.says.value === null) continue;
      const b = view(f.says.fact);
      if (b.level >= 3 && !b.values.includes(f.says.value)) {
        contradictions.push({ lie: f.id, fact: f.says.fact, against: b.support });
      }
    }
  }
  // What the soul said of a companion, shown false by the companion's own evidence.
  if (!opts.trustTestimony && opts.crossCaught) {
    for (const f of perceived) {
      const against = f.about ? opts.crossCaught.get(f.id) : undefined;
      if (f.about && against) contradictions.push({ lie: f.id, fact: f.about.fact, against });
    }
  }
  // A claim taken back is caught even when nothing seen shows it false.
  for (const id of opts.retracted?.keys() ?? []) {
    const f = perceived.find((x) => x.id === id);
    if (f?.says && f.says.value !== null && !contradictions.some((x) => x.lie === id)) {
      contradictions.push({ lie: id, fact: f.says.fact, against: [`q:${id}`] });
    }
  }

  if (opts.reveals && contradictions.length > 0) {
    let revealed = false;
    for (const c of contradictions) {
      const r = opts.reveals.get(c.lie);
      if (r && state(r.fact, r.value, 4, [`q:${c.lie}`])) revealed = true;
    }
    if (revealed) propagate();
  }

  // A caught lie, or a tally shown to be forged, proves the soul a liar (Day 16). So do claims that can't all
  // be true together ("I died in battle" and "I never fled", with no wound in front): one of them is a lie,
  // even if nothing says which. Nothing proves a soul honest: that is presumed below, like any other
  // presumption.
  if (!opts.trustTestimony && [...ctx.facts.values()].some((af) => af.def.fromLies && !af.pinned)) {
    const claims = perceived.filter(
      (f) => (f.item === 'testimony' || f.item === 'tally') && f.says && f.says.value !== null,
    );
    let clash: string[] = [];
    if (claims.length > 1 && contradictions.length === 0 && !forgerySeen) {
      const saved = { beliefs: new Map(beliefs), asserted: new Map(asserted), conflicts: conflicts.length };
      for (const f of claims) {
        const says = f.says as { fact: string; value: Value };
        state(says.fact, says.value, 3, [f.id]);
      }
      propagate();
      if (conflicts.length > saved.conflicts) clash = claims.map((f) => f.id);
      beliefs.clear();
      for (const [k, v] of saved.beliefs) beliefs.set(k, v);
      asserted.clear();
      for (const [k, v] of saved.asserted) asserted.set(k, v);
      conflicts.length = saved.conflicts;
    }
    const caught = union(
      union(
        contradictions.flatMap((c) => [c.lie, ...c.against]),
        forgerySeen ? perceived.filter((f) => f.tell !== undefined).map((f) => f.id) : [],
      ),
      clash,
    );
    if (caught.length > 0) {
      for (const [id, af] of ctx.facts) if (af.def.fromLies && !af.pinned) narrow(id, [true], 4, caught);
    }
  }

  // Presumptions fill in only what nothing else established.
  for (const [id, af] of opts.certainOnly ? [] : ctx.facts) {
    const p = af.def.presumption;
    if (p === undefined || af.def.derived) continue;
    const b = beliefs.get(id);
    if (b && b.level === 0 && b.values.includes(p)) beliefs.set(id, { values: [p], level: 1, support: [] });
  }

  const rules = ctx.rules.map((r) => ({ rule: r.id, result: eval3(r.when, valuesOf, ctx) }));
  let judgment: SolveJudgment | undefined;
  for (let i = 0; i < rules.length && !judgment; i++) {
    const r = ctx.rules[i];
    const res = rules[i];
    if (!r || !res) break;
    const then = r.then;
    if (res.result === 'T' && typeof then === 'string') judgment = { kind: 'determined', dest: then, rule: r.id };
    else if (res.result === 'T' && typeof then !== 'string') {
      // A hall named by a fact (docs/tech-spec.md §70): decided once the fact is, and no rule at all where it names none.
      const fact = then.fact;
      const halls = valuesOf(fact).filter(isDestination);
      if (halls.length === valuesOf(fact).length && halls.length === 1) {
        judgment = { kind: 'determined', dest: halls[0] as Destination, rule: r.id };
      } else if (halls.length > 0) judgment = { kind: 'undetermined', rule: r.id, blocking: [fact] };
    } else if (res.result === 'U') {
      const blocking = [...factsIn(r.when, ctx)].filter((id) => view(id).values.length > 1);
      judgment = { kind: 'undetermined', rule: r.id, blocking };
    }
  }
  if (!judgment) throw new Error(`The rulebook for day ${ctx.day} has no rule that always applies`);

  // The judgment also says which procedures are due; one the player can't settle leaves it undetermined.
  if (judgment.kind === 'determined' && ctx.procedures.length > 0) {
    const due: string[] = [];
    for (const p of ctx.procedures) {
      const res = eval3(p.when, valuesOf, ctx);
      if (res === 'T') due.push(p.id);
      else if (res === 'U') {
        const blocking = [...factsIn(p.when, ctx)].filter((id) => view(id).values.length > 1);
        judgment = { kind: 'undetermined', rule: p.id, blocking };
        break;
      }
    }
    if (judgment.kind === 'determined' && due.length > 0) judgment = { ...judgment, procedures: due };
  }

  const all = new Map<string, Belief>();
  for (const id of ctx.facts.keys()) all.set(id, view(id));
  return { judgment, beliefs: all, contradictions, conflicts, rules };
}
