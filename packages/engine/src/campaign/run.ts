import type {
  CampaignDef,
  Content,
  DeskVisit,
  Destination,
  Economy,
  Effect,
  EndingDef,
  Faction,
  FavourDef,
  RankDef,
  SliceDef,
  StatePred,
  UpgradeDef,
} from '../content/types';
import { DESTINATIONS, FACTIONS } from '../content/types';
import { dressForDay, generateCase, generateDay, planDay } from '../gen/generate';
import { skaldTally } from '../gen/kennings';
import { linkParties } from '../gen/party';
import { weightedPick } from '../gen/pick';
import { scriptedCase } from '../gen/scripted';
import type { CaseSpec } from '../gen/types';
import type { DayCtx } from '../logic/context';
import { eval2 } from '../logic/pred';
import { Rng } from '../rng/rng';
import {
  type Assists,
  type ShiftAction,
  type ShiftEvent,
  type ShiftMods,
  type ShiftState,
  startShift,
  stepShift,
  type Verdict,
} from '../shift/shift';
import { type Battle, battleDue, fight } from './battle';
import { draftsTonight } from './decrees';
import {
  dayContext,
  daySpecFor,
  drawEvents,
  editLine,
  eventOn,
  type LineEdit,
  lineEdits,
  unwovenContext,
} from './events';
import { dayGrade } from './grade';
import { guiseOn, lokiLearns, lokiToday } from './loki';
import { familyDefs, fedAtHome, originOf } from './origin';
import { pleaOf, withKin, withPlea } from './pleas';
import {
  type Appeal,
  type AppealHeard,
  type Bills,
  type DayLedger,
  type DayMistake,
  type DayPlea,
  type DayRequest,
  type DayWaiting,
  dayAfter,
  evalState,
  type FamilyMember,
  type FoundAsk,
  type LineSoul,
  type NamedSoul,
  type RequestSettled,
  type RunState,
  type RunTrail,
  readsBattle,
  type SealedDecree,
  stateValue,
  type TrailMark,
} from './state';
import { canAccuse, culpritOf, markTrail, pinsToday, trailOf } from './trail';
import { settleVow, vowOffer } from './vows';
import { drawWeave, underWeave } from './weave';
import { askedFalsely, foundOut, movedWord, ordinaryOffer, wordDef, wordOf } from './word';

/*
 * The campaign's day loop (docs/tech-spec.md §4):
 *   morning -> beginShift -> shift -> audit -> endAudit -> night -> endNight -> next morning
 * Scenes (morning and night) arrive as `scene` actions carrying their effects,
 * which the story layer computes from the player's choices. After the last night, in builds that have one, comes the
 * last battle (docs/tech-spec.md §54): ragnarok -> marshal -> ending.
 */

export type RunAction =
  | {
      readonly t: 'beginShift';
      readonly at: number;
      /** The assists the player has on as the shift begins (they're kept with the day's shift). */
      readonly assists?: Assists;
    }
  | { readonly t: 'shift'; readonly action: ShiftAction }
  | { readonly t: 'endAudit' }
  | { readonly t: 'bills'; readonly bills: Bills }
  | { readonly t: 'buy'; readonly item: string }
  /** At night, an upgrade sold back for its share of the price (docs/tech-spec.md §56). */
  | { readonly t: 'sell'; readonly item: string }
  /** At night, a lot of arms bought for a front of the last battle (docs/tech-spec.md §56). */
  | { readonly t: 'arm'; readonly front: string }
  | {
      readonly t: 'scene';
      readonly id: string;
      /** The choices made, for replays and reports; the engine applies only `effects`. */
      readonly choices?: readonly number[];
      readonly effects: readonly Effect[];
    }
  | { readonly t: 'endNight' }
  /**
   * The morning's appeal heard: the soul stamped again at the desk, on the rules of the day it was judged
   * (docs/tech-spec.md §40), or null to let the verdict stand.
   */
  | { readonly t: 'appeal'; readonly stamped: Destination | null }
  /** The morning's promotion taken or declined (docs/tech-spec.md §44). */
  | { readonly t: 'promotion'; readonly accept: boolean }
  /** At night, back down a rank. */
  | { readonly t: 'stepDown' }
  /** The horn (docs/tech-spec.md §54): the order the fronts are held in, and the front the chooser rides to (§58). */
  | { readonly t: 'marshal'; readonly order: readonly string[]; readonly ride?: string }
  /** On one of the forger's trail's nights, the carver named (docs/tech-spec.md §71), once a run. */
  | { readonly t: 'accuse'; readonly suspect: string }
  /** At night, a vow sworn at the cup for tomorrow (docs/tech-spec.md §75), from tonight's offer; null takes it back. */
  | { readonly t: 'vow'; readonly id: string | null }
  /**
   * At night, one of tonight's drafts of tomorrow's decree to seal as the night ends (docs/tech-spec.md §79), by id;
   * null sends both back.
   */
  | { readonly t: 'seal'; readonly draft: string | null };

export type RunEvent =
  | { readonly e: 'shift'; readonly event: ShiftEvent }
  | { readonly e: 'audited'; readonly ledger: DayLedger }
  | { readonly e: 'bought'; readonly item: string }
  | { readonly e: 'sold'; readonly item: string; readonly rings: number }
  | { readonly e: 'armed'; readonly front: string; readonly strength: number; readonly price: number }
  /** A debt that would have ended the run was paid, once (docs/tech-spec.md §56): the rings it took. */
  | { readonly e: 'reprieve'; readonly rings: number }
  | { readonly e: 'scene'; readonly id: string; readonly effects: readonly Effect[] }
  | { readonly e: 'family'; readonly id: string; readonly change: 'sick' | 'well' | 'died' | 'left' }
  | { readonly e: 'draupnir'; readonly rings: number }
  | { readonly e: 'dayBegins'; readonly day: number }
  | { readonly e: 'ended'; readonly ending: string }
  | { readonly e: 'appealed'; readonly heard: AppealHeard }
  | { readonly e: 'promotion'; readonly rank: number; readonly taken: boolean }
  | { readonly e: 'steppedDown'; readonly rank: number }
  /** The horn: the last night is over, and the hosts wait for their fronts (docs/tech-spec.md §54). */
  | { readonly e: 'horn' }
  | { readonly e: 'fought'; readonly battle: Battle }
  /** A carver named on the forger's trail (docs/tech-spec.md §71), and whether he was the one. */
  | { readonly e: 'accused'; readonly suspect: string; readonly right: boolean }
  /** A false ask granted, found out this morning (docs/tech-spec.md §73): the soul, the day it was judged, its hall. */
  | { readonly e: 'found'; readonly name: string; readonly day: number; readonly hall: Destination }
  /** A vow sworn at the cup for tomorrow (docs/tech-spec.md §75), or taken back (null). */
  | { readonly e: 'sworn'; readonly vow: string | null }
  /** A draft of tomorrow's decree sealed as the night ended (docs/tech-spec.md §79): the day it rules. */
  | { readonly e: 'sealed'; readonly day: number; readonly draft: string }
  | { readonly e: 'rejected'; readonly reason: string };

export interface RunEnv {
  readonly content: Content;
  /** The day context for `run.day` (callers cache it; `runContext` builds one). */
  readonly ctx: DayCtx;
  /** A queue saved earlier for this day, used instead of generating one (see startShift). */
  readonly queue?: readonly CaseSpec[];
}

const zeroStanding = (): Record<Faction, number> =>
  Object.fromEntries(FACTIONS.map((f) => [f, 0])) as Record<Faction, number>;

export function campaignOf(content: Content): CampaignDef {
  if (!content.campaign) throw new Error('This build has no campaign');
  return content.campaign;
}

export interface NewRunOptions {
  /** Story Mode: no sun and no fines. */
  readonly story?: boolean;
  /** The oath (docs/tech-spec.md §49): no hints, no replays, fines from the first mistake. Not with Story Mode. */
  readonly oath?: boolean;
  /** The vertical slice: its first days, then the jump to its late day ('fromJump' starts on that day). */
  readonly slice?: 'play' | 'fromJump';
  /** Begun woven (docs/tech-spec.md §53): the run draws a weave, its rules read in another order. */
  readonly woven?: boolean;
  /** Who the chooser was in life (docs/tech-spec.md §72), by id: not with the vertical slice. */
  readonly origin?: string;
}

export function newRun(content: Content, seed: string, opts: NewRunOptions = {}): RunState {
  const campaign = campaignOf(content);
  if (opts.slice && !campaign.slice) throw new Error('This build has no vertical slice');
  if (opts.oath && opts.story) throw new Error('The oath and Story Mode are not played together');
  if (opts.origin !== undefined) {
    if (!campaign.origins?.some((o) => o.id === opts.origin))
      throw new Error(`This build has no origin "${opts.origin}"`);
    if (opts.slice) throw new Error('The vertical slice is played without an origin');
  }
  // The run's day events (docs/tech-spec.md §52), drawn as it begins and kept, so a replayed day has the same.
  const events = drawEvents(content, seed);
  const weave = opts.woven ? drawWeave(content, seed) : undefined;
  const run = {
    ...firstMorning(campaign, seed, content.genVersion, opts),
    ...(events.length > 0 ? { events } : {}),
    ...(weave ? { weave: weave.id } : {}),
  };
  return opts.slice === 'fromJump' && campaign.slice ? jump(run, campaign.slice) : run;
}

function firstMorning(campaign: CampaignDef, seed: string, genVersion: number, opts: NewRunOptions): RunState {
  // Who she was in life (docs/tech-spec.md §72): someone more at home, and perhaps rings to start with.
  const origin = campaign.origins?.find((o) => o.id === opts.origin);
  const family = [...campaign.family, ...(origin?.member ? [origin.member] : [])];
  return {
    v: 1,
    seed,
    genVersion,
    day: 1,
    phase: 'morning',
    shift: null,
    rings: campaign.startRings + (origin?.perk.startRings ?? 0),
    debtNights: 0,
    standing: zeroStanding(),
    einherjar: { worthy: 0, unworthy: 0 },
    family: family.map((f) => ({ id: f.id, status: 'well', cold: 0, hungry: 0, sickNights: 0 })),
    upgrades: [],
    flags: {},
    ledger: [],
    scenes: [],
    storyRings: 0,
    bills: null,
    spent: 0,
    ending: null,
    story: opts.story === true,
    ...(opts.oath ? { oath: true as const } : {}),
    ...(opts.slice ? { slice: true } : {}),
    ...(origin ? { origin: origin.id } : {}),
  };
}

/**
 * The day after `run.day`: the next one, or in a vertical slice the jump over
 * the unwritten middle.
 */
function nextMorning(run: RunState, campaign: CampaignDef): RunState {
  const slice = run.slice ? campaign.slice : undefined;
  if (!slice || run.day !== slice.after) return { ...run, day: run.day + 1 };
  return jump(run, slice);
}

