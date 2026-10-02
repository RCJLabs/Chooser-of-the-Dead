import {
  type AppealHeard,
  type Assists,
  type Content,
  campaignOf,
  createDayContext,
  culpritOf,
  type DayLedger,
  type DayMistake,
  type Destination,
  EPILOGUE_SECTIONS,
  epilogueFor,
  epilogueParams,
  type Faction,
  factionKey,
  factionsMet,
  huntOn,
  memberDef,
  type NamedSoul,
  namedIn,
  originOf,
  type RunSave,
  type RunState,
  ruleText,
  suspectsLeft,
  type TrailSuspect,
  trailOf,
  wordLevel,
} from '@cots/engine';
import { journalEnv, playScene } from '@cots/story';

/*
 * The playtest report (docs/tech-spec.md §38): a campaign run, read from its save, as text for the playtest
 * form. It's what tuning needs from people rather than bots: the rings night by night, every soul sent wrong
 * and the rule it broke, and each choice made in the story. The game's own words come through `t`; the
 * report's frame is plain English, for whoever reads the form.
 */

export type Translate = (key: string, vars?: Readonly<Record<string, string | number>>) => string;

export interface PlaytestInput {
  readonly save: RunSave;
  /** The run as it stands now (the save played up to its last action). */
  readonly run: RunState;
  /** The save slot, from 0. */
  readonly slot: number;
  /** Which build: its target, commit and content. */
  readonly build: string;
  readonly content: Content;
  /** The compiled scenes by id, to read the choices back. */
  readonly scenes: Readonly<Record<string, object>>;
  readonly t: Translate;
}

/** A change in rings, signed; plain ASCII, so the table can be read by a script as well as a person. */
const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

/** Seconds as minutes and seconds: 83 is 1:23. */
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

const PHASES: Readonly<Record<RunState['phase'], string>> = {
  morning: 'morning',
  shift: 'at the gate',
  audit: 'the audit',
  night: 'night',
  ragnarok: 'sending the hosts to the fronts',
  ending: 'the ending',
};

function assistsText(a: Assists | undefined): string {
  if (!a) return '';
  return [
    a.sunPct !== undefined && a.sunPct !== 100 ? `sun ${a.sunPct}%` : '',
    a.tracker ? 'rule tracker' : '',
    a.noFines ? 'no fines' : '',
  ]
    .filter((s) => s !== '')
    .join(', ');
}

function header(p: PlaytestInput): string[] {
  const { run, t } = p;
  const campaign = campaignOf(p.content);
  const family = run.family.map((m) => {
    const name = t(memberDef(p.content, m.id)?.name ?? m.id);
    const status =
      m.status === 'sick'
        ? `sick, ${m.sickNights} night${m.sickNights === 1 ? '' : 's'} without medicine`
        : m.status === 'gone'
          ? m.gone === 'died'
            ? 'died'
            : 'sent to relatives'
          : 'well';
    return `${name}: ${status}`;
  });
  // Only the powers met so far, by the names they go by today: the report mustn't spoil the story.
  const standing = factionsMet(run).map((f) => `${t(factionKey(p.content, f, run.day))} ${signed(run.standing[f])}`);
  const bought = campaign.shop.filter((u) => run.upgrades.includes(u.id)).map((u) => t(u.name));
  // Arms for the last battle, by front, and the night the reprieve paid (docs/tech-spec.md §56).
  const fronts = campaign.ragnarok?.fronts ?? [];
  const armed = Object.entries(run.armed ?? {}).map(
    ([id, n]) => `${t(fronts.find((f) => f.id === id)?.name ?? id)} +${n}`,
  );
  const paid = run.ledger.find((l) => (l.night?.reprieve ?? 0) > 0);
  const ending = run.ending ? campaign.endings.find((e) => e.id === run.ending) : undefined;
  const about = [
    `slot ${p.slot + 1}`,
    `seed \`${run.seed}\``,
    run.story ? 'Story Mode' : '',
    run.oath ? 'under oath' : '',
    run.weave
      ? `woven: ${t(p.content.campaign?.weaving?.weaves.find((w) => w.id === run.weave)?.name ?? run.weave)}`
      : '',
    run.slice ? 'the slice' : '',
    // Who she was in life (docs/tech-spec.md §72).
    run.origin ? `as ${t(originOf(run, p.content)?.name ?? run.origin)}` : '',
  ]
    .filter((s) => s !== '')
    .join(' · ');
  const debt = run.debtNights > 0 ? ` · ${run.debtNights} night${run.debtNights === 1 ? '' : 's'} in debt` : '';
  return [
    '## Playtest report',
    '',
    `- **Build:** ${p.build}`,
    `- **Run:** ${about}`,
    `- **Now:** Day ${run.day}, ${PHASES[run.phase]} · ${run.rings} rings${debt}`,
    `- **Family:** ${family.join(' · ')}`,
    ...(standing.length > 0 ? [`- **Standing:** ${standing.join(' · ')}`] : []),
    ...(bought.length > 0 ? [`- **Bought:** ${bought.join(', ')}`] : []),
    ...(armed.length > 0 ? [`- **Arms:** ${armed.join(', ')}`] : []),
    ...(paid?.night ? [`- **Reprieve:** Night ${paid.day}, ${paid.night.reprieve} rings of debt paid`] : []),
    ...(run.ending ? [`- **Ending:** ${ending ? t(ending.title) : run.ending}`] : []),
  ];
}

