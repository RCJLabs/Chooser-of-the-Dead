import {
  type AchievementDef,
  type AchievementMoment,
  type Assists,
  armsTonight,
  billForecast,
  billTotal,
  type CaseSpec,
  type Content,
  campaignOf,
  canAccuse,
  companionShows,
  createDayContext,
  type DayCtx,
  type DayLedger,
  type Destination,
  defaultBills,
  deskVisit,
  type Effect,
  earnedAt,
  economyOf,
  epilogueFor,
  FACTIONS,
  type Faction,
  fight,
  heldFronts,
  memberField,
  newRun,
  partyAt,
  pleaOf,
  Rng,
  type RunAction,
  type RunSave,
  type RunState,
  ragnarokStrength,
  recordAction,
  runContext,
  type ShiftAction,
  type ShiftState,
  sellPrice,
  shiftFacts,
  shopFor,
  solve,
  soulCtx,
  stampsFor,
  startSave,
  stepRun,
  storyOffer,
  suspectsLeft,
  trailOf,
} from '@cots/engine';
import { type ScenePath, sceneEnv, scenePaths } from '@cots/story';

/*
 * Campaign economy simulation (docs/tech-spec.md §9): bots with a given
 * accuracy and night strategy play whole runs. It answers "can a competent
 * player afford their family and a few upgrades; how fast does a careless one
 * sink?" before real players do. Given the compiled scenes, bots also play the
 * story with a policy, so every ending can be shown reachable.
 */

export interface Judging {
  readonly name: string;
  /** Chance each soul is stamped right. */
  readonly accuracy: number;
  /** Chance a liar's lie is caught (for the bonus) when judged right. */
  readonly catches: number;
}

/** `neglect` pays no bills at all: the family sickens and leaves, and the rings pile up. */
export type NightStrategy = 'payAll' | 'frugal' | 'upgradesFirst' | 'neglect';

export const JUDGING: readonly Judging[] = [
  { name: 'expert', accuracy: 0.97, catches: 0.8 },
  { name: 'competent', accuracy: 0.85, catches: 0.5 },
  { name: 'novice', accuracy: 0.65, catches: 0.2 },
  { name: 'careless', accuracy: 0.4, catches: 0 },
];

/** Compiled Ink scenes by id, as a build ships them. */
export type SceneTable = Readonly<Record<string, object>>;

/**
 * What a bot wants from the story. It weighs every path through a scene by the
 * effects the path has, never by its words, so rewriting the text keeps the
 * bots working as long as the effects stay.
 */
export interface StoryPolicy {
  readonly name: string;
  /** Worth of each unit a flag moves (clearing a flag that was set counts against). */
  readonly flags?: Readonly<Record<string, number>>;
  /** Worth of each point of a god's standing. */
  readonly standing?: Readonly<Partial<Record<Faction, number>>>;
  /** Flag worths that replace the others from a given day on. */
  readonly later?: { readonly day: number; readonly flags: Readonly<Record<string, number>> };
  /** Long nails to leave uncut each day, on purpose (from the day Loki has the names, if `deal`). */
  readonly longNails?: { readonly perDay: number; readonly deal?: true };
  /** The front it wants held above the others at Ragnarök (docs/tech-spec.md §54), among as many as can be. */
  readonly front?: string;
}

/**
 * Every policy counts a ring spent in a scene as 1, making a sick child well as 20, and losing someone at home as
 * -200. Sun given to home at dawn counts nothing: bots have sun to spare (docs/tech-spec.md §50).
 */
const RING = 1;
const HEALED = 20;
const LOST = -200;

function devotedTo(god: Faction): Record<Faction, number> {
  return Object.fromEntries(FACTIONS.map((f) => [f, f === god ? 10 : -3])) as Record<Faction, number>;
}

/** Stays out of deals, keeps the family home, and otherwise takes whatever costs least. */
const NO_DEALS = { loki_deal: -100, ferryman: -100 };
export const PLAIN: StoryPolicy = { name: 'plain', flags: { ...NO_DEALS, stay_home: 1 } };

export const STORY_POLICIES: readonly StoryPolicy[] = [
  PLAIN,
  // Gives Loki the names and leaves a nail long each day, "now and then", as he asks.
  {
    name: 'naglfar',
    flags: { loki_deal: 100, wood: -100, ferryman: -100 },
    standing: { loki: 1 },
    longNails: { perDay: 1, deal: true },
  },
  { name: 'rebirth', flags: { truth: 50, wood_known: 50, wood: 100, ...NO_DEALS }, front: 'front.fire' },
  { name: 'ferry', flags: { ferryman: 100, loki_deal: -100, wood: -100 } },
  { name: 'transfer', flags: { clerk_contract: 100, ...NO_DEALS, stay_home: 1 }, standing: { clerk: 10 } },
  // A god's own: everyone else's favour counts against, since the ending needs that god to lead.
  { name: 'hel', flags: { ...NO_DEALS, stay_home: 1 }, standing: devotedTo('hel'), front: 'front.gate' },
  { name: 'freyja', flags: { ...NO_DEALS, stay_home: 1 }, standing: devotedTo('freyja'), front: 'front.fire' },
  { name: 'odin', flags: { ...NO_DEALS, stay_home: 1 }, standing: devotedTo('odin'), front: 'front.wolf' },
  // Leaves nails long every day and gives Loki the names, then takes them back before the ship can
  // sail early: Naglfar's crew is too many for the drowned, and the shore falls at Ragnarök (docs/tech-spec.md §54).
  {
    name: 'wolf',
    flags: { loki_deal: 100 },
    later: { day: 18, flags: { loki_deal: -100 } },
    longNails: { perDay: 2 },
  },
];

