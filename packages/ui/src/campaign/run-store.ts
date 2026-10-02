import { gameContent } from 'virtual:content';
import {
  type DayCtx,
  dayContext,
  ENGINE_MAJOR,
  type RunAction,
  type RunEnv,
  type RunEvent,
  type RunSave,
  type RunState,
  recordAction,
  replayDay,
  resumeSave,
  runContext,
  type ShiftAction,
  type ShiftEvent,
  type ShiftState,
  shiftMods,
  startSave,
  startShift,
  stepRun,
  stepShift,
  weaveOpen,
} from '@cots/engine';
import { batch, signal } from '@preact/signals';
import { t } from '../i18n';
import type { SlotRecord } from '../save-data';
import { clearSlot, isFree, markUnreadable, SLOT_COUNT, slots, writeSlot } from '../saves';
import {
  clock,
  currentAssists,
  noteDayBest,
  noteEnding,
  resetSoulUi,
  resumeClockAt,
  type Screen,
  type Session,
  say,
  screen,
  session,
  settings,
  unlock,
} from '../store';

/*
 * The campaign's state in the app (docs/tech-spec.md §7): three save slots,
 * the run being played, and every action saved as it happens. The engine's
 * RunSave keeps each morning, so any day can be replayed from its start.
 */

export type { SlotRecord } from '../save-data';
export { loadSlots, SLOT_COUNT, slots, unreadable } from '../saves';

export interface Active {
  readonly slot: number;
  readonly record: SlotRecord;
  readonly run: RunState;
  readonly ctx: DayCtx;
  /** The save came from another engine version, so its day started again. */
  readonly rewound: boolean;
}

export const active = signal<Active | null>(null);
/** What the last night brought (family news, Draupnir), for the next morning. */
export const lastNight = signal<readonly RunEvent[]>([]);

function write(slot: number, save: RunSave, seenAt?: number): SlotRecord {
  const prev = slots.peek()[slot];
  const record: SlotRecord = {
    v: 1,
    rev: (prev?.rev ?? 0) + 1,
    savedAt: Date.now(),
    ...(seenAt !== undefined ? { seenAt } : {}),
    save,
  };
  void writeSlot(slot, record);
  return record;
}

export function deleteSlot(slot: number): void {
  if (active.peek()?.slot === slot) active.value = null;
  clearSlot(slot);
}

export function screenFor(run: RunState): Screen {
  return run.phase === 'morning'
    ? 'morning'
    : run.phase === 'shift'
      ? 'shift'
      : run.phase === 'audit'
        ? 'audit'
        : run.phase === 'night'
          ? 'night'
          : run.phase === 'ragnarok'
            ? 'ragnarok'
            : 'ending';
}

/** Steps the run, saves the action and returns what happened. Rejected and empty actions aren't saved. */
export function dispatch(action: RunAction): { run: RunState; events: readonly RunEvent[] } | null {
  const a = active.peek();
  if (!a) return null;
  const save = a.record.save;
  const env: RunEnv = { content: gameContent, ctx: a.ctx, ...(save.queue ? { queue: save.queue } : {}) };
  const r = stepRun(a.run, action, env);
  for (const e of r.events) {
    if (e.e === 'rejected') say(e.reason);
    else if (e.e === 'ended') noteEnding(e.ending);
    // The day's grade, kept as its best on this device if it beats the one kept (docs/tech-spec.md §49).
    else if (e.e === 'audited' && e.ledger.grade) noteDayBest(e.ledger.day, e.ledger.grade, r.state.oath === true);
  }
  if (r.state === a.run) return { run: a.run, events: r.events };
  const record = write(a.slot, recordAction(save, a.run, action, r.state));
  const ctx = r.state.day === a.run.day ? a.ctx : runContext(gameContent, r.state);
  active.value = { ...a, record, run: r.state, ctx };
  // Achievements (docs/tech-spec.md §34): the run as it is now, and an ending as it's reached.
  unlock(
    { at: 'run', run: r.state },
    ...r.events.flatMap((e) => (e.e === 'ended' ? [{ at: 'ending' as const, ending: e.ending }] : [])),
  );
  return { run: r.state, events: r.events };
}

/** The shift right after it began today, and the shift actions since (for soul reports). */
function shiftHistory(a: Active): { initial: ShiftState; actions: ShiftAction[] } | null {
  const save = a.record.save;
  const morning = save.mornings[save.mornings.length - 1];
  if (!morning) return null;
  let run = morning;
  let initial: ShiftState | null = null;
  const actions: ShiftAction[] = [];
  for (const action of save.log) {
    if (action.t === 'shift') actions.push(action.action);
    if (initial) continue;
    const env: RunEnv = { content: gameContent, ctx: a.ctx, ...(save.queue ? { queue: save.queue } : {}) };
    run = stepRun(run, action, env).state;
    if (action.t === 'beginShift') initial = run.shift;
  }
  return initial ? { initial, actions } : null;
}

