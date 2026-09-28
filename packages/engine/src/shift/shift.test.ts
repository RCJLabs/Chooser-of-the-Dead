import { loadContent, loadDailyContent } from '@cots/testkit';
import { fc, test } from '@fast-check/vitest';
import { describe, expect, it } from 'vitest';
import { dailySeed } from '../calendar';
import { DESTINATIONS, type Destination } from '../content/types';
import type { CaseSpec } from '../gen/types';
import { revealsOf } from '../gen/validate';
import { type DayCtx, soulCtx } from '../logic/context';
import { sameJudgment } from '../logic/judge';
import { solve } from '../logic/solver';
import { type PressAnswer, pressAnswer } from '../narrative/press';
import { Rng } from '../rng/rng';
import {
  assistNotes,
  currentCase,
  freeQuestion,
  inspectable,
  nextHint,
  patienceLeft,
  pressable,
  pressTaught,
  ruledOut,
  type ShiftAction,
  type ShiftEvent,
  type ShiftState,
  shareText,
  shiftScore,
  soulFields,
  startShift,
  stepShift,
  sunCosts,
  sunElapsed,
  sunLeft,
} from './shift';
import { traceShift } from './trace';

const daily = loadDailyContent();
const demo = loadContent('web-demo');
const full = loadContent('dev-full');
/** What the sun costs besides the tools: the core pack's sun.yaml, the same in every target. */
const PENALTY = sunCosts(daily);

const startDaily = (n = 1) =>
  startShift(daily, { mode: 'daily', seed: dailySeed(n), day: daily.daily?.day ?? 5, dailyNumber: n });

/** Applies actions in order, collecting events; fails on any rejection unless allowed. */
function run(state: ShiftState, ctx: DayCtx, actions: readonly ShiftAction[], allowRejects = false) {
  const events: ShiftEvent[] = [];
  let s = state;
  for (const a of actions) {
    const r = stepShift(s, a, ctx);
    if (!allowRejects) {
      const bad = r.events.find((e) => e.e === 'rejected');
      if (bad) throw new Error(`${a.t} rejected: ${bad.e === 'rejected' ? bad.reason : ''}`);
    }
    s = r.state;
    events.push(...r.events);
  }
  return { state: s, events };
}

/** Plays the current soul like a careful player: look at everything, call out every lie, stamp right. */
function playSoul(state: ShiftState, ctx: DayCtx, at: number, stamp?: Destination): ShiftAction[] {
  const c = state.cases[state.cursor];
  if (!c) return [];
  const actions: ShiftAction[] = [];
  let s = state;
  const push = (a: ShiftAction) => {
    actions.push(a);
    s = stepShift(s, a, ctx).state;
  };
  push({ t: 'inspect', fields: inspectable(s, ctx).map((f) => f.id), at });
  if (ctx.tools.has('flip')) {
    push({ t: 'flip', at });
    push({ t: 'inspect', fields: inspectable(s, ctx).map((f) => f.id), at });
  }
  for (const tool of ctx.tools.keys()) if (tool !== 'flip') push({ t: 'tool', tool, at });
  const seen = c.evidence.fields.filter((f) => s.soul.seen.includes(f.id));
  for (const x of solve(seen, ctx).contradictions) {
    const other = x.against.find((id) => s.soul.seen.includes(id));
    if (other) push({ t: 'compare', a: x.lie, b: other, at });
  }
  push({ t: 'stamp', dest: stamp ?? c.expect.dest, at });
  push({ t: 'send', at });
  return actions;
}

function playAll(state: ShiftState, ctx: DayCtx, stepMs = 5_000) {
  let s = run(state, ctx, [{ t: 'begin', at: 0 }]).state;
  const events: ShiftEvent[] = [];
  let at = 0;
  while (s.phase === 'shift') {
    at += stepMs;
    const r = run(s, ctx, playSoul(s, ctx, at));
    s = r.state;
    events.push(...r.events);
  }
  return { state: s, events, at };
}

describe('starting a shift', () => {
  it('builds the Daily: eight souls, six minutes, day 5 mechanics', () => {
    const { state, ctx } = startDaily(1);
    expect(state.phase).toBe('briefing');
    expect(state.cases).toHaveLength(8);
    expect(state.sunMs).toBe(360_000);
    expect(ctx.day).toBe(5);
    expect(state.config.dailyNumber).toBe(1);
  });

  it('gives everyone the same Daily for the same number, and a new one the next day', () => {
    const a = startDaily(7).state;
    const b = startDaily(7).state;
    const c = startDaily(8).state;
    expect(b.cases).toEqual(a.cases);
    expect(c.cases.map((x) => x.id)).not.toEqual(a.cases.map((x) => x.id));
  });

  it('uses only core and daily content, whatever else the build ships', () => {
    // A full build's merged content must not change the Daily: the game passes dailyContent.
    expect(daily.days).toEqual([]);
    expect(daily.daily).toEqual(full.daily);
    expect(daily.daily).toEqual(demo.daily);
  });

  it('plays practice days with their own spec', () => {
    const { state, ctx } = startShift(demo, { mode: 'practice', seed: 'p', day: 1 });
    expect(ctx.day).toBe(1);
    expect(state.cases).toHaveLength(ctx.spec.queue.count[0]);
    expect(state.sunMs).toBe(ctx.spec.sunS * 1000);
  });

  it('refuses a Daily without a Daily spec', () => {
    expect(() => startShift({ ...demo, daily: undefined }, { mode: 'daily', seed: 'x', day: 5 })).toThrow(/Daily/);
  });
});

