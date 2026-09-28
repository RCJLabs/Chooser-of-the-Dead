import { ENGINE_MAJOR } from '@cots/engine';
import { loadContent, scenarioSave } from '@cots/testkit';
import { describe, expect, it } from 'vitest';
import {
  type Backup,
  type Here,
  isEndlessResult,
  mergeBackup,
  parseBackup,
  type SlotRecord,
  validSlot,
} from './save-data';
import type { DailyProgress, DailyResult, EndlessProgress, Settings } from './store';

/*
 * Backups (docs/tech-spec.md §28): restoring one adds to what's here and never writes over anything
 * newer, anything unreadable, or this device's own settings.
 */

const content = loadContent('web-demo');

const SETTINGS: Settings = {
  v: 1,
  layout: 'auto',
  textScale: 1,
  holdToSend: true,
  untimedPractice: false,
  telemetry: false,
  telemetryAsked: false,
  primerDone: false,
  sound: 0.6,
  endlessBest: 0,
  endlessToday: null,
  endingsSeen: [],
  sunPct: 100,
  ruleTracker: false,
  noFines: false,
  coach: true,
  coached: [],
  tips: [],
  reduceMotion: false,
  deskPapers: {},
  achievements: {},
  dayBests: {},
};

const slot = (seed: string, day: number, savedAt: number, rev = 1): SlotRecord => ({
  v: 1,
  rev,
  savedAt,
  save: scenarioSave(content, seed, day, ENGINE_MAJOR),
});
const result = (n: number, correct = 7): DailyResult => ({
  n,
  g: 1,
  correct,
  total: 8,
  spareMs: 30_000,
  endedBy: 'queue',
  marks: '🟩🟩🟩🟩🟩🟩🟩🟥',
  guard: 'ok',
});
const endlessRun = (dated: EndlessProgress['mode']['dated']): EndlessProgress => ({
  v: 1,
  g: 1,
  mode: {
    kind: 'endless',
    seed: 'endless:91',
    round: 2,
    day: 3,
    strikes: 1,
    judged: 10,
    bestBefore: 5,
    dated,
    tracker: false,
  },
  actions: [{ t: 'begin', at: 0 }],
  judged: 11,
  strikes: 1,
});
const dailyRun = (n: number, g = 1): DailyProgress => ({ v: 1, n, g, actions: [{ t: 'begin', at: 0 }], seenAt: 5 });

const here = (over: Partial<Here> = {}): Here => ({
  settings: SETTINGS,
  daily: { v: 1, results: {} },
  dailyProgress: null,
  endless: null,
  slots: [null, null, null],
  unreadable: [false, false, false],
  ...over,
});
const backup = (over: Partial<Backup> = {}): Backup => ({
  format: 'cots.backup',
  v: 1,
  made: '2027-03-01T12:00:00.000Z',
  build: { target: 'web-demo', edition: 'demo', content: 'abc' },
  settings: SETTINGS,
  daily: { v: 1, results: {} },
  dailyProgress: null,
  endless: null,
  slots: [null, null, null],
  ...over,
});
const OPTS = { today: 91, g: 1, playable: () => true };

describe('reading a backup', () => {
  it('tells text that isn’t one, another file, and a newer version apart', () => {
    expect(parseBackup('{ nope')).toEqual({ ok: false, why: 'notJson' });
    expect(parseBackup('{"a":1}')).toEqual({ ok: false, why: 'notBackup' });
    expect(parseBackup('[]')).toEqual({ ok: false, why: 'notBackup' });
    expect(parseBackup('{"format":"cots.backup","v":2,"slots":[]}')).toEqual({ ok: false, why: 'newer' });
    const b = backup();
    expect(parseBackup(`  ${JSON.stringify(b)}\n`)).toEqual({ ok: true, backup: b });
  });

  it('checks a slot the way the game does when it loads one', () => {
    const s = slot('run-a', 2, 10);
    expect(validSlot(s)).toBe(s);
    expect(validSlot({ ...s, v: 2 })).toBeNull();
    expect(validSlot({ ...s, save: { format: 'cots.run', v: 9 } })).toBeNull();
    expect(validSlot('nope')).toBeNull();
  });
});

