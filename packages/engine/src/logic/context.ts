import type {
  ArchetypeDef,
  Content,
  CueDef,
  DaySpec,
  Destination,
  FactDef,
  FactLaw,
  ObservationDef,
  Pred,
  ProcedureDef,
  RuleDef,
  SignLaw,
  ToolId,
  Value,
} from '../content/types';
import { ruleDests } from '../content/types';
import type { CaseSpec, ForgeryTell, Look } from '../gen/types';
import { Rng } from '../rng/rng';

export interface ActiveFact {
  readonly def: FactDef;
  /** Values possible today. Derived facts are always [false, true]. */
  readonly values: readonly Value[];
  /** Fixed for the whole day (not yet introduced, or only one value exists yet). */
  readonly pinned: boolean;
}

export interface PredCtx {
  readonly predicates: ReadonlyMap<string, Pred>;
  readonly params: Readonly<Record<string, Pred>>;
}

/** Everything the engine needs to know about one day (docs/tech-spec.md §3). */
export interface DayCtx extends PredCtx {
  readonly content: Content;
  readonly day: number;
  readonly spec: DaySpec;
  readonly facts: ReadonlyMap<string, ActiveFact>;
  /** Non-derived facts in content order: the sampling order. */
  readonly sampled: readonly string[];
  /** Derived facts in content order: the computation order. */
  readonly derived: readonly string[];
  /** Rules in force today, in evaluation order. */
  readonly rules: readonly RuleDef[];
  /** Procedures in force today, in content order. */
  readonly procedures: readonly ProcedureDef[];
  /** Which pool entry each day parameter drew (for the decree text). */
  readonly paramChoices: Readonly<Record<string, { readonly id: string; readonly text: string }>>;
  /** Observations that exist today (their tools are unlocked). */
  readonly observations: readonly ObservationDef[];
  readonly observationByKey: ReadonlyMap<string, ObservationDef>;
  readonly signLaws: readonly SignLaw[];
  readonly factLaws: readonly FactLaw[];
  readonly cues: readonly CueDef[];
  /** Unlocked tools and their sun-second cost. */
  readonly tools: ReadonlyMap<ToolId, number>;
  readonly archetypes: ReadonlyMap<string, ArchetypeDef>;
  readonly queueArchetypes: readonly { readonly def: ArchetypeDef; readonly w: number }[];
  readonly destinations: ReadonlySet<Destination>;
  /** The day's noon decree, when it has one: the day as the decree leaves it, for the souls after it. */
  readonly noon?: NoonCtx;
  /** The forger's trail on a campaign day it runs (docs/tech-spec.md §71). */
  readonly trail?: TrailCtx;
  /**
   * The guise Loki wears today (docs/tech-spec.md §80), in a build that has them: only its tell, and its laws, are in
   * force. A day made without a run's say (practice, Endless) has the first.
   */
  readonly guise?: string;
}

/** The forger's trail on a day (docs/tech-spec.md §71). */
export interface TrailCtx {
  /** The two habits every forged tally cut for the day shows one of: the carver's. */
  readonly hands: readonly ForgeryTell[];
  /** The faces the trail's story souls wear: the carver's, and the man named for it, once one is. */
  readonly looks: { readonly culprit: Look; readonly named?: Look };
}

/** A noon decree in force (docs/tech-spec.md §45). */
export interface NoonCtx {
  /** The first of the day's own souls (by its place in the generated line) made and judged under the decree. */
  readonly at: number;
  /** How many souls before the first of them the raven comes. */
  readonly notice: number;
  /** The raven's words (a string key). */
  readonly text: string;
  /** The day under the decree: the same day, with its `redraw` params drawn again (and no noon of its own). */
  readonly ctx: DayCtx;
}

/** The rules a soul is judged by: the noon decree's for one made under it (docs/tech-spec.md §45), else the day's. */
export function soulCtx(ctx: DayCtx, c: CaseSpec | undefined): DayCtx {
  return c?.noon && ctx.noon ? ctx.noon.ctx : ctx;
}

export function activeValues(def: FactDef, day: number): Value[] {
  const d = def.domain;
  if (d.kind === 'bool') return [false, true];
  if (d.kind === 'int') {
    const out: number[] = [];
    for (let v = d.min; v <= d.max; v++) out.push(v);
    return out;
  }
  return d.values.filter((v) => (def.valueSince?.[v] ?? 1) <= day);
}

