import type { Content, TrailDef, TrailSuspect } from '../content/types';
import type { CaseSpec, Field, ForgeryTell } from '../gen/types';
import type { DayCtx, TrailCtx } from '../logic/context';
import { Rng } from '../rng/rng';
import { evalState, type RunState, type TrailMark } from './state';

/*
 * The forger's trail (docs/tech-spec.md §71). One of the valley's carvers, drawn for the run from its seed, cuts every
 * forged tally from the trail's first day on, and his knife has two habits of the three a forgery can show. Each
 * forged tally's tell is one of them; so are the papers Loki's borrowed faces carry; and where Muninn can't remember a
 * soul whose saga was cut again, he remembers the knife, and names the other. What the chooser sees at the desk is
 * pinned to the board as it's seen. No two carvers share both habits, so the two seen together name one man, and any
 * day with two marks or more shows both. On the trail's nights, once the hunt is on, the chooser may name him, once:
 * the right man, or another.
 */

/** The run's forger's trail, if its campaign has one. */
export function trailOf(content: Content): TrailDef | undefined {
  return content.campaign?.trail;
}

/** The carver who cuts the run's forged tallies: drawn from its seed, on a stream of its own. */
export function culpritOf(def: TrailDef, seed: string): TrailSuspect {
  return new Rng(`${seed}|trail`).pick(def.suspects);
}

/** The carver named, if one has been. */
export function namedOf(def: TrailDef, run: Pick<RunState, 'trail'>): TrailSuspect | undefined {
  const id = run.trail?.accused?.suspect;
  return id === undefined ? undefined : def.suspects.find((s) => s.id === id);
}

/**
 * The trail on `day` of the run: the carver's habits, which every forged tally cut for the day shows one of, and the
 * faces its story souls wear. None before its first day.
 */
export function trailCtx(content: Content, run: Pick<RunState, 'seed' | 'trail'>, day: number): TrailCtx | undefined {
  const def = trailOf(content);
  if (!def || day < def.since) return undefined;
  const culprit = culpritOf(def, run.seed);
  const named = namedOf(def, run);
  return { hands: culprit.hands, looks: { culprit: culprit.look, ...(named ? { named: named.look } : {}) } };
}

/** `ctx` on the trail: the day's, and its noon decree's (docs/tech-spec.md §45), which the afternoon's souls are made in. */
export function withTrail(ctx: DayCtx, trail: TrailCtx | undefined): DayCtx {
  if (!trail) return ctx;
  return { ...ctx, trail, ...(ctx.noon ? { noon: { ...ctx.noon, ctx: { ...ctx.noon.ctx, trail } } } : {}) };
}

/** The carvers the marks leave: those whose knife shows every habit pinned. The carver is always among them. */
export function suspectsLeft(def: TrailDef, marks: readonly Pick<TrailMark, 'hand'>[]): TrailSuspect[] {
  return def.suspects.filter((s) => marks.every((m) => s.hands.includes(m.hand)));
}

/** Whether the hunt is on: from the trail's first day, while its `when` holds. The board shows only then. */
export function huntOn(run: RunState, content: Content): boolean {
  const def = trailOf(content);
  return def !== undefined && run.day >= def.since && (def.when === undefined || evalState(def.when, run));
}

/** Whether the carver can be named tonight: one of the trail's nights, with the hunt on and nobody named yet. */
export function canAccuse(run: RunState, content: Content): boolean {
  const def = trailOf(content);
  return (
    def !== undefined &&
    run.phase === 'night' &&
    def.nights.includes(run.day) &&
    run.trail?.accused === undefined &&
    huntOn(run, content)
  );
}

/**
 * Whether what's seen at the desk today is pinned: from the trail's first day to its last night, until a carver is
 * named. Marks are pinned before the hunt is on, so the board has the day's when it opens.
 */
export function pinsToday(run: Pick<RunState, 'day' | 'trail'>, def: TrailDef): boolean {
  return run.day >= def.since && run.day <= Math.max(...def.nights) && run.trail?.accused === undefined;
}

/** A habit of the carver's that `f` shows: a forged tally's tell, or the knife as Muninn remembers it. */
const handOf = (f: Field): ForgeryTell | undefined => f.tell ?? f.hand;

/**
 * The day's line on the trail (docs/tech-spec.md §71): where two or more marks would all show the same habit, the last
 * soul with a forged tally has it show the carver's other one instead, so any day with marks enough shows both. What a
 * tally's tell is never decides a soul: any tell shows it forged.
 */
export function markTrail(cases: readonly CaseSpec[], ctx: DayCtx): CaseSpec[] {
  const trail = ctx.trail;
  const out = cases.slice();
  if (!trail) return out;
  const hands = cases.flatMap((c) => c.evidence.fields.flatMap((f) => handOf(f) ?? []));
  const first = hands[0];
  if (hands.length < 2 || first === undefined || hands.some((h) => h !== first)) return out;
  const other = trail.hands.find((h) => h !== first);
  if (other === undefined) return out;
  for (let i = out.length - 1; i >= 0; i--) {
    const c = out[i] as CaseSpec;
    if (c.evidence.fields.some((f) => f.tell !== undefined)) {
      out[i] = retold(c, other, trail);
      break;
    }
  }
  return out;
}

/** Soul `c` with its forged tally showing `hand`, and Muninn, where he remembers the knife, naming the other habit. */
function retold(c: CaseSpec, hand: ForgeryTell, trail: TrailCtx): CaseSpec {
  const other = trail.hands.find((h) => h !== hand) ?? hand;
  const fields = c.evidence.fields.map((f): Field => {
    if (f.tell !== undefined) return { ...f, tell: hand, text: { msg: `tell.${hand}`, params: {} } };
    if (f.hand !== undefined) return { ...f, hand: other, text: { msg: `rv.muninn.carved.${other}`, params: {} } };
    return f;
  });
  return { ...c, evidence: { ...c.evidence, fields } };
}
