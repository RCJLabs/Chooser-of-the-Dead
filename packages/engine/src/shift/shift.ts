import type { Content, Destination, ToolId, Value } from '../content/types';
import { DESTINATIONS } from '../content/types';
import { companionShows, memberField, parseMemberField } from '../gen/companions';
import { generateDay } from '../gen/generate';
import { linkParties, lordGiven, partyAt } from '../gen/party';
import type { CaseSpec, Field } from '../gen/types';
import { createDayContext, type DayCtx, soulCtx } from '../logic/context';
import { type Given, isPerceivable, solve } from '../logic/solver';
import { type PressAnswer, pressAnswer, saidFrom } from '../narrative/press';
import { type QuestionResponse, questionResponse } from '../narrative/questions';
import { fnv1a32 } from '../rng/hash';

/**
 * One shift at the gate: a queue of souls under a sun timer. Pure and
 * deterministic: the UI passes timestamps (`at`, integer ms on any monotonic
 * clock) and the engine never reads a clock (docs/tech-spec.md §4).
 */

/** Speed-only changes from campaign upgrades (docs/build-plan.md §1). */
export interface ShiftMods {
  /** Replacement sun costs, in seconds, for tools (including turning the body over). */
  readonly toolCostS?: Readonly<Partial<Record<ToolId, number>>>;
  readonly questionS?: number;
  /** Extra sun for the whole shift; less (negative) when the day began at home (docs/tech-spec.md §50). */
  readonly sunS?: number;
  /** Questions that cost no sun: the day's first ones (a god's favour, docs/tech-spec.md §43). */
  readonly freeQuestions?: number;
  /** Percent of each fine the day's audit charges (a god's favour). */
  readonly finePct?: number;
  /** Presses more each soul will take (an Endless boon, docs/tech-spec.md §68). */
  readonly patience?: number;
  /** The most hints Skögul gives this shift (an Endless run's, docs/tech-spec.md §68); no limit when absent. */
  readonly hints?: number;
}

/**
 * Assists the player chose as the shift began (docs/tech-spec.md §24). None changes what is true about a
 * soul: they change how much time there is, what the rulebook shows, and what mistakes cost.
 */
export interface Assists {
  /** The sun's speed in percent: 50 gives twice the time, 200 half; 100 is as designed. */
  readonly sunPct?: number;
  /** The rulebook greys out the rules that what the player has seen of a soul already rules out. */
  readonly tracker?: boolean;
  /** Citations cost nothing (the campaign's fines). */
  readonly noFines?: boolean;
}

/** The sun speeds on offer, in percent. */
export const SUN_SPEEDS: readonly number[] = [50, 75, 100, 150, 200];

/** Assists as the engine keeps them: a sun speed on offer other than 100, and only the flags that are on. */
export function cleanAssists(a: Assists | undefined): Assists {
  const sunPct = a?.sunPct !== undefined && SUN_SPEEDS.includes(a.sunPct) ? a.sunPct : 100;
  return {
    ...(sunPct !== 100 ? { sunPct } : {}),
    ...(a?.tracker ? { tracker: true } : {}),
    ...(a?.noFines ? { noFines: true } : {}),
  };
}

/** How each sun speed on offer reads. */
const SPEED_TEXT: Readonly<Record<number, string>> = { 50: '0.5', 75: '0.75', 150: '1.5', 200: '2' };

/** What a result says about its assists, for share text: "sun ×0.5", "rule tracker". Empty when there are none. */
export function assistNotes(a: Assists | undefined): string[] {
  const clean = cleanAssists(a);
  return [
    ...(clean.sunPct !== undefined ? [`sun ×${SPEED_TEXT[clean.sunPct] ?? clean.sunPct}`] : []),
    ...(clean.tracker ? ['rule tracker'] : []),
  ];
}

export interface ShiftConfig {
  readonly mode: 'daily' | 'practice' | 'primer' | 'campaign';
  readonly seed: string;
  /** The mechanics day: a campaign day for practice, the Daily spec's day for the Daily. */
  readonly day: number;
  readonly dailyNumber?: number;
  /** No sun timer (Story Mode, practice). */
  readonly untimed?: boolean;
  /** The shift's own sun, in seconds, instead of its day's: an Endless round under the sun (docs/tech-spec.md §68). */
  readonly sunS?: number;
  readonly mods?: ShiftMods;
  /** Set as the shift begins, from the `begin` action, so replays keep them. */
  readonly assists?: Assists;
  /** A campaign run under the oath (docs/tech-spec.md §49): Skögul gives no hints. */
  readonly oath?: true;
}

export interface SoulState {
  readonly seen: readonly string[];
  readonly view: 'front' | 'back';
  readonly flipped: boolean;
  readonly tools: readonly ToolId[];
  /** Contradictions the player called out: the lying field and the field it was compared with. */
  readonly flagged: readonly { readonly lie: string; readonly fact: string; readonly with: string }[];
  readonly questioned: readonly string[];
  /** Claims the player pressed the soul on (docs/tech-spec.md §66), in order; absent before the first. */
  readonly pressed?: readonly string[];
  /** Lies that gave way when pressed: caught, and answered as if questioned. */
  readonly gave?: readonly string[];
  /** What the soul added, holding to a claim it was pressed on: claims like any other, heard as they're said. */
  readonly said?: readonly Field[];
  /** Evidence Skögul has pointed at, in order (absent in states from before hints). */
  readonly hinted?: readonly string[];
  readonly stamp: Destination | null;
}

