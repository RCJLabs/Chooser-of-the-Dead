import {
  type Destination,
  isDestination,
  type PartyKindDef,
  type PartyLineTemplate,
  type QuestionKind,
  type Value,
} from '../content/types';
import { type DayCtx, soulCtx } from '../logic/context';
import { judge, withOverride } from '../logic/judge';
import { type Given, type SolveOptions, solve } from '../logic/solver';
import { Rng } from '../rng/rng';
import { companionShows, factValue, memberField } from './companions';
import { tierKnobs } from './generate';
import { type PlannedLie, withLiars } from './lies';
import { weightedPick } from './pick';
import { allows } from './sample';
import type { CaseSpec, Field, Lie, PartyTag } from './types';
import { type Companions, decisiveFacts, revealsOf, validateCase } from './validate';

/*
 * Linked souls (docs/tech-spec.md §69): souls from one fight or one ship's crew come to the desk together, and each
 * says something of another. What one says of a companion is checked against the companion's own evidence: a true word
 * is never shown false there, and a lie always is, so it can always be caught. A lie about a companion is a lie like
 * any other (a ring for catching it; from Day 16 it makes the soul a liar, so it can decide a hall). Nothing a soul
 * says of a companion changes what the companion is, or how it's judged.
 *
 * Parties are formed last, from a day's finished line: its own souls, those who waited, a day event's, a rank's, the
 * story souls, kin and pleas. A pass of its own over the line, on a stream of its own, so the line is otherwise the
 * same with or without it, and a day with no parties in its spec (the Daily, the demo's days) is left as it is.
 */

/** Halls a soul who lies about a companion must not be moved out of (the day's requests count on them). */
export interface LinkOptions {
  readonly keepHalls?: ReadonlySet<Destination>;
}

/**
 * Whether a soul can join a party: any but a story soul, whose story is its own, in none yet. Kin and pleas can: so a
 * day's parties are the same whoever comes for their kin or asks for a hall.
 */
const free = (c: CaseSpec): boolean => c.party === undefined && c.script === undefined;

/** Honoured halls: a lie that would send a companion to one it isn't bound for covers for them. */
const HONOURED: ReadonlySet<Destination> = new Set(['VALHALLA', 'FOLKVANGR']);

/**
 * The party whose first member stands at `i` in `cases`: where it starts and how many it is. Null when the soul at `i`
 * doesn't start one, or its members don't all stand after it in order (a queue made before parties, or edited since).
 */
export function partyAt(cases: readonly CaseSpec[], i: number): { start: number; size: number } | null {
  const tag = cases[i]?.party;
  if (tag?.index !== 0 || tag.size < 2) return null;
  for (let k = 1; k < tag.size; k++) {
    const m = cases[i + k]?.party;
    if (!m || m.id !== tag.id || m.index !== k) return null;
  }
  return { start: i, size: tag.size };
}

/** The party the soul at `i` belongs to, wherever it stands in it; null if it's in none. */
export function partyOf(cases: readonly CaseSpec[], i: number): { start: number; size: number } | null {
  const tag = cases[i]?.party;
  return tag ? partyAt(cases, i - tag.index) : null;
}

/** Every member of a party, as companions for the validator. */
function companionsOf(members: readonly CaseSpec[], ctx: DayCtx): Companions {
  return new Map(members.map((c, k) => [k, { case: c, ctx: soulCtx(ctx, c) }]));
}

/** The companions of the soul at `i` in `cases`, for the validator; undefined for a soul in no party. */
export function companionsAt(cases: readonly CaseSpec[], i: number, ctx: DayCtx): Companions | undefined {
  const span = partyOf(cases, i);
  return span ? companionsOf(cases.slice(span.start, span.start + span.size), ctx) : undefined;
}

/**
 * What the soul at `i` in `cases` said of its companions that their own evidence shows false, all of it seen: each
 * claim's field, and the fields that show it (`@<member>:<field>`). For a bot that looks at everything, as the solver's
 * `crossCaught`.
 */