const DAY_HEADS = [
  'Day',
  'Grade',
  'Right',
  'Wrong',
  'Unjudged',
  'Sun left',
  'Pressed',
  'Pay',
  'Bonus',
  'Nails',
  'Fines',
  'Bills',
  'Shop',
  'Arms',
  'Story',
  'Draupnir',
  'Rings after the night',
  'Vow',
  'Assists',
];

/**
 * Each finished day's accounts, one row a day; a day whose night is still to come has its night cells empty. The arms
 * column is there only in a build that sells them, the nails column (rings a favour paid for nails left uncut,
 * docs/tech-spec.md §57) only in one with such a favour, and the pressed column (claims pressed, and lies that gave
 * way, docs/tech-spec.md §66) only in one where souls can be pressed, and the vow column (sworn at the cup the night
 * before, and how it went, §75) only in one with vows.
 */
function days(
  ledger: readonly DayLedger[],
  has: { arms: boolean; nails: boolean; press: boolean; vows: boolean },
): string[] {
  if (ledger.length === 0) return ['### Days', '', 'No day finished yet.'];
  const heads = DAY_HEADS.filter(
    (h) =>
      (has.arms || h !== 'Arms') &&
      (has.nails || h !== 'Nails') &&
      (has.press || h !== 'Pressed') &&
      (has.vows || h !== 'Vow'),
  );
  const rows = ledger.map((l) => {
    const n = l.night;
    // The day's grade (docs/tech-spec.md §49), with the liars caught before their stamp, and where stamps are asked for
    // proof, the right ones that were guesses (§76).
    const g = l.grade;
    const lucky = g?.lucky ? `, ${g.lucky} lucky` : '';
    const vow = l.vow ? `${l.vow.id} ${l.vow.kept ? `kept (${signed(l.vow.rings)})` : 'broken'}` : '';
    const cells = [
      String(l.day),
      g ? `${g.grade} (${g.caught}/${g.liars} liars${lucky})${g.assisted ? ', assisted' : ''}` : '',
      String(l.correct),
      String(l.wrong),
      String(l.unjudged),
      // Sun left when the last soul was sent (docs/tech-spec.md §49), 0:00 when it set on the line; the grade keeps
      // it, so a day without one (Story Mode, older saves) has the cell empty.
      g ? clock(Math.round(g.spareMs / 1000)) : '',
      ...(has.press ? [`${l.pressed?.n ?? 0}${l.pressed?.gave ? ` (${l.pressed.gave} gave way)` : ''}`] : []),
      signed(l.pay),
      signed(l.bonus),
      ...(has.nails ? [signed(l.nails ?? 0)] : []),
      signed(-l.fines),
      n ? signed(-(n.hearth + n.food + n.medicine)) : '',
      // Upgrades bought, net of what sold back; arms; the reprieve beside the purse it left (docs/tech-spec.md §56).
      n ? signed(-n.upgrades + (n.sold ?? 0)) : '',
      ...(has.arms ? [n ? signed(-(n.arms ?? 0)) : ''] : []),
      n ? signed(n.story) : '',
      n ? signed(n.draupnir) : '',
      n ? `${n.rings}${n.reprieve ? ` (reprieve ${signed(n.reprieve)})` : ''}` : '',
      ...(has.vows ? [vow] : []),
      assistsText(l.assists),
    ];
    return `| ${cells.join(' | ')} |`;
  });
  // Numbers to the right; the grade, the vow and the assists are words.
  const align = heads.map((h) => (h === 'Grade' || h === 'Vow' || h === 'Assists' ? '---' : '---:'));
  return ['### Days', '', `| ${heads.join(' | ')} |`, `| ${align.join(' | ')} |`, ...rows];
}