/**
 * The order a bot holds the fronts in at Ragnarök (docs/tech-spec.md §54): of every order, one that holds the most
 * fronts, and among those one that holds `prefer`; the first such in the content's order.
 */
export function botOrder(run: RunState, content: Content, prefer?: string, ride?: string): string[] {
  const def = campaignOf(content).ragnarok;
  if (!def) return [];
  const orders = (ids: readonly string[]): string[][] =>
    ids.length <= 1 ? [ids.slice()] : ids.flatMap((id) => orders(ids.filter((x) => x !== id)).map((o) => [id, ...o]));
  let best: { order: string[]; score: number } | undefined;
  for (const order of orders(def.fronts.map((f) => f.id))) {
    const held = heldFronts(fight(run, def, order, ride));
    const score = held.length * 2 + (prefer !== undefined && held.includes(prefer) ? 1 : 0);
    if (!best || score > best.score) best = { order, score };
  }
  return best?.order ?? [];
}

/**
 * The bot at the horn (docs/tech-spec.md §58): of every front to ride to, the one whose best order holds the most
 * fronts, and among those one that holds `prefer`; the first such in the content's order.
 */
export function botBattle(run: RunState, content: Content, prefer?: string): { order: string[]; ride?: string } {
  const def = campaignOf(content).ragnarok;
  if (!def) return { order: [] };
  const rides: (string | undefined)[] = def.ride ? def.fronts.map((f) => f.id) : [undefined];
  let best: { order: string[]; ride?: string; score: number } | undefined;
  for (const ride of rides) {
    const order = botOrder(run, content, prefer, ride);
    const held = heldFronts(fight(run, def, order, ride));
    const score = held.length * 2 + (prefer !== undefined && held.includes(prefer) ? 1 : 0);
    if (!best || score > best.score) best = { order, ...(ride ? { ride } : {}), score };
  }
  return best ? { order: best.order, ...(best.ride ? { ride: best.ride } : {}) } : { order: [] };
}

export function storyPolicy(name: string): StoryPolicy {
  const p = STORY_POLICIES.find((s) => s.name === name);
  if (!p) throw new Error(`no story policy "${name}"`);
  return p;
}

/** What a path through a scene is worth to a policy, from where the run stands. */
export function scorePath(path: ScenePath, run: RunState, policy: StoryPolicy): number {
  const flags: Record<string, number> = { ...run.flags };
  let score = 0;
  for (const e of path.effects) {
    if ('rings' in e) score += RING * e.rings;
    else if ('standing' in e) score += (policy.standing?.[e.standing] ?? 0) * e.by;
    else if ('flag' in e) flags[e.flag] = e.set ?? (flags[e.flag] ?? 0) + (e.inc ?? 0);
    else if ('becomes' in e) score += e.becomes === 'well' ? HEALED : e.becomes === 'gone' ? LOST : 0;
  }
  const worths = policy.later && run.day >= policy.later.day ? policy.later.flags : (policy.flags ?? {});
  for (const [f, w] of Object.entries(worths)) score += w * ((flags[f] ?? 0) - (run.flags[f] ?? 0));
  return score;
}

/** Plays today's morning or night scene the way the policy wants (the first best path on a tie). */
function playStory(
  run: RunState,
  content: Content,
  ctx: DayCtx,
  scenes: SceneTable,
  which: 'morning' | 'night',
  policy: StoryPolicy,
): RunState {
  return playScene(run, content, ctx, scenes, content.days.find((d) => d.day === run.day)?.scenes?.[which], policy);
}

/** Plays a scene the way the policy wants (the first best path on a tie), unless it's been played. */
function playScene(
  run: RunState,
  content: Content,
  ctx: DayCtx,
  scenes: SceneTable,
  id: string | undefined,
  policy: StoryPolicy,
): RunState {
  const json = id ? scenes[id] : undefined;
  if (!id || !json || run.scenes.includes(id)) return run;
  let best: ScenePath | undefined;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const path of scenePaths(json, sceneEnv(run, id))) {
    const score = scorePath(path, run, policy);
    if (score > bestScore) {
      best = path;
      bestScore = score;
    }
  }
  if (!best) return run;
  const action: RunAction = { t: 'scene', id, choices: best.choices, effects: best.effects };
  return stepRun(run, action, { content, ctx }).state;
}

