import type { Content, QuestionKind, QuestionTemplate, Value } from '../content/types';
import { weightedPick } from '../gen/pick';
import type { CaseSpec } from '../gen/types';
import { Rng } from '../rng/rng';

export interface QuestionResponse {
  readonly kind: QuestionKind;
  readonly template: string;
  readonly lines: readonly { readonly msg: string; readonly params: Readonly<Record<string, string | number>> }[];
  /** What the answer establishes (a confession reveals the truth). */
  readonly reveals: readonly { readonly fact: string; readonly value: Value }[];
}

function specificity(t: QuestionTemplate): number {
  return (
    (t.on.fact === '*' ? 0 : 1) +
    (t.on.claimed === undefined ? 0 : 1) +
    (t.on.truth === undefined ? 0 : 1) +
    (t.on.persona === undefined ? 0 : 1)
  );
}

/**
 * How a soul answers when questioned about a contradiction on `lieField`.
 * Deterministic per case; avoids the last 20 templates used (`recent`).
 */
export function questionResponse(
  c: CaseSpec,
  lieField: string,
  content: Content,
  recent: readonly string[] = [],
): QuestionResponse | null {
  const lie = c.lies.find((l) => l.field === lieField);
  if (!lie) return null;
  const persona = c.evidence.persona;
  const fits = content.questions.filter(
    (t) =>
      t.on.kind === lie.onQuestion &&
      (t.on.fact === '*' || t.on.fact === lie.fact) &&
      (t.on.claimed === undefined || t.on.claimed === lie.claimed) &&
      (t.on.truth === undefined || t.on.truth.includes(lie.truth)) &&
      (t.on.persona === undefined || t.on.persona.includes(persona)),
  );
  // Answers about a forged tally come before any more specific answer about a spoken lie, and never the other way.
  // A lie about a companion (docs/tech-spec.md §69) is only ever answered with lines for one, and they for nothing else.
  const told = fits.filter((t) => (t.on.about === true) === (lie.about !== undefined));
  const sameVia = told.filter((t) => t.on.via === lie.via);
  const matches = sameVia.length > 0 ? sameVia : told.filter((t) => t.on.via === undefined);
  if (matches.length === 0) return null;
  const best = Math.max(...matches.map(specificity));
  const top = matches.filter((t) => specificity(t) === best);
  const fresh = top.filter((t) => !recent.includes(t.id));
  const pool = fresh.length > 0 ? fresh : top;
  const rng = new Rng(`${c.meta.seed}|q|${lieField}`);
  const tpl = weightedPick(
    pool,
    pool.map((t) => t.weight),
    rng,
  );
  // A lie about a companion names them as its line did.
  const said = lie.about !== undefined ? c.evidence.fields.find((f) => f.id === lieField)?.text?.params : undefined;
  const params = {
    name: c.evidence.look.name,
    patronym: c.evidence.look.patronym,
    gender: c.evidence.look.gender,
    truth: String(lie.truth),
    ...(said?.companion !== undefined ? { companion: said.companion } : {}),
    ...(said?.cgender !== undefined ? { cgender: said.cgender } : {}),
  };
  return {
    kind: lie.onQuestion,
    template: tpl.id,
    lines: tpl.msgs.map((msg) => ({ msg, params })),
    // Owning up to a lie about a companion says nothing new about the soul itself.
    reveals: lie.onQuestion === 'confess' && lie.about === undefined ? [{ fact: lie.fact, value: lie.truth }] : [],
  };
}