export interface Verdict {
  readonly index: number;
  /** null: the sun set before this soul was judged. */
  readonly stamped: Destination | null;
  readonly expected: Destination;
  readonly rule: string;
  readonly correct: boolean;
  /** Proof fields the player never looked at, for the citation. */
  readonly missed: readonly string[];
  /** Procedures the soul needed that weren't done (e.g. nails left unclipped). */
  readonly skipped?: readonly string[];
  readonly caught: number;
  readonly lies: number;
  /** Claims pressed (docs/tech-spec.md §66), and lies given up when pressed; absent when none. */
  readonly pressed?: number;
  readonly gave?: number;
  /** Of the lies caught, those about a companion (docs/tech-spec.md §69); absent when none. */
  readonly caughtAbout?: number;
  readonly atMs: number;
}

export interface ShiftClock {
  readonly startedAt: number | null;
  readonly pausedAt: number | null;
  readonly pausedMs: number;
  readonly penaltyMs: number;
  readonly dusk: boolean;
}

export interface ShiftState {
  readonly v: 1;
  readonly config: ShiftConfig;
  readonly phase: 'briefing' | 'shift' | 'done';
  readonly sunMs: number;
  readonly cases: readonly CaseSpec[];
  readonly cursor: number;
  readonly soul: SoulState;
  readonly clock: ShiftClock;
  readonly verdicts: readonly Verdict[];
  readonly endedBy: 'queue' | 'dusk' | null;
  /** Question templates used lately, so answers don't repeat (last 20). */
  readonly recentQ: readonly string[];
  /** Questions asked for free so far (`mods.freeQuestions`); absent before the first. */
  readonly freeAsked?: number;
  /** Hints given so far, when the shift has a limit (`mods.hints`); absent before the first. */
  readonly hintsAsked?: number;
  /**
   * The party at the desk (docs/tech-spec.md §69), while there is one: where it starts in the line, and each member's
   * state. The member the player is turned to stands at `cursor` and its state is `soul`; its entry here is only kept
   * up to date when the player turns away.
   */
  readonly party?: { readonly start: number; readonly souls: readonly SoulState[] };
}

export type ShiftAction =
  | { readonly t: 'begin'; readonly at: number; readonly assists?: Assists }
  | { readonly t: 'inspect'; readonly fields: readonly string[]; readonly at: number }
  | { readonly t: 'flip'; readonly at: number }
  | { readonly t: 'tool'; readonly tool: ToolId; readonly at: number }
  | { readonly t: 'compare'; readonly a: string; readonly b: string; readonly at: number }
  | { readonly t: 'question'; readonly lie: string; readonly at: number }
  | { readonly t: 'press'; readonly field: string; readonly at: number }
  | { readonly t: 'hint'; readonly at: number }
  /** Turns to another member of the party at the desk (its place in the party, from 0). */
  | { readonly t: 'turn'; readonly to: number; readonly at: number }
  | { readonly t: 'stamp'; readonly dest: Destination; readonly at: number }
  | { readonly t: 'send'; readonly at: number }
  | { readonly t: 'pause'; readonly at: number }
  | { readonly t: 'resume'; readonly at: number }
  | { readonly t: 'tick'; readonly at: number };

export type ShiftEvent =
  | { readonly e: 'begun' }
  | { readonly e: 'inspected'; readonly fields: readonly string[] }
  | { readonly e: 'flipped'; readonly view: 'front' | 'back'; readonly penaltyMs: number }
  | { readonly e: 'toolUsed'; readonly tool: ToolId; readonly fields: readonly string[]; readonly penaltyMs: number }
  /**
   * A lie caught. `member`: at a party, the place of the soul who told it, when that isn't the member turned to; `with`
   * names a companion's field as `@<member>:<field>`.
   */
  | {
      readonly e: 'contradiction';
      readonly lie: string;
      readonly fact: string;
      readonly with: string;
      readonly member?: number;
    }
  | { readonly e: 'noConflict'; readonly a: string; readonly b: string; readonly penaltyMs: number }
  | { readonly e: 'answer'; readonly lie: string; readonly response: QuestionResponse; readonly penaltyMs: number }
  | { readonly e: 'pressed'; readonly field: string; readonly answer: PressAnswer; readonly penaltyMs: number }
  | { readonly e: 'hint'; readonly field: string; readonly penaltyMs: number }
  /** Turned to another member of the party at the desk; `next`: by sending a stamped one on to the next. */
  | { readonly e: 'turned'; readonly to: number; readonly next?: true }
  | { readonly e: 'stamped'; readonly dest: Destination }
  | { readonly e: 'judged'; readonly verdict: Verdict }
  | { readonly e: 'citation'; readonly verdict: Verdict }
  | { readonly e: 'dusk' }
  | { readonly e: 'done'; readonly endedBy: 'queue' | 'dusk' }
  | { readonly e: 'paused' }
  | { readonly e: 'resumed' }
  | { readonly e: 'rejected'; readonly reason: string };

/**
 * What the sun costs besides the tools, in ms (docs/tech-spec.md §4, §26): the content's `sun.yaml`, so tuning it is
 * data (§63). The tools' own costs are content too.
 */
export function sunCosts(content: Content): {
  readonly badCompare: number;
  readonly question: number;
  readonly hint: number;
  readonly duskGrace: number;
} {
  const { badCompare, question, hint, duskGrace } = content.sun;
  return { badCompare: badCompare * 1000, question: question * 1000, hint: hint * 1000, duskGrace: duskGrace * 1000 };
}

const freshSoul = (): SoulState => ({
  seen: [],
  view: 'front',
  flipped: false,
  tools: [],
  flagged: [],
  questioned: [],
  stamp: null,
});

