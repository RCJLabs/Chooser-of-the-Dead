import { loadContent, loadDailyContent } from '@cots/testkit';
import { describe, expect, it } from 'vitest';
import { dailySeed } from '../calendar';
import type { Destination } from '../content/types';
import { createDayContext, type DayCtx, soulCtx } from '../logic/context';
import { judge } from '../logic/judge';
import { solve } from '../logic/solver';
import { questionResponse } from '../narrative/questions';
import {
  atDesk,
  crossFlagged,
  givenAtDesk,
  memberSoul,
  retractedOf,
  ruledOut,
  type ShiftAction,
  type ShiftEvent,
  type ShiftState,
  startShift,
  stepShift,
  turnedTo,
} from '../shift/shift';
import { traceShift } from '../shift/trace';
import { companionShows, factValue, memberField } from './companions';
import { dressForDay, generateDay } from './generate';
import { givenAt, linkParties, partyAt, partyOf } from './party';
import type { CaseSpec } from './types';
import { decisiveFacts, validateCase } from './validate';

/*
 * Linked souls (docs/tech-spec.md §69): parties formed from a day's finished line, what their members say of each
 * other, and a party at the desk.
 */

const full = loadContent('dev-full');
const daily = loadDailyContent();

interface Linked {
  readonly seed: string;
  readonly ctx: DayCtx;
  readonly plain: readonly CaseSpec[];
  readonly line: readonly CaseSpec[];
}

function linked(day: number, seed: string): Linked {
  const ctx = createDayContext(full, day, seed);
  const plain = generateDay(seed, ctx).cases;
  return { seed, ctx, plain, line: linkParties(plain, ctx, seed) };
}

/** Every party in a line: where it starts, and its members. */
function parties(line: readonly CaseSpec[]): { start: number; members: CaseSpec[] }[] {
  const out: { start: number; members: CaseSpec[] }[] = [];
  line.forEach((_, i) => {
    const span = partyAt(line, i);
    if (span) out.push({ start: i, members: line.slice(i, i + span.size) as CaseSpec[] });
  });
  return out;
}

/** The first line (days `days`, seeds from 0) with a party that `want` accepts. */
function findParty(
  days: readonly number[],
  want: (members: readonly CaseSpec[], ctx: DayCtx) => boolean,
): Linked & { start: number; members: CaseSpec[] } {
  for (let s = 0; s < 200; s++) {
    for (const day of days) {
      const l = linked(day, `party-test-${s}`);
      const p = parties(l.line).find((x) => want(x.members, l.ctx));
      if (p) return { ...l, ...p };
    }
  }
  throw new Error('no such party in 200 seeds');
}

/** The fields of a soul's minimal proof. */
const proofFields = (c: CaseSpec) => c.evidence.fields.filter((f) => c.meta.proof.includes(f.id));

/** Applies actions in order; fails on any rejection unless allowed. */
function run(state: ShiftState, ctx: DayCtx, actions: readonly ShiftAction[], allowRejects = false) {
  const events: ShiftEvent[] = [];
  let s = state;
  for (const a of actions) {
    const r = stepShift(s, a, ctx);
    const bad = r.events.find((e) => e.e === 'rejected');
    if (bad && !allowRejects) throw new Error(`${a.t} rejected: ${bad.e === 'rejected' ? bad.reason : ''}`);
    s = r.state;
    events.push(...r.events);
  }
  return { state: s, events };
}

/** A soul judged as it should be, with what must be done to it first (long nails clipped), and sent on. */
function judged(c: CaseSpec, cx: DayCtx): ShiftAction[] {
  return [
    ...(c.expect.procedures ?? []).flatMap((id) => {
      const tool = cx.procedures.find((x) => x.id === id)?.tool;
      return tool ? [{ t: 'tool' as const, tool, at: 1 }] : [];
    }),
    { t: 'stamp', dest: c.expect.dest, at: 1 },
    { t: 'send', at: 1 },
  ];
}

