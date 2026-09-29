import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  AchievementSchema,
  ArchetypeSchema,
  type CampaignPart,
  CampaignPartSchema,
  CueSchema,
  DaySpecSchema,
  EndlessBoonSchema,
  EndlessTwistSchema,
  FactSchema,
  LawSchema,
  NamedPredicateSchema,
  ObservationSchema,
  PartiesSchema,
  PartyLineTemplateSchema,
  PoolsSchema,
  PressSchema,
  PressTemplateSchema,
  ProcedureSchema,
  QuestionTemplateSchema,
  RavenTemplateSchema,
  RuleSchema,
  ScriptedCaseSchema,
  SpeechSlotSchema,
  SunSchema,
  TallyTemplateSchema,
  TestimonyTemplateSchema,
  ToolSchema,
  toFactLaw,
  toSignLaw,
  WorldSchema,
} from '@cots/content-schema';
import type {
  AchievementDef,
  ArchetypeDef,
  CampaignDef,
  Content,
  CueDef,
  DaySpec,
  Destination,
  EndlessBoon,
  EndlessTwist,
  FactDef,
  FactLaw,
  NamedPredicate,
  ObservationDef,
  PartiesDef,
  PartyLineTemplate,
  Pred,
  PressDef,
  PressTemplate,
  ProcedureDef,
  QuestionTemplate,
  RavenTemplate,
  RuleDef,
  ScriptedCaseDef,
  SignLaw,
  SpeechSlotDef,
  SunCosts,
  TallyTemplate,
  TestimonyTemplate,
  ToolDef,
  Value,
  WorldConstraint,
} from '@cots/engine';
import {
  BOONS_OFFERED,
  COACH_FOCUS,
  createDayContext,
  type Effect,
  endlessOffer,
  eventDays,
  eventSoulsOn,
  factPathOk,
  isDestination,
  predPaths,
  reachOf,
  readsBattle,
  ruleDests,
  STATE_PATHS,
  type StatePred,
  scriptedCase,
  weaveDay,
  weaveSoulsOn,
  withTrail,
  wovenContent,
} from '@cots/engine';
import { z } from 'zod';

/** The gameplay content one pack defines. Every list is optional in the pack's folder. */
export interface PackContent {
  facts: FactDef[];
  observations: ObservationDef[];
  signLaws: SignLaw[];
  factLaws: FactLaw[];
  cues: CueDef[];
  world: WorldConstraint[];
  predicates: NamedPredicate[];
  rules: RuleDef[];
  tools: ToolDef[];
  archetypes: ArchetypeDef[];
  speech: SpeechSlotDef[];
  testimony: TestimonyTemplate[];
  ravens: RavenTemplate[];
  questions: QuestionTemplate[];
  pools: Record<string, string[]>;
  days: DaySpec[];
  /** The Daily Shift's spec (`daily.yaml`); only the daily pack should have one. */
  daily?: DaySpec;
  /** The primer's spec (`primer.yaml`). */
  primer?: DaySpec;
  /** This pack's part of the campaign (`campaign.yaml`). */
  campaign?: CampaignPart;
  /** Story souls (`cases/*.yaml`, one per file). */
  scripted: ScriptedCaseDef[];
  procedures: ProcedureDef[];
  tallies: TallyTemplate[];
  /** Endless's twists (`endless.yaml`). */
  twists: EndlessTwist[];
  /** Endless's boons and curses (`boons.yaml`, docs/tech-spec.md §68); the campaign pack has them. */
  boons: EndlessBoon[];
  /** What can be earned (`achievements.yaml`). */
  achievements: AchievementDef[];
  /** What the sun costs besides the tools (`sun.yaml`); the core pack has it. */
  sun?: SunCosts;
  /** Pressing a soul on what it said (`press.yaml`, docs/tech-spec.md §66); the core pack has it. */
  press?: PressDef;
  /** What pressed souls say (`templates/press.yaml`). */
  pressLines: PressTemplate[];
  /** Souls who come to the desk together (`parties.yaml`, docs/tech-spec.md §69); the campaign pack has them. */
  parties?: PartiesDef;
  /** What they say of each other (`templates/party.yaml`). */
  partyLines: PartyLineTemplate[];
}

type Parse = <T>(schema: z.ZodType<T, unknown>, value: unknown, file: string) => T;
type ReadYaml = (file: string) => unknown;

export function loadPackContent(dir: string, readYaml: ReadYaml, parse: Parse): PackContent {
  const list = <T>(file: string, schema: z.ZodType<T, unknown>): T[] => {
    const path = join(dir, file);
    return existsSync(path) ? parse(z.array(schema), readYaml(path) ?? [], path) : [];
  };
  const laws = list('laws.yaml', LawSchema);
  const poolsFile = join(dir, 'pools.yaml');
  const dailyFile = join(dir, 'daily.yaml');
  const primerFile = join(dir, 'primer.yaml');
  const campaignFile = join(dir, 'campaign.yaml');
  const sunFile = join(dir, 'sun.yaml');
  const pressFile = join(dir, 'press.yaml');
  const partiesFile = join(dir, 'parties.yaml');
  const each = <T>(sub: string, schema: z.ZodType<T, unknown>): T[] => {
    const folder = join(dir, sub);
    return existsSync(folder)
      ? readdirSync(folder)
          .filter((f) => f.endsWith('.yaml'))
          .sort()
          .map((f) => parse(schema, readYaml(join(folder, f)), join(folder, f)))
      : [];
  };
  const days = each('days', DaySpecSchema);
  return {
    facts: list('facts.yaml', FactSchema),
    observations: list('observations.yaml', ObservationSchema),
    signLaws: laws.flatMap((l) => (l.kind === 'sign' ? [toSignLaw(l)] : [])),
    factLaws: laws.flatMap((l) => (l.kind === 'fact' ? [toFactLaw(l)] : [])),
    cues: list('cues.yaml', CueSchema),
    world: list('world.yaml', WorldSchema),
    predicates: list('predicates.yaml', NamedPredicateSchema),
    rules: list('rules.yaml', RuleSchema),
    tools: list('tools.yaml', ToolSchema),
    archetypes: list('archetypes.yaml', ArchetypeSchema),
    speech: list('speech.yaml', SpeechSlotSchema),
    testimony: list('templates/testimony.yaml', TestimonyTemplateSchema),
    ravens: list('templates/ravens.yaml', RavenTemplateSchema),
    questions: list('templates/questions.yaml', QuestionTemplateSchema),
    pressLines: list('templates/press.yaml', PressTemplateSchema),
    partyLines: list('templates/party.yaml', PartyLineTemplateSchema),
    pools: existsSync(poolsFile) ? parse(PoolsSchema, readYaml(poolsFile) ?? {}, poolsFile) : {},
    days,
    scripted: each('cases', ScriptedCaseSchema),
    procedures: list('procedures.yaml', ProcedureSchema),
    tallies: list('templates/tallies.yaml', TallyTemplateSchema),
    twists: list('endless.yaml', EndlessTwistSchema),
    boons: list('boons.yaml', EndlessBoonSchema),
    achievements: list('achievements.yaml', AchievementSchema),
    ...(existsSync(dailyFile) ? { daily: parse(DaySpecSchema, readYaml(dailyFile), dailyFile) } : {}),
    ...(existsSync(primerFile) ? { primer: parse(DaySpecSchema, readYaml(primerFile), primerFile) } : {}),
    ...(existsSync(campaignFile) ? { campaign: parse(CampaignPartSchema, readYaml(campaignFile), campaignFile) } : {}),
    ...(existsSync(sunFile) ? { sun: parse(SunSchema, readYaml(sunFile), sunFile) } : {}),
    ...(existsSync(pressFile) ? { press: parse(PressSchema, readYaml(pressFile), pressFile) } : {}),
    ...(existsSync(partiesFile) ? { parties: parse(PartiesSchema, readYaml(partiesFile), partiesFile) } : {}),
  };
}

const wildcards = (r: { expected: string; stamped: string }) =>
  (r.expected === '*' ? 1 : 0) + (r.stamped === '*' ? 1 : 0);

/**
 * Merges the packs' campaign parts in dependency order: later packs override
 * the single values and add to the lists. Standing rows are sorted so specific
 * rows are tried before wildcard ones.
 */
