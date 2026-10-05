/**
 * Generator sweeps and campaign simulations (docs/tech-spec.md §9-10).
 *   pnpm sim sweep [--seeds 200] [--days 1-11] [--prefix sweep] [--no-timing] [--weave id] [--guise id]   (default: every day with a spec)
 *   pnpm sim sweep --daily [--seeds 200]      Dailies #1..#seeds
 *   pnpm sim sweep --parties [--seeds 200] [--days 9-20] [--prefix parties] [--no-timing]
 *     Days with parties (docs/tech-spec.md §69): each member checked with its companions, and a careful bot at the desk.
 *   pnpm sim campaign [--seeds 200] [--target dev-full|web-demo] [--story plain,ferry,…|all] [--no-fines] [--pace 25] [--serve freyja] [--promote] [--bribes] [--pleas] [--weave id] [--origin id]
 *     Bots play the target's scenes with each story policy (plain by default; see STORY_POLICIES);
 *     --no-fines plays every shift with that assist on; --pace sets the seconds of sun a bot spends on each
 *     soul (25 by default, when the sun never sets on the line), and adds the souls left at dusk; --serve has bots
 *     do one god's requests (docs/tech-spec.md §42) and adds each god's standing and the requests done; --bribes
 *     has bots take what souls offer for a wrong stamp (§47, §73); --pleas has them grant what souls plead for, but to
 *     a soul they caught lying (§59, §73); --origin begins every run with that origin (§72). Where the build keeps the
 *     word among the dead (§73), the report adds it at the end, the souls that asked and were granted, and the false
 *     asks granted (means). Where stamps are asked for proof (§76), it adds the souls judged rightly on a guess and the
 *     days graded Flawless (means); with --vows, bots swear the dearest vow on offer each night that they expect to keep
 *     (§75; --vows dearest: the dearest, whatever it is), and the report adds how many were kept, the rings they paid,
 *     Odin's standing, and each kind's keep rate. Bots seal the draft of tomorrow's decree their policy likes (§79),
 *     and the report says how many of each they sealed a run. Where Loki learns (§80), it adds his souls held and let
 *     by, and the new guises he took (means a run).
 *   pnpm sim compare --set 'path=value' [--set …] [--seeds 30] [--target dev-full] [--judging expert,competent,novice]
 *       [--strategy payAll] [--story plain] [--pace 25] [--nights 3,9,15,19]
 *     The tuning workbench (§63): the same bots on the same seeds with the content as built and with the changes, and
 *     what moved, with 95% intervals. A path picks list items by [id], [day], [index] or [*]; `+=` and `-=` add
 *     and take away, `*=` scales.
 * Sweeps print a report and exit 1 if any CI threshold is breached.
 */
import type { TargetId } from '@cots/content-schema';
import type { Faction } from '@cots/engine';
import {
  applyOverrides,
  checkPartyThresholds,
  checkThresholds,
  compareProfile,
  comparisonText,
  JUDGING,
  loadContent,
  loadDailyContent,
  loadScenes,
  type NightStrategy,
  parseOverride,
  partySweep,
  STORY_POLICIES,
  simulateCampaign,
  storyPolicy,
  sweep,
  THRESHOLDS,
} from '@cots/testkit';

