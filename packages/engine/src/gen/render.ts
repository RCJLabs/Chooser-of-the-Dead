import type {
  Knobs,
  RavenTemplate,
  SpeechSlot,
  TallyTemplate,
  TestimonyTemplate,
  ToolId,
  Value,
} from '../content/types';
import type { DayCtx } from '../logic/context';
import { observe } from '../logic/judge';
import { eval2, type Truth } from '../logic/pred';
import { Rng } from '../rng/rng';
import type { PlannedLie } from './lies';
import { weightedPick } from './pick';
import type { Evidence, Field, ForgeryTell, Lie, Look } from './types';

interface SpeechLine {
  readonly slot: SpeechSlot;
  readonly asserts?: { readonly fact: string; readonly value: Value };
  readonly lie?: number;
}

/** What the soul will say: every lie, plus some truthful lines chosen by the speech slots' chances. */
export function planSpeech(truth: Truth, lies: readonly PlannedLie[], ctx: DayCtx, rng: Rng): SpeechLine[] {
  const lines: SpeechLine[] = [];
  for (const slot of ctx.content.speech) {
    if (slot.since > ctx.day) continue;
    if (!slot.fact) {
      if (rng.chance(slot.chance, 100)) lines.push({ slot: slot.slot });
      continue;
    }
    // A fact the soul's forged tally lies about stays unspoken: the truth from its own mouth would look like the lie.
    if (lies.some((l) => l.fact === slot.fact && l.via === 'tally')) continue;
    const lie = lies.findIndex((l) => l.fact === slot.fact);
    if (lie >= 0) {
      lines.push({ slot: slot.slot, asserts: { fact: slot.fact, value: (lies[lie] as PlannedLie).claimed }, lie });
    } else if (
      rng.chance(slot.chances?.[String(truth[slot.fact])] ?? slot.chance, 100) &&
      ctx.facts.get(slot.fact)?.pinned === false
    ) {
      lines.push({ slot: slot.slot, asserts: { fact: slot.fact, value: truth[slot.fact] as Value } });
    }
  }
  return lines;
}

export interface RavenPlan {
  readonly huginn: readonly { readonly fact: string; readonly value: Value }[];
  readonly muninn: 'identity' | 'forgot' | null;
  /** A fact of the soul's life Muninn remembers (Day 13 on). */
  readonly recall?: { readonly fact: string; readonly value: Value };
}

const hasRavenLine = (ctx: DayCtx, raven: 'huginn' | 'muninn', fact: string, value: Value) =>
  ctx.content.ravens.some((t) => t.raven === raven && t.asserts?.fact === fact && t.asserts.value === value);

/**
 * Huginn reports some decisive facts (truthfully); Muninn names the soul or
 * forgets. From Day 13 Muninn may also remember a decisive fact of the soul's
 * life, and Huginn may add a true fact that decides nothing, so the two can
 * seem to disagree: both are true, and the Order of Judgment settles it.
 * Those draws come after the older ones, so earlier days plan exactly as before.
 */
export function planRavens(truth: Truth, decisive: readonly string[], ctx: DayCtx, knobs: Knobs, rng: Rng): RavenPlan {
  const huginn: { fact: string; value: Value }[] = [];
  for (const fact of decisive) {
    if (huginn.length >= 2) break;
    const value = truth[fact] as Value;
    if (hasRavenLine(ctx, 'huginn', fact, value) && rng.chance(knobs.ravenRate, 100)) huginn.push({ fact, value });
  }
  const muninn = rng.chance(knobs.forgetRate, 100) ? 'forgot' : rng.chance(1, 2) ? 'identity' : null;

  if (knobs.huginnAside && huginn.length < 2) {
    const asides = [...ctx.facts.keys()].filter(
      (f) =>
        !decisive.includes(f) &&
        ctx.facts.get(f)?.pinned === false &&
        !huginn.some((h) => h.fact === f) &&
        hasRavenLine(ctx, 'huginn', f, truth[f] as Value),
    );
    if (asides.length > 0 && rng.chance(knobs.huginnAside, 100)) {
      const fact = rng.pick(asides);
      huginn.push({ fact, value: truth[fact] as Value });
    }
  }
  let recall: RavenPlan['recall'];
  if (knobs.muninnRecall && muninn !== 'forgot') {
    const lives = decisive.filter(
      (f) => !huginn.some((h) => h.fact === f) && hasRavenLine(ctx, 'muninn', f, truth[f] as Value),
    );
    if (lives.length > 0 && rng.chance(knobs.muninnRecall, 100)) {
      const fact = rng.pick(lives);
      recall = { fact, value: truth[fact] as Value };
    }
  }
  return { huginn, muninn, ...(recall ? { recall } : {}) };
}

