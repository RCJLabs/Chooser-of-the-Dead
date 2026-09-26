import type { Content, Destination } from '../content/types';
import type { CaseSpec } from '../gen/types';
import type { DayCtx } from '../logic/context';
import { Rng } from '../rng/rng';

/*
 * Pleas (docs/tech-spec.md §51, §59): a soul asks, openly, for a hall where it doesn't belong. A story soul's plea is
 * written into its case; on some days an ordinary soul pleads too. The stamp is the answer: granted, it's a mistake all
 * the same, but the soul stands at Ragnarök in the hall it asked for.
 */

/**
 * What a soul asks for at the desk, where it doesn't belong: the stamp, and the words for it (given the soul's `name`
 * and `gender`). Granted, the stamp is a mistake all the same.
 */
export function pleaOf(content: Content, c: CaseSpec): { dest: Destination; text: string } | null {
  const plea = c.script ? content.scripted?.find((d) => d.id === c.script)?.plea : c.plea;
  return plea && plea.stamp !== c.expect.dest ? { dest: plea.stamp, text: plea.text } : null;
}

/**
 * The day's line with its plea (docs/tech-spec.md §59), if it has one. On `chance` percent of days from `from`, one of
 * the day's own souls asks for a hall the list lets souls of its hall ask for, and that is open today. It's drawn on a
 * stream of its own, and nothing else about the soul changes. Never a story soul, one who waited through the night,
 * or a soul that teaches the day's rule or its noon decree; and never on a day a story soul pleads.
 */
export function withPlea(content: Content, seed: string, ctx: DayCtx, cases: readonly CaseSpec[]): CaseSpec[] {
  const def = content.campaign?.pleas;
  const out = cases.slice();
  if (!def || ctx.day < def.from) return out;
  const story = ctx.spec.queue.scripted ?? [];
  if (story.some((s) => content.scripted?.find((d) => d.id === s.case)?.plea)) return out;
  const rng = new Rng(`${seed}|plea|${ctx.day}`);
  if (!rng.chance(def.chance, 100)) return out;
  const teach = ctx.spec.queue.teachFirst;
  const noonFirst = cases.findIndex((c) => c.noon);
  const asks = (c: CaseSpec) =>
    def.list.filter(
      (p) =>
        p.from === c.expect.dest &&
        p.to !== c.expect.dest &&
        (p.since ?? def.from) <= ctx.day &&
        ctx.destinations.has(p.to),
    );
  const open = cases
    .map((c, i) => ({ c, i, asks: asks(c) }))
    .filter(
      ({ c, i, asks }) =>
        asks.length > 0 &&
        c.script === undefined &&
        c.day === ctx.day &&
        !(i === 0 && c.archetype === teach) &&
        i !== noonFirst,
    );
  if (open.length === 0) return out;
  const chosen = open[rng.int(0, open.length - 1)];
  const plea = chosen?.asks[rng.int(0, chosen.asks.length - 1)];
  if (chosen && plea) out[chosen.i] = { ...chosen.c, plea: { stamp: plea.to, text: plea.text } };
  return out;
}