function mistakeLine(p: PlaytestInput, day: number, m: DayMistake): string {
  const { t } = p;
  const ctx = createDayContext(p.content, day, p.run.seed);
  const rule = ctx.rules.find((r) => r.id === m.rule);
  const skipped = (m.skipped ?? []).map((id) => {
    const proc = ctx.procedures.find((x) => x.id === id);
    return proc ? t(`${proc.text}.short`) : id;
  });
  const skip = skipped.length > 0 ? ` Skipped: ${skipped.join(', ')}.` : '';
  // A soul after the day's noon decree (docs/tech-spec.md §45) was judged under it.
  const noon = m.noon ? ' After the noon decree.' : '';
  // A stamp a soul paid for (docs/tech-spec.md §47, §73) was a choice, not a slip.
  const paid = m.paid ? ` A bribe: ${m.paid} rings for the stamp.` : '';
  // A stamp a soul asked for (docs/tech-spec.md §51, §59) was a kindness, not a slip.
  const pled = m.pled ? ' A plea granted.' : '';
  // A skald's tally (docs/tech-spec.md §77): whether a kenning came before the mistake, or a forger's botch of one.
  const skald =
    m.skald === 'botched'
      ? ' Its tally had a botched kenning.'
      : m.skald === 'kennings'
        ? ' Its tally was in kennings.'
        : '';
  if (m.stamped === m.expected)
    return `- Day ${day}: the right stamp, ${t(`dest.${m.stamped}`)}, but a step skipped.${skip}${noon}`;
  const why = rule ? `“${t(ruleText(rule, day))}”` : m.rule;
  return `- Day ${day}: stamped ${t(`dest.${m.stamped}`)} for a soul that belonged in ${t(`dest.${m.expected}`)}. The rule: ${why}${skip}${noon}${paid}${pled}${skald}`;
}

/** Every soul sent wrong, day by day, with the rule that decided where it belonged. */
function mistakes(p: PlaytestInput): string[] {
  const lines = p.run.ledger.flatMap((l) => {
    if (l.wrong === 0) return [];
    // A save from before mistakes were filed has only the count.
    if (!l.mistakes) return [`- Day ${l.day}: ${l.wrong} sent wrong (not itemised in saves from before this build).`];
    return l.mistakes.map((m) => mistakeLine(p, l.day, m));
  });
  return ['### Mistakes', '', ...(lines.length > 0 ? lines : ['None.'])];
}

