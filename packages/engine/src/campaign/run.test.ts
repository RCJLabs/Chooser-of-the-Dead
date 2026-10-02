import { catchLie, loadContent, proveSoul } from '@cots/testkit';
import { fc, test } from '@fast-check/vitest';
import { describe, expect, it } from 'vitest';
import type { AppealsDef, CampaignDef, Content, Destination, Effect, Faction, ScriptedCaseDef } from '../content/types';
import { generateDay, tierKnobs } from '../gen/generate';
import { companionsAt, crossCaughtAt, givenAt, partyAt, partyOf } from '../gen/party';
import { scriptedCase } from '../gen/scripted';
import type { CaseSpec } from '../gen/types';
import { revealsOf, validateCase } from '../gen/validate';
import { createDayContext, type DayCtx, soulCtx } from '../logic/context';
import { judge } from '../logic/judge';
import { solve } from '../logic/solver';
import { type Assists, ruledOut, stepShift, sunCosts } from '../shift/shift';
import { battleDue } from './battle';
import { eventDays, eventLineChange, eventOn, eventSoulsOn } from './events';
import { beatsDay, dayGrade, GRADES } from './grade';
import { genderOfName, kinRelation, pleaOf, withKin, withPlea } from './pleas';
import {
  battleMarks,
  billForecast,
  campaignOf,
  campaignQueue,
  careFor,
  debtLimit,
  defaultBills,
  deskVisit,
  economyFor,
  endingFor,
  factionKey,
  favoursFor,
  hostMarks,
  newRun,
  nightOutlook,
  type RunAction,
  type RunEnv,
  type RunEvent,
  reachableEndings,
  shiftMods,
  soulName,
  stampEffects,
  stampRings,
  standingFx,
  stateMarks,
  stepRun,
  storyOffer,
  threadsInPlay,
} from './run';
import { type RunSave, recordAction, replayableDays, replayDay, resumeSave, runContext, startSave } from './save';
import { type FamilyMember, factionsMet, hostParts, type RunState, ragnarokStrength, stateValue } from './state';
import { weaveDay, weaveOpen, wovenRules } from './weave';

const demo = loadContent('web-demo');
const full = loadContent('dev-full');

/** The run with its reprieve already spent (docs/tech-spec.md §56), so the debt ends it as before. */
function spent(run: RunState, content: Content): RunState {
  const flag = campaignOf(content).reprieve?.flag;
  return flag ? { ...run, flags: { ...run.flags, [flag]: 1 } } : run;
}

/** Steps a run through actions, keeping the day context current and failing on rejections. */
function drive(content: Content, run0: RunState, actions: readonly RunAction[]) {
  let run = run0;
  let ctx: DayCtx = runContext(content, run);
  const events: RunEvent[] = [];
  for (const a of actions) {
    const r = stepRun(run, a, { content, ctx });
    const bad = r.events.find((e) => e.e === 'rejected');
    if (bad && bad.e === 'rejected') throw new Error(`${a.t} rejected: ${bad.reason}`);
    if (r.state.day !== run.day) ctx = runContext(content, r.state);
    run = r.state;
    events.push(...r.events);
  }
  return { run, events, ctx };
}

/**
 * A whole shift: judge each soul right (clipping what needs it, unless `uncut`), or wrong where `wrong(i)` says so;
 * catch lies if asked.
 */
function shiftActions(
  run: RunState,
  content: Content,
  opts: { wrong?: (i: number) => boolean; catchLies?: boolean; uncut?: boolean } = {},
): RunAction[] {
  const ctx = runContext(content, run);
  const started = stepRun(run, { t: 'beginShift', at: 0 }, { content, ctx }).state;
  const cases = started.shift?.cases ?? [];
  const actions: RunAction[] = [{ t: 'beginShift', at: 0 }];
  let at = 0;
  // A party (docs/tech-spec.md §69) is judged a member at a time, turning to each, and sent together.
  let party: { start: number; size: number } | null = null;
  cases.forEach((c, i) => {
    at += 20_000;
    party = partyAt(cases, i) ?? (party && i < party.start + party.size ? party : null);
    const k = party ? i - party.start : 0;
    if (party) actions.push({ t: 'shift', action: { t: 'turn', to: k, at } });
    if (opts.catchLies && c.lies.length > 0) {
      // Look at everything, then flag each contradiction the careful player would find.
      actions.push({ t: 'shift', action: { t: 'inspect', fields: c.evidence.fields.map((f) => f.id), at } });
    }
    const wrong = opts.wrong?.(i) ?? false;
    const dest: Destination = wrong ? (c.expect.dest === 'HEL' ? 'VALHALLA' : 'HEL') : c.expect.dest;
    // Judging right includes what must be done first (from Day 8, clipping long nails).
    for (const id of wrong || opts.uncut ? [] : (c.expect.procedures ?? [])) {
      const tool = ctx.procedures.find((p) => p.id === id)?.tool;
      if (tool) actions.push({ t: 'shift', action: { t: 'tool', tool, at } });
    }
    actions.push({ t: 'shift', action: { t: 'stamp', dest, at } });
    if (!party || k === party.size - 1) actions.push({ t: 'shift', action: { t: 'send', at } });
  });
  return actions;
}

function playDay(
  content: Content,
  run: RunState,
  opts: {
    wrong?: (i: number) => boolean;
    bills?: Partial<ReturnType<typeof defaultBills>>;
    buy?: string[];
    uncut?: boolean;
  } = {},
) {
  const shift = drive(content, run, shiftActions(run, content, opts));
  const night: RunAction[] = [{ t: 'endAudit' }];
  if (opts.bills) night.push({ t: 'bills', bills: { ...defaultBills(shift.run), ...opts.bills } });
  for (const item of opts.buy ?? []) night.push({ t: 'buy', item });
  night.push({ t: 'endNight' });
  const end = drive(content, shift.run, night);
  return { afterShift: shift.run, run: end.run, events: [...shift.events, ...end.events] };
}

describe('a campaign run', () => {
  it('starts on the morning of Day 1 with the family at home', () => {
    const run = newRun(demo, 'r');
    expect(run).toMatchObject({ day: 1, phase: 'morning', rings: campaignOf(demo).startRings, ending: null });
    expect(run.family.map((m) => [m.id, m.status])).toEqual([
      ['mother', 'well'],
      ['brother', 'well'],
      ['sister', 'well'],
    ]);
  });

  it('pays each soul judged rightly, then bills the night', () => {
    const run = newRun(demo, 'pay');
    const { afterShift, run: next, events } = playDay(demo, run);
    const souls = afterShift.shift?.cases.length ?? 0;
    const econ = demo.days[0]?.economy;
    expect(afterShift.phase).toBe('audit');
    expect(afterShift.ledger[0]).toMatchObject({
      day: 1,
      correct: souls,
      wrong: 0,
      pay: souls * (econ?.wage ?? 0),
      fines: 0,
    });
    expect(afterShift.rings).toBe(run.rings + souls * (econ?.wage ?? 0));
    // Hearth plus food for three.
    const bills = (econ?.costs.hearth ?? 0) + 3 * (econ?.costs.food ?? 0);
    expect(next).toMatchObject({ day: 2, phase: 'morning', rings: afterShift.rings - bills, shift: null });
    expect(next.ledger[0]?.night).toMatchObject({
      hearth: econ?.costs.hearth,
      food: 3 * (econ?.costs.food ?? 0),
      medicine: 0,
    });
    expect(events).toContainEqual({ e: 'dayBegins', day: 2 });
  });

  it('forgives the day’s warnings, then fines on the day’s schedule, repeating the last', () => {
    const { afterShift } = playDay(demo, newRun(demo, 'fines'), { wrong: () => true });
    const n = afterShift.shift?.cases.length ?? 0;
    const econ = demo.days[0]?.economy;
    const fines = econ?.fines ?? [];
    const charged = Array.from(
      { length: Math.max(0, n - (econ?.warnings ?? 0)) },
      (_, i) => fines[Math.min(i, fines.length - 1)] ?? 0,
    );
    expect(charged.length).toBeGreaterThan(2);
    expect(afterShift.ledger[0]).toMatchObject({
      correct: 0,
      wrong: n,
      pay: 0,
      fines: charged.reduce((a, b) => a + b, 0),
    });
  });

  it('Story Mode never fines and has no sun', () => {
    const run = newRun(demo, 'story', { story: true });
    const { afterShift } = playDay(demo, run, { wrong: () => true });
    expect(afterShift.ledger[0]?.fines).toBe(0);
    expect(afterShift.shift?.config.untimed).toBe(true);
  });

  it('pays the lie-catching bonus only for a caught lie on a soul judged rightly', () => {
    for (const seed of ['b1', 'b2', 'b3', 'b4', 'b5', 'b6']) {
      const run = newRun(demo, seed);
      const ctx = runContext(demo, run);
      let r = stepRun(run, { t: 'beginShift', at: 0 }, { content: demo, ctx }).state;
      const liar = r.shift?.cases.findIndex((c) => c.lies.length > 0) ?? -1;
      if (liar < 0) continue;
      let at = 0;
      for (const [i, c] of (r.shift?.cases ?? []).entries()) {
        at += 10_000;
        const step = (a: RunAction) => {
          r = stepRun(r, a, { content: demo, ctx }).state;
        };
        if (i === liar) {
          step({ t: 'shift', action: { t: 'inspect', fields: c.evidence.fields.map((f) => f.id), at } });
          const lie = c.lies[0]?.field ?? '';
          const other = c.evidence.fields.find((f) => f.item === 'body' && r.shift?.soul.seen.includes(f.id));
          for (const f of c.evidence.fields) step({ t: 'shift', action: { t: 'compare', a: lie, b: f.id, at } });
          expect(other).toBeDefined();
        }
        step({ t: 'shift', action: { t: 'stamp', dest: c.expect.dest, at } });
        step({ t: 'shift', action: { t: 'send', at } });
      }
      const wage = demo.days[0]?.economy?.wage ?? 0;
      const n = r.shift?.cases.length ?? 0;
      expect(r.ledger[0]).toMatchObject({ correct: n, bonus: 1, pay: n * wage });
      return;
    }
    throw new Error('no liar on Day 1 in six seeds');
  });

  it('keeps count of worthy and unworthy einherjar', () => {
    const { afterShift } = playDay(demo, newRun(demo, 'ein'), { wrong: () => true });
    const cases = afterShift.shift?.cases ?? [];
    // Wrong stamps send every HEL soul to Valhalla: all unworthy.
    const toValhalla = cases.filter((c) => c.expect.dest === 'HEL').length;
    expect(afterShift.einherjar).toEqual({ worthy: 0, unworthy: toValhalla });
    const right = playDay(demo, newRun(demo, 'ein')).afterShift;
    expect(right.einherjar).toEqual({ worthy: cases.filter((c) => c.expect.dest === 'VALHALLA').length, unworthy: 0 });
  });

  it('moves the gods’ standing with the mistakes that anger them', () => {
    const { afterShift } = playDay(demo, newRun(demo, 'stand'), { wrong: () => true });
    const cases = afterShift.shift?.cases ?? [];
    const hel = cases.filter((c) => c.expect.dest === 'HEL').length;
    const valhalla = cases.filter((c) => c.expect.dest === 'VALHALLA').length;
    expect(afterShift.standing).toMatchObject({ odin: -hel - valhalla, hel: -hel, freyja: 0 });
  });

  it('an assist can waive the fines, and the day’s accounts keep which assists were on', () => {
    const run = newRun(demo, 'nofines');
    const wrongDay = shiftActions(run, demo, { wrong: () => true });
    const fined = drive(demo, run, wrongDay).run.ledger[0];
    expect(fined?.fines).toBeGreaterThan(0);
    expect(fined?.assists).toBeUndefined();
    const assists = { sunPct: 50, noFines: true };
    const waived = drive(demo, run, [{ t: 'beginShift', at: 0, assists }, ...wrongDay.slice(1)]).run.ledger[0];
    expect(waived).toMatchObject({ fines: 0, wrong: fined?.wrong, assists });
  });

  it('files each soul sent wrong with the rule that decided it, and none on a day judged rightly', () => {
    const { afterShift } = playDay(demo, newRun(demo, 'mistakes'), { wrong: () => true });
    const ledger = afterShift.ledger.at(-1);
    const verdicts = afterShift.shift?.verdicts ?? [];
    expect(ledger?.mistakes).toHaveLength(ledger?.wrong ?? -1);
    expect(ledger?.mistakes).toEqual(
      verdicts
        .filter((v) => v.stamped !== null && !v.correct)
        .map((v) => ({ rule: v.rule, expected: v.expected, stamped: v.stamped })),
    );
    const right = playDay(demo, newRun(demo, 'mistakes')).afterShift.ledger.at(-1);
    expect(right?.mistakes).toBeUndefined();
  });

  it('leaves standing alone when every soul goes where it belongs', () => {
    const { afterShift } = playDay(demo, newRun(demo, 'stand'));
    expect(afterShift.ledger.at(-1)?.correct).toBeGreaterThan(0);
    expect(afterShift.standing).toEqual({ odin: 0, freyja: 0, hel: 0, loki: 0, clerk: 0 });
  });
});

describe('standing in the accounts', () => {
  const scene = (id: string, effects: readonly Effect[]): RunAction => ({ t: 'scene', id, effects });

  /** Every audit's mistakes and story, plus what the story has moved since the last one, is where the run stands. */
  function filed(run: RunState): Record<string, number> {
    const total: Record<string, number> = { odin: 0, freyja: 0, hel: 0, loki: 0, clerk: 0 };
    for (const l of run.ledger) {
      for (const [f, n] of Object.entries(l.standing)) total[f] = (total[f] ?? 0) + (n ?? 0);
      for (const [f, n] of Object.entries(l.story ?? {})) total[f] = (total[f] ?? 0) + (n ?? 0);
    }
    for (const [f, n] of Object.entries(run.storyStanding ?? {})) total[f] = (total[f] ?? 0) + (n ?? 0);
    return total;
  }

  it('files the story beside the day’s mistakes, from last night’s scene to this audit, so the columns add up', () => {
    let run = newRun(demo, 'accounts');
    expect(factionsMet(run)).toEqual([]);
    const day1 = drive(demo, run, [
      scene('scene.m1', [{ standing: 'odin', by: 1 }]),
      ...shiftActions(run, demo, { wrong: (i) => i === 0 }),
    ]).run;
    const first = day1.ledger.at(-1);
    expect(first?.story).toEqual({ odin: 1 });
    expect(Object.values(first?.standing ?? {}).some((n) => n !== 0)).toBe(true);
    expect(day1.storyStanding).toEqual({});
    expect(filed(day1)).toEqual(day1.standing);

    // Last night's scene waits for the next audit, with the next morning's.
    run = drive(demo, day1, [
      { t: 'endAudit' },
      scene('scene.n1', [
        { standing: 'loki', by: 1 },
        { standing: 'freyja', by: -1 },
      ]),
      { t: 'endNight' },
    ]).run;
    expect(run.storyStanding).toEqual({ loki: 1, freyja: -1 });
    expect(filed(run)).toEqual(run.standing);
    expect(factionsMet(run)).toEqual(expect.arrayContaining(['odin', 'loki', 'freyja']));
    const day2 = drive(demo, run, [scene('scene.m2', [{ standing: 'freyja', by: 1 }]), ...shiftActions(run, demo)]).run;
    expect(day2.ledger.at(-1)?.story).toEqual({ loki: 1, freyja: 0 });
    expect(filed(day2)).toEqual(day2.standing);
    // Freyja is back to 0, but the player has had dealings with her.
    expect(day2.standing.freyja).toBe(0);
    expect(factionsMet(day2)).toContain('freyja');
  });

  it('counts a story soul’s stamp as story, and says what each stamp does', () => {
    const run = newRun(full, 'loki-accounts', { slice: 'fromJump' });
    const { afterShift } = playDay(full, run);
    const loki = afterShift.shift?.cases.find((c) => c.script === 'case.loki12');
    if (!loki) throw new Error('no story Loki');
    expect(stampEffects(full, loki, 'DETAIN')).toEqual([
      { flag: 'loki_judged' },
      { flag: 'loki_detained' },
      { standing: 'odin', by: 1 },
    ]);
    expect(stampEffects(full, loki, 'VALHALLA')).toContainEqual({ standing: 'loki', by: 2 });
    const generated = afterShift.shift?.cases.find((c) => !c.script);
    if (generated) expect(stampEffects(full, generated, 'HEL')).toEqual([]);
    // The slice's jump is story too: it lands in the late day's first audit.
    const preset = campaignOf(full).slice?.preset.standing ?? {};
    const story = afterShift.ledger.at(-1)?.story ?? {};
    expect(story.odin).toBe((preset.odin ?? 0) + 1);
    expect(story.freyja).toBe(preset.freyja ?? 0);
    expect(filed(afterShift)).toEqual(afterShift.standing);
  });

  it('calls Loki the stranger until the story names him', () => {
    expect(factionKey(demo, 'loki', 3)).toBe('faction.stranger');
    expect(factionKey(full, 'loki', 11)).toBe('faction.stranger');
    expect(factionKey(full, 'loki', 12)).toBe('faction.loki');
    expect(factionKey(full, 'odin', 1)).toBe('faction.odin');
  });
});

describe('the family at night', () => {
  /** The same rules without the random chance, to test the sure thresholds. */
  const sure: Content = {
    ...full,
    campaign: { ...campaignOf(full), care: { ...campaignOf(full).care, sickChance: 0 } },
  };

  it('falls sick after two cold nights, recovers with medicine, and is lost without it', () => {
    const full = sure;
    let run = newRun(full, 'fam');
    const cold = { hearth: false };
    run = playDay(full, run, { bills: cold }).run;
    expect(run.family.every((m) => m.status === 'well' && m.cold === 1)).toBe(true);
    const second = playDay(full, run, { bills: cold });
    run = second.run;
    expect(run.family.every((m) => m.status === 'sick')).toBe(true);
    expect(second.events.filter((e) => e.e === 'family')).toHaveLength(3);
    // Medicine for the mother only; the others go a night sick without it.
    run = playDay(full, run, { bills: { hearth: true, medicine: ['mother'] } }).run;
    expect(run.family.map((m) => [m.id, m.status])).toEqual([
      ['mother', 'well'],
      ['brother', 'sick'],
      ['sister', 'sick'],
    ]);
    const lost = playDay(full, run, { bills: { hearth: true, medicine: [] } });
    // An adult can die; a child is sent to relatives, never dies (docs/build-plan.md §1).
    expect(lost.run.family.find((m) => m.id === 'brother')).toMatchObject({ status: 'gone', gone: 'died' });
    expect(lost.run.family.find((m) => m.id === 'sister')).toMatchObject({ status: 'gone', gone: 'left' });
    expect(lost.events).toContainEqual({ e: 'family', id: 'sister', change: 'left' });
  });

  it('makes one cold night a gamble: some fall sick, the same way on every replay', () => {
    const sickAfterOneColdNight = (seed: string) =>
      playDay(full, newRun(full, seed), { bills: { hearth: false } }).run.family.filter((m) => m.status === 'sick')
        .length;
    const counts = Array.from({ length: 30 }, (_, i) => sickAfterOneColdNight(`g${i}`));
    const total = counts.reduce((a, b) => a + b, 0);
    // 30% each for three people over 30 runs: about 27, never all or none.
    expect(total).toBeGreaterThan(10);
    expect(total).toBeLessThan(60);
    expect(counts.map((_, i) => sickAfterOneColdNight(`g${i}`))).toEqual(counts);
    // Paying for everything is never a gamble.
    for (let i = 0; i < 10; i++) {
      expect(playDay(full, newRun(full, `w${i}`)).run.family.every((m) => m.status === 'well')).toBe(true);
    }
  });

  it('medicine is only charged for the sick', () => {
    const run = newRun(demo, 'med');
    const next = playDay(demo, run, { bills: { medicine: ['mother', 'brother'] } }).run;
    expect(next.ledger[0]?.night?.medicine).toBe(0);
  });
});

