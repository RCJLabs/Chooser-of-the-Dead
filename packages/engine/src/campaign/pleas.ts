import type { Content, Destination } from '../content/types';
import type { CaseSpec } from '../gen/types';
import type { DayCtx } from '../logic/context';
import { Rng } from '../rng/rng';
import type { RunState } from './state';
import { levelFor, liesCatchable, ordinaryOffer, wordDef } from './word';

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

/** Whether someone in the line asks already: a story soul who pleads, or one who waited through the night and asks. */
const asksAlready = (content: Content, cases: readonly CaseSpec[]): boolean =>
  cases.some((c) => c.kin !== undefined || pleaOf(content, c) !== null || ordinaryOffer(c) !== null);

/**
 * Whether a soul of the day's line may be given a plea, an offer or kin: one of the day's own (not a story soul, nor one
 * who waited through the night), not the soul that teaches the day's rule or its noon decree, and not given any already.
 */
function ordinary(ctx: DayCtx, cases: readonly CaseSpec[]): (c: CaseSpec, i: number) => boolean {
  const teach = ctx.spec.queue.teachFirst;
  // The day's first soul teaches its rule, wherever story souls stand in the line before it (a jarl at the gate).
  const first = cases.findIndex((c) => c.script === undefined);
  // The decree's first soul is the one made at its place in the day's own line (docs/tech-spec.md §45).
  const noonAt = ctx.noon?.at;
  return (c, i) =>
    c.script === undefined &&
    c.day === ctx.day &&
    c.plea === undefined &&
    c.offer === undefined &&
    c.kin === undefined &&
    !(i === first && c.archetype === teach) &&
    !(c.noon && c.procIndex === noonAt);
}

/**
 * The day's line with its plea (docs/tech-spec.md §59), if it has one. On `chance` percent of days from `from`, one of
 * the day's own souls asks for a hall the list lets souls of its hall ask for, and that is open today. It's drawn on a
 * stream of its own, and nothing else about the soul changes. Never a story soul, one who waited through the night,
 * or a soul that teaches the day's rule or its noon decree; and never on a day someone in the line asks already (a
 * story soul who pleads, or one who waited through the night), or kin have come (§60).
 *
 * Where the campaign keeps word among the dead (§73), the word's level sets the chance instead; only a soul whose lies
 * can all be caught at the desk asks; and on a level that brings offers, on its share of those days the soul offers
 * rings for a hall instead of pleading for it, drawn on a stream of its own, where the offers let souls of its hall.
 */
export function withPlea(
  content: Content,
  run: Pick<RunState, 'seed' | 'word'>,
  ctx: DayCtx,
  cases: readonly CaseSpec[],
): CaseSpec[] {
  const def = content.campaign?.pleas;
  const out = cases.slice();
  if (!def || ctx.day < def.from) return out;
  if (asksAlready(content, cases)) return out;
  const word = wordDef(content);
  const level = levelFor(content, run);
  const rng = new Rng(`${run.seed}|plea|${ctx.day}`);
  if (!rng.chance(level?.asks ?? def.chance, 100)) return out;
  const may = ordinary(ctx, cases);
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
    .filter(({ c, i, asks }) => asks.length > 0 && may(c, i) && (!word || liesCatchable(c, ctx)));
  if (open.length === 0) return out;
  const chosen = open[rng.int(0, open.length - 1)];
  const plea = chosen?.asks[rng.int(0, chosen.asks.length - 1)];
  if (!chosen || !plea) return out;
  const offers = (word?.offers ?? []).filter(
    (o) =>
      o.from === chosen.c.expect.dest &&
      o.to !== chosen.c.expect.dest &&
      (o.since ?? def.from) <= ctx.day &&
      ctx.destinations.has(o.to),
  );
  const offering = new Rng(`${run.seed}|offer|${ctx.day}`);
  if (level?.offers && offers.length > 0 && offering.chance(level.offers, 100)) {
    const offer = offers[offering.int(0, offers.length - 1)];
    if (offer) out[chosen.i] = { ...chosen.c, offer: { stamp: offer.to, rings: offer.rings } };
    return out;
  }
  out[chosen.i] = { ...chosen.c, plea: { stamp: plea.to, text: plea.text } };
  return out;
}

