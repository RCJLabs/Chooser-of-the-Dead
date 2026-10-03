import { loadContent } from '@cots/testkit';
import { describe, expect, it } from 'vitest';
import type { Content } from '../content/types';
import { createDayContext } from '../logic/context';
import { decreeDays, decreeDaysFor, draftsTonight, sealedDraft, sealedOn } from './decrees';
import { campaignQueue, newRun, type RunAction, stepRun } from './run';
import { recordAction, resumeSave, runContext, startSave } from './save';
import type { RunState } from './state';

/*
 * Tomorrow's decree, sealed (docs/tech-spec.md §79): on three nights a run Odin's clerks send up two drafts of the next
 * day's decree, each the day's own whims and claims drawn from its pools; sealed, a draft is the day's, and pleases one
 * god and annoys the other.
 */

const full = loadContent('dev-full');
const seeds = Array.from({ length: 60 }, (_, i) => `decree-${i}`);

const night = (seed: string, day: number, over: Partial<RunState> = {}): RunState => ({
  ...newRun(full, seed),
  day,
  phase: 'night',
  ...over,
});
const step = (run: RunState, action: RunAction) => stepRun(run, action, { content: full, ctx: runContext(full, run) });

/** A seed whose run draws a decree day that `want` likes, and that day. */
function seedFor(want: (day: number) => boolean): { seed: string; day: number } {
  for (const seed of seeds) {
    const day = decreeDaysFor(full, seed).find(want);
    if (day !== undefined) return { seed, day };
  }
  throw new Error('no seed draws such a day');
}

