import type { ToolId } from '../content/types';
import type { DayCtx } from '../logic/context';
import { saidFrom } from '../narrative/press';
import { memberSoul, type ShiftAction, type ShiftState, stepShift, type Verdict } from './shift';

/**
 * What happened to each soul, rebuilt from a shift's action log. Reports
 * ("Report this soul"), alpha telemetry and replay files all read these, so
 * they agree with what the player actually did.
 */
export interface SoulTrace {
  readonly index: number;
  /** The actions taken while this soul was at the gate, ending with its send. */
  readonly actions: readonly ShiftAction[];
  /** Sun used while this soul was at the gate, penalties included. */
  readonly sunMs: number;
  readonly penaltyMs: number;
  readonly flipped: boolean;
  readonly tools: readonly ToolId[];
  /** Field ids looked at before the soul was sent. */
  readonly seen: readonly string[];
  /** Lies caught (testimony field ids): called out, or given up when pressed (docs/tech-spec.md §66). */
  readonly caught: readonly string[];
  readonly questioned: readonly string[];
  /** Claims the soul was pressed on. */
  readonly pressed: readonly string[];
  /** Compares that found nothing. */
  readonly badCompares: number;
  /** Null while the soul is still at the gate. */
  readonly verdict: Verdict | null;
}

interface Acc {
  actions: ShiftAction[];
  penaltyMs: number;
  badCompares: number;
}

/** Records the state of each soul at the desk: at a party (docs/tech-spec.md §69), every member's. */
function keep(last: Map<number, ShiftState['soul']>, state: ShiftState): void {
  const start = state.party?.start ?? state.cursor;
  const n = state.party?.souls.length ?? 1;
  for (let k = 0; k < n; k++) {
    const soul = memberSoul(state, k);
    if (soul) last.set(start + k, soul);
  }
}

/** Replays `actions` from `initial` and splits what happened by soul. */
export function traceShift(
  initial: ShiftState,
  actions: readonly ShiftAction[],
  ctx: DayCtx,
): { state: ShiftState; souls: SoulTrace[] } {
  const acc: Acc[] = initial.cases.map(() => ({ actions: [], penaltyMs: 0, badCompares: 0 }));
  const last = new Map<number, ShiftState['soul']>();
  let state = initial;
  for (const action of actions) {
    const cursor = state.cursor;
    const before = state;
    const r = stepShift(state, action, ctx);
    state = r.state;
    if (state === before || before.phase !== 'shift') continue;
    const a = acc[cursor];
    if (!a) continue;
    a.actions.push(action);
    keep(last, before);
    for (const e of r.events) {
      if (e.e === 'flipped' || e.e === 'toolUsed' || e.e === 'answer' || e.e === 'pressed') a.penaltyMs += e.penaltyMs;
      if (e.e === 'noConflict') {
        a.penaltyMs += e.penaltyMs;
        a.badCompares++;
      }
    }
  }
  // The soul still at the gate (if any) shows its current state.
  if (state.phase === 'shift') keep(last, state);

  const souls = initial.cases.map((_, i): SoulTrace => {
    const a = acc[i] as Acc;
    const soul = last.get(i);
    const verdict = state.verdicts[i] ?? null;
    const prevAt = i === 0 ? 0 : (state.verdicts[i - 1]?.atMs ?? 0);
    return {
      index: i,
      actions: a.actions,
      sunMs: verdict ? Math.max(0, verdict.atMs - prevAt) : 0,
      penaltyMs: a.penaltyMs,
      flipped: soul?.flipped ?? false,
      tools: soul?.tools ?? [],
      seen: soul?.seen ?? [],
      caught: soul ? [...new Set([...soul.flagged.map((f) => saidFrom(f.lie) ?? f.lie), ...(soul.gave ?? [])])] : [],
      questioned: soul?.questioned ?? [],
      pressed: soul?.pressed ?? [],
      badCompares: a.badCompares,
      verdict,
    };
  });
  return { state, souls };
}
