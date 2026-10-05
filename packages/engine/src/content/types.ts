/**
 * The content shapes the engine runs on. The content compiler validates the
 * YAML packs with zod and emits objects of exactly these shapes
 * (docs/tech-spec.md §2 and §5).
 *
 * Chances are integer percentages and weights are integers, so the engine
 * never needs floating-point math.
 */

import type { ForgeryTell, Look } from '../gen/types';

export type Value = string | number | boolean;

export type Destination = 'VALHALLA' | 'FOLKVANGR' | 'HEL' | 'RAN' | 'RETURN' | 'DETAIN' | 'TRANSFER';
export const DESTINATIONS: readonly Destination[] = [
  'VALHALLA',
  'FOLKVANGR',
  'HEL',
  'RAN',
  'RETURN',
  'DETAIN',
  'TRANSFER',
];

export type ToolId = 'flip' | 'feather' | 'registry' | 'runeLens' | 'clippers';
export type View = 'front' | 'back';
export type Salience = 1 | 2 | 3;

/** One predicate language for rules, laws, whims, archetypes and endings. */
export type Pred =
  | { readonly fact: string; readonly is: Value }
  | { readonly fact: string; readonly in: readonly Value[] }
  | { readonly fact: string; readonly gte?: number; readonly lte?: number }
  | { readonly all: readonly Pred[] }
  | { readonly any: readonly Pred[] }
  | { readonly not: Pred }
  | { readonly ref: string }
  | { readonly param: string }
  | { readonly always: true };

export type Domain =
  | { readonly kind: 'enum'; readonly values: readonly string[] }
  | { readonly kind: 'bool' }
  | { readonly kind: 'int'; readonly min: number; readonly max: number };

