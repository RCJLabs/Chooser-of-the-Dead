import { loadContent, loadDailyContent, oracleSolve } from '@cots/testkit';
import { fc, test } from '@fast-check/vitest';
import { describe, expect, it } from 'vitest';
import { createDayContext, soulCtx } from '../logic/context';
import { judge } from '../logic/judge';
import { solve } from '../logic/solver';
import { questionResponse } from '../narrative/questions';
import { Rng } from '../rng/rng';
import { dressForDay, generateCaseAt, generateDay, tierKnobs } from './generate';
import { withLiars } from './lies';
import type { CaseSpec, Field } from './types';
import { validateCase } from './validate';

const content = loadContent('dev-full');
const seedArb = fc.string({ minLength: 1, maxLength: 12 });
// Every day with a spec, from the demo's first to the full game's latest mechanics.
const dayArb = fc.constantFrom(...content.days.map((d) => d.day));
const RUNS = Number(process.env.FAIRNESS_RUNS ?? 150);
// A run generates a whole day and, for the oracle checks, solves every soul by brute force. The oracle only
// enumerates the facts the rules can reach (testkit/src/oracle.ts), so a run is about 6 ms on a laptop. Budget
// 60 ms a run so a busy CI runner and later days have room; the nightly's thousands of runs need minutes, not
// vitest's 5 s.
const TIMEOUT_MS = Math.max(10_000, RUNS * 60);

const revalidate = (
  c: CaseSpec,
  ctx: ReturnType<typeof createDayContext>,
  fields: readonly Field[] = c.evidence.fields,
) =>
  validateCase(
    { ...c.evidence, fields },
    c.truth,
    c.lies,
    c.expect,
    c.meta.decisive,
    ctx,
    tierKnobs(c.meta.tier, ctx.spec.queue.knobs),
  );

describe('fairness contract (F1–F8)', () => {
  test.prop([seedArb, dayArb], { numRuns: RUNS })(
    'every generated soul passes validation',
    (seed, day) => {
      const ctx = createDayContext(content, day, seed);
      for (const c of generateDay(seed, ctx).cases) {
        // Each soul under the rules it's judged by: after a noon decree, the decree's (docs/tech-spec.md §45).
        const v = revalidate(c, soulCtx(ctx, c));
        expect(v.ok ? 'ok' : `${v.code}: ${v.detail}`).toBe('ok');
      }
    },
    TIMEOUT_MS,
  );

  test.prop([seedArb, dayArb], { numRuns: RUNS })(
    'the brute-force oracle agrees with the solver',
    (seed, day) => {
      const ctx = createDayContext(content, day, seed);
      for (const c of generateDay(seed, ctx).cases) {
        const cx = soulCtx(ctx, c);
        const s = solve(c.evidence.fields, cx).judgment;
        expect(s.kind).toBe('determined');
        if (s.kind === 'determined')
          expect(oracleSolve(c.evidence.fields, cx)).toEqual({ kind: 'determined', dest: s.dest });
      }
    },
    TIMEOUT_MS,
  );

  const neverMoreCertain = (seed: string, day: number, pick: number) => {
    const ctx = createDayContext(content, day, seed);
    const rng = new Rng(`subset|${pick}`);
    for (const c of generateDay(seed, ctx).cases) {
      const cx = soulCtx(ctx, c);
      const subset = c.evidence.fields.filter(() => rng.chance(1, 2));
      const s = solve(subset, cx).judgment;
      if (s.kind === 'determined') expect(oracleSolve(subset, cx)).toEqual({ kind: 'determined', dest: s.dest });
    }
  };
  test.prop([seedArb, dayArb, fc.integer()], { numRuns: RUNS })(
    'on partial evidence the solver is never more certain than the oracle',
    neverMoreCertain,
    TIMEOUT_MS,
  );
  // What random runs found (M7.7): a raven's "never fled" refutes a tally's "died in battle" when there's no
  // wound in front; "died in battle" and "never fled" can't both be true without one, so the soul lied; and
  // a presumption (heathen, until the amulet is seen) never proves a lie.
  it.each([
    ['VuxO+4%94*,:', 16, -20],
    ["'PYvB", 17, -1958572512],
    [']tTI3MG.&r', 16, -416200289],
  ] as const)('on partial evidence the solver agrees with the oracle: seed %s, day %i', neverMoreCertain);
});

