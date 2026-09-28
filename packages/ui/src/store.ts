import { dailyChecks, dailyContent, gameContent, manifest } from 'virtual:content';
import {
  type AchievementMoment,
  type Assists,
  beatsDay,
  type CivilDate,
  type Content,
  canPick,
  cleanAssists,
  DAILY_EPOCH,
  type DayCtx,
  type DayGrade,
  type DayRequest,
  type Destination,
  dailyDate,
  dailyNumber,
  dailySeed,
  type EndlessOffer,
  type EndlessPick,
  earnedAt,
  endlessConfig,
  endlessContext,
  endlessOffer,
  endlessRound,
  endlessSeed,
  endlessShareText,
  expectedChecksum,
  type GradeId,
  type GuardResult,
  guardDaily,
  hasBoons,
  type PlayMode,
  queueChecksum,
  type RunRules,
  runRules,
  type ShiftAction,
  type ShiftEvent,
  type ShiftState,
  shareMarks,
  shareText,
  shiftFacts,
  shiftScore,
  soulFacts,
  startShift,
  stepShift,
  sunLeft,
  tallyEvent,
  type Verdict,
} from '@cots/engine';
import { isPersisted, type KeyValueStore, memoryStore, requestPersistence, type ShareResult } from '@cots/platform';
import { platform } from '@platform';
import { batch, signal } from '@preact/signals';
import { holdAudio, play, soundFor } from './audio';
import { t } from './i18n';
import { type LayoutMode, layoutMode } from './layout';
import { links } from './links';
import { activeLesson, type CoachState } from './shift/coach';
import { hintTarget } from './shift/hint';
import type { DeskPapers } from './shift/papers';
import { sendGuard, sendShift } from './telemetry';
import { type BuildInfo, shiftRecord } from './telemetry-payload';

/*
 * App state. The engine's shift is pure; this module owns time (a monotonic
 * clock), persistence and the transient UI around it. Components read the
 * signals and call the functions below.
 */

// ---------- clock ----------

let clockOffset = 0;
/** Monotonic integer ms. Continues across a reload when an in-progress Daily is resumed. */
export const clock = (): number => Math.round(performance.now()) + clockOffset;
/** Makes the clock read at least `at` from now on, so a resumed shift carries on its own timeline. */
export function resumeClockAt(at: number): void {
  if (clock() < at) clockOffset = at - Math.round(performance.now());
}
/** Updated four times a second while a shift runs; the sun display reads it. */
export const now = signal(0);

// ---------- settings ----------

export interface Settings {
  readonly v: 1;
  readonly layout: 'auto' | LayoutMode;
  readonly textScale: number;
  readonly holdToSend: boolean;
  readonly untimedPractice: boolean;
  /** Opt-in alpha telemetry. Off until the player says yes. */
  readonly telemetry: boolean;
  /** Whether the one-time telemetry question has been answered. */
  readonly telemetryAsked: boolean;
  readonly primerDone: boolean;
  /** Sound volume, 0 (off) to 1: everything. */
  readonly sound: number;
  /** Music and ambience, 0 to 1, within that (docs/tech-spec.md §39); offered only in a build that has them. */
  readonly music: number;
  readonly ambience: number;
  /** Endless: the most souls judged rightly in one run on this device. */
  readonly endlessBest: number;
  /** The latest day's Endless run finished here (today's, once it's played). */
  readonly endlessToday: EndlessResult | null;
  /** Campaign endings reached on this device, in any slot or run, first found first. */
  readonly endingsSeen: readonly string[];
  /** Assists (docs/tech-spec.md §24): the sun's speed in percent, the rule tracker, no campaign fines. */
  readonly sunPct: number;
  readonly ruleTracker: boolean;
  readonly noFines: boolean;
  /** The coach's lessons for each day's new rule or tool (docs/tech-spec.md §25), and the days taught here. */
  readonly coach: boolean;
  readonly coached: readonly number[];
  /** One-time tips put away on this device: `press`, pressing a soul on what it said (docs/tech-spec.md §66). */
  readonly tips: readonly string[];
  /** Leave out the desk's decorative movement (docs/tech-spec.md §33), whatever the device says. */
  readonly reduceMotion: boolean;
  /** Papers moved on the desk layout, and where they lie (docs/tech-spec.md §33). Empty: all in their places. */
  readonly deskPapers: DeskPapers;
  /** Achievements earned on this device (docs/tech-spec.md §34), each with the time it was first earned. */
  readonly achievements: Readonly<Record<string, number>>;
  /** Each campaign day's best on this device, by day (docs/tech-spec.md §49). */
  readonly dayBests: Readonly<Record<string, DayBest>>;
}

/** A campaign day's best on this device (docs/tech-spec.md §49): its grade, the sun to spare, and how it was played. */
export interface DayBest {
  readonly grade: GradeId;
  readonly spareMs: number;
  /** With a slower sun or the rule tracker. */
  readonly assisted?: true;
  /** In a run under the oath. */
  readonly oath?: true;
}

export const DEFAULT_SETTINGS: Settings = {
  v: 1,
  layout: 'auto',
  textScale: 1,
  holdToSend: true,
  untimedPractice: false,
  telemetry: false,
  telemetryAsked: false,
  primerDone: false,
  sound: 0.6,
  music: 0.7,
  ambience: 0.8,
  endlessBest: 0,
  endlessToday: null,
  endingsSeen: [],
  sunPct: 100,
  ruleTracker: false,
  noFines: false,
  coach: true,
  coached: [],
  tips: [],
  reduceMotion: false,
  deskPapers: {},
  achievements: {},
  dayBests: {},
};

export const settings = signal<Settings>(DEFAULT_SETTINGS);

export function effectiveLayout(): LayoutMode {
  const s = settings.value.layout;
  return s === 'auto' ? layoutMode.value : s;
}

/**
 * The assists as set now, for the next shift. Waiving fines only means something in the campaign, and the
 * sun's speed nothing in a shift without a sun.
 */
export function currentAssists(campaign = false, untimed = false): Assists {
  const s = settings.value;
  return cleanAssists({
    ...(untimed ? {} : { sunPct: s.sunPct }),
    tracker: s.ruleTracker,
    ...(campaign ? { noFines: s.noFines } : {}),
  });
}

/** Who still needs a lesson (reactive when read in a component). */
export function coachState(): CoachState {
  const s = settings.value;
  return { coached: s.coached, primerDone: s.primerDone, on: s.coach, tips: s.tips };
}

/** Remembers that a day's lesson has been taught (or skipped) on this device. */
export function noteCoached(day: number): void {
  if (!settings.peek().coached.includes(day)) updateSettings({ coached: [...settings.peek().coached, day] });
}

/** Remembers that a one-time tip has been read on this device. */
export function noteTip(id: string): void {
  if (!settings.peek().tips.includes(id)) updateSettings({ tips: [...settings.peek().tips, id] });
}

/** Remembers that a campaign ending was reached here (for the endings gallery). */
export function noteEnding(id: string): void {
  if (!settings.peek().endingsSeen.includes(id)) updateSettings({ endingsSeen: [...settings.peek().endingsSeen, id] });
}

// ---------- achievements (docs/tech-spec.md §34) ----------

