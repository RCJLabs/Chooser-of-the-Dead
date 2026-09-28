import type {
  AchievementDef,
  ArchetypeDef,
  CueDef,
  DaySpec,
  Economy,
  Effect,
  EndingDef,
  EndlessTwist,
  FactDef,
  FactLaw,
  FamilyDef,
  NamedPredicate,
  ObservationDef,
  ObsPattern,
  Pred,
  ProcedureDef,
  QuestionTemplate,
  RavenTemplate,
  RuleDef,
  ScriptedCaseDef,
  SignLaw,
  SpeechSlotDef,
  StandingRule,
  StatePred,
  SunCosts,
  TallyTemplate,
  TestimonyTemplate,
  ToolDef,
  UpgradeDef,
  WorldConstraint,
} from '@cots/engine';
import { z } from 'zod';

/**
 * YAML schemas for gameplay content. Each one parses into the engine's own
 * content types (packages/engine/src/content/types.ts); the explicit
 * `z.ZodType<...>` annotations make any drift between the two a type error.
 */

const Id = z.string().regex(/^[a-z][a-zA-Z0-9_.-]*$/, 'ids are dotted lower-camel words');
const Key = z.string().regex(/^[a-z][a-z0-9]*(\.[a-zA-Z0-9_-]+)+$/, 'string keys look like `core.title`');
const Int = z.number().int();
const Day = Int.min(1).max(20);
const Percent = Int.min(0).max(100);
const Weight = Int.min(0);

export const ValueSchema = z.union([z.string(), Int, z.boolean()]);
export const DestinationSchema = z.enum(['VALHALLA', 'FOLKVANGR', 'HEL', 'RAN', 'RETURN', 'DETAIN', 'TRANSFER']);
export const ToolIdSchema = z.enum(['flip', 'feather', 'registry', 'runeLens', 'clippers']);
const ViewSchema = z.enum(['front', 'back']);
const SalienceSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);
const QuestionKindSchema = z.enum(['confess', 'excuse', 'insist', 'deflect']);

export const PredSchema: z.ZodType<Pred> = z.lazy(() =>
  z.union([
    z.strictObject({ fact: z.string(), is: ValueSchema }),
    z.strictObject({ fact: z.string(), in: z.array(ValueSchema).min(1) }),
    z.strictObject({ fact: z.string(), gte: Int.optional(), lte: Int.optional() }),
    z.strictObject({ all: z.array(PredSchema).min(1) }),
    z.strictObject({ any: z.array(PredSchema).min(1) }),
    z.strictObject({ not: PredSchema }),
    z.strictObject({ ref: Id }),
    z.strictObject({ param: z.string() }),
    z.strictObject({ always: z.literal(true) }),
  ]),
);

const ObsPatternSchema: z.ZodType<ObsPattern> = z.lazy(() =>
  z.union([
    z.strictObject({ obs: z.string(), is: ValueSchema }),
    z.strictObject({ obs: z.string(), in: z.array(ValueSchema).min(1) }),
    z.strictObject({ all: z.array(ObsPatternSchema).min(1) }),
  ]),
);

const DomainSchema = z.union([
  z.strictObject({ enum: z.array(z.string()).min(1) }).transform((d) => ({ kind: 'enum' as const, values: d.enum })),
  z.strictObject({ bool: z.literal(true) }).transform(() => ({ kind: 'bool' as const })),
  z
    .strictObject({ int: z.tuple([Int, Int]) })
    .transform((d) => ({ kind: 'int' as const, min: d.int[0], max: d.int[1] })),
]);

export const FactSchema: z.ZodType<FactDef, unknown> = z
  .strictObject({
    id: Id,
    domain: DomainSchema,
    since: Day.default(1),
    inert: ValueSchema.optional(),
    valueSince: z.record(z.string(), Day).optional(),
    prior: z.record(z.string(), Weight).optional(),
    presumption: ValueSchema.optional(),
    derived: PredSchema.optional(),
    fromLies: z.literal(true).optional(),
    words: z.record(z.string(), z.record(z.string(), z.string())).optional(),
  })
  .refine(
    (f) =>
      !f.fromLies ||
      (f.domain.kind === 'bool' && f.presumption === false && f.prior === undefined && f.derived === undefined),
    { message: 'a fromLies fact is a bool, presumed false, with no prior and no derivation' },
  )
  .transform(({ inert, ...f }) => {
    const d = f.domain;
    const first = d.kind === 'enum' ? (d.values[0] as string) : d.kind === 'int' ? d.min : false;
    return { ...f, inert: inert ?? first };
  });

