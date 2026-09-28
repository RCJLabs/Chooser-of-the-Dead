import { evalPred, evalState, predPaths, type RunState, STATE_PATHS } from './campaign/state';
import { type AchievementDef, DESTINATIONS, type PlayMode, type StatePred } from './content/types';
import type { CaseSpec } from './gen/types';
import type { DayCtx } from './logic/context';
import { memberSoul, type ShiftAction, type ShiftState, shiftScore, type Verdict } from './shift/shift';
import { traceShift } from './shift/trace';

/*
 * Achievements (docs/tech-spec.md §34). Content says what earns each one: a test over the numbers of one
 * moment of play, the way endings test the run. The UI asks at each moment which are newly earned, and
 * keeps them; the engine only counts.
 *
 * - soul: a soul has just been judged.
 * - shift: a shift has just ended, its queue done or its sun set.
 * - endless: an Endless soul has just been scored.
 * - run: the campaign run has just changed (the paths endings read, STATE_PATHS).
 * - ending: a campaign run has just ended.
 */

/** A moment's numbers by name. */
export type Facts = Readonly<Record<string, number>>;

/** What a judged soul's tests can read. */
export const SOUL_FACTS: readonly string[] = [
  // 1 if it was judged rightly (the right stamp, and anything the soul needed done).
  'correct',
  // Lies it told, and how many of them the player called out.
  'lies',
  'caught',
  // Lies questioned, and how many of those confessed.
  'questioned',
  'confessed',
  // Skögul's hints taken on it.
  'hints',
  // 1 if it was judged after the sun set, in the grace before the gate shuts.
  'afterDusk',
  // 1 for a story soul.
  'story',
  // The mechanics day, and 1 if any assist was on.
  'day',
  'assisted',
  // 1 for the stamp it was sent with.
  ...DESTINATIONS.map((d) => `stamped.${d}`),
];

/** What a finished shift's tests can read. */
export const SHIFT_FACTS: readonly string[] = [
  // Souls in the queue, judged before dusk, judged rightly, judged wrongly; 1 if every soul was judged rightly.
  'total',
  'judged',
  'correct',
  'wrong',
  'perfect',
  // Lies told, called out, and not called out (souls left at dusk count their lies as missed).
  'lies',
  'caught',
  'missedLies',
  // Skögul's hints taken, lies questioned, and confessions.
  'hints',
  'questions',
  'confessions',
  // Percent of the sun left when the last soul was sent (0 at dusk, and with no sun at all).
  'sunLeft',
  // 1 if the sun set on the queue.
  'dusk',
  'day',
  // 1 if any assist was on; 1 for a shift with no sun.
  'assisted',
  'untimed',
];

/**
 * What an Endless run's tests can read: souls judged rightly (`score`), the round, strikes so far, and, where Endless
 * is a run (docs/tech-spec.md §68), its points and the curses it has taken.
 */
export const ENDLESS_FACTS: readonly string[] = ['score', 'round', 'strikes', 'points', 'curses'];

export type AchievementMoment =
  | { readonly at: 'soul'; readonly mode: PlayMode; readonly facts: Facts }
  | { readonly at: 'shift'; readonly mode: PlayMode; readonly facts: Facts }
  | { readonly at: 'endless'; readonly facts: Facts }
  | { readonly at: 'run'; readonly run: RunState }
  | { readonly at: 'ending'; readonly ending: string };

/** Whether a test at `at` may read `path` (the content linter checks every test with this). */
export function factPathOk(at: 'soul' | 'shift' | 'endless' | 'run', path: string): boolean {
  switch (at) {
    case 'soul':
      return SOUL_FACTS.includes(path);
    case 'shift':
      return SHIFT_FACTS.includes(path);
    case 'endless':
      return ENDLESS_FACTS.includes(path);
    case 'run':
      return STATE_PATHS.test(path);
  }
}

const anyAssist = (s: ShiftState): number => (s.config.assists && Object.keys(s.config.assists).length > 0 ? 1 : 0);