describe('the flow of a shift', () => {
  it('rejects actions before the shift begins', () => {
    const { state, ctx } = startDaily();
    const r = stepShift(state, { t: 'flip', at: 0 }, ctx);
    expect(r.events).toEqual([{ e: 'rejected', reason: 'no shift in progress' }]);
    expect(r.state).toBe(state);
  });

  it('a careful player judges every soul correctly with sun to spare', () => {
    for (const n of [1, 2, 3, 4, 5]) {
      const { state, ctx } = startDaily(n);
      const { state: end, events } = playAll(state, ctx);
      expect(end.phase).toBe('done');
      expect(end.endedBy).toBe('queue');
      expect(end.verdicts.every((v) => v.correct && v.missed.length === 0)).toBe(true);
      expect(events.filter((e) => e.e === 'citation')).toEqual([]);
      const score = shiftScore(end);
      expect(score).toMatchObject({ correct: 8, judged: 8, total: 8, citations: 0 });
      expect(score.caught).toBe(end.cases.reduce((n, c) => n + c.lies.length, 0));
      expect(score.spareMs).toBeGreaterThan(0);
    }
  });

  it('a wrong stamp earns a citation naming the rule and the evidence not checked', () => {
    const { state, ctx } = startDaily(3);
    let s = run(state, ctx, [{ t: 'begin', at: 0 }]).state;
    const c = s.cases[0];
    if (!c) throw new Error('no soul');
    const wrong = DESTINATIONS.find((d) => d !== c.expect.dest && ctx.destinations.has(d)) as Destination;
    const r = run(s, ctx, [
      { t: 'stamp', dest: wrong, at: 1_000 },
      { t: 'send', at: 1_500 },
    ]);
    s = r.state;
    const cite = r.events.find((e) => e.e === 'citation');
    expect(cite && cite.e === 'citation' && cite.verdict).toMatchObject({
      index: 0,
      stamped: wrong,
      expected: c.expect.dest,
      rule: c.expect.rule,
      correct: false,
      missed: c.meta.proof,
      atMs: 1_500,
    });
    expect(s.cursor).toBe(1);
    expect(s.soul.seen).toEqual([]);
  });

  it('sending needs a stamp, and only stamps in force today', () => {
    const { state, ctx } = startShift(demo, { mode: 'practice', seed: 'a', day: 1 });
    const s = run(state, ctx, [{ t: 'begin', at: 0 }]).state;
    expect(stepShift(s, { t: 'send', at: 1 }, ctx).events[0]).toMatchObject({ e: 'rejected' });
    expect(stepShift(s, { t: 'stamp', dest: 'RAN', at: 1 }, ctx).events[0]).toMatchObject({ e: 'rejected' });
    expect(stepShift(s, { t: 'stamp', dest: 'HEL', at: 1 }, ctx).events).toEqual([{ e: 'stamped', dest: 'HEL' }]);
  });
});

describe('tools and their sun costs', () => {
  it('turning a body over costs 2 s once, and reveals the back', () => {
    const { state, ctx } = startDaily();
    let s = run(state, ctx, [{ t: 'begin', at: 0 }]).state;
    const before = inspectable(s, ctx).map((f) => f.id);
    expect(before.some((id) => id.startsWith('body.back.'))).toBe(false);
    const r = run(s, ctx, [
      { t: 'flip', at: 0 },
      { t: 'flip', at: 0 },
      { t: 'flip', at: 0 },
    ]);
    s = r.state;
    expect(r.events.map((e) => (e.e === 'flipped' ? e.penaltyMs : -1))).toEqual([2_000, 0, 0]);
    expect(s.soul.view).toBe('back');
    expect(sunElapsed(s, 0)).toBe(2_000);
    expect(inspectable(s, ctx).some((id) => id.id.startsWith('body.back.'))).toBe(true);
  });

  it('the feather costs 10 s and its reading counts as seen', () => {
    const { state, ctx } = startDaily();
    const s = run(state, ctx, [{ t: 'begin', at: 0 }]).state;
    const r = stepShift(s, { t: 'tool', tool: 'feather', at: 0 }, ctx);
    const used = r.events[0];
    expect(used).toMatchObject({ e: 'toolUsed', tool: 'feather', penaltyMs: 10_000 });
    expect(r.state.soul.seen).toContain('tool.feather.breath');
    expect(sunElapsed(r.state, 0)).toBe(10_000);
    expect(stepShift(r.state, { t: 'tool', tool: 'feather', at: 0 }, ctx).state).toBe(r.state);
  });

  it('tools are only there from the day they are taught', () => {
    const { state, ctx } = startShift(demo, { mode: 'practice', seed: 'a', day: 1 });
    const s = run(state, ctx, [{ t: 'begin', at: 0 }]).state;
    expect(stepShift(s, { t: 'flip', at: 0 }, ctx).events[0]).toMatchObject({ e: 'rejected' });
    expect(stepShift(s, { t: 'tool', tool: 'feather', at: 0 }, ctx).events[0]).toMatchObject({ e: 'rejected' });
  });
});

