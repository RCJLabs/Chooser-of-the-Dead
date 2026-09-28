import {
  atDesk,
  type CaseSpec,
  type Content,
  companionShows,
  createDayContext,
  crossFlagged,
  type DayCtx,
  decisiveFacts,
  generateDay,
  inspectable,
  linkParties,
  memberField,
  memberSoul,
  partyAt,
  retractedOf,
  type ShiftAction,
  type ShiftState,
  solve,
  soulCtx,
  soulFieldsOf,
  startShift,
  stepShift,
  tierKnobs,
  validateCase,
} from '@cots/engine';

/*
 * The party sweep (docs/tech-spec.md §69): days with parties made in full, their parties formed, and every member
 * checked with its companions. A careful bot then plays each day at the desk, a party at a time: it turns to each
 * member, looks at everything, catches every lie (those about companions against the companion), and stamps what the
 * evidence decides. Every soul must come out right.
 */

export interface PartySweepOptions {
  readonly content: Content;
  readonly days: readonly number[];
  readonly seeds: number;
  readonly seedPrefix?: string;
  /** Clock for timing the pass that forms parties (the engine never reads one). */
  readonly now?: () => number;
}

export interface PartySweepReport {
  readonly lines: number;
  readonly parties: number;
  readonly members: number;
  /** What members said of companions, and how many of those were lies. */
  readonly claims: number;
  readonly lies: number;
  /** Members whose judgment rests on a lie about a companion being caught (Day 16 on). */
  readonly decided: number;
  /** Members that fail F1-F8 with their companions, and why (should be none). */
  readonly invalid: readonly string[];
  /** A true word about a companion that looks false, or a lie about one that nothing shows false (none). */
  readonly unfair: readonly string[];
  /** The careful bot at the desk: souls judged rightly of those it judged, and lies about companions it caught. */
  readonly ideal: { readonly correct: number; readonly total: number; readonly caught: number };
  /** Milliseconds forming each day's parties: mean and 99th percentile. */
  readonly linkMsMean: number;
  readonly linkMsP99: number;
}

const percentile = (xs: number[], p: number): number => {
  if (xs.length === 0) return 0;
  const sorted = xs.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length * p) / 100))] ?? 0;
};

/** The careful bot's day at the desk: every verdict right? And the lies about companions it caught. */
function playDay(content: Content, seed: string, ctx: DayCtx, line: readonly CaseSpec[]) {
  let { state } = startShift(content, { mode: 'practice', seed, day: ctx.day, untimed: true }, line, ctx);
  let caught = 0;
  let at = 0;
  const step = (a: ShiftAction) => {
    const r = stepShift(state, a, ctx);
    const bad = r.events.find((e) => e.e === 'rejected');
    if (bad && bad.e === 'rejected') throw new Error(`day ${ctx.day} ${seed}: ${a.t} rejected: ${bad.reason}`);
    if (r.events.some((e) => e.e === 'contradiction' && e.with.startsWith('@'))) caught++;
    state = r.state;
  };
  const turn = (k: number) => {
    if (state.party) step({ t: 'turn', to: k, at });
  };
  const seenOf = (s: ShiftState, c: CaseSpec, k: number) => {
    const soul = memberSoul(s, k) ?? s.soul;
    return soulFieldsOf(c, soul).filter((f) => soul.seen.includes(f.id));
  };
  step({ t: 'begin', at });
  while (state.phase === 'shift') {
    at += 1000;
    const desk = atDesk(state);
    desk.forEach((c, k) => {
      turn(k);
      const cx = soulCtx(ctx, c);
      if (cx.tools.has('flip')) step({ t: 'flip', at });
      const tools = new Set(c.evidence.fields.flatMap((f) => (f.tool && f.tool !== 'flip' ? [f.tool] : [])));
      for (const tool of tools) if (cx.tools.has(tool)) step({ t: 'tool', tool, at });
      step({ t: 'inspect', fields: inspectable(state, ctx).map((f) => f.id), at });
    });
    desk.forEach((c, k) => {
      turn(k);
      const cx = soulCtx(ctx, c);
      for (const x of solve(seenOf(state, c, k), cx).contradictions) {
        const other = x.against.find((id) => id !== 'world' && !id.startsWith('q:'));
        if (other && !state.soul.flagged.some((f) => f.lie === x.lie)) step({ t: 'compare', a: x.lie, b: other, at });
      }
      for (const f of c.evidence.fields) {
        if (!f.about) continue;
        const mate = desk[f.about.soul] as CaseSpec;
        const mateSoul = memberSoul(state, f.about.soul);
        if (!mateSoul) continue;
        const shows = companionShows(
          seenOf(state, mate, f.about.soul),
          f.about.fact,
          f.about.value,
          soulCtx(ctx, mate),
          retractedOf(mate, mateSoul),
        );
        if (shows?.[0]) step({ t: 'compare', a: f.id, b: memberField(f.about.soul, shows[0]), at });
      }
    });
    desk.forEach((c, k) => {
      turn(k);
      const cx = soulCtx(ctx, c);
      const j = solve(seenOf(state, c, k), cx, {
        crossCaught: crossFlagged(state.soul),
        retracted: retractedOf(c, state.soul),
      }).judgment;
      for (const id of c.expect.procedures ?? []) {
        const tool = cx.procedures.find((p) => p.id === id)?.tool;
        if (tool && !state.soul.tools.includes(tool)) step({ t: 'tool', tool, at });
      }
      // What the evidence decides; a soul it doesn't decide is stamped wrong on purpose, so it counts against.
      const wrong = [...cx.destinations].find((d) => d !== c.expect.dest) ?? c.expect.dest;
      step({ t: 'stamp', dest: j.kind === 'determined' ? j.dest : wrong, at });
    });
    step({ t: 'send', at });
  }
  return { correct: state.verdicts.filter((v) => v.correct).length, total: state.verdicts.length, caught };
}