export function mergeCampaign(parts: readonly CampaignPart[]): CampaignDef | undefined {
  if (parts.length === 0) return undefined;
  const last = <K extends keyof CampaignPart>(k: K): CampaignPart[K] => {
    for (let i = parts.length - 1; i >= 0; i--) if (parts[i]?.[k] !== undefined) return parts[i]?.[k];
    return undefined;
  };
  const all = <K extends 'standing' | 'shop' | 'endings' | 'aliases' | 'threads' | 'favours'>(k: K) =>
    parts.flatMap((p) => (p[k] ?? []) as NonNullable<CampaignPart[K]>[number][]);
  const required = [
    'lastDay',
    'finale',
    'startRings',
    'family',
    'draupnir',
    'debtFloor',
    'minSunS',
    'care',
    'worthy',
  ] as const;
  const missing = required.filter((k) => last(k) === undefined);
  if (missing.length > 0) throw new Error(`The campaign is missing ${missing.join(', ')} (campaign.yaml).`);
  return {
    lastDay: last('lastDay') as number,
    finale: last('finale') as string,
    startRings: last('startRings') as number,
    family: last('family') as CampaignDef['family'],
    draupnir: last('draupnir') as CampaignDef['draupnir'],
    debtFloor: last('debtFloor') as number,
    minSunS: last('minSunS') as number,
    care: last('care') as CampaignDef['care'],
    worthy: last('worthy') as string,
    ...(last('slice') ? { slice: last('slice') as NonNullable<CampaignDef['slice']> } : {}),
    standing: all('standing')
      .map((r, i) => ({ r, i }))
      .sort((a, b) => wildcards(a.r) - wildcards(b.r) || a.i - b.i)
      .map((x) => x.r),
    shop: all('shop'),
    endings: all('endings'),
    ...(all('aliases').length > 0 ? { aliases: all('aliases') } : {}),
    ...(all('threads').length > 0 ? { threads: all('threads') } : {}),
    ...(last('appeals') ? { appeals: last('appeals') as NonNullable<CampaignDef['appeals']> } : {}),
    ...(last('waiting') ? { waiting: last('waiting') as NonNullable<CampaignDef['waiting']> } : {}),
    ...(last('requests') ? { requests: last('requests') as NonNullable<CampaignDef['requests']> } : {}),
    ...(last('pleas') ? { pleas: last('pleas') as NonNullable<CampaignDef['pleas']> } : {}),
    ...(last('kin') ? { kin: last('kin') as NonNullable<CampaignDef['kin']> } : {}),
    ...(all('favours').length > 0 ? { favours: all('favours') } : {}),
    ...(last('promotion') ? { promotion: last('promotion') as NonNullable<CampaignDef['promotion']> } : {}),
    ...(last('events') ? { events: last('events') as NonNullable<CampaignDef['events']> } : {}),
    ...(last('weaving') ? { weaving: last('weaving') as NonNullable<CampaignDef['weaving']> } : {}),
    ...(last('ragnarok') ? { ragnarok: last('ragnarok') as NonNullable<CampaignDef['ragnarok']> } : {}),
    ...(last('epilogue') ? { epilogue: last('epilogue') as NonNullable<CampaignDef['epilogue']> } : {}),
    ...(last('arms') ? { arms: last('arms') as NonNullable<CampaignDef['arms']> } : {}),
    ...(last('sellBack') !== undefined ? { sellBack: last('sellBack') as number } : {}),
    ...(last('reprieve') ? { reprieve: last('reprieve') as NonNullable<CampaignDef['reprieve']> } : {}),
    ...(last('trail') ? { trail: last('trail') as NonNullable<CampaignDef['trail']> } : {}),
  };
}

export function emptyPackContent(): PackContent {
  return {
    facts: [],
    observations: [],
    signLaws: [],
    factLaws: [],
    cues: [],
    world: [],
    predicates: [],
    rules: [],
    tools: [],
    archetypes: [],
    speech: [],
    testimony: [],
    ravens: [],
    questions: [],
    pressLines: [],
    partyLines: [],
    pools: {},
    days: [],
    scripted: [],
    procedures: [],
    tallies: [],
    twists: [],
    boons: [],
    achievements: [],
  };
}

/** Merges packs in dependency order into one engine Content. */
export function mergeContent(parts: readonly PackContent[], genVersion: number): Content {
  const cat = <K extends Exclude<keyof PackContent, 'pools' | 'daily' | 'primer' | 'sun' | 'press' | 'parties'>>(
    k: K,
  ): PackContent[K] => parts.flatMap((p) => p[k] as unknown[]) as PackContent[K];
  const one = (k: 'daily' | 'primer'): DaySpec | undefined => {
    const specs = parts.flatMap((p) => (p[k] ? [p[k]] : []));
    if (specs.length > 1) throw new Error(`Only one pack may define ${k}.yaml.`);
    return specs[0];
  };
  const daily = one('daily');
  const primer = one('primer');
  // What the sun costs besides the tools: one pack says, the core one (docs/tech-spec.md §63).
  const suns = parts.flatMap((p) => (p.sun ? [p.sun] : []));
  if (suns.length > 1) throw new Error('Only one pack may define sun.yaml.');
  const sun = suns[0];
  if (!sun) throw new Error('No pack defines sun.yaml (the core pack should).');
  // Pressing a soul (docs/tech-spec.md §66): one pack says, the core one.
  const presses = parts.flatMap((p) => (p.press ? [p.press] : []));
  if (presses.length > 1) throw new Error('Only one pack may define press.yaml.');
  const press = presses[0];
  const pressLines = cat('pressLines');
  // Parties (docs/tech-spec.md §69): one pack says, the campaign one.
  const partyDefs = parts.flatMap((p) => (p.parties ? [p.parties] : []));
  if (partyDefs.length > 1) throw new Error('Only one pack may define parties.yaml.');
  const parties = partyDefs[0];
  const partyLines = cat('partyLines');
  const campaign = mergeCampaign(parts.flatMap((p) => (p.campaign ? [p.campaign] : [])));
  const scripted = cat('scripted');
  const procedures = cat('procedures');
  const tallies = cat('tallies');
  const twists = cat('twists');
  // Endless's boons and curses (docs/tech-spec.md §68): one pack says, the campaign one.
  if (parts.filter((p) => p.boons.length > 0).length > 1) throw new Error('Only one pack may define boons.yaml.');
  const boons = cat('boons');
  const achievements = cat('achievements');
  return {
    genVersion,
    sun,
    facts: cat('facts'),
    observations: cat('observations'),
    signLaws: cat('signLaws'),
    factLaws: cat('factLaws'),
    cues: cat('cues'),
    world: cat('world'),
    predicates: cat('predicates'),
    rules: cat('rules'),
    tools: cat('tools'),
    archetypes: cat('archetypes'),
    speech: cat('speech'),
    testimony: cat('testimony'),
    ravens: cat('ravens'),
    questions: cat('questions'),
    pools: Object.assign({}, ...parts.map((p) => p.pools)),
    days: cat('days').sort((a, b) => a.day - b.day),
    ...(daily ? { daily } : {}),
    ...(primer ? { primer } : {}),
    ...(campaign ? { campaign } : {}),
    ...(scripted.length > 0 ? { scripted } : {}),
    ...(procedures.length > 0 ? { procedures } : {}),
    ...(tallies.length > 0 ? { tallies } : {}),
    ...(twists.length > 0 ? { twists } : {}),
    ...(boons.length > 0 ? { boons } : {}),
    ...(achievements.length > 0 ? { achievements } : {}),
    ...(press ? { press } : {}),
    ...(pressLines.length > 0 ? { pressLines } : {}),
    ...(parties ? { parties } : {}),
    ...(partyLines.length > 0 ? { partyLines } : {}),
  };
}

/** Ids a pack owns; used for leak tokens so demo builds can prove they don't contain campaign items. */
export function idsOf(c: PackContent): string[] {
  return [
    ...c.facts.map((x) => x.id),
    ...c.signLaws.map((x) => x.id),
    ...c.factLaws.map((x) => x.id),
    ...c.world.map((x) => x.id),
    ...c.predicates.map((x) => x.id),
    ...c.rules.map((x) => x.id),
    ...c.archetypes.map((x) => x.id),
    ...c.testimony.map((x) => x.id),
    ...c.ravens.map((x) => x.id),
    ...c.questions.map((x) => x.id),
    ...c.pressLines.map((x) => x.id),
    ...c.partyLines.map((x) => x.id),
    ...(c.parties?.kinds ?? []).map((x) => x.id),
    ...c.twists.map((x) => x.id),
    ...c.boons.map((x) => x.id),
    ...Object.keys(c.pools),
    ...Object.values(c.daily?.params ?? {}).flatMap((p) => p.pool.map((x) => x.id)),
    ...Object.values(c.primer?.params ?? {}).flatMap((p) => p.pool.map((x) => x.id)),
    ...(c.campaign?.shop ?? []).map((u) => u.id),
    ...(c.campaign?.endings ?? []).map((e) => e.id),
    ...c.scripted.map((x) => x.id),
    ...c.procedures.map((x) => x.id),
    ...c.tallies.map((x) => x.id),
    ...c.achievements.map((x) => x.id),
    ...c.days.flatMap((d) => Object.values(d.params ?? {}).flatMap((p) => p.pool.map((x) => x.id))),
  ];
}

