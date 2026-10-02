import { catchLie, loadContent, proveSoul } from '@cots/testkit';
import { describe, expect, it } from 'vitest';
import type { Content } from '../content/types';
import { parseMemberField } from '../gen/companions';
import { partyAt } from '../gen/party';
import type { CaseSpec } from '../gen/types';
import type { DayCtx } from '../logic/context';
import {
  perceivedOf,
  proofAsked,
  type ShiftAction,
  type ShiftConfig,
  type ShiftState,
  startShift,
  stepShift,
  type Verdict,
} from './shift';

/*
 * Proven, not lucky (docs/tech-spec.md §76): a stamp is proven when what the player had of the soul as it was sent
 * settled its judgment: what they looked at, the signs its body showed them, what it owned up to, and for a sworn man
 * his jarl's hall as far as what they had of the jarl settles it.
 */

const full = loadContent('dev-full');
const demo = loadContent('web-demo');

/** How a test player treats each soul before stamping it rightly: `look` gives the actions, with its party. */
type Look = (members: readonly CaseSpec[], k: number, ctx: DayCtx) => ShiftAction[];

const nothing: Look = () => [];
const careful: Look = (members, k, ctx) => {
  const c = members[k] as CaseSpec;
  const caught = catchLie(c, ctx, 0);
  return [...caught, ...proveSoul(members, k, ctx, 0, caught)];
};

/** A day's shift played through, every soul stamped rightly (its procedures done) after `look`. */
function play(content: Content, config: ShiftConfig, look: Look): { state: ShiftState; ctx: DayCtx } {
  const { state: start, ctx } = startShift(content, { ...config, untimed: true });
  let s = stepShift(start, { t: 'begin', at: 0 }, ctx).state;
  const cases = s.cases;
  let party: { start: number; size: number } | null = null;
  for (const [i, c] of cases.entries()) {
    party = partyAt(cases, i) ?? (party && i < party.start + party.size ? party : null);
    const k = party ? i - party.start : 0;
    const members = party ? cases.slice(party.start, party.start + party.size) : [c];
    const actions: ShiftAction[] = [...(party ? [{ t: 'turn' as const, to: k, at: 0 }] : []), ...look(members, k, ctx)];
    for (const id of c.expect.procedures ?? []) {
      const tool = ctx.procedures.find((p) => p.id === id)?.tool;
      if (tool) actions.push({ t: 'tool', tool, at: 0 });
    }
    actions.push({ t: 'stamp', dest: c.expect.dest, at: 0 });
    if (!party || k === party.size - 1) actions.push({ t: 'send', at: 0 });
    for (const a of actions) {
      const r = stepShift(s, a, ctx);
      const rejected = r.events.find((e) => e.e === 'rejected');
      if (rejected && a.t !== 'turn') throw new Error(`${config.seed} day ${config.day}: ${a.t} rejected`);
      s = r.state;
    }
  }
  return { state: s, ctx };
}

const campaignDay = (seed: string, day: number): ShiftConfig => ({ mode: 'campaign', seed, day });
const DAYS = full.days.map((d) => d.day).filter((d) => d >= 1 && d <= 20);