export function partySweep(opts: PartySweepOptions): PartySweepReport {
  const now = opts.now ?? (() => 0);
  const times: number[] = [];
  const invalid: string[] = [];
  const unfair: string[] = [];
  let lines = 0;
  let parties = 0;
  let members = 0;
  let claims = 0;
  let lies = 0;
  let decided = 0;
  let correct = 0;
  let total = 0;
  let caught = 0;
  for (const day of opts.days) {
    for (let s = 0; s < opts.seeds; s++) {
      const seed = `${opts.seedPrefix ?? 'parties'}-${s}`;
      const ctx = createDayContext(opts.content, day, seed);
      const plain = generateDay(seed, ctx).cases;
      const t0 = now();
      const line = linkParties(plain, ctx, seed);
      times.push(now() - t0);
      lines++;
      line.forEach((_, i) => {
        const span = partyAt(line, i);
        if (!span) return;
        parties++;
        const party = line.slice(i, i + span.size);
        const companions = new Map(party.map((c, k) => [k, { case: c, ctx: soulCtx(ctx, c) }]));
        for (const c of party) {
          members++;
          const cx = soulCtx(ctx, c);
          if (c.meta.crossProof) decided++;
          for (const f of c.evidence.fields) {
            if (!f.about) continue;
            claims++;
            const lie = c.lies.some((l) => l.field === f.id);
            if (lie) lies++;
            const mate = party[f.about.soul];
            const shows = mate && companionShows(mate.evidence.fields, f.about.fact, f.about.value, soulCtx(ctx, mate));
            if (!mate || Boolean(shows) !== lie) unfair.push(`day ${day} ${seed} ${c.id} ${f.id}`);
          }
          const v = validateCase(
            c.evidence,
            c.truth,
            c.lies,
            c.expect,
            decisiveFacts(c.truth, c.expect, cx),
            cx,
            tierKnobs(c.meta.tier, cx.spec.queue.knobs),
            companions,
          );
          if (!v.ok) invalid.push(`day ${day} ${seed} ${c.id}: ${v.code} ${v.detail}`);
        }
      });
      const played = playDay(opts.content, seed, ctx, line);
      correct += played.correct;
      total += played.total;
      caught += played.caught;
    }
  }
  const mean = times.length ? times.reduce((a, b) => a + b, 0) / times.length : 0;
  return {
    lines,
    parties,
    members,
    claims,
    lies,
    decided,
    invalid,
    unfair,
    ideal: { correct, total, caught },
    linkMsMean: mean,
    linkMsP99: percentile(times, 99),
  };
}

/** What forming a day's parties may take, at the 99th percentile. */
export const MAX_LINK_MS_P99 = 60;

/** The party sweep's gates: every member fair and valid, every soul judged rightly, every lie about a companion caught. */
export function checkPartyThresholds(r: PartySweepReport, opts: { timing: boolean } = { timing: true }): string[] {
  const out: string[] = [];
  if (r.parties === 0) out.push('no parties formed');
  for (const x of r.invalid.slice(0, 5)) out.push(`invalid member: ${x}`);
  for (const x of r.unfair.slice(0, 5)) out.push(`unfair word about a companion: ${x}`);
  if (r.ideal.correct !== r.ideal.total) out.push(`careful bot at the desk ${r.ideal.correct}/${r.ideal.total}`);
  if (r.ideal.caught !== r.lies) out.push(`careful bot caught ${r.ideal.caught} of ${r.lies} lies about companions`);
  if (opts.timing && r.linkMsP99 > MAX_LINK_MS_P99) out.push(`p99 forming parties ${r.linkMsP99.toFixed(1)} ms`);
  return out;
}