describe('endings', () => {
  it('two nights deep in debt ends the run: Demoted, once the reprieve is spent', () => {
    let run: RunState = { ...spent(newRun(demo, 'debt'), demo), rings: -100 };
    run = playDay(demo, run, { wrong: () => true }).run;
    expect(run.debtNights).toBe(1);
    const end = playDay(demo, run, { wrong: () => true });
    expect(end.run).toMatchObject({ phase: 'ending', ending: 'ending.demoted' });
    expect(end.events).toContainEqual({ e: 'ended', ending: 'ending.demoted' });
    expect(
      stepRun(end.run, { t: 'endAudit' }, { content: demo, ctx: runContext(demo, end.run) }).events[0],
    ).toMatchObject({
      e: 'rejected',
    });
  });

  it('the demo ends after Day 3; the full build goes on', () => {
    let run = newRun(demo, 'fin');
    for (let d = 1; d <= 3; d++) run = playDay(demo, run).run;
    expect(run).toMatchObject({ phase: 'ending', ending: 'ending.demoEnd', day: 3 });
    let f = newRun(full, 'fin');
    for (let d = 1; d <= 3; d++) f = playDay(full, f).run;
    expect(f).toMatchObject({ phase: 'morning', day: 4 });
    for (let d = 4; d <= campaignOf(full).lastDay; d++) f = playDay(full, f).run;
    // To Ragnarök's night, and the horn: the hosts wait for their fronts (docs/tech-spec.md §54).
    expect(f).toMatchObject({ phase: 'ragnarok', day: campaignOf(full).lastDay, ending: null });
    f = drive(full, f, [{ t: 'marshal', order: [] }]).run;
    // Detaining the story Loki pleased Odin, so a perfect chooser with no story is his, with the wolf's front held;
    // without that point nothing else holds, and the finale ends the run.
    expect(f).toMatchObject({ phase: 'ending', ending: 'ending.odin' });
    expect(f.battle?.fronts.find((x) => x.id === 'front.wolf')?.held).toBe(true);
    expect(endingFor({ ...f, standing: { ...f.standing, odin: 0 } }, full)).toBe(campaignOf(full).finale);
  }, 30_000);

  it('Draupnir drips rings on its nights', () => {
    const content: Content = { ...demo, campaign: { ...campaignOf(demo), draupnir: { nights: [1], rings: 8 } } };
    const { run, events } = playDay(content, newRun(content, 'ring'));
    expect(events).toContainEqual({ e: 'draupnir', rings: 8 });
    expect(run.ledger[0]?.night?.draupnir).toBe(8);
  });
});

describe('planning the night', () => {
  /** A night on `day` of the full game, with the bills as set. */
  const night = (run: RunState, patch: Partial<RunState>) => {
    const r: RunState = { ...run, phase: 'night', ...patch };
    return { run: r, env: { content: full, ctx: runContext(full, r) } as RunEnv };
  };
  const member = (id: string, patch: Partial<FamilyMember> = {}): FamilyMember => ({
    id,
    status: 'well',
    cold: 0,
    hungry: 0,
    sickNights: 0,
    ...patch,
  });
  const memberArb = (id: string) =>
    fc
      .record({
        status: fc.constantFrom<FamilyMember['status']>('well', 'sick', 'gone'),
        cold: fc.integer({ min: 0, max: 1 }),
        hungry: fc.integer({ min: 0, max: 1 }),
        sickNights: fc.integer({ min: 0, max: 1 }),
      })
      .map((m): FamilyMember => ({ id, ...m, ...(m.status === 'gone' ? { gone: 'died' as const } : {}) }));

  test.prop(
    [
      fc.integer({ min: 1, max: 20 }),
      fc.integer({ min: -80, max: 80 }),
      fc.integer({ min: 0, max: 1 }),
      fc.tuple(memberArb('mother'), memberArb('brother'), memberArb('sister')),
      fc.record({ hearth: fc.boolean(), food: fc.boolean(), medicine: fc.subarray(['mother', 'brother', 'sister']) }),
      fc.nat(1000),
    ],
    { numRuns: 150 },
  )(
    'reckons tonight as the night does, all but who falls sick by chance',
    (day, rings, debtNights, family, bills, n) => {
      const { run, env } = night(newRun(full, `plan${n}`), { day, rings, debtNights, family, bills });
      const o = nightOutlook(run, env);
      const after = stepRun(run, { t: 'endNight' }, env).state;
      expect(after.rings).toBe(o.rings);
      expect(after.debtNights).toBe(o.debtNights);
      after.family.forEach((m, i) => {
        const n = o.members[i];
        if (!n) throw new Error(`no outlook for ${m.id}`);
        if (n.risk === 0 || m.status === n.member.status) expect(m).toEqual(n.member);
        else expect(m).toEqual({ ...n.member, status: 'sick', sickNights: 0 });
      });
      if (o.ends) expect(after.ending).toBe(o.ends.ending);
      else expect(['ending.demoted', 'ending.alone']).not.toContain(after.ending);
    },
  );

  it('says who is lost without medicine tonight, who surely falls sick, and the odds for the rest', () => {
    const base = newRun(full, 'odds');
    const family = [
      member('mother', { status: 'sick', sickNights: 1 }),
      member('brother', { cold: 1 }),
      member('sister', { status: 'sick', sickNights: 1 }),
    ];
    const { run, env } = night(base, { day: 5, family, bills: { hearth: false, food: true, medicine: [] } });
    const says = (o: ReturnType<typeof nightOutlook>) =>
      o.members.map((n) => [n.member.id, n.change ?? null, n.cause ?? null, n.risk]);
    // A second night sick without medicine: an adult dies, a child is sent to relatives. A second cold night: sick.
    expect(says(nightOutlook(run, env))).toEqual([
      ['mother', 'died', null, 0],
      ['brother', 'sick', 'cold', 0],
      ['sister', 'left', null, 0],
    ]);
    // Medicine makes the sick well; a first cold night is a 30% chance, and a hungry one too makes it 60%.
    const firstNight = [member('mother', { status: 'sick' }), member('brother'), member('sister')];
    const cold = night(base, {
      day: 5,
      family: firstNight,
      bills: { hearth: false, food: true, medicine: ['mother'] },
    });
    expect(says(nightOutlook(cold.run, cold.env))).toEqual([
      ['mother', 'well', null, 0],
      ['brother', null, null, 30],
      ['sister', null, null, 30],
    ]);
    const bare = { hearth: false, food: false, medicine: [] };
    expect(nightOutlook(cold.run, cold.env, bare).members.map((n) => n.risk)).toEqual([0, 60, 60]);
  });

  it('counts Draupnir in the purse by morning, and says when the debt would end the run', () => {
    // Night 9: firewood 14, food 7 for each of three, and Draupnir's 8.
    const base = spent(newRun(full, 'debt9'), full);
    const at = (rings: number, debtNights: number, from = base) => {
      const { run, env } = night(from, { day: 9, rings, debtNights, bills: defaultBills(from) });
      return nightOutlook(run, env);
    };
    expect(at(0, 1)).toMatchObject({ cost: { hearth: 14, food: 21, medicine: 0 }, draupnir: 8, rings: -27 });
    // Draupnir keeps a second night above the floor of -30; without enough, the second night below it ends the run.
    expect(at(0, 1)).toMatchObject({ debtNights: 0, ends: null });
    expect(at(-10, 0)).toMatchObject({ rings: -37, debtNights: 1, ends: null });
    expect(at(-10, 1)).toMatchObject({ debtNights: 2, ends: { ending: 'ending.demoted', why: 'debt' } });
    // Unless the reprieve is still to come: then it pays, and says so (docs/tech-spec.md §56).
    expect(at(-10, 1, newRun(full, 'debt9'))).toMatchObject({ rings: 0, debtNights: 0, ends: null, reprieve: true });
    expect(debtLimit(full)).toBe(2);
    expect(debtLimit(demo)).toBe(2);
  });

  it('says when no one would be left at home', () => {
    const family = [
      member('mother', { status: 'gone', gone: 'died' }),
      member('brother', { status: 'gone', gone: 'died' }),
      member('sister', { status: 'sick', sickNights: 1 }),
    ];
    const { run, env } = night(newRun(full, 'alone'), {
      day: 6,
      family,
      bills: { hearth: true, food: true, medicine: [] },
    });
    expect(nightOutlook(run, env).ends).toEqual({ ending: 'ending.alone', why: 'home' });
    expect(nightOutlook(run, env, { hearth: true, food: true, medicine: ['sister'] }).ends).toBeNull();
    expect(stateMarks(full, 'family.home').filter((m) => m.atMost !== undefined)).toEqual([
      { ending: 'ending.alone', atMost: 0 },
    ]);
  });

  it('forecasts the coming nights’ bills, as many as the run has left', () => {
    const run: RunState = { ...newRun(full, 'fc'), day: 6 };
    expect(billForecast(run, full)).toEqual([
      { day: 7, hearth: 11, food: 18, medicine: 12, draupnir: 0, tithe: 0 },
      { day: 8, hearth: 12, food: 18, medicine: 13, draupnir: 0, tithe: 0 },
      { day: 9, hearth: 14, food: 21, medicine: 14, draupnir: 8, tithe: 0 },
    ]);
    // A rank held owes Odin's tithe each night (docs/tech-spec.md §44).
    const tithe = campaignOf(full).promotion?.ranks[0]?.tithe ?? 0;
    expect(billForecast({ ...run, rank: 1 }, full).map((b) => b.tithe)).toEqual([tithe, tithe, tithe]);
    // Food is for those at home now.
    const two = run.family.map((m, i) => (i === 0 ? { ...m, status: 'gone' as const, gone: 'died' as const } : m));
    expect(billForecast({ ...run, family: two }, full)[0]?.food).toBe(12);
    expect(billForecast({ ...run, day: 19 }, full).map((b) => b.day)).toEqual([20]);
    expect(billForecast({ ...run, day: 20 }, full)).toEqual([]);
    expect(billForecast(newRun(demo, 'fc'), demo).map((b) => b.day)).toEqual([2, 3]);
    // The slice jumps from Day 3 to its late day, where it ends.
    const slice: RunState = { ...newRun(full, 'fc', { slice: 'play' }), day: 2 };
    expect(billForecast(slice, full).map((b) => b.day)).toEqual([3, 12]);
    expect(billForecast({ ...slice, day: 12 }, full)).toEqual([]);
  });
});

describe('the shop and scenes', () => {
  it('sells speed, never answers: a bought bier makes turning a body over cheaper', () => {
    let run: RunState = { ...newRun(demo, 'shop'), rings: 100 };
    run = playDay(demo, run, { buy: ['up.meadHorn'] }).run;
    expect(run.upgrades).toEqual(['up.meadHorn']);
    expect(run.ledger[0]?.night?.upgrades).toBe(15);
    run = playDay(demo, run, { buy: ['up.oiledBier'] }).run;
    expect(shiftMods(run, demo)).toEqual({ toolCostS: { flip: 1 }, questionS: 15 });
    const ctx = runContext(demo, run);
    const begun = stepRun(run, { t: 'beginShift', at: 0 }, { content: demo, ctx }).state;
    const flipped = stepRun(begun, { t: 'shift', action: { t: 'flip', at: 0 } }, { content: demo, ctx });
    expect(flipped.events).toContainEqual({ e: 'shift', event: { e: 'flipped', view: 'back', penaltyMs: 1_000 } });
  });

  it('refuses what you can’t afford, what isn’t on sale yet, and repeat purchases', () => {
    const run = newRun(demo, 'shop2');
    const shift = drive(demo, run, shiftActions(run, demo)).run;
    const night = drive(demo, shift, [{ t: 'endAudit' }]).run;
    const env: RunEnv = { content: demo, ctx: runContext(demo, night) };
    expect(stepRun(night, { t: 'buy', item: 'up.swanFeather' }, env).events[0]).toMatchObject({ e: 'rejected' });
    const poor = { ...night, rings: 3 };
    expect(stepRun(poor, { t: 'buy', item: 'up.meadHorn' }, env).events[0]).toMatchObject({ e: 'rejected' });
    const rich = stepRun({ ...night, rings: 50 }, { t: 'buy', item: 'up.meadHorn' }, env).state;
    expect(stepRun(rich, { t: 'buy', item: 'up.meadHorn' }, env).events[0]).toMatchObject({ e: 'rejected' });
  });

  it('applies a scene’s effects once', () => {
    const run = newRun(demo, 'scene');
    const env: RunEnv = { content: demo, ctx: runContext(demo, run) };
    const effects = [
      { rings: 3 },
      { standing: 'freyja' as const, by: 2 },
      { flag: 'met_loki' },
      { family: 'sister', becomes: 'sick' as const },
    ];
    const once = stepRun(run, { t: 'scene', id: 'scene.test', effects }, env);
    expect(once.state).toMatchObject({ rings: run.rings + 3, flags: { met_loki: 1 } });
    expect(once.state.standing.freyja).toBe(2);
    expect(once.state.family.find((m) => m.id === 'sister')?.status).toBe('sick');
    expect(stepRun(once.state, { t: 'scene', id: 'scene.test', effects }, env).state).toBe(once.state);
  });
});

describe('story souls', () => {
  /** A run on the morning of Day 3, where Thorvald waits. */
  function dayThree(content: Content, seed: string) {
    let run = newRun(content, seed);
    for (let d = 1; d < 3; d++) run = playDay(content, run).run;
    const ctx = runContext(content, run);
    return { run, ctx, queue: campaignQueue(run, { content, ctx }) };
  }

  it('places Thorvald among the generated souls, the same soul in every run', () => {
    const a = dayThree(demo, 'story-a');
    const b = dayThree(demo, 'story-b');
    const generated = generateDay(a.run.seed, a.ctx).cases;
    expect(a.queue).toHaveLength(generated.length + 1);
    expect(a.queue.filter((c) => !c.script)).toEqual(generated);
    const [ta, tb] = [a.queue[4], b.queue[4]];
    expect(ta?.script).toBe('case.thorvald1');
    expect(ta?.expect.dest).toBe('RETURN');
    expect(ta?.evidence.look).toMatchObject({ name: 'Thorvald', patronym: 'Ketilsson' });
    expect(ta?.evidence.fields.filter((f) => f.text?.msg.startsWith('case.thorvald1.'))).toHaveLength(3);
    expect(ta?.id).not.toBe(tb?.id);
    expect({ ...ta, id: '' }).toEqual({ ...tb, id: '' });
  });

  it('says the words a story soul fixes in every line, unless a fact fixes another', () => {
    const weapons = (c: { evidence: { fields: readonly { text?: { params: Record<string, unknown> } }[] } }) =>
      new Set(c.evidence.fields.flatMap((f) => (f.text?.params.weapon === undefined ? [] : [f.text.params.weapon])));
    const made = (def: ScriptedCaseDef, day: number) => {
      const m = scriptedCase(def, createDayContext(full, day, 'w'), 'w', 0);
      if (!m.ok) throw new Error(m.why);
      return m.case;
    };
    const days = new Map(full.days.flatMap((d) => (d.queue.scripted ?? []).map((s) => [s.case, d.day] as const)));
    let named = 0;
    for (const def of full.scripted ?? []) {
      const word = def.words?.['pool.weapons'];
      if (!word) continue;
      const c = made(def, days.get(def.id) ?? 0);
      expect(c.evidence.words, def.id).toEqual({ 'pool.weapons': word });
      const said = weapons(c);
      expect(
        [...said].every((w) => w === word),
        `${def.id} says ${[...said].join(', ')}`,
      ).toBe(true);
      named += said.size;
    }
    expect(named).toBeGreaterThan(0);
    // Hallbjorn's copied Ulfberht is a sword, whatever the soul's words say.
    const smith = full.scripted?.find((d) => d.id === 'case.hallbjorn_paid');
    if (!smith) throw new Error('no smith');
    expect(made({ ...smith, words: { 'pool.weapons': 'seax' } }, 8).evidence.words).toEqual({
      'pool.weapons': 'sword',
    });
  });

  it('leaves a story soul out when its condition fails', () => {
    const scripted = demo.scripted?.map((d) => ({ ...d, when: { state: 'flags.never', is: 1 } }));
    const gated: Content = { ...demo, ...(scripted ? { scripted } : {}) };
    expect(dayThree(gated, 'story-a').queue.some((c) => c.script)).toBe(false);
  });

  it('remembers how the story soul was stamped', () => {
    const { run } = dayThree(demo, 'story-stamp');
    const right = drive(demo, run, shiftActions(run, demo)).run;
    expect(right.flags).toMatchObject({ thorvald_met: 1, thorvald_returned: 1 });
    expect(right.flags.thorvald_valhalla).toBeUndefined();
    const wrong = drive(demo, run, shiftActions(run, demo, { wrong: (i) => i === 4 })).run;
    expect(wrong.flags).toMatchObject({ thorvald_met: 1 });
    expect(wrong.flags.thorvald_returned).toBeUndefined();
  });

  it('counts story rings in the night’s accounts', () => {
    const run = newRun(demo, 'story-rings');
    const scene: RunAction = { t: 'scene', id: 'scene.d1.night', effects: [{ rings: -5 }, { rings: 2 }] };
    const day = drive(demo, run, [...shiftActions(run, demo), { t: 'endAudit' }, scene, { t: 'endNight' }]);
    const l = day.run.ledger[0];
    expect(l?.night?.story).toBe(-3);
    expect(day.run.storyRings).toBe(0);
    const n = l?.night;
    if (!l || !n) throw new Error('no ledger');
    expect(run.rings + l.pay + l.bonus - l.fines - n.hearth - n.food - n.medicine - n.upgrades + n.story).toBe(n.rings);
  });
});

describe('saves', () => {
  /** Plays whole days (a morning and a night scene each, with made-up effects) and records every action. */
  function playRecorded(content: Content, save0: RunSave, days: number, stopMidDay = false) {
    let save = save0;
    let run = resumeSave(save, content, 0).run;
    let ctx = runContext(content, run);
    const apply = (a: RunAction) => {
      const r = stepRun(run, a, { content, ctx, ...(save.queue ? { queue: save.queue } : {}) });
      if (r.state !== run) save = recordAction(save, run, a, r.state);
      if (r.state.day !== run.day) ctx = runContext(content, r.state);
      run = r.state;
    };
    for (let d = 0; d < days; d++) {
      apply({ t: 'scene', id: `scene.d${run.day}.morning`, choices: [d], effects: [{ flag: `morning${run.day}` }] });
      const actions = shiftActions(run, content);
      const cut = stopMidDay && d === days - 1 ? Math.floor(actions.length / 2) : actions.length;
      for (const a of actions.slice(0, cut)) apply(a);
      if (cut < actions.length) break;
      apply({ t: 'endAudit' });
      apply({ t: 'scene', id: `scene.d${run.day}.night`, choices: [1, 0], effects: [{ rings: 1 }] });
      apply({ t: 'endNight' });
    }
    return { save, run };
  }

  it('resumes mid-day exactly, from the morning snapshot and today’s actions', () => {
    const { save, run } = playRecorded(full, startSave(full, 'save', 0), 3, true);
    expect(save.mornings.map((m) => m.day)).toEqual([1, 2, 3]);
    expect(save.queue).toEqual(run.shift?.cases);
    expect(resumeSave(save, full, 0)).toEqual({ run, rewound: false });
  });

  it('a day resumed mid-shift keeps the assists its shift began with', () => {
    let save = startSave(demo, 'assisted', 0);
    let run = resumeSave(save, demo, 0).run;
    const ctx = runContext(demo, run);
    const [, ...rest] = shiftActions(run, demo);
    const actions: RunAction[] = [
      { t: 'beginShift', at: 0, assists: { sunPct: 50, tracker: true } },
      ...rest.slice(0, 2),
    ];
    for (const a of actions) {
      const r = stepRun(run, a, { content: demo, ctx, ...(save.queue ? { queue: save.queue } : {}) });
      save = recordAction(save, run, a, r.state);
      run = r.state;
    }
    const resumed = resumeSave(save, demo, 0).run;
    expect(resumed.shift?.config.assists).toEqual({ sunPct: 50, tracker: true });
    expect(resumed.shift?.sunMs).toBe(2 * (ctx.spec.sunS * 1000));
    expect(resumed).toEqual(run);
  });

  it('uses the saved queue, not a regenerated one', () => {
    const { save } = playRecorded(full, startSave(full, 'q', 0), 1, true);
    const tampered = { ...save, queue: (save.queue ?? []).map((c) => ({ ...c, id: `${c.id}!` })) };
    expect(resumeSave(tampered, full, 0).run.shift?.cases[0]?.id).toMatch(/!$/);
  });

  it('replays any day from its morning, discarding the days after it', () => {
    const { save } = playRecorded(full, startSave(full, 'replay', 0), 3);
    const back = replayDay(save, 2);
    expect(back.mornings.map((m) => m.day)).toEqual([1, 2]);
    expect(back.log).toEqual([]);
    expect(resumeSave(back, full, 0).run).toEqual(save.mornings[1]);
  });

  it('rewinds to the morning when the engine changed since the save', () => {
    const { save } = playRecorded(full, startSave(full, 'eng', 0), 2, true);
    expect(resumeSave(save, full, 1)).toEqual({ run: save.mornings[1], rewound: true });
  });

  it('keeps every scene played in the journal, with the choices and what it read as it began', () => {
    const { save } = playRecorded(full, startSave(full, 'journal', 0), 3);
    expect(save.journal?.map((e) => [e.day, e.scene, e.choices])).toEqual([
      [1, 'scene.d1.morning', [0]],
      [1, 'scene.d1.night', [1, 0]],
      [2, 'scene.d2.morning', [1]],
      [2, 'scene.d2.night', [1, 0]],
      [3, 'scene.d3.morning', [2]],
      [3, 'scene.d3.night', [1, 0]],
    ]);
    // Day 2's morning scene read the run as that morning began: Day 1's flags, rings after the night.
    const day2 = save.journal?.[2];
    expect(day2?.flags).toEqual(save.mornings[1]?.flags);
    expect(day2?.rings).toBe(save.mornings[1]?.rings);
    expect(day2?.family).toEqual({ mother: 'well', brother: 'well', sister: 'well' });
  });

  it('forgets the journal of the days a replay discards, and a replayed scene replaces its entry', () => {
    const { save } = playRecorded(full, startSave(full, 'journal-replay', 0), 3);
    const back = replayDay(save, 2);
    expect(back.journal?.map((e) => e.day)).toEqual([1, 1]);
    const again = playRecorded(full, back, 1).save;
    expect(again.journal?.map((e) => `${e.day}:${e.scene}`)).toEqual([
      '1:scene.d1.morning',
      '1:scene.d1.night',
      '2:scene.d2.morning',
      '2:scene.d2.night',
    ]);
    // A restarted day (a new engine) plays its morning scene again: the entry is replaced, not doubled.
    const restarted = recordAction(
      again,
      save.mornings[1] as RunState,
      { t: 'scene', id: 'scene.d2.morning', choices: [3], effects: [] },
      {
        ...(save.mornings[1] as RunState),
        scenes: ['scene.d2.morning'],
      },
    );
    expect(restarted.journal?.filter((e) => e.scene === 'scene.d2.morning').map((e) => e.choices)).toEqual([[3]]);
  });
});