describe('compare and question', () => {
  /** A Daily soul with a lie the careful player can catch. */
  function liar() {
    for (let n = 1; n < 60; n++) {
      const { state, ctx } = startDaily(n);
      let s = run(state, ctx, [{ t: 'begin', at: 0 }]).state;
      for (let i = 0; i < s.cases.length; i++) {
        const actions = playSoul(s, ctx, 0);
        const cmp = actions.find((a) => a.t === 'compare');
        if (cmp && cmp.t === 'compare') {
          const upTo = actions.slice(0, actions.indexOf(cmp));
          return { s: run(s, ctx, upTo).state, ctx, cmp };
        }
        s = run(s, ctx, actions).state;
      }
    }
    throw new Error('no liar in 60 Dailies');
  }

  it('comparing a lie with the evidence against it flags the contradiction', () => {
    const { s, ctx, cmp } = liar();
    const r = stepShift(s, { ...cmp, a: cmp.b, b: cmp.a }, ctx);
    expect(r.events[0]).toMatchObject({ e: 'contradiction', lie: cmp.a, with: cmp.b });
    expect(r.state.soul.flagged).toHaveLength(1);
    expect(sunElapsed(r.state, 0)).toBe(sunElapsed(s, 0));
    // Flagging the same lie again is a no-op.
    expect(stepShift(r.state, cmp, ctx).state).toBe(r.state);
  });

  it('a compare that finds nothing costs 10 s', () => {
    const { s, ctx, cmp } = liar();
    const innocent = s.soul.seen.find((id) => id !== cmp.a && id !== cmp.b && id.startsWith('body.'));
    if (!innocent) throw new Error('no second body field');
    const r = stepShift(s, { t: 'compare', a: cmp.b, b: innocent, at: 0 }, ctx);
    expect(r.events[0]).toMatchObject({ e: 'noConflict', penaltyMs: PENALTY.badCompare });
    expect(sunElapsed(r.state, 0)).toBe(sunElapsed(s, 0) + PENALTY.badCompare);
  });

  it('the sun’s costs are content (docs/tech-spec.md §63): the core pack’s, and whatever a variant sets', () => {
    expect(PENALTY).toEqual({ badCompare: 10_000, question: 20_000, hint: 15_000, duskGrace: 60_000 });
    for (const c of [demo, full]) expect(sunCosts(c)).toEqual(PENALTY);
    const { s, ctx, cmp } = liar();
    const dear = { ...ctx, content: { ...ctx.content, sun: { ...ctx.content.sun, badCompare: 25, question: 5 } } };
    const innocent = s.soul.seen.find((id) => id !== cmp.a && id !== cmp.b && id.startsWith('body.'));
    if (!innocent) throw new Error('no second body field');
    const bad = stepShift(s, { t: 'compare', a: cmp.b, b: innocent, at: 0 }, dear);
    expect(bad.events[0]).toMatchObject({ e: 'noConflict', penaltyMs: 25_000 });
    const asked = stepShift(stepShift(s, cmp, dear).state, { t: 'question', lie: cmp.a, at: 0 }, dear);
    expect(asked.events[0]).toMatchObject({ e: 'answer', penaltyMs: 5_000 });
  });

  it('only fields already looked at can be compared', () => {
    const { s, ctx, cmp } = liar();
    const fresh = { ...s, soul: { ...s.soul, seen: s.soul.seen.filter((id) => id !== cmp.b) } };
    expect(stepShift(fresh, cmp, ctx).events[0]).toMatchObject({ e: 'rejected' });
  });

  it('questioning needs a flagged lie, costs 20 s and plays the planned answer', () => {
    const { s, ctx, cmp } = liar();
    expect(stepShift(s, { t: 'question', lie: cmp.a, at: 0 }, ctx).events[0]).toMatchObject({ e: 'rejected' });
    const flagged = stepShift(s, cmp, ctx).state;
    const c = flagged.cases[flagged.cursor];
    const lie = c?.lies.find((l) => l.field === cmp.a);
    const r = stepShift(flagged, { t: 'question', lie: cmp.a, at: 0 }, ctx);
    expect(r.events[0]).toMatchObject({ e: 'answer', lie: cmp.a, penaltyMs: PENALTY.question });
    const answer = r.events[0];
    if (answer?.e !== 'answer') throw new Error('no answer');
    expect(answer.response.kind).toBe(lie?.onQuestion);
    expect(r.state.recentQ).toEqual([answer.response.template]);
    expect(sunElapsed(r.state, 0)).toBe(sunElapsed(flagged, 0) + PENALTY.question);
    expect(stepShift(r.state, { t: 'question', lie: cmp.a, at: 0 }, ctx).events[0]).toMatchObject({ e: 'rejected' });
  });

  it('a god’s favour makes the day’s first questions cost no sun (docs/tech-spec.md §43); the next ones cost their price', () => {
    const { s, ctx, cmp } = liar();
    const favoured: ShiftState = { ...s, config: { ...s.config, mods: { ...s.config.mods, freeQuestions: 1 } } };
    expect(freeQuestion(favoured)).toBe(true);
    const flagged = stepShift(favoured, cmp, ctx).state;
    const r = stepShift(flagged, { t: 'question', lie: cmp.a, at: 0 }, ctx);
    expect(r.events[0]).toMatchObject({ e: 'answer', lie: cmp.a, penaltyMs: 0 });
    expect(sunElapsed(r.state, 0)).toBe(sunElapsed(flagged, 0));
    expect(freeQuestion(r.state)).toBe(false);
    // Asked again (as a second liar would be), it costs what questions cost.
    const again = { ...r.state, soul: { ...r.state.soul, questioned: [] } };
    expect(stepShift(again, { t: 'question', lie: cmp.a, at: 0 }, ctx).events[0]).toMatchObject({
      e: 'answer',
      penaltyMs: PENALTY.question,
    });
    // Without the favour no count is kept, so nothing else about a shift changes.
    const plain = stepShift(stepShift(s, cmp, ctx).state, { t: 'question', lie: cmp.a, at: 0 }, ctx).state;
    expect(plain.freeAsked).toBeUndefined();
  });
});