/**
 * What a careful player does to catch a soul in a lie: find a contradiction the evidence exposes, turn the body
 * over and use the tools its fields need, look at them, and call it out. Nothing when no lie of the soul's can be
 * caught that way. (Bots before this looked at everything without turning the body over or using a tool, so
 * any contradiction on the back or in a tool's reading was missed; docs/tech-spec.md §49.)
 */
export function catchLie(c: CaseSpec, ctx: DayCtx, at: number): ShiftAction[] {
  for (const x of solve(c.evidence.fields, soulCtx(ctx, c)).contradictions) {
    // The shift finds a contradiction among the fields seen, so every field it rests on must be looked at.
    if (!c.lies.some((l) => l.field === x.lie) || x.against.some((id) => id.startsWith('q:'))) continue;
    const ids = [x.lie, ...x.against.filter((id) => id !== 'world')];
    const other = ids[1];
    if (!other) continue;
    const fields = c.evidence.fields.filter((f) => ids.includes(f.id));
    const tools = [...new Set(fields.flatMap((f) => (f.tool && f.tool !== 'flip' ? [f.tool] : [])))];
    return [
      ...(fields.some((f) => f.view === 'back') ? [{ t: 'flip' as const, at }] : []),
      ...tools.map((tool) => ({ t: 'tool' as const, tool, at })),
      { t: 'inspect', fields: ids, at },
      { t: 'compare', a: x.lie, b: other, at },
    ];
  }
  return [];
}

/**
 * What a careful player does to catch a soul in a lie about a companion (docs/tech-spec.md §69): turn to the
 * companion, look at what shows the claim false (turning the body over, using a tool, if that's where it is), turn
 * back, hear the claim and compare the two. `members`: the party, `k` the soul's place in it. Nothing when it tells no
 * such lie.
 */
export function catchCrossLie(members: readonly CaseSpec[], k: number, ctx: DayCtx, at: number): ShiftAction[] {
  const c = members[k] as CaseSpec;
  for (const lie of c.lies) {
    const claim = c.evidence.fields.find((f) => f.id === lie.field)?.about;
    const mate = claim ? members[claim.soul] : undefined;
    if (!claim || !mate) continue;
    const cx = soulCtx(ctx, mate);
    const shows = companionShows(mate.evidence.fields, claim.fact, claim.value, cx);
    const field = mate.evidence.fields.find((f) => f.id === shows?.[0]);
    if (!field) continue;
    return [
      { t: 'turn', to: claim.soul, at },
      ...(field.view === 'back' ? [{ t: 'flip' as const, at }] : []),
      ...(field.tool && field.tool !== 'flip' ? [{ t: 'tool' as const, tool: field.tool, at }] : []),
      { t: 'inspect', fields: [field.id], at },
      { t: 'turn', to: k, at },
      { t: 'inspect', fields: [lie.field], at },
      { t: 'compare', a: lie.field, b: memberField(claim.soul, field.id), at },
    ];
  }
  return [];
}

/**
 * What a careful player does on the forger's trail (docs/tech-spec.md §71) with a soul it has caught out: turn a tally
 * that looks off under the lens (unless catching the lie already did), and read what Muninn remembers of its knife.
 * Nothing off the trail, or for a soul with neither.
 */
export function lookForMarks(c: CaseSpec, ctx: DayCtx, at: number, done: readonly ShiftAction[] = []): ShiftAction[] {
  if (!soulCtx(ctx, c).trail) return [];
  const lens = c.evidence.fields.find((f) => f.tell)?.tool;
  const used = done.some((a) => a.t === 'tool' && a.tool === lens);
  const muninn = c.evidence.fields.filter((f) => f.hand).map((f) => f.id);
  return [
    ...(lens && !used ? [{ t: 'tool' as const, tool: lens, at }] : []),
    ...(muninn.length > 0 ? [{ t: 'inspect' as const, fields: muninn, at }] : []),
  ];
}

/** The sun a bot spends on each soul unless told otherwise: under every day's sun per soul, so none is left. */
export const BOT_PACE_S = 25;

