import {
  type Destination,
  type Effect,
  FACTIONS,
  type Faction,
  type RequestDef,
  type StatePred,
} from '../content/types';
import type { CaseSpec } from '../gen/types';
import type { Assists, ShiftState } from '../shift/shift';
import type { Battle } from './battle';
import type { DayGrade } from './grade';

/**
 * A campaign run (docs/tech-spec.md §4). Plain JSON, never reads a clock:
 * the day's shift lives inside it while it runs, and everything else is a
 * few numbers, so a morning snapshot is small.
 */

export interface FamilyMember {
  readonly id: string;
  readonly status: 'well' | 'sick' | 'gone';
  /** Nights in a row without the hearth. */
  readonly cold: number;
  /** Nights in a row without food. */
  readonly hungry: number;
  /** Nights in a row sick without medicine. */
  readonly sickNights: number;
  /** How someone who is gone went: adults can die; children are sent to relatives. */
  readonly gone?: 'died' | 'left';
}

export interface Bills {
  readonly hearth: boolean;
  readonly food: boolean;
  /** Family members who get medicine tonight. */
  readonly medicine: readonly string[];
}

/** A soul sent to the wrong place, as the audit filed it: the rule that decided, and what went wrong. */
export interface DayMistake {
  /** The rule that said where the soul belonged. */
  readonly rule: string;
  readonly expected: Destination;
  readonly stamped: Destination;
  /** Procedures the soul needed that weren't done (nails left uncut). */
  readonly skipped?: readonly string[];
  /** The soul came after the day's noon decree, and was judged under it (docs/tech-spec.md §45). */
  readonly noon?: true;
  /** Rings a story soul paid for this stamp (docs/tech-spec.md §47): a bribe taken, not a slip. */
  readonly paid?: number;
  /** The stamp a story soul pleaded for (docs/tech-spec.md §51): a plea granted, not a slip. */
  readonly pled?: true;
}

/**
 * A soul that asked, at the desk, for a hall where it didn't belong (docs/tech-spec.md §51, §59), or kin come for a soul
 * sent where it didn't belong (§60), as the audit filed it once the soul was judged. For the playtest report: a plea
 * refused is a right stamp like any other, and leaves no other trace.
 */
export interface DayPlea {
  readonly name: string;
  /** Where the soul belonged. */
  readonly belongs: Destination;
  /** The hall it asked for; absent for kin who belonged where their soul went, and asked nothing. */
  readonly to?: Destination;
  /** The soul it was kin to, by name. */
  readonly kin?: string;
  /** A story soul, whose plea is written into its case. */
  readonly story?: true;
  /** Whether it was given the hall it asked for. */
  readonly granted: boolean;
}

/**
 * A soul from an earlier day asking to be judged again (docs/tech-spec.md §40), heard the next morning on
 * the rules of the day it was judged.
 */
export interface Appeal {
  /** The day it was judged: that day's rules decide it. */
  readonly day: number;
  /** The soul as it stood at the gate. */
  readonly case: CaseSpec;
  readonly stamped: Destination;
  /** Whether a Valhalla stamp made it a worthy einherjar (the day's rules said), for moving it. */
  readonly worthy: boolean;
  /** Whether that day's mistakes were fined (not in Story Mode, nor with the no-fines assist). */
  readonly fined: boolean;
  /** What the verdict cost if it was wrong: its fine, and the standing it moved. Both come back if it's righted. */
  readonly fine: number;
  readonly standing: Readonly<Partial<Record<Faction, number>>>;
}

/** How an appeal went: righted (it was wrong, and now it's right), upheld (it was right, and stays), wrong, or left to stand. */
export type AppealOutcome = 'righted' | 'upheld' | 'wrong' | 'letStand';

export interface AppealHeard {
  /** The day the soul was judged. */
  readonly day: number;
  readonly name: string;
  readonly outcome: AppealOutcome;
  /** Where it was sent, where the appeal sent it (null: the verdict was left to stand), and where it belonged. */
  readonly from: Destination;
  readonly to: Destination | null;
  readonly expected: Destination;
  /** The rule that decides it, for saying why. */
  readonly rule: string;
  readonly rings: number;
  readonly standing: Readonly<Partial<Record<Faction, number>>>;
}

/** A god's request for the day (docs/tech-spec.md §42), as the morning brought it. */
export type DayRequest = Omit<RequestDef, 'since' | 'until'>;