// These generate whole days (the story's people check, every day of the campaign for twelve seeds), and a
// random seed can make a run slower: seconds on a busy CI runner, not vitest's 5 s.
describe('determinism', { timeout: 30_000 }, () => {
  test.prop([seedArb, dayArb], { numRuns: 40 })('a day is a pure function of (seed, day)', (seed, day) => {
    const a = generateDay(seed, createDayContext(content, day, seed));
    const b = generateDay(seed, createDayContext(content, day, seed));
    expect(b.cases).toEqual(a.cases);
  });

  test.prop([seedArb, dayArb], { numRuns: 40 })('each soul can be generated on its own', (seed, day) => {
    const ctx = createDayContext(content, day, seed);
    generateDay(seed, ctx).cases.forEach((c, i) => {
      expect(generateCaseAt(seed, ctx, i).case).toEqual(c);
    });
  });

  it('names are unique within a day', () => {
    for (let day = 1; day <= 5; day++) {
      const ctx = createDayContext(content, day, 'names');
      const names = generateDay('names', ctx).cases.map((c) => `${c.evidence.look.name}`);
      expect(new Set(names).size).toBe(names.length);
    }
  });

  test.prop([seedArb], { numRuns: 12 })(
    'the story’s people keep their names, and a day repeats no name or look until they run out',
    (seed) => {
      // The family's and the story souls' names, from the packs' names.reserved pools.
      const reserved = new Set(
        Object.entries(content.pools)
          .filter(([id]) => id.startsWith('names.reserved'))
          .flatMap(([, names]) => names),
      );
      expect([...reserved]).toEqual(expect.arrayContaining(['Ulf', 'Asa', 'Hrafn', 'Thorvald']));
      const names = (id: string) => (content.pools[id] ?? []).filter((n) => !reserved.has(n)).length;
      // What there is to go round: given names, and looks (build × beard × clothing).
      const room = {
        m: { names: names('names.m'), looks: 3 * 4 * 4 },
        f: { names: names('names.f'), looks: 3 * 4 },
      };
      for (const d of content.days) {
        expect(d.queue.knobs.spreadLooks, `day ${d.day}`).toBe(true);
        const cases = generateDay(seed, createDayContext(content, d.day, seed)).cases;
        const looks = cases.map((c) => c.evidence.look);
        for (const l of looks) {
          expect(reserved.has(l.name), `${l.name} on day ${d.day}`).toBe(false);
          expect(
            [...reserved].some((r) => l.patronym.startsWith(r)),
            `${l.patronym} on day ${d.day}`,
          ).toBe(false);
        }
        // Each name, and each combination of build, beard and clothing, is given once before any is
        // given twice (a Day 20 with more than 22 men, or 12 women, runs out: about 1 run in 700).
        for (const g of ['m', 'f'] as const) {
          const theirs = looks.filter((l) => l.gender === g);
          const distinct = (key: (l: (typeof theirs)[number]) => string) => new Set(theirs.map(key)).size;
          expect(
            distinct((l) => l.name),
            `${g} names on day ${d.day}`,
          ).toBe(Math.min(theirs.length, room[g].names));
          expect(
            distinct((l) => `${l.build}|${l.beard}|${l.tunic}`),
            `${g} looks on day ${d.day}`,
          ).toBe(Math.min(theirs.length, room[g].looks));
        }
      }
    },
  );

  it('leaves the Daily’s souls as they were: its spec spreads nothing and it reserves no names', () => {
    const dailyContent = loadDailyContent();
    const spec = dailyContent.daily;
    expect(spec).toBeDefined();
    expect(spec?.queue.knobs.spreadLooks).toBeUndefined();
    expect(spec?.queue.knobs.spreadLines).toBeUndefined();
    expect(Object.keys(dailyContent.pools).filter((id) => id.startsWith('names.reserved'))).toEqual([]);
  });
});

// A soul left in line at dusk comes back the next day seen afresh under its rules (docs/tech-spec.md §41):
// on every day it could come to, including those that bring a new kind of evidence, it meets the contract.
describe('the line at dusk', { timeout: 30_000 }, () => {
  test.prop([seedArb], { numRuns: 3 })('every soul can wait for the next day, and is fair under its rules', (seed) => {
    for (const d of content.days) {
      if (!content.days.some((x) => x.day === d.day + 1)) continue;
      const next = createDayContext(content, d.day + 1, seed);
      for (const c of generateDay(seed, createDayContext(content, d.day, seed)).cases) {
        const waited = dressForDay(c, next);
        expect(waited, `${c.id} on day ${d.day + 1}`).not.toBeNull();
        if (!waited) continue;
        expect(waited.id).toBe(c.id);
        expect(waited.evidence.look).toEqual(c.evidence.look);
        expect(waited.truth).toEqual(withLiars(c.truth, waited.lies, next));
        expect(waited.expect).toEqual(judge(waited.truth, next));
        const knobs = tierKnobs('widenBand', next.spec.queue.knobs);
        const v = validateCase(
          waited.evidence,
          waited.truth,
          waited.lies,
          waited.expect,
          waited.meta.decisive,
          next,
          knobs,
        );
        expect(v.ok, `${c.id} on day ${d.day + 1}`).toBe(true);
      }
    }
  });
});