/** Days as a list, runs of days joined: 7–9, 12. */
function dayList(days: readonly number[]): string {
  const runs: [number, number][] = [];
  for (const d of days) {
    const last = runs.at(-1);
    if (last && d === last[1] + 1) last[1] = d;
    else runs.push([d, d]);
  }
  return runs.map(([a, b]) => (a === b ? String(a) : `${a}–${b}`)).join(', ');
}

/**
 * Parties at the desk (docs/tech-spec.md §69): on each day that had any, how many and their souls, and the lies told
 * about companions with how many were caught before the stamp. Nothing for a run that met none.
 */
function parties(p: PlaytestInput): string[] {
  const days = p.run.ledger.flatMap((l) => (l.parties ? [{ day: l.day, ...l.parties }] : []));
  if (days.length === 0) return [];
  const total = (k: 'n' | 'souls' | 'lies' | 'caught') => days.reduce((n, d) => n + d[k], 0);
  // Hearth-men whose hall was their jarl's (docs/tech-spec.md §70).
  const men = days.reduce((n, d) => n + (d.retinue?.men ?? 0), 0);
  const right = days.reduce((n, d) => n + (d.retinue?.right ?? 0), 0);
  const lines = days.map(
    (d) =>
      `- Day ${d.day}: ${d.n} ${d.n === 1 ? 'party' : 'parties'} of ${d.souls} souls; lies about a companion caught: ${d.caught} of ${d.lies}.${d.retinue ? ` Hearth-men who went where their jarl went: ${d.retinue.right} of ${d.retinue.men} judged rightly.` : ''}`,
  );
  return [
    '### Parties',
    '',
    `Parties: ${total('n')}, of ${total('souls')} souls. Lies about a companion: ${total('lies')}, caught before the stamp: ${total('caught')}.${men > 0 ? ` Hearth-men who went where their jarl went: ${men}, judged rightly: ${right}.` : ''}`,
    '',
    ...lines,
  ];
}

/**
 * The forger's trail (docs/tech-spec.md §71): whether the hunt opened, the marks pinned each day, and who was named and
 * when, beside who cut the tallies. Nothing before the trail's first day.
 */
function trail(p: PlaytestInput): string[] {
  const def = trailOf(p.content);
  if (!def || p.run.day < def.since) return [];
  const name = (s: TrailSuspect) => `${s.look.name} ${s.look.patronym}`;
  const culprit = culpritOf(def, p.run.seed);
  const marks = p.run.trail?.marks ?? [];
  const accused = p.run.trail?.accused;
  const named = accused ? def.suspects.find((s) => s.id === accused.suspect) : undefined;
  const days = [...new Set(marks.map((m) => m.day))].map(
    (d) =>
      `- Day ${d}: ${marks
        .filter((m) => m.day === d)
        .map((m) => `${m.hand} (${m.via === 'tally' ? 'tally' : 'Muninn'}, ${m.name})`)
        .join(', ')}`,
  );
  const left = suspectsLeft(def, marks).map(name);
  return [
    "### The forger's trail",
    '',
    `The carver: ${name(culprit)}. ${huntOn(p.run, p.content) ? 'The hunt opened.' : 'The hunt never opened.'} Marks pinned: ${marks.length}; they leave ${left.join(', ')}.`,
    named && accused
      ? `Named on Night ${accused.day}: ${name(named)}, ${accused.right ? 'the right man' : 'the wrong man'}.`
      : 'Nobody named.',
    ...(days.length > 0 ? ['', ...days] : []),
  ];
}

/**
 * The souls who asked for another hall (docs/tech-spec.md §51, §59), those who offered rings for one (§47, §73) and the
 * kin who came for a soul sent wrong (§60): how many, and each by day with where it belonged, what it asked, whether it
 * was given it, and whether it had lied at the desk (§73). A refused plea is a right stamp, so nothing else in the report
 * shows it. Where the build keeps the word among the dead (§73), where it stood after each audit. Days played on a build
 * that didn't keep them are named.
 */