describe('the sun', () => {
  it('pausing stops the sun, and nothing can be done while paused', () => {
    const { state, ctx } = startDaily();
    const s = run(state, ctx, [
      { t: 'begin', at: 1_000 },
      { t: 'pause', at: 11_000 },
    ]).state;
    expect(sunElapsed(s, 50_000)).toBe(10_000);
    expect(stepShift(s, { t: 'flip', at: 50_000 }, ctx).events[0]).toMatchObject({ e: 'rejected' });
    const resumed = run(s, ctx, [{ t: 'resume', at: 61_000 }]).state;
    expect(sunElapsed(resumed, 71_000)).toBe(20_000);
    expect(sunLeft(resumed, 71_000)).toBe(340_000);
  });

  it('dusk comes when the sun runs out, then the last soul has a minute of grace', () => {
    const { state, ctx } = startDaily();
    let s = run(state, ctx, [{ t: 'begin', at: 0 }]).state;
    let r = stepShift(s, { t: 'tick', at: 359_999 }, ctx);
    expect(r.events).toEqual([]);
    r = stepShift(r.state, { t: 'tick', at: 360_000 }, ctx);
    expect(r.events).toEqual([{ e: 'dusk' }]);
    s = r.state;
    expect(s.phase).toBe('shift');
    // Judging the soul at the gate during the grace ends the shift.
    const c = s.cases[0];
    if (!c) throw new Error('no soul');
    const end = run(s, ctx, [
      { t: 'stamp', dest: c.expect.dest, at: 370_000 },
      { t: 'send', at: 371_000 },
    ]);
    expect(end.state.phase).toBe('done');
    expect(end.state.endedBy).toBe('dusk');
    expect(end.state.verdicts.map((v) => v.stamped === null)).toEqual([
      false,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
    ]);
    expect(shiftScore(end.state)).toMatchObject({ correct: 1, judged: 1, spareMs: 0 });
  });

  it('the shift ends by itself when the grace runs out', () => {
    const { state, ctx } = startDaily();
    const s = run(state, ctx, [{ t: 'begin', at: 0 }]).state;
    const r = stepShift(s, { t: 'tick', at: 360_000 + PENALTY.duskGrace }, ctx);
    expect(r.events).toEqual([{ e: 'dusk' }, { e: 'done', endedBy: 'dusk' }]);
    expect(r.state.verdicts).toHaveLength(8);
    expect(r.state.verdicts.every((v) => v.stamped === null && !v.correct)).toBe(true);
  });

  it('penalties bring dusk sooner', () => {
    const { state, ctx } = startDaily();
    const s = run(state, ctx, [
      { t: 'begin', at: 0 },
      { t: 'tool', tool: 'feather', at: 0 },
    ]).state;
    expect(stepShift(s, { t: 'tick', at: 350_000 }, ctx).events).toEqual([{ e: 'dusk' }]);
  });

  it('untimed shifts never reach dusk', () => {
    const { state, ctx } = startShift(demo, { mode: 'practice', seed: 'u', day: 1, untimed: true });
    const s = run(state, ctx, [{ t: 'begin', at: 0 }]).state;
    expect(stepShift(s, { t: 'tick', at: 10_000_000 }, ctx).events).toEqual([]);
  });
});

describe('share text', () => {
  it('shows right, wrong and unjudged souls but never where anyone went', () => {
    const { state, ctx } = startDaily(97);
    let s = run(state, ctx, [{ t: 'begin', at: 0 }]).state;
    s = run(s, ctx, playSoul(s, ctx, 30_000)).state;
    const c = s.cases[1];
    const wrong = DESTINATIONS.find((d) => d !== c?.expect.dest && ctx.destinations.has(d)) as Destination;
    s = run(s, ctx, playSoul(s, ctx, 60_000, wrong)).state;
    s = stepShift(s, { t: 'tick', at: 360_000 + PENALTY.duskGrace }, ctx).state;
    const text = shareText(s, daily, { title: 'Chooser of the Slain', decree: 'Whim', url: 'https://x.test/' });
    expect(text).toBe(
      ['Chooser of the Slain · Daily #97 (g1)', 'Whim', '🟩🟥⬛⬛⬛⬛⬛⬛ 1/8 · sun set', 'https://x.test/'].join('\n'),
    );
    for (const d of DESTINATIONS) expect(text.toUpperCase()).not.toContain(d);
    expect(shareText(s, daily, { title: 'T', label: 'Daily preview 2026-09-23' }).split('\n')[0]).toBe(
      'T · Daily preview 2026-09-23 (g1)',
    );
  });

  it('reports the sun left over when the queue is done', () => {
    const { state, ctx } = startDaily(2);
    const { state: end } = playAll(state, ctx, 10_000);
    const text = shareText(end, daily, { title: 'T' });
    const spare = shiftScore(end).spareMs;
    const m = Math.floor(spare / 60_000);
    const sec = String(Math.floor((spare % 60_000) / 1000)).padStart(2, '0');
    expect(text.split('\n')[1]).toBe(`🟩🟩🟩🟩🟩🟩🟩🟩 8/8 · ${m}:${sec} to spare`);
  });
});