function shiftActions(
  run: RunState,
  content: Content,
  ctx: DayCtx,
  judging: Judging,
  rng: Rng,
  longNails: number,
  assists?: Assists,
  paceS = BOT_PACE_S,
  serve?: Faction,
  bribes = false,
  pleas = false,
): RunAction[] {
  const beginShift: RunAction = { t: 'beginShift', at: 0, ...(assists ? { assists } : {}) };
  const begun = stepRun(run, beginShift, { content, ctx }).state;
  const cases = begun.shift?.cases ?? [];
  // The favours the bot means to do today (docs/tech-spec.md §42), and how many souls each still wants.
  const favours = (begun.requests ?? []).filter((r) => r.god === serve).map((r) => ({ r, left: r.n }));
  const stamps = stampsFor(ctx);
  const actions: RunAction[] = [beginShift];
  let at = 0;
  // A soul whose turn comes after dusk and its grace is never judged: the shift ends first, with it in line. A party
  // (docs/tech-spec.md §69) is judged a member at a time, turning to each, and sent together.
  let party: { start: number; size: number } | null = null;
  for (const [i, c] of cases.entries()) {
    party = partyAt(cases, i) ?? (party && i < party.start + party.size ? party : null);
    const k = party ? i - party.start : 0;
    if (party) actions.push({ t: 'shift', action: { t: 'turn', to: k, at } });
    at += paceS * 1000;
    const right = rng.chance(Math.round(judging.accuracy * 1000), 1000);
    if (right && c.lies.length > 0 && rng.chance(Math.round(judging.catches * 1000), 1000)) {
      const own = catchLie(c, ctx, at);
      const caught =
        own.length > 0 || !party ? own : catchCrossLie(cases.slice(party.start, party.start + party.size), k, ctx, at);
      for (const action of caught) actions.push({ t: 'shift', action });
      for (const action of lookForMarks(c, ctx, at, caught)) actions.push({ t: 'shift', action });
    }
    const wrongs = stamps.filter((d) => d !== c.expect.dest);
    // A soul the bot knows belongs where a favour asks for souls from goes where the favour asks instead.
    const favour = right ? favours.find((f) => f.left > 0 && f.r.from === c.expect.dest) : undefined;
    if (favour) favour.left--;
    // A bot that takes bribes takes what a story soul offers (docs/tech-spec.md §47), as a choice, not a slip; one
    // that grants pleas gives a story soul the stamp it asks for (docs/tech-spec.md §51).
    const offer = bribes ? storyOffer(content, c) : null;
    const plea = pleas ? pleaOf(content, c) : null;
    const dest: Destination = offer
      ? offer.dest
      : plea
        ? plea.dest
        : favour
          ? favour.r.to
          : right
            ? c.expect.dest
            : (rng.pick(wrongs) ?? c.expect.dest);
    // Judging a soul right includes what must be done to it first (from Day 8, clipping long nails),
    // unless the bot means to leave these nails for Naglfar.
    const procedures = c.expect.procedures ?? [];
    const leave = right && procedures.length > 0 && longNails > 0;
    if (leave) longNails--;
    if (right && !leave && !favour && !offer) {
      for (const id of procedures) {
        const tool = ctx.procedures.find((p) => p.id === id)?.tool;
        if (tool) actions.push({ t: 'shift', action: { t: 'tool', tool, at } });
      }
    }
    actions.push({ t: 'shift', action: { t: 'stamp', dest, at } });
    if (!party || k === party.size - 1) actions.push({ t: 'shift', action: { t: 'send', at } });
  }
  return actions;
}

/**
 * The morning's appeal, if one came: the bot hears every one (an upper bound on what appeals move) and judges
 * the soul again as well as it judges at the gate, on the rules of the day it was judged.
 */
function hearAppeal(run: RunState, content: Content, ctx: DayCtx, judging: Judging, seed: string): RunState {
  const appeal = run.appeal;
  if (!appeal) return run;
  // A stream of its own, so the shifts play out as they would without appeals.
  const rng = new Rng(`${seed}|appeal|${run.day}`);
  const right = rng.chance(Math.round(judging.accuracy * 1000), 1000);
  const wrongs = stampsFor(createDayContext(content, appeal.day, run.seed)).filter(
    (d) => d !== appeal.case.expect.dest,
  );
  const stamped: Destination = right ? appeal.case.expect.dest : (rng.pick(wrongs) ?? appeal.case.expect.dest);
  return stepRun(run, { t: 'appeal', stamped }, { content, ctx }).state;
}

/**
 * The front a bot arms (docs/tech-spec.md §56): its god's, if the battle as the hosts stand tonight would lose it,
 * else the front that would fall by the least, else its god's, else the first for sale.
 */
function armsFront(run: RunState, content: Content, prefer?: string): string | undefined {
  const campaign = campaignOf(content);
  const forSale = (campaign.arms?.fronts ?? []).map((f) => f.front);
  const def = campaign.ragnarok;
  if (!def) return forSale[0];
  const horn = botBattle(run, content, prefer);
  const lost = fight(run, def, horn.order, horn.ride)
    .fronts.filter((f) => !f.held && forSale.includes(f.id))
    .sort((a, b) => a.foe - a.strength - (b.foe - b.strength));
  if (prefer && lost.some((f) => f.id === prefer)) return prefer;
  return lost[0]?.id ?? (prefer && forSale.includes(prefer) ? prefer : forSale[0]);
}