/** A shift over `line` whose first soul is the party at `start`: the souls before it judged as they should be. */
function atParty(l: Linked, start: number) {
  const { state, ctx } = startShift(
    full,
    { mode: 'practice', seed: l.seed, day: l.ctx.day, untimed: true },
    l.line,
    l.ctx,
  );
  // Each soul before it stamped and sent on, a party's members in turn.
  const before: ShiftAction[] = [{ t: 'begin', at: 0 }];
  for (const c of l.line.slice(0, start)) before.push(...judged(c, soulCtx(l.ctx, c)));
  return { ...run(state, ctx, before), ctx };
}

describe('forming parties', () => {
  it('leaves a day with no parties in its spec, and the Daily, exactly as they were', () => {
    const early = linked(8, 'plain');
    expect(early.line).toBe(early.plain);
    const spec = daily.daily;
    if (!spec) throw new Error('no Daily');
    const ctx = createDayContext(daily, spec.day, dailySeed(1), spec);
    const cases = generateDay(dailySeed(1), ctx).cases;
    expect(linkParties(cases, ctx, dailySeed(1))).toBe(cases);
  });

  it('makes a party of 2 or 3 souls of a kind standing together, never at the head of the line, each saying something of another', () => {
    let seen = 0;
    for (let s = 0; s < 12; s++) {
      for (const day of [9, 12, 16, 19, 20]) {
        const l = linked(day, `form-${s}`);
        // The same souls in the same order; those in no party are untouched.
        expect(l.line.map((c) => c.id)).toEqual(l.plain.map((c) => c.id));
        for (const c of l.line) if (!c.party) expect(c).toBe(l.plain.find((p) => p.id === c.id));
        for (const p of parties(l.line)) {
          seen++;
          expect(p.start).toBeGreaterThan(0);
          expect(p.members.length).toBeGreaterThanOrEqual(2);
          expect(p.members.length).toBeLessThanOrEqual(3);
          const kind = full.parties?.kinds.find((k) => k.id === p.members[0]?.party?.kind);
          expect(kind).toBeDefined();
          const names = new Set(p.members.map((m) => m.evidence.look.name));
          expect(names.size).toBe(p.members.length);
          p.members.forEach((m, k) => {
            expect(m.party?.index).toBe(k);
            expect(m.party?.id).toBe(p.members[0]?.party?.id);
            expect(m.noon === true).toBe(p.members[0]?.noon === true);
            expect(m.script).toBeUndefined();
            for (const [fact, rule] of Object.entries(kind?.members ?? {})) {
              const v = factValue(m.truth, fact, soulCtx(l.ctx, m));
              expect('is' in rule ? v === rule.is : 'in' in rule ? rule.in.includes(v as never) : true).toBe(true);
            }
            const said = m.evidence.fields.filter((f) => f.about);
            expect(said.length).toBeLessThanOrEqual(1);
            // Each of the next; in a retinue (docs/tech-spec.md §70), the jarl of his first man, and each man of him.
            const lord = m.party?.lord;
            const of = lord ? (k === lord.at ? 1 : lord.at) : (k + 1) % p.members.length;
            for (const f of said) expect(f.about?.soul).toBe(of);
          });
          // A fight or a crew always says something; a retinue is one for its oath, whatever it says.
          if (!p.members[0]?.party?.lord)
            expect(p.members.some((m) => m.evidence.fields.some((f) => f.about))).toBe(true);
        }
      }
    }
    expect(seen).toBeGreaterThan(40);
  }, 60_000);

  it('makes what a member says true, or a lie the companion shows false; and every member passes F1-F8', () => {
    let lies = 0;
    let truths = 0;
    for (let s = 0; s < 10; s++) {
      for (const day of [9, 11, 14, 16, 17, 20]) {
        const l = linked(day, `fair-${s}`);
        for (const p of parties(l.line)) {
          const companions = new Map(p.members.map((c, k) => [k, { case: c, ctx: soulCtx(l.ctx, c) }]));
          for (const [k, m] of p.members.entries()) {
            const cx = soulCtx(l.ctx, m);
            for (const f of m.evidence.fields) {
              if (!f.about) continue;
              const mate = p.members[f.about.soul] as CaseSpec;
              const lie = m.lies.find((x) => x.field === f.id);
              const shown = companionShows(mate.evidence.fields, f.about.fact, f.about.value, cx);
              if (lie) {
                lies++;
                expect(lie.about).toBe(f.about.soul);
                expect(lie.reveals).toEqual([]);
                expect(shown).not.toBeNull();
              } else {
                truths++;
                expect(factValue(mate.truth, f.about.fact, cx)).toBe(f.about.value);
                expect(shown).toBeNull();
              }
            }
            const v = validateCase(
              m.evidence,
              m.truth,
              m.lies,
              m.expect,
              decisiveFacts(m.truth, m.expect, cx),
              cx,
              { ...cx.spec.queue.knobs, proofCostS: [0, 999], salienceFloor: 1 },
              companions,
              givenAt(l.line, p.start + k, l.ctx),
            );
            expect(v.ok ? 'ok' : `${v.code}: ${v.detail}`).toBe('ok');
            expect(judge(m.truth, cx)).toEqual(m.expect);
          }
        }
      }
    }
    expect(lies).toBeGreaterThan(10);
    expect(truths).toBeGreaterThan(10);
  }, 60_000);

  it('from Day 16, a lie about a companion makes the soul a liar, which can decide its hall', () => {
    const p = findParty([16, 17, 18], (members) =>
      members.some((m) => m.lies.length > 0 && m.lies.every((x) => x.about !== undefined) && m.meta.crossProof),
    );
    const m = p.members.find((x) => x.meta.crossProof) as CaseSpec;
    const cx = soulCtx(p.ctx, m);
    expect(m.truth.liar).toBe(true);
    expect(m.expect.rule).toBe('rule.liars');
    // Alone, nothing the soul shows of itself catches it: it takes the companion's evidence.
    const alone = solve(m.evidence.fields, cx).judgment;
    expect(alone.kind === 'determined' && alone.dest === m.expect.dest).toBe(false);
    for (const x of m.meta.crossProof ?? []) {
      expect(p.members[x.soul]?.evidence.fields.some((f) => f.id === x.field)).toBe(true);
    }
  }, 60_000);

  it("never moves a soul out of a hall the day's requests count on", () => {
    const halls: ReadonlySet<Destination> = new Set(['VALHALLA', 'FOLKVANGR']);
    for (let s = 0; s < 20; s++) {
      for (const day of [16, 17, 18, 19]) {
        const ctx = createDayContext(full, day, `keep-${s}`);
        const plain = generateDay(`keep-${s}`, ctx).cases;
        const line = linkParties(plain, ctx, `keep-${s}`, { keepHalls: halls });
        for (const c of line) {
          const was = plain.find((x) => x.id === c.id) as CaseSpec;
          if (halls.has(was.expect.dest)) expect(c.expect.dest).toBe(was.expect.dest);
        }
      }
    }
  }, 60_000);

  it('finds a party wherever a soul of it stands', () => {
    const p = findParty([9], (members) => members.length === 3);
    for (let k = 0; k < 3; k++) expect(partyOf(p.line, p.start + k)).toEqual({ start: p.start, size: 3 });
    expect(partyAt(p.line, p.start + 1)).toBeNull();
  }, 60_000);
});