describe('the Ragnarök report', () => {
  it('breaks the host into its parts, which add up to its strength', () => {
    let run = newRun(full, 'host');
    for (let d = 1; d <= 3; d++) run = playDay(full, run, { wrong: (i) => i % 3 === 0 }).run;
    const withNails = { ...run, naglfar: 4, sent: { ...run.sent, FOLKVANGR: 5, HEL: 7 } };
    const p = hostParts(withNails);
    expect(p).toMatchObject({ folkvangr: 5, hel: 7, naglfar: 4 });
    expect(p.total).toBe(2 * p.worthy - p.unworthy + 2 * p.folkvangr + 2 * p.hel - 2 * p.naglfar);
    expect(ragnarokStrength(withNails)).toBe(p.total);
  });

  it('lists the endings a run can reach, and what they ask of the host', () => {
    expect(reachableEndings(demo).map((e) => e.id)).toEqual(['ending.demoted', 'ending.alone', 'ending.demoEnd']);
    const full11 = reachableEndings(full).map((e) => e.id);
    expect(full11).toHaveLength(11);
    expect(full11).not.toContain('ending.demoEnd');
    expect(full11.at(-1)).toBe('ending.lastStand');
    // The host's number no longer decides an ending: the last battle does (docs/tech-spec.md §54).
    expect(hostMarks(full)).toEqual([]);
    expect(battleMarks(full)).toEqual([
      { ending: 'ending.rebirth', atLeast: 3, held: ['front.fire'] },
      { ending: 'ending.hel', held: ['front.gate'] },
      { ending: 'ending.freyja', held: ['front.fire'] },
      { ending: 'ending.odin', held: ['front.wolf'] },
      { ending: 'ending.wolf', atMost: 1, held: [] },
    ]);
    expect(battleMarks(demo)).toEqual([]);
  });
});

describe('the last battle (docs/tech-spec.md §54)', () => {
  // A perfect chooser's run to the last day's night, bills set, and the horn after it.
  let memo: { night: RunState; horn: RunState } | undefined;
  const lastNight = () => {
    if (memo) return memo;
    let run = newRun(full, 'battle-run');
    const last = campaignOf(full).lastDay;
    for (let d = 1; d < last; d++) run = playDay(full, run).run;
    const night = drive(full, run, [...shiftActions(run, full), { t: 'endAudit' }]).run;
    memo = { night, horn: drive(full, night, [{ t: 'endNight' }]).run };
    return memo;
  };
  const env = (run: RunState) => ({ content: full, ctx: runContext(full, run) });
  const marshal = (run: RunState, order: readonly string[] = []) => stepRun(run, { t: 'marshal', order }, env(run));

  it('comes after the last night, and nothing else can be done till the hosts are sent', () => {
    const { night, horn } = lastNight();
    expect(battleDue(night, full)).toBe(true);
    const ended = stepRun(night, { t: 'endNight' }, env(night));
    expect(ended.events).toContainEqual({ e: 'horn' });
    expect(horn).toMatchObject({ phase: 'ragnarok', ending: null, bills: null });
    expect(horn.battle).toBeUndefined();
    // Before it's fought no ending that reads it can hold, and there's no finale yet.
    expect(endingFor(horn, full)).toBeNull();
    expect(stateValue(horn, 'fronts')).toBe(0);
    for (const a of [{ t: 'endNight' }, { t: 'endAudit' }, { t: 'beginShift', at: 0 }] as RunAction[]) {
      expect(stepRun(horn, a, env(horn)).events[0]?.e, a.t).toBe('rejected');
    }
    // Fought: every front, in the content's order, and the ending.
    const fought = marshal(horn, ['front.gate']);
    expect(fought.events.map((e) => e.e)).toEqual(['fought', 'ended']);
    const battle = fought.state.battle;
    expect(battle?.order[0]).toBe('front.gate');
    expect(battle?.fronts.map((x) => x.id)).toEqual(campaignOf(full).ragnarok?.fronts.map((x) => x.id));
    expect(fought.state.phase).toBe('ending');
    expect(stateValue(fought.state, 'fronts')).toBe(battle?.fronts.filter((x) => x.held).length);
    for (const x of battle?.fronts ?? []) expect(stateValue(fought.state, x.id), x.id).toBe(x.held ? 1 : 0);
    // It's fought once.
    expect(marshal(fought.state).events[0]).toMatchObject({ e: 'rejected' });
    expect(marshal(night).events[0]).toMatchObject({ e: 'rejected' });
  }, 30_000);

  it('waits for an ending checked before any that reads it: deep in debt on the last night, no battle', () => {
    const { night } = lastNight();
    const broke = { ...spent(night, full), rings: -1000, debtNights: 1 };
    const r = stepRun(broke, { t: 'endNight' }, env(broke));
    expect(r.state).toMatchObject({ phase: 'ending', ending: 'ending.demoted' });
    expect(r.events).not.toContainEqual({ e: 'horn' });
    // With the reprieve still to come, it pays, and the horn blows.
    const saved = stepRun({ ...night, rings: -1000, debtNights: 1 }, { t: 'endNight' }, env(broke));
    expect(saved.state).toMatchObject({ phase: 'ragnarok', ending: null });
    expect(saved.events.map((e) => e.e)).toContain('reprieve');
  });

  it('rides to the front the player chooses, worth the ride there, and refuses a front there isn’t (§58)', () => {
    const { horn } = lastNight();
    const strength = campaignOf(full).ragnarok?.ride?.strength ?? 0;
    expect(strength).toBeGreaterThan(0);
    const rode = stepRun(horn, { t: 'marshal', order: [], ride: 'front.fire' }, env(horn));
    expect(rode.state.battle?.ride).toBe('front.fire');
    const fire = rode.state.battle?.fronts.find((f) => f.id === 'front.fire');
    const without = marshal(horn).state.battle?.fronts.find((f) => f.id === 'front.fire');
    expect(fire?.ride).toBe(strength);
    expect(fire?.strength).toBeGreaterThanOrEqual(without?.strength ?? 0);
    expect(stepRun(horn, { t: 'marshal', order: [], ride: 'front.moon' }, env(horn)).events[0]).toMatchObject({
      e: 'rejected',
    });
  });

  it('decides the endings that read it: which fronts held, and how many', () => {
    const { horn } = lastNight();
    // No worthy einherjar and nobody in the other halls: at most the shore, and the wolf wins.
    const empty: RunState = {
      ...horn,
      einherjar: { worthy: 0, unworthy: 10 },
      sent: { RAN: horn.sent?.RAN ?? 0 },
      misfits: {},
    };
    const lost = marshal(empty).state;
    expect(stateValue(lost, 'fronts')).toBeLessThanOrEqual(1);
    expect(lost.ending).toBe('ending.wolf');
    // Odin's chooser needs his front held: led by Odin, with the wolf's front given up, the ending isn't his.
    const odin = { ...horn, standing: { ...horn.standing, odin: 5 } };
    expect(marshal(odin, ['front.wolf']).state.ending).toBe('ending.odin');
    const noWolf: RunState = { ...odin, einherjar: { worthy: 0, unworthy: 0 } };
    const lostWolf = marshal(noWolf, ['front.fire', 'front.gate', 'front.ship']).state;
    expect(stateValue(lostWolf, 'front.wolf')).toBe(0);
    expect(lostWolf.ending).not.toBe('ending.odin');
    // The green earth needs the fire held, and three fronts in all.
    const wood = { ...horn, flags: { ...horn.flags, wood: 1, truth: 3 } };
    const green = marshal(wood, ['front.fire']).state;
    expect(stateValue(green, 'front.fire')).toBe(1);
    expect(green.ending).toBe('ending.rebirth');
    // With nobody in Freyja's host and the gate held first, what Hel's legion can spare doesn't hold the fire.
    const burnt: RunState = { ...wood, sent: { ...wood.sent, FOLKVANGR: 0 }, einherjar: { worthy: 5, unworthy: 0 } };
    const noFire = marshal(burnt, ['front.gate', 'front.wolf', 'front.ship', 'front.fire']).state;
    expect(stateValue(noFire, 'front.fire')).toBe(0);
    expect(noFire.ending).not.toBe('ending.rebirth');
  });

  it('is in the save: resumed, the same order fights the same battle', () => {
    let save = startSave(full, 'battle-save', 0);
    let run = resumeSave(save, full, 0).run;
    const last = campaignOf(full).lastDay;
    const step = (a: RunAction) => {
      const r = stepRun(run, a, env(run));
      if (r.state !== run) save = recordAction(save, run, a, r.state);
      run = r.state;
    };
    while (run.phase !== 'ragnarok' && run.day <= last) {
      for (const a of [...shiftActions(run, full), { t: 'endAudit' } as RunAction, { t: 'endNight' } as RunAction])
        step(a);
    }
    expect(run.phase).toBe('ragnarok');
    expect(resumeSave(save, full, 0).run).toEqual(run);
    step({ t: 'marshal', order: ['front.ship', 'front.fire'] });
    expect(run.phase).toBe('ending');
    expect(resumeSave(save, full, 0).run).toEqual(run);
  }, 30_000);

  it('names the story’s own souls sent into a host, who won’t run', () => {
    const { horn } = lastNight();
    const named = horn.named ?? [];
    // A perfect chooser: nobody runs, and each named soul is one of the story's.
    expect(named.length).toBeGreaterThan(0);
    expect(named.filter((n) => n.runs)).toEqual([]);
    const story = new Set((full.scripted ?? []).map((c) => `${c.look.name} ${c.look.patronym}`));
    for (const n of named) expect(story.has(n.name), n.name).toBe(true);
  }, 30_000);

  it('never comes in the demo or the vertical slice', () => {
    expect(battleDue({ ...newRun(demo, 'x'), day: 3 }, demo)).toBe(false);
    expect(battleDue({ ...newRun(full, 'x'), day: 20, slice: true }, full)).toBe(false);
    const { horn } = lastNight();
    const { ragnarok: _, ...without } = campaignOf(full);
    const plain: Content = { ...full, campaign: without };
    expect(battleDue(horn, plain)).toBe(false);
  });
});

describe('souls sent to the wrong hall (docs/tech-spec.md §54)', () => {
  it('are counted at the audit by the hall they were sent to', () => {
    const { afterShift, run } = playDay(demo, newRun(demo, 'misfits'), { wrong: (i) => i % 2 === 0 });
    const wrong = (afterShift.shift?.verdicts ?? []).filter((v) => v.stamped !== null && v.stamped !== v.expected);
    expect(wrong.length).toBeGreaterThan(0);
    const tally: Partial<Record<Destination, number>> = {};
    for (const v of wrong) if (v.stamped) tally[v.stamped] = (tally[v.stamped] ?? 0) + 1;
    expect(run.misfits).toEqual(tally);
    // A day judged rightly adds none.
    const clean = playDay(demo, run).run;
    expect(clean.misfits).toEqual(tally);
    // A build without the battle names nobody.
    expect(run.named).toBeUndefined();
  });

  it('are named, in the full game, in the host of the hall they were sent to: as many as will run from it', () => {
    let run = newRun(full, 'named');
    for (let d = 1; d <= 4; d++) run = playDay(full, run, { wrong: (i) => (i + d) % 3 === 0 }).run;
    const hosts = campaignOf(full).ragnarok?.hosts ?? [];
    const named = run.named ?? [];
    expect(named.filter((n) => n.runs).length).toBeGreaterThan(0);
    for (const n of named) {
      expect(
        hosts.some((h) => h.hall === n.hall),
        n.name,
      ).toBe(true);
      expect(n.day).toBeGreaterThanOrEqual(1);
      expect(n.day).toBeLessThanOrEqual(4);
    }
    // Each host's runners, named, are as many as run from it: the unworthy from Valhalla, the misfits elsewhere.
    for (const h of hosts) {
      const runs = named.filter((n) => n.hall === h.hall && n.runs).length;
      const counted = h.hall === 'VALHALLA' ? run.einherjar.unworthy : (run.misfits?.[h.hall] ?? 0);
      expect(runs, h.hall).toBe(counted);
    }
  });
});

describe('story threads', () => {
  it('lists the threads whose conditions hold, with their counts', () => {
    const run = newRun(full, 'threads');
    expect(threadsInPlay(run, full)).toEqual([]);
    const later = { ...run, day: 17, flags: { loki_deal: 1, truth: 2, owes_skogul: 0 } };
    const ids = threadsInPlay(later, full).map((th) => th.id);
    expect(ids).toContain('thread.lokiDeal');
    expect(ids).not.toContain('thread.owesSkogul');
    expect(threadsInPlay(later, full).find((th) => th.id === 'thread.truth')).toMatchObject({ n: 2 });
  });
});

describe('the vertical slice', () => {
  const slice = campaignOf(full).slice;

  it('plays its first days, then jumps to its late day with what the skipped days brought', () => {
    if (!slice) throw new Error('dev-full has no slice');
    let run = newRun(full, 'slice', { slice: 'play' });
    for (let day = 1; day <= slice.after; day++) {
      expect(run.day).toBe(day);
      run = playDay(full, run).run;
    }
    expect(run).toMatchObject({ day: slice.day, phase: 'morning', slice: true });
    for (const [flag, value] of Object.entries(slice.preset.flags ?? {})) expect(run.flags[flag]).toBe(value);
    // Day 3's own story memory survives the jump.
    expect(run.flags.thorvald_met).toBe(1);
    const late = playDay(full, run);
    expect(late.run).toMatchObject({ phase: 'ending', ending: slice.finale });
  });

  it('can start on its late day, and a plain campaign never jumps', () => {
    if (!slice) throw new Error('dev-full has no slice');
    const jumped = newRun(full, 'jump', { slice: 'fromJump' });
    expect(jumped).toMatchObject({
      day: slice.day,
      slice: true,
      rings: campaignOf(full).startRings + (slice.preset.rings ?? 0),
    });
    expect(jumped.standing.odin).toBe(slice.preset.standing?.odin ?? 0);
    let plain = newRun(full, 'plain');
    for (let day = 1; day <= slice.after; day++) plain = playDay(full, plain).run;
    expect(plain.day).toBe(slice.after + 1);
    expect(() => newRun(demo, 'demo', { slice: 'play' })).toThrow('no vertical slice');
  });

  it('puts the story Loki in the late day, and detaining him is remembered', () => {
    const run = newRun(full, 'loki', { slice: 'fromJump' });
    const { afterShift, run: night } = playDay(full, run);
    const loki = afterShift.shift?.cases.find((c) => c.script === 'case.loki12');
    expect(loki?.expect.dest).toBe('DETAIN');
    expect(night.flags).toMatchObject({ loki_judged: 1, loki_detained: 1 });
  });
});