/**
 * Achievements earned and not yet announced. The notice (App's AchievementNote) waits for a screen that
 * isn't a shift: nothing covers the desk while the sun runs.
 */
export const unannounced = signal<readonly string[]>([]);

/** How a session is played, as achievements see it: only the day's Daily played for the record is `daily`. */
export function playMode(mode: Mode): PlayMode | null {
  // An appeal re-hears one soul already judged: it earns nothing on its own (docs/tech-spec.md §40).
  if (mode.kind === 'appeal' || mode.kind === 'again') return null;
  return mode.kind === 'daily' ? (mode.ranked ? 'daily' : 'archive') : mode.kind;
}

/**
 * Keeps what these moments earn: the time it was first earned here, a notice, and the platform's own
 * achievements (Steam's and Google Play's, once those builds exist; a no-op on the web).
 */
export function unlock(...moments: AchievementMoment[]): void {
  const defs = gameContent.achievements ?? [];
  const have = settings.peek().achievements;
  const fresh: string[] = [];
  for (const m of moments) fresh.push(...earnedAt(defs, m, (id) => Object.hasOwn(have, id) || fresh.includes(id)));
  if (fresh.length === 0) return;
  const at = Date.now();
  updateSettings({ achievements: { ...have, ...Object.fromEntries(fresh.map((id) => [id, at])) } });
  for (const id of fresh) platform.unlockAchievement(id);
  unannounced.value = [...unannounced.peek(), ...fresh];
}

/** A Daily result as achievements see it: what the record keeps (not hints, say, so nothing that needs them). */
function dailyFacts(r: DailyResult): Readonly<Record<string, number>> {
  const pct = r.assists?.sunPct ?? 100;
  const sunMs = Math.floor(((dailyContent?.daily?.sunS ?? 0) * 1000 * 100) / pct);
  return {
    total: r.total,
    correct: r.correct,
    perfect: r.total > 0 && r.correct === r.total ? 1 : 0,
    dusk: r.endedBy === 'dusk' ? 1 : 0,
    sunLeft: sunMs > 0 && r.endedBy === 'queue' ? Math.floor((r.spareMs * 100) / sunMs) : 0,
    assisted: r.assists && Object.keys(cleanAssists(r.assists)).length > 0 ? 1 : 0,
  };
}

/**
 * Grants what this device's records already show (endings found, the Endless best, Dailies played for
 * the record, from before achievements were kept or from a backup), and tells the platform about every
 * achievement earned here, which it takes as often as it's told.
 */
export function settleAchievements(): void {
  const s = settings.peek();
  unlock(
    ...s.endingsSeen.map((ending): AchievementMoment => ({ at: 'ending', ending })),
    { at: 'endless', facts: { score: s.endlessBest } },
    ...Object.values(dailyRecord.peek().results).map(
      (r): AchievementMoment => ({ at: 'shift', mode: 'daily', facts: dailyFacts(r) }),
    ),
  );
  for (const id of Object.keys(settings.peek().achievements)) platform.unlockAchievement(id);
}

export function updateSettings(patch: Partial<Settings>): void {
  settings.value = { ...settings.value, ...patch };
  applySettings();
  mirror(MIRROR.settings, settings.value);
  void store?.set('settings', settings.value);
}

/**
 * Keeps a campaign day's grade as its best on this device when it beats the one kept (docs/tech-spec.md §49): a
 * better grade; at the same grade, one played without assists; then more sun to spare.
 */
export function noteDayBest(day: number, grade: DayGrade, oath: boolean): void {
  const bests = settings.peek().dayBests;
  if (!beatsDay(grade, bests[String(day)])) return;
  const best: DayBest = {
    grade: grade.grade,
    spareMs: grade.spareMs,
    ...(grade.assisted ? { assisted: true as const } : {}),
    ...(oath ? { oath: true as const } : {}),
  };
  updateSettings({ dayBests: { ...bests, [String(day)]: best } });
}

/**
 * From this text size up, a phone's shift scrolls like a page instead of fitting the screen: fixed heights
 * would leave the evidence a few lines and push Pause and Judge off a small phone (docs/tech-spec.md §35).
 */
export const LARGE_TEXT = 1.4;

function applySettings(): void {
  const root = document.documentElement;
  root.style.fontSize = `${Math.round(settings.value.textScale * 100)}%`;
  if (settings.value.textScale >= LARGE_TEXT) root.dataset.text = 'large';
  else delete root.dataset.text;
  // The stylesheet stills every animation under this, as it does for the device's own setting.
  if (settings.value.reduceMotion) root.dataset.motion = 'reduced';
  else delete root.dataset.motion;
}

// ---------- Daily records ----------

export interface DailyResult {
  readonly n: number;
  readonly g: number;
  readonly correct: number;
  readonly total: number;
  readonly spareMs: number;
  readonly endedBy: 'queue' | 'dusk';
  readonly marks: string;
  /** Whether this device's Daily matched the build's checksum table. */
  readonly guard?: GuardResult;
  /** The assists it was played with (absent when none). */
  readonly assists?: Assists;
}

export interface DailyRecord {
  readonly v: 1;
  readonly results: Readonly<Record<string, DailyResult>>;
}

/** The Daily being played, saved after every action so a reload can't reroll or rewind it. */
export interface DailyProgress {
  readonly v: 1;
  readonly n: number;
  readonly g: number;
  readonly actions: readonly ShiftAction[];
  /** Clock time last seen with the sun running (a 5 s heartbeat), so a reload refunds at most that. */
  readonly seenAt?: number;
}

export const dailyRecord = signal<DailyRecord>({ v: 1, results: {} });
export const dailyProgress = signal<DailyProgress | null>(null);
export const storageReady = signal(false);

let store: KeyValueStore | null = null;

/*
 * Where this build keeps things in the browser. Builds share one place unless their target names its own (the
 * playtest build, docs/tech-spec.md §38): then its localStorage keys and its database carry that name.
 */
const own = manifest.storage;
/** This build's localStorage key for `name`. */
export const localKey = (name: string): string => (own ? `cots.${own}.${name}` : `cots.${name}`);
/** This build's IndexedDB database, when not the shared one. */
const ownDb = own ? `chooser-of-the-slain.${own}` : undefined;

/*
 * Daily progress and results are also mirrored to localStorage, which writes
 * synchronously. An IndexedDB write still in flight is lost if the page
 * unloads, and losing a just-sent soul or a finished result would let the
 * Daily be played again.
 */
const MIRROR = {
  progress: localKey('daily-progress'),
  record: localKey('daily'),
  settings: localKey('settings'),
  endless: localKey('endless-progress'),
} as const;

export function mirror(key: string, value: unknown): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage blocked or full: IndexedDB still has it.
  }
}

export function readMirror<T>(key: string): T | undefined {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}