export function crossCaughtAt(cases: readonly CaseSpec[], i: number, ctx: DayCtx): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const c = cases[i];
  const span = partyOf(cases, i);
  if (!c || !span) return out;
  for (const f of c.evidence.fields) {
    const mate = f.about ? cases[span.start + f.about.soul] : undefined;
    if (!f.about || !mate) continue;
    const soul = f.about.soul;
    const shows = companionShows(mate.evidence.fields, f.about.fact, f.about.value, soulCtx(ctx, mate));
    if (shows)
      out.set(
        f.id,
        shows.map((id) => memberField(soul, id)),
      );
  }
  return out;
}

/**
 * What a retinue settles about one of the jarl's sworn men (docs/tech-spec.md §70): the hall the jarl is bound for, as
 * far as `fields` (what's known of the jarl, with what was caught against him and what he owned up to) decides it.
 * While it doesn't, every hall the fact can name: the man is sworn, to a jarl not yet judged.
 */
export function lordGiven(
  lord: CaseSpec,
  fields: readonly Field[],
  fact: string,
  ctx: DayCtx,
  opts: Pick<SolveOptions, 'reveals' | 'crossCaught' | 'retracted'>,
  support: readonly string[],
): Given[] {
  const cx = soulCtx(ctx, lord);
  const halls = (cx.facts.get(fact)?.values ?? []).filter(isDestination);
  const j = solve(fields, cx, opts).judgment;
  return j.kind === 'determined' && halls.includes(j.dest)
    ? [{ fact, values: [j.dest], support }]
    : [{ fact, values: halls, support: [] }];
}

/**
 * What the soul at `i` in `cases` is given by its retinue (docs/tech-spec.md §70), everything of its jarl seen: the
 * hall he's bound for, resting on his own proof. Undefined for the jarl, and for a soul in no retinue.
 */
export function givenAt(cases: readonly CaseSpec[], i: number, ctx: DayCtx): Given[] | undefined {
  const c = cases[i];
  const span = partyOf(cases, i);
  const lord = c?.party?.lord;
  if (!c || !span || !lord || c.party?.index === lord.at) return undefined;
  const jarl = cases[span.start + lord.at];
  if (!jarl) return undefined;
  const support = [
    ...jarl.meta.proof.map((f) => memberField(lord.at, f)),
    ...(jarl.meta.crossProof ?? []).map((x) => memberField(x.soul, x.field)),
  ];
  const opts = { reveals: revealsOf(jarl.lies), crossCaught: crossCaughtAt(cases, span.start + lord.at, ctx) };
  return lordGiven(jarl, jarl.evidence.fields, lord.fact, ctx, opts, support);
}

/**
 * The words a party's lines share: one draw from each pool the kind names, so every member tells of the same place,
 * the same foe, the same ship.
 */
function partyWords(kind: PartyKindDef, ctx: DayCtx, rng: Rng): Map<string, string> {
  const out = new Map<string, string>();
  for (const pool of Object.values(kind.words)) {
    const words = ctx.content.pools[pool];
    if (words && words.length > 0 && !out.has(pool)) out.set(pool, rng.pick(words));
  }
  return out;
}

/** The pools each line's params come from, by the message the line was said with. */
function poolsByMsg(ctx: DayCtx): Map<string, Readonly<Record<string, string>>> {
  const out = new Map<string, Readonly<Record<string, string>>>();
  const content = ctx.content;
  for (const t of [...content.testimony, ...content.ravens, ...(content.tallies ?? [])]) {
    if (t.params && !out.has(t.msg)) out.set(t.msg, t.params);
  }
  return out;
}

/** The soul's lines, with every word drawn from a pool the party shares set to the party's. */
function withWords(c: CaseSpec, words: ReadonlyMap<string, string>, pools: ReturnType<typeof poolsByMsg>): CaseSpec {
  let changed = false;
  const fields = c.evidence.fields.map((f): Field => {
    const params = f.text && pools.get(f.text.msg);
    if (!f.text || !params) return f;
    let next: Record<string, string | number> | undefined;
    for (const [key, pool] of Object.entries(params)) {
      const word = words.get(pool);
      if (word === undefined || f.text.params[key] === word) continue;
      next ??= { ...f.text.params };
      next[key] = word;
    }
    if (!next) return f;
    changed = true;
    return { ...f, text: { msg: f.text.msg, params: next } };
  });
  return changed ? { ...c, evidence: { ...c.evidence, fields } } : c;
}