// Whole days, twice a run, as the determinism checks.
describe('metamorphic', { timeout: 30_000 }, () => {
  test.prop([seedArb, dayArb, seedArb], { numRuns: 40 })(
    'changing only the cosmetic look never changes the judgment',
    (seed, day, lookSeed) => {
      const ctx = createDayContext(content, day, seed);
      generateDay(seed, ctx).cases.forEach((a, i) => {
        const b = generateCaseAt(seed, ctx, i, { lookSeed }).case;
        expect(b.truth).toEqual(a.truth);
        expect(b.expect).toEqual(a.expect);
        expect(b.meta.proof).toEqual(a.meta.proof);
        expect(b.lies.map(({ field, fact, claimed }) => [field, fact, claimed])).toEqual(
          a.lies.map(({ field, fact, claimed }) => [field, fact, claimed]),
        );
      });
    },
  );

  test.prop([seedArb, dayArb, fc.integer()], { numRuns: 40 })(
    'field order and decoy cues never change the solver',
    (seed, day, shuffleSeed) => {
      const ctx = createDayContext(content, day, seed);
      for (const c of generateDay(seed, ctx).cases) {
        const cx = soulCtx(ctx, c);
        const base = solve(c.evidence.fields, cx);
        const shuffled = solve(new Rng(`${shuffleSeed}`).shuffle(c.evidence.fields), cx);
        expect(shuffled.judgment).toEqual(base.judgment);
        expect(shuffled.contradictions.map((x) => x.lie).sort()).toEqual(base.contradictions.map((x) => x.lie).sort());
        if (day >= 3) {
          const decoy: Field = {
            id: 'cue.breathFog',
            item: 'body',
            view: 'front',
            salience: 2,
            cost: 0,
            cue: { key: 'breathFog' },
          };
          expect(solve([...c.evidence.fields, decoy], cx).judgment).toEqual(base.judgment);
        }
      }
    },
  );
});

const allDays = content.days.map((d) => d.day);

/** Generated souls for a day range, for adversarial edits, each with the rules it's judged by (a noon decree's after noon). */
function sample(days: number[], seeds: number) {
  const out: { c: CaseSpec; ctx: ReturnType<typeof createDayContext> }[] = [];
  for (const day of days) {
    for (let s = 0; s < seeds; s++) {
      const ctx = createDayContext(content, day, `adv-${s}`);
      for (const c of generateDay(`adv-${s}`, ctx).cases) out.push({ c, ctx: soulCtx(ctx, c) });
    }
  }
  return out;
}

