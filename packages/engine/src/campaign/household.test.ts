import { loadContent } from '@cots/testkit';
import { describe, expect, it } from 'vitest';
import type { Content, Destination, ScriptedCaseDef } from '../content/types';
import type { CaseSpec } from '../gen/types';
import { errandOf, scenesFor } from './origin';
import { pleaOf } from './pleas';
import { campaignOf, campaignQueue, newRun, type RunAction, type RunEvent, seenEffects, stepRun } from './run';
import { recordAction, runContext, startSave, wrongSoFar } from './save';
import type { RunState } from './state';

// The household as people (docs/tech-spec.md §74): letters from home, the errands they ask, and what the desk saw.

const full = loadContent('dev-full');
const demo = loadContent('web-demo');
const letters = campaignOf(full).letters ?? [];
const story = (id: string) => full.scripted?.find((d) => d.id === id) as ScriptedCaseDef;
/** The day that places story soul `id`. */
const dayOf = (id: string) => full.days.find((d) => (d.queue.scripted ?? []).some((s) => s.case === id))?.day ?? 0;
const own = (day: number, at: 'morning' | 'night') => full.days.find((d) => d.day === day)?.scenes?.[at];

/** The run on the night of `day`, begun as `origin` if given, with `over` on top and nothing else played. */
const night = (day: number, over: Partial<RunState> = {}, origin?: string): RunState => ({
  ...newRun(full, 'household', origin ? { origin } : {}),
  day,
  phase: 'night',
  ...over,
});

/** `run` with one of the family gone. */
const without = (run: RunState, id: string): RunState => ({
  ...run,
  family: run.family.map((m) => (m.id === id ? { ...m, status: 'gone' as const, gone: 'died' as const } : m)),
});

/** Steps a run through actions, keeping the day context current and failing on rejections. */
function drive(content: Content, run0: RunState, actions: readonly RunAction[]) {
  let run = run0;
  let ctx = runContext(content, run);
  const events: RunEvent[] = [];
  for (const a of actions) {
    const r = stepRun(run, a, { content, ctx });
    const bad = r.events.find((e) => e.e === 'rejected');
    if (bad && bad.e === 'rejected') throw new Error(`${a.t} rejected: ${bad.reason}`);
    if (r.state.day !== run.day) ctx = runContext(content, r.state);
    run = r.state;
    events.push(...r.events);
  }
  return { run, events };
}

/** The morning of the day that places story soul `id`, with `flags` set (the errand asked). */
const morningFor = (id: string, flags: Record<string, number>): RunState => ({
  ...newRun(full, `errand-${id}`),
  day: dayOf(id),
  flags,
});

/**
 * The day's shift for story soul `id`: every soul before it judged rightly; at it, `at` (its actions); then, unless
 * `dusk`, it and the rest stamped rightly (it `stamped`), else the sun sets with it at the desk. Through to the audit.
 */
function judged(
  id: string,
  base: RunState,
  opts: { stamped?: Destination; at?: (c: CaseSpec, t: number) => RunAction[]; dusk?: boolean },
) {
  const ctx = runContext(full, base);
  const begun = stepRun(base, { t: 'beginShift', at: 0 }, { content: full, ctx }).state;
  const queue = begun.shift?.cases ?? [];
  const k = queue.findIndex((c) => c.script === id);
  if (k < 0) throw new Error(`${id} isn't in the line`);
  const actions: RunAction[] = [{ t: 'beginShift', at: 0 }];
  let t = 0;
  for (const [i, c] of queue.entries()) {
    t += 1000;
    const it = i === k;
    if (it) actions.push(...(opts.at?.(c, t) ?? []));
    if (it && opts.dusk) {
      actions.push({ t: 'shift', action: { t: 'tick', at: 3_600_000 } });
      break;
    }
    for (const p of it ? [] : (c.expect.procedures ?? [])) {
      const tool = ctx.procedures.find((x) => x.id === p)?.tool;
      if (tool) actions.push({ t: 'shift', action: { t: 'tool', tool, at: t } });
    }
    actions.push({
      t: 'shift',
      action: { t: 'stamp', dest: it ? (opts.stamped ?? c.expect.dest) : c.expect.dest, at: t },
    });
    actions.push({ t: 'shift', action: { t: 'send', at: t } });
  }
  return { ...drive(full, base, actions), soul: queue[k] as CaseSpec };
}

