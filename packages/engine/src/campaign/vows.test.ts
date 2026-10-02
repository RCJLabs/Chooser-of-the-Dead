import { catchLie, loadContent, proveSoul } from '@cots/testkit';
import { describe, expect, it } from 'vitest';
import { FACTIONS, type VowKind } from '../content/types';
import type { DayCtx } from '../logic/context';
import { stepShift } from '../shift/shift';
import { campaignOf, campaignQueue, defaultBills, newRun, type RunAction, stepRun } from './run';
import { runContext } from './save';
import { factionsMet, type RunState } from './state';
import { vowBroken, vowOf, vowOffer } from './vows';

/*
 * Vows at the cup (docs/tech-spec.md §75): a vow sworn at night for the next day, settled at that day's audit. Kept,
 * it pays its rings; broken, it costs Odin's standing.
 */

const full = loadContent('dev-full');
const demo = loadContent('web-demo');
const vows = campaignOf(full).vows;
if (!vows) throw new Error('The full game has no vows');
const vowId = (kind: VowKind) => vows.list.find((v) => v.kind === kind)?.id ?? '';

/** The run at night on `day`, as if every day before had gone by. */
const nightOf = (day: number, opts: Parameters<typeof newRun>[2] = {}): RunState => {
  const run = newRun(full, 'vows', opts);
  return { ...run, day, phase: 'night', bills: defaultBills(run) };
};

/** Steps a run through actions, failing on rejections, the shift's among them. */
function drive(run0: RunState, actions: readonly RunAction[]): RunState {
  let run = run0;
  let ctx: DayCtx = runContext(full, run);
  for (const a of actions) {
    const r = stepRun(run, a, { content: full, ctx });
    for (const e of r.events) {
      const bad = e.e === 'shift' ? e.event : e;
      if (bad.e === 'rejected') throw new Error(`${a.t === 'shift' ? a.action.t : a.t} rejected: ${bad.reason}`);
    }
    if (r.state.day !== run.day) ctx = runContext(full, r.state);
    run = r.state;
  }
  return run;
}

/**
 * Day DAY's shift played to its audit with vow `vow` sworn: every soul judged rightly, carefully (each liar caught and
 * each proof looked at) unless `careless`, at a soul a second; with one soul stamped wrong, a question asked, a hint
 * asked, or the last soul sent with `lateMs` of sun used, if asked.
 */
const DAY = 6;
function dayWith(
  vow: string,
  opts: { careless?: boolean; wrong?: boolean; question?: boolean; hint?: boolean; lateMs?: number } = {},
) {
  const base: RunState = { ...newRun(full, 'vows'), day: DAY, vow };
  const ctx = runContext(full, base);
  const queue = campaignQueue(base, { content: full, ctx });
  const actions: RunAction[] = [{ t: 'beginShift', at: 0 }];
  let asked = false;
  queue.forEach((c, i) => {
    const at = i === queue.length - 1 && opts.lateMs !== undefined ? opts.lateMs : (i + 1) * 1000;
    // One hint, before the first soul is looked at; one question, of the first liar caught.
    if (opts.hint && i === 0) actions.push({ t: 'shift', action: { t: 'hint', at } });
    const caught = opts.careless ? [] : catchLie(c, ctx, at);
    const proof = opts.careless ? [] : proveSoul([c], 0, ctx, at, caught);
    for (const action of [...caught, ...proof]) actions.push({ t: 'shift', action });
    const flagged = caught.find((a) => a.t === 'compare');
    if (opts.question && !asked && flagged?.t === 'compare') {
      actions.push({ t: 'shift', action: { t: 'question', lie: flagged.a, at } });
      asked = true;
    }
    const wrong = opts.wrong === true && i === 0;
    for (const id of wrong ? [] : (c.expect.procedures ?? [])) {
      const tool = ctx.procedures.find((p) => p.id === id)?.tool;
      if (tool) actions.push({ t: 'shift', action: { t: 'tool', tool, at } });
    }
    const dest = wrong ? (c.expect.dest === 'HEL' ? 'VALHALLA' : 'HEL') : c.expect.dest;
    actions.push({ t: 'shift', action: { t: 'stamp', dest, at } }, { t: 'shift', action: { t: 'send', at } });
  });
  if (opts.question && !asked) throw new Error('no liar to question');
  const run = drive(base, actions);
  return { base, run, ledger: run.ledger.at(-1) };
}