/** How many of the lies questioned on a soul confessed. */
function confessions(c: CaseSpec | undefined, questioned: readonly string[]): number {
  return questioned.filter((field) => c?.lies.find((l) => l.field === field)?.onQuestion === 'confess').length;
}

/**
 * A soul that has just been judged. `before` is the shift as it stood just before the soul was sent,
 * while its hints, questions and callouts are still on it.
 */
export function soulFacts(before: ShiftState, verdict: Verdict): Facts {
  const c = before.cases[verdict.index];
  // At a party (docs/tech-spec.md §69), the member's own state: the one turned to is only one of them.
  const soul = memberSoul(before, before.party ? verdict.index - before.party.start : 0) ?? before.soul;
  const facts: Record<string, number> = {
    correct: verdict.correct ? 1 : 0,
    lies: verdict.lies,
    caught: verdict.caught,
    questioned: soul.questioned.length,
    confessed: confessions(c, soul.questioned),
    hints: soul.hinted?.length ?? 0,
    afterDusk: !before.config.untimed && verdict.atMs >= before.sunMs ? 1 : 0,
    story: c?.script ? 1 : 0,
    day: before.config.day,
    assisted: anyAssist(before),
  };
  for (const d of DESTINATIONS) facts[`stamped.${d}`] = verdict.stamped === d ? 1 : 0;
  return facts;
}

/** A shift that has just ended, rebuilt from its action log so that hints and questions on every soul count. */
export function shiftFacts(initial: ShiftState, actions: readonly ShiftAction[], ctx: DayCtx): Facts {
  const { state, souls } = traceShift(initial, actions, ctx);
  const score = shiftScore(state);
  const lies = state.verdicts.reduce((n, v) => n + v.lies, 0);
  const caught = state.verdicts.reduce((n, v) => n + v.caught, 0);
  const untimed = state.config.untimed === true;
  return {
    total: score.total,
    judged: score.judged,
    correct: score.correct,
    wrong: score.citations,
    perfect: score.total > 0 && score.correct === score.total ? 1 : 0,
    lies,
    caught,
    missedLies: lies - caught,
    hints: souls.reduce((n, s) => n + s.actions.filter((a) => a.t === 'hint').length, 0),
    questions: souls.reduce((n, s) => n + s.questioned.length, 0),
    confessions: souls.reduce((n, s) => n + confessions(state.cases[s.index], s.questioned), 0),
    sunLeft: untimed || state.sunMs <= 0 ? 0 : Math.floor((score.spareMs * 100) / state.sunMs),
    dusk: state.endedBy === 'dusk' ? 1 : 0,
    day: state.config.day,
    assisted: anyAssist(state),
    untimed: untimed ? 1 : 0,
  };
}

/**
 * A test over a moment's facts. A test that reads a number the moment doesn't have fails rather than
 * guess: records kept from before achievements existed have only some of them.
 */
function decide(test: StatePred, facts: Facts): boolean {
  if (!predPaths(test).every((p) => Object.hasOwn(facts, p))) return false;
  return evalPred(test, (p) => facts[p] ?? 0);
}

function holds(a: AchievementDef, m: AchievementMoment): boolean {
  const w = a.when;
  switch (m.at) {
    case 'soul':
    case 'shift':
      return (
        (w.at === 'soul' || w.at === 'shift') && w.at === m.at && w.modes.includes(m.mode) && decide(w.test, m.facts)
      );
    case 'endless':
      return w.at === 'endless' && decide(w.test, m.facts);
    case 'run':
      return w.at === 'run' && evalState(w.test, m.run);
    case 'ending':
      return w.at === 'ending' && w.endings.includes(m.ending);
  }
}

/** The achievements `moment` earns that the player doesn't have yet, in content order. */
export function earnedAt(
  defs: readonly AchievementDef[],
  moment: AchievementMoment,
  have: (id: string) => boolean,
): string[] {
  return defs.filter((a) => !have(a.id) && holds(a, moment)).map((a) => a.id);
}