export const ObservationSchema: z.ZodType<ObservationDef> = z.strictObject({
  key: z.string(),
  view: ViewSchema,
  tool: ToolIdSchema.optional(),
  since: Day,
  salience: SalienceSchema,
  cost: Int.min(0),
  from: z.union([
    z.strictObject({ fact: z.string() }),
    z.strictObject({
      map: z.array(z.strictObject({ when: PredSchema, value: ValueSchema })).min(1),
      otherwise: ValueSchema,
    }),
  ]),
  when: PredSchema.optional(),
  doc: z.literal('registry').optional(),
});

const FactConstraintSchema = z.strictObject({ fact: z.string(), in: z.array(ValueSchema).min(1) });

export const LawSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('sign'),
    id: Id,
    since: Day,
    text: Key,
    if: ObsPatternSchema,
    then: FactConstraintSchema,
  }),
  z.strictObject({
    kind: z.literal('fact'),
    id: Id,
    since: Day,
    text: Key,
    if: PredSchema,
    then: FactConstraintSchema,
  }),
]);
export type LawYaml = z.infer<typeof LawSchema>;
export const toSignLaw = ({ kind: _, ...l }: Extract<LawYaml, { kind: 'sign' }>): SignLaw => l;
export const toFactLaw = ({ kind: _, ...l }: Extract<LawYaml, { kind: 'fact' }>): FactLaw => l;

export const CueSchema: z.ZodType<CueDef> = z.strictObject({
  key: z.string(),
  view: ViewSchema,
  since: Day,
  salience: SalienceSchema,
  hint: z.union([
    z.strictObject({ fact: z.string(), value: ValueSchema }),
    z.strictObject({ forgery: z.literal(true) }),
  ]),
});

export const WorldSchema: z.ZodType<WorldConstraint> = z.strictObject({ id: Id, if: PredSchema, then: PredSchema });

export const NamedPredicateSchema: z.ZodType<NamedPredicate> = z.strictObject({
  id: Id,
  versions: z.array(z.strictObject({ since: Day, is: PredSchema })).min(1),
});

export const RuleSchema: z.ZodType<RuleDef> = z.strictObject({
  id: Id,
  order: Int.min(0),
  since: Day,
  until: Day.optional(),
  when: PredSchema,
  then: DestinationSchema,
  text: Key,
  texts: z.array(z.strictObject({ since: Day, text: Key })).optional(),
});

export const ToolSchema: z.ZodType<ToolDef> = z.strictObject({ id: ToolIdSchema, since: Day, cost: Int.min(0) });

/** What the sun costs besides the tools, in seconds (`sun.yaml`, docs/tech-spec.md §63). */
export const SunSchema: z.ZodType<SunCosts> = z.strictObject({
  badCompare: Int.min(0),
  question: Int.min(0),
  hint: Int.min(0),
  duskGrace: Int.min(0),
});

export const ProcedureSchema: z.ZodType<ProcedureDef> = z.strictObject({
  id: Id,
  since: Day,
  until: Day.optional(),
  when: PredSchema,
  tool: ToolIdSchema,
  text: Key,
});

const TruthConstraintSchema = z.union([
  z.strictObject({ is: ValueSchema }),
  z.strictObject({ in: z.array(ValueSchema).min(1) }),
  z.strictObject({ gte: Int.optional(), lte: Int.optional() }),
]);

const LieSpecSchema = z.strictObject({
  fact: z.string(),
  claim: ValueSchema,
  p: Percent,
  motive: z.enum(['wantsValhalla', 'avoidHel', 'hideFaith', 'evadeRegistry', 'mistaken', 'mischief']),
  onQuestion: z.partialRecord(QuestionKindSchema, Weight),
  since: Day.optional(),
  via: z.literal('tally').optional(),
});

export const ArchetypeSchema: z.ZodType<ArchetypeDef> = z.strictObject({
  id: Id,
  since: Day,
  until: Day.optional(),
  personas: z.array(Id).min(1),
  truth: z.record(z.string(), TruthConstraintSchema),
  require: z.array(PredSchema).optional(),
  lies: z.array(LieSpecSchema),
  words: z.record(z.string(), z.string().min(1)).optional(),
});