const byOrder = (a: RuleDef, b: RuleDef): number => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Builds the context for `day`. Day parameters (e.g. Freyja's whim) are drawn
 * from `runSeed`. Pass `spec` to play a day's mechanics with another queue
 * (the Daily Shift uses its own spec).
 */
export function createDayContext(
  content: Content,
  day: number,
  runSeed: string,
  spec?: DaySpec,
  /** Forces a day param's choice by its id, e.g. to check a story soul under every whim. */
  choose?: Readonly<Record<string, string>>,
  /** The guise Loki wears (docs/tech-spec.md §80), by id: the campaign's first when not given. */
  guise?: string,
): DayCtx {
  const found = spec ?? content.days.find((d) => d.day === day);
  if (!found) throw new Error(`No day spec for day ${day}`);
  const ctx = buildContext(content, day, runSeed, found, choose, guise);
  const noon = found.noon;
  if (!noon) return ctx;
  // The afternoon keeps the morning's choices but for the params the decree draws again, never to the same one.
  const afternoon: Record<string, string> = {};
  for (const [name, choice] of Object.entries(ctx.paramChoices)) afternoon[name] = choice.id;
  for (const name of noon.redraw) {
    const pool = (found.params?.[name]?.pool ?? []).filter((c) => c.id !== ctx.paramChoices[name]?.id);
    // The compiler refuses a param with nothing else to draw; a build without it keeps the morning's.
    if (pool.length > 0)
      afternoon[name] = new Rng(`${content.genVersion}|${runSeed}|${day}|noon|${name}`).pick(pool).id;
  }
  const later = buildContext(content, day, runSeed, found, afternoon, guise);
  return { ...ctx, noon: { at: noon.at, notice: noon.notice, text: noon.text, ctx: later } };
}

function buildContext(
  content: Content,
  day: number,
  runSeed: string,
  spec: DaySpec,
  choose?: Readonly<Record<string, string>>,
  guise?: string,
): DayCtx {
  // Loki's tell (docs/tech-spec.md §80): the guise's own observation and laws, and no other's.
  const worn = guise ?? content.campaign?.loki?.guises[0]?.id;
  const wearing = (g: string | undefined) => g === undefined || g === worn;
  const facts = new Map<string, ActiveFact>();
  const sampled: string[] = [];
  const derived: string[] = [];
  for (const def of content.facts) {
    if (def.derived) {
      facts.set(def.id, { def, values: [false, true], pinned: false });
      derived.push(def.id);
      continue;
    }
    const values = def.since > day ? [def.inert] : activeValues(def, day);
    facts.set(def.id, { def, values, pinned: values.length === 1 });
    sampled.push(def.id);
  }

  const inForce = (since: number, until?: number) => since <= day && (until === undefined || day < until);
  const rules = content.rules.filter((r) => inForce(r.since, r.until)).sort(byOrder);
  const procedures = (content.procedures ?? []).filter((p) => inForce(p.since, p.until));

  const predicates = new Map<string, Pred>();
  for (const np of content.predicates) {
    const versions = np.versions.filter((v) => v.since <= day).sort((a, b) => a.since - b.since);
    const latest = versions[versions.length - 1];
    if (latest) predicates.set(np.id, latest.is);
  }

  const params: Record<string, Pred> = {};
  const paramChoices: Record<string, { id: string; text: string }> = {};
  for (const [name, param] of Object.entries(spec.params ?? {})) {
    const forced = choose?.[name] === undefined ? undefined : param.pool.find((c) => c.id === choose[name]);
    const choice = forced ?? new Rng(`${content.genVersion}|${runSeed}|${day}|param|${name}`).pick(param.pool);
    params[name] = choice.is;
    paramChoices[name] = { id: choice.id, text: choice.text };
  }

  const tools = new Map<ToolId, number>();
  for (const t of content.tools) if (t.since <= day) tools.set(t.id, t.cost);

  const observations = content.observations.filter(
    (o) =>
      o.since <= day &&
      (o.view !== 'back' || tools.has('flip')) &&
      (o.tool === undefined || tools.has(o.tool)) &&
      wearing(o.guise),
  );

  const archetypes = new Map(content.archetypes.map((a) => [a.id, a]));
  const queueArchetypes = spec.queue.archetypes.map(({ id, w }) => {
    const def = archetypes.get(id);
    if (!def) throw new Error(`Day ${day} uses unknown archetype "${id}"`);
    return { def, w };
  });

  return {
    content,
    day,
    spec,
    facts,
    sampled,
    derived,
    rules,
    procedures,
    predicates,
    params,
    paramChoices,
    observations,
    observationByKey: new Map(content.observations.map((o) => [o.key, o])),
    signLaws: content.signLaws.filter((l) => l.since <= day && wearing(l.guise)),
    factLaws: content.factLaws.filter((l) => l.since <= day),
    cues: content.cues.filter((c) => c.since <= day),
    tools,
    archetypes,
    queueArchetypes,
    destinations: new Set(rules.flatMap((r) => ruleDests(r, content.facts))),
    ...(worn !== undefined ? { guise: worn } : {}),
  };
}