/** A fact's values as strings, the way `words` and speech `chances` name them. */
function valuesOf(f: FactDef): string[] {
  const d = f.domain;
  if (d.kind === 'enum') return d.values.map(String);
  if (d.kind === 'bool') return ['false', 'true'];
  return Array.from({ length: d.max - d.min + 1 }, (_, i) => String(d.min + i));
}

function walkPred(p: Pred, visit: (p: Pred) => void): void {
  visit(p);
  if ('all' in p) for (const q of p.all) walkPred(q, visit);
  else if ('any' in p) for (const q of p.any) walkPred(q, visit);
  else if ('not' in p) walkPred(p.not, visit);
}

/** Cross-reference checks for one target's merged content (docs/tech-spec.md §10). */
export function lintContent(content: Content, strings: Readonly<Record<string, string>>): string[] {
  const problems: string[] = [];
  const dupes = (what: string, ids: readonly (string | number)[]): void => {
    const seen = new Set<string | number>();
    for (const id of ids) {
      if (seen.has(id)) problems.push(`Duplicate ${what} "${id}".`);
      seen.add(id);
    }
  };
  dupes(
    'fact',
    content.facts.map((f) => f.id),
  );
  dupes(
    'observation',
    content.observations.map((o) => o.key),
  );
  dupes(
    'law',
    [...content.signLaws, ...content.factLaws].map((l) => l.id),
  );
  dupes(
    'cue',
    content.cues.map((c) => c.key),
  );
  dupes(
    'world constraint',
    content.world.map((w) => w.id),
  );
  dupes(
    'predicate',
    content.predicates.map((p) => p.id),
  );
  dupes(
    'rule',
    content.rules.map((r) => r.id),
  );
  dupes(
    'tool',
    content.tools.map((t) => t.id),
  );
  dupes(
    'archetype',
    content.archetypes.map((a) => a.id),
  );
  dupes(
    'template',
    [...content.testimony, ...content.ravens, ...content.questions, ...(content.pressLines ?? [])].map((t) => t.id),
  );
  dupes(
    'day',
    content.days.map((d) => d.day),
  );

  const facts = new Set(content.facts.map((f) => f.id));
  const obsKeys = new Set(content.observations.map((o) => o.key));
  const preds = new Set(content.predicates.map((p) => p.id));
  const fact = (id: string, where: string): void => {
    if (!facts.has(id)) problems.push(`${where} refers to unknown fact "${id}".`);
  };
  const pred = (p: Pred, where: string): void =>
    walkPred(p, (q) => {
      if ('fact' in q) fact(q.fact, where);
      if ('ref' in q && !preds.has(q.ref)) problems.push(`${where} refers to unknown predicate "${q.ref}".`);
    });
  const key = (k: string, where: string): void => {
    if (!(k in strings)) problems.push(`${where} uses missing string "${k}".`);
  };

  for (const f of content.facts) if (f.derived) pred(f.derived, `fact ${f.id}`);
  for (const o of content.observations) {
    if ('fact' in o.from) fact(o.from.fact, `observation ${o.key}`);
    else for (const m of o.from.map) pred(m.when, `observation ${o.key}`);
    if (o.when) pred(o.when, `observation ${o.key}`);
  }
  for (const l of content.signLaws) {
    const walkObs = (p: (typeof l)['if']): void => {
      if ('all' in p) for (const q of p.all) walkObs(q);
      else if (!obsKeys.has(p.obs)) problems.push(`law ${l.id} reads unknown observation "${p.obs}".`);
    };
    walkObs(l.if);
    fact(l.then.fact, `law ${l.id}`);
    key(l.text, `law ${l.id}`);
  }
  for (const l of content.factLaws) {
    pred(l.if, `law ${l.id}`);
    fact(l.then.fact, `law ${l.id}`);
    key(l.text, `law ${l.id}`);
  }
  for (const c of content.cues) {
    if ('fact' in c.hint) fact(c.hint.fact, `cue ${c.key}`);
    key(`cue.${c.key}`, `cue ${c.key}`);
  }
  // The shift UI shows every sign as a text chip: `obs.<key>.<value>`, or `obs.<key>` with an {n} plural.
  const factById = new Map(content.facts.map((f) => [f.id, f]));
  for (const o of content.observations) {
    const values =
      'map' in o.from
        ? [...o.from.map.map((m) => m.value), o.from.otherwise]
        : (() => {
            const d = factById.get(o.from.fact)?.domain;
            return d?.kind === 'enum' ? d.values : d?.kind === 'bool' ? [false, true] : null;
          })();
    if (values === null) key(`obs.${o.key}`, `observation ${o.key}`);
    else for (const v of values) key(`obs.${o.key}.${String(v)}`, `observation ${o.key}`);
  }
  for (const tool of content.tools) key(`tool.${tool.id}`, `tool ${tool.id}`);
  for (const d of new Set(content.rules.flatMap((r) => ruleDests(r, content.facts))))
    key(`dest.${d}`, `destination ${d}`);
  // A rule whose hall a fact names (docs/tech-spec.md §70): a fact only a party sets, naming halls or nothing.
  for (const r of content.rules) {
    if (typeof r.then === 'string') continue;
    const fd = factById.get(r.then.fact);
    if (!fd) problems.push(`rule ${r.id} sends souls where unknown fact "${r.then.fact}" says.`);
    else if (!fd.fromParty) problems.push(`rule ${r.id} sends souls where ${fd.id} says, which no party sets.`);
    else if (
      fd.domain.kind !== 'enum' ||
      isDestination(fd.inert) ||
      fd.domain.values.some((v) => v !== fd.inert && !isDestination(v))
    )
      problems.push(`rule ${r.id} reads ${fd.id}, whose values must be halls, and its inert value none.`);
  }
  for (const w of content.world) {
    pred(w.if, `world ${w.id}`);
    pred(w.then, `world ${w.id}`);
  }
  for (const p of content.predicates) for (const v of p.versions) pred(v.is, `predicate ${p.id}`);
  for (const r of content.rules) {
    pred(r.when, `rule ${r.id}`);
    key(r.text, `rule ${r.id}`);
    let since = r.since;
    for (const later of r.texts ?? []) {
      key(later.text, `rule ${r.id}'s wording from day ${later.since}`);
      if (later.since <= since)
        problems.push(`rule ${r.id}'s later wordings must come in day order, after day ${since}.`);
      since = later.since;
    }
  }
  for (const s of content.speech) {
    if (s.fact) fact(s.fact, `speech slot ${s.slot}`);
    const def = content.facts.find((f) => f.id === s.fact);
    for (const value of Object.keys(s.chances ?? {})) {
      if (!def) problems.push(`speech slot ${s.slot} has chances by value but no fact.`);
      else if (!valuesOf(def).includes(value))
        problems.push(`speech slot ${s.slot} has a chance for "${value}", which ${def.id} can't be.`);
    }
  }
  dupes(
    'procedure',
    (content.procedures ?? []).map((p) => p.id),
  );
  for (const p of content.procedures ?? []) {
    pred(p.when, `procedure ${p.id}`);
    key(p.text, `procedure ${p.id}`);
    key(`${p.text}.short`, `procedure ${p.id}`);
    const tool = content.tools.find((x) => x.id === p.tool);
    if (!tool) problems.push(`procedure ${p.id} is done with a tool this build doesn't have.`);
    else if (tool.since > p.since) problems.push(`procedure ${p.id} starts before its tool does.`);
  }

  const pools = new Set(Object.keys(content.pools));
  dupes(
    'tally line',
    (content.tallies ?? []).map((t) => t.id),
  );
  const templates = [...content.testimony, ...content.ravens, ...(content.tallies ?? [])];
  for (const t of templates) {
    if (t.asserts) fact(t.asserts.fact, `template ${t.id}`);
    key(t.msg, `template ${t.id}`);
    for (const pool of Object.values(t.params ?? {})) {
      if (!pools.has(pool)) problems.push(`template ${t.id} uses unknown pool "${pool}".`);
    }
  }
  // Words a fact, an archetype or a story soul fixes for its lines: each from a pool that has it.
  const fixes = (owner: string, words: Readonly<Record<string, string>> | undefined) => {
    for (const [pool, word] of Object.entries(words ?? {})) {
      if (!pools.has(pool)) problems.push(`${owner} fixes a word from unknown pool "${pool}".`);
      else if (!content.pools[pool]?.includes(word))
        problems.push(`${owner} fixes "${word}", which ${pool} doesn't have.`);
    }
  };
  for (const f of content.facts) {
    for (const [value, words] of Object.entries(f.words ?? {})) {
      if (!valuesOf(f).includes(value)) problems.push(`fact ${f.id} has words for "${value}", which it can't be.`);
      fixes(`fact ${f.id}`, words);
    }
  }
  for (const s of content.scripted ?? []) fixes(`story soul ${s.id}`, s.words);
  for (const q of content.questions) {
    if (q.on.fact !== '*') fact(q.on.fact, `template ${q.id}`);
    for (const m of q.msgs) key(m, `template ${q.id}`);
  }

  const archetypes = new Map(content.archetypes.map((a) => [a.id, a]));
  const kindsUsed = new Set<string>();
  for (const a of content.archetypes) {
    for (const f of Object.keys(a.truth)) fact(f, `archetype ${a.id}`);
    for (const p of a.require ?? []) pred(p, `archetype ${a.id}`);
    fixes(`archetype ${a.id}`, a.words);
    for (const lie of a.lies) {
      fact(lie.fact, `archetype ${a.id}`);
      for (const [k, w] of Object.entries(lie.onQuestion)) if ((w ?? 0) > 0) kindsUsed.add(k);
      const speakable =
        lie.via === 'tally'
          ? (content.tallies ?? []).some((t) => t.asserts.fact === lie.fact && t.asserts.value === lie.claim)
          : content.testimony.some(
              (t) =>
                t.asserts?.fact === lie.fact &&
                t.asserts.value === lie.claim &&
                (t.personas === undefined || t.personas.some((p) => a.personas.includes(p))),
            );
      if (!speakable) {
        const how = lie.via === 'tally' ? 'carve' : 'voice';
        problems.push(`archetype ${a.id} can't ${how} its lie ${lie.fact}=${String(lie.claim)}.`);
      }
    }
  }
  for (const k of kindsUsed) {
    const fallback = content.questions.some(
      (q) => q.on.kind === k && q.on.fact === '*' && !q.on.claimed && !q.on.truth && !q.on.persona && !q.on.about,
    );
    if (!fallback) problems.push(`No fallback question template for "${k}" answers.`);
  }

  if (content.campaign) problems.push(...lintCampaign(content, strings));
  problems.push(...lintScripted(content, strings));
  problems.push(...lintLessons(content, strings));
  problems.push(...lintTwists(content, strings));
  problems.push(...lintBoons(content, strings));
  problems.push(...lintAchievements(content, strings));
  problems.push(...lintPress(content, strings));
  problems.push(...lintParties(content, strings));

  const specs = content.days.map((d) => ({ d, name: `day ${d.day}` }));
  if (content.daily) specs.push({ d: content.daily, name: `the Daily (day ${content.daily.day} mechanics)` });
  if (content.primer) specs.push({ d: content.primer, name: `the primer (day ${content.primer.day} mechanics)` });
  for (const { d, name } of specs) {
    key(d.decree, name);
    for (const [param, def] of Object.entries(d.params ?? {})) {
      for (const choice of def.pool) {
        pred(choice.is, `${name} param ${param}`);
        key(choice.text, `${name} param ${param}`);
      }
    }
    for (const { id } of d.queue.archetypes) {
      if (!archetypes.has(id)) problems.push(`${name} uses unknown archetype "${id}".`);
    }
    const teach = d.queue.teachFirst;
    if (teach && !d.queue.archetypes.some((a) => a.id === teach)) {
      problems.push(`${name} teaches with "${teach}", which isn't in its queue.`);
    }
    for (const slot of d.queue.script ?? []) {
      if (!d.queue.archetypes.some((a) => a.id === slot.id)) {
        problems.push(`${name} scripts "${slot.id}", which isn't in its queue.`);
      }
      if (
        !content.rules.some(
          (r) =>
            ruleDests(r, content.facts).includes(slot.dest) &&
            r.since <= d.day &&
            (r.until === undefined || d.day < r.until),
        )
      ) {
        problems.push(`${name} scripts a ${slot.dest} soul, but no rule in force sends anyone there.`);
      }
    }
    const inForce = content.rules
      .filter((r) => r.since <= d.day && (r.until === undefined || d.day < r.until))
      .sort((a, b) => a.order - b.order);
    const last = inForce[inForce.length - 1];
    if (!last || !('always' in last.when)) problems.push(`${name}: the last rule in force must always apply.`);
    const noon = d.noon;
    if (noon) {
      // A noon decree (docs/tech-spec.md §45): news before the change, a change within the shortest line.
      if (d === content.daily || d === content.primer) {
        problems.push(`${name} has a noon decree; only campaign days do.`);
      }
      key(noon.text, `${name} noon decree`);
      if (noon.notice >= noon.at) problems.push(`${name}: the noon raven must come after the first soul.`);
      if (noon.at >= d.queue.count[0]) problems.push(`${name}: noon must come before the end of the shortest line.`);
      for (const param of noon.redraw) {
        if ((d.params?.[param]?.pool.length ?? 0) < 2) {
          problems.push(`${name}: noon draws "${param}" again, which has no other choice to draw.`);
        }
      }
      if (noon.teach && !d.queue.archetypes.some((a) => a.id === noon.teach)) {
        problems.push(`${name}: noon teaches with "${noon.teach}", which isn't in its queue.`);
      }
    }
  }
  return problems;
}

