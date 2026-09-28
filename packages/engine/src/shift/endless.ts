import type { Content, DaySpec, EndlessTwist } from '../content/types';
import { generateDay } from '../gen/generate';
import { linkParties } from '../gen/party';
import type { CaseSpec } from '../gen/types';
import { createDayContext, type DayCtx } from '../logic/context';
import { Rng } from '../rng/rng';
import { type Assists, assistNotes } from './shift';

/*
 * Endless (docs/m7-design.md, docs/tech-spec.md §27): the days' rules in
 * order, a round of five souls on each, then the last day's rules for as long
 * as the player lasts. Three wrong stamps end it; the score is the souls
 * judged rightly. No sun. A round that brings nothing new (a day with no
 * teaching soul, or any round past the last day) takes a twist: a decree that
 * changes how the day's souls come, never its rules.
 */

export const ENDLESS_SOULS = 5;
export const ENDLESS_STRIKES = 3;

const daysOf = (content: Content) => content.days.map((d) => d.day).sort((a, b) => a - b);

/** The day whose rules round `round` (from 0) is played on. */
export function endlessDay(content: Content, round: number): number {
  const days = daysOf(content);
  const day = days[Math.min(Math.max(0, round), days.length - 1)];
  if (day === undefined) throw new Error('This build has no days to play');
  return day;
}

/** The seed of the day's Endless, the same for everyone on that date (numbered like the Daily). */
export function endlessSeed(n: number): string {
  return `endless:${n}`;
}

/** The twist a round takes, if it brings nothing new: one the day's mechanics allow, drawn for the round. */
export function endlessTwist(content: Content, seed: string, round: number): EndlessTwist | null {
  const day = endlessDay(content, round);
  const fresh = round < daysOf(content).length && content.days.find((d) => d.day === day)?.queue.teachFirst;
  if (fresh) return null;
  const pool = (content.twists ?? []).filter((t) => t.since <= day);
  return pool.length > 0 ? new Rng(`${seed}|endless|${round}|twist`).pick(pool) : null;
}

/** The spec a round plays: its day's, with the round's twist (if any) in its decree, knobs and mix. */
export function endlessSpec(content: Content, seed: string, round: number): DaySpec {
  const day = endlessDay(content, round);
  const found = content.days.find((d) => d.day === day);
  if (!found) throw new Error(`No day spec for day ${day}`);
  // A round is the start of its day: a noon decree (docs/tech-spec.md §45) is the campaign's, never Endless's.
  const { noon: _noon, ...base } = found;
  const twist = endlessTwist(content, seed, round);
  if (!twist) return base;
  // Nothing new to teach, so no teaching soul comes first: the round's first soul is as open as the rest.
  const { teachFirst: _, ...queue } = base.queue;
  return {
    ...base,
    decree: twist.decree,
    queue: {
      ...queue,
      knobs: { ...base.queue.knobs, ...twist.knobs },
      mix: { ...base.queue.mix, ...twist.mix },
    },
  };
}

export interface EndlessRound {
  readonly day: number;
  /** The round's own seed: the context `endlessContext` builds for the round draws the same day params. */
  readonly seed: string;
  /** The first souls of the day's queue, so a day's teaching soul (its new rule) comes first. */
  readonly cases: readonly CaseSpec[];
  /** The round's twist, when it has one. */
  readonly twist?: string;
}

/** The day context a round plays in (its twist included), for the shift that plays it. */
export function endlessContext(content: Content, seed: string, round: number): DayCtx {
  const day = endlessDay(content, round);
  return createDayContext(content, day, `${seed}|endless|${round}`, endlessSpec(content, seed, round));
}

export function endlessRound(content: Content, seed: string, round: number): EndlessRound {
  const ctx = endlessContext(content, seed, round);
  const twist = endlessTwist(content, seed, round);
  const roundSeed = `${seed}|endless|${round}`;
  // A round's souls, with any parties its day forms among them (docs/tech-spec.md §69).
  const cases = linkParties(generateDay(roundSeed, ctx).cases.slice(0, ENDLESS_SOULS), ctx, roundSeed);
  return {
    day: ctx.day,
    seed: roundSeed,
    cases,
    ...(twist ? { twist: twist.id } : {}),
  };
}

/**
 * Spoiler-free share text for a finished Endless run: how many souls, how far, and any assists. A run with boons and
 * curses (docs/tech-spec.md §68) leads with its score and says how many curses it took.
 */
export function endlessShareText(opts: {
  readonly title: string;
  readonly label: string;
  readonly genVersion: number;
  readonly judged: number;
  readonly round: number;
  readonly day: number;
  readonly assists?: Assists;
  readonly url?: string;
  /** The run's score, in a build where Endless is a run. */
  readonly score?: number;
  readonly curses?: number;
}): string {
  const notes = assistNotes(opts.assists);
  const souls = `${opts.judged} ${opts.judged === 1 ? 'soul' : 'souls'} judged rightly`;
  const curses = opts.curses ? [`${opts.curses} ${opts.curses === 1 ? 'curse' : 'curses'}`] : [];
  const tail = [...curses, ...notes];
  return [
    `${opts.title} · ${opts.label} (g${opts.genVersion})`,
    `${opts.score !== undefined ? `Score ${opts.score} · ` : ''}${souls} · round ${opts.round + 1}, Day ${opts.day}'s rules${tail.length > 0 ? ` · ${tail.join(', ')}` : ''}`,
    ...(opts.url ? [opts.url] : []),
  ].join('\n');
}