/** The mirror's text as stored, readable or not (null when there's none). */
export function readMirrorRaw(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

const parsed = (raw: string | null): unknown => {
  try {
    return raw === null ? undefined : JSON.parse(raw);
  } catch {
    return undefined;
  }
};

const isV1 = (x: unknown): boolean => typeof x === 'object' && x !== null && (x as { v?: unknown }).v === 1;

/**
 * Keeps a copy this build can't read (damaged, or from a newer version) under `<key>.unread` before
 * anything writes over it. Backups carry it, so it can still be looked at or recovered.
 */
function setAside(key: string, stored: unknown, mirrorRaw: string | null): void {
  const found = {
    ...(stored !== undefined && !isV1(stored) ? { stored } : {}),
    ...(mirrorRaw !== null && !isV1(parsed(mirrorRaw)) ? { mirror: mirrorRaw } : {}),
  };
  if (Object.keys(found).length > 0) void store?.set(`${key}.unread`, found);
}

/** Keys that setAside may have used, for backups. */
export const UNREAD_KEYS = ['settings.unread', 'daily.unread'] as const;

/**
 * Whether this device will keep the saves: the browser has agreed to ('kept'), it may clear them after
 * a while unused ('maybe': Safari does after 7 days), or they last only as long as the tab ('session':
 * a private window, or storage blocked). Null until storage is open.
 */
export const storageKept = signal<'kept' | 'maybe' | 'session' | null>(null);

let keepAsked: Promise<boolean> | null = null;

/** Asks the browser, once a session, not to clear the saves. Called when there's something worth keeping. */
export function keepStorage(): Promise<boolean> {
  keepAsked ??= requestPersistence().then((kept) => {
    if (kept) storageKept.value = 'kept';
    return kept;
  });
  return keepAsked;
}

async function checkKept(s: KeyValueStore): Promise<void> {
  if (!s.persistent) storageKept.value = 'session';
  // The Steam and Play builds keep their saves as app data, which nothing clears behind the player's back.
  else if (platform.kind === 'electron' || platform.kind === 'android') storageKept.value = 'kept';
  else storageKept.value = (await isPersisted()) ? 'kept' : 'maybe';
}

export function saveDailyRecord(record: DailyRecord): void {
  dailyRecord.value = record;
  mirror(MIRROR.record, record);
  void store?.set('daily', record);
}

export function saveDailyProgress(progress: DailyProgress | null): void {
  dailyProgress.value = progress;
  mirror(MIRROR.progress, progress);
  void (progress ? store?.set('daily-progress', progress) : store?.remove('daily-progress'));
}

export function saveEndlessProgress(progress: EndlessProgress | null): void {
  endlessProgress.value = progress;
  mirror(MIRROR.endless, progress);
  void (progress ? store?.set('endless-progress', progress) : store?.remove('endless-progress'));
}

function mergeRecords(a: DailyRecord | undefined, b: DailyRecord | undefined): DailyRecord {
  return { v: 1, results: { ...(a?.v === 1 ? a.results : {}), ...(b?.v === 1 ? b.results : {}) } };
}

/** The fuller of two saves of the same Daily (or the later Daily). */
function newest(a: DailyProgress | undefined, b: DailyProgress | undefined): DailyProgress | undefined {
  if (a?.v !== 1) return b?.v === 1 ? b : undefined;
  if (b?.v !== 1) return a;
  if (a.n !== b.n) return a.n > b.n ? a : b;
  return b.actions.length > a.actions.length || (b.seenAt ?? 0) > (a.seenAt ?? 0) ? b : a;
}

/** The further along of two saves of an Endless run; `b` is the mirror, never older when they differ. */
function furthest(a: EndlessProgress | undefined, b: EndlessProgress | undefined): EndlessProgress | undefined {
  if (a?.v !== 1) return b?.v === 1 ? b : undefined;
  if (b?.v !== 1 || a.mode.seed !== b.mode.seed) return b?.v === 1 ? b : a;
  if (a.mode.round !== b.mode.round) return a.mode.round > b.mode.round ? a : b;
  return a.actions.length > b.actions.length ? a : b;
}

/** The key-value store, once initStorage has opened it. */
export const kvStore = (): KeyValueStore | null => store;

export async function initStorage(): Promise<void> {
  try {
    store = await platform.openStore(ownDb);
  } catch {
    store = memoryStore();
  }
  const [s, record, progress, endless] = await Promise.all([
    store.get<Settings>('settings'),
    store.get<DailyRecord>('daily'),
    store.get<DailyProgress>('daily-progress'),
    store.get<EndlessProgress>('endless-progress'),
  ]);
  setAside('settings', s, readMirrorRaw(MIRROR.settings));
  setAside('daily', record, readMirrorRaw(MIRROR.record));
  void checkKept(store);
  batch(() => {
    // The synchronous copy is never older than IndexedDB's.
    const saved = readMirror<Settings>(MIRROR.settings) ?? s;
    if (saved?.v === 1) settings.value = { ...DEFAULT_SETTINGS, ...saved };
    dailyRecord.value = mergeRecords(record, readMirror<DailyRecord>(MIRROR.record));
    dailyProgress.value = newest(progress, readMirror<DailyProgress>(MIRROR.progress)) ?? null;
    const run = furthest(endless, readMirror<EndlessProgress>(MIRROR.endless));
    // A day's run already recorded is over, whatever a slower store still holds.
    const recorded = run?.mode.dated && run.mode.dated.n === settings.value.endlessToday?.n;
    endlessProgress.value = run && !recorded ? run : null;
    storageReady.value = true;
  });
  applySettings();
  settleAchievements();
}

/** A day's Endless run: the same souls for everyone on that date, numbered like the Daily. */
export interface DatedRun {
  readonly n: number;
  readonly date: string;
  readonly preview: boolean;
}

/** How a day's Endless run went here: the title card shows it and shares it. */
export interface EndlessResult extends DatedRun {
  readonly g: number;
  readonly judged: number;
  readonly round: number;
  readonly day: number;
  readonly tracker?: boolean;
  /** Where Endless is a run (docs/tech-spec.md §68): its score, the curses it took, the slowest sun it had. */
  readonly score?: number;
  readonly curses?: number;
  readonly sunPct?: number;
}

/** The Endless run being played, saved after every action so a reload resumes it (docs/tech-spec.md §27). */
export interface EndlessProgress {
  readonly v: 1;
  readonly g: number;
  /** The run as its current round began. */
  readonly mode: EndlessMode;
  /** The round's actions so far. */
  readonly actions: readonly ShiftAction[];
  /** The score and strikes as they stand, for the title card. */
  readonly judged: number;
  readonly strikes: number;
  /** The run's score as it stands, where Endless is a run (docs/tech-spec.md §68). */
  readonly score?: number;
}

export const endlessProgress = signal<EndlessProgress | null>(null);

export function todayLocal(): CivilDate {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
}

export const isoDate = ({ year, month, day }: CivilDate): string =>
  `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

export const epochText = (): string => isoDate(DAILY_EPOCH);

export interface Streak {
  readonly current: number;
  readonly best: number;
}

/** Consecutive Dailies played to the end, up to today (or yesterday, if today isn't played yet). */
export function streakOf(record: DailyRecord, today: number): Streak {
  const played = new Set(Object.values(record.results).map((r) => r.n));
  let current = 0;
  for (let k = played.has(today) ? today : today - 1; played.has(k); k--) current++;
  const sorted = [...played].sort((a, b) => a - b);
  let best = 0;
  let run = 0;
  sorted.forEach((n, i) => {
    run = i > 0 && sorted[i - 1] === n - 1 ? run + 1 : 1;
    best = Math.max(best, run);
  });
  return { current, best };
}

// ---------- the shift session ----------

export type Mode =
  | {
      readonly kind: 'daily';
      readonly n: number;
      readonly date: string;
      readonly preview: boolean;
      readonly ranked: boolean;
      /** A past Daily from the archive: played for its own sake, never recorded. */
      readonly archive: boolean;
      /** This device's checksum for the Daily, and whether it matched the build's table. */
      readonly checksum: string;
      readonly guard: GuardResult;
    }
  | { readonly kind: 'practice'; readonly day: number }
  | EndlessMode
  | { readonly kind: 'primer' }
  | {
      readonly kind: 'campaign';
      readonly day: number;
      readonly story: boolean;
      /** The gods' requests today (docs/tech-spec.md §42), for the desk to count. */
      readonly requests?: readonly DayRequest[];
    }
  /** A soul from an earlier campaign day judged again at the desk (docs/tech-spec.md §40). */
  | { readonly kind: 'appeal'; readonly day: number; readonly stamped: Destination }
  /** A judged soul tried again on its own, with no sun, for nothing (docs/tech-spec.md §67). */
  | { readonly kind: 'again'; readonly day: number; readonly name: string };

/** Endless (docs/m7-design.md): rounds of five souls on each day's rules in turn, until three strikes. */
export interface EndlessMode {
  readonly kind: 'endless';
  /** The run's seed; each round's comes from it (endlessRound). */
  readonly seed: string;
  readonly round: number;
  readonly day: number;
  /** Wrong stamps so far. */
  readonly strikes: number;
  /** Souls judged rightly so far: the score. */
  readonly judged: number;
  /** The best score when the run began, to tell a new best. */
  readonly bestBefore: number;
  /** The day's run, the same souls for everyone that date; null for a free run (a seed of its own). */
  readonly dated: DatedRun | null;
  /** Whether any round began with the rule tracker on (its share text says so). */
  readonly tracker: boolean;
  /**
   * Where Endless is a run (docs/tech-spec.md §68): the score (each soul judged rightly scores its worth), the boons
   * and curses chosen between rounds, and the hints used. A run saved before them has none: a round's session sets them.
   */
  readonly score?: number;
  readonly picks?: readonly EndlessPick[];
  readonly hintsUsed?: number;
  /** The slowest sun speed a round under the sun began with, other than as designed (its share text says so). */
  readonly sunPct?: number;
}

export interface Session {
  readonly mode: Mode;
  readonly content: Content;
  readonly ctx: DayCtx;
  /** The shift as generated, before any action (traces replay from it). */
  readonly initial: ShiftState;
  readonly state: ShiftState;
  readonly actions: readonly ShiftAction[];
  /** Steps the shift instead of stepShift: a campaign steps its whole run (campaign/run-store.ts). */
  readonly step?: (
    state: ShiftState,
    action: ShiftAction,
  ) => {
    readonly state: ShiftState;
    readonly events: readonly ShiftEvent[];
  };
  /** Called every few seconds while the sun runs, to save how far it got. */
  readonly heartbeat?: () => void;
  /** An Endless run as its round began: what its save keeps, with the round's actions (docs/tech-spec.md §27). */
  readonly roundStart?: EndlessMode;
  /** Takes over when the shift is done, instead of the summary (an appeal goes back to its morning). */
  readonly done?: (s: Session) => void;
  /** What leaving it from the pause does, instead of going to the title. */
  readonly leave?: () => void;
}

/** What telemetry and reports say about this build. */
export function buildInfo(content: Content): BuildInfo {
  return { target: manifest.target, content: manifest.contentHash, g: content.genVersion };
}

/**
 * The telemetry endpoint, if this build may use one. Only the web and itch
 * builds (the alpha) ever send; the Steam and Play builds ignore the setting,
 * matching the privacy note and Play's "no data collected".
 */
export const telemetryBase = (): string | undefined =>
  platform.kind === 'web' || platform.kind === 'itch' ? links.telemetry : undefined;

export const telemetryAvailable = (): boolean => telemetryBase() !== undefined;

export type Screen =
  | 'title'
  | 'briefing'
  | 'shift'
  | 'summary'
  | 'endless'
  | 'campaign'
  | 'morning'
  | 'audit'
  | 'night'
  /** The last battle (docs/tech-spec.md §54): the hosts sent to the fronts, and how it went. */
  | 'ragnarok'
  | 'battle'
  | 'ending';

export const screen = signal<Screen>('title');
export const session = signal<Session | null>(null);

// Transient UI around the current soul.
export interface Toast {
  readonly id: number;
  readonly text: string;
  readonly tone: 'good' | 'bad' | 'info';
}
export const toast = signal<Toast | null>(null);
/** What a soul said when questioned or pressed: its lines, and anything it added to its words (a press's). */
export interface Answer {
  readonly name: string;
  /** Instead of "{name} answers": how a pressed soul took it. */
  readonly title?: string;
  readonly lines: readonly string[];
  readonly added?: string;
}

export const answer = signal<Answer | null>(null);

/** A judged soul looked at again (docs/tech-spec.md §67): which, and whether the sun was held for it. */
export const review = signal<{ readonly index: number; readonly held: boolean } | null>(null);

/**
 * Opens a judged soul again (docs/tech-spec.md §67). While souls still wait at the gate the sun is held, and the
 * review covers the desk, so it's never time to think about the next soul for free.
 */
export function lookAgain(index: number): void {
  const s = session.peek();
  if (!s?.state.verdicts[index]) return;
  citation.value = null;
  const held = s.state.phase === 'shift' && !s.state.config.untimed && s.state.clock.pausedAt === null;
  if (held) act({ t: 'pause' });
  review.value = { index, held };
}

export function closeReview(): void {
  const r = review.peek();
  review.value = null;
  if (r?.held) act({ t: 'resume' });
}

/** Whether a judged soul can be tried again: once its shift is over, and never under the oath. */
export function canTryAgain(s: Session): boolean {
  const kind = s.mode.kind;
  return s.state.phase === 'done' && !s.state.config.oath && kind !== 'again' && kind !== 'appeal' && kind !== 'primer';
}

/**
 * Plays a judged soul again on its own (docs/tech-spec.md §67): the same soul under the same rules, with no sun and
 * nothing kept. Its stamp is told like any other; then it's back to the screen it was opened from.
 */
export function tryAgain(index: number): void {
  const s = session.peek();
  const c = s?.state.cases[index];
  if (!s || !c || !canTryAgain(s)) return;
  const from = screen.peek();
  const { state } = startShift(s.content, { ...s.state.config, untimed: true }, [c], s.ctx);
  const begin: ShiftAction = { t: 'begin', at: clock() };
  const back = () => {
    batch(() => {
      session.value = s;
      screen.value = from;
    });
  };
  resetSoulUi();
  batch(() => {
    review.value = null;
    session.value = {
      mode: { kind: 'again', day: s.ctx.day, name: c.evidence.look.name },
      content: s.content,
      ctx: s.ctx,
      initial: state,
      state: stepShift(state, begin, s.ctx).state,
      actions: [begin],
      done: back,
      leave: back,
    };
    screen.value = 'shift';
  });
}
export const citation = signal<Verdict | null>(null);
/** The soul just sent, and its stamp: the desk shows it walking off that way (shift/motion.ts). */
export const departed = signal<{ readonly caseId: string; readonly dest: Destination } | null>(null);
export const comparing = signal(false);
export const compareFirst = signal<string | null>(null);
export const drawerTab = signal<'words' | 'ravens' | 'registry' | 'tally' | 'rules'>('words');
export const stampSheet = signal(false);

let toastId = 0;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function say(text: string, tone: Toast['tone'] = 'info'): void {
  toast.value = { id: ++toastId, text, tone };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.value = null;
  }, 2600);
}

export function resetSoulUi(): void {
  batch(() => {
    comparing.value = false;
    compareFirst.value = null;
    stampSheet.value = false;
    drawerTab.value = 'words';
    review.value = null;
  });
}

type ActionInput = ShiftAction extends infer A ? (A extends ShiftAction ? Omit<A, 'at'> : never) : never;

/** Steps the shift with the current time and reacts to what happened. */
export function act(input: ActionInput): void {
  const s = session.peek();
  if (!s) return;
  const action = { ...input, at: clock() } as ShiftAction;
  const r = s.step ? s.step(s.state, action) : stepShift(s.state, action, s.ctx);
  if (r.state === s.state && r.events.length === 0) return;
  const changed = r.state !== s.state;
  const next: Session = { ...s, state: r.state, actions: changed ? [...s.actions, action] : s.actions };
  // A lesson is taught once its soul has been judged.
  if (r.state.cursor > s.state.cursor && activeLesson(s, coachState())) noteCoached(s.ctx.day);
  batch(() => {
    session.value = next;
    for (const e of r.events) onEvent(e, next);
    // A judged soul, read from the shift as it stood before the send (its questions and hints are still on it).
    for (const e of r.events) {
      const mode = playMode(s.mode);
      if (e.e === 'judged' && mode) unlock({ at: 'soul', mode, facts: soulFacts(s.state, e.verdict) });
    }
  });
  // The events may have moved the session on (an Endless score, or its next round).
  if (changed) saveProgress(session.peek() ?? next);
}

function onEvent(e: ShiftEvent, s: Session): void {
  const cases = s.state.cases;
  const sound = soundFor(e);
  if (sound) play(sound);
  if (e.e === 'paused' || e.e === 'resumed') holdAudio(e.e === 'paused');
  switch (e.e) {
    case 'contradiction':
      say(t('ui.compare.found'), 'good');
      comparing.value = false;
      compareFirst.value = null;
      break;
    case 'noConflict':
      // Under Týr's oath (an Endless curse, docs/tech-spec.md §68) it's a strike, not sun.
      say(
        s.mode.kind === 'endless' && endlessRules(s).oath
          ? t('ui.endless.oathStrike')
          : t('ui.compare.none', { s: e.penaltyMs / 1000 }),
        'bad',
      );
      comparing.value = false;
      compareFirst.value = null;
      if (s.mode.kind === 'endless') countEndless(e);
      break;
    case 'hint': {
      const f = cases[s.state.cursor]?.evidence.fields.find((x) => x.id === e.field);
      if (f) say(t(hintTarget(f, s.state).text));
      if (s.mode.kind === 'endless') countEndless(e);
      break;
    }
    case 'answer': {
      const c = cases[s.state.cursor];
      answer.value = {
        name: c?.evidence.look.name ?? '',
        lines: e.response.lines.map((l) => t(l.msg, l.params)),
      };
      break;
    }
    case 'pressed': {
      const name = cases[s.state.cursor]?.evidence.look.name ?? '';
      const added = e.answer.said?.text;
      answer.value = {
        name,
        title: t(e.answer.gave ? 'ui.press.gave' : 'ui.press.held', { name }),
        lines: e.answer.lines.map((l) => t(l.msg, l.params)),
        ...(added ? { added: t(added.msg, added.params) } : {}),
      };
      break;
    }
    case 'judged': {
      const sent = cases[e.verdict.index];
      departed.value = sent && e.verdict.stamped ? { caseId: sent.id, dest: e.verdict.stamped } : null;
      const dest = t(`dest.${e.verdict.stamped}`);
      // A soul tried again gets no citation: the toast says how it went (docs/tech-spec.md §67).
      const again = s.mode.kind === 'again';
      const told = e.verdict.correct
        ? t(again ? 'ui.again.right' : 'ui.verdict.right', { dest })
        : t(again ? 'ui.again.wrong' : 'ui.verdict.wrong', { dest, expected: t(`dest.${e.verdict.expected}`) });
      say(told, e.verdict.correct ? 'good' : 'bad');
      resetSoulUi();
      if (s.mode.kind === 'endless') countEndless(e);
      break;
    }
    case 'citation':
      if (s.state.phase !== 'done') citation.value = e.verdict;
      break;
    case 'dusk':
      say(t('ui.dusk'), 'bad');
      break;
    case 'done':
      finish(s);
      break;
    case 'rejected':
      say(e.reason, 'info');
      break;
    default:
      break;
  }
}

function saveProgress(s: Session): void {
  if (s.mode.kind === 'endless') {
    saveEndless(s);
    return;
  }
  if (s.mode.kind !== 'daily' || !s.mode.ranked || s.state.phase === 'done') return;
  saveDailyProgress({ v: 1, n: s.mode.n, g: s.content.genVersion, actions: s.actions, seenAt: clock() });
}

function finish(s: Session): void {
  citation.value = null;
  answer.value = null;
  if (s.done) {
    s.done(s);
    return;
  }
  const mode = playMode(s.mode);
  if (mode) unlock({ at: 'shift', mode, facts: shiftFacts(s.initial, s.actions, s.ctx) });
  // The run has already audited the shift; the campaign's own screens take over.
  if (s.mode.kind === 'campaign') {
    screen.value = 'audit';
    return;
  }
  // An Endless round that ends with strikes to spare goes straight on to the next day's rules.
  if (s.mode.kind === 'endless') {
    const now = session.peek();
    const m = now?.mode;
    if (now && m?.kind === 'endless' && m.strikes < endlessRules(now).strikes) {
      // Souls the sun set on were never judged: they score nothing (docs/tech-spec.md §68).
      const lost = s.state.verdicts.filter((v) => v.stamped === null).length;
      if (lost > 0) say(t('ui.endless.dusk', { n: lost }), 'bad');
      startEndlessRound({ ...m, round: m.round + 1 });
    }
    return;
  }
  // An appeal is its campaign's business (its `done` has it), never telemetry's; nor is a soul tried again.
  if (s.mode.kind === 'appeal' || s.mode.kind === 'again') return;
  const telemetry = telemetryBase();
  // Assisted shifts stay home until the telemetry schema can say so; the alpha's numbers stay comparable.
  if (telemetry && settings.peek().telemetry && !s.state.config.assists) {
    sendShift(
      telemetry,
      shiftRecord({
        build: buildInfo(s.content),
        mode: s.mode.kind,
        ...(s.mode.kind === 'daily' ? { n: s.mode.n, guard: s.mode.guard } : {}),
        layout: effectiveLayout(),
        initial: s.initial,
        actions: s.actions,
        ctx: s.ctx,
      }),
    );
  }
  if (s.mode.kind === 'primer' && !settings.peek().primerDone) updateSettings({ primerDone: true });
  if (s.mode.kind === 'daily' && s.mode.ranked) {
    const score = shiftScore(s.state);
    const result: DailyResult = {
      n: s.mode.n,
      g: s.content.genVersion,
      correct: score.correct,
      total: score.total,
      spareMs: score.spareMs,
      endedBy: s.state.endedBy ?? 'queue',
      marks: shareMarks(s.state),
      guard: s.mode.guard,
      ...(s.state.config.assists ? { assists: s.state.config.assists } : {}),
    };
    // Result first, then drop the progress: an unload between the two must not lose both.
    saveDailyRecord({ v: 1, results: { ...dailyRecord.value.results, [String(s.mode.n)]: result } });
    saveDailyProgress(null);
    void keepStorage();
  }
  screen.value = 'summary';
}

/** Today's Daily. Before DAILY_EPOCH it's an unnumbered preview so testers can play now. */
export function today(): { n: number; date: string; preview: boolean } {
  const date = todayLocal();
  const n = dailyNumber(date);
  return { n, date: isoDate(date), preview: n < 1 };
}

/**
 * Today's Daily, or with `past`, an earlier one from the archive: the same souls everyone got that day
 * (from this build's generator), played for its own sake, never recorded.
 */
export function startDaily(past?: number): void {
  const content = dailyContent;
  if (!content?.daily) return;
  const current = today();
  const archive = past !== undefined && past >= 1 && past < current.n;
  const { n, date, preview } = archive ? { n: past, date: isoDate(dailyDate(past)), preview: false } : current;
  const ranked = !archive && !dailyRecord.value.results[String(n)];
  const { state, ctx } = startShift(content, {
    mode: 'daily',
    seed: dailySeed(n),
    day: content.daily.day,
    dailyNumber: n,
  });
  // The checksum guard: does this device generate the Daily everyone else gets?
  const checksum = queueChecksum(state.cases, ctx);
  const guard = guardDaily(dailyChecks, n, content.genVersion, checksum);
  const telemetry = telemetryBase();
  if (guard === 'mismatch' && telemetry && settings.peek().telemetry) {
    sendGuard(telemetry, {
      v: 1,
      build: buildInfo(content),
      n,
      expected: expectedChecksum(dailyChecks, n, content.genVersion) ?? '',
      got: checksum,
      ua: navigator.userAgent.slice(0, 400),
    });
  }
  let s: Session = {
    mode: { kind: 'daily', n, date, preview, ranked, archive, checksum, guard },
    content,
    ctx,
    initial: state,
    state,
    actions: [],
  };

  const progress = dailyProgress.value;
  if (ranked && progress && progress.n === n && progress.g === content.genVersion && progress.actions.length > 0) {
    // Replay the saved actions, then carry on the same timeline, paused.
    let st = s.state;
    for (const a of progress.actions) st = stepShift(st, a, ctx).state;
    const lastAt = progress.actions[progress.actions.length - 1]?.at ?? 0;
    // The sun ran at least until the last heartbeat; the unload's own pause may not have been saved.
    const resumeAt = Math.max(lastAt, progress.seenAt ?? 0);
    clockOffset = resumeAt - Math.round(performance.now());
    const actions = [...progress.actions];
    if (st.phase === 'shift' && st.clock.pausedAt === null) {
      const pause: ShiftAction = { t: 'pause', at: resumeAt };
      st = stepShift(st, pause, ctx).state;
      actions.push(pause);
    }
    s = { ...s, state: st, actions };
  }
  resetSoulUi();
  session.value = s;
  screen.value = s.state.phase === 'briefing' ? 'briefing' : s.state.phase === 'shift' ? 'shift' : 'summary';
}

export function startPractice(day: number): void {
  // Practice seeds are random on purpose; only the engine has to be deterministic.
  const seed = `practice:${Date.now().toString(36)}:${Math.floor(Math.random() * 1e9).toString(36)}`;
  const { state, ctx } = startShift(gameContent, {
    mode: 'practice',
    seed,
    day,
    untimed: settings.value.untimedPractice,
  });
  resetSoulUi();
  session.value = { mode: { kind: 'practice', day }, content: gameContent, ctx, initial: state, state, actions: [] };
  screen.value = 'briefing';
}

/** A free Endless run: a seed of its own, so it's never the day's. Ends a saved run where it stands. */
export function startEndless(): void {
  closeEndless();
  // Random on purpose, like practice; only the engine has to be deterministic.
  const seed = `endless:${Date.now().toString(36)}:${Math.floor(Math.random() * 1e9).toString(36)}`;
  startEndlessRound(freshRun(seed, null));
}

/** Today's Endless: the same souls for everyone today, numbered like the Daily; once a day counts. */
export function startEndlessToday(): void {
  const dated = today();
  // Today's run, once begun, can only be carried on: starting it again would replay known souls.
  if (endlessProgress.peek()?.mode.dated?.n === dated.n) {
    resumeEndless();
    return;
  }
  if (settings.peek().endlessToday?.n === dated.n) return;
  closeEndless();
  startEndlessRound(freshRun(endlessSeed(dated.n), dated));
}

function freshRun(seed: string, dated: DatedRun | null): EndlessMode {
  const bestBefore = settings.peek().endlessBest;
  return {
    kind: 'endless',
    seed,
    round: 0,
    day: 0,
    strikes: 0,
    judged: 0,
    bestBefore,
    dated,
    tracker: false,
    score: 0,
    picks: [],
    hintsUsed: 0,
  };
}

/** What an Endless run's boons and curses add up to (docs/tech-spec.md §68); as Endless always was without them. */
export const endlessRules = (s: Pick<Session, 'content' | 'mode'>): RunRules =>
  runRules(s.content, s.mode.kind === 'endless' ? (s.mode.picks ?? []) : []);

/** The strikes a saved run can take, for the title card. */
export const savedStrikes = (p: EndlessProgress): number => runRules(gameContent, p.mode.picks ?? []).strikes;

/** The saved run as it stands: its round rebuilt, the round's actions replayed. */
function savedEndless(p: EndlessProgress): EndlessSession {
  // After an update that changed the generator the round's souls differ: it starts again from its first.
  return endlessSession(p.mode, p.g === gameContent.genVersion ? p.actions : []);
}

/** Picks up the saved run where it was left. */
export function resumeEndless(): void {
  const p = endlessProgress.peek();
  if (!p) return;
  const s = savedEndless(p);
  if (s.mode.strikes >= endlessRules(s).strikes) {
    showEndless(s);
    endEndless(s.mode);
    screen.value = 'endless';
    return;
  }
  if (s.state.phase === 'done') {
    startEndlessRound({ ...s.mode, round: s.mode.round + 1 });
    return;
  }
  const lastAt = s.actions[s.actions.length - 1]?.at;
  if (lastAt !== undefined) resumeClockAt(lastAt);
  // Back to the soul it was left on, paused, as a resumed Daily is.
  let resumed = s;
  if (s.state.phase === 'shift' && s.state.clock.pausedAt === null) {
    const pause: ShiftAction = { t: 'pause', at: clock() };
    resumed = { ...s, state: stepShift(s.state, pause, s.ctx).state, actions: [...s.actions, pause] };
  }
  showEndless(resumed);
  screen.value = resumed.state.phase === 'briefing' ? 'briefing' : 'shift';
}

/**
 * A round's session: its souls and its day context (with the round's twist), its shift set up by the run's boons and
 * curses, with `replay` stepped through and scored, as a saved round is resumed.
 */
type EndlessSession = Session & { readonly mode: EndlessMode };

/** What an event does to the run's tally: a soul judged, a strike under Týr's oath, a hint used. */
function tallied(m: EndlessMode, rules: RunRules, e: ShiftEvent): EndlessMode {
  const d = tallyEvent(rules, e);
  if (!d) return m;
  return {
    ...m,
    judged: m.judged + d.right,
    score: (m.score ?? m.judged) + d.points,
    strikes: m.strikes + d.strikes,
    hintsUsed: (m.hintsUsed ?? 0) + d.hints,
  };
}

/** The assists a round began with, kept for the run's share text: the tracker, and a sun speed under the sun. */
function withAssists(m: EndlessMode, assists: Assists | undefined, untimed: boolean): EndlessMode {
  const pct = untimed ? undefined : cleanAssists(assists).sunPct;
  return {
    ...m,
    ...(assists?.tracker ? { tracker: true } : {}),
    ...(pct !== undefined ? { sunPct: Math.min(pct, m.sunPct ?? pct) } : {}),
  };
}

function endlessSession(mode: EndlessMode, replay: readonly ShiftAction[] = []): EndlessSession {
  // A run saved before boons and curses has no score of its own yet: it's the souls judged rightly.
  const r = endlessRound(gameContent, mode.seed, mode.round);
  const start: EndlessMode = {
    ...mode,
    day: r.day,
    score: mode.score ?? mode.judged,
    picks: mode.picks ?? [],
    hintsUsed: mode.hintsUsed ?? 0,
  };
  const ctx = endlessContext(gameContent, start.seed, start.round);
  const rules = runRules(gameContent, start.picks ?? []);
  const config = endlessConfig(ctx, start.seed, start.round, rules, rules.hints - (start.hintsUsed ?? 0));
  const { state } = startShift(gameContent, config, r.cases, ctx);
  let st = state;
  let live = start;
  let roundStart = start;
  for (const a of replay) {
    if (a.t === 'begin') {
      live = withAssists(live, a.assists, config.untimed === true);
      roundStart = withAssists(roundStart, a.assists, config.untimed === true);
    }
    const step = stepShift(st, a, ctx);
    st = step.state;
    for (const e of step.events) live = tallied(live, rules, e);
  }
  return {
    mode: live,
    roundStart,
    content: gameContent,
    ctx,
    initial: state,
    state: st,
    actions: [...replay],
  };
}

function showEndless(s: Session): void {
  resetSoulUi();
  batch(() => {
    citation.value = null;
    answer.value = null;
    session.value = s;
  });
}

function startEndlessRound(mode: EndlessMode): void {
  const s = endlessSession(mode);
  showEndless(s);
  screen.value = 'briefing';
  saveEndless(s);
}

/**
 * The choice before this round (docs/tech-spec.md §68): three boons and the curse on offer, while the round is still
 * in its briefing and nothing has been chosen for it. Null otherwise, and always in a build without boons (the demo).
 */
export function endlessOfferFor(s: Session): EndlessOffer | null {
  if (s.mode.kind !== 'endless' || s.state.phase !== 'briefing' || s.actions.length > 0) return null;
  const m = s.mode;
  if ((m.picks ?? []).some((p) => p.round === m.round)) return null;
  return endlessOffer(s.content, m.seed, m.round, m.picks ?? [], m.strikes);
}

/** Takes a boon, or the curse on offer, before the round: the round is set up again with it, and the run saved. */
export function chooseEndless(id: string): void {
  const s = session.peek();
  if (s?.mode.kind !== 'endless' || !endlessOfferFor(s)) return;
  const m = s.roundStart ?? s.mode;
  const picks = m.picks ?? [];
  if (!canPick(s.content, m.seed, m.round, picks, m.strikes, id)) return;
  const next = endlessSession({ ...m, picks: [...picks, { round: m.round, id }] });
  showEndless(next);
  saveEndless(next);
  const curse = s.content.boons?.find((b) => b.id === id)?.kind === 'curse';
  play(curse ? 'citation' : 'found');
}

/** Saves the run as its round began, with the round's actions (resumeEndless replays them). */
function saveEndless(s: Session): void {
  if (s.mode.kind !== 'endless' || s.mode.strikes >= endlessRules(s).strikes) return;
  saveEndlessProgress({
    v: 1,
    g: s.content.genVersion,
    mode: s.roundStart ?? s.mode,
    actions: s.actions,
    judged: s.mode.judged,
    strikes: s.mode.strikes,
    ...(hasBoons(s.content) ? { score: s.mode.score ?? s.mode.judged } : {}),
  });
}

/** The run is over: its best, the day's result when it was the day's run, then the saved run dropped. */
function endEndless(m: EndlessMode): void {
  const score = m.score ?? m.judged;
  const best = score > settings.peek().endlessBest ? { endlessBest: score } : {};
  const run = hasBoons(gameContent) ? { score, curses: runRules(gameContent, m.picks ?? []).curses } : {};
  const dated = m.dated
    ? {
        endlessToday: {
          ...m.dated,
          g: gameContent.genVersion,
          judged: m.judged,
          round: m.round,
          day: m.day,
          ...(m.tracker ? { tracker: true } : {}),
          ...(m.sunPct !== undefined ? { sunPct: m.sunPct } : {}),
          ...run,
        },
      }
    : {};
  // Result first, then drop the saved run: an unload between the two must not lose both.
  if (Object.keys(best).length > 0 || m.dated) updateSettings({ ...best, ...dated });
  saveEndlessProgress(null);
  if (m.dated) void keepStorage();
}

/** Ends the saved run (if any) where it stands, before another begins: a day's run is recorded as it is. */
function closeEndless(): void {
  const p = endlessProgress.peek();
  if (!p) return;
  endEndless(savedEndless(p).mode);
}

/**
 * Scores an event in Endless: a soul judged (its worth, or a strike), a Compare that finds nothing under Týr's oath,
 * a hint used. The strike that uses the run's last ends it where it stands.
 */
function countEndless(e: ShiftEvent): void {
  const s = session.peek();
  if (s?.mode.kind !== 'endless') return;
  const rules = endlessRules(s);
  const mode = tallied(s.mode, rules, e);
  if (mode === s.mode) return;
  session.value = { ...s, mode };
  if (e.e === 'judged') {
    const facts = { score: mode.judged, round: mode.round, strikes: mode.strikes };
    unlock({ at: 'endless', facts: { ...facts, points: mode.score ?? mode.judged, curses: rules.curses } });
  }
  if (mode.strikes < rules.strikes) return;
  // Over mid-round: a round under the sun stops with the run, so no dusk comes to the screen that says it's over.
  const over = session.peek();
  if (over?.state.phase === 'shift' && over.state.clock.pausedAt === null) {
    session.value = { ...over, state: { ...over.state, clock: { ...over.state.clock, pausedAt: clock() } } };
  }
  endEndless(mode);
  screen.value = 'endless';
}

/** The fixed seed that gives everyone the same primer. */
export const PRIMER_SEED = 'primer';

export function startPrimer(): void {
  const content = dailyContent;
  if (!content?.primer) return;
  const { state, ctx } = startShift(content, {
    mode: 'primer',
    seed: PRIMER_SEED,
    day: content.primer.day,
    untimed: true,
  });
  resetSoulUi();
  coachAcks.value = [];
  session.value = { mode: { kind: 'primer' }, content, ctx, initial: state, state, actions: [] };
  screen.value = 'briefing';
}

/** Coach steps the player has clicked past ("Next"). */
export const coachAcks = signal<readonly string[]>([]);

export function begin(): void {
  const before = session.peek();
  // Endless's choice between rounds comes first (docs/tech-spec.md §68).
  if (before && endlessOfferFor(before)) return;
  const untimed = before?.state.config.untimed === true;
  const assists = currentAssists(false, untimed);
  act({ t: 'begin', ...(Object.keys(assists).length > 0 ? { assists } : {}) });
  const s = session.peek();
  // An Endless run says when shared if any round began with the rule tracker, or a sun speed under the sun.
  if (s?.mode.kind === 'endless') {
    const start = s.roundStart;
    const next: Session = {
      ...s,
      mode: withAssists(s.mode, assists, untimed),
      ...(start ? { roundStart: withAssists(start, assists, untimed) } : {}),
    };
    session.value = next;
    saveEndless(next);
  }
  if (session.value?.state.phase === 'shift') screen.value = 'shift';
}

/** Leaves a campaign shift for the save slots. The run is already saved, paused. */
export function quitToSlots(): void {
  batch(() => {
    session.value = null;
    citation.value = null;
    answer.value = null;
    screen.value = 'campaign';
  });
}

export function toTitle(): void {
  batch(() => {
    session.value = null;
    citation.value = null;
    answer.value = null;
    screen.value = 'title';
  });
}

/** What an Endless run is called in its share text: the day's by number, a free run as one. */
export function endlessLabel(dated: DatedRun | null): string {
  if (!dated) return 'Endless · free run';
  return dated.preview ? `Endless preview ${dated.date}` : `Endless #${dated.n}`;
}

