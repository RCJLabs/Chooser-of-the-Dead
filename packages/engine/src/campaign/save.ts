import type { Content, Faction } from '../content/types';
import type { CaseSpec } from '../gen/types';
import type { DayCtx } from '../logic/context';
import { dayContext } from './events';
import { type NewRunOptions, newRun, type RunAction, type RunEnv, stepRun } from './run';
import type { FamilyMember, RunState } from './state';

/**
 * A scene as the player played it, so the journal can show it again: the
 * choices made and what the scene could read of the run as it began (the
 * save keeps no older days' actions to rebuild that from).
 */
export interface JournalEntry {
  readonly day: number;
  readonly scene: string;
  readonly choices: readonly number[];
  readonly rings: number;
  readonly flags: Readonly<Record<string, number>>;
  readonly standing: Readonly<Record<Faction, number>>;
  readonly family: Readonly<Record<string, FamilyMember['status']>>;
  /**
   * How the chooser had judged, as letters read it (docs/tech-spec.md §74): the word among the dead (§73) and the
   * souls sent wrong so far. Absent in entries from before letters read them, which read them as 0.
   */
  readonly word?: number;
  readonly wrong?: number;
}

/**
 * A campaign save (docs/tech-spec.md §7): the run as it stood each morning
 * (so any day can be replayed from its start, as in Papers, Please), plus
 * today's actions and today's queue once it exists. The queue is stored,
 * not regenerated, so a mid-day resume stays exact after a generator update.
 */
export interface RunSave {
  readonly format: 'cots.run';
  readonly v: 1;
  /** ENGINE_MAJOR when saved: a different engine can't replay `log`, so it restarts the day. */
  readonly engine: number;
  /** The run at the start of each day played, oldest first. */
  readonly mornings: readonly RunState[];
  /** Actions since the latest morning. */
  readonly log: readonly RunAction[];
  /** Today's queue, once the shift has begun. */
  readonly queue: readonly CaseSpec[] | null;
  /** Every scene played, oldest first (absent in saves from before the journal). */
  readonly journal?: readonly JournalEntry[];
}

/** The souls the run has sent wrong so far, over every audit (docs/tech-spec.md §74): what letters from home read. */
export const wrongSoFar = (run: Pick<RunState, 'ledger'>): number => run.ledger.reduce((n, l) => n + l.wrong, 0);

/** The context the run plays today in, its day event (docs/tech-spec.md §52) included. */
export function runContext(content: Content, run: RunState): DayCtx {
  return dayContext(content, run, run.day);
}

export function startSave(content: Content, seed: string, engine: number, opts: NewRunOptions = {}): RunSave {
  return { format: 'cots.run', v: 1, engine, mornings: [newRun(content, seed, opts)], log: [], queue: null };
}

/**
 * Records an action taken on `before` (the result is `after`), starting a new morning when the day turns.
 * A scene that played goes in the journal; one played again (a day restarted) replaces its old entry.
 */
export function recordAction(save: RunSave, before: RunState, action: RunAction, after: RunState): RunSave {
  const next = action.t === 'scene' && after !== before ? { ...save, journal: noted(save, before, action) } : save;
  if (after.day !== before.day && after.phase === 'morning') {
    return { ...next, mornings: [...next.mornings, after], log: [], queue: null };
  }
  const queue = next.queue ?? (after.shift ? after.shift.cases : null);
  return { ...next, log: [...next.log, action], queue };
}

function noted(save: RunSave, before: RunState, action: Extract<RunAction, { t: 'scene' }>): JournalEntry[] {
  const entry: JournalEntry = {
    day: before.day,
    scene: action.id,
    choices: action.choices ?? [],
    rings: before.rings,
    flags: before.flags,
    standing: before.standing,
    family: Object.fromEntries(before.family.map((m) => [m.id, m.status])),
    word: before.word ?? 0,
    wrong: wrongSoFar(before),
  };
  return [...(save.journal ?? []).filter((e) => e.day !== entry.day || e.scene !== entry.scene), entry];
}

/**
 * Rebuilds the current run from a save. If the engine changed since it was
 * saved, today's actions can't be trusted to replay the same way, so the day
 * restarts from its morning ("the Norns rewound the day").
 */
export function resumeSave(save: RunSave, content: Content, engine: number): { run: RunState; rewound: boolean } {
  const morning = save.mornings[save.mornings.length - 1];
  if (!morning) throw new Error('A save needs at least one morning');
  if (save.engine !== engine) return { run: morning, rewound: save.log.length > 0 };
  let run = morning;
  const ctx = runContext(content, run);
  for (const action of save.log) {
    const env: RunEnv = { content, ctx, ...(save.queue ? { queue: save.queue } : {}) };
    run = stepRun(run, action, env).state;
  }
  return { run, rewound: false };
}

/**
 * Days that can be replayed from their start (every morning in the save), none for a run under the oath
 * (docs/tech-spec.md §49). The game can still start the day again itself when an update can't replay it.
 */
export function replayableDays(save: RunSave): number[] {
  if (save.mornings[save.mornings.length - 1]?.oath) return [];
  return save.mornings.map((m) => m.day);
}

/** Goes back to the morning of `day`, discarding every later day (and what the journal kept of them). */
export function replayDay(save: RunSave, day: number): RunSave {
  const i = save.mornings.findIndex((m) => m.day === day);
  if (i < 0) throw new RangeError(`No morning saved for day ${day}`);
  const journal = save.journal ? { journal: save.journal.filter((e) => e.day < day) } : {};
  return { ...save, mornings: save.mornings.slice(0, i + 1), log: [], queue: null, ...journal };
}

/** A structural check for saves read back from storage (anything else is treated as missing). */
export function isRunSave(x: unknown): x is RunSave {
  if (typeof x !== 'object' || x === null) return false;
  const s = x as Partial<RunSave>;
  return (
    s.format === 'cots.run' &&
    s.v === 1 &&
    typeof s.engine === 'number' &&
    Array.isArray(s.mornings) &&
    s.mornings.length > 0 &&
    Array.isArray(s.log) &&
    (s.queue === null || Array.isArray(s.queue)) &&
    (s.journal === undefined || Array.isArray(s.journal))
  );
}