function pickLine(
  ctx: DayCtx,
  kind: string,
  fact: string,
  value: Value,
  persona: string,
  of: 'lord' | 'sworn' | undefined,
  rng: Rng,
): PartyLineTemplate | null {
  const fits = (ctx.content.partyLines ?? []).filter(
    (t) =>
      t.asserts.fact === fact &&
      t.asserts.value === value &&
      (t.kinds === undefined || t.kinds.includes(kind)) &&
      (t.of === undefined || t.of === of) &&
      (t.personas === undefined || t.personas.includes(persona)),
  );
  if (fits.length === 0) return null;
  return weightedPick(
    fits,
    fits.map((t) => t.weight),
    rng,
  );
}

/** Where a new line goes in a soul's evidence: after its last line of testimony, or after everything. */
function withField(fields: readonly Field[], field: Field): Field[] {
  let at = fields.length;
  fields.forEach((f, i) => {
    if (f.item === 'testimony') at = i + 1;
  });
  const out = fields.slice();
  out.splice(at, 0, field);
  return out;
}

/** A testimony id the soul doesn't use yet. */
function freshTestimonyId(fields: readonly Field[]): string {
  const used = new Set(fields.map((f) => f.id));
  let n = fields.filter((f) => f.item === 'testimony').length;
  while (used.has(`testimony.${n}`)) n++;
  return `testimony.${n}`;
}

const QUESTION_KINDS: readonly ('confess' | 'excuse')[] = ['confess', 'excuse'];

/**
 * The soul at party place `k`, saying of member `about` what's true, or with `lie`, a lie: dressed, judged and checked
 * as any soul is, with its companions' evidence. Null if it doesn't pass (a lie that would move it out of a hall the
 * day counts on, a line too many for the day's documents, no line to say it with).
 */
function speak(
  members: readonly CaseSpec[],
  k: number,
  about: number,
  fact: string,
  value: Value,
  lie: boolean,
  kind: PartyKindDef,
  words: ReadonlyMap<string, string>,
  ctx: DayCtx,
  rng: Rng,
  opts: LinkOptions,
): CaseSpec | null {
  const c = members[k] as CaseSpec;
  const mate = members[about] as CaseSpec;
  const cx = soulCtx(ctx, c);
  // In a retinue, what's said of the jarl, or of one of his men (docs/tech-spec.md §70).
  const lord = mate.party?.lord;
  const of = lord ? (about === lord.at ? 'lord' : 'sworn') : undefined;
  const tpl = pickLine(cx, kind.id, fact, value, c.evidence.persona, of, rng);
  if (!tpl) return null;
  const id = freshTestimonyId(c.evidence.fields);
  const params: Record<string, string | number> = {
    name: c.evidence.look.name,
    patronym: c.evidence.look.patronym,
    gender: c.evidence.look.gender,
    companion: mate.evidence.look.name,
    cgender: mate.evidence.look.gender,
  };
  for (const [key, pool] of Object.entries(kind.words)) {
    const word = words.get(pool);
    if (word !== undefined) params[key] = word;
  }
  const field: Field = {
    id,
    item: 'testimony',
    salience: 3,
    cost: 2,
    about: { soul: about, fact, value },
    text: { msg: tpl.msg, params },
  };
  const def = cx.content.parties;
  const actual = factValue(mate.truth, fact, cx) as Value;
  const lies: Lie[] = [...c.lies];
  if (lie) {
    const onQuestion: QuestionKind = weightedPick(
      QUESTION_KINDS,
      QUESTION_KINDS.map((q) => def?.onQuestion[q] ?? 0),
      rng,
    );
    const claimedDest = judge(withOverride(mate.truth, fact, value, cx), cx).dest;
    const loyal = HONOURED.has(claimedDest) && !HONOURED.has(mate.expect.dest);
    lies.push({
      field: id,
      fact,
      claimed: value,
      truth: actual,
      motive: loyal ? 'loyalty' : 'grudge',
      onQuestion,
      reveals: [],
      about,
    });
  }
  const planned: PlannedLie[] = lies.map(({ field: _, ...l }) => l);
  const truth = withLiars(c.truth, planned, cx);
  const expected = judge(truth, cx);
  if (expected.dest !== c.expect.dest && opts.keepHalls?.has(c.expect.dest)) return null;
  const evidence = { ...c.evidence, fields: withField(c.evidence.fields, field) };
  const decisive = decisiveFacts(truth, expected, cx);
  const knobs = tierKnobs(c.meta.tier, cx.spec.queue.knobs);
  const others = members.map((m, i) => (i === k ? { ...c, evidence, lies, truth } : m));
  const v = validateCase(
    evidence,
    truth,
    lies,
    expected,
    decisive,
    cx,
    knobs,
    companionsOf(others, ctx),
    givenAt(others, k, ctx),
  );
  if (!v.ok) return null;
  const { crossProof: _, ...meta } = c.meta;
  return {
    ...c,
    truth,
    lies,
    evidence,
    expect: expected,
    meta: {
      ...meta,
      decisive,
      proof: v.proof.fields,
      proofCostS: v.proof.costS,
      difficulty: v.difficulty,
      ...(v.proof.cross.length > 0 ? { crossProof: v.proof.cross } : {}),
    },
  };
}

