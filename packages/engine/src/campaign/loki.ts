import type { Content, GuiseDef } from '../content/types';
import { Rng } from '../rng/rng';
import type { ShiftState } from '../shift/shift';
import { dayAfter, type RunState, type WornGuise } from './state';

/*
 * Loki learns (docs/tech-spec.md §80). Loki comes to the gate in the campaign's first guise, with its tell. Each day he
 * is held at least once, he takes his next guise from the day after: the old tell is hidden and the next shows, in an
 * order drawn for the run, the first again after the last. Missed, or not met, he keeps the one that worked. Each
 * guise's tell is an observation, and laws, tagged with it; the day's context keeps only the guise he wears.
 */

/** The guises in the order a run's Loki takes them: the campaign's first, then the rest as the run's seed draws them. */
export function guiseOrder(content: Content, seed: string): GuiseDef[] {
  const [first, ...rest] = content.campaign?.loki?.guises ?? [];
  return first ? [first, ...new Rng(`${seed}|loki`).shuffle(rest)] : [];
}

/** The guise Loki wears on `day`, by id: the last he took by then, else the campaign's first; none without guises. */
export function guiseOn(run: Pick<RunState, 'guises'>, content: Content, day: number): string | undefined {
  let worn = content.campaign?.loki?.guises[0]?.id;
  for (const g of run.guises ?? []) if (g.day <= day) worn = g.guise;
  return worn;
}

/** The guise's def, by id. */
export function guiseDef(content: Content, id: string | undefined): GuiseDef | undefined {
  return content.campaign?.loki?.guises.find((g) => g.id === id);
}

/** How Loki fared at the gate today: held (stamped as the rules say), and let by (stamped otherwise). */
export function lokiToday(shift: ShiftState, content: Content): { readonly caught: number; readonly missed: number } {
  const fact = content.campaign?.loki?.fact;
  let caught = 0;
  let missed = 0;
  if (fact === undefined) return { caught, missed };
  for (const v of shift.verdicts) {
    if (shift.cases[v.index]?.truth[fact] !== true || v.stamped === null) continue;
    if (v.correct) caught++;
    else missed++;
  }
  return { caught, missed };
}

/**
 * What Loki learns from today: held at least once, his next guise from the day after, and the run flag that says it
 * for scenes (its place among the campaign's guises). Null when he keeps the one he wears, or the run has no next day.
 */
export function lokiLearns(
  run: Pick<RunState, 'guises' | 'seed' | 'day' | 'slice'>,
  content: Content,
  caught: number,
): { readonly guises: readonly WornGuise[]; readonly flag: string; readonly index: number } | null {
  const def = content.campaign?.loki;
  const campaign = content.campaign;
  if (!def || !campaign || caught === 0) return null;
  const next = dayAfter(run, campaign, run.day);
  if (next === null) return null;
  const order = guiseOrder(content, run.seed);
  const at = order.findIndex((g) => g.id === guiseOn(run, content, run.day));
  const guise = order[(at + 1) % order.length];
  if (!guise) return null;
  return {
    guises: [...(run.guises ?? []), { day: next, guise: guise.id }],
    flag: def.flag,
    index: def.guises.indexOf(guise),
  };
}
