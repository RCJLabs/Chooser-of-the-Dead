import { createDayContext, type DayLedger, ENGINE_MAJOR, type RunSave, type RunState, resumeSave } from '@cots/engine';
import { loadContent, loadScenes, scenarioSave } from '@cots/testkit';
import { describe, expect, it } from 'vitest';
import { playtestReport } from '../../packages/ui/src/campaign/playtest';
import { fileName, isKeptSave, keepable } from './keep';
import { parseReports, type Report } from './parse';
import { type Band, dayList, placeAmong, quantile, summarize } from './summary';

const content = loadContent('dev-full');
const scenes = loadScenes('dev-full');
/** The game's words as their keys, as the report's own tests read them. */
const t = (key: string, vars?: Readonly<Record<string, string | number>>) =>
  vars ? `${key}${JSON.stringify(vars)}` : key;

const report = (save: RunSave, build = 'web-playtest · abc1234 · content 5f3e') => {
  const { run } = resumeSave(save, content, ENGINE_MAJOR);
  return playtestReport({ save, run, slot: 1, build, content, scenes, t });
};

/** Three days judged rightly, then made into what a tester's run might hold: mistakes, assists, pleas, a reprieve. */
function testerSave(): { save: RunSave; ledger: DayLedger[] } {
  const base = scenarioSave(content, 'playtest-read', 4, ENGINE_MAJOR);
  const last = base.mornings.at(-1) as RunState;
  const [d1, d2, d3] = last.ledger;
  if (!d1 || !d2 || !d3?.night || !d2.grade) throw new Error('the scenario has no three days');
  const rule = createDayContext(content, 2, last.seed).rules[0]?.id ?? 'rule.unknown';
  const ledger: DayLedger[] = [
    d1,
    {
      ...d2,
      correct: d2.correct - 3,
      wrong: 3,
      assists: { sunPct: 75 },
      grade: { ...d2.grade, grade: 'rough', spareMs: 83_000, assisted: true, lucky: 2 },
      pressed: { n: 4, gave: 1 },
      // A vow at the cup broken (docs/tech-spec.md §75).
      vow: { id: 'vow.clean', kept: false, rings: 0, standing: { odin: -1 } },
      mistakes: [
        { rule, expected: 'VALHALLA', stamped: 'HEL', noon: true },
        { rule, expected: 'VALHALLA', stamped: 'HEL', paid: 30 },
        { rule: 'rule.lost', expected: 'HEL', stamped: 'HEL', skipped: ['proc.clip'] },
      ],
      pleas: [
        { name: 'Arne Hauksson', belongs: 'HEL', to: 'VALHALLA', granted: false },
        { name: 'Ulf Tokason', belongs: 'HEL', kin: 'Orm Grimsson', granted: false },
        // Rings offered for a hall, and a soul that lied and was granted it (docs/tech-spec.md §73).
        { name: 'Geir Hallsson', belongs: 'RAN', to: 'VALHALLA', offer: 15, granted: false },
        { name: 'Thora Ketilsdottir', belongs: 'HEL', to: 'RAN', granted: true, lied: true },
      ],
    },
    {
      ...d3,
      night: { ...d3.night, rings: -4, reprieve: 20 },
      pleas: [],
      vow: { id: 'vow.silent', kept: true, rings: 4, standing: {} },
    },
  ];
  return { save: { ...base, mornings: base.mornings.map((m) => ({ ...m, ledger })) }, ledger };
}