function nightActions(
  run: RunState,
  content: Content,
  ctx: DayCtx,
  strategy: NightStrategy,
  policy: StoryPolicy = PLAIN,
): RunAction[] {
  const actions: RunAction[] = [];
  const economy = economyOf({ content, ctx });
  let bills = defaultBills(run);
  if (strategy === 'frugal') bills = { ...bills, hearth: run.day % 2 === 0 };
  if (strategy === 'neglect') bills = { hearth: false, food: false, medicine: [] };
  const cost = billTotal(run, economy, bills);
  let rings = run.rings;
  if (strategy === 'upgradesFirst') {
    for (const u of shopFor(run, content)) {
      if (rings >= u.price) {
        actions.push({ t: 'buy', item: u.id });
        rings -= u.price;
      }
    }
  } else if (strategy === 'payAll') {
    // Buy only with a cushion left after tonight's bills.
    const spare = rings - cost.hearth - cost.food - cost.medicine - 10;
    for (const u of shopFor(run, content)) {
      if (spare - (run.rings - rings) >= u.price) {
        actions.push({ t: 'buy', item: u.id });
        rings -= u.price;
      }
    }
  }
  // Arms for the last battle (docs/tech-spec.md §56): a lot a night with rings to spare after the next nights' bills,
  // and the ferry's fare for a bot bound for the ferry.
  const lot = armsTonight(run, content);
  if (lot && !lot.bought && strategy !== 'neglect') {
    const ahead = billForecast(run, content, 3).reduce((n, b) => n + b.hearth + b.food + b.tithe - b.draupnir, 0);
    const fare = (policy.flags?.ferryman ?? 0) > 0 ? 100 : 0;
    const front = armsFront(run, content, policy.front);
    if (front && rings - lot.price >= cost.hearth + cost.food + cost.medicine + ahead + fare + 10) {
      actions.push({ t: 'arm', front });
      rings -= lot.price;
    }
  }
  // Upgrades sold back (docs/tech-spec.md §56), the dearest first, when tonight would end the run in debt.
  const floor = campaignOf(content).debtFloor;
  const owned = campaignOf(content)
    .shop.filter((u) => run.upgrades.includes(u.id))
    .sort((a, b) => b.price - a.price);
  for (const u of owned) {
    if (run.debtNights < 1 || rings - cost.hearth - cost.food - cost.medicine >= floor) break;
    const back = sellPrice(run, content, u.id);
    if (back === null) continue;
    actions.push({ t: 'sell', item: u.id });
    rings += back;
  }
  // The forger's trail (docs/tech-spec.md §71): the carver named once the marks leave one man, never on a guess.
  const trail = trailOf(content);
  const left = trail && canAccuse(run, content) ? suspectsLeft(trail, run.trail?.marks ?? []) : [];
  if (left.length === 1 && left[0]) actions.push({ t: 'accuse', suspect: left[0].id });
  actions.push({ t: 'bills', bills }, { t: 'endNight' });
  return actions;
}

export interface RunResult {
  readonly ending: string | null;
  readonly day: number;
  readonly rings: number;
  readonly lowest: number;
  readonly upgrades: number;
  readonly familyLost: number;
  readonly sickNights: number;
  readonly ledgerOk: boolean;
  /** The host's strength at the end (docs/m7-design.md). */
  readonly ragnarok: number;
  /** The fronts held at Ragnarök (docs/tech-spec.md §54), when the run got that far. */
  readonly fronts: readonly string[] | null;
  /** Rings the story's choices gained or cost over the run. */
  readonly storyRings: number;
  /** Souls sent on with their nails long. */
  readonly naglfar: number;
  /** The einherjar at the end, worthy and not, and the souls sent to each hall: the hosts at Ragnarök. */
  readonly einherjar: RunState['einherjar'];
  readonly sent: Readonly<Partial<Record<Destination, number>>>;
  readonly standing: Readonly<Record<Faction, number>>;
  /** Every day's accounts. */
  readonly ledger: readonly DayLedger[];
  /** Souls the sun set on in line (docs/tech-spec.md §41), and the living among them, lost in the night. */
  readonly leftAtDusk: number;
  readonly diedWaiting: number;
  /** The achievements the run earned, of those asked for (SimOptions.achievements). */
  readonly achievements: readonly string[];
  /** What the epilogue said of the run (docs/tech-spec.md §55), its lines' string keys; none before an ending. */
  readonly epilogue: readonly string[];
  /** Lots of arms bought, and whether a reprieve paid a debt (docs/tech-spec.md §56). */
  readonly arms: number;
  readonly reprieved: boolean;
  /** The forger's trail (docs/tech-spec.md §71): marks pinned, and whether the carver named was the one (null: none). */
  readonly trail: { readonly marks: number; readonly right: boolean | null };
}