function pleas(p: PlaytestInput): string[] {
  const campaign = campaignOf(p.content);
  const from = Math.min(
    campaign.pleas?.from ?? Number.POSITIVE_INFINITY,
    campaign.kin?.from ?? Number.POSITIVE_INFINITY,
  );
  if (!Number.isFinite(from)) return [];
  const dest = (d: Destination) => p.t(`dest.${d}`);
  const all = p.run.ledger.flatMap((l) => (l.pleas ?? []).map((x) => ({ day: l.day, ...x })));
  const lines = all.map((x) => {
    const who = `${x.name}${x.story ? ' (a story soul)' : ''}${x.kin ? `, kin of ${x.kin}` : ''}`;
    const lied = x.lied ? ' It had lied at the desk: found out later.' : '';
    if (!x.to) return `- Day ${x.day}: ${who}, came and asked nothing, belonging in ${dest(x.belongs)} anyway.`;
    if (x.offer !== undefined)
      return `- Day ${x.day}: ${who}, offered ${x.offer} rings for ${dest(x.to)}, belonging in ${dest(x.belongs)}: ${x.granted ? 'taken' : 'refused'}.${lied}`;
    return `- Day ${x.day}: ${who}, asked for ${dest(x.to)}, belonging in ${dest(x.belongs)}: ${x.granted ? 'granted' : 'refused'}.${lied}`;
  });
  const asked = all.filter((x) => x.to !== undefined && x.offer === undefined);
  const offered = all.filter((x) => x.offer !== undefined);
  const lied = all.filter((x) => x.lied).length;
  const kin = all.filter((x) => x.kin !== undefined).length;
  const summary =
    all.length === 0
      ? ['Nobody asked yet.']
      : [
          `Pleas: ${asked.length}, granted: ${asked.filter((x) => x.granted).length}. Kin who came: ${kin}.`,
          ...(offered.length > 0
            ? [`Offers: ${offered.length}, taken: ${offered.filter((x) => x.granted).length}.`]
            : []),
          ...(lied > 0 ? [`Found out lying: ${lied}.`] : []),
        ];
  const missing = p.run.ledger.filter((l) => l.day >= from && l.pleas === undefined).map((l) => l.day);
  const note =
    missing.length > 0
      ? [
          `Not counted on Day${missing.length === 1 ? '' : 's'} ${dayList(missing)}: played on a build from before they were.`,
        ]
      : [];
  return ['### Pleas and kin', '', ...summary, ...note, ...word(p), ...(lines.length > 0 ? ['', ...lines] : [])];
}

/**
 * Word among the dead (docs/tech-spec.md §73): where it stood after each audit that moved it, and where it stands now,
 * with its level. Nothing in a build without it, or before it first moves.
 */
function word(p: PlaytestInput): string[] {
  const def = campaignOf(p.content).word;
  if (!def) return [];
  const moved = p.run.ledger.filter((l) => l.word !== undefined && l.word.by !== 0);
  const now = p.run.word ?? 0;
  if (moved.length === 0 && now === 0) return [];
  const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);
  const days = moved.map((l) => `Day ${l.day} ${signed(l.word?.now ?? 0)}`).join(', ');
  const level = p.t(wordLevel(def, now).name);
  return [`Word among the dead: ${level} (${signed(now)}).${days ? ` After the audits that moved it: ${days}.` : ''}`];
}

/** Each appeal heard (docs/tech-spec.md §40): whose, what was decided, and what it came to. */
function appeals(p: PlaytestInput): string[] {
  const { t } = p;
  const line = (when: string, a: AppealHeard) => {
    const what =
      a.outcome === 'righted'
        ? `righted, to ${t(`dest.${a.to}`)}`
        : a.outcome === 'upheld'
          ? 'turned down rightly'
          : a.outcome === 'wrong'
            ? `decided wrongly (${t(`dest.${a.to}`)}; it belonged in ${t(`dest.${a.expected}`)})`
            : 'left to stand';
    return `- ${when}: ${a.name}, judged on Day ${a.day} and sent to ${t(`dest.${a.from}`)}: ${what}, ${signed(a.rings)} rings.`;
  };
  const lines = p.run.ledger.flatMap((l) => (l.appeal ? [line(`Day ${l.day}`, l.appeal)] : []));
  // Heard this morning, and not yet filed by the day's audit.
  if (p.run.appealHeard) lines.push(line(`Day ${p.run.day}, this morning`, p.run.appealHeard));
  return ['### Appeals', '', ...(lines.length > 0 ? lines : ['None.'])];
}