/**
 * Tonight's draft of tomorrow's decree, sealed as the night ends (docs/tech-spec.md §79): the day it rules takes its
 * choices, and its effects (the god it pleases, the one it annoys) land with the story's standing, for that day's audit.
 */
function sealTonight(run: RunState, env: RunEnv, events: RunEvent[]): RunState {
  const { seal, ...rest } = run;
  if (seal === undefined) return run;
  const draft = draftsTonight(run, env.content).find((d) => d.def.id === seal);
  if (!draft) return rest;
  const decree: SealedDecree = { day: draft.day, draft: draft.def.id, choose: draft.choose };
  const sealed = [...(rest.sealed ?? []).filter((s) => s.day !== draft.day), decree];
  events.push({ e: 'sealed', day: draft.day, draft: draft.def.id });
  return applyEffects({ ...rest, sealed }, draft.def.effects, events, env.content);
}

/** The slice's late day, with what the skipped days would have brought (the run's own flags win). */
function jump(run: RunState, slice: SliceDef): RunState {
  const standing = { ...run.standing };
  const story = { ...run.storyStanding };
  for (const [f, by] of Object.entries(slice.preset.standing ?? {})) {
    standing[f as Faction] = (standing[f as Faction] ?? 0) + (by ?? 0);
    story[f as Faction] = (story[f as Faction] ?? 0) + (by ?? 0);
  }
  return {
    ...run,
    day: slice.day,
    rings: run.rings + (slice.preset.rings ?? 0),
    standing,
    storyStanding: story,
    flags: { ...slice.preset.flags, ...run.flags },
  };
}

/**
 * The string key a power goes by on `day`: its own name, or the alias it wears before the story
 * names it (the stranger is Loki, but nobody says so until Day 12).
 */
export function factionKey(content: Content, faction: Faction, day: number): string {
  const alias = content.campaign?.aliases?.find((a) => a.faction === faction && day < a.untilDay);
  return alias?.name ?? `faction.${faction}`;
}

/** The upgrades' combined effect on today's shift, with the gods' favours and any trip home at dawn. */
export function shiftMods(run: RunState, content: Content): ShiftMods {
  const owned = campaignOf(content).shop.filter((u) => run.upgrades.includes(u.id));
  const toolCostS: Record<string, number> = {};
  let questionS: number | undefined;
  let sunS = 0;
  for (const u of owned) {
    const e = u.effect;
    if ('tool' in e) toolCostS[e.tool] = Math.min(toolCostS[e.tool] ?? e.costS, e.costS);
    else if ('questionS' in e) questionS = Math.min(questionS ?? e.questionS, e.questionS);
    else sunS += e.sunS;
  }
  // The gods' favours for the day (docs/tech-spec.md §43); a sick member's extra night is the night's, not the shift's.
  let freeQuestions = 0;
  let finePct: number | undefined;
  for (const f of favoursFor(run, content)) {
    const e = f.effect;
    if ('sunS' in e) sunS += e.sunS;
    else if ('freeQuestions' in e) freeQuestions += e.freeQuestions;
    else if ('finePct' in e) finePct = Math.min(finePct ?? e.finePct, e.finePct);
  }
  // Who she was in life (docs/tech-spec.md §72): tools she's quicker with, questions that cost nothing, more sun.
  const perk = originOf(run, content)?.perk;
  for (const t of perk?.tools ?? []) toolCostS[t.tool] = Math.min(toolCostS[t.tool] ?? t.costS, t.costS);
  freeQuestions += perk?.freeQuestions ?? 0;
  sunS += perk?.sunS ?? 0;
  // A trip home at dawn (docs/tech-spec.md §50), chosen in a scene, but never the whole day: the gate keeps the
  // campaign's minSunS of it at least.
  sunS += run.dawnS ?? 0;
  const daySun = daySpecFor(content, run, run.day)?.sunS;
  if (daySun !== undefined) sunS = Math.max(sunS, campaignOf(content).minSunS - daySun);
  return {
    ...(Object.keys(toolCostS).length > 0 ? { toolCostS } : {}),
    ...(questionS !== undefined ? { questionS } : {}),
    ...(sunS !== 0 ? { sunS } : {}),
    ...(freeQuestions > 0 ? { freeQuestions } : {}),
    ...(finePct !== undefined ? { finePct } : {}),
  };
}

/**
 * The gods' favours (docs/tech-spec.md §43) that the run's standing earns now: each god whose standing is at a
 * favour's mark. The gate grants them for the day and its night, so the morning's standing decides the day's.
 */
export function favoursFor(run: RunState, content: Content): FavourDef[] {
  return (campaignOf(content).favours ?? []).filter((f) => run.standing[f.faction] >= f.at);
}

/** Family care tonight: the campaign's, and the chance a day event (docs/tech-spec.md §52) brings, bills or not. */
export type NightCare = CampaignDef['care'] & {
  /** Percent chance that each of the family who is well falls sick tonight whatever the bills. */
  readonly sickAnyway?: number;
};

/**
 * Family care tonight: the campaign's, with what a god's favour gives the sick (nights more to hold out) and the
 * well (less chance of falling sick), and any sickness the day's event brings. The favours are the day's, as its
 * audit filed them; before then, those the gate will grant.
 */
export function careFor(run: RunState, content: Content): NightCare {
  const campaign = campaignOf(content);
  const today = run.ledger[run.ledger.length - 1];
  const ids = today?.day === run.day ? (today.favours ?? []) : favoursFor(run, content).map((f) => f.id);
  let extra = 0;
  let chancePct = 100;
  for (const f of campaign.favours ?? []) {
    const e = f.effect;
    if (!ids.includes(f.id) || !('sickNights' in e)) continue;
    extra += e.sickNights;
    chancePct = Math.min(chancePct, e.sickChancePct ?? 100);
  }
  const event = eventOn(run, content, run.day)?.sickChance ?? 0;
  const sickAnyway = Math.floor((event * chancePct) / 100);
  if (extra === 0 && chancePct === 100 && sickAnyway === 0) return campaign.care;
  const { sickNights, sickChance } = campaign.care;
  return {
    ...campaign.care,
    sickNights: sickNights + extra,
    sickChance: Math.floor((sickChance * chancePct) / 100),
    ...(sickAnyway > 0 ? { sickAnyway } : {}),
  };
}

/**
 * The upgrades on sale tonight, at the prices the run pays (docs/tech-spec.md §72): less for a trader's daughter, and
 * none that would make a tool slower than who she was already makes it.
 */
export function shopFor(run: RunState, content: Content): UpgradeDef[] {
  const perk = originOf(run, content)?.perk;
  const pct = perk?.shopPct ?? 100;
  const outdone = (u: UpgradeDef) => {
    const e = u.effect;
    return 'tool' in e && (perk?.tools ?? []).some((t) => t.tool === e.tool && t.costS <= e.costS);
  };
  return campaignOf(content)
    .shop.filter((u) => u.since <= run.day && !run.upgrades.includes(u.id) && !outdone(u))
    .map((u) => (pct === 100 ? u : { ...u, price: Math.floor((u.price * pct) / 100) }));
}

/** What an upgrade the run has sells back for tonight (docs/tech-spec.md §56), or null if it can't be sold. */
export function sellPrice(run: RunState, content: Content, item: string): number | null {
  const share = campaignOf(content).sellBack;
  const u = campaignOf(content).shop.find((x) => x.id === item);
  if (share === undefined || !u || !run.upgrades.includes(item)) return null;
  // Its share of what the run paid for it: a trader's daughter paid less (docs/tech-spec.md §72).
  const pct = originOf(run, content)?.perk.shopPct ?? 100;
  return Math.floor((Math.floor((u.price * pct) / 100) * share) / 100);
}

/**
 * The next lot of arms tonight (docs/tech-spec.md §56): its price and strength, and whether the run can buy it. Null
 * in a build without arms, before they're for sale, or once they've run out.
 */
export function armsTonight(
  run: RunState,
  content: Content,
): { readonly price: number; readonly strength: number; readonly bought: boolean } | null {
  const arms = campaignOf(content).arms;
  if (!arms || run.day < arms.from || run.slice) return null;
  const price = arms.prices[run.armsBought ?? 0];
  if (price === undefined) return null;
  return { price, strength: arms.strength, bought: run.armedOn === run.day };
}

export function economyOf(env: RunEnv): Economy {
  const e = env.ctx.spec.economy;
  if (!e) throw new Error(`Day ${env.ctx.day} has no economy`);
  return e;
}

/** The rank the run holds (docs/tech-spec.md §44), if any. */
export function rankOf(run: RunState, content: Content): RankDef | undefined {
  return run.rank ? campaignOf(content).promotion?.ranks[run.rank - 1] : undefined;
}

/**
 * Odin's tithe tonight (docs/tech-spec.md §44): for the rank the day was worked at, so stepping down tonight
 * counts from tomorrow; before the day's audit files it, for the rank held now.
 */
export function titheTonight(run: RunState, content: Content): number {
  const today = run.ledger[run.ledger.length - 1];
  const rank = today?.day === run.day ? today.rank : run.rank;
  return rank ? (campaignOf(content).promotion?.ranks[rank - 1]?.tithe ?? 0) : 0;
}

/** The day's economy at the run's rank: a higher wage, and fewer citations forgiven. */
export function economyFor(run: RunState, env: RunEnv): Economy {
  const e = economyOf(env);
  const rank = rankOf(run, env.content);
  const ranked = rank ? { ...e, wage: e.wage + rank.wage, warnings: Math.max(0, e.warnings + rank.warnings) } : e;
  // Under the oath (docs/tech-spec.md §49) no mistake is forgiven: fines from the first.
  return run.oath ? { ...ranked, warnings: 0 } : ranked;
}

/** What tonight's bills cost as set: food for everyone the purse feeds (docs/tech-spec.md §72). */
export function billTotal(
  run: RunState,
  economy: Economy,
  bills: Bills,
  content: Content,
): { hearth: number; food: number; medicine: number } {
  const home = run.family.filter((m) => m.status !== 'gone');
  const sick = new Set(home.filter((m) => m.status === 'sick').map((m) => m.id));
  return {
    hearth: bills.hearth ? economy.costs.hearth : 0,
    food: bills.food ? economy.costs.food * fedAtHome(run, content).length : 0,
    medicine: economy.costs.medicine * bills.medicine.filter((id) => sick.has(id)).length,
  };
}

/** Bills default to paying for everything, as a careful player would. */
export function defaultBills(run: RunState): Bills {
  return { hearth: true, food: true, medicine: run.family.filter((m) => m.status === 'sick').map((m) => m.id) };
}

const matches = (want: Destination | '*', got: Destination) => want === '*' || want === got;

/** What sending a soul that belonged in `expected` to `stamped` does to standing: nothing when it's right. */
export function standingFx(
  campaign: CampaignDef,
  expected: Destination,
  stamped: Destination,
): Partial<Record<Faction, number>> {
  if (stamped === expected) return {};
  const rule = campaign.standing.find((r) => matches(r.expected, expected) && matches(r.stamped, stamped));
  return { ...rule?.fx };
}