describe('a party at the desk', () => {
  const withLie = () =>
    findParty([9, 10, 11], (members) =>
      members.some((m) => m.lies.some((x) => x.about !== undefined && x.onQuestion === 'confess')),
    );

  it('stands at the desk together: turn between them, each with its own state', () => {
    const p = withLie();
    const { state, ctx } = atParty(p, p.start);
    expect(state.party?.start).toBe(p.start);
    expect(atDesk(state).map((c) => c.id)).toEqual(p.members.map((c) => c.id));
    expect(turnedTo(state)).toBe(0);
    const a = run(state, ctx, [
      { t: 'inspect', fields: ['body.front.grip'], at: 2 },
      { t: 'turn', to: 1, at: 3 },
    ]);
    expect(a.state.cursor).toBe(p.start + 1);
    expect(a.state.soul.seen).toEqual([]);
    expect(memberSoul(a.state, 0)?.seen).toEqual(['body.front.grip']);
    expect(a.events).toContainEqual({ e: 'turned', to: 1 });
    const back = run(a.state, ctx, [{ t: 'turn', to: 0, at: 4 }]);
    expect(back.state.soul.seen).toEqual(['body.front.grip']);
    expect(run(state, ctx, [{ t: 'turn', to: 5, at: 2 }], true).events).toContainEqual({
      e: 'rejected',
      reason: 'no such soul here',
    });
  }, 60_000);

  it('catches a lie about a companion with a Compare across them, and marks it on the one who told it', () => {
    const p = withLie();
    const k = p.members.findIndex((m) => m.lies.some((x) => x.about !== undefined && x.onQuestion === 'confess'));
    const m = p.members[k] as CaseSpec;
    const lie = m.lies.find((x) => x.about !== undefined && x.onQuestion === 'confess');
    if (!lie || lie.about === undefined) throw new Error('no lie');
    const mate = p.members[lie.about] as CaseSpec;
    const claim = m.evidence.fields.find((f) => f.id === lie.field);
    if (!claim?.about) throw new Error('no claim');
    const shows = companionShows(mate.evidence.fields, claim.about.fact, claim.about.value, soulCtx(p.ctx, mate));
    const field = mate.evidence.fields.find((f) => f.id === shows?.[0]);
    if (!field) throw new Error('nothing shows it');
    const { state, ctx } = atParty(p, p.start);
    const look = run(state, ctx, [
      { t: 'turn', to: lie.about, at: 2 },
      ...(field.view === 'back' ? [{ t: 'flip' as const, at: 2 }] : []),
      ...(field.tool && field.tool !== 'flip' ? [{ t: 'tool' as const, tool: field.tool, at: 2 }] : []),
      { t: 'inspect', fields: [field.id], at: 2 },
      { t: 'turn', to: k, at: 3 },
      { t: 'inspect', fields: [lie.field], at: 3 },
    ]);
    // Something of the companion's that shows nothing: no lie caught, and the sun pays for it.
    const other = mate.evidence.fields.find((f) => f.item === 'body' && f.view === 'front' && f.id !== field.id);
    if (other) {
      const miss = run(look.state, ctx, [
        { t: 'turn', to: lie.about, at: 4 },
        { t: 'inspect', fields: [other.id], at: 4 },
        { t: 'turn', to: k, at: 4 },
        { t: 'compare', a: lie.field, b: memberField(lie.about, other.id), at: 4 },
      ]);
      expect(miss.events.some((e) => e.e === 'noConflict')).toBe(true);
    }
    // From the companion's side, naming the claim: caught, and marked on the soul who told it.
    const fromMate = run(look.state, ctx, [
      { t: 'turn', to: lie.about, at: 5 },
      { t: 'compare', a: field.id, b: memberField(k, lie.field), at: 5 },
    ]);
    expect(fromMate.events).toContainEqual({
      e: 'contradiction',
      lie: lie.field,
      fact: lie.fact,
      with: memberField(lie.about, field.id),
      member: k,
    });
    expect(memberSoul(fromMate.state, k)?.flagged.map((f) => f.lie)).toEqual([lie.field]);
    expect(crossFlagged(memberSoul(fromMate.state, k) ?? fromMate.state.soul).get(lie.field)).toEqual([
      memberField(lie.about, field.id),
    ]);
    // Questioned, it owns up, naming the companion; it reveals nothing about itself.
    const asked = run(fromMate.state, ctx, [
      { t: 'turn', to: k, at: 6 },
      { t: 'question', lie: lie.field, at: 6 },
    ]);
    const answer = asked.events.find((e) => e.e === 'answer');
    expect(answer?.e === 'answer' && answer.response.reveals).toEqual([]);
    expect(answer?.e === 'answer' && answer.response.lines[0]?.params.companion).toBe(mate.evidence.look.name);
    expect(questionResponse(m, lie.field, full)?.template.startsWith('q.party.')).toBe(true);
  }, 60_000);

  it('sends the party together once every member is stamped, and traces each', () => {
    const p = withLie();
    const { state, ctx } = atParty(p, p.start);
    // Each stamped as it should be, with what must be done to it first (long nails clipped).
    const stampAll: ShiftAction[] = p.members.flatMap((m, k) => [
      { t: 'turn' as const, to: k, at: 7 },
      ...(m.expect.procedures ?? []).flatMap((id) => {
        const tool = soulCtx(p.ctx, m).procedures.find((x) => x.id === id)?.tool;
        return tool ? [{ t: 'tool' as const, tool, at: 7 }] : [];
      }),
      { t: 'stamp' as const, dest: m.expect.dest, at: 7 },
    ]);
    // Sending one while another has no stamp goes on to it, and sends nobody.
    const first = p.members[0] as CaseSpec;
    const early = run(state, ctx, [...judged(first, soulCtx(p.ctx, first))]);
    expect(early.events).toContainEqual({ e: 'turned', to: 1, next: true });
    expect(early.state.verdicts.length).toBe(p.start);
    expect(run(state, ctx, [{ t: 'send', at: 7 }], true).events).toContainEqual({
      e: 'rejected',
      reason: 'choose a stamp first',
    });
    const sent = run(state, ctx, [...stampAll, { t: 'send', at: 8 }]);
    const verdicts = sent.events.flatMap((e) => (e.e === 'judged' ? [e.verdict] : []));
    expect(verdicts.map((v) => v.index)).toEqual(p.members.map((_, k) => p.start + k));
    expect(verdicts.every((v) => v.correct)).toBe(true);
    expect(sent.state.verdicts.length).toBe(p.start + p.members.length);
    expect(sent.state.cursor).toBe(p.start + p.members.length);
    expect(sent.state.party?.start ?? p.start + p.members.length).not.toBe(p.start);
    const actions: ShiftAction[] = [{ t: 'begin', at: 0 }];
    for (const c of p.line.slice(0, p.start)) actions.push(...judged(c, soulCtx(p.ctx, c)));
    const initial = startShift(full, { mode: 'practice', seed: p.seed, day: p.ctx.day, untimed: true }, p.line, p.ctx);
    const traced = traceShift(initial.state, [...actions, ...stampAll, { t: 'send', at: 8 }], ctx);
    for (let k = 0; k < p.members.length; k++) {
      expect(traced.souls[p.start + k]?.verdict?.index).toBe(p.start + k);
    }
  }, 60_000);

  it('from Day 16, a lie about a companion, caught at the desk, decides the soul who told it', () => {
    const p = findParty([16, 17, 18], (members) =>
      members.some((m) => m.lies.length > 0 && m.lies.every((x) => x.about !== undefined) && m.meta.crossProof),
    );
    const k = p.members.findIndex((m) => m.meta.crossProof);
    const m = p.members[k] as CaseSpec;
    const lie = m.lies[0];
    const x = m.meta.crossProof?.[0];
    if (!lie || lie.about === undefined || !x) throw new Error('no lie');
    const field = p.members[x.soul]?.evidence.fields.find((f) => f.id === x.field);
    if (!field) throw new Error('no field');
    const { state, ctx } = atParty(p, p.start);
    const caught = run(state, ctx, [
      { t: 'turn', to: x.soul, at: 2 },
      ...(field.view === 'back' ? [{ t: 'flip' as const, at: 2 }] : []),
      ...(field.tool && field.tool !== 'flip' ? [{ t: 'tool' as const, tool: field.tool, at: 2 }] : []),
      { t: 'inspect', fields: [x.field], at: 2 },
      { t: 'turn', to: k, at: 3 },
      // Everything the soul's proof needs: turned over, and read with its tools, where that's where it is.
      ...(proofFields(m).some((f) => f.view === 'back') ? [{ t: 'flip' as const, at: 3 }] : []),
      ...[...new Set(proofFields(m).flatMap((f) => (f.tool && f.tool !== 'flip' ? [f.tool] : [])))].map((tool) => ({
        t: 'tool' as const,
        tool,
        at: 3,
      })),
      { t: 'inspect', fields: m.meta.proof, at: 3 },
      { t: 'compare', a: lie.field, b: memberField(x.soul, x.field), at: 3 },
    ]);
    expect(caught.state.soul.flagged.map((f) => f.lie)).toContain(lie.field);
    // What the desk has seen of the soul decides it once the lie is caught, and not before.
    const cx = soulCtx(ctx, m);
    const seen = m.evidence.fields.filter((f) => caught.state.soul.seen.includes(f.id));
    const decided = (crossCaught: ReadonlyMap<string, readonly string[]>) => {
      const j = solve(seen, cx, { crossCaught, retracted: retractedOf(m, caught.state.soul) }).judgment;
      return j.kind === 'determined' && j.dest === m.expect.dest;
    };
    expect(decided(crossFlagged(caught.state.soul))).toBe(true);
    expect(decided(new Map())).toBe(false);
    // The rule tracker never rules out the rule that applies.
    expect(ruledOut(caught.state, ctx)).not.toContain(m.expect.rule);
  }, 60_000);

  it('at dusk, a party at the desk goes unjudged, every member', () => {
    const p = withLie();
    const { state, ctx } = startShift(full, { mode: 'practice', seed: p.seed, day: p.ctx.day }, p.line, p.ctx);
    const before: ShiftAction[] = [{ t: 'begin', at: 0 }];
    for (const c of p.line.slice(0, p.start)) before.push(...judged(c, soulCtx(p.ctx, c)));
    const at = run(state, ctx, before);
    const late = run(at.state, ctx, [{ t: 'tick', at: at.state.sunMs + 10 * 60_000 }]);
    expect(late.state.phase).toBe('done');
    expect(late.state.party).toBeUndefined();
    for (let k = 0; k < p.members.length; k++) expect(late.state.verdicts[p.start + k]?.stamped).toBeNull();
  }, 60_000);
});