/** Each night the sun set on the line (docs/tech-spec.md §41): who waited, who died in the night, and the cost. */
function line(p: PlaytestInput): string[] {
  const names = (souls: readonly { readonly name: string }[]) => souls.map((s) => s.name).join(', ');
  const lines = p.run.ledger.flatMap((l) => {
    const w = l.waiting;
    if (!w) return [];
    const parts = [
      ...(w.carried.length > 0 ? [`${names(w.carried)} waited for Day ${l.day + 1}`] : []),
      ...(w.died.length > 0 ? [`${names(w.died)} died in the night`] : []),
      ...((w.gone?.length ?? 0) > 0 ? [`${names(w.gone ?? [])} could not wait`] : []),
    ];
    const cost = Object.entries(w.standing)
      .filter(([, n]) => n !== 0)
      .map(([f, n]) => `${p.t(factionKey(p.content, f as Faction, l.day))} ${signed(n ?? 0)}`)
      .join(', ');
    return [`- Day ${l.day}: ${parts.join('; ')}.${cost ? ` Standing: ${cost}.` : ''}`];
  });
  return ['### The line at dusk', '', ...(lines.length > 0 ? lines : ['Nobody was left in line.'])];
}

/** Each god's request, and how it went (docs/tech-spec.md §42). */
function requests(p: PlaytestInput): string[] {
  const god = (f: Faction, day: number) => p.t(factionKey(p.content, f, day));
  const lines = p.run.ledger.flatMap((l) =>
    (l.requests ?? []).map((r) => {
      const reward = Object.entries(r.standing)
        .filter(([, n]) => n !== 0)
        .map(([f, n]) => `${god(f as Faction, l.day)} ${signed(n ?? 0)}`)
        .join(', ');
      const asked = `${god(r.god, l.day)} asked for ${r.n} from ${p.t(`dest.${r.from}`)} sent to ${p.t(`dest.${r.to}`)}`;
      return `- Day ${l.day}: ${asked}; ${r.done} sent as asked: ${r.met ? `done (${reward})` : 'not done'}.`;
    }),
  );
  return ['### Requests', '', ...(lines.length > 0 ? lines : ['None yet.'])];
}

/** The gods' favours each day held (docs/tech-spec.md §43), as the gate granted them, and the fines they spared. */
function favours(p: PlaytestInput): string[] {
  const defs = new Map((p.content.campaign?.favours ?? []).map((f) => [f.id, f]));
  const lines = p.run.ledger.flatMap((l) => {
    const held = (l.favours ?? []).flatMap((id) => {
      const f = defs.get(id);
      return f ? [`${p.t(factionKey(p.content, f.faction, l.day))}'s favour (${p.t(f.text)})`] : [];
    });
    const spared = l.eased ? [`${l.eased} rings of fines spared`] : [];
    const nails = l.nails ? [`${l.nails} rings for nails left uncut`] : [];
    return held.length > 0 ? [`- Day ${l.day}: ${[...held, ...spared, ...nails].join('; ')}.`] : [];
  });
  return ['### Favours', '', ...(lines.length > 0 ? lines : ['None yet.'])];
}

/** Sun each day gave to home at dawn (docs/tech-spec.md §50), as the audit filed it. */
function home(p: PlaytestInput): string[] {
  const lines = p.run.ledger.flatMap((l) =>
    l.dawnS ? [`- Day ${l.day}: ${clock(Math.abs(l.dawnS))} ${l.dawnS < 0 ? 'less' : 'more'} sun, for home.`] : [],
  );
  return ['### Home at dawn', '', ...(lines.length > 0 ? lines : ['None.'])];
}