/**
 * What member `k` says of member `about`: a fact of theirs the companion's own evidence settles (its body, the
 * ravens), true, or at the day's odds a lie that evidence shows false. Null when there's nothing it can say.
 */
function claimFor(
  members: readonly CaseSpec[],
  k: number,
  about: number,
  kind: PartyKindDef,
  words: ReadonlyMap<string, string>,
  ctx: DayCtx,
  rng: Rng,
  opts: LinkOptions,
): CaseSpec | null {
  const mate = members[about] as CaseSpec;
  const cx = soulCtx(ctx, mate);
  const settled = kind.claims.flatMap((fact) => {
    const af = cx.facts.get(fact);
    if (!af || af.pinned) return [];
    const actual = factValue(mate.truth, fact, cx);
    if (actual === undefined) return [];
    const shown = af.values.filter((v) => v !== actual && companionShows(mate.evidence.fields, fact, v, cx) !== null);
    return shown.length > 0 ? [{ fact, actual, shown }] : [];
  });
  if (settled.length === 0) return null;
  const pick = rng.pick(settled);
  const lieRate = cx.content.parties?.lie ?? 0;
  if (rng.chance(lieRate, 100)) {
    const told = speak(members, k, about, pick.fact, rng.pick(pick.shown), true, kind, words, ctx, rng, opts);
    if (told) return told;
  }
  return speak(members, k, about, pick.fact, pick.actual, false, kind, words, ctx, rng, opts);
}

/**
 * Member `k` of a retinue (docs/tech-spec.md §70), sworn to its jarl: the hall he's bound for set on him, then judged
 * and checked as any soul is, with his companions and what they settle. A man who fled, or whom an earlier rule
 * claims, is judged as before. Null if he doesn't pass, or his hall would move out of one the day counts on.
 */
