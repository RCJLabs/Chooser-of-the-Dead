import { beatsDay, cleanAssists, GRADES, isRunSave, type RunSave } from '@cots/engine';
import type {
  DailyProgress,
  DailyRecord,
  DailyResult,
  DayBest,
  EndlessProgress,
  EndlessResult,
  Settings,
} from './store';

/*
 * What the game keeps on a device, and backups of it (docs/tech-spec.md §28).
 * Pure, so the rules can be tested: saves.ts does the storage.
 *
 * A backup is one file with everything a player would miss if the browser
 * cleared its data: campaign saves, Daily results, Endless records and any
 * unfinished run. Restoring merges it into what's here and never writes over
 * a newer save, a damaged one, or this device's own settings.
 */

/** One campaign slot as stored: the engine's save plus a revision, so the newer of two copies wins. */
export interface SlotRecord {
  readonly v: 1;
  readonly rev: number;
  /** Wall-clock time of the last write, for the slot list (and to tell which copy of a run is newer). */
  readonly savedAt: number;
  /** Clock time last seen with the sun running, so a reload refunds at most a few seconds. */
  readonly seenAt?: number;
  readonly save: RunSave;
}

/**
 * A stored slot the game can list: the engine's own check, plus what the slot list reads of each
 * morning, so a save broken inside is shown as unreadable instead of breaking the list.
 */
export const validSlot = (r: unknown): SlotRecord | null => {
  if (!isObject(r) || r.v !== 1 || typeof r.rev !== 'number' || !isRunSave(r.save)) return null;
  const mornings: readonly unknown[] = r.save.mornings;
  const last = mornings[mornings.length - 1];
  const listable =
    mornings.every((m) => isObject(m) && isInt(m.day) && typeof m.seed === 'string') &&
    isObject(last) &&
    typeof last.rings === 'number' &&
    Array.isArray(last.family);
  return listable ? (r as unknown as SlotRecord) : null;
};

export const newerSlot = (a: SlotRecord | null, b: SlotRecord | null): SlotRecord | null =>
  !a ? b : !b ? a : b.rev > a.rev ? b : a;

/** The run a slot holds: the seed it began from (the same run on two devices has the same seed). */
const runOf = (r: SlotRecord): string | undefined => r.save.mornings[0]?.seed;

export interface Backup {
  readonly format: 'cots.backup';
  readonly v: 1;
  /** When it was made (ISO 8601) and by which build, for the player and for bug reports. */
  readonly made: string;
  readonly build: { readonly target: string; readonly edition: string; readonly content: string };
  readonly settings: Settings;
  readonly daily: DailyRecord;
  readonly dailyProgress: DailyProgress | null;
  readonly endless: EndlessProgress | null;
  readonly slots: readonly (SlotRecord | null)[];
  /** What the device held but couldn't read (damaged, or from a newer version), kept as found. */
  readonly unreadable?: Readonly<Record<string, unknown>>;
}

export type Parsed =
  | { readonly ok: true; readonly backup: Backup }
  /** Not JSON at all; JSON but not a backup; a backup from a newer version of the game. */
  | { readonly ok: false; readonly why: 'notJson' | 'notBackup' | 'newer' };

/** Reads a backup's text. Only the envelope is checked here: each piece is checked again as it's merged. */
export function parseBackup(text: string): Parsed {
  let x: unknown;
  try {
    x = JSON.parse(text.trim());
  } catch {
    return { ok: false, why: 'notJson' };
  }
  if (!isObject(x) || x.format !== 'cots.backup' || typeof x.v !== 'number') return { ok: false, why: 'notBackup' };
  if (x.v > 1) return { ok: false, why: 'newer' };
  if (x.v !== 1 || !Array.isArray(x.slots)) return { ok: false, why: 'notBackup' };
  return { ok: true, backup: x as unknown as Backup };
}

/** What's on this device, as mergeBackup sees it. */
export interface Here {
  readonly settings: Settings;
  readonly daily: DailyRecord;
  readonly dailyProgress: DailyProgress | null;
  readonly endless: EndlessProgress | null;
  readonly slots: readonly (SlotRecord | null)[];
  /** Slots holding data this build can't read: never written over. */
  readonly unreadable: readonly boolean[];
}

export type SlotOutcome =
  /** Put in a free slot; the backup's copy of a run already here was newer and replaced it; this device's was kept. */
  | { readonly from: number; readonly to: number; readonly outcome: 'added' | 'replaced' | 'kept' }
  /** No free slot for it; this build can't play it (a full game's save in the demo); the backup's copy is damaged. */
  | { readonly from: number; readonly outcome: 'noRoom' | 'unplayable' | 'unreadable' };

export interface RestoreReport {
  /** Daily results new to this device. */
  readonly dailyAdded: number;
  readonly slots: readonly SlotOutcome[];
  /** An unfinished Endless run or Daily, taken on because this device had none. */
  readonly endlessRun: boolean;
  readonly dailyRun: boolean;
  /** A better Endless best, or endings, lessons or the primer this device hadn't recorded. */
  readonly records: boolean;
}