/** Destinations a soul judged rightly might still argue with. */
const GRUDGES: ReadonlySet<Destination> = new Set(['HEL', 'RAN', 'TRANSFER']);

/**
 * The soul, if any, that asks tomorrow morning to be judged again (docs/tech-spec.md §40): most likely one of
 * today's souls sent to the wrong place; sometimes one judged rightly into a hall it resents, trying its luck.
 * Story souls have their own consequences and never appeal, nor do souls who came with a party (docs/tech-spec.md
 * §69). Drawn from its own stream of the run's seed, so the same run always brings the same appeals.
 */
function chooseAppeal(
  run: RunState,
  shift: ShiftState,
  campaign: CampaignDef,
  costs: ReadonlyMap<number, { fine: number; standing: Partial<Record<Faction, number>>; worthy: boolean }>,
  fined: boolean,
  given: (v: Verdict) => boolean,
): Appeal | undefined {
  const def = campaign.appeals;
  if (!def || run.day < def.from || run.day >= campaign.lastDay) return undefined;
  // What a party's member said of its companions needs them there.
  const story = (v: Verdict) => shift.cases[v.index]?.script !== undefined || shift.cases[v.index]?.party !== undefined;
  const judged = shift.verdicts.filter((v) => v.stamped !== null && !story(v));
  const wronged = judged.filter((v) => v.stamped !== v.expected && !given(v));
  const chancers = judged.filter((v) => v.correct && GRUDGES.has(v.expected));
  if (wronged.length + chancers.length === 0) return undefined;
  const rng = new Rng(`${run.seed}|appeal|${run.day}`);
  if (!rng.chance(wronged.length > 0 ? def.afterMistake : def.otherwise, 100)) return undefined;
  const pool =
    wronged.length === 0
      ? chancers
      : chancers.length === 0
        ? wronged
        : rng.chance(def.chancers, 100)
          ? chancers
          : wronged;
  const v = pool[rng.int(0, pool.length - 1)];
  const c = v ? shift.cases[v.index] : undefined;
  if (!v || !c || v.stamped === null) return undefined;
  const cost = costs.get(v.index);
  return {
    day: run.day,
    case: c,
    stamped: v.stamped,
    worthy: cost?.worthy ?? false,
    fined,
    fine: cost?.fine ?? 0,
    standing: cost?.standing ?? {},
  };
}

/** A soul's name as the screens give it: its name and its father's. */
export const soulName = (c: CaseSpec): string => `${c.evidence.look.name} ${c.evidence.look.patronym}`;

/**
 * Whether a soul stamped to a hall is one the last battle names there (docs/tech-spec.md §54): one who'll run (to
 * Valhalla, the unworthy; elsewhere, one sent by mistake and not given to a god who asked), a story soul, or one who
 * asked to be there (§59).
 */
function namedAs(
  campaign: CampaignDef,
  c: CaseSpec,
  day: number,
  hall: Destination,
  runs: boolean,
  asked = false,
): NamedSoul[] {
  if (!(campaign.ragnarok?.hosts ?? []).some((h) => h.hall === hall)) return [];
  return runs || c.script || asked ? [{ name: soulName(c), day, hall, runs }] : [];
}

/** Whether a verdict sent its soul, wrongly, where the soul asked to go (docs/tech-spec.md §51, §59): a plea granted. */
function pleaGranted(content: Content, shift: ShiftState, v: Verdict): boolean {
  const c = shift.cases[v.index];
  return c !== undefined && v.stamped !== null && v.stamped !== v.expected && pleaOf(content, c)?.dest === v.stamped;
}

/** Moves a soul from one hall to another in the run's counts (Ragnarök's host is made of them). */
function moveSoul(
  run: RunState,
  appeal: Appeal,
  to: Destination,
  campaign: CampaignDef,
): Pick<RunState, 'sent' | 'einherjar' | 'misfits' | 'named'> {
  const sent: Partial<Record<Destination, number>> = { ...run.sent };
  sent[appeal.stamped] = Math.max(0, (sent[appeal.stamped] ?? 0) - 1);
  sent[to] = (sent[to] ?? 0) + 1;
  const einherjar = { ...run.einherjar };
  const kind = appeal.worthy ? 'worthy' : 'unworthy';
  if (appeal.stamped === 'VALHALLA') einherjar[kind] = Math.max(0, einherjar[kind] - 1);
  if (to === 'VALHALLA') einherjar[kind] += 1;
  // A soul in the wrong hall leaves it, and one sent to a wrong hall joins it as a misfit (docs/tech-spec.md §54).
  const expected = appeal.case.expect.dest;
  const misfits: Partial<Record<Destination, number>> = { ...run.misfits };
  if (appeal.stamped !== expected) misfits[appeal.stamped] = Math.max(0, (misfits[appeal.stamped] ?? 0) - 1);
  if (to !== expected) misfits[to] = (misfits[to] ?? 0) + 1;
  // And so do the souls the battle names: it leaves the host it was in (once, should two share a name), for the one
  // it joins.
  const name = soulName(appeal.case);
  const named = [...(run.named ?? [])];
  const at = named.findIndex((n) => n.name === name && n.day === appeal.day && n.hall === appeal.stamped);
  if (at >= 0) named.splice(at, 1);
  named.push(...namedAs(campaign, appeal.case, appeal.day, to, to === 'VALHALLA' ? !appeal.worthy : to !== expected));
  return { sent, einherjar, misfits, ...(named.length > 0 || run.named ? { named } : {}) };
}

/**
 * The appeal decided (docs/tech-spec.md §40). Righted: its fine comes back and the standing it moved is
 * undone. Upheld with good reason: a small bonus. Decided wrongly: a fine, and the gods mind where the soul
 * went. Left to stand: nothing changes. The soul goes wherever it was last stamped.
 */
function hearAppeal(run: RunState, appeal: Appeal, stamped: Destination | null, campaign: CampaignDef): RunState {
  const def = campaign.appeals;
  const c = appeal.case;
  const expected = c.expect.dest;
  const base = {
    day: appeal.day,
    name: c.evidence.look.name,
    from: appeal.stamped,
    to: stamped,
    expected,
    rule: c.expect.rule,
  };
  if (stamped === null || !def) {
    const heard: AppealHeard = { ...base, to: null, outcome: 'letStand', rings: 0, standing: {} };
    const { appeal: _, ...rest } = run;
    return { ...rest, appealHeard: heard };
  }
  const wasRight = appeal.stamped === expected;
  const nowRight = stamped === expected;
  const outcome: AppealHeard['outcome'] = nowRight ? (wasRight ? 'upheld' : 'righted') : 'wrong';
  const rings = outcome === 'righted' ? appeal.fine : outcome === 'upheld' ? def.bonus : appeal.fined ? -def.fine : 0;
  // What the verdict moved goes, and what the new one moves comes: righting a mistake undoes it exactly.
  const standing: Partial<Record<Faction, number>> = {};
  const add = (fx: Partial<Record<Faction, number>>, sign: number) => {
    for (const [f, n] of Object.entries(fx)) {
      const next = (standing[f as Faction] ?? 0) + sign * (n ?? 0);
      if (next === 0) delete standing[f as Faction];
      else standing[f as Faction] = next;
    }
  };
  add(appeal.standing, -1);
  add(standingFx(campaign, expected, stamped), 1);
  const nextStanding = { ...run.standing };
  for (const [f, n] of Object.entries(standing)) nextStanding[f as Faction] += n ?? 0;
  const moved = stamped === appeal.stamped ? {} : moveSoul(run, appeal, stamped, campaign);
  const heard: AppealHeard = { ...base, outcome, rings, standing };
  const { appeal: _, ...rest } = run;
  return { ...rest, ...moved, rings: run.rings + rings, standing: nextStanding, appealHeard: heard };
}

/**
 * A day's own souls (as its event and weave leave them), with those who waited through the night (docs/tech-spec.md §41)
 * placed first, after the day's teaching soul, each in the place of one of the day's: one who shares its name if
 * there is one, so no two in the line do, else the last. The line is no longer for them.
 */
function lineFor(
  seed: string,
  ctx: DayCtx,
  waiting: readonly CaseSpec[],
  edits: readonly LineEdit[],
  plain?: DayCtx,
): CaseSpec[] {
  // Under a weave (docs/tech-spec.md §53), the day's own souls are made as in any run, then seen under its order.
  const own = plain ? wovenOwn(seed, plain, ctx) : generateDay(seed, ctx).cases;
  const teach = ctx.spec.queue.teachFirst;
  const front = teach !== undefined && own[0]?.archetype === teach ? 1 : 0;
  // The day's event and the run's weave (docs/tech-spec.md §52, §53): some of the day's own souls don't come, and
  // theirs come among the rest.
  const cases = edits.reduce<CaseSpec[]>((line, edit) => editLine(seed, ctx, line, front, edit), own.slice());
  for (const w of waiting) {
    const same = cases.findIndex((c, i) => i >= front && c.evidence.look.name === w.evidence.look.name);
    const drop = same >= 0 ? same : cases.length - 1;
    if (drop >= front) cases.splice(drop, 1);
  }
  cases.splice(front, 0, ...waiting);
  return cases;
}

/**
 * The day's own souls, made under its own order (`plain`) and seen under the weave's (`ctx`). One no dressing fits
 * (the sweeps haven't seen one) gives its place to a soul made under the weave, bound where it was.
 */
function wovenOwn(seed: string, plain: DayCtx, ctx: DayCtx): CaseSpec[] {
  return generateDay(seed, plain).cases.map(
    (c) => underWeave(c, ctx) ?? generateCase(seed, ctx, c.procIndex, c.expect.dest).case,
  );
}

/**
 * The souls a rank adds to the day (docs/tech-spec.md §44), after its own: each made as the day's souls are, at
 * the places after them, bound for a destination drawn from the day's mix on a stream of its own, so the day's
 * own line is the same at any rank. One who'd share a name with a soul already in the line is passed over.
 */
function extraSouls(seed: string, ctx: DayCtx, n: number, line: readonly CaseSpec[], plain?: DayCtx): CaseSpec[] {
  if (n <= 0 || ctx.spec.queue.script) return [];
  const { mix } = ctx.spec.queue;
  const dests = DESTINATIONS.filter((d) => mix[d] !== undefined && ctx.destinations.has(d));
  if (dests.length === 0) return [];
  const rng = new Rng(`${ctx.content.genVersion}|${seed}|${ctx.day}|rank`);
  const weights = dests.map((d) => {
    const [lo, hi] = mix[d] as readonly [number, number];
    return Math.max(1, Math.floor((lo + hi) / 2));
  });
  const names = new Set(line.map((c) => `${c.evidence.look.name} ${c.evidence.look.patronym}`));
  const extra: CaseSpec[] = [];
  const first = planDay(seed, ctx).count;
  for (let i = first; extra.length < n && i < first + n * 4; i++) {
    // Under a weave (docs/tech-spec.md §53), made as in any run and seen under its order.
    const made = generateCase(seed, plain ?? ctx, i, weightedPick(dests, weights, rng)).case;
    const c = plain ? underWeave(made, ctx) : made;
    if (!c) continue;
    const name = `${c.evidence.look.name} ${c.evidence.look.patronym}`;
    if (names.has(name)) continue;
    names.add(name);
    extra.push(c);
  }
  return extra;
}