export interface SimOptions {
  /** How the bot plays the story; scenes are skipped without `scenes`. */
  readonly story?: StoryPolicy;
  readonly scenes?: SceneTable;
  /** Assists the bot plays every shift with (only waiving fines changes what a bot's day comes to). */
  readonly assists?: Assists;
  /** Achievements to check as the run goes, as the game checks them: each shift as it ends, the run each day. */
  readonly achievements?: readonly AchievementDef[];
  /** Whether the bot hears the morning's appeals (docs/tech-spec.md §40); it does unless told not to. */
  readonly appeals?: boolean;
  /**
   * Seconds of sun the bot spends on each soul (BOT_PACE_S unless given). Slower than a day's sun per soul, the
   * sun sets on the line (docs/tech-spec.md §41).
   */
  readonly paceS?: number;
  /** A god whose requests the bot does, in full when it can (docs/tech-spec.md §42); it ignores them otherwise. */
  readonly serve?: Faction;
  /** At most this many of them over the run (every one it can, unless given). */
  readonly serveUpTo?: number;
  /** Whether the bot takes the ranks it's offered (docs/tech-spec.md §44); unanswered, offers lapse at the gate. */
  readonly promote?: boolean;
  /** Whether the bot takes what story souls offer for a wrong stamp (docs/tech-spec.md §47); it never does unless told. */
  readonly bribes?: boolean;
  /** Whether the bot grants what story souls plead for (docs/tech-spec.md §51); it never does unless told. */
  readonly pleas?: boolean;
  /** Whether the run is played under the oath (docs/tech-spec.md §49): fines from the first mistake. */
  readonly oath?: boolean;
  /** A weave to play the run under (docs/tech-spec.md §53), by id, for measuring it. */
  readonly weave?: string;
  /** Called with the run as the horn blows, before the hosts go to the fronts: for probes of the last battle. */
  readonly onHorn?: (run: RunState) => void;
}

/** One bot run to the end of the campaign (or its ending). */
export function simulateRun(
  content: Content,
  seed: string,
  judging: Judging,
  strategy: NightStrategy,
  options: SimOptions = {},
): RunResult {
  const policy = options.story ?? PLAIN;
  const begun = newRun(content, seed, options.oath ? { oath: true } : {});
  let run: RunState = options.weave ? { ...begun, weave: options.weave } : begun;
  const rng = new Rng(`sim|${seed}|${judging.name}|${strategy}`);
  let lowest = run.rings;
  let sickNights = 0;
  let storyRings = 0;
  let ledgerOk = true;
  const lastDay = campaignOf(content).lastDay;
  const defs = options.achievements ?? [];
  const earned: string[] = [];
  const note = (moment: AchievementMoment) => {
    if (defs.length > 0) earned.push(...earnedAt(defs, moment, (id) => earned.includes(id)));
  };
  // Day by day to the ending, or to the last battle (docs/tech-spec.md §54), fought below.
  for (let guard = 0; guard < lastDay + 1 && run.phase !== 'ending' && run.phase !== 'ragnarok'; guard++) {
    const ctx = runContext(content, run);
    const start = run.rings;
    if (options.scenes) run = playStory(run, content, ctx, options.scenes, 'morning', policy);
    if (options.appeals !== false)
      run = hearAppeal(run, content, ctx, judging, `sim|${seed}|${judging.name}|${strategy}`);
    if (options.promote !== undefined && run.offer) {
      run = stepRun(run, { t: 'promotion', accept: options.promote }, { content, ctx }).state;
    }
    const nails = policy.longNails;
    const longNails = nails && (!nails.deal || (run.flags.loki_deal ?? 0) > 0) ? nails.perDay : 0;
    let initial: ShiftState | undefined;
    const log: ShiftAction[] = [];
    const served = run.ledger.reduce((n, l) => n + (l.requests ?? []).filter((q) => q.met).length, 0);
    const serve = served < (options.serveUpTo ?? Number.POSITIVE_INFINITY) ? options.serve : undefined;
    const actions = shiftActions(
      run,
      content,
      ctx,
      judging,
      rng,
      longNails,
      options.assists,
      options.paceS,
      serve,
      options.bribes,
      options.pleas,
    );
    for (const a of actions) {
      run = stepRun(run, a, { content, ctx }).state;
      if (a.t === 'beginShift') initial = run.shift ?? undefined;
      else if (a.t === 'shift') log.push(a.action);
      // Whoever comes to the desk when their turn comes (docs/tech-spec.md §46), as the policy would answer them.
      const visit = options.scenes ? deskVisit(run, content) : null;
      if (visit && options.scenes) run = playScene(run, content, ctx, options.scenes, visit.scene, policy);
    }
    if (initial && defs.length > 0) note({ at: 'shift', mode: 'campaign', facts: shiftFacts(initial, log, ctx) });
    run = stepRun(run, { t: 'endAudit' }, { content, ctx }).state;
    if (options.scenes) run = playStory(run, content, ctx, options.scenes, 'night', policy);
    for (const a of nightActions(run, content, ctx, strategy, policy)) run = stepRun(run, a, { content, ctx }).state;
    // The day's accounts must add up to the change in rings.
    const l = run.ledger[run.ledger.length - 1];
    const n = l?.night;
    if (!l || !n) ledgerOk = false;
    else {
      const appeal = l.appeal?.rings ?? 0;
      const delta =
        appeal +
        l.pay +
        l.bonus +
        (l.nails ?? 0) -
        l.fines -
        n.hearth -
        n.food -
        n.medicine -
        (n.tithe ?? 0) -
        n.upgrades +
        n.draupnir +
        n.story -
        (n.arms ?? 0) +
        (n.sold ?? 0) +
        (n.reprieve ?? 0);
      if (start + delta !== n.rings) ledgerOk = false;
      storyRings += n.story;
    }
    lowest = Math.min(lowest, run.rings);
    sickNights += run.family.filter((m) => m.status === 'sick').length;
    note({ at: 'run', run });
  }
  // The horn (docs/tech-spec.md §54): the bot sends the hosts where it can hold the most, its god's front among them.
  if (run.phase === 'ragnarok') {
    options.onHorn?.(run);
    const env = { content, ctx: runContext(content, run) };
    const horn = botBattle(run, content, policy.front);
    run = stepRun(run, { t: 'marshal', order: horn.order, ...(horn.ride ? { ride: horn.ride } : {}) }, env).state;
    note({ at: 'run', run });
  }
  if (run.ending) note({ at: 'ending', ending: run.ending });
  return {
    ending: run.ending,
    day: run.day,
    rings: run.rings,
    lowest,
    upgrades: run.upgrades.length,
    familyLost: run.family.filter((m) => m.status === 'gone').length,
    sickNights,
    ledgerOk,
    ragnarok: ragnarokStrength(run),
    fronts: run.battle ? heldFronts(run.battle) : null,
    storyRings,
    naglfar: run.naglfar ?? 0,
    einherjar: run.einherjar,
    sent: run.sent ?? {},
    standing: run.standing,
    ledger: run.ledger,
    leftAtDusk: run.ledger.reduce(
      (n, l) => n + (l.waiting ? l.waiting.carried.length + l.waiting.died.length + (l.waiting.gone?.length ?? 0) : 0),
      0,
    ),
    diedWaiting: run.ledger.reduce((n, l) => n + (l.waiting?.died.length ?? 0), 0),
    achievements: earned,
    epilogue: epilogueFor(run, content.campaign).map((l) => l.text),
    arms: run.armsBought ?? 0,
    reprieved: run.ledger.some((l) => (l.night?.reprieve ?? 0) !== 0),
    trail: { marks: run.trail?.marks.length ?? 0, right: run.trail?.accused?.right ?? null },
  };
}