describe('assists', () => {
  it('a slower sun gives more time and a faster one less, set as the shift begins', () => {
    const { state, ctx } = startDaily();
    const base = state.sunMs;
    const begun = (sunPct: number) => stepShift(state, { t: 'begin', at: 0, assists: { sunPct } }, ctx).state;
    expect(begun(50).sunMs).toBe(base * 2);
    expect(begun(200).sunMs).toBe(base / 2);
    expect(begun(50).config.assists).toEqual({ sunPct: 50 });
    // Only the speeds on offer: anything else is the sun as designed, and no assist is kept.
    expect(begun(60).sunMs).toBe(base);
    expect(begun(60).config.assists).toBeUndefined();
    expect(begun(100).config.assists).toBeUndefined();
    // Dusk comes when the slower sun runs out, not the designed one.
    expect(run(begun(50), ctx, [{ t: 'tick', at: base + 1000 }]).events).not.toContainEqual({ e: 'dusk' });
    expect(run(begun(50), ctx, [{ t: 'tick', at: 2 * base }]).events).toContainEqual({ e: 'dusk' });
  });

  it('says in the share text which assists were on', () => {
    const { state, ctx } = startDaily();
    const assisted = stepShift(state, { t: 'begin', at: 0, assists: { sunPct: 50, tracker: true } }, ctx).state;
    expect(shareText(assisted, daily, { title: 'T' })).toMatch(/ · sun ×0\.5, rule tracker$/);
    const plain = stepShift(state, { t: 'begin', at: 0 }, ctx).state;
    expect(shareText(plain, daily, { title: 'T' })).not.toMatch(/sun ×|tracker/);
    expect(assistNotes({ sunPct: 200 })).toEqual(['sun ×2']);
    expect(assistNotes({ sunPct: 75 })).toEqual(['sun ×0.75']);
    // Fines aren't part of a Daily, so waiving them says nothing there.
    expect(assistNotes({ noFines: true })).toEqual([]);
  });

  it('the rule tracker rules out a rule once what was seen settles it, and not on a presumption', () => {
    // Day 1: a weapon in hand goes to Valhalla, anyone else to Hel.
    const { state, ctx } = startShift(demo, { mode: 'practice', seed: 'tracker', day: 1 });
    const begun = stepShift(state, { t: 'begin', at: 0 }, ctx).state;
    const i = begun.cases.findIndex((c) => c.expect.dest === 'HEL');
    const c = begun.cases[i];
    if (!c) throw new Error('no soul for Hel on Day 1');
    const weaponRule = ctx.rules[0]?.id ?? '';
    const at = (seen: readonly string[]) => ruledOut({ ...begun, cursor: i, soul: { ...begun.soul, seen } }, ctx);
    expect(at([])).toEqual([]);
    expect(at(c.evidence.fields.map((f) => f.id))).toEqual([weaponRule]);
  });

  test.prop([fc.integer({ min: 1, max: 20 }), fc.nat(1000)], { numRuns: 40 })(
    'the rule tracker never rules out the rule that applies, whatever has been seen or asked',
    (day, n) => {
      const { state, ctx } = startShift(full, { mode: 'practice', seed: `track${n}`, day });
      const begun = stepShift(state, { t: 'begin', at: 0 }, ctx).state;
      const rng = new Rng(`track${n}|${day}`);
      begun.cases.forEach((c, i) => {
        const seen = c.evidence.fields.filter(() => rng.chance(2, 3)).map((f) => f.id);
        const questioned = c.lies.filter(() => rng.chance(1, 2)).map((l) => l.field);
        const soul = { ...begun.soul, seen, questioned };
        expect(ruledOut({ ...begun, cursor: i, soul }, ctx)).not.toContain(c.expect.rule);
      });
    },
  );
});

