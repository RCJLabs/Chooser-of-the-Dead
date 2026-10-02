import type { Content, KenningDef } from '../content/types';
import type { DayCtx } from '../logic/context';
import type { CaseSpec, Field } from './types';

/*
 * Kennings in the tallies (docs/tech-spec.md §77): on days whose tallies a skald may cut, the rulebook has a page of
 * the kennings and sayings the skalds carve, and a forger faking a skald's hand may botch one.
 */

/** Whether the day's tallies may be a skald's, so the rulebook shows the page of kennings. */
export const kenningsToday = (ctx: DayCtx): boolean =>
  (ctx.spec.queue.knobs.kennings ?? 0) > 0 && (ctx.content.kennings?.length ?? 0) > 0;

/** The kenning a tally line carves, from the rulebook's page, and whether the forger botched it. */
export function kenningOf(
  content: Content,
  f: Field,
): { readonly kenning: KenningDef; readonly botched: boolean } | null {
  const kenning = f.kenning === undefined ? undefined : content.kennings?.find((k) => k.id === f.kenning);
  return kenning ? { kenning, botched: f.botched === true } : null;
}

/** How a soul's saga tally was cut: by a skald, in kennings, or by a forger who botched one; null if neither. */
export function skaldTally(c: CaseSpec): 'kennings' | 'botched' | null {
  const lines = c.evidence.fields.filter((f) => f.item === 'tally');
  if (lines.some((f) => f.botched)) return 'botched';
  return lines.some((f) => f.kenning !== undefined) ? 'kennings' : null;
}