/**
 * Today's queue: the day's line (its own souls and any who waited through the
 * night), with the day's story souls placed among them. Generated souls are the
 * same with or without the story souls, which only appear when their `when`
 * holds as the shift begins. After a noon decree (docs/tech-spec.md §45), every
 * soul made under it comes after every soul made before it.
 */
export function campaignQueue(run: RunState, env: RunEnv): CaseSpec[] {
  const plain = unwovenContext(env.content, run, run.day);
  const line = lineFor(run.seed, env.ctx, run.waiting ?? [], lineEdits(run, env.content, run.day), plain);
  const cases = [...line, ...extraSouls(run.seed, env.ctx, rankOf(run, env.content)?.souls ?? 0, line, plain)];
  const slots = [...(env.ctx.spec.queue.scripted ?? [])].sort((a, b) => a.at - b.at);
  const noon = env.ctx.noon;
  for (const slot of slots) {
    const def = env.content.scripted?.find((d) => d.id === slot.case);
    if (!def || (def.when && !evalState(def.when, run))) continue;
    // The compiler proves shipped story souls can be made, under every choice of the day's params (so under a
    // noon decree too); if one can't, the day goes on without it.
    const late = noon !== undefined && slot.at >= noon.at;
    const made = scriptedCase(def, late ? noon.ctx : env.ctx, run.seed, slot.at);
    if (made.ok) cases.splice(Math.min(slot.at, cases.length), 0, late ? { ...made.case, noon: true } : made.case);
  }
  // On some days, one of the day's own is kin to a soul sent where it didn't belong (docs/tech-spec.md §60), and on some
  // one pleads for another hall (§59), or offers rings for one (§73): each on a stream of its own, so the line is
  // otherwise the same.
  const asked = withPlea(env.content, run, env.ctx, withKin(env.content, run, env.ctx, cases));
  // Souls who waited through the night can push the day's own later: keep the decree's souls last.
  const ordered = noon ? [...asked.filter((c) => !c.noon), ...asked.filter((c) => c.noon)] : asked;
  // Last, the day's parties (docs/tech-spec.md §69), from the line as it stands. A lie about a companion never moves a
  // soul out of a hall the morning's requests ask for souls from, so they can still be done.
  const keepHalls = new Set((run.requests ?? []).map((r) => r.from));
  // And on the forger's trail (docs/tech-spec.md §71), a day with marks enough shows both the carver's habits.
  return markTrail(linkParties(ordered, env.ctx, run.seed, { keepHalls }), env.ctx);
}

/**
 * Who is at the desk now (docs/tech-spec.md §46): the day's visit whose turn it is (once its `at` souls have been
 * sent), not yet played, and whose `when` holds. Null in any other phase, and between visits. A visit is played as its
 * turn comes, so one waiting still is one whose turn came.
 */
export function deskVisit(run: RunState, content: Content): DeskVisit | null {
  const shift = run.shift;
  if (run.phase !== 'shift' || !shift || shift.phase !== 'shift') return null;
  const visits = content.days.find((d) => d.day === run.day)?.queue.visits ?? [];
  // Its turn comes once `at` souls have gone: after a party that stood over that place, whose members go together
  // (docs/tech-spec.md §69).
  const found = visits.find(
    (v) =>
      v.at <= shift.verdicts.length &&
      !run.scenes.includes(v.scene) &&
      (v.when === undefined || evalState(v.when, run)),
  );
  return found ?? null;
}

/** The story threads still in play for the journal: each text key, with `{n}` when it counts something. */
export function threadsInPlay(run: RunState, content: Content): { id: string; text: string; n?: number }[] {
  return (content.campaign?.threads ?? [])
    .filter((th) => evalState(th.when, run))
    .map((th) => ({ id: th.id, text: th.text, ...(th.count ? { n: stateValue(run, th.count) } : {}) }));
}

/**
 * What stamping a soul `stamped` does: a story soul's effects on the story, and an ordinary soul's offer taken, its
 * rings (docs/tech-spec.md §73); nothing for any other generated soul.
 */
export function stampEffects(content: Content, c: CaseSpec, stamped: Destination): Effect[] {
  const offer = ordinaryOffer(c);
  if (offer) return offer.dest === stamped ? [{ rings: offer.rings }] : [];
  if (!c.script) return [];
  const def = content.scripted?.find((d) => d.id === c.script);
  return (def?.onStamp ?? []).filter((rule) => matches(rule.stamped, stamped)).flatMap((rule) => rule.effects);
}

/**
 * The rings stamping a soul `stamped` pays at the audit: a story soul's (docs/tech-spec.md §47), or an ordinary soul's
 * offer (§73); 0 for any other.
 */
export function stampRings(content: Content, c: CaseSpec, stamped: Destination): number {
  return stampEffects(content, c, stamped).reduce((n, e) => n + ('rings' in e ? e.rings : 0), 0);
}

/**
 * A soul's offer (docs/tech-spec.md §47, §73): rings for a stamp other than where it belongs, the most it pays if it
 * names several. The desk shows it while the soul is there, and bots that take bribes take it.
 */
export function storyOffer(content: Content, c: CaseSpec): { dest: Destination; rings: number } | null {
  let best: { dest: Destination; rings: number } | null = null;
  for (const dest of DESTINATIONS) {
    if (dest === c.expect.dest) continue;
    const rings = stampRings(content, c, dest);
    if (rings > 0 && (!best || rings > best.rings)) best = { dest, rings };
  }
  return best;
}

/**
 * What looking at a story soul does to the story (docs/tech-spec.md §74): the effects of each observation looked at on
 * it; nothing for a generated soul.
 */
export function seenEffects(content: Content, c: CaseSpec, looked: readonly string[]): Effect[] {
  if (!c.script || looked.length === 0) return [];
  const def = content.scripted?.find((d) => d.id === c.script);
  return (def?.onSeen ?? []).filter((rule) => looked.includes(rule.obs)).flatMap((rule) => rule.effects);
}

/** The story consequences of how today's story souls were stamped, and of what was looked at on them. */
function storyEffects(shift: ShiftState, content: Content): Effect[] {
  const out: Effect[] = [];
  for (const v of shift.verdicts) {
    const c = shift.cases[v.index];
    if (!c) continue;
    if (v.stamped !== null) out.push(...stampEffects(content, c, v.stamped));
    out.push(...seenEffects(content, c, v.looked ?? []));
  }
  return out;
}

/**
 * The line at dusk (docs/tech-spec.md §41): the souls still waiting when the sun set. Those who can wait come
 * back first the next day, seen afresh under its rules; the living can't, and die in the night. Only when the
 * next day follows on (not across a slice's jump, nor after the last day), and never story souls, whose
 * stories go on without them.
 */
function waitingLine(
  run: RunState,
  shift: ShiftState,
  env: RunEnv,
): { waiting: DayWaiting; carried: CaseSpec[] } | null {
  const campaign = campaignOf(env.content);
  const def = campaign.waiting;
  if (!def || run.day < def.from || dayAfter(run, campaign, run.day) !== run.day + 1) return null;
  const left = shift.verdicts.flatMap((v) => {
    const c = shift.cases[v.index];
    return v.stamped === null && c && c.script === undefined ? [c] : [];
  });
  if (left.length === 0) return null;
  const tomorrow = dayContext(env.content, run, run.day + 1);
  const soul = (c: CaseSpec): LineSoul => ({ id: c.id, name: `${c.evidence.look.name} ${c.evidence.look.patronym}` });
  const carried: CaseSpec[] = [];
  const died: LineSoul[] = [];
  const gone: LineSoul[] = [];
  for (const c of left) {
    if (c.expect.dest === 'RETURN') {
      died.push(soul(c));
      continue;
    }
    const dressed = dressForDay(c, tomorrow);
    if (dressed) carried.push(dressed);
    else gone.push(soul(c));
  }
  const standing: Partial<Record<Faction, number>> = {};
  const add = (fx: Readonly<Partial<Record<Faction, number>>>) => {
    for (const [f, n] of Object.entries(fx)) standing[f as Faction] = (standing[f as Faction] ?? 0) + (n ?? 0);
  };
  if (left.length >= def.crowd) add(def.night);
  for (const _ of died) add(def.died);
  return {
    waiting: { carried: carried.map(soul), died, ...(gone.length > 0 ? { gone } : {}), standing },
    carried,
  };
}

/**
 * The next morning's requests (docs/tech-spec.md §42), from their own stream of the run's seed: on some
 * mornings from `from` on, a god asks for souls that belong to another, of a kind the next day's line holds
 * enough of; now and then a second god asks for the same souls. `waiting` are the souls who'll be in that
 * line from tonight's.
 */
function drawRequests(run: RunState, env: RunEnv, waiting: readonly CaseSpec[]): DayRequest[] {
  const campaign = campaignOf(env.content);
  const def = campaign.requests;
  const day = dayAfter(run, campaign, run.day);
  if (!def || day === null || day < def.from) return [];
  const rng = new Rng(`${run.seed}|requests|${day}`);
  if (!rng.chance(def.chance, 100)) return [];
  const ctx = dayContext(env.content, run, day);
  const line = lineFor(run.seed, ctx, waiting, lineEdits(run, env.content, day), unwovenContext(env.content, run, day));
  const held = (dest: Destination) => line.filter((c) => c.expect.dest === dest).length;
  const open = def.list.filter(
    (r) =>
      r.since <= day &&
      (r.until === undefined || day < r.until) &&
      ctx.destinations.has(r.from) &&
      ctx.destinations.has(r.to) &&
      held(r.from) >= r.n,
  );
  if (open.length === 0) return [];
  const first = open[rng.int(0, open.length - 1)];
  if (!first) return [];
  const rivals = open.filter((r) => r.god !== first.god && r.from === first.from);
  const rival = rivals.length > 0 && rng.chance(def.rivals, 100) ? rivals[rng.int(0, rivals.length - 1)] : undefined;
  return [first, ...(rival ? [rival] : [])].map(({ since: _, until: __, ...r }) => r);
}

/** How today's requests went: the souls sent as asked, and each reward for one done in full. */
function settleRequests(run: RunState, shift: ShiftState): RequestSettled[] {
  return (run.requests ?? []).map((r) => {
    const done = shift.verdicts.filter((v) => v.expected === r.from && v.stamped === r.to).length;
    const met = done >= r.n;
    return { id: r.id, god: r.god, from: r.from, to: r.to, n: r.n, done, met, standing: met ? { ...r.reward } : {} };
  });
}