const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
};
const [cmd] = process.argv.slice(2);
if (cmd === 'campaign') {
  const target = arg('target', 'dev-full') as TargetId;
  const seeds = Number(arg('seeds', '200'));
  const story = arg('story', 'plain');
  const stories = story === 'all' ? STORY_POLICIES : story.split(',').map(storyPolicy);
  const started = performance.now();
  const strategies = ['payAll', 'frugal', 'upgradesFirst'] as const;
  const noFines = process.argv.includes('--no-fines');
  const pace = process.argv.includes('--pace') ? Number(arg('pace', '25')) : undefined;
  const serve = process.argv.includes('--serve') ? (arg('serve', 'freyja') as Faction) : undefined;
  const promote = process.argv.includes('--promote') ? true : undefined;
  const bribes = process.argv.includes('--bribes');
  const pleas = process.argv.includes('--pleas');
  const weave = process.argv.includes('--weave') ? arg('weave', '') : undefined;
  const origin = process.argv.includes('--origin') ? arg('origin', '') : undefined;
  // The vows a bot swears (docs/tech-spec.md §75): those it expects to keep, or with `--vows dearest`, what pays most.
  const vows = process.argv.includes('--vows')
    ? arg('vows', 'safe') === 'dearest'
      ? ('dearest' as const)
      : ('safe' as const)
    : undefined;
  const reports = simulateCampaign(
    loadContent(target),
    seeds,
    JUDGING,
    strategies,
    stories,
    loadScenes(target),
    noFines ? { noFines: true } : undefined,
    pace,
    serve,
    promote,
    bribes,
    weave,
    origin,
    pleas,
    vows,
  );
  const word = loadContent(target).campaign?.word !== undefined;
  const proven = loadContent(target).campaign?.proven !== undefined;
  console.log(
    `campaign sim: ${target}, ${seeds} runs per policy${noFines ? ', no fines' : ''}${pace !== undefined ? `, ${pace}s a soul` : ''}${serve ? `, serving ${serve}` : ''}${promote ? ', taking promotions' : ''}${bribes ? ', taking bribes' : ''}${pleas ? ', granting pleas' : ''}${weave ? `, woven: ${weave}` : ''}${origin ? `, as ${origin}` : ''}${vows ? `, swearing vows (${vows})` : ''}, ${((performance.now() - started) / 1000).toFixed(1)}s`,
  );
  console.log(
    `judging    night          story      demoted  reprieved  family lost  rings (mean / min)  upgrades  arms  fronts${pace !== undefined ? '  left / died   Hel  Odin' : ''}${serve ? '  met/asked  Odin Freyja   Hel Clerk' : ''}${promote ? '  days at rank' : ''}${word ? '  word  asked/granted  lied' : ''}${proven ? '  lucky  flawless' : ''}${vows ? '  vows kept  rings  Odin' : ''}  endings`,
  );
  for (const r of reports) {
    const pct = (n: number) => `${((n * 100) / r.runs).toFixed(1)}%`.padStart(6);
    console.log(
      [
        r.judging.padEnd(10),
        r.strategy.padEnd(14),
        r.story.padEnd(10),
        pct(r.demoted).padStart(7),
        pct(r.reprieved).padStart(9),
        pct(r.familyLost).padStart(11),
        `${r.meanRings.toFixed(1)} / ${r.minRings}`.padStart(18),
        r.meanUpgrades.toFixed(1).padStart(9),
        r.meanArms.toFixed(1).padStart(5),
        (r.meanFronts === null ? '-' : r.meanFronts.toFixed(1)).padStart(7),
        ...(pace !== undefined
          ? [
              `${r.meanLeft.toFixed(1)} / ${r.meanDied.toFixed(1)}`.padStart(12),
              r.meanStanding.hel.toFixed(1).padStart(5),
              r.meanStanding.odin.toFixed(1).padStart(5),
            ]
          : []),
        ...(serve
          ? [
              `${r.meanMet.toFixed(1)}/${r.meanAsked.toFixed(1)}`.padStart(10),
              r.meanStanding.odin.toFixed(1).padStart(5),
              r.meanStanding.freyja.toFixed(1).padStart(6),
              r.meanStanding.hel.toFixed(1).padStart(5),
              r.meanStanding.clerk.toFixed(1).padStart(5),
            ]
          : []),
        ...(promote
          ? [
              r.meanRankDays
                .map((d) => d.toFixed(1))
                .join(' / ')
                .padStart(13),
            ]
          : []),
        ...(word
          ? [
              r.meanWord.toFixed(1).padStart(5),
              `${r.meanAsks.toFixed(1)}/${r.meanGranted.toFixed(1)}`.padStart(14),
              r.meanFound.toFixed(1).padStart(5),
            ]
          : []),
        ...(proven ? [r.meanLucky.toFixed(1).padStart(6), r.meanFlawless.toFixed(1).padStart(9)] : []),
        ...(vows
          ? [
              `${r.vows.sworn > 0 ? ((r.vows.kept * 100) / r.vows.sworn).toFixed(0) : '-'}%`.padStart(10),
              (r.vows.rings / r.runs).toFixed(1).padStart(6),
              r.meanStanding.odin.toFixed(1).padStart(5),
            ]
          : []),
        ` ${Object.entries(r.endings)
          .map(([e, n]) => `${e.replace('ending.', '')} ${n}`)
          .join(', ')}`,
      ].join(' '),
    );
    if (vows && r.vows.sworn > 0) {
      const kinds = Object.entries(r.vows.byKind)
        .map(([kind, v]) => `${kind} ${((v.kept * 100) / v.sworn).toFixed(0)}% of ${v.sworn}`)
        .join(', ');
      console.log(`  vows kept by kind: ${kinds}`);
    }
    // Tomorrow's decree (docs/tech-spec.md §79): the drafts the bots sealed, whenever they sealed any.
    const sealed = Object.entries(r.sealed);
    if (sealed.length > 0) {
      console.log(`  decrees sealed: ${sealed.map(([id, n]) => `${id} ${(n / r.runs).toFixed(1)} a run`).join(', ')}`);
    }
    // Loki learns (docs/tech-spec.md §80): how often his souls were held and let by, and the guises he took.
    if (r.loki.caught + r.loki.missed > 0) {
      console.log(
        `  Loki: held ${r.loki.caught.toFixed(1)}, let by ${r.loki.missed.toFixed(1)}, ${r.loki.guises.toFixed(1)} new guises a run`,
      );
    }
    if (r.ledgerErrors > 0) console.log(`  !! ${r.ledgerErrors} runs whose accounts don't add up`);
  }
  process.exit(reports.some((r) => r.ledgerErrors > 0) ? 1 : 0);
}
if (cmd === 'compare') {
  const fail = (message: string): never => {
    console.error(`sim compare: ${message}`);
    process.exit(2);
  };
  const target = arg('target', 'dev-full') as TargetId;
  const seeds = Number(arg('seeds', '30'));
  if (!Number.isInteger(seeds) || seeds < 2) fail('--seeds takes a whole number, 2 or more');
  const sets = process.argv.flatMap((a, i) => (a === '--set' ? [process.argv[i + 1] ?? ''] : []));
  if (sets.length === 0) fail("say what to change: --set 'path=value' (see docs/tech-spec.md §63)");
  const base = loadContent(target);
  let made: ReturnType<typeof applyOverrides> | undefined;
  try {
    made = applyOverrides(base, sets.map(parseOverride));
  } catch (e) {
    fail((e as Error).message);
  }
  const { content: variant, changes } = made as ReturnType<typeof applyOverrides>;
  const names = arg('judging', 'expert,competent,novice').split(',');
  const judgings = names.map((n) => JUDGING.find((j) => j.name === n) ?? fail(`no bots judge as "${n}"`));
  const strategies = arg('strategy', 'payAll').split(',') as NightStrategy[];
  const pace = process.argv.includes('--pace') ? Number(arg('pace', '25')) : undefined;
  const lastDay = base.campaign?.lastDay ?? 0;
  const nights = arg('nights', '3,9,15,19')
    .split(',')
    .map(Number)
    .filter((n) => n >= 1 && n <= lastDay);
  const story = storyPolicy(arg('story', 'plain'));
  const show = (x: unknown) => (typeof x === 'string' ? x : JSON.stringify(x));
  console.log(
    `sim compare: ${target}, ${seeds} seeds each, ${story.name} story${pace !== undefined ? `, ${pace}s a soul` : ''}`,
  );
  for (const [by, set] of sets.entries()) {
    // Each --set, and the places it changed: a few, then how many more.
    const made = changes.filter((c) => c.by === by);
    const shown = made.slice(0, made.length > 4 ? 3 : 4).map((c) => `${c.at}: ${show(c.from)} → ${show(c.to)}`);
    console.log(`  ${set}${made.length > 1 ? ` (${made.length} places)` : ''}`);
    for (const line of shown) console.log(`    ${line}`);
    if (made.length > shown.length) console.log(`    … and ${made.length - shown.length} more`);
  }
  const started = performance.now();
  for (const judging of judgings) {
    for (const strategy of strategies) {
      try {
        const c = compareProfile(base, variant, judging, strategy, {
          seeds,
          nights,
          sim: { story, scenes: loadScenes(target), ...(pace !== undefined ? { paceS: pace } : {}) },
        });
        console.log(`\n${comparisonText(c)}`);
      } catch (e) {
        console.error(`\nsim compare: ${(e as Error).message}`);
        process.exit(1);
      }
    }
  }
  console.log(
    `\n${((performance.now() - started) / 1000).toFixed(1)}s. "noise": the interval holds no change, so these runs can't tell it from luck; more --seeds narrow it.`,
  );
  process.exit(0);
}
if (cmd !== 'sweep') {
  console.error(
    "Usage: pnpm sim sweep [--seeds N] [--days 1-11 | --daily | --parties] [--prefix P] [--no-timing] [--weave id] [--guise id] | pnpm sim campaign [--seeds N] [--story plain,…|all] [--weave id] | pnpm sim compare --set 'path=value' [--seeds N]",
  );
  process.exit(2);
}
// Every day with a spec by default; a range keeps only the days that have one.
const specced = loadContent('dev-full').days.map((d) => d.day);
const range = process.argv.includes('--days')
  ? (arg('days', '1-5').split('-').map(Number) as [number, number])
  : ([Math.min(...specced), Math.max(...specced)] as [number, number]);