describe('tomorrow’s decree, sealed (docs/tech-spec.md §79)', () => {
  it('draws three days a run from Days 5-17, none running and none with a noon decree; never in the demo', () => {
    const days = decreeDays(full);
    expect(days[0]).toBe(5);
    expect(days.at(-1)).toBe(17);
    for (const d of days) expect(full.days.find((s) => s.day === d)?.noon).toBeUndefined();
    for (const seed of seeds) {
      const drawn = decreeDaysFor(full, seed);
      expect(drawn).toHaveLength(3);
      expect(drawn).toEqual(decreeDaysFor(full, seed));
      for (const d of drawn) expect(days).toContain(d);
      for (let i = 1; i < drawn.length; i++) expect((drawn[i] ?? 0) - (drawn[i - 1] ?? 0)).toBeGreaterThan(1);
    }
    expect(decreeDaysFor(loadContent('web-demo'), 'decree-0')).toEqual([]);
  });

  it('sends two drafts the night before such a day, each with a choice of its own from every pool; none otherwise', () => {
    const { seed, day } = seedFor((d) => d < 15);
    const drafts = draftsTonight(night(seed, day - 1), full);
    expect(drafts.map((d) => d.def.id)).toEqual(['draft.freyja', 'draft.odin']);
    const [a, b] = drafts;
    if (!a || !b) throw new Error('no drafts');
    expect([a.day, b.day]).toEqual([day, day]);
    expect(Object.keys(a.choose)).toEqual(['freyjaWhim']);
    expect(a.choose.freyjaWhim).not.toBe(b.choose.freyjaWhim);
    expect(a.texts).toHaveLength(1);
    // The same however often it's asked; and none the night after, in the morning, or in a night with no decree day.
    expect(draftsTonight(night(seed, day - 1), full)).toEqual(drafts);
    expect(draftsTonight(night(seed, day), full)).toEqual([]);
    expect(draftsTonight({ ...night(seed, day - 1), phase: 'morning' }, full)).toEqual([]);
    // From Day 15, Odin's claim as well as Freyja's whim, each different.
    const late = seedFor((d) => d >= 15);
    const [x, y] = draftsTonight(night(late.seed, late.day - 1), full);
    expect(Object.keys(x?.choose ?? {}).sort()).toEqual(['freyjaWhim', 'odinClaim']);
    expect(x?.choose.odinClaim).not.toBe(y?.choose.odinClaim);
    expect(x?.choose.freyjaWhim).not.toBe(y?.choose.freyjaWhim);
  });

  it('sealed as the night ends: the day takes the draft’s whims, its god is pleased and the other annoyed', () => {
    const { seed, day } = seedFor((d) => d < 15);
    const eve = night(seed, day - 1);
    const odin = draftsTonight(eve, full).find((d) => d.def.id === 'draft.odin');
    if (!odin) throw new Error('no draft of Odin’s');
    const chosen = step(eve, { t: 'seal', draft: 'draft.odin' }).state;
    expect(chosen.seal).toBe('draft.odin');
    // Nothing moves until the night ends; then the morning has the decree, and the standing has moved.
    expect(chosen.standing).toEqual(eve.standing);
    const r = step(chosen, { t: 'endNight' });
    expect(r.events).toContainEqual({ e: 'sealed', day, draft: 'draft.odin' });
    const morning = r.state;
    expect(morning.day).toBe(day);
    expect(morning.seal).toBeUndefined();
    expect(sealedOn(morning, day)).toEqual(odin.choose);
    expect(sealedDraft(morning, full, day)?.id).toBe('draft.odin');
    expect(morning.standing.odin).toBe(eve.standing.odin + 1);
    expect(morning.standing.freyja).toBe(eve.standing.freyja - 1);
    // Filed as the story's, so the day's audit adds it up with the rest.
    expect(morning.storyStanding).toMatchObject({ odin: 1, freyja: -1 });
    const ctx = runContext(full, morning);
    expect(ctx.paramChoices.freyjaWhim?.id).toBe(odin.choose.freyjaWhim);
    // The day's souls are made under it, and every one of them stands up to the fairness checks.
    const queue = campaignQueue(morning, { content: full, ctx });
    expect(queue.length).toBeGreaterThan(0);
    expect(ctx.params.freyjaWhim).toEqual(createDayContext(full, day, seed, undefined, odin.choose).params.freyjaWhim);
  });

  it('sent back, the day is as its seed draws it and nobody’s standing moves; a pick can change until the night ends', () => {
    const { seed, day } = seedFor(() => true);
    const eve = night(seed, day - 1);
    const changed = step(step(eve, { t: 'seal', draft: 'draft.freyja' }).state, { t: 'seal', draft: null }).state;
    expect(changed.seal).toBeUndefined();
    const morning = step(changed, { t: 'endNight' }).state;
    expect(morning.sealed).toBeUndefined();
    expect(morning.standing).toEqual(eve.standing);
    expect(runContext(full, morning).paramChoices).toEqual(createDayContext(full, day, seed).paramChoices);
    // Freyja's, then Odin's: the last pick is the one sealed.
    const twice = step(step(eve, { t: 'seal', draft: 'draft.freyja' }).state, { t: 'seal', draft: 'draft.odin' }).state;
    expect(step(twice, { t: 'endNight' }).state.sealed?.map((s) => s.draft)).toEqual(['draft.odin']);
  });

  it('is refused by day, for a draft not sent tonight, and on a night that has none', () => {
    const { seed, day } = seedFor(() => true);
    const rejected = (run: RunState, draft: string) =>
      step(run, { t: 'seal', draft }).events.some((e) => e.e === 'rejected');
    expect(rejected({ ...night(seed, day - 1), phase: 'morning' }, 'draft.odin')).toBe(true);
    expect(rejected(night(seed, day - 1), 'draft.loki')).toBe(true);
    expect(rejected(night(seed, day), 'draft.odin')).toBe(true);
    // Sending nothing back is no change at all.
    const eve = night(seed, day - 1);
    expect(step(eve, { t: 'seal', draft: null }).state).toBe(eve);
  });

  it('is kept by the save: the morning after, and the day replayed from it, have the sealed decree', () => {
    const { seed, day } = seedFor(() => true);
    let save = startSave(full, seed, 1);
    const eve = night(seed, day - 1);
    save = { ...save, mornings: [eve] };
    const actions: RunAction[] = [{ t: 'seal', draft: 'draft.freyja' }, { t: 'endNight' }];
    let run = eve;
    for (const a of actions) {
      const next = step(run, a).state;
      save = recordAction(save, run, a, next);
      run = next;
    }
    const resumed = resumeSave(save, full, 1).run;
    expect(resumed.day).toBe(day);
    expect(sealedDraft(resumed, full, day)?.id).toBe('draft.freyja');
    expect(runContext(full, resumed).paramChoices).toEqual(runContext(full, run).paramChoices);
  });

  it('gives every draft a choice from each pool, repeating where a pool has fewer entries than there are drafts', () => {
    const decrees = full.campaign?.decrees;
    if (!full.campaign || !decrees) throw new Error('no decrees in the full game');
    // Three drafts on Odin's days: the whims differ, and Odin's claim, two in the pool, comes round again. (The lint
    // only asks that some pool give every draft its own.)
    const three: Content = {
      ...full,
      campaign: {
        ...full.campaign,
        decrees: { ...decrees, from: 15, to: 17, drafts: [...decrees.drafts, { ...decrees.drafts[0], id: 'draft.x' }] },
      },
    } as Content;
    const late = decreeDaysFor(three, 'decree-0');
    const drafts = draftsTonight(night('decree-0', (late[0] ?? 16) - 1), three);
    expect(drafts).toHaveLength(3);
    expect(new Set(drafts.map((d) => d.choose.freyjaWhim)).size).toBe(3);
    expect(drafts[2]?.choose.odinClaim).toBe(drafts[0]?.choose.odinClaim);
  });
});