/** Spoiler-free text for a finished Endless run, and the link it points to. */
export function endlessShareBody(r: {
  readonly dated: DatedRun | null;
  readonly g: number;
  readonly judged: number;
  readonly round: number;
  readonly day: number;
  readonly tracker?: boolean;
  readonly sunPct?: number;
  /** Where Endless is a run (docs/tech-spec.md §68): its score and the curses it took. */
  readonly score?: number;
  readonly curses?: number;
}): { text: string; url: string | undefined } {
  const assists = cleanAssists({
    tracker: r.tracker === true,
    ...(r.sunPct !== undefined ? { sunPct: r.sunPct } : {}),
  });
  const text = endlessShareText({
    title: t('core.title'),
    label: endlessLabel(r.dated),
    genVersion: r.g,
    judged: r.judged,
    round: r.round,
    day: r.day,
    ...(Object.keys(assists).length > 0 ? { assists } : {}),
    ...(r.score !== undefined ? { score: r.score, curses: r.curses ?? 0 } : {}),
  });
  return { text, url: platform.shareUrl() };
}

/** Spoiler-free result text, and the link it points to. */
export function shareBody(s: Session): { text: string; url: string | undefined } {
  if (s.mode.kind === 'endless') {
    const { score, ...run } = s.mode;
    const scored = hasBoons(s.content) ? { score: score ?? run.judged, curses: endlessRules(s).curses } : {};
    return endlessShareBody({ ...run, g: s.content.genVersion, ...scored });
  }
  let label: string | undefined;
  if (s.mode.kind === 'daily') {
    label = s.mode.preview ? `Daily preview ${s.mode.date}` : `Daily #${s.mode.n}`;
    if (s.mode.archive) label += ' (archive)';
    // A device that built a different Daily says so, so nobody compares apples with pears.
    if (s.mode.guard === 'mismatch') label += ' · unverified';
  }
  const text = shareText(s.state, s.content, { title: t('core.title'), ...(label ? { label } : {}) });
  return { text, url: platform.shareUrl() };
}