describe('proven stamps (docs/tech-spec.md §76)', () => {
  it('are asked for in the full game’s campaign, practice and Endless, never in the Daily, the primer or the demo', () => {
    expect(proofAsked(campaignDay('a', 4), full)).toBe(true);
    expect(proofAsked({ mode: 'practice', seed: 'a', day: 4 }, full)).toBe(true);
    expect(proofAsked({ mode: 'daily', seed: 'a', day: 4 }, full)).toBe(false);
    expect(proofAsked({ mode: 'primer', seed: 'a', day: 1 }, full)).toBe(false);
    expect(proofAsked(campaignDay('a', 2), demo)).toBe(false);
    // Played without looking at anything, no Daily stamp is marked: the Daily plays as it always has.
    const daily = play(
      full,
      { mode: 'daily', seed: 'proof-daily', day: full.daily?.day ?? 1, dailyNumber: 1 },
      nothing,
    );
    expect(daily.state.verdicts.length).toBeGreaterThan(0);
    expect(daily.state.verdicts.every((v) => v.correct && v.unproven === undefined)).toBe(true);
  });

  it('are proven for every soul whose proof the player looked at, parties and retinues too', () => {
    let souls = 0;
    for (const seed of ['proof-0', 'proof-1']) {
      for (const day of DAYS) {
        const { state } = play(full, campaignDay(seed, day), careful);
        for (const v of state.verdicts) {
          souls++;
          expect(v.correct, `${seed} day ${day} #${v.index}`).toBe(true);
          expect(v.unproven, `${seed} day ${day} #${v.index}`).toBeUndefined();
        }
      }
    }
    expect(souls).toBeGreaterThan(400);
  }, 60_000);

  it('are lucky when right on what the body’s front showed alone and it didn’t settle them, naming what decided them', () => {
    let lucky = 0;
    let proven = 0;
    for (const day of DAYS) {
      const { state } = play(full, campaignDay('proof-bare', day), nothing);
      for (const v of state.verdicts) {
        const c = state.cases[v.index] as CaseSpec;
        if (v.unproven === undefined) {
          proven++;
          continue;
        }
        lucky++;
        // What it lacked is evidence its proof (or a companion's part of it) rests on.
        for (const id of v.unproven) {
          const at = parseMemberField(id);
          if (at) expect(c.meta.crossProof?.some((x) => x.soul === at.soul && x.field === at.field)).toBe(true);
          else expect(c.meta.proof).toContain(id.replace(/^q:/, ''));
        }
      }
    }
    // Most souls need more than a glance, but a weapon in hand is a weapon in hand.
    expect(lucky).toBeGreaterThan(proven);
    expect(proven).toBeGreaterThan(0);
  }, 30_000);

  it('count the body’s signs as seen once they’re drawn: its back once turned over, without touching them', () => {
    // A soul whose proof is all on its back, with no tool: turning it over is enough.
    let found: { seed: string; day: number; index: number } | null = null;
    for (const seed of ['proof-0', 'proof-1', 'proof-2', 'proof-3']) {
      for (const day of DAYS.filter((d) => d >= 2)) {
        const { state, ctx } = play(full, campaignDay(seed, day), nothing);
        const v = state.verdicts.find((x) => {
          const c = state.cases[x.index] as CaseSpec;
          const proof = c.evidence.fields.filter((f) => c.meta.proof.includes(f.id));
          return (
            c.party === undefined &&
            x.unproven !== undefined &&
            proof.length > 0 &&
            proof.every((f) => f.item === 'body' && f.view === 'back' && f.tool === undefined) &&
            ctx.tools.has('flip')
          );
        });
        if (v) found = { seed, day, index: v.index };
        if (found) break;
      }
      if (found) break;
    }
    if (!found) throw new Error('no soul decided by its back alone');
    const { seed, day, index } = found;
    const { state, ctx } = play(full, campaignDay(seed, day), () => [{ t: 'flip', at: 0 }]);
    const v = state.verdicts[index] as Verdict;
    expect(v.unproven).toBeUndefined();
    // Nothing was touched: the back's signs were had because the body showed them.
    const c = state.cases[index] as CaseSpec;
    const seen = {
      seen: [],
      view: 'back' as const,
      flipped: true,
      tools: [],
      flagged: [],
      questioned: [],
      stamp: null,
    };
    expect(perceivedOf(c, seen, ctx).map((f) => f.id)).toEqual(expect.arrayContaining([...c.meta.proof]));
  }, 60_000);

  it('prove a jarl’s sworn man only with the jarl’s own proof had too', () => {
    // A retinue whose jarl the front of his body doesn't settle: the man's hall waits on the jarl's proof.
    let checked = 0;
    for (const seed of ['proof-0', 'proof-1', 'proof-2', 'proof-3', 'proof-4', 'proof-5']) {
      for (const day of DAYS.filter((d) => d >= 9)) {
        const own: Look = (members, k, ctx) => {
          // The man's own proof looked at, never what it needs of his jarl; the jarl stamped on a glance.
          const c = members[k] as CaseSpec;
          if (c.party?.lord?.at === k) return [];
          return proveSoul([c], 0, ctx, 0).filter((a) => a.t !== 'turn');
        };
        const half = play(full, campaignDay(seed, day), own).state;
        const whole = play(full, campaignDay(seed, day), careful).state;
        for (const v of half.verdicts) {
          const c = half.cases[v.index] as CaseSpec;
          const lord = c.party?.lord;
          // A man who fled is judged on his own; only one who stood by his jarl waits on the jarl's hall.
          if (!lord || c.party?.index === lord.at || !c.meta.crossProof?.some((x) => x.soul === lord.at)) continue;
          const jarl = half.verdicts.find((x) => x.index === v.index - (c.party?.index ?? 0) + lord.at);
          if (jarl?.unproven === undefined) continue;
          // His jarl was a guess, so he is too, and what he lacked is the jarl's.
          expect(v.unproven, `${seed} day ${day} #${v.index}`).toBeDefined();
          expect(v.unproven?.some((id) => parseMemberField(id)?.soul === lord.at)).toBe(true);
          expect(whole.verdicts[v.index]?.unproven).toBeUndefined();
          checked++;
        }
      }
      if (checked >= 3) break;
    }
    expect(checked).toBeGreaterThan(0);
  }, 120_000);
});