/** Turn the soul over and look at the wound on its back. */
const lookAtBack = (c: CaseSpec, t: number): RunAction[] => {
  const field = c.evidence.fields.find((f) => f.obs?.key === 'woundsBack');
  if (!field) throw new Error('no wound on his back to look at');
  return [
    { t: 'shift', action: { t: 'flip', at: t } },
    { t: 'shift', action: { t: 'inspect', fields: [field.id], at: t } },
  ];
};

describe('letters from home', () => {
  it('ship in the full game, each on a day the campaign has; none in the demo', () => {
    expect(letters.map((l) => [l.day, l.at, l.scene])).toEqual([
      [6, 'night', 'scene.e.oddny.ask'],
      [7, 'night', 'scene.e.oddny.answer'],
      [8, 'night', 'scene.e.steinar.ask'],
      [10, 'night', 'scene.e.steinar.answer'],
      [14, 'night', 'scene.e.talk'],
    ]);
    expect(demo.campaign?.letters).toBeUndefined();
    expect(scenesFor(night(6), demo, 'night')).toEqual([]);
  });

  it('play after the night’s own scene, on the runs whose `when` holds', () => {
    // Night 6: your mother asks a favour, while she's at home.
    expect(scenesFor(night(6), full, 'night')).toEqual([own(6, 'night'), 'scene.e.oddny.ask']);
    expect(scenesFor(without(night(6), 'mother'), full, 'night')).toEqual([own(6, 'night')]);
    // Night 7: she answers once Oddny's been judged.
    expect(scenesFor(night(7), full, 'night')).toEqual([own(7, 'night')]);
    expect(scenesFor(night(7, { flags: { oddny_judged: 1 } }), full, 'night')).toEqual([
      own(7, 'night'),
      'scene.e.oddny.answer',
    ]);
    // Nights 8 and 10: Ulf asks, and hears back, while he's at home.
    expect(scenesFor(night(8), full, 'night')).toEqual([own(8, 'night'), 'scene.e.steinar.ask']);
    expect(scenesFor(without(night(8), 'brother'), full, 'night')).toEqual([own(8, 'night')]);
    const asked = night(10, { flags: { errand_steinar: 1 } });
    expect(scenesFor(asked, full, 'night')).toEqual([own(10, 'night'), 'scene.e.steinar.answer']);
    expect(scenesFor(night(10), full, 'night')).toEqual([own(10, 'night')]);
    expect(scenesFor(without(asked, 'brother'), full, 'night')).toEqual([own(10, 'night')]);
    // Night 14: what they say of you at home, every run.
    expect(scenesFor(night(14), full, 'night')).toEqual([own(14, 'night'), 'scene.e.talk']);
    // Never in the morning.
    for (const day of [6, 7, 8, 10, 14]) {
      expect(scenesFor({ ...night(day), phase: 'morning' }, full, 'morning')).toEqual([own(day, 'morning')]);
    }
  });

  it('come after an origin’s scene on the same night', () => {
    expect(scenesFor(night(14, {}, 'seeress'), full, 'night')).toEqual([
      own(14, 'night'),
      'scene.o.seeress.2',
      'scene.e.talk',
    ]);
  });

  it('keep the word among the dead and the souls sent wrong in the journal, for the scene to be read again', () => {
    const save = startSave(full, 'household-journal', 1);
    const before: RunState = {
      ...night(14),
      word: -2,
      ledger: [...night(14).ledger, { ...({} as RunState['ledger'][number]), day: 13, wrong: 4 }],
    };
    expect(wrongSoFar(before)).toBe(4);
    const after = { ...before, flags: { ...before.flags, seen: 1 } };
    const journal =
      recordAction(save, before, { t: 'scene', id: 'scene.e.talk', choices: [0], effects: [] }, after).journal ?? [];
    expect(journal.at(-1)).toMatchObject({ day: 14, scene: 'scene.e.talk', word: -2, wrong: 4 });
  });
});

