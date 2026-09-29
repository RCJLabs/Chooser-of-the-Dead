import { loadContent } from '@cots/testkit';
import { describe, expect, it } from 'vitest';
import type { Content, TrailDef } from '../content/types';
import { partyAt } from '../gen/party';
import { TELL_TOOL } from '../gen/render';
import type { CaseSpec, ForgeryTell } from '../gen/types';
import type { DayCtx } from '../logic/context';
import { campaignQueue, newRun, type RunAction, type RunEvent, stepRun, threadsInPlay } from './run';
import { runContext } from './save';
import { type RunState, stateValue, type TrailMark } from './state';
import { canAccuse, culpritOf, huntOn, markTrail, suspectsLeft, trailCtx, trailOf } from './trail';

const full = loadContent('dev-full');
const demo = loadContent('web-demo');
const def = trailOf(full) as TrailDef;

/** Every mark the soul carries: its forged tally's tell, and the knife as Muninn remembers it. */
const handsOn = (c: CaseSpec): ForgeryTell[] => c.evidence.fields.flatMap((f) => f.tell ?? f.hand ?? []);

/** The run on the morning of `day`, as a run from `seed` begins it (the days before it unplayed). */
function morning(seed: string, day: number, over: Partial<RunState> = {}): RunState {
  return { ...newRun(full, seed), day, phase: 'morning', ...over };
}

const queueOf = (run: RunState): CaseSpec[] => campaignQueue(run, { content: full, ctx: runContext(full, run) });

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
  return { run, events };
}

/**
 * A day's shift judged rightly, looking under the lens at every forged tally when `lens` says so, and reading every
 * gap in Muninn's memory: the careful player's. A party (docs/tech-spec.md §69) is judged a member at a time, turning
 * to each, and sent together.
 */
function carefulShift(run: RunState, lens: (c: CaseSpec) => boolean = () => true): RunAction[] {
  const ctx = runContext(full, run);
  const started = stepRun(run, { t: 'beginShift', at: 0 }, { content: full, ctx }).state;
  const actions: RunAction[] = [{ t: 'beginShift', at: 0 }];
  const cases = started.shift?.cases ?? [];
  let party: { start: number; size: number } | null = null;
  cases.forEach((c, i) => {
    const at = (i + 1) * 1000;
    party = partyAt(cases, i) ?? (party && i < party.start + party.size ? party : null);
    const k = party ? i - party.start : 0;
    if (party) actions.push({ t: 'shift', action: { t: 'turn', to: k, at } });
    if (c.evidence.fields.some((f) => f.tell) && lens(c)) {
      actions.push({ t: 'shift', action: { t: 'tool', tool: TELL_TOOL, at } });
    }
    const muninn = c.evidence.fields.filter((f) => f.hand).map((f) => f.id);
    if (muninn.length > 0) actions.push({ t: 'shift', action: { t: 'inspect', fields: muninn, at } });
    for (const id of c.expect.procedures ?? []) {
      const tool = ctx.procedures.find((p) => p.id === id)?.tool;
      if (tool) actions.push({ t: 'shift', action: { t: 'tool', tool, at } });
    }
    actions.push({ t: 'shift', action: { t: 'stamp', dest: c.expect.dest, at } });
    if (!party || k === party.size - 1) actions.push({ t: 'shift', action: { t: 'send', at } });
  });
  return actions;
}

/** The first seed from `prefix` whose line on `day` passes `ok`. */
function seedFor(prefix: string, day: number, ok: (q: CaseSpec[]) => boolean): string {
  for (let i = 0; i < 60; i++) {
    const seed = `${prefix}-${i}`;
    if (ok(queueOf(morning(seed, day)))) return seed;
  }
  throw new Error(`no seed for ${prefix} on day ${day}`);
}

/** Souls carrying a forged tally. */
const forged = (q: readonly CaseSpec[]) => q.filter((c) => c.evidence.fields.some((f) => f.tell));