/** How a request went, as the day's audit filed it. */
export interface RequestSettled {
  readonly id: string;
  readonly god: Faction;
  /** Souls that belonged here, asked for there. */
  readonly from: Destination;
  readonly to: Destination;
  readonly n: number;
  /** Souls sent as asked. */
  readonly done: number;
  readonly met: boolean;
  /** The reward, when it was done in full. */
  readonly standing: Readonly<Partial<Record<Faction, number>>>;
}

/** A soul in the line at dusk, as the audit names it. */
export interface LineSoul {
  readonly id: string;
  readonly name: string;
}

/**
 * The souls still in line when the sun set (docs/tech-spec.md §41): those who wait for the next day, the living
 * who die in the night, and what the night's wait cost.
 */
export interface DayWaiting {
  readonly carried: readonly LineSoul[];
  readonly died: readonly LineSoul[];
  /** Any the next day's rules couldn't show fairly (never seen so far): they're gone, as before there was a line. */
  readonly gone?: readonly LineSoul[];
  readonly standing: Readonly<Partial<Record<Faction, number>>>;
}

/** A soul the last battle names (docs/tech-spec.md §54), in the host of the hall it was sent to. */
export interface NamedSoul {
  readonly name: string;
  /** The day it was judged. */
  readonly day: number;
  readonly hall: Destination;
  /** It will run: sent to the hall by mistake (to Valhalla: unworthy). Otherwise a story soul who'll stand there. */
  readonly runs: boolean;
}

/** A day event as a run drew it (docs/tech-spec.md §52): the day, and which. */
export interface DayEventAt {
  readonly day: number;
  readonly id: string;
}

/** One day's accounts, shown at the audit and the night. */
export interface DayLedger {
  readonly day: number;
  readonly correct: number;
  readonly wrong: number;
  readonly unjudged: number;
  readonly pay: number;
  readonly bonus: number;
  readonly fines: number;
  /** Rings of the day's fines a god's favour spared (docs/tech-spec.md §43), when it spared any. */
  readonly eased?: number;
  /** Rings a god's favour paid for the souls sent on with their nails long (docs/tech-spec.md §57), when it paid. */
  readonly nails?: number;
  /** Standing moved by today's mistakes at the gate (right stamps never move it). */
  readonly standing: Readonly<Partial<Record<Faction, number>>>;
  /**
   * Standing moved by the story since the previous audit: last night's scene, this morning's,
   * today's story souls (and in a vertical slice, its jump). Absent in saves from before it was kept.
   */
  readonly story?: Readonly<Partial<Record<Faction, number>>>;
  /** The assists the day's shift was played with (absent when none). */
  readonly assists?: Assists;
  /** Each soul sent wrong (absent when none, and in saves from before they were kept): a playtest's report. */
  readonly mistakes?: readonly DayMistake[];
  /**
   * Claims pressed at the gate today, and lies that gave way (docs/tech-spec.md §66): absent on a day with none,
   * for a playtest's report.
   */
  readonly pressed?: { readonly n: number; readonly gave: number };
  /**
   * Parties at the desk today (docs/tech-spec.md §69): how many, their souls, the lies told about companions and how
   * many of those were caught. Absent on a day with none, for a playtest's report.
   */
  readonly parties?: { readonly n: number; readonly souls: number; readonly lies: number; readonly caught: number };
  /**
   * The souls judged today who asked for another hall, and kin who came (docs/tech-spec.md §60): kept in a build whose
   * campaign has pleas or kin, empty on a day nobody asked, and absent in saves from before they were kept.
   */
  readonly pleas?: readonly DayPlea[];
  /** The appeal heard that morning, if one came. */
  readonly appeal?: AppealHeard;
  /** The line at dusk, when souls were left in it and there's a next day for them. */
  readonly waiting?: DayWaiting;
  /** The day's requests, and how they went. */
  readonly requests?: readonly RequestSettled[];
  /** The gods' favours the gate granted for the day and its night (docs/tech-spec.md §43), by id. */
  readonly favours?: readonly string[];
  /** The rank the day was worked at (docs/tech-spec.md §44), when there was one. */
  readonly rank?: number;
  /** Seconds of sun the day gave to home, at dawn (docs/tech-spec.md §50): negative. */
  readonly dawnS?: number;
  /** The day's event (docs/tech-spec.md §52), by id, when it had one. */
  readonly event?: string;
  /** The day's grade (docs/tech-spec.md §49); absent in Story Mode, and in saves from before grades. */
  readonly grade?: DayGrade;
  /** The morning's promotion, offered and taken or not. */
  readonly offer?: { readonly rank: number; readonly taken: boolean };
  /** The rank stepped down from that night. */
  readonly steppedDown?: number;
  /** Filled in at the end of the night. */
  readonly night?: {
    readonly hearth: number;
    readonly food: number;
    readonly medicine: number;
    readonly upgrades: number;
    readonly draupnir: number;
    /** Rings gained or lost to story effects today (scenes and story souls). */
    readonly story: number;
    /** Odin's tithe for a rank held (docs/tech-spec.md §44). */
    readonly tithe?: number;
    /** Rings spent on arms, got back for upgrades sold, and paid by a reprieve (docs/tech-spec.md §56). */
    readonly arms?: number;
    readonly sold?: number;
    readonly reprieve?: number;
    readonly rings: number;
  };
}

