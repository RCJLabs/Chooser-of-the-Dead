import type { Content, DraftDef } from '../content/types';
import { Rng } from '../rng/rng';
import { dayAfter, type RunState } from './state';

/*
 * Tomorrow's decree, sealed (docs/tech-spec.md §79). On a few nights a run, drawn from its seed, Odin's clerks send up
 * drafts of the next day's decree. A draft is the day's own params (Freyja's whim, and from Day 15 Odin's claim), each
 * drawn from the pool the day draws from anyway, so every draft is a day the fairness checks already prove. Sealing one
 * makes it the day's, and pleases one god and annoys another; sending both back leaves the day as its seed draws it.
 */

/**
 * The days a sealed decree can rule: from `from` to `to` (and no later than the build's last day), each with a param
 * to choose from and no noon decree, whose raven draws one again at noon.
 */
export function decreeDays(content: Content): number[] {
  const def = content.campaign?.decrees;
  if (!def) return [];
  const last = Math.min(def.to, content.campaign?.lastDay ?? 0);
  const out: number[] = [];
  for (let d = def.from; d <= last; d++) {
    const spec = content.days.find((s) => s.day === d);
    if (!spec || spec.noon) continue;
    if (Object.values(spec.params ?? {}).some((p) => p.pool.length >= 2)) out.push(d);
  }
  return out;
}

/** The days a run's decrees can be sealed for, from its seed: `perRun` of them, no two on days running. */
export function decreeDaysFor(content: Content, seed: string): number[] {
  const def = content.campaign?.decrees;
  if (!def) return [];
  const rng = new Rng(`${seed}|decrees`);
  const drawn: number[] = [];
  for (const d of rng.shuffle(decreeDays(content))) {
    if (drawn.length >= def.perRun) break;
    if (drawn.every((x) => Math.abs(x - d) > 1)) drawn.push(d);
  }
  return drawn.sort((a, b) => a - b);
}

/** One of tonight's drafts: whose it is, the day it would rule, what it chooses from each param's pool, and its words. */
export interface Draft {
  readonly def: DraftDef;
  readonly day: number;
  readonly choose: Readonly<Record<string, string>>;
  /** The decree's words for each param it chooses (string keys), as the day's morning reads them. */
  readonly texts: readonly string[];
}

/**
 * Tonight's drafts of tomorrow's decree: only at night, and only the night before one of the run's decree days. Each
 * draft takes its own entry of every param's pool, drawn for the run and the day, so no two drafts say the same.
 */
export function draftsTonight(run: Pick<RunState, 'phase' | 'day' | 'seed' | 'slice'>, content: Content): Draft[] {
  const campaign = content.campaign;
  const def = campaign?.decrees;
  if (!campaign || !def || run.phase !== 'night') return [];
  const day = dayAfter(run, campaign, run.day);
  if (day === null || !decreeDaysFor(content, run.seed).includes(day)) return [];
  const spec = content.days.find((s) => s.day === day);
  const rng = new Rng(`${run.seed}|decree|${day}`);
  const pools = Object.entries(spec?.params ?? {}).map(([name, p]) => ({ name, pool: rng.shuffle(p.pool) }));
  return def.drafts.map((d, i) => {
    const choose: Record<string, string> = {};
    const texts: string[] = [];
    for (const { name, pool } of pools) {
      const c = pool[i % pool.length];
      if (!c) continue;
      choose[name] = c.id;
      texts.push(c.text);
    }
    return { def: d, day, choose, texts };
  });
}

/** The decree sealed for `day` (docs/tech-spec.md §79): its choice from each of the day's params; none if none was. */
export function sealedOn(run: Pick<RunState, 'sealed'>, day: number): Readonly<Record<string, string>> | undefined {
  return run.sealed?.find((s) => s.day === day)?.choose;
}

/** The draft sealed for `day`, by its def: none if none was, or in a build without it. */
export function sealedDraft(run: Pick<RunState, 'sealed'>, content: Content, day: number): DraftDef | undefined {
  const id = run.sealed?.find((s) => s.day === day)?.draft;
  return id === undefined ? undefined : content.campaign?.decrees?.drafts.find((d) => d.id === id);
}