const SpeechSlotNameSchema = z.enum([
  'identity',
  'death',
  'weapon',
  'owner',
  'blade',
  'back',
  'oath',
  'creed',
  'guise',
  'flavor',
]);

export const SpeechSlotSchema: z.ZodType<SpeechSlotDef> = z.strictObject({
  slot: SpeechSlotNameSchema,
  fact: z.string().optional(),
  chance: Percent,
  chances: z.record(z.string(), Percent).optional(),
  since: Day,
});

const Asserts = z.strictObject({ fact: z.string(), value: ValueSchema });
const Params = z.record(z.string(), z.string());

export const TestimonyTemplateSchema: z.ZodType<TestimonyTemplate> = z.strictObject({
  id: Id,
  slot: SpeechSlotNameSchema,
  asserts: Asserts.optional(),
  personas: z.array(Id).min(1).optional(),
  msg: Key,
  params: Params.optional(),
  weight: Weight.default(1),
});

export const RavenTemplateSchema: z.ZodType<RavenTemplate> = z.strictObject({
  id: Id,
  raven: z.enum(['huginn', 'muninn']),
  tag: z.string().optional(),
  asserts: Asserts.optional(),
  msg: Key,
  params: Params.optional(),
  weight: Weight.default(1),
});

export const QuestionTemplateSchema: z.ZodType<QuestionTemplate> = z.strictObject({
  id: Id,
  on: z.strictObject({
    fact: z.string(),
    claimed: ValueSchema.optional(),
    truth: z.array(ValueSchema).min(1).optional(),
    persona: z.array(Id).min(1).optional(),
    kind: QuestionKindSchema,
    via: z.literal('tally').optional(),
  }),
  msgs: z.array(Key).min(1),
  weight: Weight.default(1),
});

export const TallyTemplateSchema: z.ZodType<TallyTemplate> = z.strictObject({
  id: Id,
  asserts: Asserts,
  msg: Key,
  params: Params.optional(),
  weight: Weight.default(1),
});

export const PoolsSchema = z.record(Key, z.array(z.string().min(1)).min(1));

const Pair = z.tuple([Int.min(0), Int.min(0)]);

export const EconomySchema: z.ZodType<Economy> = z.strictObject({
  wage: Int.min(0),
  docBonus: Int.min(0),
  warnings: Int.min(0),
  fines: z.array(Int.min(0)).min(1),
  costs: z.strictObject({ hearth: Int.min(0), food: Int.min(0), medicine: Int.min(0) }),
});

const LessonUntilSchema = z.union([
  z.strictObject({ seen: z.string().min(1) }),
  z.strictObject({ tool: ToolIdSchema }),
  z.strictObject({ flipped: z.literal(true) }),
  z.strictObject({ flagged: z.literal(true) }),
]);

const LessonSchema = z.strictObject({
  primer: z.literal(true).optional(),
  steps: z
    .array(
      z.strictObject({
        id: Id,
        text: Key,
        focus: z.string().min(1),
        next: z.literal(true).optional(),
        until: LessonUntilSchema.optional(),
      }),
    )
    .min(1),
});

const KnobsSchema = z.strictObject({
  lieRate: Int.min(0).max(200),
  maxLies: Int.min(0).max(3),
  decoyRate: Percent,
  ravenRate: Percent,
  forgetRate: Percent,
  proofCostS: Pair,
  maxTools: Int.min(0),
  maxDocs: Int.min(1),
  salienceFloor: SalienceSchema,
  tallyRate: Percent.optional(),
  muninnRecall: Percent.optional(),
  huginnAside: Percent.optional(),
  spreadLines: z.boolean().optional(),
  spreadLooks: z.boolean().optional(),
});

/** Endless's twists (endless.yaml): a decree and how the souls come, never new rules. */
export const EndlessTwistSchema: z.ZodType<EndlessTwist> = z.strictObject({
  id: Id,
  since: Day,
  decree: Key,
  knobs: KnobsSchema.partial().optional(),
  mix: z.partialRecord(DestinationSchema, z.tuple([Percent, Percent])).optional(),
});