/**
 * Clean days in a row (every soul judged rightly, none left at dusk) and, when there are enough of them, the next
 * rank offered the next morning (docs/tech-spec.md §44). Never in Story Mode, and never for the last day.
 */
function promote(run: RunState, env: RunEnv, clean: boolean): Pick<RunState, 'clean' | 'offer'> {
  const campaign = campaignOf(env.content);
  const def = campaign.promotion;
  if (!def || run.story) return {};
  const streak = clean ? (run.clean ?? 0) + 1 : 0;
  const next = (run.rank ?? 0) + 1;
  const day = dayAfter(run, campaign, run.day);
  const offer =
    streak >= def.cleanDays &&
    def.ranks[next - 1] !== undefined &&
    day !== null &&
    day >= def.from &&
    day < campaign.lastDay;
  return offer ? { clean: 0, offer: next } : { clean: streak };
}

/** Pay, fines, standing and einherjar for a finished shift. */
function audit(
  run: RunState,
  shift: ShiftState,
  env: RunEnv,
): { run: RunState; ledger: DayLedger; flags: Record<string, number> } {
  const campaign = campaignOf(env.content);
  // At a rank, a higher wage and fewer citations forgiven (docs/tech-spec.md §44).
  const economy = economyFor(run, env);
  let correct = 0;
  let wrong = 0;
  let unjudged = 0;
  let pay = 0;
  let bonus = 0;
  let fines = 0;
  const standing: Partial<Record<Faction, number>> = {};
  const einherjar = { ...run.einherjar };
  const sent: Partial<Record<Destination, number>> = { ...run.sent };
  let naglfar = run.naglfar ?? 0;
  const flags: Record<string, number> = { ...run.flags };
  const assists = shift.config.assists;
  // The oath (docs/tech-spec.md §49) fines from the first mistake, whatever the assists say.
  const fined = !run.story && (run.oath === true || !assists?.noFines);
  // A god's favour can lighten each fine (docs/tech-spec.md §43).
  const finePct = shift.config.mods?.finePct ?? 100;
  let eased = 0;
  // The favours the gate granted (standing hasn't moved since it opened), for the audit, the night and the records.
  const granted = favoursFor(run, env.content);
  // One can pay for each soul sent on with its nails long (docs/tech-spec.md §57); a god's favours add up.
  const nailRings = granted.reduce((n, f) => n + ('nailRings' in f.effect ? f.effect.nailRings : 0), 0);
  let nails = 0;
  const mistakes: DayMistake[] = [];
  // Who asked for another hall today, and kin who came, whatever the stamp (docs/tech-spec.md §60): the report's.
  const pleas: DayPlea[] = [];
  // Word among the dead (docs/tech-spec.md §73): how the day's asks were answered, and the false ones granted.
  const word = wordDef(env.content);
  let wordBy = 0;
  const found: FoundAsk[] = [];
  // What each verdict cost, for an appeal to give back.
  const costs = new Map<number, { fine: number; standing: Partial<Record<Faction, number>>; worthy: boolean }>();
  shift.verdicts.forEach((v: Verdict) => {
    const c = shift.cases[v.index];
    if (v.stamped === null) {
      unjudged++;
      return;
    }
    const finesBefore = fines;
    const pled = pleaGranted(env.content, shift, v);
    const plea = c ? pleaOf(env.content, c) : null;
    // Rings offered for a stamp, a story soul's (§47) or an ordinary soul's (§73), when it didn't plead.
    const offer = c && !plea ? storyOffer(env.content, c) : null;
    const ask = plea?.dest ?? offer?.dest;
    const granted = ask !== undefined && v.stamped === ask;
    // Granted, a soul that asked and lied too is found out, and runs at the last battle all the same (§73).
    const lied = word !== undefined && granted && c !== undefined && askedFalsely(c);
    // The word goes a step softer for each ask granted, and sterner for each refused: the soul sent where it belongs.
    if (ask !== undefined) wordBy += granted ? 1 : v.stamped === v.expected ? -1 : 0;
    if (c && (ask || c.kin)) {
      pleas.push({
        name: soulName(c),
        belongs: v.expected,
        ...(ask ? { to: ask } : {}),
        ...(c.kin ? { kin: c.kin.name } : {}),
        ...(c.script ? { story: true as const } : {}),
        ...(offer ? { offer: offer.rings } : {}),
        granted,
        ...(lied ? { lied: true as const } : {}),
      });
    }
    if (c && lied && word)
      found.push({ name: soulName(c), day: run.day, hall: v.stamped, on: run.day + word.found.after });
    if (v.correct) {
      correct++;
      pay += economy.wage;
      if (v.caught > 0) bonus += economy.docBonus;
    } else {
      wrong++;
      const paid = c ? stampRings(env.content, c, v.stamped) : 0;
      const skald = c ? skaldTally(c) : null;
      mistakes.push({
        rule: v.rule,
        expected: v.expected,
        stamped: v.stamped,
        ...(v.skipped && v.skipped.length > 0 ? { skipped: v.skipped } : {}),
        ...(c?.noon ? { noon: true as const } : {}),
        ...(paid > 0 ? { paid } : {}),
        ...(pled ? { pled: true as const } : {}),
        ...(skald ? { skald } : {}),
      });
      if (fined && wrong > economy.warnings) {
        const fine = economy.fines[Math.min(wrong - economy.warnings - 1, economy.fines.length - 1)] ?? 0;
        const charged = Math.floor((fine * finePct) / 100);
        fines += charged;
        eased += fine - charged;
      }
    }
    // Only mistakes move standing: a god isn't angered (or flattered) by a soul sent where it belongs.
    const rule = v.correct
      ? undefined
      : campaign.standing.find((r) => matches(r.expected, v.expected) && matches(r.stamped, v.stamped as Destination));
    for (const [f, n] of Object.entries(rule?.fx ?? {}))
      standing[f as Faction] = (standing[f as Faction] ?? 0) + (n ?? 0);
    // A soul that asked for Valhalla and was sent there stands with the worthy (docs/tech-spec.md §59), and so does a
    // hearth-man rightly sent after his jarl (§70): he stood by him to the end.
    const followed =
      v.correct && c !== undefined && typeof env.ctx.rules.find((r) => r.id === c.expect.rule)?.then === 'object';
    const worthy = c ? (pled && !lied) || followed || eval2({ ref: campaign.worthy }, c.truth, env.ctx) : false;
    if (v.stamped === 'VALHALLA' && c) {
      if (worthy) einherjar.worthy++;
      else einherjar.unworthy++;
    }
    costs.set(v.index, { fine: fines - finesBefore, standing: { ...rule?.fx }, worthy });
    sent[v.stamped] = (sent[v.stamped] ?? 0) + 1;
    // Every soul sent on with a procedure skipped (so far only nails left uncut) builds Naglfar.
    naglfar += v.skipped?.length ?? 0;
    nails += nailRings * (v.skipped?.length ?? 0);
  });
  // Loki (docs/tech-spec.md §80): held today, he wears his next guise from tomorrow, and whoever waits for tomorrow is
  // seen in it, as are the souls tomorrow's requests are drawn from.
  const loki = lokiToday(shift, env.content);
  const learned = lokiLearns(run, env.content, loki.caught);
  if (learned) flags[learned.flag] = learned.index;
  const ahead: RunState = learned ? { ...run, guises: learned.guises } : run;
  // The souls still in line at dusk: tomorrow's first, or (the living) lost in the night.
  const line = waitingLine(ahead, shift, env);
  // Today's requests settled; tomorrow's come with the morning.
  const requests = settleRequests(run, shift);
  const favours = granted.map((f) => f.id);
  const event = eventOn(run, env.content, run.day);
  // Claims pressed at the gate, and lies that gave way (docs/tech-spec.md §66), for a playtest's report.
  const pressed = shift.verdicts.reduce((n, v) => n + (v.pressed ?? 0), 0);
  const gave = shift.verdicts.reduce((n, v) => n + (v.gave ?? 0), 0);
  // Parties at the desk (docs/tech-spec.md §69), and the lies told about companions, for a playtest's report.
  const members = shift.cases.filter((c) => c.party !== undefined);
  const parties = {
    n: new Set(members.map((c) => c.party?.id)).size,
    souls: members.length,
    lies: members.reduce((n, c) => n + c.lies.filter((l) => l.about !== undefined).length, 0),
    caught: shift.verdicts.reduce((n, v) => n + (v.caughtAbout ?? 0), 0),
  };
  // Jarls' sworn men who go where their jarl goes (docs/tech-spec.md §70), and how many were sent there.
  const follow = (c: CaseSpec) => typeof env.ctx.rules.find((r) => r.id === c.expect.rule)?.then === 'object';
  const sworn = shift.verdicts.filter((v) => {
    const c = shift.cases[v.index];
    return c !== undefined && follow(c);
  });
  const retinue = { men: sworn.length, right: sworn.filter((v) => v.correct).length };
  const wordNow = word ? movedWord(word, wordOf(run), wordBy) : wordOf(run);
  // The day's grade (docs/tech-spec.md §49): Story Mode has no sun and no fines, so no grade either. The vow sworn last
  // night is settled by it (§75).
  const grade = run.story ? undefined : dayGrade(shift, env.ctx);
  const vow = settleVow(run, shift, env.content, grade);
  const ledger: DayLedger = {
    day: run.day,
    correct,
    wrong,
    unjudged,
    pay,
    bonus,
    fines,
    ...(eased > 0 ? { eased } : {}),
    ...(nails > 0 ? { nails } : {}),
    standing,
    ...(assists ? { assists } : {}),
    ...(mistakes.length > 0 ? { mistakes } : {}),
    ...(pressed > 0 ? { pressed: { n: pressed, gave } } : {}),
    ...(parties.n > 0 ? { parties: retinue.men > 0 ? { ...parties, retinue } : parties } : {}),
    // Kept, even empty, where the campaign has pleas or kin, so a day nobody asked differs from a day not counted.
    ...(campaign.pleas || campaign.kin ? { pleas } : {}),
    ...(word ? { word: { by: wordNow - wordOf(run), now: wordNow } } : {}),
    ...(run.appealHeard ? { appeal: run.appealHeard } : {}),
    ...(line ? { waiting: line.waiting } : {}),
    ...(requests.length > 0 ? { requests } : {}),
    ...(favours.length > 0 ? { favours } : {}),
    ...(run.rank ? { rank: run.rank } : {}),
    ...(run.dawnS ? { dawnS: run.dawnS } : {}),
    ...(event ? { event: event.id } : {}),
    ...(grade ? { grade } : {}),
    ...(run.answered ? { offer: run.answered } : {}),
    ...(vow ? { vow } : {}),
    ...(loki.caught + loki.missed > 0
      ? { loki: { guise: guiseOn(run, env.content, run.day) ?? '', caught: loki.caught, missed: loki.missed } }
      : {}),
  };
  const nextStanding = { ...run.standing };
  for (const [f, n] of Object.entries(standing)) nextStanding[f as Faction] += n ?? 0;
  for (const [f, n] of Object.entries(line?.waiting.standing ?? {})) nextStanding[f as Faction] += n ?? 0;
  for (const r of requests) for (const [f, n] of Object.entries(r.standing)) nextStanding[f as Faction] += n ?? 0;
  for (const [f, n] of Object.entries(vow?.standing ?? {})) nextStanding[f as Faction] += n ?? 0;
  // A soul given to a god whose request was done in full is that god's now, and doesn't appeal: righting it would
  // keep the reward without its cost. Nor does a soul sent where it asked to go (docs/tech-spec.md §59), or paid to
  // go (§73).
  const met = (v: Verdict) => requests.some((r) => r.met && v.expected === r.from && v.stamped === r.to);
  const took = (v: Verdict) => {
    const c = shift.cases[v.index];
    return c !== undefined && v.stamped !== null && ordinaryOffer(c)?.dest === v.stamped;
  };
  const given = (v: Verdict) => met(v) || pleaGranted(env.content, shift, v) || took(v);
  // A soul that asked falsely and was granted (§73) stands nowhere: it runs from the host it was sent to.
  const falsely = (v: Verdict) => {
    const c = shift.cases[v.index];
    return word !== undefined && c !== undefined && askedFalsely(c) && (pleaGranted(env.content, shift, v) || took(v));
  };
  const pledTruly = (v: Verdict) => pleaGranted(env.content, shift, v) && !falsely(v);
  // Souls sent to a hall they didn't belong in, but for those given it by a request met or a plea truly made: at
  // Ragnarök they break and run (§54).
  const misfits: Partial<Record<Destination, number>> = { ...run.misfits };
  // And the souls the battle will name: who'll run from each host, the story's own who'll stand in one, and those who
  // asked to be there.
  const named: NamedSoul[] = [...(run.named ?? [])];
  for (const v of shift.verdicts) {
    if (v.stamped === null) continue;
    const wrong = v.stamped !== v.expected && !met(v) && !pledTruly(v);
    if (wrong) misfits[v.stamped] = (misfits[v.stamped] ?? 0) + 1;
    const c = shift.cases[v.index];
    const runs = v.stamped === 'VALHALLA' ? !(costs.get(v.index)?.worthy ?? false) : wrong;
    if (c) named.push(...namedAs(campaign, c, run.day, v.stamped, runs, pledTruly(v)));
  }
  // The souls whose kin came to the desk today and were judged (docs/tech-spec.md §60): their kin won't come again.
  const kinCame = shift.verdicts.flatMap((v) => {
    const kin = shift.cases[v.index]?.kin;
    return kin && v.stamped !== null ? [kin.name] : [];
  });
  const appeal = chooseAppeal(run, shift, campaign, costs, fined, given);
  // Marks on the forger's trail seen today (docs/tech-spec.md §71), pinned to the board.
  const trail = pinMarks(run, shift, env.content);
  const asked = drawRequests(ahead, env, line?.carried ?? []);
  const promotion = promote(run, env, wrong === 0 && unjudged === 0);
  // The day's trip home is filed with the day (a night scene's is for tomorrow, and comes after this).
  const {
    appealHeard: _,
    appeal: __,
    waiting: ___,
    requests: ____,
    answered: _____,
    dawnS: ______,
    vow: _______,
    ...rest
  } = run;
  return {
    run: {
      ...rest,
      rings: run.rings + pay + bonus - fines + nails + (vow?.rings ?? 0),
      standing: nextStanding,
      einherjar,
      sent,
      naglfar,
      ...(Object.keys(misfits).length > 0 ? { misfits } : {}),
      ...(named.length > 0 ? { named } : {}),
      ...(kinCame.length > 0 ? { kin: [...(run.kin ?? []), ...kinCame] } : {}),
      ...(trail ? { trail } : {}),
      ...(run.word !== undefined || wordNow !== 0 ? { word: wordNow } : {}),
      ...(found.length > 0 ? { found: [...(run.found ?? []), ...found] } : {}),
      ledger: [...run.ledger, ledger],
      ...(appeal ? { appeal } : {}),
      ...(line && line.carried.length > 0 ? { waiting: line.carried } : {}),
      ...(asked.length > 0 ? { requests: asked } : {}),
      ...(learned ? { guises: learned.guises } : {}),
      ...promotion,
    },
    ledger,
    flags,
  };
}

