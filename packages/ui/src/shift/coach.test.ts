import {
  type Content,
  type DayCtx,
  inspectable,
  type Lesson,
  type ShiftAction,
  type ShiftState,
  solve,
  startShift,
  stepShift,
} from '@cots/engine';
import { loadContent } from '@cots/testkit';
import { describe, expect, it } from 'vitest';
import type { Session } from '../store';
import { activeLesson, type CoachState, coachStep, PRIMER_STEPS } from './coach';

/*
 * Every lesson can be followed to its end on the souls the game really makes: a player who does exactly
 * what each step asks (and nothing else) sees every step through to the last, which waits for the stamp.
 */

const full = loadContent('dev-full');
const fresh: CoachState = { coached: [], primerDone: false, on: true };

const sessionOf = (content: Content, ctx: DayCtx, state: ShiftState, day: number): Session =>
  ({ mode: { kind: 'practice', day }, content, ctx, initial: state, state, actions: [] }) as unknown as Session;

/** Follows the coach on the day's first soul; returns the steps shown, in order. */
function follow(day: number, seed: string): { shown: string[]; lesson: Lesson | null } {
  const { state, ctx } = startShift(full, { mode: 'practice', seed, day });
  let st = stepShift(state, { t: 'begin', at: 0 }, ctx).state;
  const act = (a: ShiftAction) => {
    st = stepShift(st, a, ctx).state;
  };
  const acks: string[] = [];
  const shown: string[] = [];
  const lesson = activeLesson(sessionOf(full, ctx, st, day), fresh);
  for (let guard = 0; guard < 12; guard++) {
    const s = sessionOf(full, ctx, st, day);
    const now = coachStep(s, acks, lesson);
    if (!now) break;
    const { step } = now;
    if (shown[shown.length - 1] === step.id) throw new Error(`day ${day} ${seed}: step ${step.id} can't be done`);
    shown.push(step.id);
    const u = step.until;
    if (step.next) acks.push(step.id);
    else if (!u) break;
    else if ('flipped' in u) act({ t: 'flip', at: 0 });
    else if ('tool' in u) act(u.tool === 'flip' ? { t: 'flip', at: 0 } : { t: 'tool', tool: u.tool, at: 0 });
    else if ('seen' in u) act({ t: 'inspect', fields: inspectable(st, ctx).map((f) => f.id), at: 0 });
    else {
      // Catch the lie the way a player would: look at everything there is to look at, then compare.
      if (ctx.tools.has('flip') && !st.soul.flipped) act({ t: 'flip', at: 0 });
      for (const t of ctx.tools.keys()) if (t !== 'flip') act({ t: 'tool', tool: t, at: 0 });
      act({ t: 'inspect', fields: inspectable(st, ctx).map((f) => f.id), at: 0 });
      const c = st.cases[st.cursor];
      const seen = c?.evidence.fields.filter((f) => st.soul.seen.includes(f.id)) ?? [];
      const x = solve(seen, ctx).contradictions[0];
      const other = x?.against.find((id) => st.soul.seen.includes(id));
      if (x && other) act({ t: 'compare', a: x.lie, b: other, at: 0 });
    }
  }
  return { shown, lesson };
}

const lessonDays = full.days.filter((d) => d.lesson).map((d) => d.day);

describe('the coach', () => {
  it('has a lesson for every day that brings a new rule or tool, or a new way of carving the tallies (Day 18)', () => {
    expect(lessonDays).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16, 17, 18]);
  });

  it.each(lessonDays)('can be followed to the stamp on Day %i’s teaching soul', (day) => {
    const steps = full.days.find((d) => d.day === day)?.lesson?.steps ?? [];
    const last = steps[steps.length - 1]?.id;
    for (let n = 0; n < 25; n++) {
      const { shown, lesson } = follow(day, `coach-${day}-${n}`);
      expect(lesson).not.toBeNull();
      expect(shown[shown.length - 1]).toBe(last);
    }
  });

  it('teaches each day once, not once the primer taught Days 1-3, and not when turned off', () => {
    const { state, ctx } = startShift(full, { mode: 'practice', seed: 'once', day: 6 });
    const s = sessionOf(full, ctx, stepShift(state, { t: 'begin', at: 0 }, ctx).state, 6);
    expect(activeLesson(s, fresh)).not.toBeNull();
    expect(activeLesson(s, { ...fresh, coached: [6] })).toBeNull();
    expect(activeLesson(s, { ...fresh, on: false })).toBeNull();
    const d1 = startShift(full, { mode: 'practice', seed: 'once', day: 1 });
    const s1 = sessionOf(full, d1.ctx, stepShift(d1.state, { t: 'begin', at: 0 }, d1.ctx).state, 1);
    expect(activeLesson(s1, fresh)).not.toBeNull();
    expect(activeLesson(s1, { ...fresh, primerDone: true })).toBeNull();
  });

  it('keeps the primer’s three souls as they were', () => {
    expect(PRIMER_STEPS.map((steps) => steps.map((s) => s.id))).toEqual([
      ['c1.look', 'c1.chest', 'c1.rules', 'c1.stamp'],
      ['c2.words', 'c2.flip', 'c2.back', 'c2.compare', 'c2.judge'],
      ['c3.face', 'c3.feather', 'c3.stamp'],
    ]);
  });
});