describe('adversarial: the validator rejects broken souls', () => {
  const souls = sample(allDays, 12);

  it('removing any single field from the minimal proof leaves the soul undecidable', () => {
    let checked = 0;
    for (const { c, ctx } of souls) {
      for (const drop of c.meta.proof) {
        const fields = c.evidence.fields.filter((f) => c.meta.proof.includes(f.id) && f.id !== drop);
        const v = revalidate(c, ctx, fields);
        expect(v.ok ? 'ok' : v.code).toMatch(/^(UNDETERMINED|WRONG_DEST)$/);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  it('a soul that is secretly alive needs its breath-fog cue', () => {
    const alive = souls.filter(({ c }) => c.expect.dest === 'RETURN');
    expect(alive.length).toBeGreaterThan(5);
    for (const { c, ctx } of alive) {
      const v = revalidate(
        c,
        ctx,
        c.evidence.fields.filter((f) => f.id !== 'cue.breathFog'),
      );
      expect(v.ok ? 'ok' : v.code).toBe('CUE_MISSING');
    }
  });

  it('a body that misreports the truth is unsound', () => {
    for (const { c, ctx } of souls.slice(0, 40)) {
      const fields = c.evidence.fields.map((f) =>
        f.id === 'body.front.grip' && f.obs
          ? { ...f, obs: { ...f.obs, value: f.obs.value === 'weapon' ? 'none' : 'weapon' } }
          : f,
      );
      const v = revalidate(c, ctx, fields);
      expect(v.ok ? 'ok' : v.code).toBe('UNSOUND');
    }
  });

  it('a raven that lies is unsound', () => {
    for (const { c, ctx } of souls.slice(0, 40)) {
      const lie: Field = {
        id: 'huginn.9',
        item: 'huginn',
        salience: 3,
        cost: 2,
        says: { fact: 'grip', value: c.truth.grip === 'weapon' ? 'none' : 'weapon' },
      };
      const v = revalidate(c, ctx, [...c.evidence.fields, lie]);
      expect(v.ok ? 'ok' : v.code).toBe('UNSOUND');
    }
  });

  it('an outcome-changing lie with no contradiction is caught', () => {
    let checked = 0;
    for (const { c, ctx } of souls) {
      const lie = c.lies.find((l) => l.fact === 'cause' && c.truth.grip === 'weapon');
      const identity = c.evidence.fields.find((f) => f.item === 'testimony' && !f.says);
      if (!lie || !identity) continue;
      const fields = c.evidence.fields.filter((f) => f.id !== lie.field);
      const moved = { ...c, lies: c.lies.map((l) => (l === lie ? { ...l, field: identity.id } : l)) };
      const v = revalidate(moved, ctx, fields);
      // Where lying itself decides the hall (Day 16 on), a hidden lie makes the soul look honest, so the
      // solver's hall is wrong before the lie check runs. Either way the soul is rejected.
      expect(v.ok ? 'ok' : v.code).toBe(c.meta.decisive.includes('liar') ? 'WRONG_DEST' : 'HIDDEN_LIE');
      checked++;
    }
    expect(checked).toBeGreaterThan(3);
  });

  it('enforces effort, tool, visibility, document and content limits', () => {
    const withTool = souls.find(({ c }) => c.meta.proof.includes('tool.feather.breath'));
    const subtle = souls.find(({ c, ctx }) =>
      c.meta.proof.some((id) => (c.evidence.fields.find((f) => f.id === id)?.salience ?? 3) < 3 && ctx.day >= 1),
    );
    const any = souls[0];
    if (!withTool || !subtle || !any) throw new Error('sample too small');
    const check = (
      s: typeof any,
      knobs: Partial<ReturnType<typeof tierKnobs>>,
      look?: Partial<CaseSpec['evidence']['look']>,
    ) =>
      validateCase(
        { ...s.c.evidence, look: { ...s.c.evidence.look, ...look } },
        s.c.truth,
        s.c.lies,
        s.c.expect,
        s.c.meta.decisive,
        s.ctx,
        { ...tierKnobs(s.c.meta.tier, s.ctx.spec.queue.knobs), ...knobs },
      );
    const code = (v: ReturnType<typeof check>) => (v.ok ? 'ok' : v.code);
    expect(code(check(withTool, { proofCostS: [0, 0] }))).toBe('EFFORT_BAND');
    expect(code(check(withTool, { maxTools: 0 }))).toBe('TOO_MANY_TOOLS');
    expect(code(check(subtle, { salienceFloor: 3 }))).toBe('SALIENCE_FLOOR');
    expect(code(check(any, { maxDocs: 1 }))).toBe('TOO_MANY_DOCS');
    expect(code(check(any, {}, { age: 12 }))).toBe('CONTENT_RULE');
  });
});

describe('questioning', () => {
  const souls = sample(allDays, 8);

  it('every contradiction gets an answer that matches the planned response', () => {
    let answered = 0;
    for (const { c, ctx } of souls) {
      for (const x of solve(c.evidence.fields, ctx).contradictions) {
        const lie = c.lies.find((l) => l.field === x.lie);
        const r = questionResponse(c, x.lie, content);
        expect(r?.kind).toBe(lie?.onQuestion);
        expect(r?.lines.length).toBeGreaterThan(0);
        if (lie?.onQuestion === 'confess') expect(r?.reveals).toEqual([{ fact: lie.fact, value: lie.truth }]);
        answered++;
      }
    }
    expect(answered).toBeGreaterThan(50);
  });

  it('prefers the most specific template and is deterministic', () => {
    const braggart = souls.find(
      ({ c }) =>
        c.evidence.persona === 'braggart' &&
        c.lies.some(
          (l) => l.fact === 'cause' && l.onQuestion === 'confess' && ['sickness', 'oldAge'].includes(String(l.truth)),
        ),
    );
    if (!braggart) throw new Error('no confessing braggart in the sample');
    const lie = braggart.c.lies.find((l) => l.fact === 'cause') as CaseSpec['lies'][number];
    const r = questionResponse(braggart.c, lie.field, content);
    expect(r?.template).toBe('q.cause.braggart.confess');
    expect(questionResponse(braggart.c, lie.field, content)).toEqual(r);
  });
});