function swear(members: readonly CaseSpec[], k: number, ctx: DayCtx, opts: LinkOptions): CaseSpec | null {
  const c = members[k] as CaseSpec;
  const lord = c.party?.lord;
  const jarl = lord && members[lord.at];
  if (!lord || !jarl || k === lord.at) return c;
  const cx = soulCtx(ctx, c);
  const truth = withOverride(c.truth, lord.fact, jarl.expect.dest, cx);
  const expected = judge(truth, cx);
  if (expected.dest !== c.expect.dest && opts.keepHalls?.has(c.expect.dest)) return null;
  const decisive = decisiveFacts(truth, expected, cx);
  const knobs = tierKnobs(c.meta.tier, cx.spec.queue.knobs);
  const others = members.map((m, i) => (i === k ? { ...c, truth } : m));
  const v = validateCase(
    c.evidence,
    truth,
    c.lies,
    expected,
    decisive,
    cx,
    knobs,
    companionsOf(others, ctx),
    givenAt(others, k, ctx),
  );
  if (!v.ok) return null;
  const { crossProof: _, ...meta } = c.meta;
  return {
    ...c,
    truth,
    expect: expected,
    meta: {
      ...meta,
      decisive,
      proof: v.proof.fields,
      proofCostS: v.proof.costS,
      difficulty: v.difficulty,
      ...(v.proof.cross.length > 0 ? { crossProof: v.proof.cross } : {}),
    },
  };
}

/** Every one of a retinue's men sworn to its jarl, in turn; null if any doesn't pass. */
function swearAll(members: readonly CaseSpec[], ctx: DayCtx, opts: LinkOptions): CaseSpec[] | null {
  let out = members.slice();
  for (let k = 0; k < out.length; k++) {
    const sworn = swear(out, k, ctx, opts);
    if (!sworn) return null;
    out = out.map((m, i) => (i === k ? sworn : m));
  }
  return out;
}

/**
 * A retinue formed (docs/tech-spec.md §70): its men sworn to the jarl, the jarl saying something of the first of them
 * (whether he stood fast decides where he goes), and each man something of the jarl (whose hall is his). A word from
 * the jarl that changes his own hall (a lie caught, from Day 16) swears his men again, to the hall he's bound for now;
 * if they can't be, he keeps his peace. Null if the men can't be sworn at all.
 */
function formRetinue(
  members: readonly CaseSpec[],
  kind: PartyKindDef,
  words: ReadonlyMap<string, string>,
  ctx: DayCtx,
  rng: Rng,
  opts: LinkOptions,
): CaseSpec[] | null {
  let men = swearAll(members, ctx, opts);
  if (!men) return null;
  const spoken = claimFor(men, 0, 1, kind, words, ctx, rng, opts);
  if (spoken) {
    const told = men.map((m, i) => (i === 0 ? spoken : m));
    const again = spoken.expect.dest === men[0]?.expect.dest ? told : swearAll(told, ctx, opts);
    if (again) men = again;
  }
  for (let k = 1; k < men.length; k++) {
    const said = claimFor(men, k, 0, kind, words, ctx, rng, opts);
    if (said) men = men.map((m, i) => (i === k ? said : m));
  }
  return men;
}

/**
 * The day's line with its parties formed (docs/tech-spec.md §69): as many as the day's spec asks for and its souls
 * allow, each of 2 or 3 souls of a kind (all fallen in battle, say) already standing together in the line, never at
 * its head (a day's first soul teaches its rule) nor across a noon decree. Each member says something of the next.
 * The line keeps its order; the line as it was when the day has no parties.
 */