describe('vows at the cup (docs/tech-spec.md §75)', () => {
  it('offers three a night from Night 3, drawn for the run and the day, in the campaign’s order', () => {
    expect(vowOffer(nightOf(2), full)).toEqual([]);
    const offer = vowOffer(nightOf(3), full);
    expect(offer).toHaveLength(vows.offered);
    // In the campaign's order, and the same however often it's asked.
    const order = vows.list.map((v) => v.id);
    expect(offer.map((v) => order.indexOf(v.id))).toEqual(
      [...offer.map((v) => order.indexOf(v.id))].sort((a, b) => a - b),
    );
    expect(vowOffer(nightOf(3), full)).toEqual(offer);
    // Another night draws its own: over a run, every vow comes up.
    const seen = new Set<string>();
    for (let day = 3; day < campaignOf(full).lastDay; day++)
      for (const v of vowOffer(nightOf(day), full)) seen.add(v.id);
    expect([...seen].sort()).toEqual([...order].sort());
  });

  it('offers none in Story Mode, outside the night, on the last night, or in the demo; under the oath, never the vow of no help', () => {
    expect(vowOffer(nightOf(5, { story: true }), full)).toEqual([]);
    expect(vowOffer({ ...nightOf(5), phase: 'morning' }, full)).toEqual([]);
    expect(vowOffer(nightOf(campaignOf(full).lastDay), full)).toEqual([]);
    expect(vowOffer({ ...newRun(demo, 'vows'), day: 2, phase: 'night' }, demo)).toEqual([]);
    for (let day = 3; day < campaignOf(full).lastDay; day++) {
      expect(vowOffer(nightOf(day, { oath: true }), full).map((v) => v.kind)).not.toContain('alone');
    }
  });

  it('is sworn at night from the offer, can be taken back, and is the next day’s vow', () => {
    const night = nightOf(5);
    const [first, second] = vowOffer(night, full);
    if (!first || !second) throw new Error('no offer');
    const sworn = drive(night, [
      { t: 'vow', id: first.id },
      { t: 'vow', id: second.id },
    ]);
    expect(sworn.vow).toBe(second.id);
    expect(drive(sworn, [{ t: 'vow', id: null }]).vow).toBeUndefined();
    const notOffered = vows.list.find((v) => !vowOffer(night, full).some((o) => o.id === v.id));
    if (notOffered) {
      const r = stepRun(night, { t: 'vow', id: notOffered.id }, { content: full, ctx: runContext(full, night) });
      expect(r.events).toEqual([{ e: 'rejected', reason: 'no such vow tonight' }]);
    }
    const morning = stepRun(night, { t: 'vow', id: first.id }, { content: full, ctx: runContext(full, night) }).state;
    expect(morning.vow).toBe(first.id);
    // Only at night.
    const day = { ...morning, phase: 'morning' as const };
    expect(stepRun(day, { t: 'vow', id: first.id }, { content: full, ctx: runContext(full, day) }).events).toEqual([
      { e: 'rejected', reason: 'vows are sworn at night' },
    ]);
    // The night ends, and the morning still holds it.
    const next = drive(morning, [{ t: 'endNight' }]);
    expect(next).toMatchObject({ phase: 'morning', day: 6, vow: first.id });
    expect(vowOf(next, full)?.id).toBe(first.id);
  });

  it('pays its rings, kept, and moves no standing; broken, it pays nothing and costs Odin, and it’s done with', () => {
    const clean = vowId('clean');
    const kept = dayWith(clean);
    const rings = vows.list.find((v) => v.id === clean)?.rings ?? 0;
    expect(kept.ledger?.vow).toEqual({ id: clean, kept: true, rings, standing: {} });
    const l = kept.ledger;
    if (!l) throw new Error('no audit');
    expect(kept.run.rings - kept.base.rings).toBe(l.pay + l.bonus - l.fines + (l.nails ?? 0) + rings);
    expect(kept.run.standing).toEqual(kept.base.standing);
    expect(kept.run.vow).toBeUndefined();
    const broken = dayWith(clean, { wrong: true });
    expect(broken.ledger?.vow).toEqual({ id: clean, kept: false, rings: 0, standing: vows.broken });
    expect(broken.run.vow).toBeUndefined();
    // Standing is every audit's columns added up, the vow's among them.
    for (const f of FACTIONS) {
      const ledger = broken.ledger;
      const sum = (ledger?.standing[f] ?? 0) + (ledger?.vow?.standing[f] ?? 0);
      expect(broken.run.standing[f] - broken.base.standing[f], f).toBe(sum);
    }
    expect(factionsMet(broken.run)).toContain('odin');
    // A day with no vow sworn has none to settle.
    expect(dayWith('').ledger?.vow).toBeUndefined();
  });

  it('is kept or broken by what the day asked of it', () => {
    const settled = (kind: VowKind, opts: Parameters<typeof dayWith>[1] = {}) =>
      dayWith(vowId(kind), opts).ledger?.vow?.kept;
    expect([settled('clean'), settled('clean', { wrong: true })]).toEqual([true, false]);
    expect([settled('liars'), settled('liars', { careless: true })]).toEqual([true, false]);
    expect([settled('proven'), settled('proven', { careless: true })]).toEqual([true, false]);
    expect([settled('silent'), settled('silent', { question: true })]).toEqual([true, false]);
    expect([settled('alone'), settled('alone', { hint: true })]).toEqual([true, false]);
    // The sun's: the last soul sent with a quarter of the sun still up, or not.
    const sun = vows.list.find((v) => v.kind === 'sun');
    const shift = dayWith(vowId('sun')).run.shift;
    if (!sun?.spare || !shift) throw new Error('no sun vow');
    const late = Math.floor((shift.sunMs * (100 - sun.spare + 5)) / 100);
    expect([settled('sun'), settled('sun', { lateMs: late })]).toEqual([true, false]);
  });

  it('says when it’s broken already, before the audit', () => {
    const silent = vows.list.find((v) => v.kind === 'silent');
    const alone = vows.list.find((v) => v.kind === 'alone');
    if (!silent || !alone) throw new Error('no vows');
    const base: RunState = { ...newRun(full, 'vows'), day: DAY };
    const ctx = runContext(full, base);
    const begun = drive(base, [{ t: 'beginShift', at: 0 }]);
    const shift = begun.shift;
    if (!shift) throw new Error('no shift');
    expect(vowBroken(silent, shift, ctx, 0)).toBe(false);
    expect(vowBroken(alone, shift, ctx, 0)).toBe(false);
    const hinted = stepShift(shift, { t: 'hint', at: 1000 }, ctx).state;
    expect(vowBroken(alone, hinted, ctx, 1000)).toBe(true);
    expect(vowBroken(silent, hinted, ctx, 1000)).toBe(false);
    // The sun's breaks once less than its share is left.
    const sun = vows.list.find((v) => v.kind === 'sun');
    if (!sun?.spare) throw new Error('no sun vow');
    expect(vowBroken(sun, shift, ctx, 0)).toBe(false);
    expect(vowBroken(sun, shift, ctx, Math.ceil((shift.sunMs * (100 - sun.spare + 1)) / 100))).toBe(true);
  });
});