export interface FactDef {
  readonly id: string;
  readonly domain: Domain;
  /** Before this day the fact is pinned to `inert`, which keeps early days simple. */
  readonly since: number;
  readonly inert: Value;
  /** Enum values that only exist from a given day (e.g. drowning from day 5). */
  readonly valueSince?: Readonly<Record<string, number>>;
  /** Sampling weights keyed by String(value). Missing means uniform; 0 means "only if an archetype asks". */
  readonly prior?: Readonly<Record<string, number>>;
  /** A taught custom used when there's no evidence ("the fallen are dead"). */
  readonly presumption?: Value;
  /** Computed from other facts and never sampled. */
  readonly derived?: Pred;
  /**
   * True exactly when the soul tells a lie, aloud or on a forged tally (Day 16's liars). Never
   * sampled: the generator sets it once the soul's lies are planned. The player learns it by
   * catching a lie; until then it is presumed false.
   */
  readonly fromLies?: true;
  /**
   * Never sampled: set only by the party that brings the soul (docs/tech-spec.md §70), as a retinue sets the hall its
   * jarl is bound for on each of his sworn men. Certain for every soul: `inert`, unless its party says otherwise.
   */
  readonly fromParty?: true;
  /**
   * Words a soul's lines must use when it has this value, or claims it: `{ ulfberht: { pool.weapons: sword } }`
   * (an Ulfberht is a sword, so its owner never calls it an axe). Keyed by String(value), then pool id.
   */
  readonly words?: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

export type ObsSource =
  | { readonly fact: string }
  | { readonly map: readonly { readonly when: Pred; readonly value: Value }[]; readonly otherwise: Value };

/** Something the player can see on the body, directly or with a tool. */
export interface ObservationDef {
  readonly key: string;
  readonly view: View;
  readonly tool?: ToolId;
  readonly since: number;
  readonly salience: Salience;
  /** Sun-seconds to inspect it (tool costs are counted once, separately). */
  readonly cost: number;
  /** `{ fact }` observations read the fact directly; `map` ones need a taught sign to interpret. */
  readonly from: ObsSource;
  /** Only rendered when this holds (e.g. which hand holds the weapon). */
  readonly when?: Pred;
  /** Read from a document rather than the body: its own evidence item, shown off the body. */
  readonly doc?: 'registry';
  /** Shown only while Loki wears this guise (docs/tech-spec.md §80): his tell then, and on no other day. */
  readonly guise?: string;
}

export type ObsPattern =
  | { readonly obs: string; readonly is: Value }
  | { readonly obs: string; readonly in: readonly Value[] }
  | { readonly all: readonly ObsPattern[] };

export interface FactConstraint {
  readonly fact: string;
  readonly in: readonly Value[];
}

/** A taught sign: what an observation tells you about a fact. */
export interface SignLaw {
  readonly id: string;
  readonly since: number;
  readonly text: string;
  readonly if: ObsPattern;
  readonly then: FactConstraint;
  /** In force only while Loki wears this guise (docs/tech-spec.md §80), as the sign it reads is shown only then. */
  readonly guise?: string;
}

/** A taught custom linking facts, e.g. "no wounds means no battle death". */
export interface FactLaw {
  readonly id: string;
  readonly since: number;
  readonly text: string;
  readonly if: Pred;
  readonly then: FactConstraint;
}

/** A hint that tells a careful player to reach for a tool. It proves nothing on its own. */
export interface CueDef {
  readonly key: string;
  readonly view: View;
  readonly since: number;
  readonly salience: Salience;
  /** What it hints at: a fact's value, or a forged saga tally. */
  readonly hint: { readonly fact: string; readonly value: Value } | { readonly forgery: true };
}

/** Holds in every generated truth, on every day. */
export interface WorldConstraint {
  readonly id: string;
  readonly if: Pred;
  readonly then: Pred;
}

export interface NamedPredicate {
  readonly id: string;
  readonly versions: readonly { readonly since: number; readonly is: Pred }[];
}

/**
 * Where a rule sends a soul: a hall, or the hall a fact names (docs/tech-spec.md §70: a hearth-man goes where his jarl
 * goes, the hall his retinue sets on him).
 */
export type RuleThen = Destination | { readonly fact: string };

export interface RuleDef {
  readonly id: string;
  readonly order: number;
  readonly since: number;
  readonly until?: number;
  readonly when: Pred;
  readonly then: RuleThen;
  readonly text: string;
  /**
   * Later wordings of the same rule: from `since` on, the rulebook says `text` instead, as a later day's
   * mechanic adds to what the rule asks (Valhalla's rule adds "never fled" the day turning over is taught).
   */
  readonly texts?: readonly { readonly since: number; readonly text: string }[];
  /** Read at another place than its own, by the run's weave (docs/tech-spec.md §53). Never set in content. */
  readonly woven?: true;
}

export const isDestination = (v: unknown): v is Destination => DESTINATIONS.includes(v as Destination);

/**
 * The halls a rule can send a soul to: its own, or every hall the fact it reads can name (in the fact's order), for
 * the day's stamps and the content's checks.
 */
export function ruleDests(rule: RuleDef, facts: readonly FactDef[]): Destination[] {
  if (typeof rule.then === 'string') return [rule.then];
  const fact = (rule.then as { readonly fact: string }).fact;
  const def = facts.find((f) => f.id === fact);
  return def?.domain.kind === 'enum' ? def.domain.values.filter(isDestination) : [];
}

/** Where a rule sends a soul whose facts are `factOf`: its hall, or the hall its fact names (undefined if none). */
export function ruleDest(rule: RuleDef, factOf: (fact: string) => Value | undefined): Destination | undefined {
  if (typeof rule.then === 'string') return rule.then;
  const v = factOf(rule.then.fact);
  return isDestination(v) ? v : undefined;
}

/** How the rulebook words a rule on `day`: its latest wording by then. */
export function ruleText(rule: RuleDef, day: number): string {
  let text = rule.text;
  for (const later of rule.texts ?? []) if (later.since <= day) text = later.text;
  return text;
}

export interface ToolDef {
  readonly id: ToolId;
  readonly since: number;
  readonly cost: number;
}

export type TruthConstraint =
  | { readonly is: Value }
  | { readonly in: readonly Value[] }
  | { readonly gte?: number; readonly lte?: number };

export type QuestionKind = 'confess' | 'excuse' | 'insist' | 'deflect';
export type Motive =
  | 'wantsValhalla'
  | 'avoidHel'
  | 'hideFaith'
  | 'evadeRegistry'
  | 'mistaken'
  | 'mischief'
  /** Lies about a companion (docs/tech-spec.md §69): covering for one, or spiting one. */
  | 'loyalty'
  | 'grudge';

export interface LieSpec {
  readonly fact: string;
  readonly claim: Value;
  /** Percent chance, before the day's lieRate multiplier. */
  readonly p: number;
  readonly motive: Motive;
  /** Weights for how the soul answers when questioned. */
  readonly onQuestion: Readonly<Partial<Record<QuestionKind, number>>>;
  readonly since?: number;
  /** Carved on a forged saga tally instead of spoken (docs/tech-spec.md §3.4). */
  readonly via?: 'tally';
}

/** A line carved on a saga tally: what the soul's deeds say about one fact. */
export interface TallyTemplate {
  readonly id: string;
  readonly asserts: { readonly fact: string; readonly value: Value };
  readonly msg: string;
  readonly params?: Readonly<Record<string, string>>;
  readonly weight: number;
  /**
   * A skald's way of carving it (docs/tech-spec.md §77): a kenning or a saying, carved only on a tally a skald cut.
   * A fact a skald has no way of carving is carved plainly on the skald's tally too.
   */
  readonly skald?: true;
  /** The kenning or saying on the rulebook's page this line uses (a skald's line names one). */
  readonly kenning?: string;
  /** How a forger botches it: string keys, each a kenning that isn't on the page. */
  readonly botched?: readonly string[];
}

/** A kenning or saying on the rulebook's page (docs/tech-spec.md §77): what the skalds carve, and what it means. */
export interface KenningDef {
  readonly id: string;
  /** The kenning as carved (a string key). */
  readonly term: string;
  /** What it means (a string key). */
  readonly means: string;
}

/** A character type the generator samples souls from. */
export interface ArchetypeDef {
  readonly id: string;
  readonly since: number;
  readonly until?: number;
  readonly personas: readonly string[];
  readonly truth: Readonly<Record<string, TruthConstraint>>;
  /** Extra conditions such as Freyja's whim; simple ones become sampling constraints. */
  readonly require?: readonly Pred[];
  readonly lies: readonly LieSpec[];
  /** Words its souls' lines use, by pool (`{ pool.weapons: seax }`). A fact's own words still win. */
  readonly words?: Readonly<Record<string, string>>;
  /**
   * Its souls carry a saga tally cut by the valley's forger (docs/tech-spec.md §71): true lines about the face they
   * wear, and a forgery's tell. Loki's borrowed faces need papers.
   */
  readonly papers?: 'forged';
  /** Its souls carry an honest saga tally cut by a skald (docs/tech-spec.md §77): a day's teaching soul for kennings. */
  readonly tally?: 'skald';
}

export type SpeechSlot =
  | 'identity'
  | 'death'
  | 'weapon'
  | 'owner'
  | 'blade'
  | 'back'
  | 'oath'
  | 'creed'
  | 'guise'
  | 'flavor';

/** One slot of a soul's speech: which fact it talks about and how often. */
export interface SpeechSlotDef {
  readonly slot: SpeechSlot;
  readonly fact?: string;
  /** Percent chance the slot is spoken when the soul isn't lying about its fact. */
  readonly chance: number;
  /**
   * The chance for particular true values, by String(value): the truly baptized mention it more than
   * the heathen do, so the claim alone isn't nearly always a lie. Lies are spoken either way.
   */
  readonly chances?: Readonly<Record<string, number>>;
  readonly since: number;
}

export interface TestimonyTemplate {
  readonly id: string;
  readonly slot: SpeechSlot;
  readonly asserts?: { readonly fact: string; readonly value: Value };
  readonly personas?: readonly string[];
  readonly msg: string;
  /** Placeholder name to pool id, e.g. `{ place: pool.places }`. */
  readonly params?: Readonly<Record<string, string>>;
  readonly weight: number;
}

export interface RavenTemplate {
  readonly id: string;
  readonly raven: 'huginn' | 'muninn';
  /** Selects special lines, e.g. Muninn's `identity` or `forgot`. */
  readonly tag?: string;
  readonly asserts?: { readonly fact: string; readonly value: Value };
  readonly msg: string;
  readonly params?: Readonly<Record<string, string>>;
  readonly weight: number;
}

export interface QuestionTemplate {
  readonly id: string;
  readonly on: {
    readonly fact: string;
    readonly claimed?: Value;
    readonly truth?: readonly Value[];
    readonly persona?: readonly string[];
    readonly kind: QuestionKind;
    /** Only for lies carved on a forged tally. */
    readonly via?: 'tally';
    /** Only for lies about a companion (docs/tech-spec.md §69); its lines can name them as `{companion}`. */
    readonly about?: true;
  };
  readonly msgs: readonly string[];
  readonly weight: number;
}

/**
 * Pressing a soul on what it said before anything shows it false (`press.yaml`, docs/tech-spec.md §66): a faster,
 * riskier way to a lie than finding what shows it false, and never the only way. Never in the Daily or the primer.
 */
export interface PressDef {
  /** The first day a soul can be pressed, in practice, Endless and the campaign. */
  readonly since: number;
  /** Sun-seconds each press costs. */
  readonly cost: number;
  /** How many times a soul will be pressed before it says no more. */
  readonly patience: number;
  /** Out of 100, by how the soul talks: how often a soul pressed on its lie gives way. */
  readonly gives: Readonly<Record<string, number>>;
  /** What a soul holding to a claim can add about another fact (see `pressAnswer`). */
  readonly details: readonly PressDetail[];
}

export interface PressDetail {
  /** The claim the soul holds to. */
  readonly on: { readonly fact: string; readonly claimed: Value };
  /** What it adds. */
  readonly says: { readonly fact: string; readonly value: Value };
}

/** A pressed soul's line, holding to a claim or adding to it: never chosen by whether the claim is true. */
export interface PressTemplate {
  readonly id: string;
  readonly on: {
    readonly kind: 'hold' | 'detail';
    /** A hold's claim ('*' for any), or the fact a detail is about. */
    readonly fact: string;
    readonly value?: Value;
    readonly persona?: readonly string[];
  };
  readonly msgs: readonly string[];
  readonly weight: number;
}

export interface Knobs {
  /** Percent multiplier on archetype lie chances. */
  readonly lieRate: number;
  readonly maxLies: number;
  /** Percent chance of a misleading cue on a soul whose truth doesn't match it. */
  readonly decoyRate: number;
  /** Percent chance Huginn reports each decisive fact he has a line for. */
  readonly ravenRate: number;
  /** Percent chance Muninn forgets who the soul was. */
  readonly forgetRate: number;
  /** Allowed sun-second range for the minimal proof. */
  readonly proofCostS: readonly [number, number];
  readonly maxTools: number;
  readonly maxDocs: number;
  readonly salienceFloor: Salience;
  /** Percent chance an honest soul carries a saga tally (Day 11 on). */
  readonly tallyRate?: number;
  /**
   * Percent of saga tallies a skald cut, honest or forged alike, so the carving proves nothing (docs/tech-spec.md §77):
   * their lines are kennings and sayings where the fact has one. Never on the Daily.
   */
  readonly kennings?: number;
  /** Percent of the forged tallies a skald's hand was faked on whose kenning the forger botches. */
  readonly botch?: number;
  /** Percent chance Muninn, when he remembers the soul, also reports a decisive fact of its life (Day 13 on). */
  readonly muninnRecall?: number;
  /** Percent chance Huginn adds a true fact that doesn't decide the judgment, so the ravens can seem to disagree (Day 13 on). */
  readonly huginnAside?: number;
  /**
   * Story days: the day's souls take turns through each kind of line's variants, instead of each
   * drawing one at random, so a day repeats itself less (gen/render.ts). Never on the Daily.
   */
  readonly spreadLines?: boolean;
  /**
   * Give the day's souls build, beard and clothing from a per-day shuffle, as names are, so no two
   * look alike at a glance until the combinations run out (gen/look.ts). Never on the Daily.
   */
  readonly spreadLooks?: boolean;
}

/**
 * An Endless twist (docs/tech-spec.md §27): the decree for a round that brings nothing new (a day with no
 * teaching soul, or any round past the last day). It changes how the day's souls come, never its rules.
 */
export interface EndlessTwist {
  readonly id: string;
  /** The first day whose mechanics it needs. */
  readonly since: number;
  /** What is read out for the round, in place of the day's decree. */
  readonly decree: string;
  readonly knobs?: Partial<Knobs>;
  /** Replaces the day's share of these destinations. */
  readonly mix?: Readonly<Partial<Record<Destination, readonly [number, number]>>>;
}

/**
 * A boon or a curse (docs/tech-spec.md §68), chosen between Endless rounds: one of three boons, or the curse on offer,
 * which makes every soul after it worth one more. Neither touches a soul: they change the strikes a run can take, its
 * score, the help it has (hints, presses) and its sun, never what the souls are or what can be known about them.
 */
export interface EndlessBoon {
  readonly id: string;
  readonly kind: 'boon' | 'curse';
  /** Its name and what it does (string keys). */
  readonly name: string;
  readonly text: string;
  /** The first day whose rules a round must bring for it to be offered (pressing, say, from the day souls are pressed). */
  readonly since: number;
  /** How many times one run can take it; no limit when absent. */
  readonly max?: number;
  /** Offered only when the run has the sun (a curse brings it), or has taken a strike. */
  readonly needs?: 'sun' | 'strike';
  readonly effect: BoonEffect;
}

export type BoonEffect =
  /** Wrong stamps the run can take before it ends: more (a boon) or fewer (a curse). */
  | { readonly strikes: number }
  /** Skögul's hints for the rest of the run: Endless has none otherwise. */
  | { readonly hints: number }
  /** What a soul judged rightly scores besides its worth, when its lie was caught before the stamp. */
  | { readonly bounty: number }
  /** Presses more each soul will take. */
  | { readonly patience: number }
  /** Seconds more sun each round. */
  | { readonly sunS: number }
  /** Percent of each tool's sun cost: less is a boon, more a curse. */
  | { readonly toolPct: number }
  /** Questions each round that cost no sun: the first ones asked. */
  | { readonly freeQuestions: number }
  /** Rounds have a sun from now on: the day's own pace for their souls. */
  | { readonly sun: true }
  /** Percent of each round's sun taken away. */
  | { readonly sunCut: number }
  /** Týr's oath: a Compare that finds nothing is a strike. */
  | { readonly oath: true };

/**
 * A day event (docs/tech-spec.md §52): something that happens in the world on a day of a run, drawn from the run's
 * seed as it begins. It changes the day's line (some of its own souls don't come, others do), its sun, and that
 * night's bills and sickness; never the day's rules, and never how the day's own souls are made.
 */
export interface DayEventDef {
  readonly id: string;
  /** The first day whose mechanics it needs (a storm needs Rán). */
  readonly since: number;
  /** Its name, and what the morning says of it (string keys). */
  readonly name: string;
  readonly text: string;
  /** The day's sun, in percent of its own. */
  readonly sunPct?: number;
  /** How many of the day's own souls don't come: the last in its line, never its teaching soul. */
  readonly fewer?: number;
  /**
   * Souls it brings, placed among the day's own: `n` of kind `kind` (tried first, as a teaching soul is), each bound
   * for the first of `to` that kind can reach that day; on days from `since` and before `until`, when given.
   */
  readonly souls?: readonly EventSouls[];
  /** Tonight's bills, in percent of the day's. */
  readonly costsPct?: Readonly<Partial<Record<'hearth' | 'food' | 'medicine', number>>>;
  /** Percent chance tonight that each of the family who is well falls sick, bills paid or not. */
  readonly sickChance?: number;
}

/** Souls a day event brings (docs/tech-spec.md §52). */
export interface EventSouls {
  readonly kind: string;
  readonly to: readonly Destination[];
  readonly n: number;
  readonly since?: number;
  readonly until?: number;
}

/** The day events a run draws (docs/tech-spec.md §52). */
export interface DayEventsDef {
  /** How many a run draws: each a different event, on a different day, never two days running. */
  readonly perRun: number;
  /** The first and last days they can fall on (never a day with a noon decree). */
  readonly from: number;
  readonly to: number;
  readonly pool: readonly DayEventDef[];
}

export interface DayParam {
  readonly pool: readonly { readonly id: string; readonly text: string; readonly is: Pred }[];
}

export type Faction = 'odin' | 'freyja' | 'hel' | 'loki' | 'clerk';
export const FACTIONS: readonly Faction[] = ['odin', 'freyja', 'hel', 'loki', 'clerk'];

/** Pay and bills for one campaign day (docs/tech-spec.md §4). */
export interface Economy {
  /** Rings for each soul judged rightly. */
  readonly wage: number;
  /** Extra rings when you also caught the soul's lie before stamping. */
  readonly docBonus: number;
  /** Citations per day that cost nothing. */
  readonly warnings: number;
  /** Fines for the citations after that, the last one repeating. */
  readonly fines: readonly number[];
  /** Tonight's bills: the hearth, food per person at home, medicine per sick person. */
  readonly costs: { readonly hearth: number; readonly food: number; readonly medicine: number };
}

/**
 * What ends a lesson step (docs/tech-spec.md §25): a field looked at (its id, or `whim:<param>` for the
 * sign the day's whim reads), a tool used, the body turned over, or a lie caught.
 */
export type LessonUntil =
  | { readonly seen: string }
  | { readonly tool: ToolId }
  | { readonly flipped: true }
  | { readonly flagged: true };

/** One instruction of a lesson, shown until the player does what it asks (or presses Next). */
export interface LessonStep {
  readonly id: string;
  readonly text: string;
  /**
   * What to highlight, as the coach names it: hands, hair, face, neck, chest, back, flip, feather, registry,
   * runeLens, clippers, rules, words, ravens, tally, compare, judge, or `whim:<param>`. Several may be joined
   * with spaces.
   */
  readonly focus: string;
  /** A reading step, ended by Next. */
  readonly next?: true;
  readonly until?: LessonUntil;
}

/** The coach's lesson for a day's first soul, which teaches the day's new rule or tool. */
export interface Lesson {
  /** The primer teaches this too: a player who has played it isn't taught again. */
  readonly primer?: true;
  readonly steps: readonly LessonStep[];
}

/** The names a lesson may highlight (besides `whim:<param>`). */
export const COACH_FOCUS: readonly string[] = [
  'hands',
  'hair',
  'face',
  'neck',
  'chest',
  'back',
  'flip',
  'feather',
  'registry',
  'runeLens',
  'clippers',
  'rules',
  'words',
  'ravens',
  'tally',
  'compare',
  'judge',
];

export interface DaySpec {
  readonly day: number;
  readonly sunS: number;
  readonly decree: string;
  /** Campaign days only. */
  readonly economy?: Economy;
  /** Campaign days only: the Ink scenes played before the shift and at night. */
  readonly scenes?: { readonly morning?: string; readonly night?: string };
  readonly params?: Readonly<Record<string, DayParam>>;
  readonly queue: {
    readonly count: readonly [number, number];
    /** Archetype for the first soul of the day, to teach the new rule. */
    readonly teachFirst?: string;
    /** A fixed queue (the primer): each slot's archetype and destination, in order. Overrides count and mix. */
    readonly script?: readonly { readonly id: string; readonly dest: Destination }[];
    /** Campaign only: story souls added to the generated queue, each at its position (0-based). */
    readonly scripted?: readonly { readonly case: string; readonly at: number }[];
    /**
     * Campaign only: scenes played at the desk (docs/tech-spec.md §46), each once `at` souls have been sent, with
     * the sun held, when `when` holds as its turn comes. Their effects land at the audit.
     */
    readonly visits?: readonly DeskVisit[];
    readonly archetypes: readonly { readonly id: string; readonly w: number }[];
    /**
     * How many parties the day's line forms (docs/tech-spec.md §69): souls from one fight or one ship's crew, brought
     * together at the desk. Fewer when the line has too few souls of a kind. Never on the Daily. `lead`: a kind the
     * day's first party is of, when its souls allow (the day a retinue's rule is new, one comes: docs/tech-spec.md §70).
     */
    readonly parties?: { readonly n: readonly [number, number]; readonly lead?: string };
    /** Percent [min, max] share of the queue per destination. */
    readonly mix: Readonly<Partial<Record<Destination, readonly [number, number]>>>;
    readonly knobs: Knobs;
  };
  /** The coach's lesson for the day's first soul (the teaching one), when the day brings something new. */
  readonly lesson?: Lesson;
  /** Campaign only: a decree a raven brings at noon, changing the day's rules for the souls after it. */
  readonly noon?: NoonDecree;
}

/** Someone at the desk: an Ink scene between souls (docs/tech-spec.md §46). */
export interface DeskVisit {
  readonly scene: string;
  readonly at: number;
  readonly when?: StatePred;
}

/**
 * A noon decree (docs/tech-spec.md §45): from soul `at` of the day's own line (0-based), the day's `redraw` params
 * are drawn again, never to the same choice, and those souls are made and judged under them. A raven brings the
 * news `notice` souls earlier, so there's time to adapt.
 */
export interface NoonDecree {
  readonly at: number;
  readonly notice: number;
  readonly redraw: readonly string[];
  /** The raven's words (a string key); the new choices' own words follow them. */
  readonly text: string;
  /** Archetype for the first soul under the decree, to show the change (as `queue.teachFirst` does a day's rule). */
  readonly teach?: string;
}

/** A condition on the campaign run (endings); two-valued. Paths are listed in engine/campaign/state.ts. */
export type StatePred =
  | { readonly state: string; readonly is?: number; readonly gte?: number; readonly lte?: number }
  | { readonly all: readonly StatePred[] }
  | { readonly any: readonly StatePred[] }
  | { readonly not: StatePred };

/**
 * How a shift is being played, as achievements see it: `daily` is the day's Daily played for the record,
 * `archive` any other Daily (a past one, or today's again).
 */
export type PlayMode = 'daily' | 'archive' | 'practice' | 'endless' | 'primer' | 'campaign';

/** When an achievement is checked, and its test: a StatePred over that moment's numbers (engine/achievements.ts). */
export type AchievementWhen =
  | { readonly at: 'soul'; readonly modes: readonly PlayMode[]; readonly test: StatePred }
  | { readonly at: 'shift'; readonly modes: readonly PlayMode[]; readonly test: StatePred }
  | { readonly at: 'endless'; readonly test: StatePred }
  | { readonly at: 'run'; readonly test: StatePred }
  | { readonly at: 'ending'; readonly endings: readonly string[] };

/** Something to earn for skill or for finding something, never for grinding (docs/tech-spec.md §34). */
export interface AchievementDef {
  readonly id: string;
  /** String keys. */
  readonly title: string;
  readonly text: string;
  /** Unnamed in the gallery until it's earned: a part of the story to find. */
  readonly hidden?: boolean;
  readonly when: AchievementWhen;
}

/**
 * Something the player must do to a soul before sending it on, beyond the
 * stamp: clipping untrimmed nails under the Naglfar decree. A judgment is the
 * destination plus every procedure whose condition holds (docs/tech-spec.md §2).
 */
export interface ProcedureDef {
  readonly id: string;
  readonly since: number;
  readonly until?: number;
  readonly when: Pred;
  /** Done by using this tool on the soul. */
  readonly tool: ToolId;
  /** Rulebook line. */
  readonly text: string;
}

/**
 * A soul written for the story (docs/tech-spec.md §4, "Scripted cases"). It is
 * generated like any other soul, from its own truth constraints and lies, but
 * with a fixed identity and a seed of its own, so it is the same soul in every
 * run; then it must pass the same F1-F8 validator. The compiler proves that
 * for every day that places it.
 */
export interface ScriptedCaseDef {
  readonly id: string;
  readonly personas: readonly string[];
  readonly truth: Readonly<Record<string, TruthConstraint>>;
  readonly require?: readonly Pred[];
  readonly lies: readonly LieSpec[];
  readonly look: Look;
  /**
   * Wears the face of a carver the forger's trail names (docs/tech-spec.md §71): the one who cut the tallies
   * (`culprit`), or the man named for it at night (`named`). `look` stands in where there's no trail.
   */
  readonly lookOf?: 'culprit' | 'named';
  /** Extra lines the soul says (string keys). They claim nothing, so they can't change a judgment. */
  readonly lines?: readonly string[];
  /** Words its generated lines use, by pool: a fisherwoman's knife is a seax (`{ pool.weapons: seax }`). */
  readonly words?: Readonly<Record<string, string>>;
  /** Where the soul belongs; the compiler checks the generated case agrees. */
  readonly expect: Destination;
  /** Only in the queue when this holds as the shift begins. */
  readonly when?: StatePred;
  /** Story consequences at the audit, by the stamp used (`*` matches any stamp; unjudged souls do nothing). */
  readonly onStamp?: readonly { readonly stamped: Destination | '*'; readonly effects: readonly Effect[] }[];
  /**
   * What the soul asks for, openly, where it doesn't belong (docs/tech-spec.md §51): the stamp, and the desk's words
   * for it (a string with `{name}`). Granted, it's a mistake all the same.
   */
  readonly plea?: { readonly stamp: Destination; readonly text: string };
  /**
   * A favour the household asked of the chooser for this soul (docs/tech-spec.md §74): who at home asked, by family
   * id, and the desk's words for it while the soul is there (a string with `{name}` and `{from}`).
   */
  readonly errand?: { readonly from: string; readonly text: string };
  /**
   * What looking at the soul does to the story (docs/tech-spec.md §74), at the audit: the effects of each observation
   * seen on it before it left the desk, stamped or not.
   */
  readonly onSeen?: readonly { readonly obs: string; readonly effects: readonly Effect[] }[];
}

/** What a story scene (or a scripted soul) does to the run, applied once. */
export type Effect =
  | { readonly rings: number }
  | { readonly standing: Faction; readonly by: number }
  | { readonly flag: string; readonly set?: number; readonly inc?: number }
  /** Someone at home falls sick, gets well, or is gone (an adult dies; a child goes to relatives). */
  | { readonly family: string; readonly becomes: 'sick' | 'well' | 'gone' }
  /**
   * Seconds of sun on the next shift the run begins (docs/tech-spec.md §50): a morning scene's lands on that day's
   * shift, a night scene's on the next day's. Negative for time spent at home, at dawn.
   */
  | { readonly sun: number };

export interface FamilyDef {
  readonly id: string;
  /** String key. */
  readonly name: string;
  /** Adults can die; children fall ill or are sent away, but never die (docs/build-plan.md §1). */
  readonly adult: boolean;
  /**
   * Keeps themselves while well (docs/tech-spec.md §72): off the food bill and never hungry for want of it; sick,
   * they're fed and need medicine like anyone.
   */
  readonly ownKeep?: true;
}

/** Speed only: cheaper tools or questions, or more sun. Never changes what can be solved. */
export type UpgradeEffect =
  | { readonly tool: ToolId; readonly costS: number }
  | { readonly questionS: number }
  | { readonly sunS: number };

export interface UpgradeDef {
  readonly id: string;
  readonly name: string;
  readonly text: string;
  readonly price: number;
  readonly since: number;
  readonly effect: UpgradeEffect;
}

export interface EndingDef {
  readonly id: string;
  /** Lower orders are checked first. */
  readonly order: number;
  /** Without a condition, an ending only happens as the campaign's finale. */
  readonly when?: StatePred;
  readonly title: string;
  readonly text: string;
}

/** Standing changes for a (expected, stamped) pair; the first matching row applies. */
export interface StandingRule {
  readonly expected: Destination | '*';
  readonly stamped: Destination | '*';
  readonly fx: Readonly<Partial<Record<Faction, number>>>;
}

/**
 * The vertical slice (M5): the first days, then a jump over the unwritten
 * middle to one late day, with what the skipped days would have brought.
 */
export interface SliceDef {
  /** The last day played before the jump. */
  readonly after: number;
  /** The day jumped to; its night ends the slice with `finale`. */
  readonly day: number;
  readonly finale: string;
  /** Added to the run when it jumps: rings earned, standing moved and story flags set in the skipped days. */
  readonly preset: {
    readonly rings?: number;
    readonly standing?: Readonly<Partial<Record<Faction, number>>>;
    readonly flags?: Readonly<Record<string, number>>;
  };
}

/** The campaign's economy, family, shop and endings (the demo and campaign packs each supply part). */
export interface CampaignDef {
  /** The last playable day in this build; its night ends with `finale` unless another ending comes first. */
  readonly lastDay: number;
  readonly finale: string;
  readonly startRings: number;
  readonly family: readonly FamilyDef[];
  /** Odin's ring Draupnir drips eight rings every ninth night. */
  readonly draupnir: { readonly nights: readonly number[]; readonly rings: number };
  /** Nights ending below this many rings count as nights in debt. */
  readonly debtFloor: number;
  /** The least sun a campaign shift has in seconds, whatever a trip home at dawn takes (docs/tech-spec.md §50). */
  readonly minSunS: number;
  /**
   * Family care: nights in a row without the hearth or food before someone
   * surely falls sick; the percent chance per unmet need of falling sick sooner
   * (so skipping a night is a gamble, not free); and nights sick without
   * medicine before they're lost.
   */
  readonly care: { readonly needNights: number; readonly sickChance: number; readonly sickNights: number };
  /** The vertical slice, when this build has one. */
  readonly slice?: SliceDef;
  readonly standing: readonly StandingRule[];
  readonly shop: readonly UpgradeDef[];
  readonly endings: readonly EndingDef[];
  /** The named predicate that makes a Valhalla stamp a worthy einherjar. */
  readonly worthy: string;
  /** Who a power seems to be before the story names it (the stranger is Loki until Day 12). */
  readonly aliases?: readonly FactionAlias[];
  /** What the journal lists as still in play (Loki's deal, the ferry, the wood), in order. */
  readonly threads?: readonly ThreadDef[];
  /** Souls asking to be judged again the next morning (docs/tech-spec.md §40); none without it. */
  readonly appeals?: AppealsDef;
  /** Souls still in line at dusk wait for the next day (docs/tech-spec.md §41); without it they're gone. */
  readonly waiting?: WaitingDef;
  /** The gods' requests (docs/tech-spec.md §42); none without it. */
  readonly requests?: RequestsDef;
  /** Ordinary souls who plead for a hall where they don't belong (docs/tech-spec.md §59); none without it. */
  readonly pleas?: PleasDef;
  /**
   * Word among the dead (docs/tech-spec.md §73): how the line speaks of the chooser's mercy, and what that brings;
   * none without it.
   */
  readonly word?: WordDef;
  /** The kin of souls sent to the wrong hall, at the desk later (docs/tech-spec.md §60); none without it. */
  readonly kin?: KinDef;
  /** What each god grants while their standing is high enough (docs/tech-spec.md §43); none without it. */
  readonly favours?: readonly FavourDef[];
  /** Ranks a strong player is offered, each harder and better paid (docs/tech-spec.md §44); none without it. */
  readonly promotion?: PromotionDef;
  /** Day events a run draws as it begins (docs/tech-spec.md §52); none without it. */
  readonly events?: DayEventsDef;
  /** The Norns' weave (docs/tech-spec.md §53): the rules in another order, for a run begun woven; none without it. */
  readonly weaving?: WeavingDef;
  /**
   * The last battle (docs/tech-spec.md §54): after the last night, the hosts the run filled go to the fronts. Without
   * it, the last night ends with the finale.
   */
  readonly ragnarok?: RagnarokDef;
  /** What became of everyone, told after the ending from the run (docs/tech-spec.md §55); none without it. */
  readonly epilogue?: EpilogueDef;
  /** Arms for the last battle (docs/tech-spec.md §56): from a night on, rings buy strength at a front. */
  readonly arms?: ArmsDef;
  /** The share of an upgrade's price it sells back for, in percent (docs/tech-spec.md §56); none sell without it. */
  readonly sellBack?: number;
  /** Once a run, the night a debt would end it, someone pays it (docs/tech-spec.md §56); none without it. */
  readonly reprieve?: ReprieveDef;
  /** The forger's trail (docs/tech-spec.md §71): who cuts the forged tallies, found from marks at the desk. */
  readonly trail?: TrailDef;
  /** Who the chooser was in life (docs/tech-spec.md §72), picked for a new run; none without it. */
  readonly origins?: readonly OriginDef[];
  /** Letters from home played after the day's own scenes, on the runs they're for (docs/tech-spec.md §74). */
  readonly letters?: readonly LetterDef[];
  /**
   * Proven, not lucky (docs/tech-spec.md §76): a stamp is proven when what the player had of the soul settled it.
   * Without it, no stamp is asked for proof.
   */
  readonly proven?: ProvenDef;
  /** Vows at the cup (docs/tech-spec.md §75): one sworn at night for the next day; none without it. */
  readonly vows?: VowsDef;
  /** Tomorrow's decree, sealed (docs/tech-spec.md §79): drafts of the next day's decree on a few nights a run. */
  readonly decrees?: DecreesDef;
  /** Loki learns (docs/tech-spec.md §80): the guises he wears, each with its tell; caught, he takes the next. */
  readonly loki?: LokiDef;
}

/**
 * Loki learns (campaign.yaml `loki`, docs/tech-spec.md §80). He comes first in the first guise; the rest come in an
 * order drawn for the run. Caught on a day, he wears the next the day after (the first again after the last); missed,
 * or not met, he keeps the one that worked. Each guise's tell is the observation, and the laws, tagged with it.
 */
export interface LokiDef {
  /** The fact that is true of Loki, whatever face he wears: a soul it holds for is him. */
  readonly fact: string;
  /** The run flag that holds the guise he wears, by its place in `guises`, for scenes to read. */
  readonly flag: string;
  readonly guises: readonly GuiseDef[];
}

/** One of Loki's guises (docs/tech-spec.md §80). */
export interface GuiseDef {
  readonly id: string;
  /** String key: what he comes as ("a salmon"). */
  readonly text: string;
  /** String key: the morning's word of it, the first day he wears it. */
  readonly news: string;
}

/**
 * Tomorrow's decree, sealed (campaign.yaml `decrees`, docs/tech-spec.md §79): on `perRun` nights of a run, drawn from
 * its seed, Odin's clerks send up drafts of the next day's decree. Each draft is the day's own params (Freyja's whim,
 * Odin's claim) drawn from their pools, so each is a day the fairness checks already prove; sealing one makes it the
 * day's and does its `effects`.
 */
export interface DecreesDef {
  /** How many nights a run brings drafts. */
  readonly perRun: number;
  /** The first and last day a sealed decree can rule (their nights are the one before). */
  readonly from: number;
  readonly to: number;
  /** The drafts each such night, in order: each gets its own choice from every param's pool. */
  readonly drafts: readonly DraftDef[];
}

/** One of the night's drafts (docs/tech-spec.md §79): whose it is, and what sealing it does. */
export interface DraftDef {
  readonly id: string;
  /** String key: the draft's name ("Freyja's draft"). */
  readonly text: string;
  /** What sealing it does, as the night ends: the gods it pleases and annoys. */
  readonly effects: readonly Effect[];
}

/** Proven, not lucky (campaign.yaml `proven`, docs/tech-spec.md §76). */
export interface ProvenDef {
  /** What a lucky stamp (right, but not proven) scores in an Endless run, in place of its worth and bounty. */
  readonly luckyPoints: number;
}

/**
 * What a vow asks of its day (docs/tech-spec.md §75):
 * - `clean`: every soul judged rightly, and none left in line at dusk;
 * - `liars`: every liar the evidence exposes caught in a lie before the stamp;
 * - `proven`: no soul stamped on a guess (§76), rightly or not;
 * - `silent`: no soul questioned or pressed;
 * - `sun`: the line done with `spare` percent of the sun or more to spare;
 * - `alone`: no hint asked of Skögul (never offered under the oath, which gives none).
 */
export type VowKind = 'clean' | 'liars' | 'proven' | 'silent' | 'sun' | 'alone';

export interface VowDef {
  readonly id: string;
  readonly kind: VowKind;
  /** The first day it can be sworn for. */
  readonly since: number;
  /** Rings it pays, kept. */
  readonly rings: number;
  /** For `sun`: the percent of the day's sun to spare. */
  readonly spare?: number;
  /** String key: what's sworn. */
  readonly text: string;
}

/** Vows at the cup (campaign.yaml `vows`, docs/tech-spec.md §75). */
export interface VowsDef {
  /** The first night one is offered, for the day after it. */
  readonly from: number;
  /** How many are offered each night. */
  readonly offered: number;
  /** Standing a broken vow costs, by power. A kept one pays its rings and moves none. */
  readonly broken: Readonly<Partial<Record<Faction, number>>>;
  readonly list: readonly VowDef[];
}

/**
 * Who the chooser was in life (campaign.yaml `origins`, docs/tech-spec.md §72): a perk, someone at home because of it,
 * and scenes of its own. Picked for a new run and kept with it.
 */
export interface OriginDef {
  readonly id: string;
  /** String keys: its name, and who she was and what it gives her. */
  readonly name: string;
  readonly text: string;
  readonly perk: OriginPerk;
  /** Someone at home because of who she was, beside the rest of the family. */
  readonly member?: FamilyDef;
  /** Its own scenes, each played after the day's own morning or night scene. */
  readonly scenes: readonly OriginScene[];
}

/** What an origin gives: speed or money only, never what can be solved (docs/roadmap.md). */
export interface OriginPerk {
  /** A tool's sun cost, in seconds, in place of its own (or an upgrade's, if that's less). */
  readonly tools?: readonly { readonly tool: ToolId; readonly costS: number }[];
  /** Questions a day that cost no sun. */
  readonly freeQuestions?: number;
  /** More sun every shift. */
  readonly sunS?: number;
  /** Rings more to start with. */
  readonly startRings?: number;
  /** Percent of its price each upgrade costs. */
  readonly shopPct?: number;
}

/** One of an origin's scenes: the day, and whether it follows the morning's scene or the night's. */
export interface OriginScene {
  readonly day: number;
  readonly at: 'morning' | 'night';
  readonly scene: string;
}

/**
 * A letter from home (docs/tech-spec.md §74): a scene played after the day's own and its origin's, on the morning or
 * night of `day`, when `when` holds as its turn comes. The household's errands are asked and answered in them.
 */
export interface LetterDef {
  readonly day: number;
  readonly at: 'morning' | 'night';
  readonly scene: string;
  readonly when?: StatePred;
}

/** A carver the forger's trail can name (docs/tech-spec.md §71). */
export interface TrailSuspect {
  readonly id: string;
  /** How he looks when he comes to the desk. */
  readonly look: Look;
  /** The two habits his forged tallies give away: a forgery's tells. */
  readonly hands: readonly ForgeryTell[];
  /** How the board speaks of him (a string key). */
  readonly text: string;
}

/**
 * The forger's trail (campaign.yaml `trail`, docs/tech-spec.md §71). One of the suspects, drawn for the run, cuts every
 * forged tally from `since` on; each tally's tell, a borrowed face's papers and a gap in Muninn's memory show one of
 * his habits. On the `nights`, the chooser may name him, once.
 */
export interface TrailDef {
  readonly since: number;
  /** The hunt is on (the board shows, and he can be named) while this holds; always, without it. */
  readonly when?: StatePred;
  readonly nights: readonly number[];
  readonly suspects: readonly TrailSuspect[];
  /** What naming him does, and what naming another man does. */
  readonly right: readonly Effect[];
  readonly wrong: readonly Effect[];
  /** The board's words (string keys): its heading, what it says of the hunt, and what it says once a man is named. */
  readonly title: string;
  readonly intro: string;
  readonly named: { readonly right: string; readonly wrong: string };
}

/**
 * Arms for the last battle (docs/tech-spec.md §56). From a night on, the quartermaster sells arms for one front a
 * night; each lot adds strength at its front at Ragnarök, and costs more than the one before.
 */
export interface ArmsDef {
  /** The first night arms are for sale. */
  readonly from: number;
  /** Strength each lot adds at its front. */
  readonly strength: number;
  /** Each lot's price, in the order they're bought: when they run out, so do the arms. */
  readonly prices: readonly number[];
  /** What each front's arms are (string keys), in the order the night lists them. */
  readonly fronts: readonly { readonly front: string; readonly name: string; readonly text: string }[];
}

/**
 * A reprieve (docs/tech-spec.md §56): the first night of a run that would end it in `ending`, it doesn't. The purse is
 * set to `rings`, the nights in debt start again, and `flag` is set, for the story to remember; never under the oath.
 */
export interface ReprieveDef {
  readonly ending: string;
  readonly rings: number;
  readonly flag: string;
  /** What the next morning says of it (a string key). */
  readonly text: string;
}

/**
 * The epilogue (docs/tech-spec.md §55): after the ending's own words, a line for each of the run's people and powers,
 * read from how the run left them. Each slot says the first of its lines whose `when` holds (a line without one always
 * does); a slot none of whose lines holds says nothing.
 */
export interface EpilogueDef {
  /** The epilogue shows only while this holds, at the ending (the failures, say, have none). */
  readonly when?: StatePred;
  /** Whether its words are drafts: the screen says so. */
  readonly draft?: boolean;
  readonly slots: readonly EpilogueSlotDef[];
}

/** Where a slot's line sits on the screen: the family, the powers, the souls the run judged. */
export type EpilogueSection = 'home' | 'powers' | 'dead';

export const EPILOGUE_SECTIONS: readonly EpilogueSection[] = ['home', 'powers', 'dead'];

export interface EpilogueSlotDef {
  readonly id: string;
  readonly section: EpilogueSection;
  /** The slot is silent unless this holds. */
  readonly when?: StatePred;
  readonly lines: readonly { readonly when?: StatePred; readonly text: string }[];
}

/**
 * The last battle (docs/tech-spec.md §54). Each host is the souls sent to one hall; each front has a foe. The player
 * sets the order the fronts are held in, and each is held if the hosts can hold it along with those before it.
 */
export interface RagnarokDef {
  /** What the horn says, as the hosts wait for their fronts (a string key). */
  readonly text: string;
  readonly hosts: readonly HostDef[];
  readonly fronts: readonly FrontDef[];
  /** The chooser rides to one front of the player's choosing, with this much strength (docs/tech-spec.md §58). */
  readonly ride?: { readonly strength: number };
}

/**
 * A host: the souls sent to one hall. Those sent there rightly fight, twice as hard at the host's own front as
 * anywhere else; those sent there by mistake (for Valhalla, the unworthy) break and run, each costing that front 1.
 */
export interface HostDef {
  readonly id: string;
  /** Its name (a string key). */
  readonly name: string;
  readonly hall: Destination;
  /** Its own front. */
  readonly front: string;
  /** It fights at its own front and nowhere else (the drowned, at sea). */
  readonly only?: true;
}

export interface FrontDef {
  readonly id: string;
  /** Its name; what comes against it; and what it means that it held, or fell (string keys). */
  readonly name: string;
  readonly text: string;
  readonly held: string;
  readonly fell: string;
  /** The strength that comes against it. */
  readonly foe: number;
  /** And this much more for every soul sent on with its nails long (Naglfar's crew). */
  readonly perNail?: number;
}

/**
 * The Norns' weave (docs/tech-spec.md §53): once one of the endings `after` has been reached on the device, a new run
 * can be begun woven. It draws one of `weaves` from its seed.
 */
export interface WeavingDef {
  readonly after: readonly string[];
  readonly weaves: readonly WeaveDef[];
}

/**
 * A weave: the same rules in another order in the Order of Judgment. `order` gives rules their new places (lower is
 * read first); the rest keep theirs. It changes a day once two rules in force that day come in another order.
 */
export interface WeaveDef {
  readonly id: string;
  /** Its name, and what the morning it first changes a day says of it (string keys). */
  readonly name: string;
  readonly text: string;
  readonly order: Readonly<Record<string, number>>;
  /**
   * Souls it brings to each day from its first, in place of as many of the day's own: souls both of the rules it
   * reorders claim, which it decides (as a day event's souls come, docs/tech-spec.md §52).
   */
  readonly souls?: readonly EventSouls[];
}

/**
 * Promotion: after clean days (every soul judged rightly and none left at dusk), the next rank is offered for the
 * player to take or not. Declining costs nothing; a rank taken can be stepped down from at night.
 */
export interface PromotionDef {
  /** The first day an offer can come. */
  readonly from: number;
  /** Clean days in a row that bring an offer (the count starts again after each one). */
  readonly cleanDays: number;
  /** In order: the first is offered first, the next after it. */
  readonly ranks: readonly RankDef[];
}

export interface RankDef {
  readonly id: string;
  /** The rank's title and what it's about (string keys). */
  readonly name: string;
  readonly text: string;
  /** Souls more each day, after the day's own. */
  readonly souls: number;
  /** The change to the day's free citations (so, less than 0). */
  readonly warnings: number;
  /** Rings more for each soul judged rightly. */
  readonly wage: number;
  /** Rings to Odin each night. */
  readonly tithe: number;
}

/**
 * A god's favour: at the gate each morning, while the god's standing is `at` or more, it holds for the day and
 * its night. Like the upgrades, it gives time, information or money, never what decides a soul.
 */
export interface FavourDef {
  readonly id: string;
  readonly faction: Faction;
  /** The standing it takes. */
  readonly at: number;
  readonly effect: FavourEffect;
  /** What it does, in the god's terms (a string key). */
  readonly text: string;
}

export type FavourEffect =
  /** Extra sun for the day, in seconds. */
  | { readonly sunS: number }
  /** Questions a day that cost no sun: the first ones asked. */
  | { readonly freeQuestions: number }
  /** Percent of each fine the audit charges. */
  | { readonly finePct: number }
  /**
   * The sick at home: nights more a sick member holds out without medicine before they're lost, and the percent
   * of the usual chance of falling sick from a night's unpaid bill (0: no one falls sick by chance).
   */
  | { readonly sickNights: number; readonly sickChancePct?: number }
  /** Rings the audit pays for each soul sent on with its nails long, for the ship (docs/tech-spec.md §57). */
  | { readonly nailRings: number };

/**
 * The gods' requests: some mornings a god asks, openly, for a favour: souls that belong to another god, sent
 * their way instead. Doing it in full earns the request's reward; each soul is still sent wrong, and costs what
 * that always costs. Declining costs nothing.
 */
export interface RequestsDef {
  /** The first day a god may ask. */
  readonly from: number;
  /** Percent of mornings from then on that bring a request. */
  readonly chance: number;
  /** Percent of those when a second god asks for the same souls. */
  readonly rivals: number;
  readonly list: readonly RequestDef[];
}

export interface RequestDef {
  readonly id: string;
  /** Who asks. */
  readonly god: Faction;
  /** Souls that belong here by the day's rules, */
  readonly from: Destination;
  /** sent here instead. */
  readonly to: Destination;
  /** How many make the request done. */
  readonly n: number;
  /** What doing it in full is worth, on top of what each soul sent wrong moves. */
  readonly reward: Readonly<Partial<Record<Faction, number>>>;
  /** The first day this is asked, and the first day it no longer is (absent: to the end). */
  readonly since: number;
  readonly until?: number;
  /** What the god wants, in their words (a string key). */
  readonly text: string;
}

/**
 * Pleas from ordinary souls (docs/tech-spec.md §59). On some days from `from`, one of the day's own souls asks, openly,
 * for a hall where it doesn't belong, as a story soul can (§51). Granted, the stamp is a mistake all the same, but the
 * soul stands at Ragnarök in the hall it asked for, as a soul given to a god who asked does (§42).
 */
export interface PleasDef {
  /** The first day a soul may plead. */
  readonly from: number;
  /** Percent of days from then on when one does. */
  readonly chance: number;
  readonly list: readonly PleaDef[];
}

export interface PleaDef {
  /** Souls that belong here by the day's rules */
  readonly from: Destination;
  /** may ask to be sent here, */
  readonly to: Destination;
  /** in these words (a string key, given the soul's `name` and `gender`), */
  readonly text: string;
  /** from this day (absent: from `from`). */
  readonly since?: number;
}

/**
 * Word among the dead (campaign.yaml `word`, docs/tech-spec.md §73). Each soul's ask granted at the audit (a plea, or
 * rings offered for a stamp) moves the word a step softer, and each refused (the soul judged rightly) a step sterner,
 * between -max and max. The level it's at sets, from the next day on, how often a soul asks and how often souls lie,
 * and whether some who ask bring rings. A soul that asks and lies too is lying about why: granted, the dead find it out.
 */
export interface WordDef {
  /** How far the word goes either way. */
  readonly max: number;
  /** In order: the first level whose `upTo` the word doesn't pass holds (the last has none). */
  readonly levels: readonly WordLevel[];
  /** What souls offer for a stamp where they don't belong, on a level that brings offers. */
  readonly offers: readonly OfferDef[];
  /** A false ask granted, found out this many mornings after, in these words. */
  readonly found: { readonly after: number; readonly text: string };
}

export interface WordLevel {
  readonly id: string;
  /** The word at or below which this level holds; absent on the last. */
  readonly upTo?: number;
  /** Percent of days (from the pleas' first) when one of the day's own souls asks: the pleas' chance, at this level. */
  readonly asks: number;
  /** Percent of the day's lie rate its souls lie at. */
  readonly lies: number;
  /** Percent of those asks that come with rings instead of a plea; none when absent. */
  readonly offers?: number;
  /** String keys: the level's name, and what the line says of the chooser. */
  readonly name: string;
  readonly text: string;
}

export interface OfferDef {
  /** Souls that belong here by the day's rules */
  readonly from: Destination;
  /** may offer rings to be sent here, */
  readonly to: Destination;
  /** this many, */
  readonly rings: number;
  /** from this day (absent: the pleas' first). */
  readonly since?: number;
}

/**
 * The kin of the misjudged (docs/tech-spec.md §60). On some days from `from`, when the run has sent a soul to a hall
 * where it didn't belong at least `after` days before, one of the day's own souls is its husband, wife or cousin, and
 * says so at the desk. Unless it belongs where that soul went, it asks to go there too: a plea (§59).
 */
export interface KinDef {
  readonly from: number;
  /** Percent of days, from then on, when kin come (when there's a soul whose kin haven't come yet). */
  readonly chance: number;
  /** Days after the mistake before kin can come. */
  readonly after: number;
  /** The desk's words (a string key), given `name`, `gender`, `kin`, `kinGender`, `relation`, `hall` and `day`. */
  readonly text: string;
  /** Its plea's words (a string key), given `name`, `gender`, `dest` and `kinGender`. */
  readonly plea: string;
}

/**
 * The line at dusk: souls still waiting come back first the next day, seen afresh under its rules, in the
 * places of that day's last new souls. The living among them can't wait: they die in the night.
 */
export interface WaitingDef {
  /** The first day whose line waits for the next. */
  readonly from: number;
  /** How many left in line at dusk (the living too) make a crowded gate, which costs `night`. */
  readonly crowd: number;
  /** What a night with a crowded gate costs (once, however many more). */
  readonly night: Readonly<Partial<Record<Faction, number>>>;
  /** What each of the living who dies waiting costs. */
  readonly died: Readonly<Partial<Record<Faction, number>>>;
}

/**
 * Appeals: the morning after a day, one soul from it may ask to be judged again. Most often one sent to
 * the wrong place; sometimes one judged rightly that tries its luck, so an appeal isn't proof of a mistake.
 */
export interface AppealsDef {
  /** The first day whose verdicts can be appealed. */
  readonly from: number;
  /** Percent chance of an appeal after a day with a soul sent to the wrong place. */
  readonly afterMistake: number;
  /** Percent chance of one after a day without: a soul judged rightly tries its luck. */
  readonly otherwise: number;
  /** When there are both kinds, the percent of appeals from souls judged rightly. */
  readonly chancers: number;
  /** Rings for turning down an appeal that had no merit. */
  readonly bonus: number;
  /** Rings fined for an appeal decided wrongly. */
  readonly fine: number;
}

/** A story thread the journal lists while `when` holds. */
export interface ThreadDef {
  readonly id: string;
  readonly when: StatePred;
  /** A string key; its `{n}` is the value of `count`, when given. */
  readonly text: string;
  /** A run-state path (as endings read) whose value the text shows as `{n}`. */
  readonly count?: string;
}

/** A power's name (a string key) until the day the story gives its real one. */
export interface FactionAlias {
  readonly faction: Faction;
  readonly name: string;
  readonly untilDay: number;
}

/**
 * A kind of party (docs/tech-spec.md §69): souls from one fight or one ship's crew, who come to the desk together and
 * speak of each other.
 */
export interface PartyKindDef {
  readonly id: string;
  /** The first day parties of this kind come. */
  readonly since: number;
  /** How the desk names the party (a string key); the party's words are its params. */
  readonly title: string;
  /** Words every member's lines share, by param name (a pool id): one fight is fought at one place. */
  readonly words: Readonly<Record<string, string>>;
  /** How many souls, [min, max], at least 2. */
  readonly size: readonly [number, number];
  /** What every member's truth meets: a fight's all fell in battle. */
  readonly members: Readonly<Record<string, TruthConstraint>>;
  /** The facts a member may speak of about a companion. */
  readonly claims: readonly string[];
  readonly weight: number;
  /**
   * A retinue (docs/tech-spec.md §70): the first member is the jarl, and each of the others is sworn to him, with this
   * fact (a `fromParty` one) set to the hall the jarl is bound for. The men speak of the jarl, and he of one of them.
   */
  readonly lord?: string;
}

/** Parties (`parties.yaml`, docs/tech-spec.md §69). */
export interface PartiesDef {
  readonly kinds: readonly PartyKindDef[];
  /** Percent: how often what a member says about a companion is a lie, where a lie can be told. */
  readonly lie: number;
  /** How a soul caught lying about a companion answers questioning (weights; never insist or deflect). */
  readonly onQuestion: Readonly<Partial<Record<'confess' | 'excuse', number>>>;
}

/** What a member says about a companion (`templates/party.yaml`): `{companion}` is the companion's name. */
export interface PartyLineTemplate {
  readonly id: string;
  readonly asserts: { readonly fact: string; readonly value: Value };
  /** Only in parties of these kinds; any when absent. */
  readonly kinds?: readonly string[];
  /** In a retinue (docs/tech-spec.md §70), only said of its jarl (`lord`) or of one of his men (`sworn`); either when absent. */
  readonly of?: 'lord' | 'sworn';
  readonly personas?: readonly string[];
  readonly msg: string;
  readonly weight: number;
}

/** What the sun costs besides the tools (`sun.yaml`, docs/tech-spec.md §4, §26, §63), in seconds. */
export interface SunCosts {
  /** A Compare that finds nothing. */
  readonly badCompare: number;
  /** A Question, before upgrades make it cheaper. */
  readonly question: number;
  /** Skögul's hint (§26). */
  readonly hint: number;
  /** How long the soul at the desk may still be judged after dusk. */
  readonly duskGrace: number;
}

export interface Content {
  readonly genVersion: number;
  readonly sun: SunCosts;
  readonly facts: readonly FactDef[];
  readonly observations: readonly ObservationDef[];
  readonly signLaws: readonly SignLaw[];
  readonly factLaws: readonly FactLaw[];
  readonly cues: readonly CueDef[];
  readonly world: readonly WorldConstraint[];
  readonly predicates: readonly NamedPredicate[];
  readonly rules: readonly RuleDef[];
  readonly tools: readonly ToolDef[];
  readonly archetypes: readonly ArchetypeDef[];
  readonly speech: readonly SpeechSlotDef[];
  readonly testimony: readonly TestimonyTemplate[];
  readonly ravens: readonly RavenTemplate[];
  readonly questions: readonly QuestionTemplate[];
  readonly pools: Readonly<Record<string, readonly string[]>>;
  readonly days: readonly DaySpec[];
  /** The Daily Shift: same souls for everyone on a date. `day` is the mechanics day it plays with. */
  readonly daily?: DaySpec;
  /** The primer: a short scripted shift that teaches the Daily's tools. */
  readonly primer?: DaySpec;
  /** Campaign rules, in builds that ship campaign days. */
  readonly campaign?: CampaignDef;
  /** Story souls that campaign days place in their queues. */
  readonly scripted?: readonly ScriptedCaseDef[];
  /** Things to do to a soul besides stamping it (Day 8 on). */
  readonly procedures?: readonly ProcedureDef[];
  /** Saga tally lines (Day 11 on). */
  readonly tallies?: readonly TallyTemplate[];
  /** The rulebook's kennings and sayings, which the skalds carve (docs/tech-spec.md §77). */
  readonly kennings?: readonly KenningDef[];
  /** Endless's twists for rounds that bring nothing new. */
  readonly twists?: readonly EndlessTwist[];
  /** Endless's boons and curses, chosen between rounds (docs/tech-spec.md §68); none in the demo. */
  readonly boons?: readonly EndlessBoon[];
  /** What can be earned in this build: each pack brings its own. */
  readonly achievements?: readonly AchievementDef[];
  /** Pressing a soul on what it said (docs/tech-spec.md §66); none in a build without it. */
  readonly press?: PressDef;
  /** What pressed souls say. */
  readonly pressLines?: readonly PressTemplate[];
  /** Souls who come to the desk together (docs/tech-spec.md §69); none in the demo. */
  readonly parties?: PartiesDef;
  /** What they say about each other. */
  readonly partyLines?: readonly PartyLineTemplate[];
}