/**
 * Words the soul's facts and claims fix (a fact's `words`: an Ulfberht is a sword), claims last, so a
 * soul who says its blade is an Ulfberht calls it a sword in every line. The art draws that weapon.
 * The archetype's or story soul's own words come first, so a fact can still overrule them.
 */
function pinnedWords(input: RenderInput, ctx: DayCtx): Map<string, string> {
  const shared = new Map<string, string>(Object.entries(input.words ?? {}));
  const pin = (fact: string, value: Value) => {
    const words = ctx.facts.get(fact)?.def.words?.[String(value)];
    for (const [pool, word] of Object.entries(words ?? {})) shared.set(pool, word);
  };
  for (const [fact, value] of Object.entries(input.truth)) pin(fact, value);
  for (const line of input.speech) if (line.asserts) pin(line.asserts.fact, line.asserts.value);
  for (const line of input.tally?.lines ?? []) pin(line.fact, line.value);
  return shared;
}

/**
 * Fills template placeholders. Each pool is drawn once per soul, so every line
 * that mentions the place, foe or weapon agrees; a mismatch would look like a lie.
 */
function fillParams(
  params: Readonly<Record<string, string>> | undefined,
  look: Look,
  ctx: DayCtx,
  shared: Map<string, string>,
  rng: Rng,
): Record<string, string | number> {
  const out: Record<string, string | number> = { name: look.name, patronym: look.patronym, gender: look.gender };
  for (const [key, poolId] of Object.entries(params ?? {})) {
    let value = shared.get(poolId);
    if (value === undefined) {
      const pool = ctx.content.pools[poolId];
      value = pool && pool.length > 0 ? rng.pick(pool) : key;
      shared.set(poolId, value);
    }
    out[key] = value;
  }
  return out;
}

/** Where a soul stands in its day, on days that spread their lines (knobs.spreadLines). */
export interface Voice {
  /** Seeds the day's decks; the same for every soul of the day. */
  readonly deck: string;
  /** The soul's place in the day's queue. */
  readonly index: number;
}

/**
 * One kind of line's deck for the day: its variants in a per-day order, each as often as its
 * weight and spaced out (smooth weighted round-robin), cut at a per-day point.
 */
function deal<T extends { readonly weight: number }>(all: readonly T[], seed: string): T[] {
  const rng = new Rng(seed);
  const order = rng.shuffle(all);
  const weights = order.map((t) => (t.weight > 0 ? t.weight : 0));
  const total = weights.reduce((a, b) => a + b, 0);
  const credit = order.map(() => 0);
  const deck: T[] = [];
  for (let n = 0; n < total; n++) {
    let best = 0;
    for (let i = 0; i < order.length; i++) {
      credit[i] = (credit[i] ?? 0) + (weights[i] ?? 0);
      if ((credit[i] ?? 0) > (credit[best] ?? 0)) best = i;
    }
    credit[best] = (credit[best] ?? 0) - total;
    deck.push(order[best] as T);
  }
  const cut = total > 0 ? rng.int(0, total - 1) : 0;
  return [...deck.slice(cut), ...deck.slice(0, cut)];
}

/**
 * Picks one of `fits` (the variants this soul can say) from `all` (every variant of this kind of line).
 * Without a voice it's a weighted draw, as it always was. With one, the soul says its turn's variant
 * in the day's deck, so neighbours in the queue rarely say the same thing; if its persona can't say
 * that one, it says the variant it can whose turns are furthest from its own. Either way the pick
 * depends only on (seed, day, index).
 */