/** A name's gender, from its patronym: a daughter's ends -dottir. */
export const genderOfName = (name: string): 'm' | 'f' => (name.endsWith('dottir') ? 'f' : 'm');

/** The father's name in a patronym: Ketil, in Ketilsson and Ketilsdottir. */
const fatherIn = (patronym: string): string => patronym.replace(/s(?:son|dottir)$/, '');

/**
 * Whether a soul's name already says it's closer kin to the soul `name` than a husband, wife or cousin (docs/tech-spec.md
 * §60): the same father (Thora Ketilsdottir and Bjorn Ketilsson), or one's father named as the other is (Thora
 * Bjornsdottir and Bjorn Ketilsson). Such a soul isn't made its kin.
 */
function namedCloser(look: { readonly name: string; readonly patronym: string }, name: string): boolean {
  const [first = '', patronym = ''] = name.split(' ');
  const father = fatherIn(patronym);
  return fatherIn(look.patronym) === father || fatherIn(look.patronym) === first || look.name === father;
}

/** What the kin at the desk is to the soul it came for (docs/tech-spec.md §60): a husband or wife, else a cousin. */
export function kinRelation(gender: 'm' | 'f', kin: string): 'wife' | 'husband' | 'cousin' {
  if (gender === genderOfName(kin)) return 'cousin';
  return gender === 'f' ? 'wife' : 'husband';
}

/**
 * The day's line with kin at the desk (docs/tech-spec.md §60), if they come. On `chance` percent of days from `from`,
 * when the run sent a soul to a hall where it didn't belong at least `after` days before, and that soul's kin haven't
 * come yet, one of the day's own souls is its kin. Unless it belongs where that soul went, it asks to go there too.
 * Drawn on a stream of its own, as pleas are; never for a story soul (the story has its own kin), never to a soul that
 * teaches, waited through the night, is a story soul, or whose name makes it closer kin already, and never on a day
 * someone in the line asks already.
 */
export function withKin(
  content: Content,
  run: Pick<RunState, 'seed' | 'named' | 'kin'>,
  ctx: DayCtx,
  cases: readonly CaseSpec[],
): CaseSpec[] {
  const def = content.campaign?.kin;
  const out = cases.slice();
  if (!def || ctx.day < def.from) return out;
  // One soul a day at most asks for another hall or comes for its kin: none come while one in the line does already (a
  // story soul who pleads, or kin who waited through the night).
  if (asksAlready(content, cases)) return out;
  const story = new Set((content.scripted ?? []).map((d) => `${d.look.name} ${d.look.patronym}`));
  const come = new Set(run.kin ?? []);
  const wronged = (run.named ?? []).filter(
    (n) => n.runs && n.day <= ctx.day - def.after && !story.has(n.name) && !come.has(n.name),
  );
  if (wronged.length === 0) return out;
  const rng = new Rng(`${run.seed}|kin|${ctx.day}`);
  if (!rng.chance(def.chance, 100)) return out;
  const who = wronged[rng.int(0, wronged.length - 1)];
  if (!who) return out;
  const may = ordinary(ctx, cases);
  const open = cases
    .map((c, i) => ({ c, i }))
    .filter(({ c, i }) => may(c, i) && !namedCloser(c.evidence.look, who.name));
  if (open.length === 0) return out;
  const chosen = open[rng.int(0, open.length - 1)];
  if (!chosen) return out;
  const { c, i } = chosen;
  // Unless it belongs where the soul was sent, it asks to be sent there too, if that's open today.
  const asks = c.expect.dest !== who.hall && ctx.destinations.has(who.hall);
  out[i] = {
    ...c,
    kin: { name: who.name, day: who.day, hall: who.hall },
    ...(asks ? { plea: { stamp: who.hall, text: def.plea } } : {}),
  };
  return out;
}