/**
 * The run's forger's trail with today's marks pinned (docs/tech-spec.md §71): each habit seen on a soul, once, while
 * the trail still pins them.
 */
function pinMarks(run: RunState, shift: ShiftState, content: Content): RunTrail | undefined {
  const def = trailOf(content);
  if (!def || !pinsToday(run, def)) return run.trail;
  const marks: TrailMark[] = [...(run.trail?.marks ?? [])];
  for (const v of shift.verdicts) {
    const c = shift.cases[v.index];
    if (!c) continue;
    const name = soulName(c);
    for (const m of v.marks ?? []) {
      if (!marks.some((x) => x.name === name && x.hand === m.hand && x.via === m.via)) {
        marks.push({ day: run.day, name, hand: m.hand, via: m.via });
      }
    }
  }
  return marks.length > 0 ? { ...run.trail, marks } : run.trail;
}

function applyEffects(run: RunState, effects: readonly Effect[], events: RunEvent[], content?: Content): RunState {
  let r = run;
  for (const e of effects) {
    if ('rings' in e) r = { ...r, rings: r.rings + e.rings, storyRings: r.storyRings + e.rings };
    else if ('sun' in e) r = { ...r, dawnS: (r.dawnS ?? 0) + e.sun };
    else if ('standing' in e) {
      r = {
        ...r,
        standing: { ...r.standing, [e.standing]: r.standing[e.standing] + e.by },
        storyStanding: { ...r.storyStanding, [e.standing]: (r.storyStanding?.[e.standing] ?? 0) + e.by },
      };
    } else if ('flag' in e) {
      const now = r.flags[e.flag] ?? 0;
      r = { ...r, flags: { ...r.flags, [e.flag]: e.set ?? now + (e.inc ?? 1) } };
    } else if ('family' in e) {
      const m = r.family.find((x) => x.id === e.family);
      if (!m || m.status === 'gone' || m.status === e.becomes) continue;
      if (e.becomes === 'gone') {
        // An adult dies; a child goes to relatives (docs/build-plan.md §1). Without the content, as a preview: died.
        const def = content ? familyDefs(r, content).find((f) => f.id === e.family) : undefined;
        const gone = def && !def.adult ? 'left' : 'died';
        r = { ...r, family: r.family.map((x) => (x.id === e.family ? { ...x, status: 'gone', gone } : x)) };
        events.push({ e: 'family', id: e.family, change: gone });
        continue;
      }
      const becomes = e.becomes;
      r = {
        ...r,
        family: r.family.map((x) => (x.id === e.family ? { ...x, status: becomes, sickNights: 0 } : x)),
      };
      events.push({ e: 'family', id: e.family, change: becomes });
    }
  }
  return r;
}

/**
 * How tonight goes for one member under `bills`, leaving out only the chance of falling sick: their
 * state by morning if chance spares them, the change that is certain, and that chance in percent.
 */
export interface MemberNight {
  readonly member: FamilyMember;
  readonly change?: 'well' | 'sick' | 'died' | 'left';
  /** What makes falling sick certain: the cold, or hunger (the cold when both would). */
  readonly cause?: 'cold' | 'hungry';
  /** Percent chance of falling sick tonight (0 when it's certain, or can't happen). */
  readonly risk: number;
}

function memberNight(m: FamilyMember, bills: Bills, care: NightCare, adult: boolean, ownKeep: boolean): MemberNight {
  if (m.status === 'gone') return { member: m, risk: 0 };
  // Someone who keeps themselves (docs/tech-spec.md §72) goes without only once they're sick and the house feeds them.
  const fed = bills.food || (ownKeep && m.status === 'well');
  const cold = bills.hearth ? 0 : m.cold + 1;
  const hungry = fed ? 0 : m.hungry + 1;
  if (m.status === 'sick') {
    if (bills.medicine.includes(m.id)) {
      return { member: { ...m, status: 'well', cold, hungry, sickNights: 0 }, change: 'well', risk: 0 };
    }
    const sickNights = m.sickNights + 1;
    if (sickNights >= care.sickNights) {
      const gone = adult ? 'died' : 'left';
      return { member: { ...m, status: 'gone', gone, cold, hungry, sickNights }, change: gone, risk: 0 };
    }
    return { member: { ...m, cold, hungry, sickNights }, risk: 0 };
  }
  if (cold >= care.needNights || hungry >= care.needNights) {
    const cause = cold >= care.needNights ? 'cold' : 'hungry';
    return { member: { ...m, status: 'sick', cold, hungry, sickNights: 0 }, change: 'sick', cause, risk: 0 };
  }
  const unmet = (bills.hearth ? 0 : 1) + (fed ? 0 : 1);
  return { member: { ...m, cold, hungry }, risk: Math.min(100, unmet * care.sickChance + (care.sickAnyway ?? 0)) };
}

/** Tonight's upkeep under `bills`, all but chance: the bills, Draupnir, the purse and debt by morning, each member's night. */
function upkeep(run: RunState, env: RunEnv, bills: Bills) {
  const campaign = campaignOf(env.content);
  const cost = billTotal(run, economyOf(env), bills, env.content);
  const draupnir = campaign.draupnir.nights.includes(run.day) ? campaign.draupnir.rings : 0;
  const tithe = titheTonight(run, env.content);
  const rings = run.rings - cost.hearth - cost.food - cost.medicine - tithe + draupnir;
  const defs = new Map(familyDefs(run, env.content).map((f) => [f.id, f]));
  return {
    cost,
    draupnir,
    tithe,
    rings,
    debtNights: rings < campaign.debtFloor ? run.debtNights + 1 : 0,
    members: run.family.map((m) =>
      memberNight(
        m,
        bills,
        careFor(run, env.content),
        defs.get(m.id)?.adult === true,
        defs.get(m.id)?.ownKeep === true,
      ),
    ),
  };
}

/** What sleeping now would bring, all but chance, for the night screen to plan with (docs/tech-spec.md §23). */
export interface NightOutlook {
  readonly cost: { readonly hearth: number; readonly food: number; readonly medicine: number };
  /** Draupnir's rings tonight (0 on other nights). */
  readonly draupnir: number;
  /** Odin's tithe tonight, for a rank held (docs/tech-spec.md §44; 0 without one). */
  readonly tithe: number;
  /** The purse by morning. */
  readonly rings: number;
  /** Nights in a row below the debt floor by morning (0 when tonight ends above it). */
  readonly debtNights: number;
  readonly members: readonly MemberNight[];
  /** The ending tonight's upkeep would bring about (the debt, or no one left at home), if it would. */
  readonly ends: { readonly ending: string; readonly why: 'debt' | 'home' } | null;
  /** Tonight's debt would end the run, but the reprieve will pay it (docs/tech-spec.md §56); `rings` is then its purse. */
  readonly reprieve?: boolean;
}