/** The day events the days played brought (docs/tech-spec.md §52), as each audit filed them. */
function dayEvents(p: PlaytestInput): string[] {
  const defs = new Map((p.content.campaign?.events?.pool ?? []).map((e) => [e.id, e]));
  const lines = p.run.ledger.flatMap((l) => {
    const e = l.event ? defs.get(l.event) : undefined;
    return e ? [`- Day ${l.day}: ${p.t(e.name)}.`] : [];
  });
  return ['### Day events', '', ...(lines.length > 0 ? lines : ['None yet.'])];
}

/**
 * The last battle (docs/tech-spec.md §54): the order the fronts were to be held in, and each front as it went: the
 * foe, who stood there, who ran, and whether it held; and under it, by name, every soul who ran from its own host and
 * the story's own souls in that host. Only once it's been fought.
 */
function battle(p: PlaytestInput): string[] {
  const b = p.run.battle;
  const def = p.content.campaign?.ragnarok;
  if (!b || !def) return [];
  const front = (id: string) => def.fronts.find((f) => f.id === id);
  const host = (id: string) => p.t(def.hosts.find((h) => h.id === id)?.name ?? id);
  const names = (souls: readonly NamedSoul[]) => souls.map((n) => `${n.name} (Day ${n.day})`).join(', ');
  const lines = b.fronts.flatMap((f) => {
    const stood = f.stood.map((s) => `${host(s.host)} ${s.souls}`).join(', ') || 'nobody';
    const ran = f.ran > 0 ? `, ${f.ran} ran` : '';
    const own = def.hosts.find((h) => h.front === f.id);
    const { runs, story } = own ? namedIn(p.run, own.hall) : { runs: [], story: [] };
    return [
      `- ${p.t(front(f.id)?.name ?? f.id)}: ${f.held ? 'held' : 'fell'}, ${f.strength} against ${f.foe} (${stood}${ran}).`,
      ...(runs.length > 0 ? [`  - Ran: ${names(runs)}.`] : []),
      ...(story.length > 0 ? [`  - The story's own in its host: ${names(story)}.`] : []),
    ];
  });
  const order = b.order.map((id) => p.t(front(id)?.name ?? id)).join(', then ');
  // Where the chooser rode (docs/tech-spec.md §58), and what that was worth there.
  const rode = b.fronts.find((f) => f.id === b.ride);
  const ride = rode ? [`Rode to ${p.t(front(rode.id)?.name ?? rode.id)}, worth ${rode.ride ?? 0} there.`] : [];
  return ['### Ragnarök', '', `Held in this order: ${order}.`, ...ride, '', ...lines];
}

/**
 * The epilogue (docs/tech-spec.md §55): once the run has ended, what it said became of everyone, by section, each
 * line with its slot, so a tester's report says which were shown.
 */
function epilogue(p: PlaytestInput): string[] {
  const lines = epilogueFor(p.run, p.content.campaign);
  if (lines.length === 0) return [];
  const params = epilogueParams(p.run);
  const out = ['### Epilogue', ''];
  for (const section of EPILOGUE_SECTIONS) {
    for (const l of lines.filter((x) => x.section === section)) {
      out.push(`- ${section}, ${l.slot.replace(/^epi\./, '')}: ${p.t(l.text, params)}`);
    }
  }
  return [...out, ''];
}

