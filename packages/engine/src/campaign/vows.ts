import type { Content, VowDef } from '../content/types';
import type { DayCtx } from '../logic/context';
import { Rng } from '../rng/rng';
import { type ShiftState, shiftScore, sunElapsed } from '../shift/shift';
import { type DayGrade, exposable } from './grade';
import { dayAfter, type RunState, type VowSettled } from './state';

/*
 * Vows at the cup (docs/tech-spec.md §75), as saga heroes swore them over the cup (heitstrenging): each night a few
 * vows for the next day, drawn for the run and that day, and the player swears one or none. The day's audit settles
 * it: kept, it pays its rings; broken, it costs the standing the campaign says. A kept vow moves no standing, so vows
 * can't carry a run to an ending. Never in Story Mode, which has no sun and no fines.
 */

/**
 * Tonight's vows, for tomorrow, in the campaign's order: drawn for the run and the day, the same however the night
 * goes. None in Story Mode, outside the night, before the campaign's first night of vows, or on the last night. Under
 * the oath, never the vow it makes pointless (Skögul helps no one under it).
 */
export function vowOffer(run: RunState, content: Content): VowDef[] {
  const campaign = content.campaign;
  const def = campaign?.vows;
  if (!campaign || !def || run.story || run.phase !== 'night' || run.day < def.from) return [];
  const day = dayAfter(run, campaign, run.day);
  if (day === null) return [];
  const open = def.list.filter((v) => v.since <= day && !(v.kind === 'alone' && run.oath));
  const drawn = new Set(new Rng(`${run.seed}|vows|${day}`).shuffle(open).slice(0, def.offered));
  return open.filter((v) => drawn.has(v));
}

/** The vow sworn (tonight's, or the day's): undefined when none, or in a build without it. */
export function vowOf(run: Pick<RunState, 'vow'>, content: Content): VowDef | undefined {
  return run.vow === undefined ? undefined : content.campaign?.vows?.list.find((v) => v.id === run.vow);
}

/**
 * Whether the day's vow is broken already, at `at` in the shift, whatever comes after: a soul sent wrong; a liar
 * stamped uncaught; a stamp on a guess (docs/tech-spec.md §76); a question or a press; a hint; or less of the sun left
 * than was sworn to spare. A soul left in line at dusk breaks a vow to judge every one, but only once the sun has set
 * on it, so that's the audit's to say (`vowKept`).
 */
export function vowBroken(vow: VowDef, shift: ShiftState, ctx: DayCtx, at: number): boolean {
  const judged = shift.verdicts.filter((v) => v.stamped !== null);
  switch (vow.kind) {
    case 'clean':
      return judged.some((v) => !v.correct);
    case 'liars':
      return judged.some((v) => {
        const c = shift.cases[v.index];
        return v.caught === 0 && c !== undefined && exposable(c, ctx);
      });
    case 'proven':
      return judged.some((v) => v.unproven !== undefined);
    case 'silent':
      return (shift.questions ?? 0) > 0 || (shift.presses ?? 0) > 0;
    case 'alone':
      return (shift.hintsAsked ?? 0) > 0;
    case 'sun':
      return !shift.config.untimed && (shift.sunMs - sunElapsed(shift, at)) * 100 < shift.sunMs * (vow.spare ?? 0);
  }
}

/** Whether the day's vow was kept, the shift over: by its `grade` where the grade says (the liars, the mistakes). */
export function vowKept(vow: VowDef, shift: ShiftState, grade: DayGrade): boolean {
  switch (vow.kind) {
    case 'clean':
      return grade.mistakes === 0;
    case 'liars':
      return grade.caught === grade.liars;
    case 'proven':
      return shift.verdicts.every((v) => v.stamped === null || v.unproven === undefined);
    case 'silent':
      return (shift.questions ?? 0) === 0 && (shift.presses ?? 0) === 0;
    case 'alone':
      return (shift.hintsAsked ?? 0) === 0;
    case 'sun':
      return shift.endedBy === 'queue' && shiftScore(shift).spareMs * 100 >= shift.sunMs * (vow.spare ?? 0);
  }
}

/**
 * How the day's vow went, at its audit: kept, its rings; broken, the standing the campaign says. Undefined on a day
 * none was sworn for, in Story Mode, and in a build without vows.
 */
export function settleVow(
  run: RunState,
  shift: ShiftState,
  content: Content,
  grade: DayGrade | undefined,
): VowSettled | undefined {
  const def = content.campaign?.vows;
  const vow = vowOf(run, content);
  if (!def || !vow || !grade || run.story) return undefined;
  const kept = vowKept(vow, shift, grade);
  return { id: vow.id, kept, rings: kept ? vow.rings : 0, standing: kept ? {} : { ...def.broken } };
}
