import { loadContent } from '@cots/testkit';
import { describe, expect, it } from 'vitest';
import type { CampaignDef, EpilogueDef } from '../content/types';
import { epilogueFor, epilogueParams } from './epilogue';
import { campaignOf, newRun } from './run';
import { type RunState, stateValue } from './state';

// The epilogue (docs/tech-spec.md §55), on a made-up one: a slot for the mother, one for a deal, one that says
// nothing unless its line holds.
const DEF: EpilogueDef = {
  when: { state: 'ending.demoted', lte: 0 },
  slots: [
    {
      id: 'epi.mother',
      section: 'home',
      lines: [
        { when: { state: 'member.mother.died', gte: 1 }, text: 'mother.died' },
        { when: { state: 'member.mother.sick', gte: 1 }, text: 'mother.sick' },
        { text: 'mother.well' },
      ],
    },
    {
      id: 'epi.deal',
      section: 'powers',
      when: { state: 'flags.loki_deal', gte: 1 },
      lines: [{ when: { state: 'ending.naglfar', gte: 1 }, text: 'deal.sailed' }, { text: 'deal.kept' }],
    },
    { id: 'epi.quiet', section: 'dead', lines: [{ when: { state: 'flags.never', gte: 1 }, text: 'quiet' }] },
  ],
};

const full = loadContent('dev-full');
const campaign: CampaignDef = { ...campaignOf(full), epilogue: DEF };
const base = newRun(full, 'epilogue');

/** A finished run, at an ending, with its family, flags and whatever else changed. */
function ended(ending: string, change: Partial<RunState> = {}): RunState {
  return { ...base, day: 20, ending, ...change };
}

const texts = (run: RunState) => epilogueFor(run, campaign).map((l) => l.text);

describe('the epilogue', () => {
  it('says nothing while the run goes on, or in a build without one', () => {
    expect(epilogueFor(base, campaign)).toEqual([]);
    expect(epilogueFor(ended('ending.wolf'), campaignOf(loadContent('web-demo')))).toEqual([]);
  });

  it('gives each slot the first of its lines that holds, in the content’s order, with its section', () => {
    expect(epilogueFor(ended('ending.wolf'), campaign)).toEqual([
      { slot: 'epi.mother', section: 'home', text: 'mother.well' },
    ]);
    const dealt = ended('ending.naglfar', { flags: { ...base.flags, loki_deal: 1 } });
    expect(texts(dealt)).toEqual(['mother.well', 'deal.sailed']);
    expect(texts({ ...dealt, ending: 'ending.odin' })).toEqual(['mother.well', 'deal.kept']);
    // A slot whose only line doesn't hold says nothing; one whose condition fails, likewise.
    expect(texts(ended('ending.wolf'))).not.toContain('quiet');
  });

  it('reads one of the family by name: sick, or gone, and gone by dying or by leaving', () => {
    const family = (status: 'well' | 'sick' | 'gone', gone?: 'died' | 'left') =>
      base.family.map((m) => (m.id === 'mother' ? { ...m, status, ...(gone ? { gone } : {}) } : m));
    expect(texts(ended('ending.wolf', { family: family('sick') }))).toEqual(['mother.sick']);
    expect(texts(ended('ending.wolf', { family: family('gone', 'died') }))).toEqual(['mother.died']);
    const left = ended('ending.wolf', { family: family('gone', 'left') });
    expect(stateValue(left, 'member.mother.gone')).toBe(1);
    expect(stateValue(left, 'member.mother.left')).toBe(1);
    expect(stateValue(left, 'member.mother.died')).toBe(0);
    expect(stateValue(left, 'member.nobody.gone')).toBe(0);
    // Gone, but not by dying: the next line that holds.
    expect(texts(left)).toEqual(['mother.well']);
  });

  it('reads the ending the run came to, and holds its whole tongue where the content says', () => {
    expect(stateValue(ended('ending.odin'), 'ending.odin')).toBe(1);
    expect(stateValue(ended('ending.odin'), 'ending.wolf')).toBe(0);
    expect(stateValue(base, 'ending.odin')).toBe(0);
    expect(texts(ended('ending.demoted'))).toEqual([]);
  });

  it('gives its words the rings left, the day, the fronts held and the souls who ran', () => {
    const battle = {
      order: ['front.a', 'front.b'],
      fronts: [
        { id: 'front.a', foe: 10, stood: [], ran: 2, arms: 0, strength: 12, held: true },
        { id: 'front.b', foe: 10, stood: [], ran: 3, arms: 0, strength: 4, held: false },
      ],
    };
    expect(epilogueParams(ended('ending.wolf', { rings: 42, battle }))).toEqual({
      rings: 42,
      day: 20,
      fronts: 1,
      ran: 5,
    });
    expect(epilogueParams(ended('ending.demoted', { day: 7, rings: -40 }))).toEqual({
      rings: -40,
      day: 7,
      fronts: 0,
      ran: 0,
    });
  });
});

/*
 * Every line of the shipped epilogue can be said (docs/tech-spec.md §55): for each, some finished run meets its
 * condition and fails every line before it in its slot. A small search over the values its slot's conditions
 * name, each tried in a run built to have it, then read back through epilogueFor itself.
 */
