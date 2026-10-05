import { weaveDay } from '@cots/engine';
import { expect, it } from 'vitest';
import { loadContent, loadDailyContent } from './content';
import { checkPartyThresholds, partySweep } from './party-sweep';
import { checkThresholds, sweep, THRESHOLDS } from './sweep';

// The CI gate from docs/tech-spec.md §3.8, on a PR-sized sweep. `pnpm sim sweep --seeds 10000` runs the nightly size.
it('the generator meets its thresholds on 200 seeds x every day', () => {
  const content = loadContent('dev-full');
  const report = sweep({
    content,
    days: content.days.map((d) => d.day),
    seeds: Number(process.env.SWEEP_SEEDS ?? 200),
    seedPrefix: 'ci',
    now: () => performance.now(),
  });
  expect(checkThresholds(report)).toEqual([]);
  expect(report.cases).toBeGreaterThan(1000);
}, 120_000);

it('the Daily meets the same thresholds on Dailies #1-#200', () => {
  const report = sweep({
    content: loadDailyContent(),
    days: [],
    daily: true,
    seeds: Number(process.env.SWEEP_SEEDS ?? 200),
    now: () => performance.now(),
  });
  expect(checkThresholds(report)).toEqual([]);
  expect(report.cases).toBe(8 * Number(process.env.SWEEP_SEEDS ?? 200));
}, 120_000);

// Under each weave (docs/tech-spec.md §53) the day's souls are made as above and seen under its order: the generator's
// figures are the same, so these check what the weave changes. `pnpm sim sweep --weave <id>` runs the nightly size.
it('every soul made on a woven day can be dressed for the weave, and the careful bot judges it rightly', () => {
  const content = loadContent('dev-full');
  for (const weave of content.campaign?.weaving?.weaves ?? []) {
    const first = weaveDay(content, weave) ?? content.days.length + 1;
    const report = sweep({
      content,
      days: content.days.map((d) => d.day).filter((d) => d >= first),
      seeds: Number(process.env.SWEEP_WOVEN_SEEDS ?? 30),
      seedPrefix: 'ci-woven',
      weave,
    });
    expect(report.undressed, weave.id).toBe(0);
    expect(report.ideal.correct, weave.id).toBe(report.ideal.total);
    expect((report.trusting.correct * 100) / report.trusting.total, weave.id).toBeLessThanOrEqual(
      THRESHOLDS.maxTrustingPct,
    );
  }
}, 120_000);

// Loki's later guises (docs/tech-spec.md §80): the days he can wear one, made in each, meet the same thresholds, so a
// tell that's harder to generate around shows here. `pnpm sim sweep --guise <id> --days 13-20` runs the nightly size.
it('in each of Loki’s later guises, the days he can wear it meet the generator’s thresholds', () => {
  const content = loadContent('dev-full');
  const loki = content.campaign?.loki;
  const met = content.facts.find((f) => f.id === loki?.fact)?.since ?? 1;
  const [, ...later] = loki?.guises ?? [];
  expect(later.length).toBeGreaterThan(0);
  for (const guise of later) {
    const report = sweep({
      content,
      days: content.days.map((d) => d.day).filter((d) => d > met),
      seeds: Number(process.env.SWEEP_GUISE_SEEDS ?? 30),
      seedPrefix: 'ci-guise',
      guise: guise.id,
      now: () => performance.now(),
    });
    expect(checkThresholds(report), guise.id).toEqual([]);
  }
}, 120_000);

// Linked souls (docs/tech-spec.md §69): every day with parties, formed from its line, each member fair and valid with
// its companions, and a careful bot at the desk judging every soul rightly and catching every lie about a companion.
// `pnpm sim sweep --parties` runs the nightly size.
it('parties are fair: every member checks out with its companions, and the careful bot at the desk is always right', () => {
  const content = loadContent('dev-full');
  const report = partySweep({
    content,
    days: content.days.filter((d) => d.queue.parties).map((d) => d.day),
    seeds: Number(process.env.SWEEP_PARTY_SEEDS ?? 30),
    seedPrefix: 'ci-parties',
    now: () => performance.now(),
  });
  expect(checkPartyThresholds(report)).toEqual([]);
  expect(report.parties).toBeGreaterThan(200);
  expect(report.lies).toBeGreaterThan(100);
  expect(report.decided).toBeGreaterThan(20);
  // Retinues (docs/tech-spec.md §70): men who go where their jarl goes, some to a hall their own evidence wouldn't.
  expect(report.retinues.follow).toBeGreaterThan(50);
  expect(report.retinues.moved).toBeGreaterThan(20);
}, 120_000);