/** The day context a shift plays in (the Daily and the primer have their own specs). */
export function shiftContext(content: Content, config: ShiftConfig): DayCtx {
  if (config.mode === 'daily') {
    if (!content.daily) throw new Error('This build has no Daily Shift');
    return createDayContext(content, content.daily.day, config.seed, content.daily);
  }
  if (config.mode === 'primer') {
    if (!content.primer) throw new Error('This build has no primer');
    return createDayContext(content, content.primer.day, config.seed, content.primer);
  }
  // Practice and campaign days play the day's own spec.
  return createDayContext(content, config.day, config.seed);
}

/**
 * A new shift in its briefing. `queue` replaces generation with an already
 * generated queue (a saved campaign day), so a resume stays exact even after
 * the generator changes. A campaign passes the day's context as the run plays it
 * (its day event's sun included, docs/tech-spec.md §52).
 */
export function startShift(
  content: Content,
  config: ShiftConfig,
  queue?: readonly CaseSpec[],
  ctx: DayCtx = shiftContext(content, config),
): { state: ShiftState; ctx: DayCtx } {
  // A shift that makes its own souls forms the day's parties too (docs/tech-spec.md §69): never on the Daily or the
  // primer, whose specs have none.
  const cases = queue ?? linkParties(generateDay(config.seed, ctx).cases, ctx, config.seed);
  const state: ShiftState = {
    v: 1,
    config: { ...config, day: ctx.day },
    phase: 'briefing',
    sunMs: ((config.sunS ?? ctx.spec.sunS) + (config.mods?.sunS ?? 0)) * 1000,
    cases,
    cursor: 0,
    soul: freshSoul(),
    clock: { startedAt: null, pausedAt: null, pausedMs: 0, penaltyMs: 0, dusk: false },
    verdicts: [],
    endedBy: null,
    recentQ: [],
  };
  return { state, ctx };
}

/** The shift with the party that starts at its cursor at the desk, if one does; none otherwise. */
function arrive(state: ShiftState): ShiftState {
  const { party: _, ...rest } = state;
  const span = partyAt(state.cases, state.cursor);
  return span ? { ...rest, party: { start: span.start, souls: Array.from({ length: span.size }, freshSoul) } } : rest;
}

/** The place in the party at the desk of the member the player is turned to; 0 with no party. */
export const turnedTo = (state: ShiftState): number => (state.party ? state.cursor - state.party.start : 0);

/** Party member `k`'s state (the soul at the desk's own, with no party). */
export function memberSoul(state: ShiftState, k: number): SoulState | undefined {
  if (!state.party) return k === 0 ? state.soul : undefined;
  return k === turnedTo(state) ? state.soul : state.party.souls[k];
}

/** The souls at the desk: the party's members, or the one soul. */
export function atDesk(state: ShiftState): readonly CaseSpec[] {
  if (state.phase !== 'shift') return [];
  if (!state.party) return state.cases.slice(state.cursor, state.cursor + 1);
  return state.cases.slice(state.party.start, state.party.start + state.party.souls.length);
}

/** The shift turned to party member `to` (at a party). */
function turnTo(state: ShiftState, to: number): ShiftState {
  const party = state.party;
  if (!party) return state;
  const souls = party.souls.slice();
  souls[turnedTo(state)] = state.soul;
  return { ...state, cursor: party.start + to, soul: souls[to] as SoulState, party: { ...party, souls } };
}

/** The shift with party member `k`'s state replaced. */
function withMember(state: ShiftState, k: number, soul: SoulState): ShiftState {
  if (!state.party || k === turnedTo(state)) return { ...state, soul };
  const souls = state.party.souls.slice();
  souls[k] = soul;
  return { ...state, party: { ...state.party, souls } };
}

/**
 * What a soul has owned up to, questioned: its confessions establish the truth (trust 4); a lie given up without one,
 * or a lie about a companion (docs/tech-spec.md §69), only counts as caught.
 */
export function retractedOf(c: CaseSpec, soul: SoulState): Map<string, { fact: string; value: Value } | null> {
  return new Map(
    c.lies
      .filter((l) => soul.questioned.includes(l.field))
      .map((l) => [
        l.field,
        l.onQuestion === 'confess' && l.about === undefined ? { fact: l.fact, value: l.truth } : null,
      ]),
  );
}

/**
 * What the retinue at the desk settles about member `k` (docs/tech-spec.md §70): the hall his jarl is bound for, as far
 * as what the player has seen of the jarl (with what was caught against him, and what he owned up to) decides it.
 * Undefined for the jarl himself, and for a soul no retinue brings.
 */
export function givenAtDesk(state: ShiftState, k: number, ctx: DayCtx): Given[] | undefined {
  const members = atDesk(state);
  const lord = members[k]?.party?.lord;
  if (!state.party || !lord || k === lord.at) return undefined;
  const jarl = members[lord.at];
  const soul = memberSoul(state, lord.at);
  if (!jarl || !soul) return undefined;
  const seen = soulFieldsOf(jarl, soul).filter((f) => soul.seen.includes(f.id));
  const opts = { crossCaught: crossFlagged(soul), retracted: retractedOf(jarl, soul) };
  return lordGiven(jarl, seen, lord.fact, ctx, opts, []);
}

/** The lies about companions the player has shown false: each claim, and the companion's field it was compared with. */
export function crossFlagged(soul: SoulState): Map<string, string[]> {
  return new Map(soul.flagged.filter((f) => parseMemberField(f.with) !== null).map((f) => [f.lie, [f.with]]));
}