export const DaySpecSchema: z.ZodType<DaySpec> = z.strictObject({
  day: Day,
  sunS: Int.positive(),
  decree: Key,
  economy: EconomySchema.optional(),
  scenes: z.strictObject({ morning: Id.optional(), night: Id.optional() }).optional(),
  params: z
    .record(z.string(), z.strictObject({ pool: z.array(z.strictObject({ id: Id, text: Key, is: PredSchema })).min(1) }))
    .optional(),
  queue: z.strictObject({
    count: Pair,
    teachFirst: Id.optional(),
    script: z
      .array(z.strictObject({ id: Id, dest: DestinationSchema }))
      .min(1)
      .optional(),
    scripted: z
      .array(z.strictObject({ case: Id, at: Int.min(0) }))
      .min(1)
      .optional(),
    visits: z
      .array(z.strictObject({ scene: Id, at: Int.min(0), when: z.lazy(() => StatePredSchema).optional() }))
      .min(1)
      .optional(),
    archetypes: z.array(z.strictObject({ id: Id, w: Int.positive() })).min(1),
    mix: z.partialRecord(DestinationSchema, z.tuple([Percent, Percent])),
    knobs: KnobsSchema,
  }),
  lesson: LessonSchema.optional(),
  noon: z
    .strictObject({
      at: Int.min(1),
      notice: Int.min(1),
      redraw: z.array(z.string()).min(1),
      text: Key,
      teach: Id.optional(),
    })
    .optional(),
});

// ---- Campaign (campaign.yaml) ----

const FactionSchema = z.enum(['odin', 'freyja', 'hel', 'loki', 'clerk']);

export const StatePredSchema: z.ZodType<StatePred> = z.lazy(() =>
  z.union([
    z.strictObject({ state: z.string(), is: Int.optional(), gte: Int.optional(), lte: Int.optional() }),
    z.strictObject({ all: z.array(StatePredSchema).min(1) }),
    z.strictObject({ any: z.array(StatePredSchema).min(1) }),
    z.strictObject({ not: StatePredSchema }),
  ]),
);

export const EffectSchema: z.ZodType<Effect> = z.union([
  z.strictObject({ rings: Int }),
  z.strictObject({ standing: FactionSchema, by: Int }),
  z.strictObject({ flag: z.string().regex(/^[A-Za-z0-9_]+$/), set: Int.optional(), inc: Int.optional() }),
  z.strictObject({ family: z.string(), becomes: z.enum(['sick', 'well', 'gone']) }),
  // A trip home at dawn (docs/tech-spec.md §50): never more than ten minutes either way.
  z.strictObject({ sun: Int.min(-600).max(600) }),
]);

const LookSchema = z.strictObject({
  gender: z.enum(['m', 'f']),
  name: z.string().min(1),
  patronym: z.string().min(1),
  // The dead are adults only (docs/build-plan.md §1, content rules).
  age: Int.min(18).max(85),
  build: z.enum(['lean', 'broad', 'heavy']),
  beard: z.enum(['none', 'short', 'long', 'braided']),
});

/** A story soul (`cases/*.yaml`, one per file). */
export const ScriptedCaseSchema: z.ZodType<ScriptedCaseDef> = z.strictObject({
  id: Id,
  personas: z.array(Id).min(1),
  truth: z.record(z.string(), TruthConstraintSchema),
  require: z.array(PredSchema).optional(),
  lies: z.array(LieSpecSchema),
  look: LookSchema,
  lines: z.array(Key).min(1).optional(),
  words: z.record(z.string(), z.string().min(1)).optional(),
  expect: DestinationSchema,
  when: StatePredSchema.optional(),
  onStamp: z
    .array(
      z.strictObject({
        stamped: z.union([DestinationSchema, z.literal('*')]),
        effects: z.array(EffectSchema).min(1),
      }),
    )
    .min(1)
    .optional(),
  // A plea at the desk (docs/tech-spec.md §51).
  plea: z.strictObject({ stamp: DestinationSchema, text: Key }).optional(),
});

const FamilyDefSchema: z.ZodType<FamilyDef> = z.strictObject({ id: z.string(), name: Key, adult: z.boolean() });

const UpgradeSchema: z.ZodType<UpgradeDef> = z.strictObject({
  id: Id,
  name: Key,
  text: Key,
  price: Int.min(1),
  since: Day,
  effect: z.union([
    z.strictObject({ tool: ToolIdSchema, costS: Int.min(0) }),
    z.strictObject({ questionS: Int.min(0) }),
    z.strictObject({ sunS: Int.min(1) }),
  ]),
});

const EndingSchema: z.ZodType<EndingDef> = z.strictObject({
  id: Id,
  order: Int,
  when: StatePredSchema.optional(),
  title: Key,
  text: Key,
});