describe('errands at the desk', () => {
  const errands = [
    { id: 'case.oddny', flag: 'errand_oddny', from: 'mother' },
    { id: 'case.steinar', flag: 'errand_steinar', from: 'brother' },
  ];

  it('bring the soul only on runs where someone at home asked, and say who asked', () => {
    for (const { id, flag, from } of errands) {
      const plain = morningFor(id, {});
      expect(campaignQueue(plain, { content: full, ctx: runContext(full, plain) }).some((c) => c.script === id)).toBe(
        false,
      );
      const asked = morningFor(id, { [flag]: 1 });
      const queue = campaignQueue(asked, { content: full, ctx: runContext(full, asked) });
      const soul = queue.find((c) => c.script === id);
      if (!soul) throw new Error(`${id} isn't in the line`);
      expect(errandOf(full, soul)).toEqual({ from, text: story(id).errand?.text });
      for (const c of queue.filter((x) => x.script !== id)) expect(errandOf(full, c)).toBeNull();
    }
  });

  it('Oddny asks for the meadow herself: granted, a mistake all the same; either way, your mother hears', () => {
    const asked = morningFor('case.oddny', { errand_oddny: 1 });
    const refused = judged('case.oddny', asked, {});
    expect(pleaOf(full, refused.soul)).toEqual({ dest: 'FOLKVANGR', text: story('case.oddny').plea?.text });
    expect(refused.run.ledger.at(-1)?.wrong).toBe(0);
    expect(refused.run.flags).toMatchObject({ oddny_judged: 1, oddny_hel: 1 });
    expect(refused.run.flags.oddny_meadow).toBeUndefined();
    const granted = judged('case.oddny', asked, { stamped: 'FOLKVANGR' });
    expect(granted.run.ledger.at(-1)?.wrong).toBe(1);
    expect(granted.run.ledger.at(-1)?.mistakes).toEqual([
      expect.objectContaining({ stamped: 'FOLKVANGR', expected: 'HEL', pled: true }),
    ]);
    expect(granted.run.flags).toMatchObject({ oddny_judged: 1, oddny_meadow: 1 });
    // That night, her answer.
    expect(scenesFor({ ...granted.run, phase: 'night' }, full, 'night')).toContain('scene.e.oddny.answer');
  });

  it('Steinar: what you can tell Ulf is what you looked at, stamped rightly or not', () => {
    const asked = morningFor('case.steinar', { errand_steinar: 1 });
    const looked = judged('case.steinar', asked, { at: lookAtBack });
    expect(looked.run.flags).toMatchObject({ steinar_back: 1, steinar_judged: 1 });
    const unseen = judged('case.steinar', asked, {});
    expect(unseen.run.flags).toMatchObject({ steinar_judged: 1 });
    expect(unseen.run.flags.steinar_back).toBeUndefined();
    const wrong = judged('case.steinar', asked, { at: lookAtBack, stamped: 'VALHALLA' });
    expect(wrong.run.flags).toMatchObject({ steinar_back: 1, steinar_valhalla: 1 });
    expect(wrong.run.ledger.at(-1)?.wrong).toBe(1);
  });

  it('keep what was looked at on him if the sun sets while he’s at the desk', () => {
    const asked = morningFor('case.steinar', { errand_steinar: 1 });
    const { run } = judged('case.steinar', asked, { at: lookAtBack, dusk: true });
    expect(run.phase).toBe('audit');
    expect(run.flags.steinar_back).toBe(1);
    expect(run.flags.steinar_judged).toBeUndefined();
    const { run: idle } = judged('case.steinar', asked, { dusk: true });
    expect(idle.flags.steinar_back).toBeUndefined();
  });

  it('read what was looked at only on story souls that say what it does', () => {
    const asked = morningFor('case.steinar', { errand_steinar: 1 });
    const queue = campaignQueue(asked, { content: full, ctx: runContext(full, asked) });
    const soul = queue.find((c) => c.script === 'case.steinar') as CaseSpec;
    expect(seenEffects(full, soul, ['woundsBack'])).toEqual([{ flag: 'steinar_back' }]);
    expect(seenEffects(full, soul, ['woundsFront'])).toEqual([]);
    expect(seenEffects(full, soul, [])).toEqual([]);
    const other = queue.find((c) => !c.script) as CaseSpec;
    expect(seenEffects(full, other, ['woundsBack'])).toEqual([]);
  });
});