/**
 * Tonight under `bills` (as set, by default): the same reckoning as the night itself, which
 * leaves only who falls sick by chance unknown. No ending the upkeep brings about depends on that.
 */
export function nightOutlook(run: RunState, env: RunEnv, bills: Bills = run.bills ?? defaultBills(run)): NightOutlook {
  const u = upkeep(run, env, bills);
  const projected: RunState = {
    ...run,
    family: u.members.map((n) => n.member),
    rings: u.rings,
    debtNights: u.debtNights,
  };
  const debt = new Set(
    stateMarks(env.content, 'debtNights').flatMap((m) => (m.atLeast !== undefined ? [m.ending] : [])),
  );
  const home = new Set(
    stateMarks(env.content, 'family.home').flatMap((m) => (m.atMost !== undefined ? [m.ending] : [])),
  );
  const ends = (ending: string | null): NightOutlook['ends'] => {
    const why = ending && debt.has(ending) ? 'debt' : ending && home.has(ending) ? 'home' : null;
    return ending && why ? { ending, why } : null;
  };
  const ending = endingFor(projected, env.content);
  // A reprieve pays the debt that would end the run tonight, once (docs/tech-spec.md §56): the morning's purse is its,
  // and only another ending (no one left at home) can end the run now.
  const r = campaignOf(env.content).reprieve;
  if (r && reprieveFor(run, env.content, ending)) {
    const paid: RunState = { ...projected, rings: r.rings, debtNights: 0, flags: { ...run.flags, [r.flag]: 1 } };
    return { ...u, rings: r.rings, debtNights: 0, ends: ends(endingFor(paid, env.content)), reprieve: true };
  }
  return { ...u, ends: ends(ending) };
}

/** The run as `effects` would leave it (a scene's option, say), for previews: rings, standing, flags and family. */
export function withEffects(run: RunState, effects: readonly Effect[], content?: Content): RunState {
  return applyEffects(run, effects, [], content);
}

/** Whether a reprieve (docs/tech-spec.md §56) would keep `ending` from ending the run tonight. */
function reprieveFor(run: RunState, content: Content, ending: string | null): boolean {
  const r = campaignOf(content).reprieve;
  return !!r && ending === r.ending && !run.oath && (run.flags[r.flag] ?? 0) <= 0;
}

/**
 * The night's reprieve (docs/tech-spec.md §56): the first night a debt would end the run, it's paid instead. The purse
 * is set to the reprieve's, the nights in debt start again, its flag is set, and the night's accounts say so.
 */
function reprieved(after: RunState, run: RunState, env: RunEnv, events: RunEvent[]): RunState {
  const r = campaignOf(env.content).reprieve;
  if (!r || !reprieveFor(run, env.content, endingFor(after, env.content))) return after;
  const paid = r.rings - after.rings;
  events.push({ e: 'reprieve', rings: paid });
  const last = after.ledger[after.ledger.length - 1];
  const ledger =
    last?.night && last.day === after.day
      ? [...after.ledger.slice(0, -1), { ...last, night: { ...last.night, reprieve: paid, rings: r.rings } }]
      : after.ledger;
  return { ...after, rings: r.rings, debtNights: 0, flags: { ...after.flags, [r.flag]: 1 }, ledger };
}

/** Tonight's upkeep: bills paid or skipped, and what that does to the family. */
function night(run: RunState, env: RunEnv, events: RunEvent[]): RunState {
  const u = upkeep(run, env, run.bills ?? defaultBills(run));
  const family: FamilyMember[] = u.members.map((n) => {
    const m = n.member;
    if (n.change) {
      events.push({ e: 'family', id: m.id, change: n.change });
      return m;
    }
    // Seeded per run, night and person, so replays fall sick the same way.
    if (n.risk > 0 && new Rng(`${run.seed}|night|${run.day}|${m.id}`).chance(n.risk, 100)) {
      events.push({ e: 'family', id: m.id, change: 'sick' });
      return { ...m, status: 'sick', sickNights: 0 };
    }
    return m;
  });
  if (u.draupnir > 0) events.push({ e: 'draupnir', rings: u.draupnir });
  const last = run.ledger[run.ledger.length - 1];
  const ledger =
    last?.day === run.day
      ? [
          ...run.ledger.slice(0, -1),
          {
            ...last,
            night: {
              ...u.cost,
              upgrades: run.spent,
              draupnir: u.draupnir,
              story: run.storyRings,
              ...(u.tithe > 0 ? { tithe: u.tithe } : {}),
              ...(run.trade?.arms ? { arms: run.trade.arms } : {}),
              ...(run.trade?.sold ? { sold: run.trade.sold } : {}),
              rings: u.rings,
            },
          },
        ]
      : run.ledger;
  // Tonight's dealings are filed in its accounts (docs/tech-spec.md §56), and done with.
  const { trade: _, ...rest } = run;
  return { ...rest, family, rings: u.rings, debtNights: u.debtNights, ledger };
}

/** One coming night's bills, all paid, for the family at home now. */
export interface NightBills {
  readonly day: number;
  readonly hearth: number;
  /** Food for everyone at home now whom the purse feeds (docs/tech-spec.md §72). */
  readonly food: number;
  /** Medicine for each person sick that night. */
  readonly medicine: number;
  readonly draupnir: number;
  /** Odin's tithe, at the rank held now (docs/tech-spec.md §44). */
  readonly tithe: number;
}

/** The bills of the run's next few nights after tonight (none after its last day), so the night screen can plan. */
export function billForecast(run: RunState, content: Content, nights = 3): NightBills[] {
  const campaign = campaignOf(content);
  const home = fedAtHome(run, content).length;
  const tithe = rankOf(run, content)?.tithe ?? 0;
  const out: NightBills[] = [];
  for (let d = dayAfter(run, campaign, run.day); d !== null && out.length < nights; d = dayAfter(run, campaign, d)) {
    const costs = content.days.find((x) => x.day === d)?.economy?.costs;
    if (!costs) break;
    const draupnir = campaign.draupnir.nights.includes(d) ? campaign.draupnir.rings : 0;
    out.push({ day: d, hearth: costs.hearth, food: costs.food * home, medicine: costs.medicine, draupnir, tithe });
  }
  return out;
}

/** The fewest nights in a row below the debt floor that end a run (null if none do in this build). */
export function debtLimit(content: Content): number | null {
  const n = stateMarks(content, 'debtNights').flatMap((m) => (m.atLeast !== undefined ? [m.atLeast] : []));
  return n.length > 0 ? Math.min(...n) : null;
}

/** The endings a run of this build can come to, in the order they're checked (the gallery's list). */
export function reachableEndings(content: Content): readonly EndingDef[] {
  const campaign = campaignOf(content);
  return [...campaign.endings]
    .filter((e) => e.when !== undefined || e.id === campaign.finale)
    .sort((a, b) => a.order - b.order);
}

/** What an ending asks of one of the run's numbers, read from its condition: at least or at most so much. */
export interface StateMark {
  readonly ending: string;
  readonly atLeast?: number;
  readonly atMost?: number;
}

/**
 * The marks the reachable endings set on one number (`ragnarok`, `debtNights` …), in their order.
 * Only conditions every part of which must hold count (`all`), not alternatives (`any`) or negations.
 */
export function stateMarks(content: Content, path: string): StateMark[] {
  const marks: StateMark[] = [];
  const walk = (p: StatePred, ending: string): void => {
    if ('all' in p) for (const q of p.all) walk(q, ending);
    else if ('state' in p && p.state === path) {
      marks.push({
        ending,
        ...(p.gte !== undefined ? { atLeast: p.gte } : {}),
        ...(p.lte !== undefined ? { atMost: p.lte } : {}),
      });
    }
  };
  for (const e of reachableEndings(content)) if (e.when) walk(e.when, e.id);
  return marks;
}

/** The marks the reachable endings set on the host at Ragnarök (none in builds that don't count it). */
export function hostMarks(content: Content): StateMark[] {
  return stateMarks(content, 'ragnarok');
}

/** What an ending asks of the last battle (docs/tech-spec.md §54): so many fronts held, at least or at most, and which. */
export interface BattleMark {
  readonly ending: string;
  readonly atLeast?: number;
  readonly atMost?: number;
  /** Fronts it needs held. */
  readonly held: readonly string[];
}

/**
 * What the reachable endings ask of the last battle, in their order: none in builds without one. Only conditions every
 * part of which must hold count (`all`), as with `stateMarks`.
 */
export function battleMarks(content: Content): BattleMark[] {
  const marks: BattleMark[] = [];
  for (const e of reachableEndings(content)) {
    if (!e.when || !readsBattle(e.when)) continue;
    let atLeast: number | undefined;
    let atMost: number | undefined;
    const held: string[] = [];
    const walk = (p: StatePred): void => {
      if ('all' in p) for (const q of p.all) walk(q);
      else if ('state' in p && p.state === 'fronts') {
        atLeast = p.gte ?? atLeast;
        atMost = p.lte ?? atMost;
      } else if ('state' in p && p.state.startsWith('front.') && (p.gte ?? 0) >= 1) held.push(p.state);
    };
    walk(e.when);
    marks.push({
      ending: e.id,
      ...(atLeast !== undefined ? { atLeast } : {}),
      ...(atMost !== undefined ? { atMost } : {}),
      held,
    });
  }
  return marks;
}

/**
 * The first ending whose condition holds, or the finale after the last playable day. Before the last battle is fought
 * (docs/tech-spec.md §54), only the endings checked before any that reads it can hold, and there's no finale yet:
 * the battle comes first.
 */
export function endingFor(run: RunState, content: Content): string | null {
  const campaign = campaignOf(content);
  const sorted = [...campaign.endings].sort((a, b) => a.order - b.order);
  if (battleDue(run, content)) {
    const first = sorted.findIndex((e) => e.when !== undefined && readsBattle(e.when));
    const before = first < 0 ? sorted : sorted.slice(0, first);
    return before.find((e) => e.when !== undefined && evalState(e.when, run))?.id ?? null;
  }
  const hit = sorted.find((e) => e.when !== undefined && evalState(e.when, run));
  if (hit) return hit.id;
  if (run.slice && campaign.slice) return run.day >= campaign.slice.day ? campaign.slice.finale : null;
  return run.day >= campaign.lastDay ? campaign.finale : null;
}

const reject = (run: RunState, reason: string) => ({ state: run, events: [{ e: 'rejected', reason }] as RunEvent[] });