/**
 * Endless's twists (docs/tech-spec.md §27): a decree the build has, a day they can start on, and shares
 * only of destinations some rule sends souls to by that day. The tests generate every twist on every day
 * it can come.
 */
function lintTwists(content: Content, strings: Readonly<Record<string, string>>): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  const lastDay = Math.max(0, ...content.days.map((d) => d.day));
  for (const tw of content.twists ?? []) {
    const where = `Endless twist ${tw.id}`;
    if (ids.has(tw.id)) problems.push(`Duplicate Endless twist "${tw.id}".`);
    ids.add(tw.id);
    if (!(tw.decree in strings)) problems.push(`${where} uses missing string "${tw.decree}".`);
    if (tw.since > lastDay) problems.push(`${where} starts on day ${tw.since}, after the build's last day.`);
    for (const [dest, range] of Object.entries(tw.mix ?? {})) {
      if (
        !content.rules.some((r) => ruleDests(r, content.facts).includes(dest as Destination) && r.since <= tw.since)
      ) {
        problems.push(`${where} asks for ${dest} souls, which no rule sends anywhere by day ${tw.since}.`);
      }
      if (range && range[0] > range[1]) problems.push(`${where} has an empty share for ${dest}.`);
    }
  }
  return problems;
}

/** Whether an effect helps (a boon's) or hinders (a curse's). */
function helps(e: EndlessBoon['effect']): boolean {
  if ('strikes' in e) return e.strikes > 0;
  if ('toolPct' in e) return e.toolPct < 100;
  return !('sun' in e || 'sunCut' in e || 'oath' in e);
}

/** Effects that mean nothing without a sun: a boon or curse with one comes only once the run has taken the sun. */
const sunOnly = (e: EndlessBoon['effect']): boolean =>
  'sunS' in e || 'toolPct' in e || 'freeQuestions' in e || 'sunCut' in e;

/**
 * Endless's boons and curses (docs/tech-spec.md §68): their strings, a day they can come on, boons that help and
 * curses that hinder, sun effects only once there's a sun, presses and tools only from the day they're taught, and a
 * first break with three boons and a curse to choose from.
 */
function lintBoons(content: Content, strings: Readonly<Record<string, string>>): string[] {
  const problems: string[] = [];
  const boons = content.boons ?? [];
  if (boons.length === 0) return problems;
  const ids = new Set<string>();
  const lastDay = Math.max(0, ...content.days.map((d) => d.day));
  const sunCurse = boons.some((b) => b.kind === 'curse' && 'sun' in b.effect);
  const firstTool = Math.min(...content.tools.map((t) => t.since));
  for (const b of boons) {
    const where = `Endless ${b.kind} ${b.id}`;
    if (ids.has(b.id)) problems.push(`Duplicate Endless boon or curse "${b.id}".`);
    ids.add(b.id);
    for (const k of [b.name, b.text]) if (!(k in strings)) problems.push(`${where} uses missing string "${k}".`);
    if (b.since > lastDay) problems.push(`${where} starts on day ${b.since}, after the build's last day.`);
    const e = b.effect;
    if (helps(e) !== (b.kind === 'boon')) {
      problems.push(`${where} ${b.kind === 'boon' ? 'hinders' : 'helps'}: a boon must help and a curse hinder.`);
    }
    if (sunOnly(e) && b.needs !== 'sun') problems.push(`${where} changes the sun, so it needs the sun.`);
    if (b.needs === 'sun' && !sunCurse) problems.push(`${where} needs the sun, and no curse brings it.`);
    if ('patience' in e && (!content.press || b.since < content.press.since)) {
      problems.push(`${where} adds presses before souls are pressed.`);
    }
    if ('toolPct' in e && b.since < firstTool) problems.push(`${where} changes the tools' costs before any tool.`);
  }
  const first = endlessOffer(content, 'lint', 1, [], 0);
  if ((first?.boons.length ?? 0) < BOONS_OFFERED)
    problems.push(`The first break offers fewer than ${BOONS_OFFERED} boons.`);
  if (!first?.curse) problems.push('The first break offers no curse.');
  return problems;
}