/** Sun time used so far: real time since the start, minus pauses, plus penalties. */
export function sunElapsed(state: ShiftState, at: number): number {
  const { startedAt, pausedAt, pausedMs, penaltyMs } = state.clock;
  if (startedAt === null) return 0;
  const paused = pausedMs + (pausedAt !== null ? Math.max(0, at - pausedAt) : 0);
  return Math.max(0, at - startedAt - paused + penaltyMs);
}

export function sunLeft(state: ShiftState, at: number): number {
  return Math.max(0, state.sunMs - sunElapsed(state, at));
}

export function currentCase(state: ShiftState): CaseSpec | undefined {
  return state.phase === 'shift' ? state.cases[state.cursor] : undefined;
}

/** The fields the player could inspect right now (the back needs the flip; tool readings need the tool). */
export function inspectable(state: ShiftState, ctx: DayCtx): Field[] {
  const c = currentCase(state);
  if (!c) return [];
  const cx = soulCtx(ctx, c);
  return c.evidence.fields.filter(
    (f) =>
      isPerceivable(f, cx) &&
      (f.view !== 'back' || state.soul.flipped) &&
      (f.tool === undefined || state.soul.tools.includes(f.tool)),
  );
}

/**
 * The rule tracker (an assist): today's rules that what the player has seen of the current soul already
 * rules out. It reads only what can't be wrong (body signs, the ravens, tool readings and confessions), never
 * a presumption or a tally not yet checked for forgery, so the rule that applies is never among them.
 */
export function ruledOut(state: ShiftState, ctx: DayCtx): string[] {
  const c = currentCase(state);
  if (!c) return [];
  const { soul } = state;
  const seen = soulFields(state, c).filter((f) => soul.seen.includes(f.id));
  // What the soul gave up, questioned or pressed: a confession is the truth whatever else has been seen. What it said
  // of a companion, shown false, is a lie caught (docs/tech-spec.md §69).
  const retracted = retractedOf(c, soul);
  // A sworn man's jarl's hall, as far as the jarl has been seen (docs/tech-spec.md §70).
  const given = givenAtDesk(state, turnedTo(state), ctx);
  return solve(seen, soulCtx(ctx, c), {
    retracted,
    certainOnly: true,
    crossCaught: crossFlagged(soul),
    ...(given ? { given } : {}),
  })
    .rules.filter((r) => r.result === 'F')
    .map((r) => r.rule);
}

/**
 * What Skögul would point at next (docs/tech-spec.md §26): the first of the soul's deciding evidence
 * (its minimal proof) that the player hasn't looked at and she hasn't already pointed at. Null when
 * there's nothing left to show: what decides the soul has all been seen.
 */
export function nextHint(state: ShiftState): string | null {
  const c = currentCase(state);
  if (!c) return null;
  const { seen, hinted = [] } = state.soul;
  return c.meta.proof.find((id) => !seen.includes(id) && !hinted.includes(id)) ?? null;
}

/** Hints Skögul will still give this shift, when it has a limit (an Endless run's); undefined when it has none. */
export function hintsLeft(state: ShiftState): number | undefined {
  const cap = state.config.mods?.hints;
  return cap === undefined ? undefined : Math.max(0, cap - (state.hintsAsked ?? 0));
}

/** Stamps available today, in a stable order. */
export function stampsFor(ctx: DayCtx): Destination[] {
  return DESTINATIONS.filter((d) => ctx.destinations.has(d));
}

/** A tool's sun cost in seconds today, after upgrades; undefined if the tool isn't taught yet. */
export function toolCost(state: ShiftState, ctx: DayCtx, tool: ToolId): number | undefined {
  const base = ctx.tools.get(tool);
  if (base === undefined) return undefined;
  return state.config.mods?.toolCostS?.[tool] ?? base;
}

/** What questioning a liar costs, in sun-ms, after upgrades. */
export function questionCostMs(state: ShiftState, ctx: DayCtx): number {
  const s = state.config.mods?.questionS;
  return s === undefined ? sunCosts(ctx.content).question : s * 1000;
}

/** Whether the next question is one of the day's free ones (a god's favour, docs/tech-spec.md §43). */
export const freeQuestion = (state: ShiftState): boolean =>
  (state.freeAsked ?? 0) < (state.config.mods?.freeQuestions ?? 0);

/** The soul's evidence and what it has added, pressed on its claims (docs/tech-spec.md §66). */
export function soulFields(state: ShiftState, c: CaseSpec): Field[] {
  return soulFieldsOf(c, state.soul);
}

/** A soul's evidence and what it has added, pressed, with its state `soul`. */
export function soulFieldsOf(c: CaseSpec, soul: SoulState): Field[] {
  return [...c.evidence.fields, ...(soul.said ?? [])];
}

/**
 * Whether souls can be pressed on what they say in this shift (docs/tech-spec.md §66): from the content's day, and
 * never in the Daily or the primer, which play as they always have.
 */
export function pressTaught(state: ShiftState, ctx: DayCtx): boolean {
  const press = ctx.content.press;
  return (
    press !== undefined && state.config.mode !== 'daily' && state.config.mode !== 'primer' && ctx.day >= press.since
  );
}

/** How many more times the soul at the gate will be pressed. */
export function patienceLeft(state: ShiftState, ctx: DayCtx): number {
  const press = ctx.content.press;
  const patience = press ? press.patience + (state.config.mods?.patience ?? 0) : 0;
  return Math.max(0, patience - (state.soul.pressed?.length ?? 0));
}

