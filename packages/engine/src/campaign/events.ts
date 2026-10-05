import type { Content, DayEventDef, DaySpec, EventSouls } from '../content/types';
import { generateCase, planDay, reachOf } from '../gen/generate';
import type { CaseSpec } from '../gen/types';
import { createDayContext, type DayCtx } from '../logic/context';
import { Rng } from '../rng/rng';
import { sealedOn } from './decrees';
import { guiseOn } from './loki';
import type { DayEventAt, RunState } from './state';
import { trailCtx, withTrail } from './trail';
import { weaveOf, weaveSoulsOn, wovenContent } from './weave';
import { levelFor, withWord } from './word';

/*
 * Day events (docs/tech-spec.md §52): a storm, a sickness, a battle, a feast. A run draws a few from its seed as it
 * begins and keeps them, so a day replayed from its morning has the same one. Each changes its day's line (some of
 * the day's own souls don't come, others do), the sun, and that night's bills and sickness, and never the rules:
 * the souls it brings are made and judged as any day's are.
 */

/**
 * The days an event can fall on: from `from` to `to` (and no later than the build's last day), each a campaign day
 * with no noon decree, whose raven already changes it.
 */
export function eventDays(content: Content): number[] {
  const def = content.campaign?.events;
  if (!def) return [];
  const last = Math.min(def.to, content.campaign?.lastDay ?? 0);
  const out: number[] = [];
  for (let d = def.from; d <= last; d++) {
    const spec = content.days.find((s) => s.day === d);
    if (spec?.economy && !spec.noon && !spec.queue.script) out.push(d);
  }
  return out;
}

/**
 * A run's day events, from its seed: `perRun` different events, each on a day it can come to (from its `since`), no
 * two on the same day or on days running. Fewer if the days run out.
 */
export function drawEvents(content: Content, seed: string): DayEventAt[] {
  const def = content.campaign?.events;
  if (!def) return [];
  const days = eventDays(content);
  const rng = new Rng(`${seed}|events`);
  const drawn: DayEventAt[] = [];
  for (const ev of rng.shuffle(def.pool)) {
    if (drawn.length >= def.perRun) break;
    const open = days.filter((d) => d >= ev.since && drawn.every((e) => Math.abs(e.day - d) > 1));
    if (open.length > 0) drawn.push({ day: rng.pick(open), id: ev.id });
  }
  return drawn.sort((a, b) => a.day - b.day);
}

/**
 * The event the run drew for `day`, if any. None on a day with a noon decree (`eventDays`), even for a run that drew
 * one there before the day had its decree (Day 18's came later, docs/tech-spec.md §59).
 */
export function eventOn(run: Pick<RunState, 'events'>, content: Content, day: number): DayEventDef | undefined {
  const at = run.events?.find((e) => e.day === day);
  if (!at || content.days.find((d) => d.day === day)?.noon) return undefined;
  return content.campaign?.events?.pool.find((e) => e.id === at.id);
}

/** `n` in percent `p`, to the nearest whole number (half up). */
const pct = (n: number, p: number | undefined): number => (p === undefined ? n : Math.floor((n * p + 50) / 100));

/** A day's spec as an event leaves it: its sun and the night's bills (its line is `eventLine`'s). */
export function withEvent(spec: DaySpec, ev: DayEventDef): DaySpec {
  const e = spec.economy;
  const c = ev.costsPct;
  const economy =
    e && c
      ? {
          ...e,
          costs: {
            hearth: pct(e.costs.hearth, c.hearth),
            food: pct(e.costs.food, c.food),
            medicine: pct(e.costs.medicine, c.medicine),
          },
        }
      : e;
  return { ...spec, sunS: pct(spec.sunS, ev.sunPct), ...(economy ? { economy } : {}) };
}

/** The souls an event brings to `day` (those it brings from a day on, or until one). */
export function eventSoulsOn(ev: DayEventDef, day: number): EventSouls[] {
  return (ev.souls ?? []).filter((s) => (s.since ?? 1) <= day && (s.until === undefined || day < s.until));
}

/** How many souls more an event makes `day`'s line (fewer, below 0): those it brings, less those who don't come. */
export function eventLineChange(ev: DayEventDef, day: number): number {
  return eventSoulsOn(ev, day).reduce((n, s) => n + s.n, 0) - (ev.fewer ?? 0);
}

/**
 * A change to a day's line (docs/tech-spec.md §52, §53): the last `fewer` of the day's own souls don't come, and
 * `souls` come among the rest.
 */