// ---------- updates ----------

/** True when a new version is downloaded and waiting (the title screen offers it). */
export const updateReady = signal(false);
let installUpdate: (() => Promise<void>) | null = null;

export function applyUpdate(): void {
  void installUpdate?.();
}

export async function shareResult(s: Session): Promise<ShareResult> {
  const { text, url } = shareBody(s);
  return platform.share(text, url);
}

/** The share text of a day's Endless run, from its result (the run itself has gone). */
export const endlessResultBody = (r: EndlessResult): { text: string; url: string | undefined } =>
  endlessShareBody({ ...r, dated: r });

/** Shares a day's Endless run from the title card. */
export async function shareEndless(r: EndlessResult): Promise<ShareResult> {
  const { text, url } = endlessResultBody(r);
  return platform.share(text, url);
}

// ---------- time and pausing ----------

let ticker: ReturnType<typeof setInterval> | undefined;

/** Pauses the shift being played, if its sun is running (the page hidden, the window left, something broken). */
export function pauseIfPlaying(): void {
  const s = session.peek();
  if (s && screen.peek() === 'shift' && s.state.phase === 'shift' && s.state.clock.pausedAt === null) {
    act({ t: 'pause' });
  }
}

/** How much sun is left when the shift says it's running low. */
export const SUN_LOW_MS = 60_000;
/** Shifts (by their first state) already told. */
const toldLow = new WeakSet<object>();