/** The claims the soul at the gate can be pressed on now: heard, and not yet caught, questioned or pressed. */
export function pressable(state: ShiftState, ctx: DayCtx): string[] {
  const c = currentCase(state);
  if (!c || !pressTaught(state, ctx) || patienceLeft(state, ctx) === 0) return [];
  const { soul } = state;
  return c.evidence.fields
    .filter(
      (f) =>
        f.item === 'testimony' &&
        f.says !== undefined &&
        f.says.value !== null &&
        soul.seen.includes(f.id) &&
        !soul.flagged.some((x) => x.lie === f.id) &&
        !soul.questioned.includes(f.id) &&
        !(soul.pressed ?? []).includes(f.id),
    )
    .map((f) => f.id);
}

/** What a press costs, in sun-ms. */
export const pressCostMs = (ctx: DayCtx): number => (ctx.content.press?.cost ?? 0) * 1000;

/**
 * How many of the soul's lies the player caught: shown false (directly, or through what it added holding to one),
 * or given up when pressed. Never more than it told.
 */
export function caughtLies(soul: SoulState): number {
  return new Set([...soul.flagged.map((f) => saidFrom(f.lie) ?? f.lie), ...(soul.gave ?? [])]).size;
}

function reject(state: ShiftState, reason: string): { state: ShiftState; events: ShiftEvent[] } {
  return { state, events: [{ e: 'rejected', reason }] };
}

function penalize(state: ShiftState, ms: number): ShiftState {
  return ms > 0 ? { ...state, clock: { ...state.clock, penaltyMs: state.clock.penaltyMs + ms } } : state;
}

function finish(state: ShiftState, endedBy: 'queue' | 'dusk', at: number): { state: ShiftState; events: ShiftEvent[] } {
  const atMs = sunElapsed(state, at);
  const unjudged: Verdict[] = state.cases.slice(state.verdicts.length).map((c, i) => ({
    index: state.verdicts.length + i,
    stamped: null,
    expected: c.expect.dest,
    rule: c.expect.rule,
    correct: false,
    missed: [],
    caught: 0,
    lies: c.lies.length,
    atMs,
  }));
  const { party: _, ...rest } = state;
  return {
    state: { ...rest, phase: 'done', endedBy, verdicts: [...state.verdicts, ...unjudged], soul: freshSoul() },
    events: [{ e: 'done', endedBy }],
  };
}

/** Checks dusk (and the grace after it); returns events for anything that happened. */
function checkSun(state: ShiftState, at: number, ctx: DayCtx): { state: ShiftState; events: ShiftEvent[] } {
  if (state.config.untimed || state.phase !== 'shift' || state.clock.pausedAt !== null) {
    return { state, events: [] };
  }
  const elapsed = sunElapsed(state, at);
  const events: ShiftEvent[] = [];
  let s = state;
  if (!s.clock.dusk && elapsed >= s.sunMs) {
    s = { ...s, clock: { ...s.clock, dusk: true } };
    events.push({ e: 'dusk' });
  }
  if (s.clock.dusk && elapsed >= s.sunMs + sunCosts(ctx.content).duskGrace) {
    const f = finish(s, 'dusk', at);
    return { state: f.state, events: [...events, ...f.events] };
  }
  return { state: s, events };
}

/**
 * The verdict on soul `c`, sent with the state `soul`: its stamp against its judgment, the proof it never looked at
 * (on a companion too, as `@<member>:<field>`: docs/tech-spec.md §69), the procedures skipped, the lies caught.
 * `party`: every member's state, the soul's own included.
 */
function verdictFor(
  c: CaseSpec,
  soul: SoulState,
  index: number,
  ctx: DayCtx,
  atMs: number,
  party: readonly SoulState[],
): Verdict {
  const stamped = soul.stamp as Destination;
  const skipped = (c.expect.procedures ?? []).filter((id) => {
    const p = ctx.procedures.find((x) => x.id === id);
    return !p || !soul.tools.includes(p.tool);
  });
  const missedAcross = (c.meta.crossProof ?? [])
    .filter((x) => !(party[x.soul]?.seen ?? []).includes(x.field))
    .map((x) => memberField(x.soul, x.field));
  return {
    index,
    stamped,
    expected: c.expect.dest,
    rule: c.expect.rule,
    correct: stamped === c.expect.dest && skipped.length === 0,
    missed: [...c.meta.proof.filter((id) => !soul.seen.includes(id)), ...missedAcross],
    ...(skipped.length > 0 ? { skipped } : {}),
    caught: caughtLies(soul),
    lies: c.lies.length,
    ...(soul.pressed?.length ? { pressed: soul.pressed.length } : {}),
    ...(soul.gave?.length ? { gave: soul.gave.length } : {}),
    ...(crossFlagged(soul).size > 0 ? { caughtAbout: crossFlagged(soul).size } : {}),
    atMs,
  };
}

/**
 * A Compare across the party at the desk (docs/tech-spec.md §69): what one member said of another, against something
 * of that other's own. Plain ids are the member turned to's. A lie is caught when what the companion shows (and can't
 * be wrong about) says otherwise; it's marked on the member who told it.
 */