describe('Skögul’s hint', () => {
  /** Looks at a field the way a player would: turning the body over or using the tool it needs first. */
  const lookAt = (state: ShiftState, ctx: DayCtx, id: string): ShiftState => {
    const f = state.cases[state.cursor]?.evidence.fields.find((x) => x.id === id);
    let st = state;
    if (f?.view === 'back' && !st.soul.flipped) st = stepShift(st, { t: 'flip', at: 0 }, ctx).state;
    if (f?.tool && f.tool !== 'flip') st = stepShift(st, { t: 'tool', tool: f.tool, at: 0 }, ctx).state;
    return stepShift(st, { t: 'inspect', fields: [id], at: 0 }, ctx).state;
  };

  it('points at deciding evidence not yet seen, one piece at a time, for 15 s of sun each', () => {
    const { state, ctx } = startDaily(3);
    const begun = stepShift(state, { t: 'begin', at: 0 }, ctx).state;
    const c = begun.cases[0];
    if (!c) throw new Error('no soul');
    const first = run(begun, ctx, [{ t: 'hint', at: 0 }]);
    const pointed = first.events.find((e) => e.e === 'hint');
    expect(pointed).toEqual({ e: 'hint', field: c.meta.proof[0], penaltyMs: PENALTY.hint });
    expect(first.state.clock.penaltyMs).toBe(PENALTY.hint);
    // Asked again, she points at the next piece, not the same one.
    if (c.meta.proof.length > 1) expect(nextHint(first.state)).toBe(c.meta.proof[1]);
    // Once everything that decides the soul has been seen, there is nothing to point at, and asking costs nothing.
    let st = begun;
    for (const id of c.meta.proof) st = lookAt(st, ctx, id);
    expect(nextHint(st)).toBeNull();
    const none = stepShift(st, { t: 'hint', at: 0 }, ctx);
    expect(none.events).toEqual([{ e: 'rejected', reason: 'nothing left to point at' }]);
    expect(none.state).toBe(st);
  });

  test.prop([fc.integer({ min: 1, max: 20 }), fc.nat(1000)], { numRuns: 30 })(
    'following her hints to the end shows enough to decide the soul (questioning where a liar must confess)',
    (day, n) => {
      const { state, ctx } = startShift(full, { mode: 'practice', seed: `hint${n}`, day });
      let st = stepShift(state, { t: 'begin', at: 0 }, ctx).state;
      const c = st.cases[0];
      if (!c) return;
      for (let guard = 0; guard < 30; guard++) {
        const id = nextHint(st);
        if (!id) break;
        st = lookAt(stepShift(st, { t: 'hint', at: 0 }, ctx).state, ctx, id);
      }
      expect(nextHint(st)).toBeNull();
      const seen = c.evidence.fields.filter((f) => st.soul.seen.includes(f.id));
      const judged = solve(seen, ctx, { reveals: revealsOf(c.lies) }).judgment;
      expect(judged.kind).toBe('determined');
      if (judged.kind === 'determined') expect(sameJudgment(judged, c.expect)).toBe(true);
    },
  );
});

describe('robustness', () => {
  const actionArb = (ids: readonly string[]) =>
    fc.oneof(
      fc.constant<ShiftAction['t']>('flip').map((t) => ({ t }) as const),
      fc.constantFrom(...ids).map((id) => ({ t: 'inspect' as const, fields: [id] })),
      fc.constantFrom('feather', 'runeLens').map((tool) => ({ t: 'tool' as const, tool })),
      fc.tuple(fc.constantFrom(...ids), fc.constantFrom(...ids)).map(([a, b]) => ({ t: 'compare' as const, a, b })),
      fc.constantFrom(...ids).map((lie) => ({ t: 'question' as const, lie })),
      fc.constantFrom(...DESTINATIONS).map((dest) => ({ t: 'stamp' as const, dest })),
      fc.constant({ t: 'send' as const }),
      fc.constant({ t: 'pause' as const }),
      fc.constant({ t: 'resume' as const }),
      fc.constant({ t: 'tick' as const }),
    );

  const { state: base, ctx } = startDaily(11);
  const ids = [...new Set(base.cases.flatMap((c) => c.evidence.fields.map((f) => f.id)))];

  test.prop([fc.array(fc.tuple(actionArb(ids), fc.integer({ min: 0, max: 30_000 })), { maxLength: 120 })], {
    numRuns: 60,
  })('any sequence of actions keeps the shift consistent', (steps) => {
    let s = stepShift(base, { t: 'begin', at: 0 }, ctx).state;
    let at = 0;
    let lastPenalty = 0;
    for (const [a, dt] of steps) {
      at += dt;
      const r = stepShift(s, { ...a, at } as ShiftAction, ctx);
      s = r.state;
      expect(s.clock.penaltyMs).toBeGreaterThanOrEqual(lastPenalty);
      lastPenalty = s.clock.penaltyMs;
      expect(s.verdicts.length).toBeLessThanOrEqual(s.cases.length);
      expect(s.verdicts.map((v) => v.index)).toEqual(s.verdicts.map((_, i) => i));
      if (s.phase === 'done') {
        expect(s.verdicts).toHaveLength(s.cases.length);
        break;
      }
      expect(s.cursor).toBe(s.verdicts.length);
      for (const id of s.soul.seen) expect(s.cases[s.cursor]?.evidence.fields.some((f) => f.id === id)).toBe(true);
    }
  });
});