export function linkParties(
  cases: readonly CaseSpec[],
  ctx: DayCtx,
  seed: string,
  opts: LinkOptions = {},
): readonly CaseSpec[] {
  const def = ctx.content.parties;
  const want = ctx.spec.queue.parties;
  if (!def || !want || (ctx.content.partyLines ?? []).length === 0) return cases;
  const kinds = def.kinds.filter((k) => k.since <= ctx.day);
  if (kinds.length === 0) return cases;
  const rng = new Rng(`${ctx.content.genVersion}|${seed}|${ctx.day}|parties`);
  const n = rng.int(want.n[0], want.n[1]);
  const pools = poolsByMsg(ctx);
  let line = cases.slice();
  for (let p = 0; p < n; p++) {
    // The day's first party is of the kind it leads with, where it has one (a retinue, the day its rule is new).
    const lead = p === 0 ? kinds.find((k) => k.id === want.lead) : undefined;
    const kind =
      lead ??
      weightedPick(
        kinds,
        kinds.map((k) => k.weight),
        rng,
      );
    // A retinue's jarl (docs/tech-spec.md §70) is bound for a hall his men can follow him to.
    const halls = kind.lord ? (ctx.facts.get(kind.lord)?.values ?? []).filter(isDestination) : [];
    const leads = (c: CaseSpec | undefined) => !kind.lord || (c !== undefined && halls.includes(c.expect.dest));
    const fits = (c: CaseSpec | undefined): c is CaseSpec =>
      c !== undefined &&
      free(c) &&
      Object.entries(kind.members).every(([fact, rule]) => {
        const v = factValue(c.truth, fact, soulCtx(ctx, c));
        return v !== undefined && allows(rule, v);
      });
    // Souls of the kind standing together in the line, made under the same rules, with names of their own: one who
    // says "Ketil" means one soul. Never the head of the line, whose soul teaches the day's rule.
    const together = (first: number, size: number): boolean => {
      const run = line.slice(first, first + size);
      const noon = run[0]?.noon === true;
      return (
        run.length === size &&
        run.every((c) => fits(c) && (c.noon === true) === noon) &&
        leads(run[0]) &&
        new Set(run.map((c) => c.evidence.look.name)).size === size
      );
    };
    const wanted = rng.int(kind.size[0], kind.size[1]);
    const sizes = [wanted, ...[3, 2].filter((x) => x !== wanted && x >= kind.size[0] && x <= kind.size[1])];
    const size = sizes.find((x) => line.some((_, i) => i > 0 && together(i, x)));
    if (size === undefined) continue;
    const windows = line.flatMap((_, i) => (i > 0 && together(i, size) ? [i] : []));
    const picked = rng.pick(windows);
    const words = partyWords(kind, ctx, rng.fork(`words${p}`));
    const speakRng = rng.fork(`claims${p}`);
    // The window drawn, then (a retinue whose men can't be sworn there) each one after it in the line, in turn.
    const tries = kind.lord ? [...windows.filter((i) => i >= picked), ...windows.filter((i) => i < picked)] : [picked];
    for (const first of tries) {
      const formed = form(line, first, size, kind, words, pools, ctx, speakRng, opts);
      if (!formed) continue;
      line = [...line.slice(0, first), ...formed, ...line.slice(first + size)];
      break;
    }
  }
  return line;
}

/** The party of `kind` formed from the `size` souls at `first` in `line`: its members, or null if it can't be. */
function form(
  line: readonly CaseSpec[],
  first: number,
  size: number,
  kind: PartyKindDef,
  words: ReadonlyMap<string, string>,
  pools: ReturnType<typeof poolsByMsg>,
  ctx: DayCtx,
  rng: Rng,
  opts: LinkOptions,
): CaseSpec[] | null {
  const run = line.slice(first, first + size);
  const jarl = kind.lord ? run[0] : undefined;
  const tag = (k: number): PartyTag => ({
    id: `party:${(line[first] as CaseSpec).id}`,
    kind: kind.id,
    index: k,
    size,
    title: {
      msg: kind.title,
      params: {
        ...Object.fromEntries(
          Object.entries(kind.words).flatMap(([key, pool]) => {
            const word = words.get(pool);
            return word === undefined ? [] : [[key, word]];
          }),
        ),
        ...(jarl ? { lord: jarl.evidence.look.name, lgender: jarl.evidence.look.gender } : {}),
      },
    },
    ...(kind.lord ? { lord: { at: 0, fact: kind.lord } } : {}),
  });
  const members: CaseSpec[] = run.map((c, k) => ({ ...withWords(c, words, pools), party: tag(k) }));
  if (kind.lord) return formRetinue(members, kind, words, ctx, rng, opts);
  let out = members;
  let said = 0;
  for (let k = 0; k < size; k++) {
    const spoken = claimFor(out, k, (k + 1) % size, kind, words, ctx, rng, opts);
    if (!spoken) continue;
    out = out.map((m, i) => (i === k ? spoken : m));
    said++;
  }
  return said === 0 ? null : out;
}