const StandingRuleSchema: z.ZodType<StandingRule> = z.strictObject({
  expected: z.union([DestinationSchema, z.literal('*')]),
  stamped: z.union([DestinationSchema, z.literal('*')]),
  fx: z.partialRecord(FactionSchema, Int),
});

/**
 * One pack's part of the campaign. The demo pack defines the whole thing for
 * Days 1-3; the campaign pack overrides `lastDay` and `finale` and adds shop
 * items, standing rules and endings (see mergeCampaign in the compiler).
 */
const SliceSchema = z.strictObject({
  after: Day,
  day: Day,
  finale: Id,
  preset: z.strictObject({
    rings: Int.optional(),
    standing: z.partialRecord(FactionSchema, Int).optional(),
    flags: z.record(z.string().regex(/^[A-Za-z0-9_]+$/), Int).optional(),
  }),
});

/** Souls a day event or a weave brings (docs/tech-spec.md §52, §53). */
const EventSoulsSchema = z
  .array(
    z.strictObject({
      kind: Id,
      to: z.array(DestinationSchema).min(1),
      n: Int.min(1),
      since: Day.optional(),
      until: Day.optional(),
    }),
  )
  .optional();

export const CampaignPartSchema = z.strictObject({
  slice: SliceSchema.optional(),
  lastDay: Day.optional(),
  finale: Id.optional(),
  startRings: Int.optional(),
  family: z.array(FamilyDefSchema).min(1).optional(),
  draupnir: z.strictObject({ nights: z.array(Day), rings: Int.min(0) }).optional(),
  debtFloor: Int.optional(),
  minSunS: Int.min(0).optional(),
  care: z.strictObject({ needNights: Int.min(1), sickChance: Percent, sickNights: Int.min(1) }).optional(),
  worthy: Id.optional(),
  standing: z.array(StandingRuleSchema).optional(),
  shop: z.array(UpgradeSchema).optional(),
  endings: z.array(EndingSchema).optional(),
  aliases: z.array(z.strictObject({ faction: FactionSchema, name: Key, untilDay: Day })).optional(),
  threads: z
    .array(z.strictObject({ id: Id, when: StatePredSchema, text: Key, count: z.string().optional() }))
    .optional(),
  appeals: z
    .strictObject({
      from: Day,
      afterMistake: Percent,
      otherwise: Percent,
      chancers: Percent,
      bonus: Int.min(0),
      fine: Int.min(0),
    })
    .optional(),
  waiting: z
    .strictObject({
      from: Day,
      crowd: Int.min(1),
      night: z.partialRecord(FactionSchema, Int),
      died: z.partialRecord(FactionSchema, Int),
    })
    .optional(),
  promotion: z
    .strictObject({
      from: Day,
      cleanDays: Int.min(1),
      ranks: z
        .array(
          z.strictObject({
            id: Id,
            name: Key,
            text: Key,
            souls: Int.min(0),
            warnings: Int.max(0),
            wage: Int.min(0),
            tithe: Int.min(0),
          }),
        )
        .min(1),
    })
    .optional(),
  favours: z
    .array(
      z.strictObject({
        id: Id,
        faction: FactionSchema,
        at: Int.min(1),
        effect: z.union([
          z.strictObject({ sunS: Int.min(1) }),
          z.strictObject({ freeQuestions: Int.min(1) }),
          z.strictObject({ finePct: Percent }),
          z.strictObject({ sickNights: Int.min(1), sickChancePct: Percent.optional() }),
          z.strictObject({ nailRings: Int.min(1) }),
        ]),
        text: Key,
      }),
    )
    .optional(),
  requests: z
    .strictObject({
      from: Day,
      chance: Percent,
      rivals: Percent,
      list: z
        .array(
          z.strictObject({
            id: Id,
            god: FactionSchema,
            from: DestinationSchema,
            to: DestinationSchema,
            n: Int.min(1),
            reward: z.partialRecord(FactionSchema, Int),
            since: Day,
            until: Day.optional(),
            text: Key,
          }),
        )
        .min(1),
    })
    .optional(),
  // Pleas from ordinary souls (docs/tech-spec.md §59): on some days, one of the day's own asks for another hall.
  pleas: z
    .strictObject({
      from: Day,
      chance: Percent,
      list: z
        .array(z.strictObject({ from: DestinationSchema, to: DestinationSchema, text: Key, since: Day.optional() }))
        .min(1),
    })
    .optional(),
  // The kin of the misjudged (docs/tech-spec.md §60): later at the desk, and asking to join them.
  kin: z.strictObject({ from: Day, chance: Percent, after: Int.min(1), text: Key, plea: Key }).optional(),
  // The Norns' weave (docs/tech-spec.md §53): the same rules in another order, for a run begun woven.
  weaving: z
    .strictObject({
      after: z.array(Id).min(1),
      weaves: z
        .array(
          z.strictObject({ id: Id, name: Key, text: Key, order: z.record(Id, Int.min(1)), souls: EventSoulsSchema }),
        )
        .min(1),
    })
    .optional(),
  // The last battle (docs/tech-spec.md §54): the hosts the run filled, and the fronts they hold.
  ragnarok: z
    .strictObject({
      text: Key,
      hosts: z
        .array(
          z.strictObject({
            id: Id,
            name: Key,
            hall: DestinationSchema,
            front: Id,
            only: z.literal(true).optional(),
          }),
        )
        .min(1),
      fronts: z
        .array(
          z.strictObject({
            id: Id,
            name: Key,
            text: Key,
            held: Key,
            fell: Key,
            foe: Int.min(1),
            perNail: Int.min(1).optional(),
          }),
        )
        .min(1),
      // The chooser rides to one front, with this much strength (docs/tech-spec.md §58).
      ride: z.strictObject({ strength: Int.min(1) }).optional(),
    })
    .optional(),
  // Arms for the last battle, upgrades sold back, and a reprieve from debt (docs/tech-spec.md §56).
  arms: z
    .strictObject({
      from: Day,
      strength: Int.min(1),
      prices: z.array(Int.min(1)).min(1),
      fronts: z.array(z.strictObject({ front: Id, name: Key, text: Key })).min(1),
    })
    .optional(),
  sellBack: Percent.optional(),
  reprieve: z.strictObject({ ending: Id, rings: Int, flag: Id, text: Key }).optional(),
  // The epilogue (docs/tech-spec.md §55): what became of everyone, told after the ending from the run.
  epilogue: z
    .strictObject({
      when: z.lazy(() => StatePredSchema).optional(),
      draft: z.boolean().optional(),
      slots: z
        .array(
          z.strictObject({
            id: Id,
            section: z.enum(['home', 'powers', 'dead']),
            when: z.lazy(() => StatePredSchema).optional(),
            lines: z.array(z.strictObject({ when: z.lazy(() => StatePredSchema).optional(), text: Key })).min(1),
          }),
        )
        .min(1),
    })
    .optional(),
  // Day events (docs/tech-spec.md §52): the day's line, its sun and that night's bills; never its rules.
  events: z
    .strictObject({
      perRun: Int.min(1),
      from: Day,
      to: Day,
      pool: z
        .array(
          z.strictObject({
            id: Id,
            since: Day,
            name: Key,
            text: Key,
            sunPct: Int.min(50).max(150).optional(),
            fewer: Int.min(1).optional(),
            souls: EventSoulsSchema,
            costsPct: z.partialRecord(z.enum(['hearth', 'food', 'medicine']), Int.min(0).max(300)).optional(),
            sickChance: Percent.optional(),
          }),
        )
        .min(1),
    })
    .optional(),
});
export type CampaignPart = z.infer<typeof CampaignPartSchema>;

// ---- Achievements (achievements.yaml, any pack) ----

const PlayModeSchema = z.enum(['daily', 'archive', 'practice', 'endless', 'primer', 'campaign']);
const Modes = z.array(PlayModeSchema).min(1);

/** Something to earn (docs/tech-spec.md §34): when it's checked, and the test at that moment. */
export const AchievementSchema: z.ZodType<AchievementDef> = z.strictObject({
  id: Id,
  title: Key,
  text: Key,
  hidden: z.boolean().optional(),
  when: z.discriminatedUnion('at', [
    z.strictObject({ at: z.literal('soul'), modes: Modes, test: StatePredSchema }),
    z.strictObject({ at: z.literal('shift'), modes: Modes, test: StatePredSchema }),
    z.strictObject({ at: z.literal('endless'), test: StatePredSchema }),
    z.strictObject({ at: z.literal('run'), test: StatePredSchema }),
    z.strictObject({ at: z.literal('ending'), endings: z.array(Id).min(1) }),
  ]),
});