describe('restoring a backup', () => {
  it('adds Daily results this device hasn’t got, and never replaces one it has', () => {
    const mine = here({ daily: { v: 1, results: { '90': result(90, 8) } } });
    const theirs = backup({
      daily: {
        v: 1,
        results: {
          '89': result(89),
          '90': result(90, 1),
          // Not results: the wrong key, more right than there were souls, an unknown ending.
          '88': result(87),
          '86': { ...result(86), correct: 9 },
          '85': { ...result(85), endedBy: 'boredom' as 'queue' },
        },
      },
    });
    const { next, report } = mergeBackup(mine, theirs, OPTS);
    expect(Object.keys(next.daily.results).sort()).toEqual(['89', '90']);
    expect(next.daily.results['90']?.correct).toBe(8);
    expect(report.dailyAdded).toBe(1);
  });

  it('keeps this device’s settings, and merges only the records kept in them', () => {
    const mine = here({
      settings: { ...SETTINGS, textScale: 1.5, endlessBest: 20, endingsSeen: ['ending.a'], coached: [1] },
    });
    const theirs = backup({
      settings: {
        ...SETTINGS,
        textScale: 0.85,
        telemetry: true,
        telemetryAsked: true,
        sunPct: 50,
        primerDone: true,
        endlessBest: 12,
        endingsSeen: ['ending.b', 'ending.a'],
        coached: [1, 2],
        tips: ['press'],
        endlessToday: { n: 91, date: '2027-03-01', preview: false, g: 1, judged: 9, round: 1, day: 2 },
      },
    });
    const { next, report } = mergeBackup(mine, theirs, OPTS);
    expect(next.settings).toEqual({
      ...mine.settings,
      primerDone: true,
      endlessBest: 20,
      endingsSeen: ['ending.a', 'ending.b'],
      coached: [1, 2],
      tips: ['press'],
      endlessToday: theirs.settings.endlessToday,
    });
    expect(report.records).toBe(true);
    // Nothing new: nothing changes.
    const again = mergeBackup(here({ settings: next.settings }), theirs, OPTS);
    expect(again.next.settings).toBe(next.settings);
    expect(again.report.records).toBe(false);
  });

  it('adds the achievements this device hasn’t got, each at the earlier time it was earned', () => {
    const mine = here({ settings: { ...SETTINGS, achievements: { 'ach.a': 500, 'ach.b': 100 } } });
    const theirs = backup({
      settings: {
        ...SETTINGS,
        // Earlier here, later there, one new, one this build doesn't have, and junk that isn't a time.
        achievements: { 'ach.a': 300, 'ach.b': 900, 'ach.c': 700, 'ach.fromTheFullGame': 800, 'ach.bad': 'yesterday' },
      },
    });
    const { next, report } = mergeBackup(mine, theirs, OPTS);
    expect(next.settings.achievements).toEqual({
      'ach.a': 300,
      'ach.b': 100,
      'ach.c': 700,
      'ach.fromTheFullGame': 800,
    });
    expect(report.records).toBe(true);
    const again = mergeBackup(here({ settings: next.settings }), theirs, OPTS);
    expect(again.next.settings).toBe(next.settings);
    expect(again.report.records).toBe(false);
    // A backup from before achievements were kept changes nothing.
    const old = backup({ settings: { ...SETTINGS, achievements: undefined } });
    expect(mergeBackup(mine, old, OPTS).next.settings).toBe(mine.settings);
  });

  it('keeps each day’s better best, from here or from the backup (docs/tech-spec.md §49)', () => {
    const mine = here({
      settings: {
        ...SETTINGS,
        dayBests: { '1': { grade: 'sharp', spareMs: 60_000 }, '2': { grade: 'flawless', spareMs: 10_000 } },
      },
    });
    const theirs = backup({
      settings: {
        ...SETTINGS,
        dayBests: {
          // A better grade; the same grade but with assists; a day not graded here; a day this build doesn't
          // have; and junk.
          '1': { grade: 'flawless', spareMs: 5_000, oath: true },
          '2': { grade: 'flawless', spareMs: 90_000, assisted: true },
          '3': { grade: 'steady', spareMs: 0 },
          '20': { grade: 'rough', spareMs: 0 },
          x: { grade: 'flawless', spareMs: 1 },
          '4': { grade: 'brilliant', spareMs: 1 },
          '5': { grade: 'sharp', spareMs: -1 },
        },
      } as unknown as Settings,
    });
    const { next, report } = mergeBackup(mine, theirs, OPTS);
    expect(next.settings.dayBests).toEqual({
      '1': { grade: 'flawless', spareMs: 5_000, oath: true },
      '2': { grade: 'flawless', spareMs: 10_000 },
      '3': { grade: 'steady', spareMs: 0 },
      '20': { grade: 'rough', spareMs: 0 },
    });
    expect(report.records).toBe(true);
    expect(mergeBackup(here({ settings: next.settings }), theirs, OPTS).report.records).toBe(false);
    // A backup from before grades were kept changes nothing.
    const old = backup({ settings: { ...SETTINGS, dayBests: undefined } as unknown as Settings });
    expect(mergeBackup(mine, old, OPTS).next.settings).toBe(mine.settings);
  });

  it('puts a campaign in its own slot if it’s free, else the first free one, else nowhere', () => {
    const a = slot('run-a', 2, 100);
    const b = slot('run-b', 3, 100);
    const c = slot('run-c', 1, 100);
    expect(mergeBackup(here(), backup({ slots: [null, b, null] }), OPTS).next.slots).toEqual([null, b, null]);

    const taken = mergeBackup(here({ slots: [null, a, null] }), backup({ slots: [null, b, null] }), OPTS);
    expect(taken.next.slots).toEqual([b, a, null]);
    expect(taken.report.slots).toEqual([{ from: 1, to: 0, outcome: 'added' }]);

    const full = mergeBackup(here({ slots: [a, c, null] }), backup({ slots: [slot('run-d', 1, 1), null, b] }), OPTS);
    expect(full.next.slots).toEqual([a, c, full.next.slots[2]]);
    expect(full.report.slots).toEqual([
      { from: 0, to: 2, outcome: 'added' },
      { from: 2, outcome: 'noRoom' },
    ]);
  });

  it('keeps whichever copy of the same run was saved later', () => {
    const older = slot('run-a', 2, 100, 7);
    const newer = slot('run-a', 3, 200, 2);
    const replaced = mergeBackup(here({ slots: [null, null, older] }), backup({ slots: [newer, null, null] }), OPTS);
    expect(replaced.next.slots[2]?.save).toBe(newer.save);
    // Its revision goes past this device's, so the stored copy that wins on the next load is this one.
    expect(replaced.next.slots[2]?.rev).toBe(8);
    expect(replaced.next.slots[0]).toBeNull();
    expect(replaced.report.slots).toEqual([{ from: 0, to: 2, outcome: 'replaced' }]);

    const kept = mergeBackup(here({ slots: [newer, null, null] }), backup({ slots: [older, null, null] }), OPTS);
    expect(kept.next.slots).toEqual([newer, null, null]);
    expect(kept.report.slots).toEqual([{ from: 0, to: 0, outcome: 'kept' }]);
  });

  it('never writes over a slot it can’t read, and skips what this build can’t play or read', () => {
    const b = slot('run-b', 2, 100);
    const mine = here({ unreadable: [false, true, false] });
    const { next, report } = mergeBackup(mine, backup({ slots: [null, b, null] }), OPTS);
    // Slot 2 holds something this build can't read: the campaign goes to the first free slot instead.
    expect(next.slots).toEqual([b, null, null]);
    expect(report.slots).toEqual([{ from: 1, to: 0, outcome: 'added' }]);

    const skipped = mergeBackup(
      here(),
      backup({ slots: [b, { v: 1, rev: 1, savedAt: 1, save: { format: 'cots.run' } } as unknown as SlotRecord, null] }),
      { ...OPTS, playable: () => false },
    );
    expect(skipped.next.slots).toEqual([null, null, null]);
    expect(skipped.report.slots).toEqual([
      { from: 0, outcome: 'unplayable' },
      { from: 1, outcome: 'unreadable' },
    ]);
  });

  it('takes on a run’s boons, curses and score (docs/tech-spec.md §68), and nothing malformed', () => {
    const run = endlessRun(null);
    const picked: EndlessProgress = {
      ...run,
      score: 20,
      mode: { ...run.mode, score: 18, picks: [{ round: 1, id: 'curse.sun' }], hintsUsed: 2, sunPct: 50 },
    };
    expect(mergeBackup(here(), backup({ endless: picked }), OPTS).next.endless).toEqual(picked);
    const bad = { ...picked, mode: { ...picked.mode, picks: [{ round: -1, id: 'curse.sun' }] } };
    expect(mergeBackup(here(), backup({ endless: bad }), OPTS).next.endless).toBeNull();
    const scored = {
      n: 91,
      date: '2027-03-01',
      preview: false,
      g: 1,
      judged: 9,
      round: 1,
      day: 2,
      score: 14,
      curses: 1,
    };
    expect(isEndlessResult(scored)).toBe(true);
    expect(isEndlessResult({ ...scored, score: -1 })).toBe(false);
  });

  it('takes on an unfinished run only where there’s none, and never one already finished here', () => {
    const today = { n: 91, date: '2027-03-01', preview: false };
    expect(mergeBackup(here(), backup({ endless: endlessRun(null) }), OPTS).report.endlessRun).toBe(true);
    expect(mergeBackup(here(), backup({ endless: endlessRun(today) }), OPTS).next.endless?.mode.dated).toEqual(today);
    const played = here({
      settings: { ...SETTINGS, endlessToday: { ...today, g: 1, judged: 3, round: 0, day: 1 } },
    });
    expect(mergeBackup(played, backup({ endless: endlessRun(today) }), OPTS).next.endless).toBeNull();
    const busy = here({ endless: endlessRun(null) });
    expect(mergeBackup(busy, backup({ endless: endlessRun(today) }), OPTS).next.endless).toBe(busy.endless);

    // An unfinished Daily: today's, on the same generator, not yet played here.
    expect(mergeBackup(here(), backup({ dailyProgress: dailyRun(91) }), OPTS).report.dailyRun).toBe(true);
    expect(mergeBackup(here(), backup({ dailyProgress: dailyRun(90) }), OPTS).report.dailyRun).toBe(false);
    expect(mergeBackup(here(), backup({ dailyProgress: dailyRun(91, 2) }), OPTS).report.dailyRun).toBe(false);
    const done = here({ daily: { v: 1, results: { '91': result(91) } } });
    expect(mergeBackup(done, backup({ dailyProgress: dailyRun(91) }), OPTS).report.dailyRun).toBe(false);
  });

  it('restores a whole device onto an empty one', () => {
    const device = here({
      settings: { ...SETTINGS, endlessBest: 7, primerDone: true },
      daily: { v: 1, results: { '90': result(90), '91': result(91) } },
      slots: [slot('run-a', 2, 5), null, slot('run-b', 1, 6)],
    });
    const b = backup({ settings: device.settings, daily: device.daily, slots: device.slots });
    const { next } = mergeBackup(here(), JSON.parse(JSON.stringify(b)) as Backup, OPTS);
    expect(next.daily).toEqual(device.daily);
    expect(next.slots).toEqual(device.slots);
    expect(next.settings).toEqual(device.settings);
  });
});
