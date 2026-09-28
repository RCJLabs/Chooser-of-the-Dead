import { type HotspotId, REGION_KEYS } from '@cots/art';
import { currentCase, type Lesson, type LessonStep, pressable, solve } from '@cots/engine';
import type { Session } from '../store';

/**
 * The coach (docs/tech-spec.md §11, §25): one short instruction at a time, for
 * the soul at the gate. The primer's steps teach its three souls; a day's
 * lesson (content, `lesson` in the day's spec) teaches the day's first soul
 * what's new that day. A step ends when the player has done the thing (looked
 * at the hands, searched the registry, caught the lie) or, for a reading step,
 * pressed Next; the last lasts until the soul is judged. Steps a soul can't
 * give (a lie to catch from an honest one) are left out. `focus` names what to
 * highlight (see `[data-coach~=…]` in styles.css).
 */

export const PRIMER_STEPS: readonly (readonly LessonStep[])[] = [
  [
    { id: 'c1.look', text: 'primer.c1.look', focus: 'hands', until: { seen: 'body.front.grip' } },
    { id: 'c1.chest', text: 'primer.c1.chest', focus: 'chest', until: { seen: 'body.front.woundsFront' } },
    { id: 'c1.rules', text: 'primer.c1.rules', focus: 'rules', next: true },
    { id: 'c1.stamp', text: 'primer.c1.stamp', focus: 'judge' },
  ],
  [
    { id: 'c2.words', text: 'primer.c2.words', focus: 'words', next: true },
    { id: 'c2.flip', text: 'primer.c2.flip', focus: 'flip', until: { flipped: true } },
    { id: 'c2.back', text: 'primer.c2.back', focus: 'back', until: { seen: 'body.back.woundsBack' } },
    { id: 'c2.compare', text: 'primer.c2.compare', focus: 'words back', until: { flagged: true } },
    { id: 'c2.judge', text: 'primer.c2.judge', focus: 'judge' },
  ],
  [
    { id: 'c3.face', text: 'primer.c3.face', focus: 'face', until: { seen: 'cue.breathFog' } },
    { id: 'c3.feather', text: 'primer.c3.feather', focus: 'feather', until: { tool: 'feather' } },
    { id: 'c3.stamp', text: 'primer.c3.stamp', focus: 'judge' },
  ],
];

/** Who still needs a lesson: the days already taught on this device, the primer, and the coach setting. */
export interface CoachState {
  readonly coached: readonly number[];
  readonly primerDone: boolean;
  readonly on: boolean;
  /** One-time tips already read here. */
  readonly tips?: readonly string[];
}

/**
 * The day's lesson, while its teaching soul is at the gate in a campaign or practice shift and this
 * device hasn't had it (nor, for Days 1-3, the primer, which teaches the same).
 */
export function activeLesson(s: Session, c: CoachState): Lesson | null {
  if (s.mode.kind !== 'campaign' && s.mode.kind !== 'practice') return null;
  if (!c.on || s.state.phase !== 'shift' || s.state.cursor !== 0) return null;
  const lesson = s.ctx.spec.lesson;
  if (!lesson || c.coached.includes(s.ctx.day) || (lesson.primer && c.primerDone)) return null;
  return currentCase(s.state)?.archetype === s.ctx.spec.queue.teachFirst ? lesson : null;
}

/** The sign the day's whim reads (`whim:freyjaWhim` → "hair" on a day Freyja wants red hair). */
function whimSign(s: Session, ref: string): string | undefined {
  const param = ref.slice('whim:'.length);
  const chosen = s.ctx.paramChoices[param]?.id;
  const is = s.ctx.spec.params?.[param]?.pool.find((c) => c.id === chosen)?.is;
  return is && 'fact' in is ? is.fact : undefined;
}

/** The coach's name for where the body shows a sign: its region ("hands" for either hand). */
function regionOf(sign: string): string | undefined {
  const region = (Object.keys(REGION_KEYS) as HotspotId[]).find((id) => REGION_KEYS[id].includes(sign));
  return region === 'handR' || region === 'handL' ? 'hands' : region;
}

/** The field a `seen` target means on the current soul, if it has one: a field id, or what the whim reads. */
function seenField(s: Session, target: string): string | undefined {
  const c = currentCase(s.state);
  if (!c) return undefined;
  if (target.startsWith('whim:')) {
    const sign = whimSign(s, target);
    return c.evidence.fields.find((f) => f.item === 'body' && f.obs?.key === sign)?.id;
  }
  return c.evidence.fields.some((f) => f.id === target) ? target : undefined;
}

/** Whether this soul lets the player do what a step waits on. */
function possible(step: LessonStep, s: Session): boolean {
  const u = step.until;
  const c = currentCase(s.state);
  if (!u || !c) return true;
  if ('seen' in u) return seenField(s, u.seen) !== undefined;
  if ('tool' in u) return s.ctx.tools.has(u.tool);
  if ('flipped' in u) return s.ctx.tools.has('flip');
  // A lie to catch: one the evidence can show false.
  return solve(c.evidence.fields, s.ctx).contradictions.length > 0;
}

function done(step: LessonStep, s: Session, acks: readonly string[]): boolean {
  if (step.next) return acks.includes(step.id);
  const u = step.until;
  const soul = s.state.soul;
  if (!u) return false;
  if ('seen' in u) {
    const f = seenField(s, u.seen);
    return f !== undefined && soul.seen.includes(f);
  }
  if ('tool' in u) return soul.tools.includes(u.tool);
  if ('flipped' in u) return soul.flipped;
  return soul.flagged.length > 0;
}

/** What to highlight for a step, with the whim's sign worked out. */
function focusOf(step: LessonStep, s: Session): string {
  return step.focus
    .split(/\s+/)
    .map((f) => (f.startsWith('whim:') ? (regionOf(whimSign(s, f) ?? '') ?? 'rules') : f))
    .join(' ');
}

/** The step to show now and what it highlights, or null when there's nothing to coach. */
export function coachStep(
  s: Session,
  acks: readonly string[],
  lesson: Lesson | null,
): { readonly step: LessonStep; readonly focus: string } | null {
  if (s.state.phase !== 'shift') return null;
  const steps = s.mode.kind === 'primer' ? (PRIMER_STEPS[s.state.cursor] ?? []) : (lesson?.steps ?? []);
  const step = steps.filter((st) => possible(st, s)).find((st) => !done(st, s, acks));
  return step ? { step, focus: focusOf(step, s) } : null;
}

/** The one-time tip for pressing a soul on what it said (docs/tech-spec.md §66). */
export const PRESS_TIP: LessonStep = { id: 'tip.press', text: 'coach.press', focus: 'words', next: true };

/**
 * A one-time tip, shown with the soul's words rather than in the coach's bar: the first time the soul at the gate
 * can be pressed on what it said, on a device that hasn't read it. Put away, it never comes back.
 */
export function tipStep(s: Session, c: CoachState): { readonly step: LessonStep; readonly focus: string } | null {
  if (!c.on || s.state.phase !== 'shift' || s.mode.kind === 'primer' || c.tips?.includes('press')) return null;
  // Never over a lesson: one thing to learn at a time.
  if (activeLesson(s, c)) return null;
  return pressable(s.state, s.ctx).length > 0 ? { step: PRESS_TIP, focus: PRESS_TIP.focus } : null;
}