/**
 * Pressing a soul (docs/tech-spec.md §66): odds for every way a soul can talk, details about facts that can be told
 * apart, a line for each, a hold line for any claim, and the strings they say.
 */
function lintPress(content: Content, strings: Readonly<Record<string, string>>): string[] {
  const problems: string[] = [];
  const press = content.press;
  const lines = content.pressLines ?? [];
  if (!press) {
    if (lines.length > 0) problems.push('Press lines with no press.yaml to say them.');
    return problems;
  }
  const facts = new Map(content.facts.map((f) => [f.id, f]));
  for (const p of new Set(content.archetypes.flatMap((a) => a.personas))) {
    if (press.gives[p] === undefined) problems.push(`press.yaml gives no odds for a ${p} soul giving way.`);
  }
  const can = (fact: string, value: Value, where: string): boolean => {
    const f = facts.get(fact);
    if (!f) problems.push(`${where} refers to unknown fact "${fact}".`);
    else if (!valuesOf(f).includes(String(value)))
      problems.push(`${where} says ${fact} is ${String(value)}, which it can't be.`);
    return f !== undefined;
  };
  press.details.forEach((d, i) => {
    const where = `press.yaml detail ${i + 1}`;
    can(d.on.fact, d.on.claimed, where);
    if (!can(d.says.fact, d.says.value, where)) return;
    if (d.says.fact === d.on.fact) problems.push(`${where} adds to what it says of ${d.on.fact} with ${d.on.fact}.`);
    if (facts.get(d.says.fact)?.derived) problems.push(`${where} adds a derived fact (${d.says.fact}).`);
    const said = lines.some(
      (t) => t.on.kind === 'detail' && t.on.fact === d.says.fact && (t.on.value ?? d.says.value) === d.says.value,
    );
    if (!said) problems.push(`${where} has no line to say ${d.says.fact} is ${String(d.says.value)} with.`);
  });
  if (!lines.some((t) => t.on.kind === 'hold' && t.on.fact === '*' && t.on.value === undefined && !t.on.persona)) {
    problems.push('No fallback press line for a soul holding to any claim.');
  }
  for (const t of lines) {
    const where = `press line ${t.id}`;
    if (t.on.fact !== '*') {
      if (t.on.value !== undefined) can(t.on.fact, t.on.value, where);
      else if (!facts.has(t.on.fact)) problems.push(`${where} refers to unknown fact "${t.on.fact}".`);
    }
    if (t.on.kind === 'detail' && (t.on.fact === '*' || t.msgs.length !== 1)) {
      problems.push(`${where} adds to a claim, so it says one line about one fact.`);
    }
    for (const m of t.msgs) if (!(m in strings)) problems.push(`${where} uses missing string "${m}".`);
  }
  return problems;
}

/**
 * Parties (docs/tech-spec.md §69): kinds with the strings, pools and facts the build has; a line any soul can say for
 * every value each claim can take; answers for a soul caught lying about a companion; days that form parties only once a
 * kind comes, and never the Daily.
 */
function lintParties(content: Content, strings: Readonly<Record<string, string>>): string[] {
  const problems: string[] = [];
  const def = content.parties;
  const lines = content.partyLines ?? [];
  const forming = content.days.filter((d) => d.queue.parties);
  if (content.daily?.queue.parties) problems.push('The Daily forms parties; it never should.');
  if (!def) {
    if (lines.length > 0) problems.push('Party lines with no parties.yaml to say them.');
    for (const d of forming) problems.push(`Day ${d.day} forms parties, and there's no parties.yaml.`);
    return problems;
  }
  const facts = new Map(content.facts.map((f) => [f.id, f]));
  const kinds = new Set<string>();
  for (const k of def.kinds) {
    const where = `party kind ${k.id}`;
    if (kinds.has(k.id)) problems.push(`Duplicate party kind "${k.id}".`);
    kinds.add(k.id);
    if (!(k.title in strings)) problems.push(`${where} uses missing string "${k.title}".`);
    for (const pool of Object.values(k.words)) {
      if (!(pool in content.pools)) problems.push(`${where} shares words from unknown pool "${pool}".`);
    }
    if (k.size[0] > k.size[1]) problems.push(`${where} has a size range that runs backwards.`);
    for (const f of Object.keys(k.members)) {
      if (!facts.has(f)) problems.push(`${where}'s members refer to unknown fact "${f}".`);
    }
    // A retinue (docs/tech-spec.md §70): its men follow the jarl by a fact only a party sets, which a rule reads.
    if (k.lord !== undefined) {
      const fd = facts.get(k.lord);
      const reads = content.rules.filter((r) => typeof r.then !== 'string' && r.then.fact === k.lord);
      if (!fd?.fromParty)
        problems.push(`${where}'s men follow their jarl by "${k.lord}", which isn't a fact a party sets.`);
      else if (reads.length === 0)
        problems.push(`${where}'s men follow their jarl by ${k.lord}, and no rule reads it.`);
      else if (!reads.some((r) => r.since <= k.since))
        problems.push(`${where} comes on day ${k.since}, before the rule that reads ${k.lord}.`);
    }
    for (const f of k.claims) {
      const fd = facts.get(f);
      if (!fd) {
        problems.push(`${where} speaks of unknown fact "${f}".`);
        continue;
      }
      // In a retinue, of its jarl and of his men alike (docs/tech-spec.md §70).
      for (const of of k.lord === undefined ? [undefined] : (['lord', 'sworn'] as const)) {
        for (const v of valuesOf(fd)) {
          const said = lines.some(
            (t) =>
              t.asserts.fact === f &&
              String(t.asserts.value) === v &&
              (t.kinds === undefined || t.kinds.includes(k.id)) &&
              (t.of === undefined || t.of === of) &&
              t.personas === undefined,
          );
          const whom = of === 'lord' ? 'its jarl' : of === 'sworn' ? 'one of his men' : 'a companion';
          if (!said) problems.push(`${where} has no line any soul can say that ${whom}'s ${f} is ${v}.`);
        }
      }
    }
  }
  const templates = new Set<string>();
  for (const t of lines) {
    const where = `party line ${t.id}`;
    if (templates.has(t.id)) problems.push(`Duplicate party line "${t.id}".`);
    templates.add(t.id);
    const fd = facts.get(t.asserts.fact);
    if (!fd) problems.push(`${where} refers to unknown fact "${t.asserts.fact}".`);
    else if (!valuesOf(fd).includes(String(t.asserts.value)))
      problems.push(`${where} says ${t.asserts.fact} is ${String(t.asserts.value)}, which it can't be.`);
    for (const k of t.kinds ?? []) if (!kinds.has(k)) problems.push(`${where} is for unknown party kind "${k}".`);
    if (t.of !== undefined && !(t.kinds ?? []).some((k) => def.kinds.find((x) => x.id === k)?.lord !== undefined))
      problems.push(`${where} is said of a jarl or his men, in no kind of party that has them.`);
    if (!(t.msg in strings)) problems.push(`${where} uses missing string "${t.msg}".`);
  }
  for (const [kind, w] of Object.entries(def.onQuestion)) {
    if ((w ?? 0) === 0) continue;
    const fallback = content.questions.some(
      (q) => q.on.about && q.on.kind === kind && q.on.fact === '*' && !q.on.claimed && !q.on.truth && !q.on.persona,
    );
    if (!fallback) problems.push(`No fallback question template for "${kind}" answers about a companion.`);
  }
  for (const q of content.questions) {
    if (q.on.about && (q.on.kind === 'insist' || q.on.kind === 'deflect' || q.on.via)) {
      problems.push(`question template ${q.id} answers about a companion as no lie about one is answered.`);
    }
  }
  const first = Math.min(...def.kinds.map((k) => k.since));
  for (const d of forming) {
    const n = d.queue.parties?.n ?? [0, 0];
    if (n[0] > n[1]) problems.push(`Day ${d.day}'s parties run backwards.`);
    if (d.day < first) problems.push(`Day ${d.day} forms parties before any kind of party comes.`);
    const lead = d.queue.parties?.lead;
    const led = lead === undefined ? undefined : def.kinds.find((k) => k.id === lead);
    if (lead !== undefined && !led) problems.push(`Day ${d.day} leads with unknown party kind "${lead}".`);
    else if (led && led.since > d.day)
      problems.push(`Day ${d.day} leads with ${led.id}, which comes from day ${led.since}.`);
  }
  return problems;
}