/** Shift steps go through the run, so the audit, the save and the shift screen all agree. */
function campaignStep(state: ShiftState, action: ShiftAction): { state: ShiftState; events: ShiftEvent[] } {
  const r = dispatch({ t: 'shift', action });
  if (!r) return { state, events: [] };
  return { state: r.run.shift ?? state, events: r.events.flatMap((e) => (e.e === 'shift' ? [e.event] : [])) };
}

function heartbeat(): void {
  const a = active.peek();
  if (a?.run.phase === 'shift') active.value = { ...a, record: write(a.slot, a.record.save, clock()) };
}

function openShift(a: Active): void {
  const shift = a.run.shift;
  if (!shift) return;
  const history = shiftHistory(a);
  const s: Session = {
    mode: {
      kind: 'campaign',
      day: a.run.day,
      story: a.run.story,
      ...(a.run.requests ? { requests: a.run.requests } : {}),
      ...(a.run.vow ? { vow: a.run.vow } : {}),
    },
    content: gameContent,
    ctx: a.ctx,
    initial: history?.initial ?? shift,
    state: shift,
    actions: history?.actions ?? [],
    step: campaignStep,
    heartbeat,
  };
  resetSoulUi();
  session.value = s;
}

/** Opens a slot where it was left: mid-shift resumes paused, on the sun's own timeline. */
export function openSlot(slot: number): void {
  const found = slots.peek()[slot];
  if (!found) return;
  let resumed: { run: RunState; rewound: boolean; ctx: DayCtx };
  try {
    const r = resumeSave(found.save, gameContent, ENGINE_MAJOR);
    resumed = { ...r, ctx: runContext(gameContent, r.run) };
  } catch {
    // It reads, but the engine can't rebuild it (a day this build doesn't have, say): keep it as it
    // is, shown as unreadable.
    markUnreadable(slot, found);
    say(t('ui.campaign.unreadable.toast'));
    return;
  }
  const { run, rewound, ctx } = resumed;
  // Runs that ended before the gallery kept count still count, and what a run shows before achievements were kept.
  if (run.ending) noteEnding(run.ending);
  unlock({ at: 'run', run }, ...(run.ending ? [{ at: 'ending' as const, ending: run.ending }] : []));
  // An older engine can't replay today's actions: start the day again from its morning.
  const record =
    rewound || found.save.engine !== ENGINE_MAJOR
      ? write(slot, { ...replayDay(found.save, run.day), engine: ENGINE_MAJOR })
      : found;
  batch(() => {
    active.value = { slot, record, run, ctx, rewound };
    lastNight.value = [];
    session.value = null;
  });
  const a = active.peek();
  if (a && run.phase === 'shift' && run.shift) {
    const last = [...record.save.log]
      .reverse()
      .map((x) => (x.t === 'shift' ? x.action.at : x.t === 'beginShift' ? x.at : undefined))
      .find((at) => at !== undefined);
    const resumeAt = Math.max(last ?? 0, record.seenAt ?? 0);
    resumeClockAt(resumeAt);
    if (run.shift.phase === 'shift' && run.shift.clock.pausedAt === null) {
      dispatch({ t: 'shift', action: { t: 'pause', at: resumeAt } });
    }
    const now = active.peek();
    if (now) openShift(now);
  } else if (a && (run.phase === 'audit' || run.phase === 'night') && run.shift) {
    // The audit lists today's souls with their report buttons, which read the shift session.
    openShift(a);
  }
  screen.value = screenFor(run);
}

export function newCampaign(
  slot: number,
  story: boolean,
  slice?: 'play' | 'fromJump',
  oath = false,
  woven = false,
  origin?: string,
): void {
  // Never over a save, nor over something unreadable the player hasn't cleared.
  if (!isFree(slot)) return;
  // Run seeds are random; everything after is deterministic from the seed.
  const seed = `run:${Date.now().toString(36)}:${Math.floor(Math.random() * 1e9).toString(36)}`;
  // The oath (docs/tech-spec.md §49) isn't sworn in Story Mode.
  const sworn = oath && !story ? { oath: true } : {};
  // The Norns' weave (docs/tech-spec.md §53), once an ending on this device has opened it.
  const weave = woven && weaveOpen(gameContent, settings.peek().endingsSeen) ? { woven: true } : {};
  // Who she was in life (docs/tech-spec.md §72): never with the vertical slice.
  const who = origin && !slice ? { origin } : {};
  write(
    slot,
    startSave(gameContent, seed, ENGINE_MAJOR, { story, ...sworn, ...weave, ...who, ...(slice ? { slice } : {}) }),
  );
  openSlot(slot);
}