describe('the forger’s trail (docs/tech-spec.md §71)', () => {
  it('has carvers whose two habits no other carver shares', () => {
    expect(def.suspects.length).toBeGreaterThanOrEqual(2);
    const pairs = def.suspects.map((s) => [...s.hands].sort().join('+'));
    expect(new Set(pairs).size).toBe(pairs.length);
    for (const s of def.suspects) expect(new Set(s.hands).size).toBe(2);
    // So both habits seen name one man, and one seen leaves only those who share it.
    for (const s of def.suspects) {
      expect(
        suspectsLeft(
          def,
          s.hands.map((hand) => ({ hand })),
        ),
      ).toEqual([s]);
      for (const hand of s.hands) expect(suspectsLeft(def, [{ hand }])).toContain(s);
    }
    expect(suspectsLeft(def, [])).toEqual(def.suspects);
  });

  it('draws the carver from the run’s seed, and each of them for some runs', () => {
    const drawn = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const c = culpritOf(def, `draw-${i}`);
      expect(culpritOf(def, `draw-${i}`)).toBe(c);
      drawn.add(c.id);
    }
    expect([...drawn].sort()).toEqual(def.suspects.map((s) => s.id).sort());
  });

  it('runs from its first day on, in the campaign only', () => {
    const run = newRun(full, 'span');
    expect(trailCtx(full, run, def.since - 1)).toBeUndefined();
    expect(runContext(full, { ...run, day: def.since - 1 }).trail).toBeUndefined();
    const on = runContext(full, { ...run, day: def.since });
    expect(on.trail?.hands).toEqual(culpritOf(def, 'span').hands);
    expect(on.trail?.looks.named).toBeUndefined();
    expect(trailOf(demo)).toBeUndefined();
    // A noon decree's souls are made on it too (docs/tech-spec.md §45).
    const noonDay = full.days.find((d) => d.noon && d.day >= def.since);
    if (noonDay) expect(runContext(full, { ...run, day: noonDay.day }).noon?.ctx.trail).toEqual(on.trail);
  });

  it('shows only the carver’s habits, and both on any day with two marks or more', () => {
    let marks = 0;
    let muninn = 0;
    for (let i = 0; i < 16; i++) {
      const seed = `hands-${i}`;
      const hands = culpritOf(def, seed).hands;
      for (let day = def.since; day <= Math.max(...def.nights); day++) {
        const q = queueOf(morning(seed, day));
        const seen = q.flatMap(handsOn);
        for (const h of seen) expect(hands).toContain(h);
        if (seen.length >= 2) expect(new Set(seen).size).toBe(2);
        marks += seen.length;
        // Muninn's memory of the knife names the habit the soul's own tally doesn't show.
        for (const c of q) {
          const hand = c.evidence.fields.find((f) => f.hand)?.hand;
          if (!hand) continue;
          muninn++;
          expect(c.evidence.fields.find((f) => f.tell)?.tell).not.toBe(hand);
          expect(c.evidence.fields.find((f) => f.hand)?.text?.msg).toBe(`rv.muninn.carved.${hand}`);
        }
      }
    }
    expect(marks).toBeGreaterThan(16 * 4);
    expect(muninn).toBeGreaterThan(0);
  });

  it('gives Loki’s borrowed faces forged papers of true deeds', () => {
    let loki = 0;
    for (let i = 0; i < 8; i++) {
      for (const c of queueOf(morning(`papers-${i}`, 12))) {
        if (c.archetype !== 'arch.loki') continue;
        loki++;
        const tally = c.evidence.fields.filter((f) => f.item === 'tally' && f.says);
        expect(tally.length).toBeGreaterThan(0);
        for (const f of tally) expect(c.truth[f.says?.fact ?? '']).toBe(f.says?.value);
        expect(c.evidence.fields.some((f) => f.tell)).toBe(true);
      }
    }
    expect(loki).toBeGreaterThan(0);
  });

  it('shows the other habit on the last forged tally when a day’s marks all show one', () => {
    const run = morning(
      seedFor('retell', 12, (q) => forged(q).length >= 2),
      12,
    );
    const ctx = runContext(full, run);
    const [first, second] = ctx.trail?.hands ?? [];
    const q = forged(queueOf(run));
    // The same line, every tally showing the first habit, and Muninn's gaps taken out.
    const same = q.map((c) => ({
      ...c,
      evidence: {
        ...c.evidence,
        fields: c.evidence.fields
          .filter((f) => !f.hand)
          .map((f) => (f.tell ? { ...f, tell: first as ForgeryTell, text: { msg: `tell.${first}`, params: {} } } : f)),
      },
    }));
    const marked = markTrail(same, ctx);
    expect(marked.slice(0, -1)).toEqual(same.slice(0, -1));
    const last = marked[marked.length - 1]?.evidence.fields.find((f) => f.tell);
    expect(last?.tell).toBe(second);
    expect(last?.text?.msg).toBe(`tell.${second}`);
    // A line with both already, or with one mark, is left as it was; so is a day off the trail.
    expect(markTrail(marked, ctx)).toEqual(marked);
    expect(markTrail(same.slice(0, 1), ctx)).toEqual(same.slice(0, 1));
    expect(markTrail(same, { ...ctx, trail: undefined })).toEqual(same);
  });

  it('pins what the chooser sees at the desk, and only that', () => {
    const seed = seedFor('pin', def.since, (q) => forged(q).length >= 2);
    const run = morning(seed, def.since);
    // Under the lens at every forged tally but the first.
    let skipped: string | undefined;
    const lens = (c: CaseSpec) => {
      if (skipped === undefined) {
        skipped = c.id;
        return false;
      }
      return true;
    };
    const { run: after } = drive(full, run, carefulShift(run, lens));
    const marks = after.trail?.marks ?? [];
    const line = after.shift?.cases ?? [];
    const expected = line.flatMap((c) =>
      c.id === skipped
        ? []
        : c.evidence.fields.flatMap((f): TrailMark[] => {
            const name = `${c.evidence.look.name} ${c.evidence.look.patronym}`;
            if (f.tell) return [{ day: def.since, name, hand: f.tell, via: 'tally' }];
            return f.hand ? [{ day: def.since, name, hand: f.hand, via: 'muninn' }] : [];
          }),
    );
    expect(marks).toEqual(expected);
    expect(marks.length).toBeGreaterThan(0);
    // The carver is never ruled out by what's seen.
    expect(suspectsLeft(def, marks)).toContain(culpritOf(def, seed));
  });

  it('keeps what was seen at the desk when the sun sets', () => {
    const seed = seedFor('dusk', def.since, (q) => forged(q.slice(0, 1)).length === 1 && q[0]?.party === undefined);
    const run = morning(seed, def.since);
    const ctx = runContext(full, run);
    const first = queueOf(run)[0] as CaseSpec;
    const actions: RunAction[] = [
      { t: 'beginShift', at: 0 },
      { t: 'shift', action: { t: 'tool', tool: TELL_TOOL, at: 1000 } },
      // Long after dusk and its grace: the shift is over, the soul unjudged.
      { t: 'shift', action: { t: 'tick', at: 3_600_000 } },
    ];
    const { run: after } = drive(full, run, actions);
    expect(after.phase).toBe('audit');
    const hand = first.evidence.fields.find((f) => f.tell)?.tell;
    expect(after.trail?.marks).toContainEqual(expect.objectContaining({ hand, via: 'tally', day: def.since }));
    expect(ctx.trail).toBeDefined();
  });

  it('opens the board once the Night 11 letter asks for his name', () => {
    const night = (day: number, flags: Record<string, number> = {}): RunState => ({
      ...morning('board', day),
      phase: 'night',
      flags,
    });
    const hunting = { hunt_carver: 1 };
    expect(huntOn(night(def.since), full)).toBe(false);
    expect(huntOn(night(def.since, hunting), full)).toBe(true);
    expect(huntOn(night(def.since - 1, hunting), full)).toBe(false);
    for (const n of def.nights) expect(canAccuse(night(n, hunting), full)).toBe(true);
    expect(canAccuse(night(def.since, hunting), full)).toBe(false);
    expect(canAccuse(night(def.nights[0] as number), full)).toBe(false);
    expect(canAccuse({ ...night(def.nights[0] as number, hunting), phase: 'audit' }, full)).toBe(false);
    // The journal keeps the hunt in play until a carver is named, or the last night passes.
    const thread = (r: RunState) => threadsInPlay(r, full).some((t) => t.id === 'thread.carver');
    expect(thread(night(12, hunting))).toBe(true);
    expect(thread(night(15, hunting))).toBe(false);
  });

  it('names a carver once, on a trail night, with what naming the right man or another does', () => {
    const seed = 'accuse';
    const culprit = culpritOf(def, seed);
    const other = def.suspects.find((s) => s.id !== culprit.id);
    if (!other) throw new Error('one carver');
    const n = def.nights[0] as number;
    const night: RunState = { ...morning(seed, n), phase: 'night', flags: { hunt_carver: 1 } };
    const env = { content: full, ctx: runContext(full, night) };
    const rejected = (r: { events: RunEvent[] }) => r.events.some((e) => e.e === 'rejected');
    expect(rejected(stepRun(night, { t: 'accuse', suspect: 'nobody' }, env))).toBe(true);
    expect(rejected(stepRun({ ...night, flags: {} }, { t: 'accuse', suspect: culprit.id }, env))).toBe(true);
    expect(rejected(stepRun({ ...night, day: n - 1 }, { t: 'accuse', suspect: culprit.id }, env))).toBe(true);

    const right = stepRun(night, { t: 'accuse', suspect: culprit.id }, env);
    expect(right.events[0]).toEqual({ e: 'accused', suspect: culprit.id, right: true });
    expect(right.state.trail?.accused).toEqual({ suspect: culprit.id, day: n, right: true });
    expect(stateValue(right.state, 'trail.night')).toBe(n);
    expect(stateValue(right.state, 'trail.right')).toBe(1);
    expect(right.state.flags.reported_carver).toBe(1);
    expect(right.state.rings).toBe(night.rings + 15);
    expect(right.state.standing.odin).toBe(night.standing.odin + 1);
    // Once a run.
    expect(rejected(stepRun(right.state, { t: 'accuse', suspect: culprit.id }, env))).toBe(true);

    const wrong = stepRun(night, { t: 'accuse', suspect: other.id }, env);
    expect(wrong.state.trail?.accused).toEqual({ suspect: other.id, day: n, right: false });
    expect(stateValue(wrong.state, 'trail.right')).toBe(0);
    expect(wrong.state.flags.carver_wrong).toBe(1);
    expect(wrong.state.flags.reported_carver).toBeUndefined();
    expect(wrong.state.standing.odin).toBe(night.standing.odin - 1);
    expect(stateValue(night, 'trail.night')).toBe(0);
  });

  it('stops pinning once a carver is named', () => {
    const seed = seedFor('named', 13, (q) => forged(q).length > 0);
    const culprit = culpritOf(def, seed);
    const accused = { suspect: culprit.id, day: 12, right: true };
    const run = morning(seed, 13, { trail: { marks: [], accused }, flags: { reported_carver: 1 } });
    const { run: after } = drive(full, run, carefulShift(run));
    expect(after.trail).toEqual({ marks: [], accused });
  });

  describe('the carver at the desk', () => {
    const faceOf = (q: CaseSpec[], script: string) => q.find((c) => c.script === script)?.evidence.look;
    const nameOf = (s: { look: { name: string } }) => s.look.name;

    it('drowned the day after he’s rightly named, with the run’s carver’s face', () => {
      for (let i = 0; i < 4; i++) {
        const seed = `right-${i}`;
        const culprit = culpritOf(def, seed);
        const accused = { suspect: culprit.id, day: 12, right: true };
        const q = queueOf(morning(seed, 13, { trail: { marks: [], accused }, flags: { reported_carver: 1 } }));
        expect(faceOf(q, 'case.bjarni_drowned')?.name).toBe(nameOf(culprit));
        expect(faceOf(q, 'case.carver_innocent')).toBeUndefined();
        const late = queueOf(morning(seed, 15, { trail: { marks: [], accused }, flags: { reported_carver: 1 } }));
        expect(late.some((c) => c.script?.startsWith('case.carver') || c.script === 'case.bjarni_old')).toBe(false);
      }
    });

    it('the man named instead, drowned, and the carver dead of a fever on Day 15', () => {
      for (let i = 0; i < 4; i++) {
        const seed = `wrong-${i}`;
        const culprit = culpritOf(def, seed);
        const other = def.suspects.find((s) => s.id !== culprit.id) ?? culprit;
        const accused = { suspect: other.id, day: 12, right: false };
        const over = { trail: { marks: [], accused }, flags: { carver_wrong: 1 } };
        const q = queueOf(morning(seed, 13, over));
        expect(faceOf(q, 'case.carver_innocent')?.name).toBe(nameOf(other));
        expect(faceOf(q, 'case.bjarni_drowned')).toBeUndefined();
        const late = queueOf(morning(seed, 15, over));
        expect(faceOf(late, 'case.bjarni_old')?.name).toBe(nameOf(culprit));
        expect(faceOf(late, 'case.carver_innocent_late')).toBeUndefined();
      }
    });

    it('named on Night 14: on Day 15, drowned, or the man named beside the carver', () => {
      const seed = 'late-0';
      const culprit = culpritOf(def, seed);
      const other = def.suspects.find((s) => s.id !== culprit.id) ?? culprit;
      const right = { trail: { marks: [], accused: { suspect: culprit.id, day: 14, right: true } } };
      const rq = queueOf(morning(seed, 15, { ...right, flags: { reported_carver: 1 } }));
      expect(faceOf(rq, 'case.carver_late')?.name).toBe(nameOf(culprit));
      expect(faceOf(rq, 'case.bjarni_old')).toBeUndefined();
      const wrong = { trail: { marks: [], accused: { suspect: other.id, day: 14, right: false } } };
      const wq = queueOf(morning(seed, 15, { ...wrong, flags: { carver_wrong: 1 } }));
      expect(faceOf(wq, 'case.carver_innocent_late')?.name).toBe(nameOf(other));
      expect(faceOf(wq, 'case.bjarni_old')?.name).toBe(nameOf(culprit));
      // Nobody named on Day 13 from a Night 14 that hasn't come.
      const q13 = queueOf(morning(seed, 13));
      expect(q13.some((c) => c.script === 'case.carver_innocent' || c.script === 'case.bjarni_drowned')).toBe(false);
    });

    it('never named: dead of a fever on Day 15, with the carver’s face', () => {
      const seed = 'never-0';
      const q = queueOf(morning(seed, 15));
      expect(faceOf(q, 'case.bjarni_old')?.name).toBe(nameOf(culpritOf(def, seed)));
    });
  });
});