/**
 * Achievements (docs/tech-spec.md §34): strings, tests that read only what their moment has, and endings
 * the build has. Whether each can be earned is for the tests, which play for them.
 */
function lintAchievements(content: Content, strings: Readonly<Record<string, string>>): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  const endings = new Set((content.campaign?.endings ?? []).map((e) => e.id));
  for (const a of content.achievements ?? []) {
    const where = `achievement ${a.id}`;
    if (ids.has(a.id)) problems.push(`Duplicate achievement "${a.id}".`);
    ids.add(a.id);
    for (const k of [a.title, a.text]) if (!(k in strings)) problems.push(`${where} uses missing string "${k}".`);
    const w = a.when;
    if (w.at === 'ending') {
      for (const e of w.endings)
        if (!endings.has(e)) problems.push(`${where} waits on ending "${e}", which the build doesn't have.`);
      continue;
    }
    for (const path of predPaths(w.test)) {
      if (!factPathOk(w.at, path)) problems.push(`${where} reads "${path}", which a ${w.at} doesn't have.`);
    }
  }
  return problems;
}

/**
 * The coach's lessons (docs/tech-spec.md §25): each rides on its day's teaching soul, names things the
 * coach can highlight, and waits on tools the day has. Whether each step can be done on the soul the
 * day actually makes is for the tests, which generate it.
 */
function lintLessons(content: Content, strings: Readonly<Record<string, string>>): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  const specs: { d: DaySpec; name: string }[] = content.days.map((d) => ({ d, name: `day ${d.day}` }));
  if (content.daily) specs.push({ d: content.daily, name: 'the Daily' });
  if (content.primer) specs.push({ d: content.primer, name: 'the primer' });
  for (const { d, name } of specs) {
    if (!d.lesson) continue;
    const where = `${name}'s lesson`;
    if (!d.queue.teachFirst) problems.push(`${where} has no teaching soul (queue.teachFirst) to ride on.`);
    const whim = (ref: string, what: string) => {
      const param = ref.slice('whim:'.length);
      const pool = d.params?.[param]?.pool;
      if (!pool) problems.push(`${where} ${what} "${ref}", but the day has no param "${param}".`);
      else if (pool.some((c) => !('fact' in c.is))) {
        problems.push(`${where} ${what} "${ref}", whose choices don't each read one fact.`);
      }
    };
    const steps = d.lesson.steps;
    steps.forEach((step, i) => {
      const at = `${where} step ${step.id}`;
      if (ids.has(step.id)) problems.push(`Duplicate lesson step "${step.id}" (${where}).`);
      ids.add(step.id);
      if (!(step.text in strings)) problems.push(`${at} uses missing string "${step.text}".`);
      for (const f of step.focus.split(/\s+/)) {
        if (f.startsWith('whim:')) whim(f, 'highlights');
        else if (!COACH_FOCUS.includes(f)) problems.push(`${at} highlights "${f}", which the coach doesn't know.`);
      }
      if (step.next && step.until) problems.push(`${at} is both a reading step and waits on something.`);
      const until = step.until;
      if (until && 'seen' in until && until.seen.startsWith('whim:')) whim(until.seen, 'waits on');
      const tool = until && 'tool' in until ? until.tool : until && 'flipped' in until ? 'flip' : undefined;
      if (tool && !content.tools.some((t) => t.id === tool && t.since <= d.day)) {
        problems.push(`${at} waits on the ${tool}, which isn't taught by day ${d.day}.`);
      }
      const last = i === steps.length - 1;
      if (last && (step.next || step.until)) problems.push(`${at}: the last step lasts until the soul is judged.`);
    });
  }
  return problems;
}

/** Campaign cross-references (docs/tech-spec.md §10). */
function lintCampaign(content: Content, strings: Readonly<Record<string, string>>): string[] {
  const c = content.campaign;
  if (!c) return [];
  const problems: string[] = [];
  const key = (k: string, where: string) => {
    if (!(k in strings)) problems.push(`${where} uses missing string "${k}".`);
  };
  const seen = new Set<string>();
  for (const m of c.family) {
    if (seen.has(m.id)) problems.push(`Duplicate family member "${m.id}".`);
    seen.add(m.id);
    key(m.name, `family member ${m.id}`);
  }
  for (const a of c.aliases ?? []) key(a.name, `the alias for ${a.faction}`);
  const shopIds = new Set<string>();
  for (const u of c.shop) {
    if (shopIds.has(u.id)) problems.push(`Duplicate shop item "${u.id}".`);
    shopIds.add(u.id);
    key(u.name, `shop item ${u.id}`);
    key(u.text, `shop item ${u.id}`);
    if ('tool' in u.effect && !content.tools.some((t) => t.id === (u.effect as { tool: string }).tool)) {
      problems.push(`shop item ${u.id} speeds up a tool this build doesn't have.`);
    }
  }
  const endingIds = new Set<string>();
  const walk = (p: StatePred, where: string): void => {
    if ('all' in p) for (const q of p.all) walk(q, where);
    else if ('any' in p) for (const q of p.any) walk(q, where);
    else if ('not' in p) walk(p.not, where);
    else if (!STATE_PATHS.test(p.state)) problems.push(`${where} reads unknown run state "${p.state}".`);
  };
  for (const e of c.endings) {
    if (endingIds.has(e.id)) problems.push(`Duplicate ending "${e.id}".`);
    endingIds.add(e.id);
    key(e.title, `ending ${e.id}`);
    key(e.text, `ending ${e.id}`);
    if (e.when) walk(e.when, `ending ${e.id}`);
  }
  if (!endingIds.has(c.finale)) problems.push(`The campaign's finale "${c.finale}" isn't an ending.`);
  // One of the family by id, and the ending a run came to (docs/tech-spec.md §55): the members must exist, and the
  // ending, which only an epilogue can read (while a run goes on, it hasn't one).
  const names = (p: StatePred, where: string, epilogue: boolean): void => {
    for (const path of predPaths(p)) {
      const [head, id] = path.split('.');
      if (head === 'member' && !c.family.some((m) => m.id === id)) {
        problems.push(`${where} reads "${path}", but nobody in the family is "${id}".`);
      }
      if (head === 'ending' && !epilogue) problems.push(`${where} reads the run's ending: only the epilogue can.`);
      else if (head === 'ending' && !endingIds.has(path))
        problems.push(`${where} reads "${path}", which isn't an ending.`);
    }
  };
  for (const e of c.endings) if (e.when) names(e.when, `ending ${e.id}`, false);
  const threadIds = new Set<string>();
  for (const th of c.threads ?? []) {
    if (threadIds.has(th.id)) problems.push(`Duplicate thread "${th.id}".`);
    threadIds.add(th.id);
    key(th.text, `thread ${th.id}`);
    walk(th.when, `thread ${th.id}`);
    names(th.when, `thread ${th.id}`, false);
    if (th.count !== undefined && !STATE_PATHS.test(th.count)) {
      problems.push(`thread ${th.id} counts unknown run state "${th.count}".`);
    }
  }
  // The epilogue (docs/tech-spec.md §55): its words exist, its conditions read what a run has, and no line is
  // unreachable behind one that always holds.
  const epilogue = c.epilogue;
  if (epilogue) {
    const check = (p: StatePred | undefined, where: string) => {
      if (!p) return;
      walk(p, where);
      names(p, where, true);
    };
    check(epilogue.when, 'the epilogue');
    const slotIds = new Set<string>();
    for (const s of epilogue.slots) {
      const where = `epilogue slot ${s.id}`;
      if (slotIds.has(s.id)) problems.push(`Duplicate epilogue slot "${s.id}".`);
      slotIds.add(s.id);
      check(s.when, where);
      s.lines.forEach((l, i) => {
        key(l.text, where);
        check(l.when, `${where}, line ${i + 1}`);
        if (!l.when && i < s.lines.length - 1) {
          problems.push(`${where}: line ${i + 1} always holds, so the lines after it never show.`);
        }
      });
    }
  }
  const rankIds = new Set<string>();
  for (const r of c.promotion?.ranks ?? []) {
    if (rankIds.has(r.id)) problems.push(`Duplicate rank "${r.id}".`);
    rankIds.add(r.id);
    key(r.name, `rank ${r.id}`);
    key(r.text, `rank ${r.id}`);
  }
  const favourIds = new Set<string>();
  for (const f of c.favours ?? []) {
    if (favourIds.has(f.id)) problems.push(`Duplicate favour "${f.id}".`);
    favourIds.add(f.id);
    key(f.text, `favour ${f.id}`);
  }
  const requestIds = new Set<string>();
  for (const r of c.requests?.list ?? []) {
    if (requestIds.has(r.id)) problems.push(`Duplicate request "${r.id}".`);
    requestIds.add(r.id);
    key(r.text, `request ${r.id}`);
    // Souls sent where they belong are no favour: that would be a reward for judging rightly.
    if (r.from === r.to) problems.push(`request ${r.id} asks for souls sent where they already belong.`);
    if (r.until !== undefined && r.until <= r.since) problems.push(`request ${r.id} stops before it starts.`);
  }
  // Pleas (docs/tech-spec.md §59): a soul asks for somewhere it doesn't belong, and never to be held or sent back.
  for (const p of c.pleas?.list ?? []) {
    const where = `plea from ${p.from} to ${p.to}`;
    key(p.text, where);
    if (p.from === p.to) problems.push(`The ${where} asks for the hall the soul already belongs in.`);
    if (p.to === 'RETURN' || p.to === 'DETAIN') problems.push(`The ${where} asks for a stamp no soul asks for.`);
  }
  if (c.kin) {
    key(c.kin.text, 'kin');
    key(c.kin.plea, 'kin');
  }
  problems.push(...lintEvents(content, key));
  problems.push(...lintWeaving(content, key));
  problems.push(...lintRagnarok(content, key));
  problems.push(...lintTrail(content, key, walk));
  if (!content.predicates.some((p) => p.id === c.worthy)) {
    problems.push(`The campaign's worthy predicate "${c.worthy}" doesn't exist.`);
  }
  for (let d = 1; d <= c.lastDay; d++) {
    const spec = content.days.find((x) => x.day === d);
    if (!spec) problems.push(`Campaign day ${d} has no day spec.`);
    else if (!spec.economy) problems.push(`Campaign day ${d} has no economy.`);
  }
  return problems;
}