describe('a retinue (docs/tech-spec.md §70)', () => {
  const follows = (c: CaseSpec) => c.expect.rule === 'rule.retinue';
  /** A retinue with a man who goes where his jarl goes, to a hall his own evidence wouldn't send him. */
  const moved = () =>
    findParty([9, 10, 11, 12], (members, ctx) => {
      if (!members[0]?.party?.lord) return false;
      return members.slice(1).some((m) => {
        const own = judge({ ...m.truth, lordHall: 'none' }, soulCtx(ctx, m));
        return follows(m) && own.dest !== m.expect.dest;
      });
    });

  it('comes on the day its rule is new: its jarl first, his men sworn to the hall he is bound for', () => {
    let days = 0;
    let led = 0;
    for (let s = 0; s < 12; s++) {
      const l = linked(9, `retinue-${s}`);
      days++;
      if (parties(l.line).some((x) => x.members[0]?.party?.lord)) led++;
      for (const p of parties(l.line)) {
        const lord = p.members[0]?.party?.lord;
        if (!lord) continue;
        const jarl = p.members[lord.at] as CaseSpec;
        expect(['VALHALLA', 'FOLKVANGR', 'HEL']).toContain(jarl.expect.dest);
        expect(jarl.truth.lordHall).toBe('none');
        for (const [k, m] of p.members.entries()) {
          if (k === lord.at) continue;
          expect(m.truth.lordHall).toBe(jarl.expect.dest);
          // A man who stood fast, and whom no earlier rule claims, goes where his jarl goes; one who fled doesn't.
          if (m.truth.fled === true) expect(follows(m)).toBe(false);
          if (follows(m)) expect(m.expect.dest).toBe(jarl.expect.dest);
        }
      }
    }
    // The day leads with one wherever its souls allow.
    expect(led).toBeGreaterThanOrEqual(days - 2);
  }, 60_000);

  it('leaves every other soul sworn to no one: the rule never holds for them', () => {
    const l = linked(12, 'retinue-others');
    for (const c of l.line) {
      if (c.party?.lord && c.party.index !== c.party.lord.at) continue;
      expect(c.truth.lordHall).toBe('none');
      expect(follows(c)).toBe(false);
      const j = solve(c.evidence.fields, soulCtx(l.ctx, c), { reveals: new Map() });
      expect(j.rules.find((r) => r.rule === 'rule.retinue')?.result).toBe('F');
    }
  }, 60_000);

  it('at the desk, a sworn man is decided only once his jarl is, and then goes where he goes', () => {
    const p = moved();
    const k = p.members.findIndex((m, i) => i > 0 && follows(m));
    const man = p.members[k] as CaseSpec;
    const jarl = p.members[0] as CaseSpec;
    const { state, ctx } = atParty(p, p.start);
    // The man looked over, the jarl not yet: sworn, to a hall not yet known.
    const looked = run(state, ctx, [
      { t: 'turn', to: k, at: 2 },
      ...(man.evidence.fields.some((f) => f.view === 'back') ? [{ t: 'flip' as const, at: 2 }] : []),
      { t: 'inspect', fields: man.meta.proof, at: 2 },
    ]).state;
    const cx = soulCtx(ctx, man);
    const seenOf = (st: ShiftState) => man.evidence.fields.filter((f) => st.soul.seen.includes(f.id));
    const before = givenAtDesk(looked, k, ctx);
    expect(before?.[0]?.values.length).toBeGreaterThan(1);
    const open = solve(seenOf(looked), cx, { ...(before ? { given: before } : {}) }).judgment;
    expect(open).toMatchObject({ kind: 'undetermined', rule: 'rule.retinue', blocking: ['lordHall'] });
    expect(ruledOut(looked, ctx)).not.toContain('rule.retinue');
    // The jarl judged from his own evidence (his claims caught against his men's): the man goes with him.
    const jcx = soulCtx(ctx, jarl);
    const judgedJarl = run(looked, ctx, [
      { t: 'turn', to: 0, at: 3 },
      ...(jarl.evidence.fields.some((f) => f.view === 'back') ? [{ t: 'flip' as const, at: 3 }] : []),
      ...[...new Set(jarl.evidence.fields.flatMap((f) => (f.tool && f.tool !== 'flip' ? [f.tool] : [])))]
        .filter((tool) => jcx.tools.has(tool))
        .map((tool) => ({ t: 'tool' as const, tool, at: 3 })),
      { t: 'inspect', fields: jarl.evidence.fields.map((f) => f.id), at: 3 },
      { t: 'turn', to: k, at: 3 },
    ]).state;
    const after = givenAtDesk(judgedJarl, k, ctx);
    if (!jarl.meta.crossProof) {
      expect(after?.[0]?.values).toEqual([jarl.expect.dest]);
      const j = solve(seenOf(judgedJarl), cx, { ...(after ? { given: after } : {}) }).judgment;
      expect(j).toMatchObject({ kind: 'determined', dest: man.expect.dest, rule: 'rule.retinue' });
    }
    // His citation, stamped where his own evidence would send him, names the jarl's proof.
    const own = judge({ ...man.truth, lordHall: 'none' }, cx).dest;
    const sent = run(judgedJarl, ctx, [
      { t: 'stamp', dest: own, at: 4 },
      { t: 'turn', to: 0, at: 4 },
      { t: 'stamp', dest: jarl.expect.dest, at: 4 },
      ...p.members.flatMap((m, i) =>
        i === 0 || i === k
          ? []
          : [
              { t: 'turn' as const, to: i, at: 4 },
              { t: 'stamp' as const, dest: m.expect.dest, at: 4 },
            ],
      ),
      { t: 'send', at: 4 },
    ]);
    const v = sent.state.verdicts[p.start + k];
    expect(v).toMatchObject({ correct: false, expected: man.expect.dest, rule: 'rule.retinue' });
    expect(man.meta.crossProof?.some((x) => x.soul === 0)).toBe(true);
  }, 60_000);

  it('a hearth-man who waits for tomorrow comes alone, and is judged on his own', () => {
    const p = moved();
    const man = p.members.find((m, i) => i > 0 && follows(m)) as CaseSpec;
    const next = createDayContext(full, p.ctx.day + 1, p.seed);
    const alone = dressForDay(man, next);
    expect(alone).not.toBeNull();
    expect(alone?.party).toBeUndefined();
    expect(alone?.truth.lordHall).toBe('none');
    expect(alone?.expect.rule).not.toBe('rule.retinue');
  }, 60_000);

  it('from Day 16, a jarl caught lying about one of his men goes to Hel, and his men with him', () => {
    const p = findParty([16, 17, 18, 19, 20], (members, ctx) => {
      const jarl = members[0];
      if (!jarl?.party?.lord || jarl.expect.rule !== 'rule.liars') return false;
      return members.slice(1).some((m) => follows(m) && m.expect.dest === 'HEL') && soulCtx(ctx, jarl).day >= 16;
    });
    const jarl = p.members[0] as CaseSpec;
    expect(jarl.lies.some((x) => x.about !== undefined)).toBe(true);
    expect(jarl.meta.crossProof?.length).toBeGreaterThan(0);
    for (const m of p.members.slice(1)) if (follows(m)) expect(m.expect.dest).toBe('HEL');
  }, 120_000);
});