function choose<T extends { readonly weight: number }>(
  fits: readonly T[],
  all: readonly T[],
  kind: string,
  voice: Voice | undefined,
  rng: Rng,
): T {
  if (!voice) {
    return weightedPick(
      fits,
      fits.map((t) => t.weight),
      rng,
    );
  }
  const deck = deal(all, `${voice.deck}|${kind}`);
  if (deck.length === 0) return fits[0] as T;
  const turn = voice.index % deck.length;
  const own = deck[turn] as T;
  if (fits.includes(own)) return own;
  // Only variants that are in the deck: a weight of 0 means never, as in a weighted draw.
  const dealt = fits.filter((t) => deck.includes(t));
  if (dealt.length === 0) return fits[0] as T;
  let best = dealt[0] as T;
  let bestGap = -1;
  for (const t of dealt) {
    let gap = deck.length;
    deck.forEach((d, p) => {
      if (d !== t) return;
      const away = Math.abs(p - turn);
      gap = Math.min(gap, away, deck.length - away);
    });
    if (gap > bestGap) {
      best = t;
      bestGap = gap;
    }
  }
  return best;
}

const kindOf = (asserts: { readonly fact: string; readonly value: Value } | undefined): string =>
  asserts ? `${asserts.fact}=${String(asserts.value)}` : '';

function pickTestimony(
  line: SpeechLine,
  persona: string,
  ctx: DayCtx,
  voice: Voice | undefined,
  rng: Rng,
): TestimonyTemplate | null {
  const all = ctx.content.testimony.filter(
    (t) =>
      t.slot === line.slot &&
      (line.asserts
        ? t.asserts?.fact === line.asserts.fact && t.asserts.value === line.asserts.value
        : t.asserts === undefined),
  );
  const fits = all.filter((t) => t.personas === undefined || t.personas.includes(persona));
  if (fits.length === 0) return null;
  return choose(fits, all, `testimony|${line.slot}|${kindOf(line.asserts)}`, voice, rng);
}

function pickRaven(
  raven: 'huginn' | 'muninn',
  kind: string,
  test: (t: RavenTemplate) => boolean,
  ctx: DayCtx,
  voice: Voice | undefined,
  rng: Rng,
): RavenTemplate | null {
  const matches = ctx.content.ravens.filter((t) => t.raven === raven && test(t));
  if (matches.length === 0) return null;
  return choose(matches, matches, `${raven}|${kind}`, voice, rng);
}

/** The tool that shows a forged tally's tell (the carving has to be read closely). */
export const TELL_TOOL: ToolId = 'runeLens';

export interface TallyPlan {
  /** What each carved line says, and the index of the lie it carries if it is forged. */
  readonly lines: readonly { readonly fact: string; readonly value: Value; readonly lie?: number }[];
  /** How a forged tally gives itself away; null for an honest one. */
  readonly tell: ForgeryTell | null;
}

const TELLS: readonly ForgeryTell[] = ['elderRune', 'mirroredRune', 'brokenFormula'];

const hasTallyLine = (ctx: DayCtx, fact: string, value: Value) =>
  (ctx.content.tallies ?? []).some((t) => t.asserts.fact === fact && t.asserts.value === value);

/**
 * The soul's saga tally, if it carries one (Day 11 on). A forger's tally
 * carves its lie, perhaps beside one true deed, and always shows a tell; an
 * honest tally (at the day's tallyRate) records up to two decisive facts.
 * On a campaign day of the forger's trail (docs/tech-spec.md §71) the tell is
 * one of the carver's two habits. A soul that carries `papers` (Loki's borrowed
 * faces) has a forged tally of true deeds: the face's, not its own.
 */