describe('reading a playtest report back', () => {
  it('reads the header, every day of the table, the mistakes and the pleas', () => {
    const { save, ledger } = testerSave();
    const [r] = parseReports(report(save), 'alice');
    expect(r).toMatchObject({
      label: 'alice',
      build: 'web-playtest · abc1234 · content 5f3e',
      target: 'web-playtest',
      slot: 2,
      seed: 'playtest-read',
      now: { day: 4, phase: 'morning', debtNights: 0 },
      pleas: { asked: 2, granted: 1, kin: 1, offers: 1, taken: 0, lied: 1 },
    });
    expect(r?.days.map((d) => d.day)).toEqual([1, 2, 3]);
    for (const [i, d] of (r?.days ?? []).entries()) {
      const l = ledger[i];
      expect(d).toMatchObject({ right: l?.correct, wrong: l?.wrong, unjudged: l?.unjudged, pay: l?.pay });
      expect(d.rings).toBe(l?.night?.rings);
      expect(d.sunLeftS).toBe(Math.round((l?.grade?.spareMs ?? 0) / 1000));
    }
    expect(r?.days[1]).toMatchObject({ grade: 'rough', assistedGrade: true, assists: 'sun 75%', sunLeftS: 83 });
    // Lucky stamps (docs/tech-spec.md §76) and the day's vow (§75), where the build has them.
    expect(r?.days[1]).toMatchObject({ lucky: 2, vow: { id: 'vow.clean', kept: false } });
    expect(r?.days[2]?.vow).toEqual({ id: 'vow.silent', kept: true });
    expect(r?.days[0]?.vow).toBeUndefined();
    // Claims pressed, and lies that gave way (docs/tech-spec.md §66): none is a count of none, in a build with pressing.
    expect(r?.days[1]?.pressed).toEqual({ n: 4, gave: 1 });
    expect(r?.days[0]?.pressed).toEqual({ n: 0, gave: 0 });
    expect(r?.days[2]).toMatchObject({ rings: -4, reprieve: 20 });
    expect(r?.mistakes).toEqual([
      expect.objectContaining({ day: 2, kind: 'wrong', stamped: 'dest.HEL', expected: 'dest.VALHALLA', noon: true }),
      expect.objectContaining({ day: 2, kind: 'wrong', bribe: true, noon: false }),
      expect.objectContaining({ day: 2, kind: 'skipped', stamped: 'dest.HEL' }),
    ]);
    // The rule, as the report quotes it.
    expect(r?.mistakes[0]?.rule).toMatch(/^rule\./);
  });

  it('finds the report inside the issue it was filed in, and the device the tester played on', () => {
    const { save } = testerSave();
    const issue = [
      "### The game's report",
      '',
      report(save),
      '',
      '### What did you play on?',
      '',
      'Phone',
      '',
      '### How did the money feel?',
      '',
      'Tight from Day 2.',
    ].join('\n');
    const [r] = parseReports(issue, '12');
    expect(r?.device).toBe('Phone');
    expect(r?.days).toHaveLength(3);
    const unanswered = issue.replace('\nPhone\n', '\n_No response_\n');
    expect(parseReports(unanswered, '12')[0]?.device).toBeUndefined();
  });

  it('reads a report from before the table had its sun left, and several pasted together', () => {
    const { save } = testerSave();
    const text = report(save);
    // Drop the column as older builds didn't have it.
    const old = text
      .split('\n')
      .map((l) => {
        if (!l.startsWith('|')) return l;
        const cells = l.split('|');
        return [...cells.slice(0, 6), ...cells.slice(7)].join('|');
      })
      .join('\n');
    expect(old).not.toContain('Sun left');
    const both = parseReports(`${old}\n\n${text}`, 'pasted');
    expect(both.map((r) => r.label)).toEqual(['pasted #1', 'pasted #2']);
    expect(both[0]?.days[1]?.sunLeftS).toBeUndefined();
    expect(both[0]?.days[1]?.wrong).toBe(3);
    expect(both[1]?.days[1]?.sunLeftS).toBe(83);
  });

  it('finds nothing in text without a report', () => {
    expect(parseReports('Loved it. The Day 9 jarl was great.', 'note')).toEqual([]);
  });
});