describe('pressing a soul on what it said (docs/tech-spec.md §66)', () => {
  const press = full.press;
  if (!press) throw new Error('the full build has no press.yaml');
  const cost = press.cost * 1000;

  const begun = (seed: string, day = press.since) => {
    const { state, ctx } = startShift(full, { mode: 'practice', seed, day });
    return { s: stepShift(state, { t: 'begin', at: 0 }, ctx).state, ctx };
  };
  /** The soul at the gate with everything it said heard (and all else on its front looked at). */
  const heard = (s: ShiftState, ctx: DayCtx) =>
    stepShift(s, { t: 'inspect', fields: inspectable(s, ctx).map((f) => f.id), at: 0 }, ctx).state;

  /** The first soul, over some practice shifts, one of whose claims answers as `want` says when pressed. */
  function find(want: (a: PressAnswer, c: CaseSpec) => boolean, atLeast = 1) {
    for (let n = 0; n < 300; n++) {
      let { s, ctx } = begun(`press${n}`);
      while (s.phase === 'shift') {
        const h = heard(s, ctx);
        const c = currentCase(h);
        const claims = pressable(h, ctx);
        if (c && claims.length >= atLeast) {
          for (const field of claims) {
            const a = pressAnswer(c, field, soulCtx(ctx, c), h.recentQ);
            if (a && want(a, c)) return { s: h, ctx, c, field, a };
          }
        }
        s = run(s, ctx, playSoul(s, ctx, 0)).state;
      }
    }
    throw new Error('no such soul in 300 shifts');
  }

  it('is taught from its day, and never in the Daily or the primer', () => {
    const { state, ctx } = startDaily(1);
    const d = heard(stepShift(state, { t: 'begin', at: 0 }, ctx).state, ctx);
    const said = d.cases[0]?.evidence.fields.find((f) => f.item === 'testimony' && d.soul.seen.includes(f.id));
    expect(pressTaught(d, ctx)).toBe(false);
    expect(pressable(d, ctx)).toEqual([]);
    if (said) {
      expect(stepShift(d, { t: 'press', field: said.id, at: 0 }, ctx).events).toEqual([
        { e: 'rejected', reason: 'souls are not pressed today' },
      ]);
    }
    const primer = demo.primer;
    if (!primer) throw new Error('no primer');
    const p = startShift(demo, { mode: 'primer', seed: 'p', day: primer.day, untimed: true });
    expect(pressTaught(p.state, p.ctx)).toBe(false);
    const early = begun('early', press.since - 1);
    const onTime = begun('on time');
    expect(pressTaught(early.s, early.ctx)).toBe(false);
    expect(pressTaught(onTime.s, onTime.ctx)).toBe(true);
  });

  it('costs its sun, takes only claims heard, and each soul takes only so many', () => {
    const { s, ctx, c } = find(() => true, press.patience + 1);
    expect(patienceLeft(s, ctx)).toBe(press.patience);
    const unheard = { ...s, soul: { ...s.soul, seen: [] } };
    const [first] = pressable(s, ctx);
    if (!first) throw new Error('nothing to press');
    expect(stepShift(unheard, { t: 'press', field: first, at: 0 }, ctx).events[0]).toMatchObject({ e: 'rejected' });
    const body = c.evidence.fields.find((f) => f.item === 'body' && s.soul.seen.includes(f.id));
    if (body) {
      expect(stepShift(s, { t: 'press', field: body.id, at: 0 }, ctx).events[0]).toMatchObject({
        e: 'rejected',
        reason: 'press a claim you have heard',
      });
    }
    let p = s;
    for (let i = 0; i < press.patience; i++) {
      const field = pressable(p, ctx)[0];
      if (!field) throw new Error('ran out of claims');
      const r = stepShift(p, { t: 'press', field, at: 0 }, ctx);
      expect(r.events[0]).toMatchObject({ e: 'pressed', field, penaltyMs: cost });
      expect(sunElapsed(r.state, 0)).toBe(sunElapsed(p, 0) + cost);
      // A claim is pressed once.
      expect(pressable(r.state, ctx)).not.toContain(field);
      p = r.state;
    }
    expect(patienceLeft(p, ctx)).toBe(0);
    expect(pressable(p, ctx)).toEqual([]);
    const left = c.evidence.fields.find((f) => f.item === 'testimony' && !(p.soul.pressed ?? []).includes(f.id));
    if (left) {
      expect(stepShift(p, { t: 'press', field: left.id, at: 0 }, ctx).events).toEqual([
        { e: 'rejected', reason: 'the soul will say no more' },
      ]);
    }
    // The next soul starts with its patience whole.
    const next = run(p, ctx, [
      { t: 'stamp', dest: c.expect.dest, at: 0 },
      { t: 'send', at: 0 },
    ]).state;
    if (next.phase === 'shift') expect(patienceLeft(next, ctx)).toBe(press.patience);
  });

  it('a lie that gives way is caught, and answered as if caught and questioned', () => {
    const { s, ctx, c, field } = find((a) => a.gave);
    const lie = c.lies.find((l) => l.field === field);
    const r = stepShift(s, { t: 'press', field, at: 0 }, ctx);
    const e = r.events[0];
    if (e?.e !== 'pressed') throw new Error('not pressed');
    expect(e.answer).toMatchObject({ gave: true, kind: lie?.onQuestion });
    expect(r.state.soul.gave).toEqual([field]);
    expect(r.state.soul.questioned).toContain(field);
    expect(r.state.recentQ).toEqual([...s.recentQ, e.answer.template]);
    // Nothing more to ask it about that claim.
    expect(stepShift(r.state, { t: 'question', lie: field, at: 0 }, ctx).events[0]).toMatchObject({ e: 'rejected' });
    // The rule tracker takes a confession as the truth, and never rules out the rule that applies.
    expect(ruledOut(r.state, ctx)).not.toContain(c.expect.rule);
    for (const rule of ruledOut(s, ctx)) expect(ruledOut(r.state, ctx)).toContain(rule);
    const sent = run(r.state, ctx, [
      { t: 'stamp', dest: c.expect.dest, at: 0 },
      { t: 'send', at: 0 },
    ]).state;
    expect(sent.verdicts.at(-1)).toMatchObject({ correct: true, caught: 1 });
  });

  it('what slips out is heard, shown false against the evidence, and questioned gives way on the claim held to', () => {
    const { s, ctx, c, field } = find((a, c) => {
      const said = a.said?.says;
      return !a.gave && said !== undefined && c.truth[said.fact] !== said.value;
    });
    const r = stepShift(s, { t: 'press', field, at: 0 }, ctx);
    const said = r.state.soul.said?.[0];
    if (!said) throw new Error('nothing said');
    expect(said.id).toBe(`said.${field}`);
    expect(r.state.soul.seen).toContain(said.id);
    expect(soulFields(r.state, c).map((f) => f.id)).toContain(said.id);
    // Shown false by something the player can see: look at it all, then compare.
    let p = r.state;
    if (ctx.tools.has('flip')) p = run(p, ctx, [{ t: 'flip', at: 0 }]).state;
    p = heard(p, ctx);
    const cx = soulCtx(ctx, c);
    const seen = soulFields(p, c).filter((f) => p.soul.seen.includes(f.id));
    const x = solve(seen, cx).contradictions.find((y) => y.lie === said.id);
    const other = x?.against.find((id) => p.soul.seen.includes(id));
    if (!other) throw new Error('the slip is not shown false');
    const caught = stepShift(p, { t: 'compare', a: other, b: said.id, at: 0 }, ctx);
    expect(caught.events[0]).toMatchObject({ e: 'contradiction', lie: said.id, with: other });
    const asked = stepShift(caught.state, { t: 'question', lie: said.id, at: 0 }, ctx);
    const e = asked.events[0];
    if (e?.e !== 'answer') throw new Error('no answer');
    expect(e.response.kind).toBe(c.lies.find((l) => l.field === field)?.onQuestion);
    expect(asked.state.soul.questioned).toEqual(expect.arrayContaining([said.id, field]));
    expect(stepShift(asked.state, { t: 'question', lie: said.id, at: 0 }, ctx).events[0]).toMatchObject({
      e: 'rejected',
    });
    // One lie caught, however many ways it was shown false.
    const sent = run(asked.state, ctx, [
      { t: 'stamp', dest: c.expect.dest, at: 0 },
      { t: 'send', at: 0 },
    ]).state;
    expect(sent.verdicts.at(-1)).toMatchObject({ correct: true, caught: 1 });
  });

  it('something true it adds shows nothing false when compared', () => {
    const { s, ctx, c, field } = find((a, c) => {
      const said = a.said?.says;
      return said !== undefined && c.truth[said.fact] === said.value && said.fact !== 'cause';
    });
    const r = stepShift(s, { t: 'press', field, at: 0 }, ctx);
    const said = r.state.soul.said?.[0];
    const fact = said?.says?.fact;
    const body = c.evidence.fields.find((f) => f.id === `body.front.${fact}`);
    if (!said || !body) throw new Error('nothing to compare with');
    expect(stepShift(r.state, { t: 'compare', a: said.id, b: body.id, at: 0 }, ctx).events[0]).toMatchObject({
      e: 'noConflict',
    });
  });

  it('a replayed shift traces what was pressed, and what gave way as caught', () => {
    const { s, ctx, field } = find((a) => a.gave);
    const { state: initial } = startShift(full, s.config, s.cases);
    // The careful play of the souls before it, then this soul heard and pressed.
    const actions: ShiftAction[] = [{ t: 'begin', at: 0 }];
    let replay = stepShift(initial, { t: 'begin', at: 0 }, ctx).state;
    while (replay.cursor < s.cursor) {
      const souls = playSoul(replay, ctx, 0);
      actions.push(...souls);
      replay = run(replay, ctx, souls).state;
    }
    actions.push({ t: 'inspect', fields: inspectable(replay, ctx).map((f) => f.id), at: 0 });
    actions.push({ t: 'press', field, at: 0 });
    const t = traceShift(initial, actions, ctx).souls[s.cursor];
    expect(t?.pressed).toEqual([field]);
    expect(t?.caught).toEqual([field]);
    expect(t?.penaltyMs).toBe(cost);
  });

  test.prop([fc.nat(500), fc.array(fc.tuple(fc.nat(12), fc.nat(3)), { maxLength: 80 })], { numRuns: 40 })(
    'any sequence of presses, compares and questions keeps the soul consistent',
    (n, steps) => {
      let { s, ctx } = begun(`press-robust${n}`, 3 + (n % 18));
      for (const [pick, kind] of steps) {
        const c = currentCase(s);
        if (!c) break;
        const ids = [...soulFields(s, c).map((f) => f.id), 'testimony.99'];
        const id = ids[pick % ids.length] ?? '';
        const other = ids[(pick * 7 + 3) % ids.length] ?? '';
        const a: ShiftAction =
          kind === 0
            ? { t: 'inspect', fields: inspectable(s, ctx).map((f) => f.id), at: 0 }
            : kind === 1
              ? { t: 'press', field: id, at: 0 }
              : kind === 2
                ? { t: 'compare', a: id, b: other, at: 0 }
                : { t: 'question', lie: id, at: 0 };
        s = stepShift(s, a, ctx).state;
        const soul = s.soul;
        expect((soul.pressed ?? []).length).toBeLessThanOrEqual(press.patience);
        for (const seen of soul.seen) expect(soulFields(s, c).some((f) => f.id === seen)).toBe(true);
        expect(new Set(soul.pressed).size).toBe((soul.pressed ?? []).length);
        for (const g of soul.gave ?? []) expect(c.lies.some((l) => l.field === g)).toBe(true);
      }
      const c = currentCase(s);
      if (!c) return;
      const sent = run(s, ctx, [
        { t: 'stamp', dest: c.expect.dest, at: 0 },
        { t: 'send', at: 0 },
      ]).state;
      const v = sent.verdicts.at(-1);
      expect(v?.caught).toBeLessThanOrEqual(c.lies.length);
    },
  );
});