describe('the shipped epilogue', () => {
  const shipped = campaignOf(full);
  const def = shipped.epilogue;
  const fronts = shipped.ragnarok?.fronts.map((f) => f.id) ?? [];

  /** Every state path a condition names, with the thresholds it compares against. */
  function leaves(p: import('../content/types').StatePred | undefined, out: Map<string, Set<number>>) {
    if (!p) return;
    if ('all' in p) for (const q of p.all) leaves(q, out);
    else if ('any' in p) for (const q of p.any) leaves(q, out);
    else if ('not' in p) leaves(p.not, out);
    else {
      const values = out.get(p.state) ?? new Set<number>([0]);
      for (const k of [p.gte, p.lte, p.is])
        if (k !== undefined) for (const v of [k - 1, k, k + 1]) if (v >= 0) values.add(v);
      out.set(p.state, values);
    }
  }

  /**
   * A finished run with the values given: flags, the day, the ending, its origin (docs/tech-spec.md §72) and whoever
   * that brings home, one of the family, a front, a lead.
   */
  function runWith(values: ReadonlyMap<string, number>): RunState {
    let run: RunState = {
      ...base,
      day: 20,
      ending: 'ending.lastStand',
      flags: {},
      battle: {
        order: fronts,
        fronts: fronts.map((id) => ({ id, foe: 1, stood: [], ran: 0, arms: 0, strength: 0, held: false })),
      },
    };
    // The origin first, so its member is at home before anything reads how they are.
    const ordered = [...values].sort(([a], [b]) => Number(b.startsWith('origin.')) - Number(a.startsWith('origin.')));
    for (const [path, v] of ordered) {
      const [head, id = '', how = ''] = path.split('.');
      if (head === 'origin' && v >= 1) {
        const member = shipped.origins?.find((o) => o.id === id)?.member;
        const well = { status: 'well' as const, cold: 0, hungry: 0, sickNights: 0 };
        run = { ...run, origin: id, family: [...run.family, ...(member ? [{ id: member.id, ...well }] : [])] };
      } else if (head === 'flags') run = { ...run, flags: { ...run.flags, [id]: v } };
      else if (head === 'day') run = { ...run, day: v };
      else if (head === 'ending' && v >= 1) run = { ...run, ending: path };
      else if (head === 'member' && v >= 1) {
        const status = how === 'died' || how === 'left' ? 'gone' : (how as 'well' | 'sick' | 'gone');
        run = {
          ...run,
          family: run.family.map((m) =>
            m.id === id ? { ...m, status, ...(how === 'died' || how === 'left' ? { gone: how } : {}) } : m,
          ),
        };
      } else if (head === 'front' && run.battle) {
        const battle = run.battle;
        run = {
          ...run,
          battle: { ...battle, fronts: battle.fronts.map((f) => (f.id === path ? { ...f, held: v >= 1 } : f)) },
        };
      } else if (head === 'lead' && v >= 1) run = { ...run, standing: { ...run.standing, [id]: 10 } };
    }
    return run;
  }

  it('can say each of its lines: some run gives each slot each of its lines', () => {
    expect(def?.slots.length ?? 0).toBeGreaterThan(0);
    const unsaid: string[] = [];
    for (const slot of def?.slots ?? []) {
      const paths = new Map<string, Set<number>>();
      leaves(def?.when, paths);
      leaves(slot.when, paths);
      for (const l of slot.lines) leaves(l.when, paths);
      const keys = [...paths.keys()];
      const said = new Set<string>();
      // Every combination of the values the conditions compare against (a few paths, a few values each).
      const walk = (i: number, values: Map<string, number>) => {
        if (i === keys.length) {
          const line = epilogueFor(runWith(values), shipped).find((l) => l.slot === slot.id);
          if (line) said.add(line.text);
          return;
        }
        for (const v of paths.get(keys[i] as string) ?? []) walk(i + 1, new Map(values).set(keys[i] as string, v));
      };
      walk(0, new Map());
      for (const l of slot.lines) if (!said.has(l.text)) unsaid.push(`${slot.id}: ${l.text}`);
    }
    expect(unsaid).toEqual([]);
  }, 60_000);

  it('says something in every section of a whole run judged rightly to the end', () => {
    // A perfect run to its ending, as the scenario jumper plays it: the family at home, the fronts as held.
    const run = ended('ending.lastStand', {
      flags: {
        ...base.flags,
        stay_home: 1,
        thorvald_met: 1,
        thorvald_returned: 1,
        thorvald16_judged: 1,
        thorvald16_returned: 1,
      },
    });
    const lines = epilogueFor(run, shipped);
    expect(new Set(lines.map((l) => l.section))).toEqual(new Set(['home', 'powers', 'dead']));
    expect(lines.map((l) => l.text)).toContain('epi.refuge.home');
    expect(lines.map((l) => l.text)).toContain('epi.thorvald.slept');
    // No epilogue after a failure.
    expect(epilogueFor({ ...run, ending: 'ending.demoted' }, shipped)).toEqual([]);
  });
});