export interface MergeOptions {
  /** Today's Daily number: an unfinished Daily is taken on only if it's today's. */
  readonly today: number;
  /** The Daily's generator version here: an unfinished Daily only replays on the same one. */
  readonly g: number;
  /** Whether this build can play a campaign save (the demo can't play the full game's later days). */
  readonly playable: (save: RunSave) => boolean;
}

/**
 * Merges a backup into what's here. Results and records are added, never replaced. A campaign save
 * goes into its own slot if that's free, or the first free one; a run that's already here (the same
 * seed) keeps whichever copy was saved later. Settings stay this device's own (they're about the
 * screen, the sound and the player's consent), except for the records kept in them.
 */
export function mergeBackup(here: Here, b: Backup, opts: MergeOptions): { next: Here; report: RestoreReport } {
  const { settings, records } = mergeSettings(here.settings, b.settings);
  const { daily, added } = mergeDaily(here.daily, b.daily);

  const slots = [...here.slots];
  const outcomes: SlotOutcome[] = [];
  const free = (k: number) => slots[k] === null && !here.unreadable[k];
  for (const [from, raw] of b.slots.entries()) {
    if (raw === null || raw === undefined) continue;
    const theirs = validSlot(raw);
    if (!theirs) {
      outcomes.push({ from, outcome: 'unreadable' });
      continue;
    }
    if (!opts.playable(theirs.save)) {
      outcomes.push({ from, outcome: 'unplayable' });
      continue;
    }
    const same = slots.findIndex((r) => r !== null && runOf(r) === runOf(theirs));
    const mine = slots[same];
    if (mine) {
      const newer = savedAt(theirs) > savedAt(mine);
      if (newer) slots[same] = { ...theirs, rev: Math.max(mine.rev, theirs.rev) + 1 };
      outcomes.push({ from, to: same, outcome: newer ? 'replaced' : 'kept' });
      continue;
    }
    const to = from < slots.length && free(from) ? from : slots.findIndex((_, k) => free(k));
    if (to < 0) {
      outcomes.push({ from, outcome: 'noRoom' });
      continue;
    }
    slots[to] = theirs;
    outcomes.push({ from, to, outcome: 'added' });
  }

  // An unfinished run comes along only where there's none here, and never one already finished here.
  const run = b.endless;
  const endless =
    here.endless === null &&
    isEndlessProgress(run) &&
    !(run.mode.dated && run.mode.dated.n === settings.endlessToday?.n)
      ? run
      : here.endless;
  const p = b.dailyProgress;
  const dailyProgress =
    here.dailyProgress === null &&
    isDailyProgress(p) &&
    p.n === opts.today &&
    p.g === opts.g &&
    !(String(p.n) in daily.results)
      ? p
      : here.dailyProgress;

  return {
    next: { ...here, settings, daily, dailyProgress, endless, slots },
    report: {
      dailyAdded: added,
      slots: outcomes,
      endlessRun: endless !== here.endless,
      dailyRun: dailyProgress !== here.dailyProgress,
      records,
    },
  };
}

// ---------- the pieces ----------

function mergeSettings(here: Settings, theirs: unknown): { settings: Settings; records: boolean } {
  if (!isObject(theirs) || theirs.v !== 1) return { settings: here, records: false };
  const best = isCount(theirs.endlessBest) ? Math.max(here.endlessBest, theirs.endlessBest) : here.endlessBest;
  const endingsSeen = union(
    here.endingsSeen,
    listOf(theirs.endingsSeen, (x) => typeof x === 'string'),
  );
  const coached = union(here.coached, listOf(theirs.coached, isCount));
  const tips = union(
    here.tips,
    listOf(theirs.tips, (x) => typeof x === 'string'),
  );
  const primerDone = here.primerDone || theirs.primerDone === true;
  const endlessToday = later(here.endlessToday, isEndlessResult(theirs.endlessToday) ? theirs.endlessToday : null);
  const achievements = earliest(here.achievements, theirs.achievements);
  const dayBests = bestDays(here.dayBests, theirs.dayBests);
  const records =
    best !== here.endlessBest ||
    endingsSeen.length !== here.endingsSeen.length ||
    coached.length !== here.coached.length ||
    tips.length !== here.tips.length ||
    primerDone !== here.primerDone ||
    endlessToday !== here.endlessToday ||
    achievements !== here.achievements ||
    dayBests !== here.dayBests;
  if (!records) return { settings: here, records };
  return {
    settings: {
      ...here,
      endlessBest: best,
      endingsSeen,
      coached,
      tips,
      primerDone,
      endlessToday,
      achievements,
      dayBests,
    },
    records,
  };
}

/** Each day's better best of the two (docs/tech-spec.md §49); days this build doesn't have come along, as endings do. */
function bestDays(mine: Readonly<Record<string, DayBest>>, theirs: unknown): Readonly<Record<string, DayBest>> {
  if (!isObject(theirs)) return mine;
  let merged: Record<string, DayBest> | null = null;
  for (const [day, b] of Object.entries(theirs)) {
    if (!/^[0-9]+$/.test(day) || !isDayBest(b) || !beatsDay(b, mine[day])) continue;
    merged ??= { ...mine };
    merged[day] = {
      grade: b.grade,
      spareMs: b.spareMs,
      ...(b.assisted === true ? { assisted: true as const } : {}),
      ...(b.oath === true ? { oath: true as const } : {}),
    };
  }
  return merged ?? mine;
}