function compareAcross(s: ShiftState, day: DayCtx, a: string, b: string): { state: ShiftState; events: ShiftEvent[] } {
  const party = s.party;
  const here = turnedTo(s);
  const at = (id: string) => parseMemberField(id) ?? { soul: here, field: id };
  const x = at(a);
  const y = at(b);
  const size = party?.souls.length ?? 0;
  if (!party || x.soul >= size || y.soul >= size) return reject(s, 'compare two things you have looked at');
  const member = (k: number) => s.cases[party.start + k] as CaseSpec;
  const seen = (p: { soul: number; field: string }) => (memberSoul(s, p.soul)?.seen ?? []).includes(p.field);
  if ((x.soul === y.soul && x.field === y.field) || !seen(x) || !seen(y)) {
    return reject(s, 'compare two things you have looked at');
  }
  if (x.soul === y.soul) return reject(s, 'turn to them to compare their own words');
  const claimOf = (p: { soul: number; field: string }, other: number) => {
    const f = member(p.soul).evidence.fields.find((g) => g.id === p.field);
    return f?.about && f.about.soul === other ? f.about : null;
  };
  const found = (claim: { soul: number; field: string }, other: { soul: number; field: string }) => {
    const about = claimOf(claim, other.soul);
    if (!about) return false;
    const mate = member(other.soul);
    const mateSoul = memberSoul(s, other.soul) as SoulState;
    const mateFields = soulFieldsOf(mate, mateSoul).filter((f) => mateSoul.seen.includes(f.id));
    const cx = soulCtx(day, mate);
    const shows = companionShows(mateFields, about.fact, about.value, cx, retractedOf(mate, mateSoul));
    return shows !== null && (shows.includes(other.field) || shows.includes(`q:${other.field}`));
  };
  const claim = found(x, y) ? x : found(y, x) ? y : null;
  if (!claim) {
    const penaltyMs = sunCosts(day.content).badCompare;
    return { state: penalize(s, penaltyMs), events: [{ e: 'noConflict', a, b, penaltyMs }] };
  }
  const other = claim === x ? y : x;
  const teller = memberSoul(s, claim.soul) as SoulState;
  if (teller.flagged.some((f) => f.lie === claim.field)) return { state: s, events: [] };
  const fact = (claimOf(claim, other.soul) as { fact: string }).fact;
  const with_ = memberField(other.soul, other.field);
  const next = withMember(s, claim.soul, {
    ...teller,
    flagged: [...teller.flagged, { lie: claim.field, fact, with: with_ }],
  });
  return {
    state: next,
    events: [
      {
        e: 'contradiction',
        lie: claim.field,
        fact,
        with: with_,
        ...(claim.soul !== here ? { member: claim.soul } : {}),
      },
    ],
  };
}

