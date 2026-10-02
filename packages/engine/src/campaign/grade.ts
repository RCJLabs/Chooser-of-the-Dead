import type { CaseSpec } from '../gen/types';
import { type DayCtx, soulCtx } from '../logic/context';
import { solve } from '../logic/solver';
import { proofAsked, type ShiftState, shiftScore } from '../shift/shift';

/** A campaign day's grades (docs/tech-spec.md §49), best first. */
export const GRADES = ['flawless', 'sharp', 'steady', 'shaky', 'rough'] as const;
export type GradeId = (typeof GRADES)[number];

/**
 * How a campaign day was judged, for players who want to do it well (docs/tech-spec.md §49): its grade, and
 * what the grade was made of, so the audit can say what the next one up would take.
 */
export interface DayGrade {
  readonly grade: GradeId;
  /** Souls not judged rightly: a wrong stamp, a step skipped, or left in line when the sun set. */
  readonly mistakes: number;
  /** Souls with a lie the evidence lets a player catch, and how many were caught in one before their stamp. */
  readonly liars: number;
  readonly caught: number;
  /**
   * Souls judged rightly on a guess (docs/tech-spec.md §76): what the player had of them didn't settle it. Kept where
   * stamps are asked for proof, and absent elsewhere.
   */
  readonly lucky?: number;
  /** Sun left when the last soul was sent (0 when the sun set on the line). */
  readonly spareMs: number;
  /** Played with an assist that makes judging easier: a slower sun, or the rule tracker. */
  readonly assisted?: true;
}

/**
 * The day's grade:
 * - flawless: every soul judged rightly, and every liar caught in a lie before the stamp; where stamps are asked for
 *   proof (docs/tech-spec.md §76), none of them a guess;
 * - sharp: every soul judged rightly;
 * - steady: one soul not;
 * - shaky: two or three;
 * - rough: more.
 *
 * Only liars the evidence exposes count: the validator promises a contradiction only for lies that change a
 * judgment, so a lie that changes nothing may have none to find (it has never happened; see §49).
 */
export function dayGrade(shift: ShiftState, ctx: DayCtx): DayGrade {
  const mistakes = shift.verdicts.filter((v) => !v.correct).length;
  let liars = 0;
  let caught = 0;
  for (const v of shift.verdicts) {
    const c = shift.cases[v.index];
    if (!c || !exposable(c, ctx)) continue;
    liars++;
    if (v.stamped !== null && v.caught > 0) caught++;
  }
  const lucky = proofAsked(shift.config, ctx.content)
    ? shift.verdicts.filter((v) => v.correct && v.unproven !== undefined).length
    : undefined;
  const grade: GradeId =
    mistakes === 0
      ? caught === liars && (lucky ?? 0) === 0
        ? 'flawless'
        : 'sharp'
      : mistakes === 1
        ? 'steady'
        : mistakes <= 3
          ? 'shaky'
          : 'rough';
  const a = shift.config.assists;
  const assisted = (a?.sunPct !== undefined && a.sunPct !== 100) || a?.tracker === true;
  return {
    grade,
    mistakes,
    liars,
    caught,
    ...(lucky !== undefined ? { lucky } : {}),
    spareMs: shiftScore(shift).spareMs,
    ...(assisted ? { assisted: true } : {}),
  };
}

/** Whether soul `c` told a lie its evidence, all of it seen, shows false: a liar a player can catch. */
export function exposable(c: CaseSpec, ctx: DayCtx): boolean {
  if (c.lies.length === 0) return false;
  const exposed = solve(c.evidence.fields, soulCtx(ctx, c)).contradictions;
  return c.lies.some((l) => exposed.some((x) => x.lie === l.field));
}

/** A grade's place, best first: lower is better. */
export const gradeRank = (g: GradeId): number => GRADES.indexOf(g);

/**
 * Whether day `a` beats `b` as a personal best (docs/tech-spec.md §49): the better grade; at the same grade, one
 * played without assists; then more sun to spare.
 */
export function beatsDay(
  a: Pick<DayGrade, 'grade' | 'spareMs' | 'assisted'>,
  b: Pick<DayGrade, 'grade' | 'spareMs' | 'assisted'> | undefined,
): boolean {
  if (!b) return true;
  if (gradeRank(a.grade) !== gradeRank(b.grade)) return gradeRank(a.grade) < gradeRank(b.grade);
  if ((a.assisted === true) !== (b.assisted === true)) return a.assisted !== true;
  return a.spareMs > b.spareMs;
}
