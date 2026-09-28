import type { Value } from '../content/types';
import type { DayCtx } from '../logic/context';
import { eval2, type Truth } from '../logic/pred';
import { solve } from '../logic/solver';
import type { Field } from './types';

/*
 * Souls who come to the desk together (docs/tech-spec.md §69) speak of each other. What one says of a companion is
 * checked against the companion's own evidence, and only against what can't be wrong there (body signs, the ravens,
 * confessions): never a presumption or a saga tally, so a true word about a companion is never shown false.
 */

/** A companion's field as the soul speaking of it refers to it: `@<its place in the party>:<field id>`. */
export const memberField = (soul: number, field: string): string => `@${soul}:${field}`;

/** The party member and field an `@<member>:<field>` id names, or null for a soul's own field id. */
export function parseMemberField(id: string): { readonly soul: number; readonly field: string } | null {
  const m = /^@(\d+):(.+)$/.exec(id);
  return m ? { soul: Number(m[1]), field: m[2] as string } : null;
}

/** A fact's value in a truth, derived facts (a wound in the back means they fled) worked out. */
export function factValue(truth: Truth, fact: string, ctx: DayCtx): Value | undefined {
  const derived = ctx.facts.get(fact)?.def.derived;
  return derived ? eval2(derived, truth, ctx) : truth[fact];
}

/**
 * The companion's fields among `fields` that show its `fact` isn't `value`, or null when they show nothing of the
 * kind. `retracted`: what the companion has owned up to, questioned (a confession shows the truth).
 */
export function companionShows(
  fields: readonly Field[],
  fact: string,
  value: Value,
  ctx: DayCtx,
  retracted?: ReadonlyMap<string, { readonly fact: string; readonly value: Value } | null>,
): string[] | null {
  const b = solve(fields, ctx, { certainOnly: true, ...(retracted ? { retracted } : {}) }).beliefs.get(fact);
  if (!b || b.level < 3 || b.values.includes(value)) return null;
  const support = b.support.filter((id) => id !== 'world');
  return support.length > 0 ? support : null;
}
