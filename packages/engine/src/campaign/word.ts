import type { Content, Destination, WordDef, WordLevel } from '../content/types';
import type { CaseSpec } from '../gen/types';
import { type DayCtx, soulCtx } from '../logic/context';
import { solve } from '../logic/solver';
import type { FoundAsk, RunState } from './state';

/*
 * Word among the dead (docs/tech-spec.md §73). The line talks. Each soul's ask granted at the audit (a plea, or rings
 * offered for a stamp) moves the word a step softer, and each refused a step sterner. From the next day on, its level
 * sets how often one of the day's own souls asks, how often the day's souls lie, and on the softest whether some who
 * ask bring rings. Only souls whose lies can be caught at the desk ask; one that asks and lies too, granted, is found
 * out a few mornings later, runs at the last battle with the misfits, and the word goes a step softer again: the dead
 * say the chooser can be fooled.
 */

/** The campaign's word, if it keeps one. */
export const wordDef = (content: Content): WordDef | undefined => content.campaign?.word;

/** Where the word stands: 0 until it moves. */
export const wordOf = (run: Pick<RunState, 'word'>): number => run.word ?? 0;

/** The level the word is at: the first whose `upTo` it doesn't pass, else the last. */
export function wordLevel(def: WordDef, word: number): WordLevel {
  return def.levels.find((l) => l.upTo === undefined || word <= l.upTo) ?? (def.levels.at(-1) as WordLevel);
}

/** The run's level, where the campaign keeps the word. */
export function levelFor(content: Content, run: Pick<RunState, 'word'>): WordLevel | undefined {
  const def = wordDef(content);
  return def ? wordLevel(def, wordOf(run)) : undefined;
}

/** The word moved by `by` steps, within the campaign's bounds. */
export function movedWord(def: WordDef, word: number, by: number): number {
  return Math.max(-def.max, Math.min(def.max, word + by));
}

/** The day as the word leaves it: its souls, and those after a noon decree, lie at the level's share of its lie rate. */
export function withWord(ctx: DayCtx, level: WordLevel | undefined): DayCtx {
  if (!level || level.lies === 100) return ctx;
  const scaled = (cx: DayCtx): DayCtx => {
    const { knobs } = cx.spec.queue;
    const lieRate = Math.floor((knobs.lieRate * level.lies) / 100);
    return { ...cx, spec: { ...cx.spec, queue: { ...cx.spec.queue, knobs: { ...knobs, lieRate } } } };
  };
  const out = scaled(ctx);
  return ctx.noon ? { ...out, noon: { ...ctx.noon, ctx: scaled(ctx.noon.ctx) } } : out;
}

/**
 * Whether every lie a soul tells can be caught at the desk without questioning it: the evidence it carries shows each
 * one false. A lie about a companion (docs/tech-spec.md §69) is only ever told where the companion shows it false.
 */
export function liesCatchable(c: CaseSpec, ctx: DayCtx): boolean {
  const own = c.lies.filter((l) => l.about === undefined);
  if (own.length === 0) return true;
  const shown = new Set(
    solve(c.evidence.fields, soulCtx(ctx, c))
      .contradictions.filter(
        (x) => !x.against.some((id) => id.startsWith('q:')) && x.against.some((id) => id !== 'world'),
      )
      .map((x) => x.lie),
  );
  return own.every((l) => shown.has(l.field));
}

/**
 * What an ordinary soul offers at the desk (docs/tech-spec.md §73): rings for a stamp where it doesn't belong. Null
 * for a story soul, whose offer is written into its case (§47), and for one that offers nothing.
 */
export function ordinaryOffer(c: CaseSpec): { dest: Destination; rings: number } | null {
  return !c.script && c.offer && c.offer.stamp !== c.expect.dest ? { dest: c.offer.stamp, rings: c.offer.rings } : null;
}

/**
 * Whether a soul given the hall it asked for asked falsely (docs/tech-spec.md §73): an ordinary soul, not come for its
 * kin, that lied at the desk.
 */
export const askedFalsely = (c: CaseSpec): boolean => !c.script && !c.kin && c.lies.length > 0;

/**
 * The run on the morning of its `day`: the false asks due by then are found out (a slice's jump tells those it
 * skipped over, that morning), and each moves the word a step softer. `was` is the day the night was.
 */
export function foundOut(run: RunState, content: Content, was: number): { run: RunState; told: FoundAsk[] } {
  const def = wordDef(content);
  const due = (f: FoundAsk) => f.on > was && f.on <= run.day;
  const told = (run.found ?? []).filter(due).map((f) => ({ ...f, on: run.day }));
  if (!def || told.length === 0) return { run, told: [] };
  const found = (run.found ?? []).map((f) => (due(f) ? { ...f, on: run.day } : f));
  return { run: { ...run, found, word: movedWord(def, wordOf(run), told.length) }, told };
}