export function planTally(
  truth: Truth,
  lies: readonly PlannedLie[],
  decisive: readonly string[],
  ctx: DayCtx,
  knobs: Knobs,
  rng: Rng,
  papers?: 'forged',
): TallyPlan | null {
  const truths = decisive
    .filter((f) => hasTallyLine(ctx, f, truth[f] as Value))
    .map((fact) => ({ fact, value: truth[fact] as Value }));
  const hands = ctx.trail?.hands ?? TELLS;
  const forged = lies.findIndex((l) => l.via === 'tally');
  if (forged >= 0) {
    const lie = lies[forged] as PlannedLie;
    const extra = truths.filter((t) => t.fact !== lie.fact).slice(0, rng.chance(1, 2) ? 1 : 0);
    return { lines: [{ fact: lie.fact, value: lie.claimed, lie: forged }, ...extra], tell: rng.pick(hands) };
  }
  if (papers === 'forged') {
    // What the face it wears did, true of that face: any fact a tally can carve, in content order.
    const deeds = [...ctx.facts.keys()]
      .filter((f) => !ctx.facts.get(f)?.pinned && hasTallyLine(ctx, f, truth[f] as Value))
      .map((fact) => ({ fact, value: truth[fact] as Value }));
    if (deeds.length > 0) return { lines: deeds.slice(0, 2), tell: rng.pick(hands) };
  }
  if (!knobs.tallyRate || truths.length === 0 || !rng.chance(knobs.tallyRate, 100)) return null;
  return { lines: truths.slice(0, 2), tell: null };
}

function pickTally(fact: string, value: Value, ctx: DayCtx, voice: Voice | undefined, rng: Rng): TallyTemplate | null {
  const matches = (ctx.content.tallies ?? []).filter((t) => t.asserts.fact === fact && t.asserts.value === value);
  if (matches.length === 0) return null;
  return choose(matches, matches, `tally|${kindOf({ fact, value })}`, voice, rng);
}

export interface RenderInput {
  readonly truth: Truth;
  readonly lies: readonly PlannedLie[];
  readonly speech: readonly SpeechLine[];
  readonly ravens: RavenPlan;
  readonly tally?: TallyPlan | null;
  /** Cue keys to show, and which of them are decoys. */
  readonly cues: readonly { readonly key: string; readonly decoy: boolean }[];
  readonly look: Look;
  readonly persona: string;
  /** Set on days that spread their lines (knobs.spreadLines); otherwise each line is drawn at random. */
  readonly voice?: Voice;
  /** Words the archetype or story soul fixes (a fisherwoman's seax); the facts' own words win. */
  readonly words?: Readonly<Record<string, string>>;
}

export interface Rendered {
  readonly evidence: Evidence;
  readonly lies: readonly Lie[];
  readonly decoys: readonly string[];
  /** Lies that had no template to be spoken with (the case gets rejected). */
  readonly unspoken: number;
}

