import type { Content, EndlessBoon } from '../content/types';
import type { DayCtx } from '../logic/context';
import { Rng } from '../rng/rng';
import { ENDLESS_SOULS, ENDLESS_STRIKES, endlessDay } from './endless';
import type { ShiftConfig, ShiftEvent, ShiftMods } from './shift';

/*
 * Endless as a run (docs/tech-spec.md §68): before each round after the first, one of three boons, or the curse on
 * offer. A curse makes every soul judged rightly after it worth one more. Neither touches a soul: a round's souls come
 * from the run's seed and the round alone, whatever was chosen, so a day's run has the same souls for everyone. What
 * they change is the strikes a run can take, its score, its help (hints, presses) and its sun: never what a soul is or
 * what can be known about it. Builds without boons (the demo) play Endless as before.
 */

/** A choice made between rounds: before round `round` (from 1), the boon or curse `id`. */
export interface EndlessPick {
  readonly round: number;
  readonly id: string;
}

/** What a run's picks add up to. */
export interface RunRules {
  /** Wrong stamps the run can take: it ends at this many. */
  readonly strikes: number;
  /** What a soul judged rightly scores: 1, and 1 more for each curse. */
  readonly worth: number;
  /** More for a soul judged rightly whose lie was caught before the stamp. */
  readonly bounty: number;
  readonly curses: number;
  /** Týr's oath: a Compare that finds nothing is a strike. */
  readonly oath: boolean;
  /** Rounds have a sun. */
  readonly sun: boolean;
  /** Percent of each round's sun taken away. */
  readonly sunCut: number;
  /** Seconds more sun each round. */
  readonly sunS: number;
  /** Percent of the tools' sun costs. */
  readonly toolPct: number;
  /** Questions each round that cost no sun. */
  readonly freeQuestions: number;
  /** Presses more each soul takes. */
  readonly patience: number;
  /** Skögul's hints given, in all. */
  readonly hints: number;
}

/** The most of a round's sun curses can take away. */
const MAX_SUN_CUT = 50;

/** How many boons each break offers. */
export const BOONS_OFFERED = 3;

/** Whether this build's Endless is a run: it has boons and curses to choose between rounds (the full game). */
export const hasBoons = (content: Content): boolean => (content.boons?.length ?? 0) > 0;

export const findBoon = (content: Content, id: string): EndlessBoon | undefined =>
  content.boons?.find((b) => b.id === id);

/** What a run's picks add up to. A pick this build no longer has counts for nothing. */
export function runRules(content: Content, picks: readonly EndlessPick[]): RunRules {
  let strikes = ENDLESS_STRIKES;
  let curses = 0;
  let bounty = 0;
  let oath = false;
  let sun = false;
  let sunCut = 0;
  let sunS = 0;
  let toolPct = 100;
  let freeQuestions = 0;
  let patience = 0;
  let hints = 0;
  for (const p of picks) {
    const b = findBoon(content, p.id);
    if (!b) continue;
    if (b.kind === 'curse') curses++;
    const e = b.effect;
    if ('strikes' in e) strikes += e.strikes;
    else if ('hints' in e) hints += e.hints;
    else if ('bounty' in e) bounty += e.bounty;
    else if ('patience' in e) patience += e.patience;
    else if ('sunS' in e) sunS += e.sunS;
    else if ('toolPct' in e) toolPct = Math.floor((toolPct * e.toolPct) / 100);
    else if ('freeQuestions' in e) freeQuestions += e.freeQuestions;
    else if ('sun' in e) sun = true;
    else if ('sunCut' in e) sunCut = Math.min(MAX_SUN_CUT, sunCut + e.sunCut);
    else if ('oath' in e) oath = true;
  }
  return {
    strikes: Math.max(1, strikes),
    worth: 1 + curses,
    bounty,
    curses,
    oath,
    sun,
    sunCut,
    sunS,
    toolPct,
    freeQuestions,
    patience,
    hints,
  };
}

/** The choice before a round: up to three boons, and the curse on offer. */
export interface EndlessOffer {
  readonly round: number;
  readonly boons: readonly EndlessBoon[];
  readonly curse: EndlessBoon | null;
}

/**
 * Whether a run could take `b` before `round`: the round's day has come for it, the run has what it needs, it hasn't
 * been taken as often as it may be, and it wouldn't end the run on the spot or do nothing.
 */
function eligible(
  content: Content,
  b: EndlessBoon,
  round: number,
  picks: readonly EndlessPick[],
  strikes: number,
  rules: RunRules,
): boolean {
  if (b.since > endlessDay(content, round)) return false;
  if (b.max !== undefined && picks.filter((p) => p.id === b.id).length >= b.max) return false;
  if (b.needs === 'sun' && !rules.sun) return false;
  if (b.needs === 'strike' && strikes === 0) return false;
  const e = b.effect;
  if ('strikes' in e && rules.strikes + e.strikes - strikes < 1) return false;
  if ('sun' in e && rules.sun) return false;
  if ('oath' in e && rules.oath) return false;
  if ('sunCut' in e && rules.sunCut >= MAX_SUN_CUT) return false;
  return true;
}