describe('summing up reports', () => {
  const band = (name: string, median: number, n = 20): Band => ({
    name,
    runs: 20,
    byDay: new Map([1, 2, 3].map((day) => [day, { p25: median - 5, median, p75: median + 5, n }])),
  });

  it('sets each run beside the bots, and counts mistakes by rule', () => {
    const { save } = testerSave();
    const alice = parseReports(report(save), 'alice');
    const bob = parseReports(report(scenarioSave(content, 'playtest-read-2', 3, ENGINE_MAJOR)), 'bob');
    const text = summarize([...alice, ...bob], [band('expert', 40), band('novice', 0, 14)]);
    expect(text).toContain('# Playtest reports: 2 runs');
    expect(text).toMatch(/\| alice \| web-playtest · abc1234 · content 5f3e \|/);
    expect(text).toContain('sun 75% (Day 2)');
    // Rings by night: the runs, then the bots, with how many bot runs were still going.
    expect(text).toContain('| Day | alice | bob | expert bots | novice bots |');
    expect(text).toMatch(/\| 2 \| -?\d+\* \| -?\d+ \| 40 \(35 to 45\) \| 0 \(-5 to 5\), 14 runs \|/);
    expect(text).toContain('- alice: -4 rings after Night 3, below the novice bots.');
    // Judging: both runs on Day 1, only alice's Day 2 had mistakes.
    // The sun left is the median of both runs' Day 2, each at least alice's 1:23; alice pressed 4, and 1 gave way.
    expect(text).toMatch(/\| 2 \| 2 \| \d+ \| 3 \| 0 \| \d+% \| 1 of 2 \| \d+:\d\d \(2\) \| 4 \(1\) \| 1 \|/);
    // Mistakes by rule, the most first; the skipped step and the bribe counted apart.
    expect(text).toMatch(/\| rule\.[^|]+ \| 2 \| 1 \| 2 \|/);
    expect(text).toContain('Right stamp, a step skipped: 1.');
    expect(text).toContain('Of the wrong stamps: 1 bribes taken, 0 pleas granted, 1 after a noon decree.');
    expect(text).toContain(
      'Pleas: 2, granted: 1. Kin who came: 1. Offers: 1, taken: 0. Found out lying: 1. From 2 of 2 runs.',
    );
  });

  it('places a number among the bots, and lists days and quantiles', () => {
    const bots = [
      { name: 'novice', median: 0 },
      { name: 'competent', median: 30 },
      { name: 'expert', median: 60 },
    ];
    expect(placeAmong(-10, bots)).toBe('below the novice bots');
    expect(placeAmong(10, bots)).toBe('between the novice and competent bots');
    expect(placeAmong(45, bots)).toBe('between the competent and expert bots');
    expect(placeAmong(60, bots)).toBe('at or above the expert bots');
    expect(dayList([9, 7, 8, 12, 12])).toBe('7–9, 12');
    expect(quantile([5, 1, 3, 2, 4], 0.5)).toBe(3);
    expect(quantile([1, 2, 3, 4], 0.25)).toBe(1.75);
    expect(quantile([83, 350], 0.5)).toBe(216.5);
  });

  it('says so when no run has reached a night', () => {
    const none: Report = { label: 'x', flags: [], days: [], mistakes: [] };
    expect(summarize([none])).toContain('No night has passed in any run yet.');
  });
});

describe("keeping a tester's saves", () => {
  const backup = (slots: unknown[], v = 1) =>
    JSON.stringify({
      format: 'cots.backup',
      v,
      made: '2027-03-01T12:00:00.000Z',
      build: { target: 'web-playtest', edition: 'full', content: '5f3e' },
      settings: { v: 1 },
      daily: { v: 1, results: {} },
      dailyProgress: null,
      endless: null,
      slots,
    });

  it('keeps each campaign slot, named after the tester and the slot', () => {
    const save = scenarioSave(content, 'keep', 2, ENGINE_MAJOR);
    const kept = keepable(backup([null, { v: 1, rev: 4, savedAt: 0, save }, null]), 'Alice B.');
    if ('error' in kept) throw new Error(kept.error);
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({ name: 'alice-b', slot: 2, build: { target: 'web-playtest' } });
    expect(isKeptSave(kept[0])).toBe(true);
  });

  it('says why a file has nothing to keep', () => {
    expect(keepable('not json', 'a')).toEqual({ error: "The file isn't JSON." });
    expect(keepable('{"format":"other"}', 'a')).toEqual({ error: "The file isn't a backup." });
    expect(keepable(backup([], 2), 'a')).toEqual({ error: 'The file is from a newer version of the game.' });
    expect(keepable(backup([null, { v: 1, rev: 1, save: { broken: true } }]), 'a')).toEqual({
      error: 'The backup has no campaign save the game can read.',
    });
    expect(keepable(backup([]), '!!!')).toEqual({ error: 'Give the tester a name: letters or digits.' });
    expect(fileName('  Ásta 2 ')).toBe('sta-2');
  });
});