/** Promotion (docs/tech-spec.md §44): each offer and what was made of it, the days at each rank, and steps down. */
function ranks(p: PlaytestInput): string[] {
  const defs = p.content.campaign?.promotion?.ranks ?? [];
  const name = (n: number) => p.t(defs[n - 1]?.name ?? `rank ${n}`);
  const lines: string[] = [];
  let held: { rank: number; from: number; to: number } | null = null;
  const flush = () => {
    if (held) {
      const days = held.from === held.to ? `Day ${held.from}` : `Days ${held.from}–${held.to}`;
      lines.push(`- ${days}: worked as ${name(held.rank)}.`);
    }
    held = null;
  };
  for (const l of p.run.ledger) {
    if (l.offer) {
      flush();
      lines.push(`- Day ${l.day}: offered ${name(l.offer.rank)}; ${l.offer.taken ? 'taken' : 'declined'}.`);
    }
    if (l.rank && held?.rank === l.rank && held.to === l.day - 1) held.to = l.day;
    else {
      flush();
      if (l.rank) held = { rank: l.rank, from: l.day, to: l.day };
    }
    if (l.steppedDown) {
      flush();
      lines.push(`- Day ${l.day}: stepped down from ${name(l.steppedDown)}.`);
    }
  }
  flush();
  return ['### Rank', '', ...(lines.length > 0 ? lines : ['No promotion yet.'])];
}

/** Every scene played, with the options picked in it, read back by playing it again as the journal does. */
function choices(p: PlaytestInput): string[] {
  const lines = (p.save.journal ?? []).map((e) => {
    const day = p.content.days.find((d) => d.day === e.day);
    const when = day?.scenes;
    // A scene at the desk (docs/tech-spec.md §46) is played between the day's souls; a letter from home (§74), after
    // the night's or the morning's own.
    const desk = (day?.queue.visits ?? []).some((v) => v.scene === e.scene);
    const letter = (p.content.campaign?.letters ?? []).find((l) => l.day === e.day && l.scene === e.scene);
    const label =
      when?.morning === e.scene
        ? 'morning'
        : when?.night === e.scene
          ? 'night'
          : desk
            ? 'at the desk'
            : letter
              ? `${letter.at}, a letter from home`
              : e.scene;
    const json = p.scenes[e.scene];
    let picked: string[] | null = null;
    try {
      picked = json
        ? playScene(json, journalEnv(p.run.seed, e), e.choices)
            .lines.filter((l) => l.chosen)
            // As the scene words them (a spoken option carries its own quotation marks).
            .map((l) => l.text)
        : null;
    } catch {
      // A rewrite since then changed its choices.
      picked = null;
    }
    const what =
      picked === null
        ? `(the scene has changed since; options ${e.choices.map((c) => c + 1).join(', ')})`
        : picked.length > 0
          ? picked.join(' · ')
          : '(nothing to choose)';
    return `- Day ${e.day}, ${label}: ${what}`;
  });
  return ['### Choices', '', ...(lines.length > 0 ? lines : ['None yet.'])];
}

/** The report, as Markdown: it reads as plain text in the form, and as tables and lists once posted. */
export function playtestReport(p: PlaytestInput): string {
  return [
    ...header(p),
    '',
    ...days(p.run.ledger, {
      arms: campaignOf(p.content).arms !== undefined,
      nails: (campaignOf(p.content).favours ?? []).some((f) => 'nailRings' in f.effect),
      press: p.content.press !== undefined,
      vows: campaignOf(p.content).vows !== undefined,
    }),
    '',
    ...mistakes(p),
    '',
    ...(pleas(p).length > 0 ? [...pleas(p), ''] : []),
    ...(parties(p).length > 0 ? [...parties(p), ''] : []),
    ...(trail(p).length > 0 ? [...trail(p), ''] : []),
    ...appeals(p),
    '',
    ...line(p),
    '',
    ...requests(p),
    '',
    ...favours(p),
    '',
    ...home(p),
    '',
    ...dayEvents(p),
    '',
    ...ranks(p),
    '',
    ...choices(p),
    '',
    ...(p.run.battle ? [...battle(p), ''] : []),
    ...epilogue(p),
  ].join('\n');
}

export const playtestTitle = (run: RunState): string =>
  `Campaign playtest: Day ${run.day}${run.ending ? ', an ending' : ''}`;