export interface LineEdit {
  /** Whose it is (`event|<id>` or `weave|<id>`): its places are drawn on a stream of its own. */
  readonly id: string;
  readonly fewer: number;
  readonly souls: readonly EventSouls[];
  /** Each soul it brings takes the place of one more of the day's own, so the line is as long (a weave's). */
  readonly swap?: boolean;
  /** Where its souls start in the procedural index, past the day's own, a rank's and each other edit's. */
  readonly index: number;
}

/** The changes the run makes to `day`'s line: its day event's, then its weave's (in place of as many of its own). */
export function lineEdits(run: Pick<RunState, 'events' | 'weave'>, content: Content, day: number): LineEdit[] {
  const ev = eventOn(run, content, day);
  const weave = weaveOf(run, content);
  const woven = weave ? weaveSoulsOn(content, weave, day) : [];
  return [
    ...(ev ? [{ id: `event|${ev.id}`, fewer: ev.fewer ?? 0, souls: eventSoulsOn(ev, day), index: 64 }] : []),
    ...(weave && woven.length > 0 ? [{ id: `weave|${weave.id}`, fewer: 0, souls: woven, index: 128, swap: true }] : []),
  ];
}

/**
 * A day's own line (`cases`, its teaching soul first when `front` is 1) as an edit leaves it: the last `fewer` of
 * its souls don't come (and as many more as it brings, for a swap), never the teaching soul, and the edit's souls come
 * at places drawn on a stream of its own, after the teaching soul. Each is made as the day's souls are, of its kind if
 * the generator can, bound for the first destination in `to` that kind reaches today; one who'd share a name with a
 * soul in the day's line is passed over for another. The souls that stay are the same with the edit or without it.
 */
export function editLine(
  seed: string,
  ctx: DayCtx,
  cases: readonly CaseSpec[],
  front: number,
  edit: LineEdit,
): CaseSpec[] {
  const reach = reachOf(ctx);
  const names = new Set(cases.map((c) => `${c.evidence.look.name} ${c.evidence.look.patronym}`));
  const brought: CaseSpec[] = [];
  let i = planDay(seed, ctx).count + edit.index;
  for (const s of edit.souls) {
    const to = s.to.find((d) => reach.get(s.kind)?.has(d) && ctx.destinations.has(d));
    if (!to) continue;
    for (let k = 0; k < s.n; k++) {
      for (let tries = 0; tries < 4; tries++, i++) {
        const c = generateCase(seed, ctx, i, to, { teach: s.kind }).case;
        const name = `${c.evidence.look.name} ${c.evidence.look.patronym}`;
        if (names.has(name)) continue;
        names.add(name);
        brought.push(c);
        i++;
        break;
      }
    }
  }
  const drop = edit.fewer + (edit.swap ? brought.length : 0);
  const line = cases.slice(0, Math.max(front + 1, cases.length - drop));
  const rng = new Rng(`${ctx.content.genVersion}|${seed}|${ctx.day}|${edit.id}`);
  for (const c of brought) line.splice(rng.int(front, line.length), 0, c);
  return line;
}

/** The spec the run plays `day` by: the day's own, with the event the run drew for it. */
export function daySpecFor(content: Content, run: Pick<RunState, 'events'>, day: number): DaySpec | undefined {
  const spec = content.days.find((d) => d.day === day);
  const ev = spec ? eventOn(run, content, day) : undefined;
  return spec && ev ? withEvent(spec, ev) : spec;
}

/**
 * The context `day` has without the run's weave (docs/tech-spec.md §53), which its own souls are made in before
 * they're seen under the weave; undefined for a run that isn't woven.
 */
export function unwovenContext(
  content: Content,
  run: Pick<RunState, 'seed' | 'events' | 'weave' | 'trail' | 'word' | 'sealed' | 'guises'>,
  day: number,
): DayCtx | undefined {
  if (!run.weave) return undefined;
  const { weave: _, ...plain } = run;
  return dayContext(content, plain, day);
}

/**
 * The context the run plays `day` in, its event included, its rules in the order of its weave (docs/tech-spec.md §53)
 * if it was begun woven, on the forger's trail (§71) once that begins, its souls lying as often as the word among
 * the dead has them (§73), its whims and claims as the decree sealed for it says (§79), and Loki in the guise he
 * wore that day (§80) (`runContext` is today's).
 */
export function dayContext(
  content: Content,
  run: Pick<RunState, 'seed' | 'events' | 'weave' | 'trail' | 'word' | 'sealed' | 'guises'>,
  day: number,
): DayCtx {
  const ctx = createDayContext(
    wovenContent(content, weaveOf(run, content)),
    day,
    run.seed,
    daySpecFor(content, run, day),
    sealedOn(run, day),
    guiseOn(run, content, day),
  );
  return withWord(withTrail(ctx, trailCtx(content, run, day)), levelFor(content, run));
}