/** `ragnarok`: after the last night, the hosts wait to be sent to the fronts (docs/tech-spec.md §54). */
export type RunPhase = 'morning' | 'shift' | 'audit' | 'night' | 'ragnarok' | 'ending';

export interface RunState {
  readonly v: 1;
  readonly seed: string;
  readonly genVersion: number;
  readonly day: number;
  readonly phase: RunPhase;
  /** Today's shift, from beginShift through the audit. */
  readonly shift: ShiftState | null;
  readonly rings: number;
  /** Nights in a row that ended below the debt floor. */
  readonly debtNights: number;
  readonly standing: Readonly<Record<Faction, number>>;
  /** Souls stamped VALHALLA who were worthy, and those who weren't (they flee at Ragnarök). */
  readonly einherjar: { readonly worthy: number; readonly unworthy: number };
  /** Souls sent to each hall, rightly or not (absent in saves from before M7). */
  readonly sent?: Readonly<Partial<Record<Destination, number>>>;
  /** Souls sent on with nails that should have been cut: Naglfar's progress (absent before M7). */
  readonly naglfar?: number;
  /**
   * Souls sent to each hall that belonged elsewhere (docs/tech-spec.md §54), but for those a god asked for and got in
   * full: at Ragnarök they break and run. Absent in runs begun before it was kept, and when there are none.
   */
  readonly misfits?: Readonly<Partial<Record<Destination, number>>>;
  /** The last battle, once it's been fought (docs/tech-spec.md §54). */
  readonly battle?: Battle;
  /**
   * The souls the last battle names (docs/tech-spec.md §54): in each host, those who'll run, and the story's own
   * souls who'll stand. Kept as the misfits are; absent in runs begun before it was, and when there are none.
   */
  readonly named?: readonly NamedSoul[];
  /** The souls whose kin have come to the desk (docs/tech-spec.md §60), by name; absent until one has. */
  readonly kin?: readonly string[];
  readonly family: readonly FamilyMember[];
  readonly upgrades: readonly string[];
  /** Story memory across days. Integers only (Ink reads them). */
  readonly flags: Readonly<Record<string, number>>;
  readonly ledger: readonly DayLedger[];
  /** Scenes whose effects were applied today; each applies once. */
  readonly scenes: readonly string[];
  /**
   * What the scenes played at the desk today will do (docs/tech-spec.md §46): kept for the audit, since standing
   * doesn't move during a shift (the gate's favours are the day's).
   */
  readonly pending?: readonly Effect[];
  /** Rings gained or lost to story effects today, for the night's accounts. */
  readonly storyRings: number;
  /** Standing moved by the story since the last audit; the next audit files it in its ledger. */
  readonly storyStanding?: Readonly<Partial<Record<Faction, number>>>;
  /** Tonight's bills as the player has set them (night only). */
  readonly bills: Bills | null;
  /** Rings spent in the shop tonight. */
  readonly spent: number;
  /**
   * Tonight's other dealings (docs/tech-spec.md §56): rings spent on arms, and got back for upgrades sold. Filed in
   * the night's accounts, and cleared with them.
   */
  readonly trade?: { readonly arms: number; readonly sold: number };
  /** Arms bought for the last battle (docs/tech-spec.md §56): the strength each front has bought, by front id. */
  readonly armed?: Readonly<Record<string, number>>;
  /** How many lots of arms the run has bought, and the night it bought the last. */
  readonly armsBought?: number;
  readonly armedOn?: number;
  readonly ending: string | null;
  /** Story Mode: no sun and no fines. */
  readonly story: boolean;
  /**
   * Seconds of sun the next shift gains or loses (docs/tech-spec.md §50): a trip home at dawn, chosen in a scene.
   * The shift takes it as it begins, and the day's audit files it and clears it.
   */
  readonly dawnS?: number;
  /**
   * The oath, sworn at the start of the run (docs/tech-spec.md §49): no hints, no replays, and fines from the
   * first mistake. Never with Story Mode.
   */
  readonly oath?: true;
  /** A vertical-slice run: after the slice's first days it jumps to its late day. */
  readonly slice?: boolean;
  /**
   * The day events the run drew as it began (docs/tech-spec.md §52), by day. Absent when none, and in runs begun
   * before there were any.
   */
  readonly events?: readonly DayEventAt[];
  /** The run's weave (docs/tech-spec.md §53), by id, when it was begun woven: its rules read in another order. */
  readonly weave?: string;
  /** A soul asking to be judged again this morning (docs/tech-spec.md §40). */
  readonly appeal?: Appeal;
  /** How this morning's appeal went, until the day's audit files it in its ledger. */
  readonly appealHeard?: AppealHeard;
  /**
   * Souls who waited at the gate through the night (docs/tech-spec.md §41), already dressed for today's rules:
   * first in today's line. Absent when none.
   */
  readonly waiting?: readonly CaseSpec[];
  /**
   * The gods' requests (docs/tech-spec.md §42): today's, from the morning through the audit, which settles them
   * and brings the next day's. Absent when none.
   */
  readonly requests?: readonly DayRequest[];
  /** The rank held (docs/tech-spec.md §44): 1 for the first of the campaign's ranks, and so on. Absent: none. */
  readonly rank?: number;
  /** Clean days in a row (every soul judged rightly, none left at dusk) since the last offer. */
  readonly clean?: number;
  /** The rank offered this morning, until it's taken or declined (or the gate opens). */
  readonly offer?: number;
  /** This morning's answer to it, until the day's audit files it. */
  readonly answered?: { readonly rank: number; readonly taken: boolean };
}