/**
 * The forger's trail (docs/tech-spec.md §71): its words; carvers with two different habits each, no two with the same
 * two (so both seen name one man), and names no generated soul is given; nights within the campaign, from its first
 * day on; and what naming a man does, to a family that exists.
 */
function lintTrail(
  content: Content,
  key: (k: string, where: string) => void,
  walk: (p: StatePred, where: string) => void,
): string[] {
  const c = content.campaign;
  const t = c?.trail;
  if (!c || !t) return [];
  const problems: string[] = [];
  key(t.title, "the forger's trail");
  key(t.intro, "the forger's trail");
  if (t.when) walk(t.when, "the forger's trail");
  const reserved = new Set(
    Object.entries(content.pools)
      .filter(([id]) => id.startsWith('names.reserved'))
      .flatMap(([, names]) => names),
  );
  const ids = new Set<string>();
  const pairs = new Set<string>();
  for (const s of t.suspects) {
    const where = `carver ${s.id} on the forger's trail`;
    if (ids.has(s.id)) problems.push(`Duplicate carver "${s.id}" on the forger's trail.`);
    ids.add(s.id);
    key(s.text, where);
    const [a, b] = s.hands;
    if (a === b) problems.push(`${where} has the same habit twice: two are needed to tell him from the others.`);
    const pair = [...s.hands].sort().join('+');
    if (pairs.has(pair)) problems.push(`${where} has the same two habits as another carver, so none could be named.`);
    pairs.add(pair);
    if (!reserved.has(s.look.name)) {
      problems.push(`${where} is named ${s.look.name}, which no names.reserved pool keeps from generated souls.`);
    }
  }
  if (t.since > c.lastDay) problems.push("The forger's trail begins after the campaign's last day.");
  const nights = new Set<number>();
  for (const n of t.nights) {
    if (nights.has(n)) problems.push(`The forger's trail names night ${n} twice.`);
    nights.add(n);
    if (n < t.since || n >= c.lastDay) {
      problems.push(`The forger's trail names night ${n}, which isn't a night of the campaign from its first day.`);
    }
  }
  const family = new Set(c.family.map((m) => m.id));
  for (const e of [...t.right, ...t.wrong]) {
    if ('family' in e && !family.has(e.family)) {
      problems.push(`The forger's trail changes unknown family member "${e.family}".`);
    }
  }
  return problems;
}

/**
 * The last battle (docs/tech-spec.md §54): strings; fronts named `front.<name>`, so endings can read them; each host's
 * own front a front, and no two hosts with the same front or hall; and endings that read the battle only in a build
 * that has one, and only of its fronts.
 */
function lintRagnarok(content: Content, key: (k: string, where: string) => void): string[] {
  const c = content.campaign;
  if (!c) return [];
  const problems: string[] = [];
  const reads = c.endings.filter((e) => e.when !== undefined && readsBattle(e.when));
  const def = c.ragnarok;
  // Upgrades sold back and a reprieve (docs/tech-spec.md §56) need no battle.
  if (c.sellBack !== undefined && (c.sellBack < 0 || c.sellBack > 100)) {
    problems.push(`Upgrades sell back for ${c.sellBack}% of their price: it must be 0 to 100.`);
  }
  if (c.reprieve) {
    key(c.reprieve.text, 'the reprieve');
    if (!c.endings.some((e) => e.id === c.reprieve?.ending)) {
      problems.push(`The reprieve stays "${c.reprieve.ending}", which isn't an ending.`);
    }
  }
  if (!def) {
    for (const e of reads) problems.push(`ending ${e.id} reads the last battle, but this build has none.`);
    if (c.arms) problems.push('This build sells arms for the last battle, but has none.');
    return problems;
  }
  key(def.text, 'the last battle');
  const fronts = new Set<string>();
  for (const f of def.fronts) {
    const where = `front ${f.id}`;
    if (fronts.has(f.id)) problems.push(`Duplicate front "${f.id}".`);
    fronts.add(f.id);
    if (!/^front\.[A-Za-z0-9_]+$/.test(f.id))
      problems.push(`${where}: a front's id is "front.<name>", for endings to read.`);
    for (const k of [f.name, f.text, f.held, f.fell]) key(k, where);
  }
  const hosts = new Set<string>();
  const own = new Map<string, string>();
  const halls = new Map<string, string>();
  for (const h of def.hosts) {
    const where = `host ${h.id}`;
    if (hosts.has(h.id)) problems.push(`Duplicate host "${h.id}".`);
    hosts.add(h.id);
    key(h.name, where);
    if (!fronts.has(h.front)) problems.push(`${where} has unknown front "${h.front}" for its own.`);
    const sharesFront = own.get(h.front);
    if (sharesFront) problems.push(`${where} and ${sharesFront} both have ${h.front} for their own front.`);
    own.set(h.front, h.id);
    const sharesHall = halls.get(h.hall);
    if (sharesHall) problems.push(`${where} and ${sharesHall} are both the souls sent to ${h.hall}.`);
    halls.set(h.hall, h.id);
  }
  for (const e of reads) {
    for (const p of predPaths(e.when as StatePred)) {
      if (p.startsWith('front.') && !fronts.has(p)) problems.push(`ending ${e.id} reads unknown front "${p}".`);
    }
  }
  // Arms for the last battle (docs/tech-spec.md §56): for fronts the battle has, each named once.
  const armed = new Set<string>();
  for (const a of c.arms?.fronts ?? []) {
    const where = `arms for ${a.front}`;
    if (!fronts.has(a.front)) problems.push(`${where}: the battle has no such front.`);
    if (armed.has(a.front)) problems.push(`${where} are listed twice.`);
    armed.add(a.front);
    key(a.name, where);
    key(a.text, where);
  }
  if (c.arms && c.arms.from > c.lastDay) problems.push('Arms go on sale after the last night.');
  return problems;
}

/**
 * Day events (docs/tech-spec.md §52): strings, enough of them to draw, and on every day each can fall on, a line
 * long enough after the souls that don't come, and the souls it brings of a kind the day has, able to reach one of
 * their destinations (under the day's first param choices; the generator tries the kind first, not only).
 */
function lintEvents(content: Content, key: (k: string, where: string) => void): string[] {
  const def = content.campaign?.events;
  if (!def) return [];
  const problems: string[] = [];
  if (def.from > def.to) problems.push('The day events start after they end.');
  if (def.perRun > def.pool.length)
    problems.push(`A run draws ${def.perRun} day events, from only ${def.pool.length}.`);
  const days = eventDays(content);
  if (days.length === 0) problems.push('No day can have a day event.');
  const ids = new Set<string>();
  for (const ev of def.pool) {
    const where = `day event ${ev.id}`;
    if (ids.has(ev.id)) problems.push(`Duplicate day event "${ev.id}".`);
    ids.add(ev.id);
    key(ev.name, where);
    key(ev.text, where);
    const on = days.filter((d) => d >= ev.since);
    if (on.length === 0) problems.push(`${where} can't fall on any day.`);
    if (!ev.fewer && !ev.souls?.length && ev.sunPct === undefined && !ev.costsPct && !ev.sickChance) {
      problems.push(`${where} changes nothing.`);
    }
    for (const day of on) {
      const spec = content.days.find((d) => d.day === day);
      if (!spec) continue;
      if (spec.queue.count[0] - (ev.fewer ?? 0) < 3) problems.push(`${where} leaves day ${day} too short a line.`);
      for (const s of eventSoulsOn(ev, day)) {
        if (!canBring(content, day, s.kind, s.to)) {
          problems.push(`${where}: day ${day} has no ${s.kind} bound for ${s.to.join(' or ')}.`);
        }
      }
    }
  }
  return problems;
}

