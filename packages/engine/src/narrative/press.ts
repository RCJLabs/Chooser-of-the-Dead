import type { Content, PressTemplate, QuestionKind, Value } from '../content/types';
import { weightedPick } from '../gen/pick';
import type { CaseSpec, Field } from '../gen/types';
import type { DayCtx } from '../logic/context';
import { eval2 } from '../logic/pred';
import { isPerceivable, solve } from '../logic/solver';
import { Rng } from '../rng/rng';
import { type QuestionResponse, questionResponse } from './questions';

/** What a soul added, pressed on a claim, is heard as a claim of its own: `said.<the claim's field>`. */
export const SAID = 'said.';

/** The claim a soul was holding to when it added `id`, or null if `id` isn't something it added. */
export const saidFrom = (id: string): string | null => (id.startsWith(SAID) ? id.slice(SAID.length) : null);

/** How a soul answers when pressed on a claim (docs/tech-spec.md §66). */
export interface PressAnswer {
  /** It gave way: its lie's own answer, as if caught and questioned. Otherwise it holds to the claim. */
  readonly gave: boolean;
  readonly kind: QuestionKind | 'hold';
  readonly template: string;
  readonly lines: QuestionResponse['lines'];
  readonly reveals: QuestionResponse['reveals'];
  /** What a soul holding to its claim added: a claim like any other, to compare with the evidence. */
  readonly said?: Field;
  /** The line it was said with. */
  readonly saidTemplate?: string;
}

const specificity = (t: PressTemplate): number =>
  (t.on.fact === '*' ? 0 : 1) + (t.on.value === undefined ? 0 : 1) + (t.on.persona === undefined ? 0 : 1);

/**
 * A pressed soul's line: every line that fits the claim and the voice, the more specific weighing more, avoiding
 * the last lines used. Nothing about whether the claim is true goes in.
 */
function pickLine(
  content: Content,
  kind: PressTemplate['on']['kind'],
  claim: { readonly fact: string; readonly value: Value },
  persona: string,
  recent: readonly string[],
  rng: Rng,
): PressTemplate | undefined {
  const fits = (content.pressLines ?? []).filter(
    (t) =>
      t.on.kind === kind &&
      (t.on.fact === '*' || t.on.fact === claim.fact) &&
      (t.on.value === undefined || t.on.value === claim.value) &&
      (t.on.persona === undefined || t.on.persona.includes(persona)),
  );
  const fresh = fits.filter((t) => !recent.includes(t.id));
  const pool = fresh.length > 0 ? fresh : fits;
  if (pool.length === 0) return undefined;
  return weightedPick(
    pool,
    pool.map((t) => t.weight * (1 + specificity(t))),
    rng,
  );
}

/** The soul's name, and the words its lines already use (its weapon, the place it fell), for what it adds. */
function lineParams(c: CaseSpec): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const f of c.evidence.fields) {
    for (const [k, v] of Object.entries(f.text?.params ?? {})) if (!(k in out)) out[k] = v;
  }
  const { name, patronym, gender } = c.evidence.look;
  return { ...out, name, patronym, gender };
}

function truthOf(c: CaseSpec, fact: string, ctx: DayCtx): Value | undefined {
  const derived = ctx.facts.get(fact)?.def.derived;
  return derived ? eval2(derived, c.truth, ctx) : c.truth[fact];
}

/**
 * What a soul holding to `field`'s claim adds, if anything (`press.yaml`'s details). True, it's said only where
 * nothing on the soul can seem to say otherwise (a forged tally could). False, only a liar holding to its lie lets
 * it slip, and only where the body or the ravens show it false, so a sharp player can catch it.
 */
function addition(
  c: CaseSpec,
  field: Field,
  lying: boolean,
  ctx: DayCtx,
  recent: readonly string[],
): Pick<PressAnswer, 'said' | 'saidTemplate'> {
  const claim = field.says;
  if (!claim || claim.value === null) return {};
  const perceivable = c.evidence.fields.filter((f) => isPerceivable(f, ctx));
  for (const d of ctx.content.press?.details ?? []) {
    if (d.on.fact !== claim.fact || d.on.claimed !== claim.value) continue;
    const af = ctx.facts.get(d.says.fact);
    if (!af || af.pinned) continue;
    // Nothing it has already said something about.
    if (c.evidence.fields.some((f) => f.item === 'testimony' && f.says?.fact === d.says.fact)) continue;
    const tpl = pickLine(
      ctx.content,
      'detail',
      d.says,
      c.evidence.persona,
      recent,
      new Rng(`${c.meta.seed}|said|${field.id}`),
    );
    const msg = tpl?.msgs[0];
    if (!tpl || msg === undefined) continue;
    const said: Field = {
      id: `${SAID}${field.id}`,
      item: 'testimony',
      salience: 3,
      cost: 0,
      says: { fact: d.says.fact, value: d.says.value },
      text: { msg, params: lineParams(c) },
    };
    const shownFalse = (fields: readonly Field[]) =>
      solve([...fields, said], ctx).contradictions.some((x) => x.lie === said.id);
    if (truthOf(c, d.says.fact, ctx) === d.says.value) {
      if (c.lies.some((l) => l.via === 'tally') || shownFalse(perceivable)) continue;
      return { said, saidTemplate: tpl.id };
    }
    if (lying && shownFalse(perceivable.filter((f) => f.item !== 'tally'))) return { said, saidTemplate: tpl.id };
  }
  return {};
}

/**
 * How a soul answers when pressed on the claim in `fieldId`, one of its testimony lines (docs/tech-spec.md §66).
 * Pressed on a lie it may give way, at the odds for how it talks (`press.yaml`), with the lie's own answer; Loki, who
 * deflects, never does. Otherwise it holds, in words chosen by the claim and the voice alone, so holding sounds the
 * same whether the claim is true or not, and it may add something (see `addition`). Deterministic per case and claim;
 * avoids the last lines used (`recent`). Null if the soul can't be pressed on it.
 */
export function pressAnswer(
  c: CaseSpec,
  fieldId: string,
  ctx: DayCtx,
  recent: readonly string[] = [],
): PressAnswer | null {
  const press = ctx.content.press;
  const field = c.evidence.fields.find((f) => f.id === fieldId);
  const claim = field?.says;
  if (!press || !field || field.item !== 'testimony' || !claim || claim.value === null) return null;
  const persona = c.evidence.persona;
  const lie = c.lies.find((l) => l.field === fieldId);
  if (lie && lie.onQuestion !== 'deflect') {
    const odds = Math.min(100, Math.max(0, press.gives[persona] ?? 0));
    if (new Rng(`${c.meta.seed}|press|${fieldId}`).chance(odds, 100)) {
      const r = questionResponse(c, fieldId, ctx.content, recent);
      if (r) return { gave: true, kind: r.kind, template: r.template, lines: r.lines, reveals: r.reveals };
    }
  }
  const hold = pickLine(
    ctx.content,
    'hold',
    { fact: claim.fact, value: claim.value },
    persona,
    recent,
    new Rng(`${c.meta.seed}|hold|${fieldId}`),
  );
  if (!hold) return null;
  const params = lineParams(c);
  return {
    gave: false,
    kind: 'hold',
    template: hold.id,
    lines: hold.msgs.map((msg) => ({ msg, params })),
    reveals: [],
    ...addition(c, field, lie !== undefined, ctx, recent),
  };
}