describe('appeals', () => {
  /** The demo with appeals that come for certain after a mistake (or as asked), from Day 1. */
  const appealing = (content: Content, appeals: Partial<AppealsDef> = {}): Content => ({
    ...content,
    campaign: {
      ...campaignOf(content),
      appeals: { from: 1, afterMistake: 100, otherwise: 0, chancers: 0, bonus: 3, fine: 5, ...appeals },
    },
  });
  const hear = (content: Content, run: RunState, stamped: Destination | null) =>
    stepRun(run, { t: 'appeal', stamped }, { content, ctx: runContext(content, run) });

  it('brings the next morning a soul sent to the wrong place, as it stood, with what the mistake cost', () => {
    const content = appealing(demo);
    const { afterShift, run } = playDay(content, newRun(content, 'appeal-cost'), { wrong: () => true });
    const appeal = run.appeal;
    expect(run.phase).toBe('morning');
    expect(appeal).toBeDefined();
    if (!appeal) return;
    expect(appeal.day).toBe(1);
    const verdicts = afterShift.shift?.verdicts ?? [];
    const v = verdicts.find((x) => afterShift.shift?.cases[x.index]?.id === appeal.case.id);
    expect(v?.stamped).toBe(appeal.stamped);
    if (!v) return;
    expect(appeal.stamped).not.toBe(appeal.case.expect.dest);
    // Its fine is the one its place among the day's mistakes drew: the first few are only warnings.
    const economy = content.days[0]?.economy;
    const k = verdicts.filter((x) => x.stamped !== null && !x.correct).indexOf(v) + 1;
    const warnings = economy?.warnings ?? 0;
    const fines = economy?.fines ?? [];
    expect(appeal.fine).toBe(k > warnings ? (fines[Math.min(k - warnings - 1, fines.length - 1)] ?? 0) : 0);
  });

  it('rights a mistake: its fine comes back, the standing it moved is undone, and the soul changes hall', () => {
    const content = appealing(demo);
    // A day of mistakes, and the appeal that comes after it with a fine to give back.
    const found = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6']
      .map((seed) => playDay(content, newRun(content, `appeal-right-${seed}`), { wrong: () => true }).run)
      .find((r) => (r.appeal?.fine ?? 0) > 0 && Object.keys(r.appeal?.standing ?? {}).length > 0);
    expect(found).toBeDefined();
    if (!found?.appeal) return;
    const appeal = found.appeal;
    const right = appeal.case.expect.dest;
    const { state, events } = hear(content, found, right);
    expect(state.appeal).toBeUndefined();
    expect(state.appealHeard).toMatchObject({
      outcome: 'righted',
      from: appeal.stamped,
      to: right,
      rings: appeal.fine,
    });
    expect(events).toContainEqual({ e: 'appealed', heard: state.appealHeard });
    expect(state.rings).toBe(found.rings + appeal.fine);
    for (const [f, n] of Object.entries(appeal.standing)) {
      expect(state.standing[f as keyof RunState['standing']]).toBe(
        found.standing[f as keyof RunState['standing']] - (n ?? 0),
      );
    }
    expect(state.sent?.[right] ?? 0).toBe((found.sent?.[right] ?? 0) + 1);
    expect(state.sent?.[appeal.stamped] ?? 0).toBe((found.sent?.[appeal.stamped] ?? 0) - 1);
    // It no longer stands in the wrong hall's host, to run at Ragnarök (docs/tech-spec.md §54).
    expect(state.misfits?.[appeal.stamped] ?? 0).toBe((found.misfits?.[appeal.stamped] ?? 0) - 1);
    expect(state.misfits?.[right] ?? 0).toBe(found.misfits?.[right] ?? 0);
  });

  it('takes a righted soul out of the host it would have run from, by name (docs/tech-spec.md §54)', () => {
    const content = appealing(full);
    // Every soul sent wrong on Day 1, where both halls have hosts: the appeal comes from one who'll run.
    const found = playDay(content, newRun(content, 'appeal-named'), { wrong: () => true }).run;
    const appeal = found.appeal;
    expect(appeal).toBeDefined();
    if (!appeal) return;
    const name = `${appeal.case.evidence.look.name} ${appeal.case.evidence.look.patronym}`;
    const was = (r: RunState) => (r.named ?? []).filter((n) => n.name === name && n.day === appeal.day);
    expect(was(found)).toEqual([{ name, day: 1, hall: appeal.stamped, runs: true }]);
    // Sent where it belonged, it won't run, and (not one of the story's souls) the battle doesn't name it.
    const righted = hear(content, found, appeal.case.expect.dest).state;
    expect(was(righted)).toEqual([]);
    expect(righted.named?.length).toBe((found.named?.length ?? 0) - 1);
    // Upheld in another wrong hall, it runs from that one instead.
    const other = (['VALHALLA', 'HEL'] as const).find((d) => d !== appeal.stamped && d !== appeal.case.expect.dest);
    if (other) expect(was(hear(content, found, other).state)).toEqual([{ name, day: 1, hall: other, runs: true }]);
  });

  it('rewards turning down a soul judged rightly, fines deciding wrongly, and lets a verdict stand for nothing', () => {
    // No mistakes, so the only appeals are from souls judged rightly, trying their luck.
    const content = appealing(demo, { afterMistake: 0, otherwise: 100 });
    const run = ['c1', 'c2', 'c3', 'c4']
      .map((seed) => playDay(content, newRun(content, `appeal-chancer-${seed}`)).run)
      .find((r) => r.appeal !== undefined);
    expect(run?.appeal).toBeDefined();
    if (!run?.appeal) return;
    const { stamped, case: c } = run.appeal;
    expect(stamped).toBe(c.expect.dest);
    expect(['HEL', 'RAN', 'TRANSFER']).toContain(stamped);

    const upheld = hear(content, run, stamped).state;
    expect(upheld.appealHeard).toMatchObject({ outcome: 'upheld', rings: 3 });
    expect(upheld.rings).toBe(run.rings + 3);

    const other: Destination = stamped === 'HEL' ? 'VALHALLA' : 'HEL';
    const wrong = hear(content, run, other).state;
    expect(wrong.appealHeard).toMatchObject({ outcome: 'wrong', to: other, rings: -5 });
    expect(wrong.rings).toBe(run.rings - 5);
    expect(wrong.sent?.[other] ?? 0).toBe((run.sent?.[other] ?? 0) + 1);

    const stood = hear(content, run, null).state;
    expect(stood.appealHeard).toMatchObject({ outcome: 'letStand', to: null, rings: 0 });
    expect(stood.rings).toBe(run.rings);
    expect(stood.standing).toEqual(run.standing);
    // Heard once: a second hearing is refused.
    expect(hear(content, stood, stamped).events).toContainEqual({ e: 'rejected', reason: 'no appeal to hear' });
  });

  it('lapses when the gate opens unheard, and each day files its appeal in its ledger', () => {
    const content = appealing(demo);
    const day1 = playDay(content, newRun(content, 'appeal-lapse'), { wrong: () => true }).run;
    expect(day1.appeal).toBeDefined();
    const day2 = playDay(content, day1);
    expect(day2.afterShift.appeal).toBeUndefined();
    expect(day2.afterShift.appealHeard).toBeUndefined();
    expect(day2.afterShift.ledger.at(-1)?.appeal).toMatchObject({ day: 1, outcome: 'letStand' });
    // Heard, and filed the same way.
    const heard = hear(content, day1, day1.appeal?.case.expect.dest ?? 'HEL').state;
    const filed = playDay(content, heard).afterShift.ledger.at(-1)?.appeal;
    expect(filed).toMatchObject({ day: 1, outcome: 'righted' });
  });

  it('comes the same way to the same run, never from a story soul, and not after the last day', () => {
    const content = appealing(demo);
    const a = playDay(content, newRun(content, 'appeal-same'), { wrong: () => true }).run.appeal;
    const b = playDay(content, newRun(content, 'appeal-same'), { wrong: () => true }).run.appeal;
    expect(a?.case.id).toBe(b?.case.id);
    // The last day's mistakes have no morning to be heard in.
    const last = appealing(demo, { from: 1 });
    const end = { ...newRun(last, 'appeal-last'), day: campaignOf(last).lastDay };
    const { afterShift } = playDay(last, end, { wrong: () => true });
    expect(afterShift.appeal).toBeUndefined();
    // Nor does a build without appeals bring any.
    const none = { ...demo, campaign: { ...campaignOf(demo), appeals: undefined } };
    expect(playDay(none, newRun(none, 'appeal-none'), { wrong: () => true }).run.appeal).toBeUndefined();
    // Story souls never appeal: on the slice's Day 12, Loki's story soul is judged wrong, yet no appeal is his.
    const slice = appealing(full, { from: 1 });
    const late = newRun(slice, 'appeal-story', { slice: 'fromJump' });
    const played = playDay(slice, late, { wrong: () => true });
    expect(played.run.appeal?.case.script).toBeUndefined();
  });

  it('replays the same from a save', () => {
    const content = appealing(demo);
    const { run } = playDay(content, newRun(content, 'appeal-save'), { wrong: () => true });
    let save = startSave(content, 'appeal-save', 1);
    let at = save.mornings[0] as RunState;
    const actions: RunAction[] = [
      ...shiftActions(at, content, { wrong: () => true }),
      { t: 'endAudit' },
      { t: 'endNight' },
      { t: 'appeal', stamped: run.appeal?.case.expect.dest ?? 'HEL' },
    ];
    for (const action of actions) {
      const next = stepRun(at, action, { content, ctx: runContext(content, at) }).state;
      save = recordAction(save, at, action, next);
      at = next;
    }
    expect(at.appealHeard?.outcome).toBe('righted');
    expect(resumeSave(save, content, 1).run).toEqual(at);
  });
});

describe('the line at dusk', () => {
  /** A day where the sun sets on the line: the first `judged` souls judged right, the rest left waiting. */
  function leaveAtDusk(content: Content, run: RunState, judged: number) {
    const ctx = runContext(content, run);
    const started = stepRun(run, { t: 'beginShift', at: 0 }, { content, ctx }).state;
    const cases = started.shift?.cases ?? [];
    const actions: RunAction[] = [{ t: 'beginShift', at: 0 }];
    cases.slice(0, judged).forEach((c, i) => {
      const at = (i + 1) * 1000;
      for (const id of c.expect.procedures ?? []) {
        const tool = ctx.procedures.find((p) => p.id === id)?.tool;
        if (tool) actions.push({ t: 'shift', action: { t: 'tool', tool, at } });
      }
      actions.push(
        { t: 'shift', action: { t: 'stamp', dest: c.expect.dest, at } },
        { t: 'shift', action: { t: 'send', at } },
      );
    });
    actions.push({ t: 'shift', action: { t: 'tick', at: (started.shift?.sunMs ?? 0) + sunCosts(demo).duskGrace + 1 } });
    const shift = drive(content, run, actions);
    const end = drive(content, shift.run, [{ t: 'endAudit' }, { t: 'endNight' }]);
    return { afterShift: shift.run, run: end.run, cases };
  }
  const envOf = (content: Content, run: RunState): RunEnv => ({ content, ctx: runContext(content, run) });
  const withWaiting = (content: Content, waiting: Partial<NonNullable<CampaignDef['waiting']>> | null): Content => {
    const { waiting: _, ...campaign } = campaignOf(content);
    return {
      ...content,
      campaign: waiting
        ? { ...campaign, waiting: { from: 1, crowd: 3, night: { hel: -1 }, died: { odin: -1 }, ...waiting } }
        : campaign,
    };
  };

  it('keeps the souls left at dusk for the next day: first after its teaching soul, judged by its rules, in the places of its last new souls', () => {
    const { afterShift, run, cases } = leaveAtDusk(demo, newRun(demo, 'line-1'), 2);
    const ledger = afterShift.ledger.at(-1);
    const left = cases.slice(2);
    expect(ledger?.unjudged).toBe(left.length);
    expect(ledger?.waiting?.carried.map((s) => s.id)).toEqual(left.map((c) => c.id));
    expect(ledger?.waiting?.died).toEqual([]);
    // A crowded gate (three or more left) costs Hel once, however many more there are.
    expect(left.length).toBeGreaterThanOrEqual(3);
    expect(ledger?.waiting?.standing).toEqual({ hel: -1 });
    expect(afterShift.standing.hel).toBe(-1);

    expect(run.day).toBe(2);
    const waiting = run.waiting ?? [];
    expect(waiting.map((c) => c.id)).toEqual(left.map((c) => c.id));
    const env = envOf(demo, run);
    for (const c of waiting) {
      // Seen afresh under Day 2's rules: judged by them, and meeting the contract under them.
      expect(c.day).toBe(1);
      expect(c.expect).toEqual(judge(c.truth, env.ctx));
      const knobs = tierKnobs('widenBand', env.ctx.spec.queue.knobs);
      expect(validateCase(c.evidence, c.truth, c.lies, c.expect, c.meta.decisive, env.ctx, knobs).ok).toBe(true);
    }
    const queue = campaignQueue(run, env);
    const plain = campaignQueue({ ...run, waiting: undefined }, env);
    expect(queue).toHaveLength(plain.length);
    expect(queue[0]?.archetype).toBe(env.ctx.spec.queue.teachFirst);
    expect(queue.slice(1, 1 + waiting.length).map((c) => c.id)).toEqual(waiting.map((c) => c.id));
    const names = queue.map((c) => c.evidence.look.name);
    expect(new Set(names).size).toBe(names.length);

    // Once the gate opens they're in the day's line, and no longer waiting.
    const opened = stepRun(run, { t: 'beginShift', at: 0 }, env).state;
    expect(opened.waiting).toBeUndefined();
    expect(opened.shift?.cases.slice(1, 1 + waiting.length).map((c) => c.id)).toEqual(waiting.map((c) => c.id));
  });

  it('loses the living left at dusk in the night: they never wait, and each costs its own standing', () => {
    let run = newRun(full, 'line-living');
    for (let d = 1; d < 3; d++) run = playDay(full, run).run;
    // Day 3 teaches the feather with a soul who isn't dead yet; nobody is judged before dusk.
    const { afterShift, run: next, cases } = leaveAtDusk(full, run, 0);
    const living = cases.filter((c) => c.expect.dest === 'RETURN' && !c.script);
    expect(living.length).toBeGreaterThan(0);
    const ledger = afterShift.ledger.at(-1);
    expect(ledger?.waiting?.died.map((s) => s.id)).toEqual(living.map((c) => c.id));
    const died = living.length;
    expect(ledger?.waiting?.standing).toEqual({ hel: -1, odin: -died });
    // No hall takes them: letting the living die doesn't feed Hel's legion.
    expect(afterShift.sent?.HEL ?? 0).toBe(run.sent?.HEL ?? 0);
    const waitingIds = (next.waiting ?? []).map((c) => c.id);
    for (const c of living) expect(waitingIds).not.toContain(c.id);
    // Story souls' stories go on without them: Thorvald doesn't wait either.
    const story = cases.filter((c) => c.script !== undefined);
    expect(story.length).toBeGreaterThan(0);
    for (const c of story) expect(waitingIds).not.toContain(c.id);
    expect(waitingIds).toHaveLength(cases.length - living.length - story.length);
  });

  it('costs nothing for a soul or two left waiting: only a crowded gate troubles Hel', () => {
    const { afterShift, cases } = leaveAtDusk(demo, newRun(demo, 'line-few'), 4);
    const ledger = afterShift.ledger.at(-1);
    expect(ledger?.waiting?.carried).toHaveLength(cases.length - 4);
    expect(cases.length - 4).toBeLessThan(3);
    expect(ledger?.waiting?.standing).toEqual({});
    expect(afterShift.standing.hel).toBe(0);
  });

  it('keeps no line without the setting, before its first day, after the last day, or when every soul is judged', () => {
    const none = leaveAtDusk(withWaiting(demo, null), newRun(demo, 'line-none'), 2);
    expect(none.afterShift.ledger.at(-1)?.waiting).toBeUndefined();
    expect(none.run.waiting).toBeUndefined();
    const late = leaveAtDusk(withWaiting(demo, { from: 2 }), newRun(demo, 'line-late'), 2);
    expect(late.run.waiting).toBeUndefined();
    expect(late.afterShift.standing.hel).toBe(0);
    const judged = playDay(demo, newRun(demo, 'line-all'));
    expect(judged.afterShift.ledger.at(-1)?.waiting).toBeUndefined();
    // The demo's last day has no next day for them.
    let run = newRun(demo, 'line-last');
    for (let d = 1; d < 3; d++) run = playDay(demo, run).run;
    const last = leaveAtDusk(demo, run, 1);
    expect(last.afterShift.ledger.at(-1)?.waiting).toBeUndefined();
    expect(last.afterShift.waiting).toBeUndefined();
  });

  it('brings the same souls to the same places from a saved morning, and its accounts add up', () => {
    const { run } = leaveAtDusk(demo, newRun(demo, 'line-save'), 1);
    const env = envOf(demo, run);
    const saved: RunState = JSON.parse(JSON.stringify(run));
    expect(campaignQueue(saved, env)).toEqual(campaignQueue(run, env));
    // Standing now is every audit's columns added up: mistakes, story, the appeal and the line.
    const next = playDay(demo, run).afterShift;
    for (const f of ['odin', 'freyja', 'hel', 'loki', 'clerk'] as const) {
      const sum = next.ledger.reduce(
        (n, l) =>
          n +
          (l.standing[f] ?? 0) +
          (l.story?.[f] ?? 0) +
          (l.appeal?.standing[f] ?? 0) +
          (l.waiting?.standing[f] ?? 0) +
          (l.vow?.standing[f] ?? 0) +
          (l.requests ?? []).reduce((m, q) => m + (q.standing[f] ?? 0), 0),
        0,
      );
      expect(next.standing[f], f).toBe(sum);
    }
  });
});