export interface PolicyReport {
  readonly judging: string;
  readonly strategy: NightStrategy;
  readonly story: string;
  readonly runs: number;
  readonly demoted: number;
  readonly familyLost: number;
  readonly meanRings: number;
  readonly minRings: number;
  readonly meanUpgrades: number;
  readonly meanRagnarok: number;
  /** Fronts held at Ragnarök, in runs that got there (docs/tech-spec.md §54): the mean, and how many runs held each count. */
  readonly meanFronts: number | null;
  readonly frontsHeld: Readonly<Record<number, number>>;
  readonly meanStoryRings: number;
  readonly meanNaglfar: number;
  readonly meanStanding: Readonly<Record<Faction, number>>;
  /** Souls left in line at dusk over a run, and the living among them who died waiting (means). */
  readonly meanLeft: number;
  readonly meanDied: number;
  /** Requests the gods made over a run, and those done in full (means). */
  readonly meanAsked: number;
  readonly meanMet: number;
  /** Days worked at each rank over a run (means; the first is the first rank). */
  readonly meanRankDays: readonly number[];
  /** Lots of arms bought (mean), and runs a reprieve saved (docs/tech-spec.md §56). */
  readonly meanArms: number;
  readonly reprieved: number;
  readonly endings: Record<string, number>;
  readonly ledgerErrors: number;
}