/** The host at Ragnarök, part by part: the counts behind ragnarokStrength. */
export interface HostParts {
  /** Worthy einherjar, twice each. */
  readonly worthy: number;
  /** Unworthy einherjar, who flee: against, once each. */
  readonly unworthy: number;
  /** Souls sent to Fólkvangr (Freyja's host), twice each. */
  readonly folkvangr: number;
  /** Souls sent to Hel (her legion), twice each. */
  readonly hel: number;
  /** Souls sent on with their nails uncut (Naglfar): against, twice each. */
  readonly naglfar: number;
  readonly total: number;
}

/**
 * The host at Ragnarök (docs/m7-design.md): worthy einherjar count double, the
 * unworthy (who flee) count against, Freyja's host and Hel's legion count
 * double, and every soul sent on with its nails uncut builds Naglfar. The
 * plan's formula times two, so it stays in whole numbers.
 */
export function hostParts(run: RunState): HostParts {
  const sent = run.sent ?? {};
  const worthy = run.einherjar.worthy;
  const unworthy = run.einherjar.unworthy;
  const folkvangr = sent.FOLKVANGR ?? 0;
  const hel = sent.HEL ?? 0;
  const naglfar = run.naglfar ?? 0;
  const total = 2 * worthy - unworthy + 2 * folkvangr + 2 * hel - 2 * naglfar;
  return { worthy, unworthy, folkvangr, hel, naglfar, total };
}

export function ragnarokStrength(run: RunState): number {
  return hostParts(run).total;
}

/** A god's standing minus the highest standing of the others: above 0, they lead. */
export function standingLead(run: RunState, faction: Faction): number {
  let best = Number.NEGATIVE_INFINITY;
  for (const [f, n] of Object.entries(run.standing)) if (f !== faction) best = Math.max(best, n);
  return (run.standing[faction] ?? 0) - (best === Number.NEGATIVE_INFINITY ? 0 : best);
}

/**
 * The powers the player has dealings with so far: those whose standing has moved, by a mistake or by
 * the story, on any day, even if it has come back to 0 (or that is off zero, for saves from before
 * story standing was kept). The rest stay out of sight, so a power turns up when the story brings it in.
 */
export function factionsMet(run: RunState): Faction[] {
  const moved = (s: Readonly<Partial<Record<Faction, number>>> | undefined, f: Faction) => s !== undefined && f in s;
  return FACTIONS.filter(
    (f) =>
      run.standing[f] !== 0 ||
      moved(run.storyStanding, f) ||
      run.ledger.some(
        (l) =>
          moved(l.standing, f) ||
          moved(l.story, f) ||
          moved(l.appeal?.standing, f) ||
          moved(l.waiting?.standing, f) ||
          (l.requests ?? []).some((r) => moved(r.standing, f)),
      ),
  );
}