describe('the gods’ requests', () => {
  /** The morning of `day`, every earlier soul judged rightly. */
  function morningOf(content: Content, seed: string, day: number): RunState {
    let run = newRun(content, seed);
    while (run.day < day) run = playDay(content, run).run;
    return run;
  }
  /** A day where each soul goes where `send` says (its right place when it says nothing). */
  function serveDay(content: Content, run: RunState, send: (c: CaseSpec, i: number) => Destination | undefined) {
    const ctx = runContext(content, run);
    const started = stepRun(run, { t: 'beginShift', at: 0 }, { content, ctx }).state;
    const actions: RunAction[] = [{ t: 'beginShift', at: 0 }];
    (started.shift?.cases ?? []).forEach((c, i) => {
      const at = (i + 1) * 1000;
      const dest = send(c, i) ?? c.expect.dest;
      for (const id of dest === c.expect.dest ? (c.expect.procedures ?? []) : []) {
        const tool = ctx.procedures.find((p) => p.id === id)?.tool;
        if (tool) actions.push({ t: 'shift', action: { t: 'tool', tool, at } });
      }
      actions.push({ t: 'shift', action: { t: 'stamp', dest, at } }, { t: 'shift', action: { t: 'send', at } });
    });
    return drive(content, run, actions).run;
  }
  /** Each of the first `n` souls who belong in `from` goes to `to` instead. */
  const favour = (from: Destination, to: Destination, n: number) => {
    let sent = 0;
    return (c: CaseSpec) => (c.expect.dest === from && sent++ < n ? to : undefined);
  };
  /** The first seeds whose morning of `day` brings a request that passes `ok`. */
  function asked(day: number, ok: (r: RunState) => boolean = () => true, tries = 12): RunState {
    for (let i = 0; i < tries; i++) {
      const run = morningOf(full, `ask-${day}-${i}`, day);
      if ((run.requests?.length ?? 0) > 0 && ok(run)) return run;
    }
    throw new Error(`no request on day ${day} in ${tries} seeds`);
  }

  it('comes from its first day on, when the day’s line holds the souls asked for', () => {
    const def = campaignOf(full).requests;
    expect(def).toBeDefined();
    if (!def) return;
    // None before the first day a god may ask.
    for (let i = 0; i < 4; i++) expect(morningOf(full, `ask-early-${i}`, def.from - 1).requests).toBeUndefined();
    let seen = 0;
    for (let i = 0; i < 8; i++) {
      const run = morningOf(full, `ask-${i}`, 5);
      for (const r of run.requests ?? []) {
        seen++;
        const line = campaignQueue(run, { content: full, ctx: runContext(full, run) });
        expect(line.filter((c) => c.expect.dest === r.from).length, r.id).toBeGreaterThanOrEqual(r.n);
        expect(r.god).not.toBe(undefined);
      }
      // A second request is a rival for the same souls.
      const [a, b] = run.requests ?? [];
      if (a && b) {
        expect(b.from).toBe(a.from);
        expect(b.god).not.toBe(a.god);
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('pays its reward when done in full, on top of what each soul sent wrong moves', () => {
    const run = asked(5);
    const [r] = run.requests ?? [];
    if (!r) return;
    const after = serveDay(full, run, favour(r.from, r.to, r.n));
    const ledger = after.ledger.at(-1);
    const settled = ledger?.requests?.find((x) => x.id === r.id);
    expect(settled).toMatchObject({ god: r.god, n: r.n, done: r.n, met: true, standing: r.reward });
    // Each soul sent as asked is still a mistake: no wage, and the standing rows move as they always do.
    expect(ledger?.wrong).toBeGreaterThanOrEqual(r.n);
    // But it's the god's: it doesn't break and run at Ragnarök (docs/tech-spec.md §54).
    expect(after.misfits?.[r.to] ?? 0).toBe(run.misfits?.[r.to] ?? 0);
    for (const [f, n] of Object.entries(r.reward)) {
      const faction = f as keyof typeof after.standing;
      const rows = ledger?.standing[faction] ?? 0;
      expect(after.standing[faction] - run.standing[faction], f).toBe(
        rows + (n ?? 0) + (ledger?.story?.[faction] ?? 0),
      );
    }
  });

  it('pays nothing extra when done in part, and nothing at all when declined', () => {
    const run = asked(5, (x) => (x.requests?.[0]?.n ?? 0) >= 2);
    const [r] = run.requests ?? [];
    if (!r) return;
    const partRun = serveDay(full, run, favour(r.from, r.to, r.n - 1));
    const part = partRun.ledger.at(-1)?.requests?.[0];
    expect(part).toMatchObject({ done: r.n - 1, met: false, standing: {} });
    // Nobody got what they asked for: those souls stand in the wrong hall's host, like any mistake.
    expect(partRun.misfits?.[r.to] ?? 0).toBe((run.misfits?.[r.to] ?? 0) + r.n - 1);
    const declined = serveDay(full, run, () => undefined);
    expect(declined.ledger.at(-1)?.requests?.[0]).toMatchObject({ done: 0, met: false, standing: {} });
    expect(declined.ledger.at(-1)?.wrong).toBe(0);
  });

  it('keeps a soul given to a god from appealing when the request was done in full, since its reward stays paid', () => {
    let partAppeals = 0;
    for (let i = 0; i < 8; i++) {
      const run = morningOf(full, `ask-appeal-${i}`, 5);
      const [r] = run.requests ?? [];
      if (!r) continue;
      // The day's only mistakes are the favour's, so any appeal is a soul judged rightly, trying its luck.
      const done = serveDay(full, run, favour(r.from, r.to, r.n));
      expect(done.ledger.at(-1)?.requests?.[0]?.met).toBe(true);
      if (done.appeal) expect(done.appeal.stamped, run.seed).toBe(done.appeal.case.expect.dest);
      // Done in part, there's no reward to keep: those souls may appeal like any other mistake.
      if (r.n >= 2) {
        const part = serveDay(full, run, favour(r.from, r.to, r.n - 1));
        if (part.appeal && part.appeal.stamped !== part.appeal.case.expect.dest) partAppeals++;
      }
    }
    expect(partAppeals).toBeGreaterThan(0);
  });

  it('comes with the same requests from a saved morning, and never without the setting or after the last day', () => {
    const run = asked(6);
    const env = { content: full, ctx: runContext(full, run) };
    // The audit that brought them, replayed, brings them again.
    const before = morningOf(full, run.seed, 5);
    const again = serveDay(full, before, () => undefined);
    expect(again.requests).toEqual(run.requests);
    expect(JSON.parse(JSON.stringify(run)).requests).toEqual(run.requests);
    expect(campaignQueue(run, env).length).toBeGreaterThan(0);
    const { requests: _, ...plain } = campaignOf(full);
    const none: Content = { ...full, campaign: plain };
    expect(serveDay(none, morningOf(none, run.seed, 5), () => undefined).requests).toBeUndefined();
    // The demo's last day has no next morning to ask for.
    const demoLast = morningOf(demo, 'ask-demo', 3);
    expect(serveDay(demo, demoLast, () => undefined).requests).toBeUndefined();
  });
});

describe('the gods’ favour (docs/tech-spec.md §43)', () => {
  const favour = (id: string) => {
    const f = campaignOf(full).favours?.find((x) => x.id === id);
    if (!f) throw new Error(`no favour ${id}`);
    return f;
  };
  /** The morning of Day 5, every earlier soul judged rightly, with standing set as given. */
  const courted = (standing: Partial<RunState['standing']>): RunState => {
    let run = newRun(full, 'favour');
    while (run.day < 5) run = playDay(full, run).run;
    return { ...run, standing: { ...run.standing, ...standing } };
  };

  it('is granted at the gate while a god’s standing is at its mark, and not below it', () => {
    const odin = favour('fav.odin');
    const at = courted({ odin: odin.at });
    const below = courted({ odin: odin.at - 1 });
    expect(favoursFor(at, full).map((f) => f.id)).toContain('fav.odin');
    expect(favoursFor(below, full).map((f) => f.id)).not.toContain('fav.odin');
    // Odin's is sun: the day's shift is longer by it, and its audit files the favour.
    const sunMs = (r: RunState) => drive(full, r, [{ t: 'beginShift', at: 0 }]).run.shift?.sunMs ?? 0;
    expect(sunMs(at) - sunMs(below)).toBe(('sunS' in odin.effect ? odin.effect.sunS : 0) * 1000);
    expect(shiftMods(at, full).sunS).toBe((shiftMods(below, full).sunS ?? 0) + 60);
    expect(playDay(full, at).afterShift.ledger.at(-1)?.favours).toContain('fav.odin');
    expect(playDay(full, below).afterShift.ledger.at(-1)?.favours ?? []).not.toContain('fav.odin');
  });

  it('halves each of the day’s fines with the clerk’s, rounding down', () => {
    const clerk = favour('fav.clerk');
    const pct = 'finePct' in clerk.effect ? clerk.effect.finePct : 100;
    const everyone = () => true;
    const plain = playDay(full, courted({}), { wrong: everyone }).afterShift.ledger.at(-1);
    const eased = playDay(full, courted({ clerk: clerk.at }), { wrong: everyone }).afterShift.ledger.at(-1);
    const economy = runContext(full, courted({})).spec.economy;
    if (!plain || !eased || !economy) throw new Error('no audit');
    const fines = Array.from({ length: plain.wrong - economy.warnings }, (_, k) => {
      return economy.fines[Math.min(k, economy.fines.length - 1)] ?? 0;
    });
    expect(plain.fines).toBe(fines.reduce((a, b) => a + b, 0));
    expect(eased.fines).toBe(fines.reduce((a, b) => a + Math.floor((b * pct) / 100), 0));
    expect(eased.fines).toBeLessThan(plain.fines);
  });

  it('keeps the sick a night longer with Hel’s, granted at the gate for the night even if the audit then costs her favour', () => {
    const hel = favour('fav.hel');
    const care = campaignOf(full).care;
    // Someone at home sick, a night from being lost without medicine.
    const sick = (r: RunState): RunState => ({
      ...r,
      family: r.family.map((m, i) => (i === 0 ? { ...m, status: 'sick', sickNights: care.sickNights - 1 } : m)),
    });
    // Each soul who belongs to Hel sent elsewhere: her standing falls at the audit.
    const helsOwn = (run: RunState) => {
      const queue = campaignQueue(run, { content: full, ctx: runContext(full, run) });
      return (i: number) => queue[i]?.expect.dest === 'HEL';
    };
    const favoured = sick(courted({ hel: hel.at }));
    const plain = sick(courted({}));
    const day = playDay(full, favoured, { wrong: helsOwn(favoured), bills: { medicine: [] } });
    expect(day.afterShift.standing.hel).toBeLessThan(hel.at);
    expect(day.afterShift.ledger.at(-1)?.favours).toContain('fav.hel');
    // The night screen reckons with it, and so does the night.
    expect(careFor(day.afterShift, full).sickNights).toBe(care.sickNights + 1);
    expect(
      nightOutlook(
        day.afterShift,
        { content: full, ctx: runContext(full, day.afterShift) },
        { ...defaultBills(day.afterShift), medicine: [] },
      ).members[0]?.change,
    ).toBeUndefined();
    expect(day.run.family[0]?.status).toBe('sick');
    const without = playDay(full, plain, { wrong: helsOwn(plain), bills: { medicine: [] } });
    expect(careFor(without.afterShift, full).sickNights).toBe(care.sickNights);
    expect(without.run.family[0]?.status).toBe('gone');
  });

  it('spares the well any chance of falling sick with Hel’s, though nights without a bill paid still make them sick', () => {
    const hel = favour('fav.hel');
    const care = campaignOf(full).care;
    const outlook = (r: RunState, bills: Partial<ReturnType<typeof defaultBills>>) =>
      nightOutlook(r, { content: full, ctx: runContext(full, r) }, { ...defaultBills(r), ...bills });
    const favoured = courted({ hel: hel.at });
    const plain = courted({ hel: hel.at - 1 });
    // One cold night: a chance of falling sick without her favour, none with it.
    expect(careFor(favoured, full).sickChance).toBe(0);
    expect(Math.max(...outlook(plain, { hearth: false }).members.map((n) => n.risk))).toBe(care.sickChance);
    expect(outlook(favoured, { hearth: false }).members.map((n) => n.risk)).toEqual(favoured.family.map(() => 0));
    // A second cold night makes them sick all the same.
    const chilled = { ...favoured, family: favoured.family.map((m) => ({ ...m, cold: care.needNights - 1 })) };
    expect(outlook(chilled, { hearth: false }).members.map((n) => n.change)).toEqual(chilled.family.map(() => 'sick'));
    // And the night itself agrees: over many seeds, no one falls sick by chance with her favour.
    for (let i = 0; i < 12; i++) {
      const run = { ...favoured, seed: `chance${i}` };
      const night = playDay(full, run, { bills: { hearth: false } }).run;
      expect(night.family.every((m) => m.status === 'well')).toBe(true);
    }
  });

  it('adds up a god’s favours: at the second mark, a second minute, question and night, and the fines waived', () => {
    const second = (god: Faction) => {
      const fs = (campaignOf(full).favours ?? []).filter((f) => f.faction === god).map((f) => f.at);
      return Math.max(...fs);
    };
    const first = courted({ odin: favour('fav.odin').at, freyja: favour('fav.freyja').at });
    const both = courted({ odin: second('odin'), freyja: second('freyja'), hel: second('hel') });
    expect(favoursFor(both, full).map((f) => f.id)).toEqual(
      expect.arrayContaining(['fav.odin', 'fav.odin.more', 'fav.freyja', 'fav.freyja.more', 'fav.hel', 'fav.hel.more']),
    );
    expect((shiftMods(both, full).sunS ?? 0) - (shiftMods(first, full).sunS ?? 0)).toBe(60);
    expect(shiftMods(first, full).freeQuestions).toBe(1);
    expect(shiftMods(both, full).freeQuestions).toBe(2);
    expect(careFor(both, full).sickNights).toBe(campaignOf(full).care.sickNights + 2);
    // The clerk's second waives what his first halves; the audit files the rings spared.
    const audit = (standing: Partial<RunState['standing']>) =>
      playDay(full, courted(standing), { wrong: () => true }).afterShift.ledger.at(-1);
    const halved = audit({ clerk: favour('fav.clerk').at });
    const waived = audit({ clerk: second('clerk') });
    const plain = audit({});
    if (!halved || !waived || !plain) throw new Error('no audit');
    expect(plain.fines).toBeGreaterThan(0);
    expect(plain.eased).toBeUndefined();
    expect((halved.eased ?? 0) + halved.fines).toBe(plain.fines);
    expect(waived.fines).toBe(0);
    expect(waived.eased).toBe(plain.fines);
  });

  it('pays a ring a nail with Loki’s, for each soul sent on with its nails long, and the day adds up (§57)', () => {
    const loki = favour('fav.loki');
    const more = favour('fav.loki.more');
    const ring = 'nailRings' in loki.effect ? loki.effect.nailRings : 0;
    // A day of the ship's decree, every soul stamped rightly and every long nail left uncut.
    let run = newRun(full, 'nails');
    while (run.day < 9) run = playDay(full, run).run;
    const day = (standing: number, uncut = true) => {
      const morning = { ...run, standing: { ...run.standing, loki: standing } };
      const after = playDay(full, morning, { uncut }).afterShift;
      const l = after.ledger.at(-1);
      if (!l) throw new Error('no audit');
      // The purse comes to the day's accounts, the nails included.
      expect(after.rings - morning.rings).toBe(l.pay + l.bonus - l.fines + (l.nails ?? 0));
      return l;
    };
    const below = day(loki.at - 1);
    const paid = day(loki.at);
    const twice = day(more.at);
    const long = (below.mistakes ?? []).filter((m) => (m.skipped?.length ?? 0) > 0).length;
    expect(long).toBeGreaterThan(0);
    expect(below.nails).toBeUndefined();
    expect(paid.favours).toContain('fav.loki');
    expect(paid.nails).toBe(ring * long);
    expect(twice.nails).toBe(2 * ring * long);
    // Each is still a mistake, as it was without the favour; a day with every nail cut pays nothing.
    expect(paid.wrong).toBe(below.wrong);
    expect(day(more.at, false).nails).toBeUndefined();
  });
});

describe('a noon decree (docs/tech-spec.md §45)', () => {
  // Day 19's redraws Freyja's whim; Day 18's, Odin's claim (§59). What holds for any decree is checked on each day that
  // has one, and the rest on Day 19's.
  const decrees = full.days.filter((d) => d.noon !== undefined);
  const spec = decrees.find((d) => d.noon?.redraw.includes('freyjaWhim'));
  const noonDay = spec?.day ?? 0;
  /** The morning of a decree's day in a fresh run: its queue depends only on the seed and the day. */
  const morningOf = (seed: string): RunState => ({ ...newRun(full, seed), day: noonDay });
  const knobs = (ctx: DayCtx) => tierKnobs('widenBand', ctx.spec.queue.knobs);

  it('is on Days 18 and 19', () => expect(decrees.map((d) => d.day)).toEqual([18, 19]));

  for (const decree of decrees) {
    const { day: noonDay } = decree;
    const spec = decree;
    const morningOf = (seed: string): RunState => ({ ...newRun(full, seed), day: noonDay });

    it(`draws its params again for the souls after noon, never to the same choice, and the same way every time (Day ${noonDay})`, () => {
      expect(spec?.noon?.redraw.length).toBeGreaterThan(0);
      for (let i = 0; i < 12; i++) {
        const ctx = createDayContext(full, noonDay, `noon${i}`);
        const noon = ctx.noon;
        if (!noon || !spec?.noon) throw new Error('no noon decree');
        for (const [name, choice] of Object.entries(ctx.paramChoices)) {
          const after = noon.ctx.paramChoices[name]?.id;
          if (spec.noon.redraw.includes(name)) expect(after).not.toBe(choice.id);
          else expect(after).toBe(choice.id);
        }
        expect(noon.ctx.noon).toBeUndefined();
        expect(createDayContext(full, noonDay, `noon${i}`).noon?.ctx.paramChoices).toEqual(noon.ctx.paramChoices);
      }
      // Only days that have one, and never the Daily.
      for (const d of full.days)
        expect(createDayContext(full, d.day, 'x').noon === undefined).toBe(d.noon === undefined);
      if (full.daily) expect(createDayContext(full, full.daily.day, 'x', full.daily).noon).toBeUndefined();
    });

    it(`makes and judges each soul by the rules in force when it comes to the desk: the decree’s, after noon (Day ${noonDay})`, () => {
      let changed = 0;
      for (let i = 0; i < 8; i++) {
        const run = morningOf(`noon${i}`);
        const ctx = runContext(full, run);
        const noon = ctx.noon;
        if (!noon) throw new Error('no noon decree');
        const queue = campaignQueue(run, { content: full, ctx });
        const first = queue.findIndex((c) => c.noon);
        // Every soul after the first under the decree is under it too, and the raven comes after a soul at least.
        expect(first).toBeGreaterThan(noon.notice);
        expect(queue.slice(first).every((c) => c.noon)).toBe(true);
        expect(queue.slice(0, first).some((c) => c.noon)).toBe(false);
        // Each soul meets the contract under the rules it's judged by (a party's with its companions, §69).
        queue.forEach((c, i) => {
          const cx = soulCtx(ctx, c);
          expect(c.expect).toEqual(judge(c.truth, cx));
          const companions = companionsAt(queue, i, ctx);
          // A sworn man's jarl's hall, from the jarl's own evidence (§70).
          const given = givenAt(queue, i, ctx);
          expect(
            validateCase(c.evidence, c.truth, c.lies, c.expect, c.meta.decisive, cx, knobs(cx), companions, given).ok,
          ).toBe(true);
          if (c.noon && judge(c.truth, ctx).dest !== c.expect.dest) changed++;
        });
        // The decree's first soul is made to show the change.
        expect(queue.find((c) => c.noon && c.procIndex === noon.at)?.archetype).toBe(spec?.noon?.teach);
      }
      // Most days it sends a soul somewhere the morning's rules wouldn't have.
      expect(changed).toBeGreaterThanOrEqual(6);
    });
  }

  it('cites a soul after noon stamped by the morning’s rules', () => {
    // A day whose decree's first soul would have gone elsewhere under the morning's rules.
    const found = Array.from({ length: 12 }, (_, i) => morningOf(`noon${i}`)).flatMap((run) => {
      const ctx = runContext(full, run);
      const queue = campaignQueue(run, { content: full, ctx });
      const k = queue.findIndex((c) => c.noon && judge(c.truth, ctx).dest !== c.expect.dest);
      return k >= 0 ? [{ run, ctx, queue, k }] : [];
    })[0];
    if (!found) throw new Error('no day where the decree changes a soul');
    const { run, ctx, queue, k } = found;
    const actions: RunAction[] = [{ t: 'beginShift', at: 0 }];
    queue.forEach((c, i) => {
      const at = (i + 1) * 1000;
      const dest = i === k ? judge(c.truth, ctx).dest : c.expect.dest;
      for (const id of i === k ? [] : (c.expect.procedures ?? [])) {
        const tool = ctx.procedures.find((p) => p.id === id)?.tool;
        if (tool) actions.push({ t: 'shift', action: { t: 'tool', tool, at } });
      }
      actions.push({ t: 'shift', action: { t: 'stamp', dest, at } }, { t: 'shift', action: { t: 'send', at } });
    });
    // At the desk, the rule tracker reads the soul by the decree: the rule that decides it is never ruled out.
    const soul = queue[k];
    if (!soul) throw new Error('no soul');
    const before = actions.findIndex(
      (a) => a.t === 'shift' && a.action.t === 'stamp' && a.action.at === (k + 1) * 1000,
    );
    const look: RunAction = {
      t: 'shift',
      action: { t: 'inspect', fields: soul.evidence.fields.map((f) => f.id), at: (k + 1) * 1000 },
    };
    const desk = drive(full, run, [...actions.slice(0, before), look]).run.shift;
    if (!desk) throw new Error('no shift');
    expect(ruledOut(desk, ctx)).not.toContain(soul.expect.rule);
    expect(ruledOut(desk, { ...ctx, noon: undefined })).toContain(soul.expect.rule);
    const day = drive(full, run, actions);
    const ledger = day.run.ledger.at(-1);
    expect(ledger?.wrong).toBe(1);
    expect(ledger?.mistakes).toEqual([
      expect.objectContaining({
        expected: queue[k]?.expect.dest,
        stamped: judge(queue[k]?.truth ?? {}, ctx).dest,
        noon: true,
      }),
    ]);
  });

  it('is over for souls left at dusk, who are seen afresh under the next day’s rules', () => {
    const run = morningOf('noon-dusk');
    const ctx = runContext(full, run);
    const queue = campaignQueue(run, { content: full, ctx });
    const first = queue.findIndex((c) => c.noon);
    const actions: RunAction[] = [{ t: 'beginShift', at: 0 }];
    queue.slice(0, first).forEach((c, i) => {
      const at = (i + 1) * 1000;
      for (const id of c.expect.procedures ?? []) {
        const tool = ctx.procedures.find((p) => p.id === id)?.tool;
        if (tool) actions.push({ t: 'shift', action: { t: 'tool', tool, at } });
      }
      actions.push(
        { t: 'shift', action: { t: 'stamp', dest: c.expect.dest, at } },
        { t: 'shift', action: { t: 'send', at } },
      );
    });
    const begun = stepRun(run, { t: 'beginShift', at: 0 }, { content: full, ctx }).state;
    actions.push({ t: 'shift', action: { t: 'tick', at: (begun.shift?.sunMs ?? 0) + sunCosts(demo).duskGrace + 1 } });
    const shift = drive(full, run, actions);
    const next = drive(full, shift.run, [{ t: 'endAudit' }, { t: 'endNight' }]).run;
    const waiting = next.waiting ?? [];
    expect(waiting.length).toBeGreaterThan(0);
    const tomorrow = runContext(full, next);
    for (const c of waiting) {
      expect(c.noon).toBeUndefined();
      expect(c.expect).toEqual(judge(c.truth, tomorrow));
    }
  });
});

describe('someone at the desk (docs/tech-spec.md §46)', () => {
  const spec = full.days.find((d) => (d.queue.visits ?? []).length > 0);
  const visit = spec?.queue.visits?.[0];
  if (!spec || !visit) throw new Error('no one comes to the desk in this build');
  /** Whether a party (docs/tech-spec.md §69) stands over the visit's place in the seed's line: its turn comes after. */
  const straddled = (seed: string) => {
    const base = { ...newRun(full, seed), day: spec.day };
    const queue = campaignQueue(base, { content: full, ctx: runContext(full, base) });
    const span = partyOf(queue, visit.at);
    return span !== null && span.start < visit.at;
  };
  const seeds = ['desk', ...Array.from({ length: 40 }, (_, i) => `desk-${i}`)];
  const plainSeed = seeds.find((x) => !straddled(x)) ?? 'desk';
  /** The visit's day, its shift begun and `sent` souls judged rightly. */
  const at = (sent: number, base: RunState = { ...newRun(full, plainSeed), day: spec.day }) => {
    const ctx = runContext(full, base);
    const queue = campaignQueue(base, { content: full, ctx });
    const actions: RunAction[] = [{ t: 'beginShift', at: 0 }];
    queue.slice(0, sent).forEach((c, i) => {
      const t = (i + 1) * 1000;
      for (const id of c.expect.procedures ?? []) {
        const tool = ctx.procedures.find((p) => p.id === id)?.tool;
        if (tool) actions.push({ t: 'shift', action: { t: 'tool', tool, at: t } });
      }
      actions.push({ t: 'shift', action: { t: 'stamp', dest: c.expect.dest, at: t } });
      actions.push({ t: 'shift', action: { t: 'send', at: t } });
    });
    return { ...drive(full, base, actions), queue };
  };

  it('comes when its turn does, once, and only while its condition holds', () => {
    expect(deskVisit({ ...newRun(full, plainSeed), day: spec.day }, full)).toBeNull();
    expect(deskVisit(at(visit.at - 1).run, full)).toBeNull();
    const due = at(visit.at);
    expect(deskVisit(due.run, full)).toEqual(visit);
    const seen = stepRun(due.run, { t: 'scene', id: visit.scene, effects: [] }, { content: full, ctx: due.ctx }).state;
    expect(deskVisit(seen, full)).toBeNull();
    // A visit that asks for something the run hasn't got doesn't come.
    const picky: Content = {
      ...full,
      days: full.days.map((d) =>
        d === spec
          ? { ...d, queue: { ...d.queue, visits: [{ ...visit, when: { state: 'flags.never', gte: 1 } }] } }
          : d,
      ),
    };
    expect(deskVisit(due.run, picky)).toBeNull();
    expect(deskVisit({ ...due.run, flags: { ...due.run.flags, never: 1 } }, picky)).not.toBeNull();
  });

  it('comes after a party that stands over its place, whose members go together (docs/tech-spec.md §69)', () => {
    const seed = seeds.find(straddled);
    if (!seed) throw new Error('no party over the visit in 40 seeds');
    const base = { ...newRun(full, seed), day: spec.day };
    const queue = campaignQueue(base, { content: full, ctx: runContext(full, base) });
    const span = partyOf(queue, visit.at);
    if (!span) throw new Error('no party');
    // Its members sent on one by one: nobody goes, and nobody comes, until the last of them is stamped.
    const before = at(span.start + span.size - 1, base);
    expect(before.run.shift?.verdicts.length).toBe(span.start);
    expect(deskVisit(before.run, full)).toBeNull();
    const after = at(span.start + span.size, base);
    expect(after.run.shift?.verdicts.length).toBe(span.start + span.size);
    expect(deskVisit(after.run, full)).toEqual(visit);
  });

  it('keeps what the visit does for the audit: standing and the day’s favours stay as the gate set them', () => {
    const odin = campaignOf(full).favours?.find((f) => f.id === 'fav.odin');
    if (!odin) throw new Error('no favour of Odin’s');
    // Odin one short of his favour's mark at the gate; the visit would take him past it.
    const base = { ...newRun(full, 'desk'), day: spec.day };
    const gate = { ...base, standing: { ...base.standing, odin: odin.at - 1 } };
    const due = at(visit.at, gate);
    const effects: Effect[] = [
      { standing: 'odin', by: 3 },
      { flag: 'told_odin', set: 1 },
    ];
    const seen = stepRun(
      due.run,
      { t: 'scene', id: visit.scene, choices: [0], effects },
      { content: full, ctx: due.ctx },
    );
    expect(seen.state.standing.odin).toBe(odin.at - 1);
    expect(seen.state.flags.told_odin).toBeUndefined();
    expect(seen.state.pending).toEqual(effects);
    expect(seen.state.scenes).toContain(visit.scene);
    // The rest of the day judged rightly: the audit brings the visit's effects in as the story's.
    const rest: RunAction[] = due.queue.slice(visit.at).flatMap((c, i) => {
      const t = (visit.at + i + 1) * 1000;
      const tools = (c.expect.procedures ?? []).flatMap((id) => {
        const tool = due.ctx.procedures.find((p) => p.id === id)?.tool;
        return tool ? [{ t: 'shift' as const, action: { t: 'tool' as const, tool, at: t } }] : [];
      });
      return [
        ...tools,
        { t: 'shift', action: { t: 'stamp', dest: c.expect.dest, at: t } },
        { t: 'shift', action: { t: 'send', at: t } },
      ];
    });
    const audited = drive(full, seen.state, rest).run;
    const ledger = audited.ledger.at(-1);
    expect(audited.phase).toBe('audit');
    expect(audited.pending).toBeUndefined();
    expect(audited.standing.odin).toBe(odin.at - 1 + 3);
    expect(audited.flags.told_odin).toBe(1);
    expect(ledger?.story?.odin).toBe(3);
    expect(ledger?.favours ?? []).not.toContain('fav.odin');
    // A scene outside the shift still acts at once.
    const night = stepRun(
      { ...audited, phase: 'night' },
      { t: 'scene', id: 'scene.test', effects: [{ standing: 'odin', by: 1 }] },
      { content: full, ctx: due.ctx },
    ).state;
    expect(night.standing.odin).toBe(audited.standing.odin + 1);
  });
});

describe('a jarl’s bribe (docs/tech-spec.md §47)', () => {
  const def = full.scripted?.find((d) => d.id === 'case.jarl');
  const spec = full.days.find((d) => (d.queue.scripted ?? []).some((s) => s.case === def?.id));
  if (!def || !spec) throw new Error('no story soul in this build offers rings');
  const morning = (): RunState => ({ ...newRun(full, 'jarl'), day: spec.day });
  /** The day's shift, every other soul judged rightly and the one who offers stamped `stamped`, to its audit. */
  const judged = (stamped: Destination, base: RunState = morning()) => {
    const ctx = runContext(full, base);
    const queue = campaignQueue(base, { content: full, ctx });
    const actions: RunAction[] = [{ t: 'beginShift', at: 0 }];
    queue.forEach((c, i) => {
      const t = (i + 1) * 1000;
      const offered = c.script === def.id;
      for (const id of offered ? [] : (c.expect.procedures ?? [])) {
        const tool = ctx.procedures.find((p) => p.id === id)?.tool;
        if (tool) actions.push({ t: 'shift', action: { t: 'tool', tool, at: t } });
      }
      actions.push({ t: 'shift', action: { t: 'stamp', dest: offered ? stamped : c.expect.dest, at: t } });
      actions.push({ t: 'shift', action: { t: 'send', at: t } });
    });
    return { ...drive(full, base, actions), queue };
  };

  it('jumps the line: first on its day, ahead even of the souls who waited through the night', () => {
    const base = morning();
    const ctx = runContext(full, base);
    const queue = campaignQueue(base, { content: full, ctx });
    expect(queue[0]?.script).toBe(def.id);
    // A soul left at dusk the night before still comes after him.
    const other = campaignQueue({ ...morning(), seed: 'jarl-other' }, { content: full, ctx }).find((c) => !c.script);
    if (!other) throw new Error('no generated soul');
    const waited = campaignQueue({ ...base, waiting: [other] }, { content: full, ctx });
    expect(waited[0]?.script).toBe(def.id);
    expect(waited.findIndex((c) => c.id === other.id)).toBeGreaterThan(0);
  });

  it('says what it offers, for a stamp where it doesn’t belong; other souls offer nothing', () => {
    const base = morning();
    const queue = campaignQueue(base, { content: full, ctx: runContext(full, base) });
    const jarl = queue.find((c) => c.script === def.id);
    if (!jarl) throw new Error('no jarl in the line');
    const offer = storyOffer(full, jarl);
    expect(offer).not.toBeNull();
    expect(offer?.dest).not.toBe(jarl.expect.dest);
    expect(stampRings(full, jarl, offer?.dest ?? 'HEL')).toBe(offer?.rings);
    expect(stampRings(full, jarl, jarl.expect.dest)).toBe(0);
    for (const c of queue.filter((x) => x.script !== def.id)) expect(storyOffer(full, c)).toBeNull();
  });

  it('pays at the audit if taken, and the stamp is a mistake all the same; refused, it pays nothing', () => {
    const base = morning();
    const jarl = campaignQueue(base, { content: full, ctx: runContext(full, base) }).find((c) => c.script === def.id);
    const offer = jarl ? storyOffer(full, jarl) : null;
    if (!jarl || !offer) throw new Error('no offer');
    const economy = economyFor(base, { content: full, ctx: runContext(full, base) });

    const refused = judged(jarl.expect.dest);
    const r = refused.run;
    const rl = r.ledger.at(-1);
    expect(r.phase).toBe('audit');
    expect(rl?.wrong).toBe(0);
    expect(r.rings).toBe(base.rings + (rl?.pay ?? 0) + (rl?.bonus ?? 0));
    expect(r.flags.jarl_refused).toBe(1);
    expect(r.flags.jarl_bribe).toBeUndefined();

    const taken = judged(offer.dest);
    const t = taken.run;
    const tl = t.ledger.at(-1);
    // A wrong stamp: no wage for him, a citation (forgiven, the day's first), filed as paid for.
    expect(tl?.wrong).toBe(1);
    expect(tl?.pay).toBe((rl?.pay ?? 0) - economy.wage);
    expect(tl?.mistakes).toEqual([expect.objectContaining({ stamped: offer.dest, paid: offer.rings })]);
    // His rings reach the purse at the audit, as the story's; Hel was owed him, and he sits on Odin's benches.
    expect(t.rings).toBe(base.rings + (tl?.pay ?? 0) + (tl?.bonus ?? 0) - (tl?.fines ?? 0) + offer.rings);
    expect(t.storyRings).toBe(r.storyRings + offer.rings);
    expect(t.flags.jarl_bribe).toBe(1);
    expect(t.flags.jarl_refused).toBeUndefined();
    expect(Object.keys(tl?.standing ?? {}).length).toBeGreaterThan(0);
    // Standing moves as for any soul sent there wrongly, and the rings are all the story adds.
    expect(tl?.standing).toEqual(standingFx(campaignOf(full), jarl.expect.dest, offer.dest));
    expect(tl?.story).toEqual({});
    expect(t.einherjar.unworthy).toBe(r.einherjar.unworthy + 1);
    // A story soul never appeals.
    expect(t.appeal?.case.script).toBeUndefined();
  });
});

describe('a plea at the desk (docs/tech-spec.md §51)', () => {
  const def = full.scripted?.find((d) => d.id === 'case.kari');
  const spec = full.days.find((d) => (d.queue.scripted ?? []).some((s) => s.case === def?.id));
  if (!def || !spec) throw new Error('no story soul in this build pleads');
  const morning = (): RunState => ({ ...newRun(full, 'plea'), day: spec.day });
  /** The day's shift, every other soul judged rightly and the one who pleads stamped `stamped`, to its audit. */
  const judged = (stamped: Destination) => {
    const base = morning();
    const ctx = runContext(full, base);
    const queue = campaignQueue(base, { content: full, ctx });
    const actions: RunAction[] = [{ t: 'beginShift', at: 0 }];
    queue.forEach((c, i) => {
      const t = (i + 1) * 1000;
      const pleads = c.script === def.id;
      for (const id of pleads ? [] : (c.expect.procedures ?? [])) {
        const tool = ctx.procedures.find((p) => p.id === id)?.tool;
        if (tool) actions.push({ t: 'shift', action: { t: 'tool', tool, at: t } });
      }
      actions.push({ t: 'shift', action: { t: 'stamp', dest: pleads ? stamped : c.expect.dest, at: t } });
      actions.push({ t: 'shift', action: { t: 'send', at: t } });
    });
    return drive(full, base, actions).run;
  };

  it('says what it asks for, a stamp where it doesn’t belong; other souls ask nothing', () => {
    const base = morning();
    const queue = campaignQueue(base, { content: full, ctx: runContext(full, base) });
    const soul = queue.find((c) => c.script === def.id);
    if (!soul) throw new Error('no one pleading in the line');
    expect(pleaOf(full, soul)).toEqual({ dest: def.plea?.stamp, text: def.plea?.text });
    expect(pleaOf(full, soul)?.dest).not.toBe(soul.expect.dest);
    for (const c of queue.filter((x) => x.script !== def.id)) expect(pleaOf(full, c)).toBeNull();
  });

  it('granted, is a mistake all the same, filed as a plea; refused, the day is clean', () => {
    const plea = def.plea?.stamp ?? 'HEL';
    const refused = judged(def.expect);
    expect(refused.ledger.at(-1)?.wrong).toBe(0);
    expect(refused.flags.kari_valhalla).toBe(1);
    const granted = judged(plea);
    const l = granted.ledger.at(-1);
    expect(l?.wrong).toBe(1);
    expect(l?.mistakes).toEqual([expect.objectContaining({ stamped: plea, expected: def.expect, pled: true })]);
    expect(l?.standing).toEqual(standingFx(campaignOf(full), def.expect, plea));
    expect(granted.flags.kari_ran).toBe(1);
    expect(granted.flags.kari_valhalla).toBeUndefined();
    // A story soul never appeals.
    expect(granted.appeal?.case.script).toBeUndefined();
    // He asked to be there: at Ragnarök he stands with the drowned instead of running (§59).
    expect(granted.misfits?.[plea] ?? 0).toBe(0);
    expect(granted.named).toContainEqual({ name: 'Kari Solveigarson', day: spec.day, hall: plea, runs: false });
    // Filed either way, as a story soul's plea, for the playtest report (docs/tech-spec.md §60).
    const kari = { name: 'Kari Solveigarson', belongs: def.expect, to: plea, story: true as const };
    expect(refused.ledger.at(-1)?.pleas).toEqual([{ ...kari, granted: false }]);
    expect(l?.pleas).toEqual([{ ...kari, granted: true }]);
  });
});

/** A day of `run`'s, every soul judged rightly but `soul`, stamped `stamped`, to its audit. */
function judgedDay(run: RunState, soul: CaseSpec, stamped: Destination): RunState {
  const ctx = runContext(full, run);
  const actions: RunAction[] = [{ t: 'beginShift', at: 0 }];
  campaignQueue(run, { content: full, ctx }).forEach((c, i) => {
    const t = (i + 1) * 1000;
    const it = c.id === soul.id;
    for (const id of it ? [] : (c.expect.procedures ?? [])) {
      const tool = ctx.procedures.find((p) => p.id === id)?.tool;
      if (tool) actions.push({ t: 'shift', action: { t: 'tool', tool, at: t } });
    }
    actions.push({ t: 'shift', action: { t: 'stamp', dest: it ? stamped : c.expect.dest, at: t } });
    actions.push({ t: 'shift', action: { t: 'send', at: t } });
  });
  return drive(full, run, actions).run;
}

describe('pleas from ordinary souls (docs/tech-spec.md §59)', () => {
  const def = campaignOf(full).pleas;
  if (!def) throw new Error('no pleas in this build');
  const { pleas: _, ...rest } = campaignOf(full);
  const none: Content = { ...full, campaign: rest };
  /** A fresh run's line on `day`. */
  const lineOn = (seed: string, day: number) => {
    const run: RunState = { ...newRun(full, seed), day };
    const ctx = runContext(full, run);
    return { run, ctx, queue: campaignQueue(run, { content: full, ctx }) };
  };
  /**
   * The first soul in a fresh run's lines who pleads for `to`, and tells no lie: one that lies too is found out, and
   * runs (docs/tech-spec.md §73).
   */
  const pleading = (to: Destination) => {
    for (let i = 0; i < 12; i++) {
      for (let day = def.from; day <= campaignOf(full).lastDay; day++) {
        const { run, queue } = lineOn(`plea-${to}-${i}`, day);
        const soul = queue.find((c) => !c.script && c.lies.length === 0 && pleaOf(full, c)?.dest === to);
        if (soul) return { run, soul };
      }
    }
    throw new Error(`no soul pleads for ${to}`);
  };

  it('come on some days from their first: one soul of the day’s own, asking for a hall the list allows, the same every time', () => {
    let days = 0;
    let asked = 0;
    for (let i = 0; i < 4; i++) {
      for (let day = 4; day <= campaignOf(full).lastDay; day++) {
        const { run, ctx, queue } = lineOn(`plea${i}`, day);
        const asking = queue.filter((c) => c.plea);
        days++;
        if (asking.length > 0) asked++;
        // Not before their first day, nor on a day a story soul in the line pleads (Kari, Jofrid, Thorolf), and one a
        // day at most.
        if (day < def.from || queue.some((c) => c.script && pleaOf(full, c))) expect(asking).toEqual([]);
        expect(asking.length).toBeLessThanOrEqual(1);
        for (const c of asking) {
          const plea = pleaOf(full, c);
          expect(c.script).toBeUndefined();
          expect(c.day).toBe(day);
          expect(c === queue.find((x) => !x.script) && c.archetype === ctx.spec.queue.teachFirst).toBe(false);
          expect(plea?.dest).not.toBe(c.expect.dest);
          expect(def.list.some((p) => p.from === c.expect.dest && p.to === plea?.dest && p.text === plea?.text)).toBe(
            true,
          );
        }
        // Drawn on a stream of its own: the same line every time, and the same souls as a build without pleas.
        expect(campaignQueue(run, { content: full, ctx })).toEqual(queue);
        expect(queue.map(({ plea: __, ...c }) => c)).toEqual(campaignQueue(run, { content: none, ctx }));
      }
    }
    expect(asked).toBeGreaterThan(days / 5);
  }, 60_000);

  it('granted, is a mistake like any, but the soul stands in the hall it asked for at Ragnarök, and doesn’t appeal', () => {
    for (const to of ['VALHALLA', 'HEL'] as const) {
      const { run, soul } = pleading(to);
      const refused = judgedDay(run, soul, soul.expect.dest);
      expect(refused.ledger.at(-1)?.wrong).toBe(0);
      const granted = judgedDay(run, soul, to);
      const l = granted.ledger.at(-1);
      expect(l?.wrong).toBe(1);
      expect(l?.mistakes).toEqual([expect.objectContaining({ expected: soul.expect.dest, stamped: to, pled: true })]);
      expect(l?.standing).toEqual(standingFx(campaignOf(full), soul.expect.dest, to));
      // Not a misfit who'll run: one who stands, named with the story's own. In Valhalla, with the worthy.
      expect(granted.misfits?.[to] ?? 0).toBe(refused.misfits?.[to] ?? 0);
      expect(granted.named).toContainEqual({ name: soulName(soul), day: run.day, hall: to, runs: false });
      if (to === 'VALHALLA') {
        expect(granted.einherjar.worthy).toBe(refused.einherjar.worthy + 1);
        expect(granted.einherjar.unworthy).toBe(refused.einherjar.unworthy);
      }
      // It got what it asked for, so it never appeals.
      expect(granted.appeal?.case.id).not.toBe(soul.id);
      // Filed either way for the playtest report, which can't tell a refused plea from any right stamp otherwise.
      const filed = { name: soulName(soul), belongs: soul.expect.dest, to };
      expect(refused.ledger.at(-1)?.pleas).toEqual([{ ...filed, granted: false }]);
      expect(granted.ledger.at(-1)?.pleas).toEqual([{ ...filed, granted: true }]);
    }
  });

  it('leave the day’s list empty when nobody asked, and a build without them keeps none', () => {
    const quiet = Array.from({ length: 12 }, (_, i) => lineOn(`quiet${i}`, def.from)).find(
      ({ queue }) => !queue.some((c) => c.kin || pleaOf(full, c)),
    );
    if (!quiet) throw new Error(`nobody's Day ${def.from} is quiet in 12 seeds`);
    const [first] = quiet.queue;
    if (!first) throw new Error('an empty line');
    expect(judgedDay(quiet.run, first, first.expect.dest).ledger.at(-1)?.pleas).toEqual([]);
    const d1 = drive(demo, newRun(demo, 'quiet'), shiftActions(newRun(demo, 'quiet'), demo)).run;
    expect(d1.ledger.at(-1)).not.toHaveProperty('pleas');
  });
});

describe('kin of the misjudged (docs/tech-spec.md §60)', () => {
  const def = campaignOf(full).kin;
  if (!def) throw new Error('no kin in this build');
  const wronged = { name: 'Bjorn Ketilsson', day: 6, hall: 'HEL' as const, runs: true };
  /** A fresh run's line on `day`, with souls it sent where they didn't belong. */
  const lineOn = (seed: string, day: number, change: Partial<RunState>) => {
    const run: RunState = { ...newRun(full, seed), day, ...change };
    const ctx = runContext(full, run);
    return { run, ctx, queue: campaignQueue(run, { content: full, ctx }) };
  };
  const kinIn = (queue: readonly CaseSpec[]) => queue.filter((c) => c.kin);

  it('come for a soul sent where it didn’t belong, from their first day and two days after, and ask to join it', () => {
    let came = 0;
    for (let i = 0; i < 16; i++) {
      const { ctx, queue } = lineOn(`kin${i}`, 9, { named: [wronged] });
      const kin = kinIn(queue);
      expect(kin.length).toBeLessThanOrEqual(1);
      for (const c of kin) {
        came++;
        expect(c.kin).toEqual({ name: wronged.name, day: wronged.day, hall: wronged.hall });
        expect(c.script).toBeUndefined();
        expect(c === queue.find((x) => !x.script) && c.archetype === ctx.spec.queue.teachFirst).toBe(false);
        // Unless it belongs where he went, it asks to go there too. Nobody else pleads the day kin come.
        if (c.expect.dest !== 'HEL') expect(pleaOf(full, c)).toEqual({ dest: 'HEL', text: def.plea });
        else expect(pleaOf(full, c)).toBeNull();
        expect(queue.filter((x) => x !== c && pleaOf(full, x))).toEqual([]);
      }
    }
    expect(came).toBeGreaterThan(0);
    // Not before their first day or two days after the mistake; not for a soul whose kin came; not for a story soul;
    // and not for one who'll stand, having been sent where it asked.
    for (let i = 0; i < 16; i++) {
      expect(kinIn(lineOn(`kin${i}`, def.from - 1, { named: [{ ...wronged, day: 1 }] }).queue)).toEqual([]);
      expect(kinIn(lineOn(`kin${i}`, 9, { named: [{ ...wronged, day: 8 }] }).queue)).toEqual([]);
      expect(kinIn(lineOn(`kin${i}`, 9, { named: [wronged], kin: [wronged.name] }).queue)).toEqual([]);
      expect(kinIn(lineOn(`kin${i}`, 9, { named: [{ ...wronged, name: 'Geir Hallsson' }] }).queue)).toEqual([]);
      expect(kinIn(lineOn(`kin${i}`, 9, { named: [{ ...wronged, runs: false }] }).queue)).toEqual([]);
      // Nor on a day a story soul pleads (Kari, second in Day 16's line): one soul a day at most asks for another hall.
      expect(kinIn(lineOn(`kin${i}`, 16, { named: [wronged] }).queue)).toEqual([]);
    }
    // Without Kari, some of those days would have brought them.
    const noKari: Content = { ...full, scripted: (full.scripted ?? []).filter((d) => d.id !== 'case.kari') };
    const noKariLine = (seed: string) => {
      const run: RunState = { ...newRun(noKari, seed), day: 16, named: [wronged] };
      return campaignQueue(run, { content: noKari, ctx: runContext(noKari, run) });
    };
    expect(Array.from({ length: 16 }, (_, i) => kinIn(noKariLine(`kin${i}`)).length).some((n) => n > 0)).toBe(true);
  });

  it('never come to the soul that teaches the day’s rule, nor does a plea, wherever story souls stand before it', () => {
    const run: RunState = { ...newRun(full, 'kin-teach'), day: def.from, named: [wronged] };
    const ctx = runContext(full, run);
    const queue = campaignQueue(run, { content: full, ctx });
    const teacher = queue[0];
    if (!teacher || teacher.archetype !== ctx.spec.queue.teachFirst) throw new Error(`no soul teaches Day ${run.day}`);
    const pleas = campaignOf(full).pleas;
    if (!pleas) throw new Error('no pleas in this build');
    const asks = (c: CaseSpec) => pleas.list.some((p) => p.from === c.expect.dest && ctx.destinations.has(p.to));
    const other = queue.find((c, i) => i > 0 && !c.script && c.day === run.day && asks(c));
    if (!other) throw new Error(`no other soul of Day ${run.day} who could plead`);
    // Kin and a plea come every day here, and the teacher could ask for another hall: when neither comes to it, that's
    // because it teaches.
    expect(asks(teacher)).toBe(true);
    // Without the word among the dead (docs/tech-spec.md §73), whose level would set the pleas' chance instead.
    const { word: _, ...plain } = campaignOf(full);
    const sure: Content = {
      ...full,
      campaign: { ...plain, kin: { ...def, chance: 100 }, pleas: { ...pleas, chance: 100 } },
    };
    // A story soul at the gate, as the jarl is on Day 9: the teacher is second in the line.
    const story: CaseSpec = { ...other, id: 'story', script: 'case.story' };
    for (let i = 0; i < 8; i++) {
      const seeded = { ...run, seed: `kin-teach${i}` };
      expect(kinIn(withKin(sure, seeded, ctx, [story, teacher]))).toEqual([]);
      expect(withPlea(sure, seeded, ctx, [story, teacher]).filter((c) => c.plea)).toEqual([]);
      // With another of the day's own after it, that one is given them.
      expect(kinIn(withKin(sure, seeded, ctx, [story, teacher, other])).map((c) => c.id)).toEqual([other.id]);
      const pled = withPlea(sure, seeded, ctx, [story, teacher, other]).filter((c) => c.plea);
      expect(pled.map((c) => c.id)).toEqual([other.id]);
    }
  });

  it('are the soul’s husband or wife, or else a cousin, by the name the soul had', () => {
    expect(genderOfName('Bjorn Ketilsson')).toBe('m');
    expect(genderOfName('Thora Ketilsdottir')).toBe('f');
    expect(kinRelation('f', 'Bjorn Ketilsson')).toBe('wife');
    expect(kinRelation('m', 'Thora Ketilsdottir')).toBe('husband');
    expect(kinRelation('m', 'Bjorn Ketilsson')).toBe('cousin');
  });

  it('are never a soul whose name makes it closer kin already: the same father, or named as the other’s father is', () => {
    const run: RunState = { ...newRun(full, 'kin-names'), day: 9 };
    const ctx = runContext(full, run);
    const own = campaignQueue(run, { content: full, ctx }).filter((c) => !c.script && c.day === 9 && !c.plea);
    const father = (c: CaseSpec) => c.evidence.look.patronym.replace(/s(?:son|dottir)$/, '');
    const x = own.find((c) => c.evidence.look.gender === 'm');
    if (!x) throw new Error('no man of Day 9’s own');
    // Another soul none of the names below make kin.
    const y = own.find(
      (c) => father(c) !== father(x) && father(c) !== x.evidence.look.name && c.evidence.look.name !== father(x),
    );
    if (!y) throw new Error('no other soul of Day 9’s own');
    const sure: Content = { ...full, campaign: { ...campaignOf(full), kin: { ...def, chance: 100 } } };
    const given = (name: string, seed: string) =>
      kinIn(withKin(sure, { ...run, seed, named: [{ ...wronged, name }] }, ctx, [x, y])).map((c) => c.id);
    const closer = [
      `Hoskuld ${father(x)}sson`, // the same father
      `${father(x)} Hoskuldsson`, // x's father's name
      `Hoskuld ${x.evidence.look.name}sson`, // x's son
    ];
    for (let i = 0; i < 8; i++) for (const name of closer) expect(given(name, `kin-names${i}`)).toEqual([y.id]);
    // A name that says nothing of either: some days, it's x.
    const picked = Array.from({ length: 8 }, (_, i) => given('Hoskuld Hoskuldsson', `kin-names${i}`)[0]);
    expect(picked).toContain(x.id);
  });

  it('come once: the audit keeps the name of the soul they came for', () => {
    const found = Array.from({ length: 16 }, (_, i) => lineOn(`kin${i}`, 9, { named: [wronged] })).find(
      (x) => kinIn(x.queue).length > 0,
    );
    if (!found) throw new Error('no kin in 16 seeds');
    const soul = kinIn(found.queue)[0];
    if (!soul) throw new Error('no kin');
    const day = judgedDay(found.run, soul, soul.expect.dest);
    expect(day.kin).toEqual([wronged.name]);
    // Filed for the playtest report with whose kin it was, and what it asked for, if anything (beside the story's own
    // asks: on Day 9, the jarl's rings, docs/tech-spec.md §73).
    const asks = pleaOf(full, soul);
    expect(day.ledger.at(-1)?.pleas?.filter((p) => !p.story)).toEqual([
      {
        name: soulName(soul),
        belongs: soul.expect.dest,
        ...(asks ? { to: asks.dest } : {}),
        kin: wronged.name,
        granted: false,
      },
    ]);
    expect(kinIn(lineOn(found.run.seed, 10, { named: [wronged], kin: day.kin ?? [] }).queue)).toEqual([]);
  });
});

describe('a miser’s bribe (docs/tech-spec.md §59)', () => {
  it('offers forty rings for the stamp that sends the living home: taken, a mistake that pays; refused, Hel', () => {
    const run: RunState = { ...newRun(full, 'miser'), day: 13 };
    const ctx = runContext(full, run);
    const miser = campaignQueue(run, { content: full, ctx }).find((c) => c.script === 'case.hrapp');
    if (!miser) throw new Error('no miser in the line');
    expect(miser.expect.dest).toBe('HEL');
    expect(storyOffer(full, miser)).toEqual({ dest: 'RETURN', rings: 40 });
    const refused = judgedDay(run, miser, 'HEL');
    expect(refused.flags.hrapp_refused).toBe(1);
    expect(refused.flags.hrapp_draugr).toBeUndefined();
    const taken = judgedDay(run, miser, 'RETURN');
    expect(taken.flags.hrapp_draugr).toBe(1);
    expect(taken.ledger.at(-1)?.mistakes).toEqual([
      expect.objectContaining({ expected: 'HEL', stamped: 'RETURN', paid: 40 }),
    ]);
    // Forty rings, less the wage a right stamp would have paid (one mistake is within the day's warnings).
    expect(taken.rings).toBe(refused.rings + 40 - economyFor(run, { content: full, ctx }).wage);
  });
});

describe('a trip home at dawn (docs/tech-spec.md §50)', () => {
  const sunMs = (r: RunState) => r.shift?.sunMs ?? 0;
  /** The run on `run`'s day with its shift begun. */
  const begun = (content: Content, run: RunState) => drive(content, run, [{ t: 'beginShift', at: 0 }]).run;

  it('takes its sun from the next shift, a night scene’s tomorrow and a morning’s today, and the audit files it', () => {
    const d1 = drive(demo, newRun(demo, 'dawn'), shiftActions(newRun(demo, 'dawn'), demo)).run;
    const night = drive(demo, d1, [
      { t: 'endAudit' },
      { t: 'scene', id: 'scene.test.night', effects: [{ sun: -120 }] },
    ]);
    expect(night.run.dawnS).toBe(-120);
    const d2 = drive(demo, night.run, [{ t: 'endNight' }]).run;
    expect(shiftMods(d2, demo).sunS).toBe(-120);
    const plain = begun(demo, { ...d2, dawnS: undefined });
    expect(sunMs(plain) - sunMs(begun(demo, d2))).toBe(120_000);
    // The day's audit files it with the day, and it doesn't carry on.
    const audited = drive(demo, d2, shiftActions(d2, demo)).run;
    expect(audited.ledger.at(-1)?.dawnS).toBe(-120);
    expect(audited.dawnS).toBeUndefined();
    const d3 = drive(demo, audited, [{ t: 'endAudit' }, { t: 'endNight' }]).run;
    expect(shiftMods(d3, demo).sunS).toBeUndefined();
    // A morning scene's lands on the same day's shift.
    const morning = drive(demo, d3, [{ t: 'scene', id: 'scene.test.morning', effects: [{ sun: -60 }] }]).run;
    expect(sunMs(begun(demo, d3)) - sunMs(begun(demo, morning))).toBe(60_000);
  });

  it('never takes the whole day: the gate keeps the campaign’s minSunS, which is content', () => {
    const run = { ...newRun(demo, 'dawn-floor'), dawnS: -600 };
    expect(campaignOf(demo).minSunS).toBe(120);
    expect(sunMs(begun(demo, run))).toBe(120_000);
    const lenient = { ...demo, campaign: { ...campaignOf(demo), minSunS: 200 } };
    expect(sunMs(begun(lenient, run))).toBe(200_000);
  });

  it('can lose someone at home: an adult dies, a child goes to relatives', () => {
    const r = stepRun(
      newRun(demo, 'gone'),
      {
        t: 'scene',
        id: 'scene.test',
        effects: [
          { family: 'mother', becomes: 'gone' },
          { family: 'sister', becomes: 'gone' },
        ],
      },
      { content: demo, ctx: runContext(demo, newRun(demo, 'gone')) },
    );
    expect(r.state.family.filter((m) => m.status === 'gone').map((m) => [m.id, m.gone])).toEqual([
      ['mother', 'died'],
      ['sister', 'left'],
    ]);
    expect(r.events.filter((e) => e.e === 'family')).toEqual([
      { e: 'family', id: 'mother', change: 'died' },
      { e: 'family', id: 'sister', change: 'left' },
    ]);
  });
});

describe('grades and the oath (docs/tech-spec.md §49)', () => {
  const DAY = 6;
  /**
   * Day DAY played to its audit: the souls at `wrong` stamped wrong, the rest rightly; with `catchAll`, every liar
   * first caught in a lie the evidence exposes, and every soul's proof looked at (docs/tech-spec.md §76) unless `prove`
   * is false, as a careful player would.
   */
  const played = (opts: {
    wrong?: number[];
    catchAll?: boolean;
    prove?: boolean;
    oath?: boolean;
    story?: boolean;
    assists?: Assists;
  }) => {
    const base: RunState = {
      ...newRun(full, 'grades', { ...(opts.oath ? { oath: true } : {}), ...(opts.story ? { story: true } : {}) }),
      day: DAY,
    };
    const ctx = runContext(full, base);
    const queue = campaignQueue(base, { content: full, ctx });
    const actions: RunAction[] = [{ t: 'beginShift', at: 0, ...(opts.assists ? { assists: opts.assists } : {}) }];
    queue.forEach((c, i) => {
      const at = (i + 1) * 1000;
      if (opts.catchAll) {
        const caught = catchLie(c, ctx, at);
        const proof = opts.prove === false ? [] : proveSoul([c], 0, ctx, at, caught);
        for (const action of [...caught, ...proof]) actions.push({ t: 'shift', action });
      }
      const wrong = opts.wrong?.includes(i) ?? false;
      const dest: Destination = wrong ? (c.expect.dest === 'HEL' ? 'VALHALLA' : 'HEL') : c.expect.dest;
      for (const id of wrong ? [] : (c.expect.procedures ?? [])) {
        const tool = ctx.procedures.find((p) => p.id === id)?.tool;
        if (tool) actions.push({ t: 'shift', action: { t: 'tool', tool, at } });
      }
      actions.push({ t: 'shift', action: { t: 'stamp', dest, at } }, { t: 'shift', action: { t: 'send', at } });
    });
    const r = drive(full, base, actions);
    return { ...r, grade: r.run.ledger.at(-1)?.grade };
  };

  it('grades a day by the souls it got wrong, and at the top by the liars caught before their stamp', () => {
    const flawless = played({ catchAll: true }).grade;
    expect(flawless?.liars).toBeGreaterThan(0);
    expect(flawless).toMatchObject({ grade: 'flawless', mistakes: 0, caught: flawless?.liars, lucky: 0 });
    // Every soul judged rightly, but on what the body's front showed alone: lucky stamps (docs/tech-spec.md §76).
    const unlooked = played({}).grade;
    expect(unlooked).toMatchObject({ grade: 'sharp', mistakes: 0, caught: 0 });
    expect(unlooked?.lucky).toBeGreaterThan(0);
    // Every liar caught too, but some souls stamped on a guess: Flawless needs every stamp proven.
    const guessed = played({ catchAll: true, prove: false }).grade;
    expect(guessed).toMatchObject({ grade: 'sharp', mistakes: 0, caught: guessed?.liars });
    expect(guessed?.lucky).toBeGreaterThan(0);
    expect(played({ wrong: [0] }).grade?.grade).toBe('steady');
    expect(played({ wrong: [0, 1] }).grade?.grade).toBe('shaky');
    expect(played({ wrong: [0, 1, 2] }).grade?.grade).toBe('shaky');
    expect(played({ wrong: [0, 1, 2, 3] }).grade).toMatchObject({ grade: 'rough', mistakes: 4 });
    // Sun to spare is kept for personal bests; a day without assists isn't marked.
    expect(flawless?.spareMs).toBeGreaterThan(0);
    expect(flawless?.assisted).toBeUndefined();
  });

  it('marks a grade earned with a slower sun or the rule tracker, not one with fines waived; Story Mode has none', () => {
    expect(played({ assists: { sunPct: 50 } }).grade?.assisted).toBe(true);
    expect(played({ assists: { tracker: true } }).grade?.assisted).toBe(true);
    expect(played({ assists: { noFines: true } }).grade?.assisted).toBeUndefined();
    expect(played({ story: true }).grade).toBeUndefined();
  });

  it('never asks for a lie the evidence doesn’t expose', () => {
    const { run, ctx } = played({ catchAll: true });
    const shift = run.shift;
    if (!shift) throw new Error('no shift');
    // One liar's contradicting evidence taken away: that lie can't be caught, so it isn't counted.
    const i = shift.cases.findIndex((c) => c.lies.length > 0);
    const c = shift.cases[i];
    if (!c) throw new Error('no liar');
    let hidden = c;
    for (let left = solve(c.evidence.fields, soulCtx(ctx, c)).contradictions; left.length > 0; ) {
      const against = new Set(left.flatMap((x) => x.against));
      hidden = {
        ...hidden,
        evidence: { ...hidden.evidence, fields: hidden.evidence.fields.filter((f) => !against.has(f.id)) },
      };
      left = solve(hidden.evidence.fields, soulCtx(ctx, hidden)).contradictions;
    }
    expect(solve(hidden.evidence.fields, soulCtx(ctx, hidden)).contradictions).toEqual([]);
    const cases = shift.cases.map((x, k) => (k === i ? hidden : x));
    const verdicts = shift.verdicts.map((v) => (v.index === i ? { ...v, caught: 0 } : v));
    const before = dayGrade(shift, ctx);
    expect(dayGrade({ ...shift, cases, verdicts }, ctx)).toMatchObject({
      grade: 'flawless',
      liars: before.liars - 1,
      caught: before.caught - 1,
    });
  });

  it('keeps as a best the better grade, then one played without assists, then more sun to spare', () => {
    expect(GRADES[0]).toBe('flawless');
    const day = (grade: (typeof GRADES)[number], spareMs: number, assisted?: true) => ({
      grade,
      spareMs,
      ...(assisted ? { assisted } : {}),
    });
    expect(beatsDay(day('sharp', 0), undefined)).toBe(true);
    expect(beatsDay(day('flawless', 0), day('sharp', 90_000))).toBe(true);
    expect(beatsDay(day('sharp', 90_000), day('flawless', 0))).toBe(false);
    expect(beatsDay(day('sharp', 0), day('sharp', 90_000, true))).toBe(true);
    expect(beatsDay(day('sharp', 90_000, true), day('sharp', 0))).toBe(false);
    expect(beatsDay(day('sharp', 60_000), day('sharp', 50_000))).toBe(true);
    expect(beatsDay(day('sharp', 50_000), day('sharp', 50_000))).toBe(false);
  });

  it('holds a run under the oath to it: fines from the first mistake, whatever the assists; no hints; no replays', () => {
    expect(() => newRun(full, 'x', { oath: true, story: true })).toThrow(/oath/);
    const sworn = { ...newRun(full, 'grades', { oath: true }), day: DAY };
    const plain = { ...newRun(full, 'grades'), day: DAY };
    expect(sworn.oath).toBe(true);
    expect(stateValue(sworn, 'oath')).toBe(1);
    expect(stateValue(plain, 'oath')).toBe(0);
    const env = { content: full, ctx: runContext(full, plain) };
    expect(economyFor(plain, env).warnings).toBeGreaterThan(0);
    expect(economyFor(sworn, env).warnings).toBe(0);
    // One mistake: forgiven in a plain run, fined under the oath, even with fines waived by the assist.
    expect(played({ wrong: [0] }).run.ledger.at(-1)?.fines).toBe(0);
    expect(played({ wrong: [0], oath: true }).run.ledger.at(-1)?.fines).toBeGreaterThan(0);
    expect(played({ wrong: [0], assists: { noFines: true } }).run.ledger.at(-1)?.fines).toBe(0);
    expect(played({ wrong: [0], oath: true, assists: { noFines: true } }).run.ledger.at(-1)?.fines).toBeGreaterThan(0);
    // Skögul gives no hints.
    const begun = drive(full, sworn, [{ t: 'beginShift', at: 0 }]).run;
    if (!begun.shift) throw new Error('no shift');
    expect(begun.shift.config.oath).toBe(true);
    const hint = stepShift(begun.shift, { t: 'hint', at: 1000 }, runContext(full, sworn));
    expect(hint.events).toContainEqual({ e: 'rejected', reason: 'no hints under the oath' });
    // No day can be replayed; a plain run's days can.
    expect(replayableDays(startSave(full, 'x', 1, { oath: true }))).toEqual([]);
    expect(replayableDays(startSave(full, 'x', 1))).toEqual([1]);
  });
});

describe('promotion (docs/tech-spec.md §44)', () => {
  const def = campaignOf(full).promotion;
  const rank = (n: number) => {
    const r = def?.ranks[n - 1];
    if (!r) throw new Error(`no rank ${n}`);
    return r;
  };
  /** Clean days up to the morning of `day`: every soul judged rightly, none left at dusk. */
  const cleanTo = (day: number, seed = 'promotion'): RunState => {
    let run = newRun(full, seed);
    while (run.day < day) run = playDay(full, run).run;
    return run;
  };
  const answer = (run: RunState, accept: boolean) => drive(full, run, [{ t: 'promotion', accept }]).run;

  it('offers the next rank the morning after enough clean days, and again after as many more if declined', () => {
    expect(def).toBeDefined();
    if (!def) return;
    // Days 1-3 clean: the first morning an offer can come.
    const first = cleanTo(def.from);
    expect(first.offer).toBe(1);
    expect(cleanTo(def.from - 1).offer).toBeUndefined();
    // Declining costs nothing, and the count starts again.
    const declined = answer(first, false);
    expect(declined).toMatchObject({ day: def.from, rings: first.rings, standing: first.standing });
    expect(declined.rank).toBeUndefined();
    let run = playDay(full, declined).run;
    expect(run.offer).toBeUndefined();
    for (let i = 1; i < def.cleanDays; i++) run = playDay(full, run).run;
    expect(run.offer).toBe(1);
    // The day it was declined, its audit files the answer.
    expect(playDay(full, declined).afterShift.ledger.at(-1)?.offer).toEqual({ rank: 1, taken: false });
    // A day with a mistake starts the count again.
    const spoiled = playDay(full, declined, { wrong: (i) => i === 0 }).run;
    expect(spoiled.clean).toBe(0);
  });

  it('brings a longer line, a higher wage, fewer mistakes forgiven and Odin’s tithe', () => {
    const offered = cleanTo(def?.from ?? 4);
    const plain = answer(offered, false);
    const taken = answer(offered, true);
    const second = rank(1);
    expect(taken.rank).toBe(1);
    const line = (r: RunState) => drive(full, r, [{ t: 'beginShift', at: 0 }]).run.shift?.cases ?? [];
    const base = line(plain);
    const more = line(taken);
    // The day's own souls, the same, then the rank's.
    expect(more.length).toBe(base.length + second.souls);
    expect(more.slice(0, base.length).map((c) => c.id)).toEqual(base.map((c) => c.id));
    const names = more.map((c) => `${c.evidence.look.name} ${c.evidence.look.patronym}`);
    expect(new Set(names).size).toBe(names.length);
    // Every soul judged rightly: the wage is the rank's.
    const env = { content: full, ctx: runContext(full, taken) };
    const economy = economyFor(taken, env);
    expect(economy.wage).toBe(economyFor(plain, env).wage + second.wage);
    expect(economy.warnings).toBe(Math.max(0, economyFor(plain, env).warnings + second.warnings));
    const day = playDay(full, taken);
    const ledger = day.afterShift.ledger.at(-1);
    expect(ledger).toMatchObject({ rank: 1, offer: { rank: 1, taken: true }, correct: more.length });
    expect(ledger?.pay).toBe(more.length * economy.wage);
    // Odin's tithe at night, in the accounts.
    expect(day.run.ledger.at(-1)?.night?.tithe).toBe(second.tithe);
    const n = day.run.ledger.at(-1)?.night;
    if (!ledger || !n) throw new Error('no night');
    expect(n.rings).toBe(
      day.afterShift.rings - n.hearth - n.food - n.medicine - (n.tithe ?? 0) - n.upgrades + n.draupnir,
    );
    // With mistakes, the fines start one sooner.
    const two = (i: number) => i < 2;
    const finedPlain = playDay(full, plain, { wrong: two }).afterShift.ledger.at(-1)?.fines ?? 0;
    const finedRank = playDay(full, taken, { wrong: two }).afterShift.ledger.at(-1)?.fines ?? 0;
    expect(finedPlain).toBe(0);
    expect(finedRank).toBeGreaterThan(0);
  });

  it('lets a rank be stepped down from at night, from the next day: the day worked at it still pays its tithe', () => {
    const taken = answer(cleanTo(def?.from ?? 4), true);
    const shift = drive(full, taken, shiftActions(taken, full)).run;
    const night = drive(full, shift, [{ t: 'endAudit' }, { t: 'stepDown' }]).run;
    expect(night.rank).toBeUndefined();
    expect(night.clean).toBe(0);
    expect(night.ledger.at(-1)?.steppedDown).toBe(1);
    // Stepping down can't dodge the tithe for a day worked at the rank.
    const slept = drive(full, night, [{ t: 'endNight' }]).run;
    expect(slept.ledger.at(-1)?.night?.tithe).toBe(rank(1).tithe);
    // The next day is worked at no rank, and its night has no tithe.
    const next = playDay(full, slept).run;
    expect(next.ledger.at(-1)?.rank).toBeUndefined();
    expect(next.ledger.at(-1)?.night?.tithe).toBeUndefined();
    // Nothing to step down from, and not by day.
    expect(stepRun(slept, { t: 'stepDown' }, { content: full, ctx: runContext(full, slept) }).events[0]).toMatchObject({
      e: 'rejected',
    });
  });

  it('never offers in Story Mode, past the last rank, or for the last day; an offer unanswered at the gate lapses', () => {
    const story = { ...newRun(full, 'promotion-story'), story: true };
    let run: RunState = story;
    while (run.day < (def?.from ?? 4) + 1) run = playDay(full, run).run;
    expect(run.offer).toBeUndefined();
    // At the last rank, clean days bring nothing more.
    const top = { ...cleanTo(def?.from ?? 4), offer: undefined, rank: def?.ranks.length ?? 2 };
    let high: RunState = top;
    for (let i = 0; i < (def?.cleanDays ?? 2) + 1; i++) high = playDay(full, high).run;
    expect(high.offer).toBeUndefined();
    // Unanswered at the gate: declined, and filed so.
    const offered = cleanTo(def?.from ?? 4);
    const lapsed = playDay(full, offered).afterShift;
    expect(lapsed.rank).toBeUndefined();
    expect(lapsed.ledger.at(-1)?.offer).toEqual({ rank: 1, taken: false });
    // The day before the last never brings an offer for it.
    const lastDay = campaignOf(full).lastDay;
    const late = { ...cleanTo(def?.from ?? 4), day: lastDay - 1, clean: (def?.cleanDays ?? 2) - 1 };
    expect(playDay(full, late).afterShift.offer).toBeUndefined();
  });
});

describe('day events (docs/tech-spec.md §52)', () => {
  it('never come on a day with a noon decree, even to a run that drew one there before the day had it (§59)', () => {
    const run = {
      events: [
        { day: 17, id: 'event.storm' },
        { day: 18, id: 'event.feast' },
      ],
    };
    expect(full.days.find((d) => d.day === 18)?.noon).toBeDefined();
    expect(eventOn(run, full, 17)?.id).toBe('event.storm');
    expect(eventOn(run, full, 18)).toBeUndefined();
  });

  const def = campaignOf(full).events;
  const ev = (id: string) => {
    const e = def?.pool.find((x) => x.id === id);
    if (!e) throw new Error(`no day event ${id}`);
    return e;
  };
  /** The morning of `day` with only event `id` drawn for it (or none): Day 11 has no story souls to place. */
  const morning = (id?: string, day = 11, seed = 'events'): RunState => ({
    ...newRun(full, seed),
    day,
    events: id ? [{ day, id }] : [],
  });
  const queue = (run: RunState) => campaignQueue(run, { content: full, ctx: runContext(full, run) });
  const sunMs = (run: RunState) => drive(full, run, [{ t: 'beginShift', at: 0 }]).run.shift?.sunMs ?? 0;
  const pct = (n: number, p: number) => Math.floor((n * p + 50) / 100);
  /** The souls an event brought, and the day's own souls that stayed, against the same day without it. */
  const compare = (id: string, day = 11) => {
    const before = queue(morning(undefined, day));
    const after = queue(morning(id, day));
    const own = new Set(before.map((c) => c.id));
    return {
      before,
      after,
      added: after.filter((c) => !own.has(c.id)),
      kept: after.filter((c) => own.has(c.id)).map((c) => c.id),
    };
  };

  it('draws different events on days 5-17 as a run begins, never two days running, the same for the same seed', () => {
    // From Day 5: Day 4 brings Freyja's stamp alone (docs/tech-spec.md §57). Day 18 has a noon decree now (§59).
    expect(eventDays(full)).toEqual([5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const events = newRun(full, `draw${i}`).events ?? [];
      expect(events).toHaveLength(def?.perRun ?? 0);
      expect(new Set(events.map((e) => e.id)).size).toBe(events.length);
      events.forEach((e, k) => {
        seen.add(e.id);
        expect(eventDays(full)).toContain(e.day);
        expect(e.day).toBeGreaterThanOrEqual(ev(e.id).since);
        const prev = events[k - 1];
        if (prev) expect(e.day - prev.day).toBeGreaterThan(1);
      });
    }
    expect([...seen].sort()).toEqual(def?.pool.map((e) => e.id).sort());
    expect(newRun(full, 'draw0').events).toEqual(newRun(full, 'draw0').events);
    // The demo has none, and neither has a run begun before there were any: its days are as they were.
    expect(newRun(demo, 'draw0').events).toBeUndefined();
    const old = morning();
    const { events: _, ...before } = old;
    expect(queue(before as RunState).map((c) => c.id)).toEqual(queue(old).map((c) => c.id));
  });

  it('changes every day it can fall on by its own count, with its souls bound where it says, none a fallback', () => {
    for (const e of def?.pool ?? []) {
      for (const day of eventDays(full).filter((d) => d >= e.since)) {
        for (const seed of ['every-a', 'every-b']) {
          const plain = { ...newRun(full, seed), day, events: [] };
          const withIt = { ...plain, events: [{ day, id: e.id }] };
          const before = queue(plain);
          const after = queue(withIt);
          const where = `${e.id} on day ${day} (${seed})`;
          expect(after.length - before.length, where).toBe(eventLineChange(e, day));
          const own = new Set(before.map((c) => c.id));
          const added = after.filter((c) => !own.has(c.id));
          const to = new Set(eventSoulsOn(e, day).flatMap((x) => x.to));
          expect(
            added.every((c) => to.has(c.expect.dest) && !c.meta.fallback),
            where,
          ).toBe(true);
          expect(new Set(after.map((c) => c.id)).size, where).toBe(after.length);
        }
      }
    }
    // About 240 days' lines made: under 3s here, near the 5s default on a busy CI runner.
  }, 60_000);

  it('a storm brings the drowned in place of the day’s last souls, under a darker sky', () => {
    const storm = ev('event.storm');
    const { before, after, added, kept } = compare('event.storm');
    expect(after).toHaveLength(before.length);
    expect(added.map((c) => [c.archetype, c.expect.dest])).toEqual(
      Array.from({ length: 3 }, () => ['arch.drowned_raider', 'RAN']),
    );
    // The day's own souls are the same, but for its last three, and its teaching soul is still first.
    expect(kept).toEqual(before.slice(0, before.length - (storm.fewer ?? 0)).map((c) => c.id));
    expect(after[0]?.id).toBe(before[0]?.id);
    const day = full.days.find((d) => d.day === 11);
    expect(runContext(full, morning('event.storm')).spec.sunS).toBe(pct(day?.sunS ?? 0, storm.sunPct ?? 100));
    expect(sunMs(morning(undefined)) - sunMs(morning('event.storm'))).toBe(
      ((day?.sunS ?? 0) - pct(day?.sunS ?? 0, storm.sunPct ?? 100)) * 1000,
    );
  });

  it('a battle brings three more souls from the ford and more sun; a feast three fewer, and a free supper', () => {
    const battle = compare('event.battle');
    expect(battle.after).toHaveLength(battle.before.length + 3);
    expect(battle.kept).toEqual(battle.before.map((c) => c.id));
    expect(battle.added.map((c) => c.archetype).sort()).toEqual([
      'arch.disarmed_warrior',
      'arch.fled_coward',
      'arch.honest_warrior',
    ]);
    expect(sunMs(morning('event.battle'))).toBeGreaterThan(sunMs(morning(undefined)));
    const feast = compare('event.feast');
    expect(feast.after).toHaveLength(feast.before.length - 3);
    expect(feast.added).toEqual([]);
    expect(feast.kept).toEqual(feast.before.slice(0, feast.before.length - 3).map((c) => c.id));
    // Tonight the family eats at the jarl's hall: food costs nothing, and the rest of the bills are as they were.
    const night = (id?: string) => {
      const r = playDay(full, morning(id)).afterShift;
      return nightOutlook(r, { content: full, ctx: runContext(full, r) }).cost;
    };
    const plain = night();
    expect(plain.food).toBeGreaterThan(0);
    expect(night('event.feast')).toEqual({ ...plain, food: 0 });
  });

  it('a sickness brings more who died in their beds, and at night a chance for each at home, bills paid or not', () => {
    const sickness = ev('event.sickness');
    expect(compare('event.sickness').added.map((c) => [c.archetype, c.expect.dest])).toEqual([
      ['arch.straw_braggart', 'HEL'],
      ['arch.straw_braggart', 'HEL'],
    ]);
    // Once Hel's hall is full, they're the clerk's.
    expect(compare('event.sickness', 15).added.map((c) => [c.archetype, c.expect.dest])).toEqual([
      ['arch.bedridden', 'TRANSFER'],
      ['arch.bedridden', 'TRANSFER'],
    ]);
    const outlook = (r: RunState) => nightOutlook(r, { content: full, ctx: runContext(full, r) });
    const sick = playDay(full, morning('event.sickness')).afterShift;
    const plain = playDay(full, morning()).afterShift;
    expect(outlook(sick).members.map((n) => n.risk)).toEqual(sick.family.map(() => sickness.sickChance));
    expect(outlook(plain).members.map((n) => n.risk)).toEqual(plain.family.map(() => 0));
    // Hel's favour spares them this as it spares any chance of falling sick.
    const hel = campaignOf(full).favours?.find((f) => f.id === 'fav.hel');
    const favoured = playDay(full, {
      ...morning('event.sickness'),
      standing: { ...morning().standing, hel: hel?.at ?? 0 },
    }).afterShift;
    expect(outlook(favoured).members.map((n) => n.risk)).toEqual(favoured.family.map(() => 0));
    // Over nights with every bill paid, some fall sick, the same way on every replay.
    const fell = Array.from({ length: 12 }, (_, i) => {
      const night = playDay(full, morning('event.sickness', 11, `cough${i}`)).run;
      return night.family.filter((m) => m.status === 'sick').length;
    });
    expect(fell.some((n) => n > 0)).toBe(true);
    expect(playDay(full, morning('event.sickness', 11, 'cough0')).run.family).toEqual(
      playDay(full, morning('event.sickness', 11, 'cough0')).run.family,
    );
  });

  it('files the day’s event in its ledger, and a day replayed from its morning has the same', () => {
    const played = playDay(full, morning('event.battle'));
    expect(played.afterShift.ledger.at(-1)?.event).toBe('event.battle');
    expect(playDay(full, morning()).afterShift.ledger.at(-1)?.event).toBeUndefined();
    const save = startSave(full, 'events-save', 1);
    expect(save.mornings[0]?.events).toEqual(newRun(full, 'events-save').events);
  });

  it('asks the gods’ requests for a day with an event from the line it brings', () => {
    const d = campaignOf(full).requests;
    let checked = 0;
    for (let i = 0; i < 40 && checked < 3; i++) {
      // The day before, and the feast (three souls fewer) on the day the requests are for.
      const before = { ...newRun(full, `ask${i}`), day: 10, events: [{ day: 11, id: 'event.feast' }] };
      const next = playDay(full, before).run;
      if ((next.requests ?? []).length === 0) continue;
      checked++;
      const line = queue(next);
      for (const r of next.requests ?? []) {
        expect(line.filter((c) => c.expect.dest === r.from).length).toBeGreaterThanOrEqual(r.n);
      }
    }
    expect(d && checked).toBeTruthy();
  });
});

describe('the Norns’ weave (docs/tech-spec.md §53)', () => {
  const weaving = campaignOf(full).weaving;
  const weave = (id: string) => {
    const w = weaving?.weaves.find((x) => x.id === id);
    if (!w) throw new Error(`no weave ${id}`);
    return w;
  };
  /** The morning of `day` in a run woven with `id` (or not woven), with no day event to muddle the line. */
  const morning = (day: number, id?: string, seed = 'woven'): RunState => {
    const { weave: _, ...plain } = { ...newRun(full, seed), day, events: [] };
    return id ? { ...plain, weave: id } : plain;
  };
  const queue = (run: RunState) => campaignQueue(run, { content: full, ctx: runContext(full, run) });
  const readOrder = (run: RunState) => runContext(full, run).rules.map((r) => r.id);

  it('is drawn from the run’s seed when a run is begun woven, and only then; the demo has none to draw', () => {
    const drawn = new Set<string>();
    for (let i = 0; i < 24; i++) {
      const run = newRun(full, `draw${i}`, { woven: true });
      expect(weaving?.weaves.map((w) => w.id)).toContain(run.weave);
      drawn.add(run.weave ?? '');
      expect(newRun(full, `draw${i}`, { woven: true }).weave).toBe(run.weave);
      expect(newRun(full, `draw${i}`).weave).toBeUndefined();
    }
    expect([...drawn].sort()).toEqual(weaving?.weaves.map((w) => w.id).sort());
    expect(newRun(demo, 'draw0', { woven: true }).weave).toBeUndefined();
    // It opens once one of its endings has been reached on the device.
    expect(weaveOpen(full, [])).toBe(false);
    expect(weaveOpen(full, ['ending.demoted', 'ending.alone'])).toBe(false);
    expect(weaveOpen(full, ['ending.lastStand'])).toBe(true);
    expect(weaveOpen(demo, ['ending.lastStand'])).toBe(false);
  });

  it('reads the rules in its order from its first day, and says which it moved', () => {
    expect(weaveDay(full, weave('weave.sea'))).toBe(6);
    expect(weaveDay(full, weave('weave.clerkLast'))).toBe(10);
    // Before its first day, the order is the day's own.
    expect(readOrder(morning(5, 'weave.sea'))).toEqual(readOrder(morning(5)));
    const sea = readOrder(morning(6, 'weave.sea'));
    expect(sea.indexOf('rule.ran')).toBeLessThan(sea.indexOf('rule.outlaw'));
    const clerk = readOrder(morning(12, 'weave.clerkLast'));
    expect(clerk.indexOf('rule.transfer')).toBeGreaterThan(clerk.indexOf('rule.valhalla'));
    expect(clerk.at(-1)).toBe('rule.hel');
    expect(
      runContext(full, morning(12, 'weave.clerkLast'))
        .rules.filter((r) => r.woven)
        .map((r) => r.id),
    ).toEqual(['rule.transfer']);
    expect(wovenRules(full, weave('weave.clerkLast'), 12)).toEqual(['rule.transfer']);
  });

  it('makes the day’s souls as in any run, judged in its order, with two of its own in place of two', () => {
    // Days with no story soul to place among them.
    for (const [id, day] of [
      ['weave.sea', 11],
      ['weave.clerkLast', 14],
    ] as const) {
      const plain = queue(morning(day));
      const woven = queue(morning(day, id));
      expect(woven, id).toHaveLength(plain.length);
      const byId = new Map(plain.map((c) => [c.id, c]));
      const same = woven.filter((c) => byId.has(c.id));
      // The same people, less the two the weave's own replaced (the last of the day's own).
      expect(
        same.map((c) => c.id),
        id,
      ).toEqual(plain.slice(0, plain.length - 2).map((c) => c.id));
      for (const c of same) expect(c.truth, id).toEqual(byId.get(c.id)?.truth);
      expect(
        woven.filter((c) => !byId.has(c.id)),
        id,
      ).toHaveLength(2);
    }
    // Its own are souls both rules claim, which the day's own order would send elsewhere, whenever the generator makes
    // them of their kind (it tries the kind first, not only): nearly all of them.
    for (const [id, day] of [
      ['weave.sea', 11],
      ['weave.clerkLast', 14],
    ] as const) {
      let contested = 0;
      let brought = 0;
      for (const seed of ['claim-a', 'claim-b', 'claim-c', 'claim-d', 'claim-e']) {
        const own = new Set(queue(morning(day, undefined, seed)).map((c) => c.id));
        const plainCtx = runContext(full, morning(day, undefined, seed));
        for (const c of queue(morning(day, id, seed)).filter((x) => !own.has(x.id))) {
          brought++;
          if (judge(c.truth, plainCtx).dest !== c.expect.dest) contested++;
        }
      }
      expect(brought, id).toBe(10);
      expect(contested, id).toBeGreaterThanOrEqual(7);
    }
  });

  it('keeps every soul in a woven line fair under its order: the careful bot judges them all rightly', () => {
    for (const id of ['weave.sea', 'weave.clerkLast']) {
      for (const day of [10, 14, 17]) {
        for (const seed of ['fair-a', 'fair-b']) {
          const run = morning(day, id, seed);
          const ctx = runContext(full, run);
          // A party's members (docs/tech-spec.md §69) with their companions, whose evidence shows their lies about them.
          const line = queue(run);
          line.forEach((c, i) => {
            const cx = soulCtx(ctx, c);
            const crossCaught = crossCaughtAt(line, i, ctx);
            // A sworn man goes where his jarl goes, as the jarl's own evidence decides (§70).
            const given = givenAt(line, i, ctx);
            const j = solve(c.evidence.fields, cx, {
              reveals: revealsOf(c.lies),
              crossCaught,
              ...(given ? { given } : {}),
            }).judgment;
            expect(j.kind === 'determined' && j.dest, `${id} day ${day} ${c.id}`).toBe(c.expect.dest);
            const knobs = tierKnobs(c.meta.tier, cx.spec.queue.knobs);
            const companions = companionsAt(line, i, ctx);
            const valid = validateCase(
              c.evidence,
              c.truth,
              c.lies,
              c.expect,
              c.meta.decisive,
              cx,
              knobs,
              companions,
              given,
            );
            expect(valid.ok, `${id} day ${day} ${c.id}`).toBe(true);
          });
        }
      }
    }
  });

  it('keeps its weave in the save, so a day replayed from its morning reads the same order', () => {
    const save = startSave(full, 'woven-save', 1, { woven: true });
    const first = save.mornings[0];
    expect(first?.weave).toBe(newRun(full, 'woven-save', { woven: true }).weave);
    const run = { ...(first as RunState), day: 12 };
    expect(readOrder(run)).toEqual(readOrder({ ...run }));
  });
});