/** Advances a shift by one action. Invalid actions leave the state unchanged and emit `rejected`. */
export function stepShift(
  state: ShiftState,
  action: ShiftAction,
  day: DayCtx,
): { state: ShiftState; events: ShiftEvent[] } {
  if (action.t === 'begin') {
    if (state.phase !== 'briefing') return reject(state, 'the shift has already begun');
    const assists = cleanAssists(action.assists);
    const pct = assists.sunPct ?? 100;
    return {
      state: arrive({
        ...state,
        phase: 'shift',
        ...(Object.keys(assists).length > 0 ? { config: { ...state.config, assists } } : {}),
        // A slower sun is the same shift with more of it: tool costs and penalties stay as they are.
        sunMs: pct === 100 ? state.sunMs : Math.floor((state.sunMs * 100) / pct),
        clock: { ...state.clock, startedAt: action.at },
      }),
      events: [{ e: 'begun' }],
    };
  }
  if (state.phase !== 'shift') return reject(state, 'no shift in progress');

  if (action.t === 'pause') {
    if (state.clock.pausedAt !== null) return { state, events: [] };
    return { state: { ...state, clock: { ...state.clock, pausedAt: action.at } }, events: [{ e: 'paused' }] };
  }
  if (action.t === 'resume') {
    const { pausedAt } = state.clock;
    if (pausedAt === null) return { state, events: [] };
    const clock = {
      ...state.clock,
      pausedAt: null,
      pausedMs: state.clock.pausedMs + Math.max(0, action.at - pausedAt),
    };
    return { state: { ...state, clock }, events: [{ e: 'resumed' }] };
  }
  if (state.clock.pausedAt !== null) return reject(state, 'the shift is paused');

  const sun = checkSun(state, action.at, day);
  if (sun.state.phase !== 'shift' || action.t === 'tick') return sun;
  const s = sun.state;
  const c = s.cases[s.cursor];
  if (!c) return sun;
  // The rules the soul at the desk is judged by: after a noon decree, the decree's (docs/tech-spec.md §45).
  const ctx = soulCtx(day, c);
  const withSun = (r: { state: ShiftState; events: ShiftEvent[] }) => ({
    state: r.state,
    events: [...sun.events, ...r.events],
  });

  switch (action.t) {
    case 'inspect': {
      const ids = new Set(inspectable(s, ctx).map((f) => f.id));
      const fresh = action.fields.filter((id) => ids.has(id) && !s.soul.seen.includes(id));
      if (fresh.length === 0) return withSun({ state: s, events: [] });
      return withSun({
        state: { ...s, soul: { ...s.soul, seen: [...s.soul.seen, ...fresh] } },
        events: [{ e: 'inspected', fields: fresh }],
      });
    }
    case 'flip': {
      const cost = toolCost(s, ctx, 'flip');
      if (cost === undefined) return withSun(reject(s, 'you cannot turn bodies over yet'));
      const penalty = s.soul.flipped ? 0 : cost * 1000;
      const view = s.soul.view === 'front' ? 'back' : 'front';
      return withSun({
        state: penalize({ ...s, soul: { ...s.soul, view, flipped: true } }, penalty),
        events: [{ e: 'flipped', view, penaltyMs: penalty }],
      });
    }
    case 'tool': {
      const cost = toolCost(s, ctx, action.tool);
      if (cost === undefined || action.tool === 'flip') return withSun(reject(s, `no ${action.tool} today`));
      if (s.soul.tools.includes(action.tool)) return withSun({ state: s, events: [] });
      const readings = c.evidence.fields.filter((f) => f.tool === action.tool).map((f) => f.id);
      const soul = { ...s.soul, tools: [...s.soul.tools, action.tool], seen: [...s.soul.seen, ...readings] };
      return withSun({
        state: penalize({ ...s, soul }, cost * 1000),
        events: [{ e: 'toolUsed', tool: action.tool, fields: readings, penaltyMs: cost * 1000 }],
      });
    }
    case 'compare': {
      let { a, b } = action;
      // At a party (docs/tech-spec.md §69), a member's field can be named `@<member>:<field>`: two of the member
      // turned to's own are compared as any soul's are; anything of another member's, across them.
      if (s.party) {
        const here = turnedTo(s);
        const pa = parseMemberField(a);
        const pb = parseMemberField(b);
        if ((pa?.soul ?? here) !== here || (pb?.soul ?? here) !== here) return withSun(compareAcross(s, day, a, b));
        a = pa?.field ?? a;
        b = pb?.field ?? b;
      }
      if (a === b || !s.soul.seen.includes(a) || !s.soul.seen.includes(b)) {
        return withSun(reject(s, 'compare two things you have looked at'));
      }
      const seenFields = soulFields(s, c).filter((f) => s.soul.seen.includes(f.id));
      const found = solve(seenFields, ctx).contradictions.find(
        (x) => (x.lie === a && x.against.includes(b)) || (x.lie === b && x.against.includes(a)),
      );
      if (!found) {
        const penaltyMs = sunCosts(day.content).badCompare;
        return withSun({
          state: penalize(s, penaltyMs),
          events: [{ e: 'noConflict', a: action.a, b: action.b, penaltyMs }],
        });
      }
      if (s.soul.flagged.some((f) => f.lie === found.lie)) return withSun({ state: s, events: [] });
      const other = found.lie === a ? b : a;
      const flagged = [...s.soul.flagged, { lie: found.lie, fact: found.fact, with: other }];
      return withSun({
        state: { ...s, soul: { ...s.soul, flagged } },
        events: [{ e: 'contradiction', lie: found.lie, fact: found.fact, with: other }],
      });
    }
    case 'question': {
      if (!s.soul.flagged.some((f) => f.lie === action.lie))
        return withSun(reject(s, 'call out a contradiction first'));
      if (s.soul.questioned.includes(action.lie)) return withSun(reject(s, 'already questioned'));
      // Caught in what it added, pressed on a claim, a soul gives way on the claim it was holding to.
      const held = saidFrom(action.lie);
      if (held !== null && s.soul.questioned.includes(held)) return withSun(reject(s, 'already questioned'));
      const response = questionResponse(c, held ?? action.lie, ctx.content, s.recentQ);
      if (!response) return withSun(reject(s, 'this soul has nothing to say'));
      const recentQ = [...s.recentQ, response.template].slice(-20);
      const free = freeQuestion(s);
      const cost = free ? 0 : questionCostMs(s, day);
      const questioned = [...s.soul.questioned, action.lie, ...(held !== null ? [held] : [])];
      const asked = { ...s, recentQ, soul: { ...s.soul, questioned } };
      return withSun({
        state: penalize(free ? { ...asked, freeAsked: (s.freeAsked ?? 0) + 1 } : asked, cost),
        events: [{ e: 'answer', lie: action.lie, response, penaltyMs: cost }],
      });
    }
    case 'press': {
      if (!pressTaught(s, day)) return withSun(reject(s, 'souls are not pressed today'));
      if (patienceLeft(s, day) === 0) return withSun(reject(s, 'the soul will say no more'));
      if (!pressable(s, day).includes(action.field)) return withSun(reject(s, 'press a claim you have heard'));
      const answer = pressAnswer(c, action.field, ctx, s.recentQ);
      if (!answer) return withSun(reject(s, 'this soul has nothing to say'));
      const penaltyMs = pressCostMs(day);
      const soul: SoulState = {
        ...s.soul,
        pressed: [...(s.soul.pressed ?? []), action.field],
        ...(answer.gave
          ? { gave: [...(s.soul.gave ?? []), action.field], questioned: [...s.soul.questioned, action.field] }
          : {}),
        ...(answer.said ? { said: [...(s.soul.said ?? []), answer.said], seen: [...s.soul.seen, answer.said.id] } : {}),
      };
      const recentQ = [...s.recentQ, answer.template, ...(answer.saidTemplate ? [answer.saidTemplate] : [])].slice(-20);
      return withSun({
        state: penalize({ ...s, recentQ, soul }, penaltyMs),
        events: [{ e: 'pressed', field: action.field, answer, penaltyMs }],
      });
    }
    case 'hint': {
      if (s.config.oath) return withSun(reject(s, 'no hints under the oath'));
      const cap = s.config.mods?.hints;
      if (cap !== undefined && (s.hintsAsked ?? 0) >= cap) return withSun(reject(s, 'no hints left'));
      const field = nextHint(s);
      if (!field) return withSun(reject(s, 'nothing left to point at'));
      const soul = { ...s.soul, hinted: [...(s.soul.hinted ?? []), field] };
      const asked = cap !== undefined ? { ...s, soul, hintsAsked: (s.hintsAsked ?? 0) + 1 } : { ...s, soul };
      const penaltyMs = sunCosts(day.content).hint;
      return withSun({ state: penalize(asked, penaltyMs), events: [{ e: 'hint', field, penaltyMs }] });
    }
    case 'turn': {
      const party = s.party;
      if (!party) return withSun(reject(s, 'there is no one else at the desk'));
      const to = action.to;
      if (!Number.isInteger(to) || to < 0 || to >= party.souls.length) return withSun(reject(s, 'no such soul here'));
      if (to === turnedTo(s)) return withSun({ state: s, events: [] });
      return withSun({ state: turnTo(s, to), events: [{ e: 'turned', to }] });
    }
    case 'stamp': {
      if (!ctx.destinations.has(action.dest)) return withSun(reject(s, `no ${action.dest} stamp today`));
      return withSun({
        state: { ...s, soul: { ...s.soul, stamp: action.dest } },
        events: [{ e: 'stamped', dest: action.dest }],
      });
    }
    case 'send': {
      if (!s.soul.stamp) return withSun(reject(s, 'choose a stamp first'));
      // A party goes together (docs/tech-spec.md §69), once every member is stamped: until then, sending one that is
      // turns to the next that isn't.
      const start = s.party?.start ?? s.cursor;
      const members = atDesk(s);
      const souls = members.map((_, k) => memberSoul(s, k) as SoulState);
      const here = turnedTo(s);
      const waiting = members.map((_, k) => (here + 1 + k) % members.length).find((k) => souls[k]?.stamp === null);
      if (waiting !== undefined) {
        return withSun({ state: turnTo(s, waiting), events: [{ e: 'turned', to: waiting, next: true }] });
      }
      const atMs = sunElapsed(s, action.at);
      const verdicts = members.map((m, k) =>
        verdictFor(m, souls[k] as SoulState, start + k, soulCtx(day, m), atMs, souls),
      );
      const events: ShiftEvent[] = [];
      for (const verdict of verdicts) {
        events.push({ e: 'judged', verdict });
        if (!verdict.correct) events.push({ e: 'citation', verdict });
      }
      const { party: _, ...rest } = s;
      const next: ShiftState = arrive({
        ...rest,
        cursor: start + members.length,
        verdicts: [...s.verdicts, ...verdicts],
        soul: freshSoul(),
      });
      if (next.cursor >= next.cases.length) {
        const f = finish(next, 'queue', action.at);
        return withSun({ state: f.state, events: [...events, ...f.events] });
      }
      if (next.clock.dusk) {
        const f = finish(next, 'dusk', action.at);
        return withSun({ state: f.state, events: [...events, ...f.events] });
      }
      return withSun({ state: next, events });
    }
  }
  return sun;
}