const days = specced.filter((d) => d >= range[0] && d <= (range[1] ?? range[0]));
const seeds = Number(arg('seeds', '200'));
const timing = !process.argv.includes('--no-timing');
const daily = process.argv.includes('--daily');

// Under a weave's order (docs/tech-spec.md §53): the same days, their rules read as the weave reads them.
const weaveId = process.argv.includes('--weave') ? arg('weave', '') : undefined;
const full = loadContent('dev-full');
const weave = full.campaign?.weaving?.weaves.find((w) => w.id === weaveId);
if (weaveId && !weave) {
  console.error(`sweep: no weave "${weaveId}"`);
  process.exit(2);
}
// In one of Loki's guises (docs/tech-spec.md §80): each day made with its tell, and its laws in force.
const guise = process.argv.includes('--guise') ? arg('guise', '') : undefined;
if (guise !== undefined && !full.campaign?.loki?.guises.some((g) => g.id === guise)) {
  console.error(`sweep: no guise "${guise}"`);
  process.exit(2);
}
const started = performance.now();
// Days with parties (docs/tech-spec.md §69): formed from each day's line, each member checked with its companions.
if (process.argv.includes('--parties')) {
  const withParties = days.filter((d) => full.days.find((s) => s.day === d)?.queue.parties);
  const p = partySweep({
    content: full,
    days: withParties,
    seeds,
    seedPrefix: arg('prefix', 'parties'),
    now: () => performance.now(),
  });
  const share = (a: number, b: number) => (b ? ((a * 100) / b).toFixed(1) : '0.0');
  console.log(
    `party sweep: ${seeds} seeds x days ${withParties.join(',')} = ${p.parties} parties of ${p.members} souls in ${((performance.now() - started) / 1000).toFixed(1)}s`,
  );
  console.log(
    `said of companions: ${p.claims}, lies ${p.lies} (${share(p.lies, p.claims)}%); souls a caught lie about a companion decides: ${p.decided}`,
  );
  console.log(
    `retinues: ${p.retinues.n}, sworn men ${p.retinues.men}; going where their jarl goes ${p.retinues.follow}, a hall that changed for ${p.retinues.moved}`,
  );
  console.log(
    `careful bot at the desk: ${share(p.ideal.correct, p.ideal.total)}% of ${p.ideal.total} souls, caught ${p.ideal.caught} of ${p.lies} lies about companions`,
  );
  console.log(`forming parties: mean ${p.linkMsMean.toFixed(2)} ms, p99 ${p.linkMsP99.toFixed(2)} ms a day`);
  const breaches = checkPartyThresholds(p, { timing });
  for (const b of breaches) console.error(`THRESHOLD: ${b}`);
  process.exit(breaches.length > 0 ? 1 : 0);
}
const r = sweep({
  content: daily ? loadDailyContent() : full,
  ...(weave ? { weave } : {}),
  ...(guise ? { guise } : {}),
  days,
  daily,
  seeds,
  seedPrefix: arg('prefix', 'sweep'),
  now: () => performance.now(),
});
const pct = (a: number, b: number) => (b ? ((a * 100) / b).toFixed(1) : '0.0');