/**
 * The choice before round `round` (from 1), drawn from the run's seed and the round, from what the run could take:
 * the same for everyone on a day's run who has chosen the same. Null before the first round, in a build without
 * boons, or when there's nothing left to offer. `strikes`: the run's strikes so far.
 */
export function endlessOffer(
  content: Content,
  seed: string,
  round: number,
  picks: readonly EndlessPick[],
  strikes: number,
): EndlessOffer | null {
  const all = content.boons ?? [];
  if (round < 1 || all.length === 0) return null;
  const rules = runRules(content, picks);
  const open = all.filter((b) => eligible(content, b, round, picks, strikes, rules));
  const drawn = new Rng(`${seed}|endless|${round}|boons`).shuffle(open.filter((b) => b.kind === 'boon'));
  const chosen = new Set(drawn.slice(0, BOONS_OFFERED));
  // Shown in the pack's order, so a boon sits in the same place whenever it comes.
  const boons = open.filter((b) => chosen.has(b));
  const curses = open.filter((b) => b.kind === 'curse');
  const curse = curses.length > 0 ? new Rng(`${seed}|endless|${round}|curse`).pick(curses) : null;
  return boons.length > 0 || curse ? { round, boons, curse } : null;
}

/** Whether `id` is on the offer before `round`: a pick the run may make. */
export function canPick(
  content: Content,
  seed: string,
  round: number,
  picks: readonly EndlessPick[],
  strikes: number,
  id: string,
): boolean {
  if (picks.some((p) => p.round === round)) return false;
  const offer = endlessOffer(content, seed, round, picks, strikes);
  return offer !== null && (offer.boons.some((b) => b.id === id) || offer.curse?.id === id);
}

/**
 * A round's sun under the sun: its day's own pace for its souls (the day's sun over its average line), less what the
 * run's curses take away. The run's boons add theirs as the shift's `mods.sunS`.
 */
export function roundSunS(ctx: DayCtx, rules: RunRules): number {
  const [lo, hi] = ctx.spec.queue.count;
  const pace = Math.floor((ctx.spec.sunS * ENDLESS_SOULS * 2) / (lo + hi));
  return Math.floor((pace * (100 - rules.sunCut)) / 100);
}

/**
 * The shift a round plays: with no sun, unless the run has taken it; with its hints, presses and costs. `hintsLeft`:
 * the run's hints not yet used. A build without boons plays the round as it always has.
 */
export function endlessConfig(
  ctx: DayCtx,
  seed: string,
  round: number,
  rules: RunRules,
  hintsLeft: number,
): ShiftConfig {
  const base = { mode: 'practice', seed: `${seed}|endless|${round}`, day: ctx.day } as const;
  if (!hasBoons(ctx.content)) return { ...base, untimed: true };
  const toolCostS = Object.fromEntries(
    [...ctx.tools].map(([tool, s]) => [tool, Math.floor((s * rules.toolPct) / 100)] as const),
  );
  const mods: ShiftMods = {
    ...(rules.sunS > 0 ? { sunS: rules.sunS } : {}),
    ...(rules.toolPct !== 100 ? { toolCostS } : {}),
    ...(rules.freeQuestions > 0 ? { freeQuestions: rules.freeQuestions } : {}),
    ...(rules.patience > 0 ? { patience: rules.patience } : {}),
    hints: Math.max(0, hintsLeft),
  };
  return rules.sun ? { ...base, sunS: roundSunS(ctx, rules), mods } : { ...base, untimed: true, mods };
}

/** What an event does to a run: souls judged rightly, points scored, strikes taken, hints used. */
export interface RunTally {
  readonly right: number;
  readonly points: number;
  readonly strikes: number;
  readonly hints: number;
}

/**
 * What one shift event does to the run: a soul judged rightly scores its worth (and the bounty, if its lie was caught
 * before the stamp); a wrong stamp is a strike, and so is a Compare that finds nothing under Týr's oath; a hint uses
 * one of the run's. Null for anything else. Souls the sun set on were never judged: they score nothing.
 */
export function tallyEvent(rules: RunRules, e: ShiftEvent): RunTally | null {
  switch (e.e) {
    case 'judged':
      return e.verdict.correct
        ? { right: 1, points: rules.worth + (e.verdict.caught > 0 ? rules.bounty : 0), strikes: 0, hints: 0 }
        : { right: 0, points: 0, strikes: 1, hints: 0 };
    case 'noConflict':
      return rules.oath ? { right: 0, points: 0, strikes: 1, hints: 0 } : null;
    case 'hint':
      return { right: 0, points: 0, strikes: 0, hints: 1 };
    default:
      return null;
  }
}