/** Turns the truth and plans into the fields the player sees. */
export function render(input: RenderInput, ctx: DayCtx, rng: Rng): Rendered {
  const { truth, look, persona, voice } = input;
  const fields: Field[] = [];
  const pinned = pinnedWords(input, ctx);
  const shared = new Map(pinned);

  for (const obs of ctx.observations) {
    if (obs.when && !eval2(obs.when, truth, ctx)) continue;
    fields.push({
      id: obs.doc ? `${obs.doc}.${obs.key}` : obs.tool ? `tool.${obs.tool}.${obs.key}` : `body.${obs.view}.${obs.key}`,
      item: obs.doc ?? 'body',
      ...(obs.doc ? {} : { view: obs.view }),
      ...(obs.tool ? { tool: obs.tool } : {}),
      salience: obs.salience,
      cost: obs.cost,
      obs: { key: obs.key, value: observe(obs, truth, ctx) },
    });
  }

  const decoys: string[] = [];
  for (const c of input.cues) {
    const def = ctx.cues.find((d) => d.key === c.key);
    if (!def) continue;
    const id = `cue.${c.key}`;
    fields.push({ id, item: 'body', view: def.view, salience: def.salience, cost: 0, cue: { key: c.key } });
    if (c.decoy) decoys.push(id);
  }

  const lies: Lie[] = [];
  let unspoken = 0;
  let n = 0;
  for (const line of input.speech) {
    const tpl = pickTestimony(line, persona, ctx, voice, rng);
    if (!tpl) {
      if (line.lie !== undefined) unspoken++;
      continue;
    }
    const id = `testimony.${n++}`;
    fields.push({
      id,
      item: 'testimony',
      salience: 3,
      cost: 2,
      ...(line.asserts ? { says: { fact: line.asserts.fact, value: line.asserts.value } } : {}),
      text: { msg: tpl.msg, params: fillParams(tpl.params, look, ctx, shared, rng) },
    });
    if (line.lie !== undefined) {
      const planned = input.lies[line.lie];
      if (planned) lies.push({ ...planned, field: id });
    }
  }

  let h = 0;
  for (const s of input.ravens.huginn) {
    const tpl = pickRaven(
      'huginn',
      kindOf(s),
      (t) => t.asserts?.fact === s.fact && t.asserts.value === s.value,
      ctx,
      voice,
      rng,
    );
    if (!tpl) continue;
    fields.push({
      id: `huginn.${h++}`,
      item: 'huginn',
      salience: 3,
      cost: 2,
      says: { fact: s.fact, value: s.value },
      text: { msg: tpl.msg, params: fillParams(tpl.params, look, ctx, shared, rng) },
    });
  }
  if (input.ravens.muninn) {
    const tag = input.ravens.muninn;
    const tpl = pickRaven('muninn', tag, (t) => t.tag === tag, ctx, voice, rng);
    if (tpl) {
      const params = fillParams(tpl.params, look, ctx, shared, rng);
      // A soul whose saga was cut again (its tally forged), on the forger's trail (docs/tech-spec.md §71): Muninn
      // can't find it, but he remembers the knife, and names the carver's other habit.
      const tell = input.tally?.tell;
      const hand =
        tag === 'forgot' && tell && ctx.trail ? (ctx.trail.hands.find((h) => h !== tell) ?? tell) : undefined;
      fields.push({
        id: 'muninn.0',
        item: 'muninn',
        salience: 3,
        cost: 2,
        ...(hand ? { hand } : {}),
        text: hand ? { msg: `rv.muninn.carved.${hand}`, params: {} } : { msg: tpl.msg, params },
      });
    }
  }
  const recall = input.ravens.recall;
  if (recall) {
    const tpl = pickRaven(
      'muninn',
      kindOf(recall),
      (t) => t.asserts?.fact === recall.fact && t.asserts.value === recall.value,
      ctx,
      voice,
      rng,
    );
    if (tpl) {
      fields.push({
        id: 'muninn.1',
        item: 'muninn',
        salience: 3,
        cost: 2,
        says: { fact: recall.fact, value: recall.value },
        text: { msg: tpl.msg, params: fillParams(tpl.params, look, ctx, shared, rng) },
      });
    }
  }

  // The saga tally last, on its own stream, so souls without one render exactly as before.
  if (input.tally) {
    const tallyRng = rng.fork('tally');
    input.tally.lines.forEach((line, i) => {
      const tpl = pickTally(line.fact, line.value, ctx, voice, tallyRng);
      if (!tpl) {
        if (line.lie !== undefined) unspoken++;
        return;
      }
      const id = `tally.${i}`;
      fields.push({
        id,
        item: 'tally',
        salience: 3,
        cost: 2,
        says: { fact: line.fact, value: line.value },
        text: { msg: tpl.msg, params: fillParams(tpl.params, look, ctx, shared, tallyRng) },
      });
      const planned = line.lie === undefined ? undefined : input.lies[line.lie];
      if (planned) lies.push({ ...planned, field: id });
    });
    if (input.tally.tell) {
      fields.push({
        id: 'tally.tell',
        item: 'tally',
        tool: TELL_TOOL,
        salience: 2,
        cost: 1,
        tell: input.tally.tell,
        text: { msg: `tell.${input.tally.tell}`, params: {} },
      });
    }
  }

  const words = pinned.size > 0 ? { words: Object.fromEntries(pinned) } : {};
  return { evidence: { fields, look, persona, ...words }, lies, decoys, unspoken };
}