/** Goes back to the morning of `day`, discarding every later day. */
export function replayFrom(slot: number, day: number): void {
  const found = slots.peek()[slot];
  if (!found) return;
  write(slot, replayDay(found.save, day));
  openSlot(slot);
}

/** The first empty slot, where a replay can branch without losing anything; null when all are taken. */
export function emptySlot(): number | null {
  const i = Array.from({ length: SLOT_COUNT }, (_, k) => k).find(isFree);
  return i === undefined ? null : i;
}

/** Starts the morning of `day` again in an empty slot, from a copy of this run: the original keeps every day. */
export function branchFrom(slot: number, day: number): void {
  const found = slots.peek()[slot];
  const to = emptySlot();
  if (!found || to === null) return;
  write(to, replayDay(found.save, day));
  openSlot(to);
}

export function toGate(): void {
  // The day's shift takes up the assists as it begins, and the save keeps them with it.
  const run = active.peek()?.run;
  const story = run?.story === true;
  // Under the oath (docs/tech-spec.md §49) fines are never waived, so the shift doesn't keep that assist.
  const assists = currentAssists(!story && run?.oath !== true, story);
  const r = dispatch({ t: 'beginShift', at: clock(), ...(Object.keys(assists).length > 0 ? { assists } : {}) });
  const a = active.peek();
  if (!r || !a || a.run.phase !== 'shift') return;
  openShift(a);
  screen.value = 'shift';
}

/**
 * The morning's appeal heard at the desk (docs/tech-spec.md §40): the soul alone, with no sun, on the rules
 * and stamps of the day it was judged. Its stamp settles the appeal and the morning goes on; leaving from the
 * pause keeps the appeal for later.
 */
export function hearAppeal(): void {
  const a = active.peek();
  const appeal = a?.run.appeal;
  if (!a || !appeal || a.run.phase !== 'morning') return;
  // The rules of the day it was judged, in the order the run reads them (its weave's, docs/tech-spec.md §53).
  const ctx = dayContext(gameContent, a.run, appeal.day);
  const config = {
    mode: 'practice' as const,
    seed: a.run.seed,
    day: appeal.day,
    untimed: true,
    mods: shiftMods(a.run, gameContent),
  };
  const { state } = startShift(gameContent, config, [appeal.case]);
  const begin: ShiftAction = { t: 'begin', at: clock() };
  const back = () => {
    batch(() => {
      session.value = null;
      screen.value = 'morning';
    });
  };
  resetSoulUi();
  session.value = {
    mode: { kind: 'appeal', day: appeal.day, stamped: appeal.stamped },
    content: gameContent,
    ctx,
    initial: state,
    state: stepShift(state, begin, ctx).state,
    actions: [begin],
    done: (s) => {
      const stamped = s.state.verdicts[0]?.stamped ?? null;
      back();
      if (stamped) dispatch({ t: 'appeal', stamped });
    },
    leave: back,
  };
  screen.value = 'shift';
}

/** The morning's appeal turned away unheard: the verdict stands. */
export function letAppealStand(): void {
  dispatch({ t: 'appeal', stamped: null });
}

/** The morning's promotion taken or declined (docs/tech-spec.md §44). */
export function answerPromotion(accept: boolean): void {
  dispatch({ t: 'promotion', accept });
}

/** At night, back down a rank. */
export function stepDown(): void {
  dispatch({ t: 'stepDown' });
}

/** At night, a vow sworn at the cup for tomorrow (docs/tech-spec.md §75), or taken back (null). */
export function swearVow(id: string | null): void {
  dispatch({ t: 'vow', id });
}

export function endAudit(): void {
  if (dispatch({ t: 'endAudit' })) screen.value = 'night';
}

export function sleep(): void {
  const r = dispatch({ t: 'endNight' });
  if (!r) return;
  batch(() => {
    lastNight.value = r.events;
    session.value = null;
    screen.value = screenFor(r.run);
  });
}

/**
 * The hosts sent to the fronts in this order (docs/tech-spec.md §54), the chooser riding to `ride` (§58): how it went,
 * then the ending.
 */
export function marshal(order: readonly string[], ride?: string): void {
  const r = dispatch({ t: 'marshal', order, ...(ride ? { ride } : {}) });
  if (r?.run.battle) screen.value = 'battle';
}

/** From how the battle went, to the ending. */
export function toEnding(): void {
  screen.value = 'ending';
}

export function leaveCampaign(): void {
  batch(() => {
    session.value = null;
    active.value = null;
    screen.value = 'campaign';
  });
}