/**
 * Says once a shift, as the last minute of sun begins, that it's running low: the sun bar shows it, and
 * this says it, to screen readers too (the toast is a live region). Dusk says itself (onEvent).
 */
function warnSunLow(s: Session): void {
  const st = s.state;
  if (st.config.untimed || st.phase !== 'shift' || st.clock.dusk || toldLow.has(s.initial)) return;
  if (sunLeft(st, clock()) > SUN_LOW_MS) return;
  toldLow.add(s.initial);
  say(t('ui.sun.low'), 'bad');
}

/** Starts the sun ticker, the auto-pause listeners and the update watch. Call once. */
export function startClock(): void {
  if (ticker) return;
  installUpdate = platform.watchForUpdate(() => {
    updateReady.value = true;
  });
  let beats = 0;
  ticker = setInterval(() => {
    now.value = clock();
    const s = session.peek();
    if (s?.state.phase === 'shift' && s.state.clock.pausedAt === null) {
      act({ t: 'tick' });
      warnSunLow(session.peek() ?? s);
      if (++beats % 20 === 0) {
        const current = session.peek() ?? s;
        // The Daily keeps how far its sun got; Endless has no sun, and saves on every action anyway.
        if (current.mode.kind === 'daily') saveProgress(current);
        current.heartbeat?.();
      }
    }
  }, 250);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') pauseIfPlaying();
  });
  window.addEventListener('pagehide', pauseIfPlaying);
  window.addEventListener('blur', pauseIfPlaying);
}