const isDayBest = (x: unknown): x is DayBest =>
  isObject(x) && typeof x.grade === 'string' && (GRADES as readonly string[]).includes(x.grade) && isCount(x.spareMs);

/**
 * Achievements from both, each at the earlier time it was earned. Ids this build doesn't have come along
 * too, as endings do: a backup from the full game keeps them when it goes through the demo.
 */
function earliest(mine: Readonly<Record<string, number>>, theirs: unknown): Readonly<Record<string, number>> {
  if (!isObject(theirs)) return mine;
  let merged: Record<string, number> | null = null;
  for (const [id, at] of Object.entries(theirs)) {
    const have = mine[id];
    if (!isCount(at) || (have !== undefined && have <= at)) continue;
    merged ??= { ...mine };
    merged[id] = at;
  }
  return merged ?? mine;
}

function mergeDaily(here: DailyRecord, theirs: unknown): { daily: DailyRecord; added: number } {
  if (!isObject(theirs) || theirs.v !== 1 || !isObject(theirs.results)) return { daily: here, added: 0 };
  const results: Record<string, DailyResult> = { ...here.results };
  let added = 0;
  for (const [k, r] of Object.entries(theirs.results)) {
    if (k in results || !isDailyResult(r) || String(r.n) !== k) continue;
    results[k] = r.assists ? { ...r, assists: cleanAssists(r.assists) } : r;
    added++;
  }
  return added > 0 ? { daily: { v: 1, results }, added } : { daily: here, added };
}

/** The later day's Endless result; this device's when they're the same day. */
function later(a: EndlessResult | null, b: EndlessResult | null): EndlessResult | null {
  if (!a || !b) return a ?? b;
  return b.n > a.n ? b : a;
}

const savedAt = (r: SlotRecord): number => (typeof r.savedAt === 'number' ? r.savedAt : 0);

function union<T>(mine: readonly T[], theirs: readonly T[]): readonly T[] {
  const extra = theirs.filter((x, i) => !mine.includes(x) && theirs.indexOf(x) === i);
  return extra.length > 0 ? [...mine, ...extra] : mine;
}

function listOf<T>(x: unknown, is: (y: unknown) => boolean): T[] {
  return Array.isArray(x) ? (x.filter(is) as T[]) : [];
}

// ---------- checks for what a backup (or anything else read back) claims to be ----------

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

const isInt = (x: unknown): x is number => Number.isSafeInteger(x);
const isCount = (x: unknown): x is number => isInt(x) && x >= 0;
const isAction = (a: unknown): boolean => isObject(a) && typeof a.t === 'string' && typeof a.at === 'number';

export function isDailyResult(x: unknown): x is DailyResult {
  return (
    isObject(x) &&
    isInt(x.n) &&
    isInt(x.g) &&
    isCount(x.correct) &&
    isCount(x.total) &&
    x.correct <= x.total &&
    typeof x.spareMs === 'number' &&
    x.spareMs >= 0 &&
    (x.endedBy === 'queue' || x.endedBy === 'dusk') &&
    typeof x.marks === 'string' &&
    x.marks.length <= 400 &&
    (x.guard === undefined || x.guard === 'ok' || x.guard === 'mismatch' || x.guard === 'unchecked') &&
    (x.assists === undefined || isObject(x.assists))
  );
}

function isDated(x: unknown): boolean {
  return isObject(x) && isInt(x.n) && typeof x.date === 'string' && typeof x.preview === 'boolean';
}

export function isEndlessResult(x: unknown): x is EndlessResult {
  return (
    isDated(x) &&
    isObject(x) &&
    isInt(x.g) &&
    isCount(x.judged) &&
    isCount(x.round) &&
    isInt(x.day) &&
    (x.tracker === undefined || typeof x.tracker === 'boolean')
  );
}

export function isEndlessProgress(x: unknown): x is EndlessProgress {
  if (!isObject(x) || x.v !== 1 || !isInt(x.g) || !isCount(x.judged) || !isCount(x.strikes)) return false;
  const m = x.mode;
  return (
    Array.isArray(x.actions) &&
    x.actions.every(isAction) &&
    isObject(m) &&
    m.kind === 'endless' &&
    typeof m.seed === 'string' &&
    isCount(m.round) &&
    isInt(m.day) &&
    isCount(m.judged) &&
    isCount(m.strikes) &&
    isCount(m.bestBefore) &&
    typeof m.tracker === 'boolean' &&
    (m.dated === null || isDated(m.dated))
  );
}

export function isDailyProgress(x: unknown): x is DailyProgress {
  return (
    isObject(x) &&
    x.v === 1 &&
    isInt(x.n) &&
    isInt(x.g) &&
    Array.isArray(x.actions) &&
    x.actions.every(isAction) &&
    (x.seenAt === undefined || typeof x.seenAt === 'number')
  );
}