console.log(
  `sweep: ${daily ? `Dailies #1-#${seeds}` : `${seeds} seeds x days ${days.join(',')}`}${weave ? `, woven: ${weave.id}` : ''}${guise ? `, Loki as ${guise}` : ''} = ${r.cases} souls in ${((performance.now() - started) / 1000).toFixed(1)}s`,
);
console.log(
  `attempts: mean ${r.attemptsMean.toFixed(2)}, p99 ${r.attemptsP99}; fallbacks ${r.fallbacks} (${pct(r.fallbacks, r.cases)}%)`,
);
console.log(`generation: mean ${r.genMsMean.toFixed(3)} ms, p99 ${r.genMsP99.toFixed(3)} ms`);
console.log(`mix within spec: ${pct(r.mix.ok, r.mix.days)}% of days`);
if (weave) console.log(`undressed under the weave: ${r.undressed} (${pct(r.undressed, r.cases)}%)`);
console.log(
  `bots: ideal ${pct(r.ideal.correct, r.ideal.total)}%, trusting ${pct(r.trusting.correct, r.trusting.total)}% (max ${THRESHOLDS.maxTrustingPct}%)`,
);
console.log(
  `trusting by day: ${Object.entries(r.trustingByDay)
    .map(([d, v]) => `${/^\d+$/.test(d) ? `d${d}` : d} ${pct(v.correct, v.total)}%`)
    .join(', ')}`,
);
console.log(
  `destinations: ${Object.entries(r.destinations)
    .map(([d, n]) => `${d} ${pct(n, r.cases)}%`)
    .join(', ')}`,
);
console.log('acceptance by day:archetype:');
for (const [key, row] of Object.entries(r.perDayArchetype).sort()) {
  console.log(`  ${key.padEnd(28)} ${pct(row.accepted, row.attempts).padStart(5)}% of ${row.attempts}`);
}
console.log(
  `rejections: ${
    Object.entries(r.rejects)
      .sort((a, b) => b[1] - a[1])
      .map(([c, n]) => `${c} ${n}`)
      .join(', ') || 'none'
  }`,
);

const violations = checkThresholds(r, { timing });
if (violations.length > 0) {
  console.error(violations.map((v) => `sweep: FAIL ${v}`).join('\n'));
  process.exit(1);
}
console.log('sweep: all thresholds met');