export function stepRun(run: RunState, action: RunAction, env: RunEnv): { state: RunState; events: RunEvent[] } {
  if (run.phase === 'ending') return reject(run, 'the run is over');

  if (action.t === 'scene') {
    if (run.scenes.includes(action.id)) return { state: run, events: [] };
    const events: RunEvent[] = [{ e: 'scene', id: action.id, effects: action.effects }];
    // A scene at the desk (docs/tech-spec.md §46): its effects wait for the audit, so standing (and with it the
    // day's favours) doesn't move during the shift.
    if (run.phase === 'shift') {
      const pending = [...(run.pending ?? []), ...action.effects];
      return { state: { ...run, scenes: [...run.scenes, action.id], pending }, events };
    }
    const r = applyEffects({ ...run, scenes: [...run.scenes, action.id] }, action.effects, events, env.content);
    return { state: r, events };
  }

  if (action.t === 'promotion') {
    if (run.phase !== 'morning' || !run.offer) return reject(run, 'no promotion offered');
    const { offer, ...rest } = run;
    const answered = { rank: offer, taken: action.accept };
    return {
      state: { ...rest, ...(action.accept ? { rank: offer } : {}), answered },
      events: [{ e: 'promotion', ...answered }],
    };
  }

  if (action.t === 'stepDown') {
    if (run.phase !== 'night' || !run.rank) return reject(run, 'there is no rank to step down');
    const { rank, ...rest } = run;
    const today = run.ledger[run.ledger.length - 1];
    const ledger = today?.day === run.day ? [...run.ledger.slice(0, -1), { ...today, steppedDown: rank }] : run.ledger;
    return {
      state: { ...rest, ...(rank > 1 ? { rank: rank - 1 } : {}), clean: 0, ledger },
      events: [{ e: 'steppedDown', rank }],
    };
  }

  if (action.t === 'marshal') {
    const def = campaignOf(env.content).ragnarok;
    if (run.phase !== 'ragnarok' || !def) return reject(run, 'there is no battle to fight');
    if (action.ride !== undefined && (!def.ride || !def.fronts.some((f) => f.id === action.ride)))
      return reject(run, 'no such front to ride to');
    const battle = fight(run, def, action.order, action.ride);
    const fought: RunState = { ...run, battle };
    const ending = endingFor(fought, env.content) ?? campaignOf(env.content).finale;
    return {
      state: { ...fought, phase: 'ending', ending },
      events: [
        { e: 'fought', battle },
        { e: 'ended', ending },
      ],
    };
  }

  if (action.t === 'accuse') {
    // The forger's trail (docs/tech-spec.md §71): the carver named, once, and what naming the right man (or another)
    // does, at once, as a night scene's choices do.
    const def = trailOf(env.content);
    if (!def || !canAccuse(run, env.content)) return reject(run, 'no carver can be named tonight');
    const suspect = def.suspects.find((s) => s.id === action.suspect);
    if (!suspect) return reject(run, 'no such carver');
    const right = suspect.id === culpritOf(def, run.seed).id;
    const events: RunEvent[] = [{ e: 'accused', suspect: suspect.id, right }];
    const named: RunState = {
      ...run,
      trail: { marks: run.trail?.marks ?? [], accused: { suspect: suspect.id, day: run.day, right } },
    };
    return { state: applyEffects(named, right ? def.right : def.wrong, events, env.content), events };
  }

  if (action.t === 'vow') {
    if (run.phase !== 'night') return reject(run, 'vows are sworn at night');
    if (action.id === null) {
      const { vow: _, ...rest } = run;
      return { state: rest, events: [{ e: 'sworn', vow: null }] };
    }
    if (!vowOffer(run, env.content).some((v) => v.id === action.id)) return reject(run, 'no such vow tonight');
    return { state: { ...run, vow: action.id }, events: [{ e: 'sworn', vow: action.id }] };
  }

  if (action.t === 'seal') {
    // Tomorrow's decree (docs/tech-spec.md §79): the pick is the run's at once, so the save holds it; it's sealed, and
    // does what sealing it does, only as the night ends.
    if (run.phase !== 'night') return reject(run, 'decrees are sealed at night');
    if (action.draft === null) {
      if (run.seal === undefined) return { state: run, events: [] };
      const { seal: _, ...rest } = run;
      return { state: rest, events: [] };
    }
    if (!draftsTonight(run, env.content).some((d) => d.def.id === action.draft)) {
      return reject(run, 'no such draft tonight');
    }
    return { state: { ...run, seal: action.draft }, events: [] };
  }

  if (action.t === 'appeal') {
    if (run.phase !== 'morning' || !run.appeal) return reject(run, 'no appeal to hear');
    const heard = hearAppeal(run, run.appeal, action.stamped, campaignOf(env.content));
    return { state: heard, events: heard.appealHeard ? [{ e: 'appealed', heard: heard.appealHeard }] : [] };
  }

  switch (action.t) {
    case 'beginShift': {
      if (run.phase !== 'morning') return reject(run, 'the shift starts in the morning');
      // An appeal not heard by the time the gate opens lapses: the verdict stands. So does an offer, declined.
      const heard = run.appeal ? hearAppeal(run, run.appeal, null, campaignOf(env.content)) : run;
      const { offer, ...unoffered } = heard;
      const today: RunState = offer ? { ...unoffered, answered: { rank: offer, taken: false } } : heard;
      const config = {
        mode: 'campaign' as const,
        seed: today.seed,
        day: today.day,
        ...(today.story ? { untimed: true } : {}),
        ...(today.oath ? { oath: true as const } : {}),
        mods: shiftMods(today, env.content),
      };
      const { state } = startShift(env.content, config, env.queue ?? campaignQueue(today, env), env.ctx);
      const begun = stepShift(
        state,
        { t: 'begin', at: action.at, ...(action.assists ? { assists: action.assists } : {}) },
        env.ctx,
      );
      // The souls who waited through the night are in today's line now.
      const { waiting: _, ...opened } = today;
      return {
        state: { ...opened, phase: 'shift', shift: begun.state },
        events: begun.events.map((event) => ({ e: 'shift', event })),
      };
    }
    case 'shift': {
      if (run.phase !== 'shift' || !run.shift) return reject(run, 'no shift in progress');
      const r = stepShift(run.shift, action.action, env.ctx);
      const events: RunEvent[] = r.events.map((event) => ({ e: 'shift', event }));
      // An action that changes nothing (most ticks) leaves the run as it was, so callers can skip saving it.
      if (r.state === run.shift) return { state: run, events };
      if (r.state.phase !== 'done') return { state: { ...run, shift: r.state }, events };
      const a = audit({ ...run, shift: r.state }, r.state, env);
      const news: RunEvent[] = [];
      // The story souls' stamps, and the scenes played at the desk (docs/tech-spec.md §46).
      const { pending = [], ...audited } = { ...a.run, flags: a.flags, phase: 'audit' as const };
      const withStory = applyEffects(audited, [...storyEffects(r.state, env.content), ...pending], news, env.content);
      // The audit files the story's standing since the last audit beside today's mistakes, so they add up.
      const ledger: DayLedger = { ...a.ledger, story: withStory.storyStanding ?? {} };
      events.push({ e: 'audited', ledger }, ...news);
      return {
        state: { ...withStory, storyStanding: {}, ledger: [...withStory.ledger.slice(0, -1), ledger] },
        events,
      };
    }
    case 'endAudit': {
      if (run.phase !== 'audit') return reject(run, 'nothing to audit');
      return { state: { ...run, phase: 'night', bills: defaultBills(run), spent: 0 }, events: [] };
    }
    case 'bills': {
      if (run.phase !== 'night') return reject(run, 'bills are paid at night');
      const home = new Set(run.family.filter((m) => m.status === 'sick').map((m) => m.id));
      const medicine = action.bills.medicine.filter((id) => home.has(id));
      return { state: { ...run, bills: { ...action.bills, medicine } }, events: [] };
    }
    case 'buy': {
      if (run.phase !== 'night') return reject(run, 'the shop opens at night');
      const item = shopFor(run, env.content).find((u) => u.id === action.item);
      if (!item) return reject(run, 'not for sale');
      if (run.rings < item.price) return reject(run, 'not enough rings');
      return {
        state: {
          ...run,
          rings: run.rings - item.price,
          spent: run.spent + item.price,
          upgrades: [...run.upgrades, item.id],
        },
        events: [{ e: 'bought', item: item.id }],
      };
    }
    case 'sell': {
      if (run.phase !== 'night') return reject(run, 'the shop opens at night');
      const rings = sellPrice(run, env.content, action.item);
      if (rings === null) return reject(run, 'not yours to sell');
      const trade = run.trade ?? { arms: 0, sold: 0 };
      return {
        state: {
          ...run,
          rings: run.rings + rings,
          upgrades: run.upgrades.filter((id) => id !== action.item),
          trade: { ...trade, sold: trade.sold + rings },
        },
        events: [{ e: 'sold', item: action.item, rings }],
      };
    }
    case 'arm': {
      if (run.phase !== 'night') return reject(run, 'arms are sold at night');
      const lot = armsTonight(run, env.content);
      if (!lot) return reject(run, 'no arms for sale');
      if (lot.bought) return reject(run, 'one lot a night');
      if (!campaignOf(env.content).arms?.fronts.some((f) => f.front === action.front))
        return reject(run, 'no such front');
      if (run.rings < lot.price) return reject(run, 'not enough rings');
      const trade = run.trade ?? { arms: 0, sold: 0 };
      return {
        state: {
          ...run,
          rings: run.rings - lot.price,
          armed: { ...run.armed, [action.front]: (run.armed?.[action.front] ?? 0) + lot.strength },
          armsBought: (run.armsBought ?? 0) + 1,
          armedOn: run.day,
          trade: { ...trade, arms: trade.arms + lot.price },
        },
        events: [{ e: 'armed', front: action.front, strength: lot.strength, price: lot.price }],
      };
    }
    case 'endNight': {
      if (run.phase !== 'night') return reject(run, 'the night has not come');
      const events: RunEvent[] = [];
      const after = sealTonight(reprieved(night(run, env, events), run, env, events), env, events);
      const ending = endingFor(after, env.content);
      if (ending) {
        events.push({ e: 'ended', ending });
        return { state: { ...after, phase: 'ending', ending, shift: null, bills: null }, events };
      }
      // The last night is over and no ending came first: the horn, and the hosts wait for their fronts (§54).
      if (battleDue(after, env.content)) {
        events.push({ e: 'horn' });
        return { state: { ...after, phase: 'ragnarok', shift: null, bills: null }, events };
      }
      const morning = nextMorning(after, campaignOf(env.content));
      events.push({ e: 'dayBegins', day: morning.day });
      // The false asks due by this morning are found out, and the word goes softer for each (docs/tech-spec.md §73).
      const { run: next, told } = foundOut(morning, env.content, after.day);
      for (const f of told) events.push({ e: 'found', name: f.name, day: f.day, hall: f.hall });
      return {
        state: {
          ...next,
          phase: 'morning',
          shift: null,
          scenes: [],
          storyRings: 0,
          bills: null,
          spent: 0,
        },
        events,
      };
    }
  }
  return reject(run, 'unknown action');
}