export function simulateCampaign(
  content: Content,
  seeds: number,
  judgings: readonly Judging[] = JUDGING,
  strategies: readonly NightStrategy[] = ['payAll', 'frugal', 'upgradesFirst'],
  stories: readonly StoryPolicy[] = [PLAIN],
  scenes?: SceneTable,
  assists?: Assists,
  paceS?: number,
  serve?: Faction,
  promote?: boolean,
  bribes?: boolean,
  weave?: string,
): PolicyReport[] {
  const out: PolicyReport[] = [];
  const mean = (xs: readonly number[]) => xs.reduce((a, x) => a + x, 0) / Math.max(1, xs.length);
  for (const judging of judgings) {
    for (const strategy of strategies) {
      for (const story of stories) {
        const results = Array.from({ length: seeds }, (_, i) =>
          simulateRun(content, `c${i}`, judging, strategy, {
            story,
            ...(scenes ? { scenes } : {}),
            ...(assists ? { assists } : {}),
            ...(paceS !== undefined ? { paceS } : {}),
            ...(serve ? { serve } : {}),
            ...(promote !== undefined ? { promote } : {}),
            ...(bribes ? { bribes } : {}),
            ...(weave ? { weave } : {}),
          }),
        );
        const ranks = campaignOf(content).promotion?.ranks.length ?? 0;
        const endings: Record<string, number> = {};
        for (const r of results) endings[r.ending ?? 'none'] = (endings[r.ending ?? 'none'] ?? 0) + 1;
        out.push({
          judging: judging.name,
          strategy,
          story: story.name,
          runs: seeds,
          demoted: results.filter((r) => r.ending === 'ending.demoted').length,
          familyLost: results.filter((r) => r.familyLost > 0).length,
          meanRings: mean(results.map((r) => r.rings)),
          minRings: Math.min(...results.map((r) => r.rings)),
          meanUpgrades: mean(results.map((r) => r.upgrades)),
          meanRagnarok: mean(results.map((r) => r.ragnarok)),
          ...(() => {
            const fought = results.flatMap((r) => (r.fronts ? [r.fronts.length] : []));
            const frontsHeld: Record<number, number> = {};
            for (const n of fought) frontsHeld[n] = (frontsHeld[n] ?? 0) + 1;
            return { meanFronts: fought.length > 0 ? mean(fought) : null, frontsHeld };
          })(),
          meanStoryRings: mean(results.map((r) => r.storyRings)),
          meanNaglfar: mean(results.map((r) => r.naglfar)),
          meanStanding: Object.fromEntries(
            FACTIONS.map((f) => [f, mean(results.map((r) => r.standing[f] ?? 0))]),
          ) as Record<Faction, number>,
          meanLeft: mean(results.map((r) => r.leftAtDusk)),
          meanDied: mean(results.map((r) => r.diedWaiting)),
          meanAsked: mean(results.map((r) => r.ledger.reduce((n, l) => n + (l.requests?.length ?? 0), 0))),
          meanMet: mean(
            results.map((r) => r.ledger.reduce((n, l) => n + (l.requests ?? []).filter((q) => q.met).length, 0)),
          ),
          meanRankDays: Array.from({ length: ranks }, (_, k) =>
            mean(results.map((r) => r.ledger.filter((l) => l.rank === k + 1).length)),
          ),
          meanArms: mean(results.map((r) => r.arms)),
          reprieved: results.filter((r) => r.reprieved).length,
          endings,
          ledgerErrors: results.filter((r) => !r.ledgerOk).length,
        });
      }
    }
  }
  return out;
}

/** What a scenario save does besides judging every soul rightly (see scenarioSave). */
export interface ScenarioOptions {
  /** Looks for marks on the forger's trail at the desk (docs/tech-spec.md §71), as a careful player does. */
  readonly careful?: boolean;
  /** Scenes played as their turn comes, by id, with the effects of the choices they stand for. */
  readonly scenes?: Readonly<Record<string, readonly Effect[]>>;
}

/**
 * A scenario jumper for tests (docs/build-plan.md §11): a save on the morning
 * of `day`, with every earlier soul judged rightly and every bill paid; or, `at`
 * night, on that day's night, its souls judged rightly and its scene still to play.
 * A day past the last is the ending, after the last battle where the build has one.
 */
export function scenarioSave(
  content: Content,
  seed: string,
  day: number,
  engine: number,
  at: 'morning' | 'night' = 'morning',
  opts: ScenarioOptions = {},
): RunSave {
  let save = startSave(content, seed, engine);
  let run = save.mornings[0] as RunState;
  const apply = (action: RunAction) => {
    const env = { content, ctx: runContext(content, run), ...(save.queue ? { queue: save.queue } : {}) };
    const next = stepRun(run, action, env).state;
    save = recordAction(save, run, action, next);
    run = next;
  };
  const scene = (which: 'morning' | 'night') => {
    const id = content.days.find((d) => d.day === run.day)?.scenes?.[which];
    const effects = id ? opts.scenes?.[id] : undefined;
    if (id && effects) apply({ t: 'scene', id, effects });
  };
  const shift = () => {
    scene('morning');
    apply({ t: 'beginShift', at: 0 });
    const ctx = runContext(content, run);
    let at = 0;
    for (const c of run.shift?.cases ?? []) {
      at += 1000;
      if (opts.careful) for (const action of lookForMarks(c, ctx, at)) apply({ t: 'shift', action });
      apply({ t: 'shift', action: { t: 'stamp', dest: c.expect.dest, at } });
      apply({ t: 'shift', action: { t: 'send', at } });
    }
    apply({ t: 'endAudit' });
  };
  while (run.day < day && run.phase !== 'ending') {
    // Past the last day: the last battle (docs/tech-spec.md §54), its fronts held in the order they're listed.
    if (run.phase === 'ragnarok') {
      apply({ t: 'marshal', order: [] });
      break;
    }
    shift();
    scene('night');
    apply({ t: 'endNight' });
  }
  // The night of `day`, its scene still to play.
  if (at === 'night' && run.phase === 'morning') shift();
  return save;
}