/**
 * The numbers a StatePred can read:
 * `day`, `rings`, `debtNights`, `standing.<faction>`, `lead.<faction>`,
 * `einherjar.worthy`, `einherjar.unworthy`, `sent.<DESTINATION>`, `naglfar`,
 * `ragnarok`, `flags.<name>`, `family.well`, `family.sick`, `family.home`
 * (not gone) and `family.gone`; and after the last battle (docs/tech-spec.md §54), `fronts` (how many held) and
 * `front.<name>` (1 if the front of that id held). Before it, both read 0.
 */
export function stateValue(run: RunState, path: string): number {
  const [head, key] = path.split('.', 2) as [string, string | undefined];
  switch (head) {
    case 'fronts':
      return run.battle?.fronts.filter((f) => f.held).length ?? 0;
    case 'front':
      return run.battle?.fronts.some((f) => f.id === path && f.held) ? 1 : 0;
    case 'lead':
      return standingLead(run, key as Faction);
    case 'sent':
      return run.sent?.[key as Destination] ?? 0;
    case 'naglfar':
      return run.naglfar ?? 0;
    // Lots of arms bought for the last battle (docs/tech-spec.md §56).
    case 'arms':
      return run.armsBought ?? 0;
    case 'ragnarok':
      return ragnarokStrength(run);
    case 'day':
      return run.day;
    case 'oath':
      return run.oath ? 1 : 0;
    case 'rings':
      return run.rings;
    case 'debtNights':
      return run.debtNights;
    case 'standing':
      return run.standing[key as Faction] ?? 0;
    case 'einherjar':
      return key === 'worthy' ? run.einherjar.worthy : run.einherjar.unworthy;
    case 'flags':
      return run.flags[key ?? ''] ?? 0;
    case 'family': {
      if (key === 'home') return run.family.filter((m) => m.status !== 'gone').length;
      return run.family.filter((m) => m.status === key).length;
    }
    // One of the family by id, and how they are (docs/tech-spec.md §55): gone, or died or left in particular.
    case 'member': {
      const [, id, how] = path.split('.');
      const m = run.family.find((x) => x.id === id);
      if (!m) return 0;
      if (how === 'died' || how === 'left') return m.status === 'gone' && m.gone === how ? 1 : 0;
      return m.status === how ? 1 : 0;
    }
    // The ending the run came to (docs/tech-spec.md §55): only an epilogue can read it, the run being over.
    case 'ending':
      return run.ending === path ? 1 : 0;
    default:
      return 0;
  }
}

export function evalState(p: StatePred, run: RunState): boolean {
  return evalPred(p, (path) => stateValue(run, path));
}

/** A StatePred over any numbers read by path: the run's, or an achievement moment's. */
export function evalPred(p: StatePred, read: (path: string) => number): boolean {
  if ('all' in p) return p.all.every((q) => evalPred(q, read));
  if ('any' in p) return p.any.some((q) => evalPred(q, read));
  if ('not' in p) return !evalPred(p.not, read);
  const v = read(p.state);
  return (
    (p.is === undefined || v === p.is) && (p.gte === undefined || v >= p.gte) && (p.lte === undefined || v <= p.lte)
  );
}

/** Every path a StatePred reads. */
export function predPaths(p: StatePred): string[] {
  if ('all' in p) return p.all.flatMap(predPaths);
  if ('any' in p) return p.any.flatMap(predPaths);
  if ('not' in p) return predPaths(p.not);
  return [p.state];
}

/** Paths a StatePred may use (the content linter checks endings against it). */
export const STATE_PATHS =
  /^(day|rings|debtNights|naglfar|arms|ragnarok|oath|fronts|front\.[A-Za-z0-9_]+|(standing|lead)\.(odin|freyja|hel|loki|clerk)|einherjar\.(worthy|unworthy)|sent\.(VALHALLA|FOLKVANGR|HEL|RAN|RETURN|DETAIN|TRANSFER)|flags\.[A-Za-z0-9_]+|family\.(well|sick|home|gone)|member\.[A-Za-z0-9_]+\.(well|sick|gone|died|left)|ending\.[A-Za-z0-9_]+)$/;

/** Whether a StatePred reads the last battle (docs/tech-spec.md §54): what it asks can't be known before it's fought. */
export function readsBattle(p: StatePred): boolean {
  return predPaths(p).some((path) => path === 'fronts' || path.startsWith('front.'));
}