export interface ShiftScore {
  readonly correct: number;
  readonly judged: number;
  readonly total: number;
  readonly citations: number;
  readonly caught: number;
  /** Sun left when the last soul was sent (0 if the sun set). */
  readonly spareMs: number;
}

export function shiftScore(state: ShiftState): ShiftScore {
  const judged = state.verdicts.filter((v) => v.stamped !== null);
  const last = judged[judged.length - 1];
  return {
    correct: judged.filter((v) => v.correct).length,
    judged: judged.length,
    total: state.cases.length,
    citations: judged.filter((v) => !v.correct).length,
    caught: judged.reduce((n, v) => n + v.caught, 0),
    spareMs: state.endedBy === 'queue' && last ? Math.max(0, state.sunMs - last.atMs) : 0,
  };
}

/** One mark per soul: right, wrong, or not judged before dusk. */
export function shareMarks(state: ShiftState): string {
  return state.verdicts.map((v) => (v.stamped === null ? '⬛' : v.correct ? '🟩' : '🟥')).join('');
}

const clockText = (ms: number): string => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * Spoiler-free share text: right, wrong and unjudged per soul, never
 * destinations. Carries the generator version so results only compare
 * across the same Daily.
 */
export function shareText(
  state: ShiftState,
  content: Content,
  opts: { title: string; label?: string; decree?: string; url?: string },
): string {
  const score = shiftScore(state);
  const marks = shareMarks(state);
  const label =
    opts.label ??
    (state.config.mode === 'daily'
      ? `Daily #${state.config.dailyNumber ?? '?'}`
      : state.config.mode === 'primer'
        ? 'Primer'
        : `Day ${state.config.day} practice`);
  const tail = state.endedBy === 'dusk' ? 'sun set' : `${clockText(score.spareMs)} to spare`;
  const notes = assistNotes(state.config.assists);
  return [
    `${opts.title} · ${label} (g${content.genVersion})`,
    ...(opts.decree ? [opts.decree] : []),
    `${marks} ${score.correct}/${score.total} · ${tail}${notes.length > 0 ? ` · ${notes.join(', ')}` : ''}`,
    ...(opts.url ? [opts.url] : []),
  ].join('\n');
}

/**
 * A checksum of everything a player sees and must decide in a queue: same
 * checksum, same shift. Golden tests pin it for upcoming Dailies, and the
 * alpha's guard compares it across devices.
 */
export function queueChecksum(cases: readonly CaseSpec[], ctx: DayCtx): string {
  const params = Object.keys(ctx.paramChoices)
    .sort()
    .map((k) => [k, ctx.paramChoices[k]?.id ?? null]);
  const body = cases.map((c) => [c.id, c.archetype, c.truth, c.lies, c.evidence, c.expect]);
  return fnv1a32(JSON.stringify([ctx.content.genVersion, ctx.day, params, body]))
    .toString(16)
    .padStart(8, '0');
}