/**
 * The Norns' weave (docs/tech-spec.md §53): the endings that open it, strings, rules that exist, a weave that changes
 * some day, the catch-all still read last on every day, and the souls it brings of a kind each day has, able to reach
 * where they're bound under its order. The story souls are checked under each weave with the rest (lintScripted).
 */
function lintWeaving(content: Content, key: (k: string, where: string) => void): string[] {
  const def = content.campaign?.weaving;
  if (!def) return [];
  const problems: string[] = [];
  const endings = new Set(content.campaign?.endings.map((e) => e.id));
  for (const id of def.after)
    if (!endings.has(id)) problems.push(`The weave opens after "${id}", which isn't an ending.`);
  const rules = new Set(content.rules.map((r) => r.id));
  const ids = new Set<string>();
  const lastDay = content.campaign?.lastDay ?? 0;
  for (const w of def.weaves) {
    const where = `weave ${w.id}`;
    if (ids.has(w.id)) problems.push(`Duplicate weave "${w.id}".`);
    ids.add(w.id);
    key(w.name, where);
    key(w.text, where);
    for (const id of Object.keys(w.order)) if (!rules.has(id)) problems.push(`${where} moves unknown rule "${id}".`);
    const first = weaveDay(content, w);
    if (first === null) {
      problems.push(`${where} changes no day.`);
      continue;
    }
    const woven = wovenContent(content, w);
    for (const d of content.days) {
      const inForce = woven.rules
        .filter((r) => r.since <= d.day && (r.until === undefined || d.day < r.until))
        .sort((a, b) => a.order - b.order);
      const last = inForce[inForce.length - 1];
      if (!last || !('always' in last.when))
        problems.push(`${where}: on day ${d.day} the last rule read doesn't always apply.`);
    }
    for (let day = first; day <= lastDay; day++) {
      for (const s of weaveSoulsOn(content, w, day)) {
        if (!canBring(woven, day, s.kind, s.to)) {
          problems.push(`${where}: day ${day} has no ${s.kind} bound for ${s.to.join(' or ')}.`);
        }
      }
    }
  }
  return problems;
}

/**
 * Whether souls of `kind` can be bound for one of `to` on `day` under every choice of the day's params (Freyja's whim
 * and the like), with the rules read as `rules` reads them. The generator tries the kind first, not only.
 */
function canBring(rules: Content, day: number, kind: string, to: readonly Destination[]): boolean {
  return paramCombos(rules, day).every((choose) => {
    const ctx = createDayContext(rules, day, 'lint', undefined, choose);
    const reach = reachOf(ctx);
    return to.some((d) => reach.get(kind)?.has(d) && ctx.destinations.has(d));
  });
}

/** Every combination of a day's param choices (Freyja's whim and the like), by choice id. */
function paramCombos(content: Content, day: number): Record<string, string>[] {
  const spec = content.days.find((d) => d.day === day);
  let combos: Record<string, string>[] = [{}];
  for (const [name, param] of Object.entries(spec?.params ?? {})) {
    combos = combos.flatMap((c) => param.pool.map((choice) => ({ ...c, [name]: choice.id })));
  }
  return combos;
}

/**
 * Story souls: references, and proof that each one can be made on every day
 * that places it, under every param choice that day can have.
 */
function lintScripted(content: Content, strings: Readonly<Record<string, string>>): string[] {
  const problems: string[] = [];
  const defs = new Map<string, ScriptedCaseDef>();
  const facts = new Set(content.facts.map((f) => f.id));
  const family = new Set((content.campaign?.family ?? []).map((m) => m.id));
  // A story soul's name is kept from generated souls (engine gen/look.ts), so nobody else in the queue has it.
  const reserved = new Set(
    Object.entries(content.pools)
      .filter(([id]) => id.startsWith('names.reserved'))
      .flatMap(([, names]) => names),
  );
  const walk = (p: StatePred, where: string): void => {
    if ('all' in p) for (const q of p.all) walk(q, where);
    else if ('any' in p) for (const q of p.any) walk(q, where);
    else if ('not' in p) walk(p.not, where);
    else if (!STATE_PATHS.test(p.state)) problems.push(`${where} reads unknown run state "${p.state}".`);
  };
  const effect = (e: Effect, where: string) => {
    if ('family' in e && !family.has(e.family)) problems.push(`${where} changes unknown family member "${e.family}".`);
  };
  for (const def of content.scripted ?? []) {
    const where = `story soul ${def.id}`;
    if (defs.has(def.id)) problems.push(`Duplicate story soul "${def.id}".`);
    defs.set(def.id, def);
    for (const f of [...Object.keys(def.truth), ...def.lies.map((l) => l.fact)]) {
      if (!facts.has(f)) problems.push(`${where} refers to unknown fact "${f}".`);
    }
    for (const k of def.lines ?? []) if (!(k in strings)) problems.push(`${where} uses missing string "${k}".`);
    if (!reserved.has(def.look.name)) {
      problems.push(`${where} is named ${def.look.name}, which no names.reserved pool keeps from generated souls.`);
    }
    if (def.when) walk(def.when, where);
    // A carver's face (docs/tech-spec.md §71) is the forger's trail's to give.
    if (def.lookOf && !content.campaign?.trail) {
      problems.push(`${where} wears the face of a carver, but this build has no forger's trail.`);
    }
    for (const rule of def.onStamp ?? []) for (const e of rule.effects) effect(e, where);
    // A plea (docs/tech-spec.md §51) asks for a stamp where the soul doesn't belong, in words the desk can show.
    if (def.plea) {
      if (def.plea.stamp === def.expect) problems.push(`${where} pleads for ${def.expect}, where it belongs anyway.`);
      if (!(def.plea.text in strings)) problems.push(`${where} uses missing string "${def.plea.text}".`);
    }
  }
  const placed = new Set<string>();
  for (const spec of [content.daily, content.primer]) {
    if (spec?.queue.scripted) problems.push('The Daily and the primer have no story souls.');
  }
  for (const d of content.days) {
    // Who comes to the desk, and when (docs/tech-spec.md §46): only what the run can read.
    for (const v of d.queue.visits ?? []) if (v.when) walk(v.when, `day ${d.day}'s visit ${v.scene}`);
    for (const slot of d.queue.scripted ?? []) {
      const def = defs.get(slot.case);
      if (!def) {
        problems.push(`day ${d.day} places unknown story soul "${slot.case}".`);
        continue;
      }
      placed.add(def.id);
      if (slot.at > d.queue.count[1]) problems.push(`day ${d.day} places ${def.id} past the end of its queue.`);
      const trail = content.campaign?.trail;
      if (def.lookOf && trail && d.day < trail.since) {
        problems.push(`day ${d.day} places ${def.id}, a carver's face, before the forger's trail begins.`);
      }
      // A carver's face, whichever carver the run draws and names (docs/tech-spec.md §71): his, and his habits.
      const faces =
        def.lookOf && trail && d.day >= trail.since
          ? trail.suspects.map((s) => ({ hands: s.hands, looks: { culprit: s.look, named: s.look } }))
          : [undefined];
      // Under every order a run can read the rules in: its own, and each weave's (docs/tech-spec.md §53).
      const orders = [
        { rules: content, under: '' },
        ...(content.campaign?.weaving?.weaves ?? []).map((w) => ({ rules: wovenContent(content, w), under: w.id })),
      ];
      for (const { rules, under } of orders) {
        for (const face of faces) {
          let failed = false;
          for (const choose of paramCombos(content, d.day)) {
            const ctx = withTrail(createDayContext(rules, d.day, 'lint', undefined, choose), face);
            const made = scriptedCase(def, ctx, 'lint', slot.at);
            if (!made.ok) {
              const params = [
                ...Object.entries(choose).map(([k, v]) => `${k}=${v}`),
                ...(under ? [under] : []),
                ...(face ? [`the face of ${face.looks.culprit.name}`] : []),
              ];
              problems.push(`day ${d.day}: ${made.why}${params.length > 0 ? ` with ${params.join(', ')}` : ''}.`);
              failed = true;
              break;
            }
          }
          if (failed) break;
        }
      }
    }
  }
  for (const id of defs.keys()) if (!placed.has(id)) problems.push(`No day places story soul "${id}".`);
  return problems;
}
