import type { Report } from './parse';

/*
 * Several playtest reports summed up (docs/tech-spec.md §63), as Markdown to paste where it's discussed: the runs
 * side by side, the rings night by night against the bots' range, how each day was judged, and the rules the souls
 * sent wrong broke. A handful of runs gives leads, not measurements: the summary says how many runs each number is
 * from.
 */

/** The bots' rings after each night: the middle half and the median, by day. */
export interface Band {
  readonly name: string;
  readonly runs: number;
  /** By day: the median and middle half of the rings after the night, over the `n` runs still going that day. */
  readonly byDay: ReadonlyMap<
    number,
    { readonly p25: number; readonly median: number; readonly p75: number; readonly n: number }
  >;
}

/** The value a fraction of the way through the numbers, sorted, between neighbours where it falls between them. */
export function quantile(xs: readonly number[], q: number): number {
  const sorted = [...xs].sort((a, b) => a - b);
  if (sorted.length === 0) return Number.NaN;
  const at = (sorted.length - 1) * Math.min(1, Math.max(0, q));
  const lo = sorted[Math.floor(at)] as number;
  const hi = sorted[Math.ceil(at)] as number;
  return lo + (hi - lo) * (at - Math.floor(at));
}

/** Days as a list, runs of days joined: 7–9, 12. */
export function dayList(days: readonly number[]): string {
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  const runs: [number, number][] = [];
  for (const d of sorted) {
    const last = runs.at(-1);
    if (last && d === last[1] + 1) last[1] = d;
    else runs.push([d, d]);
  }
  return runs.map(([a, b]) => (a === b ? String(a) : `${a}–${b}`)).join(', ');
}

const clock = (s: number) => {
  const whole = Math.round(s);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
};
const pct = (n: number, of: number) => (of > 0 ? `${Math.round((n * 100) / of)}%` : '–');
const esc = (s: string) => s.replace(/\|/g, '\\|');

/** A run's assists, each with the days it was on. */
function assistsOf(r: Report): string {
  const by = new Map<string, number[]>();
  for (const d of r.days) {
    for (const a of d.assists.split(', ').filter((x) => x !== '')) by.set(a, [...(by.get(a) ?? []), d.day]);
  }
  return [...by].map(([a, days]) => `${a} (Day${days.length > 1 ? 's' : ''} ${dayList(days)})`).join('; ');
}

/** Where a number sits among the bots' medians that day. */
export function placeAmong(
  rings: number,
  medians: readonly { readonly name: string; readonly median: number }[],
): string {
  const sorted = [...medians].sort((a, b) => a.median - b.median);
  const low = sorted[0];
  const high = sorted.at(-1);
  if (!low || !high) return '';
  if (rings < low.median) return `below the ${low.name} bots`;
  if (rings >= high.median) return `at or above the ${high.name} bots`;
  const i = sorted.findIndex((b) => rings < b.median);
  return `between the ${sorted[i - 1]?.name} and ${sorted[i]?.name} bots`;
}

function runsTable(reports: readonly Report[]): string[] {
  return [
    '| Run | Build | Device | Reached | Rings | Ending | Mode | Assists |',
    '|---|---|---|---|---:|---|---|---|',
    ...reports
      .map((r) =>
        [
          r.label,
          r.build ?? '?',
          r.device ?? '',
          r.now ? `Day ${r.now.day}, ${r.now.phase}` : '?',
          r.now ? String(r.now.rings) : '',
          r.ending ?? '',
          r.flags.join(', '),
          assistsOf(r),
        ]
          .map(esc)
          .join(' | '),
      )
      .map((row) => `| ${row} |`),
  ];
}

function ringsTable(reports: readonly Report[], bands: readonly Band[]): string[] {
  const days = [...new Set(reports.flatMap((r) => r.days.filter((d) => d.rings !== undefined).map((d) => d.day)))];
  days.sort((a, b) => a - b);
  if (days.length === 0) return ['No night has passed in any run yet.'];
  const heads = [...reports.map((r) => esc(r.label)), ...bands.map((b) => `${b.name} bots`)];
  return [
    `| Day | ${heads.join(' | ')} |`,
    `|---:|${heads.map(() => '---:').join('|')}|`,
    ...days.map((day) => {
      const runs = reports.map((r) => {
        const d = r.days.find((x) => x.day === day);
        return d?.rings === undefined ? '' : `${d.rings}${d.assists ? '*' : ''}`;
      });
      const bots = bands.map((b) => {
        const x = b.byDay.get(day);
        // Bots demoted earlier aren't in a later day's range: it says how many runs it's from.
        return x
          ? `${Math.round(x.median)} (${Math.round(x.p25)} to ${Math.round(x.p75)})${x.n < b.runs ? `, ${x.n} runs` : ''}`
          : '';
      });
      return `| ${day} | ${[...runs, ...bots].join(' | ')} |`;
    }),
  ];
}

function places(reports: readonly Report[], bands: readonly Band[]): string[] {
  if (bands.length === 0) return [];
  return reports.flatMap((r) => {
    const last = [...r.days].reverse().find((d) => d.rings !== undefined);
    if (!last || last.rings === undefined) return [];
    const medians = bands.flatMap((b) => {
      const x = b.byDay.get(last.day);
      return x ? [{ name: b.name, median: x.median }] : [];
    });
    const where = placeAmong(last.rings, medians);
    return where ? [`- ${r.label}: ${last.rings} rings after Night ${last.day}, ${where}.`] : [];
  });
}

function judgingTable(reports: readonly Report[]): string[] {
  const days = [...new Set(reports.flatMap((r) => r.days.map((d) => d.day)))].sort((a, b) => a - b);
  if (days.length === 0) return ['No day finished in any run yet.'];
  return [
    '| Day | Runs | Right | Wrong | Left at dusk | Judged rightly | Sharp or flawless | Sun left (median) | Pressed (gave way) | Assisted |',
    '|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
    ...days.map((day) => {
      const ds = reports.flatMap((r) => r.days.filter((d) => d.day === day));
      const sum = (f: (d: (typeof ds)[number]) => number) => ds.reduce((n, d) => n + f(d), 0);
      const right = sum((d) => d.right);
      const all = sum((d) => d.right + d.wrong + d.unjudged);
      const good = ds.filter((d) => d.grade === 'sharp' || d.grade === 'flawless').length;
      const graded = ds.filter((d) => d.grade !== undefined).length;
      const suns = ds.flatMap((d) => (d.sunLeftS === undefined ? [] : [d.sunLeftS]));
      // Claims pressed and lies that gave way (docs/tech-spec.md §66), from builds that report them.
      const pressed = ds.flatMap((d) => (d.pressed ? [d.pressed] : []));
      return `| ${[
        day,
        ds.length,
        right,
        sum((d) => d.wrong),
        sum((d) => d.unjudged),
        pct(right, all),
        graded > 0 ? `${good} of ${graded}` : '–',
        suns.length > 0 ? `${clock(quantile(suns, 0.5))} (${suns.length})` : '–',
        pressed.length > 0
          ? `${pressed.reduce((n, p) => n + p.n, 0)} (${pressed.reduce((n, p) => n + p.gave, 0)})`
          : '–',
        ds.filter((d) => d.assists !== '').length,
      ].join(' | ')} |`;
    }),
  ];
}

function rulesTable(reports: readonly Report[]): string[] {
  const by = new Map<string, { count: number; runs: Set<string>; days: number[] }>();
  for (const r of reports) {
    for (const m of r.mistakes) {
      if (m.kind !== 'wrong' || !m.rule) continue;
      const x = by.get(m.rule) ?? { count: 0, runs: new Set<string>(), days: [] };
      x.count += 1;
      x.runs.add(r.label);
      x.days.push(m.day);
      by.set(m.rule, x);
    }
  }
  const all = reports.flatMap((r) => r.mistakes);
  const n = (f: (m: (typeof all)[number]) => boolean) => all.filter(f).reduce((k, m) => k + m.count, 0);
  const notes = [
    `Right stamp, a step skipped: ${n((m) => m.kind === 'skipped')}.`,
    `Of the wrong stamps: ${n((m) => m.kind === 'wrong' && m.bribe)} bribes taken, ${n((m) => m.kind === 'wrong' && m.plea)} pleas granted, ${n((m) => m.kind === 'wrong' && m.noon)} after a noon decree.`,
    // Kennings (docs/tech-spec.md §77): how often a skald's tally came before a wrong stamp, the risk being it's obscure.
    ...(n((m) => m.kind === 'wrong' && m.skald !== undefined) > 0
      ? [
          `On a skald's tally: ${n((m) => m.kind === 'wrong' && m.skald === 'kennings')} in kennings, ${n((m) => m.kind === 'wrong' && m.skald === 'botched')} with a botched kenning.`,
        ]
      : []),
    ...(n((m) => m.kind === 'count') > 0
      ? [`Not itemised (saves from before mistakes were filed): ${n((m) => m.kind === 'count')}.`]
      : []),
  ];
  if (by.size === 0) return ['No soul was stamped wrong.', '', ...notes];
  const rows = [...by].sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]));
  return [
    '| Rule | Sent wrong | Runs | Days |',
    '|---|---:|---:|---|',
    ...rows.map(([rule, x]) => `| ${esc(rule)} | ${x.count} | ${x.runs.size} | ${dayList(x.days)} |`),
    '',
    ...notes,
  ];
}

function pleasLine(reports: readonly Report[]): string[] {
  const counted = reports.filter((r) => r.pleas !== undefined);
  if (counted.length === 0) return ['No run counted pleas or kin.'];
  const sum = (f: (p: NonNullable<Report['pleas']>) => number) =>
    counted.reduce((n, r) => n + (r.pleas ? f(r.pleas) : 0), 0);
  // Offers and liars found out (docs/tech-spec.md §73), where a report counted any.
  const offers = sum((p) => p.offers ?? 0);
  const lied = sum((p) => p.lied ?? 0);
  return [
    `Pleas: ${sum((p) => p.asked)}, granted: ${sum((p) => p.granted)}. Kin who came: ${sum((p) => p.kin)}.${offers > 0 ? ` Offers: ${offers}, taken: ${sum((p) => p.taken ?? 0)}.` : ''}${lied > 0 ? ` Found out lying: ${lied}.` : ''} From ${counted.length} of ${reports.length} runs.`,
  ];
}

/** The summary of `reports`, beside the bots' range when `bands` are given. */
export function summarize(reports: readonly Report[], bands: readonly Band[] = []): string {
  const botNote =
    bands.length > 0
      ? `Bots: ${bands[0]?.runs ?? 0} runs each, paying every bill, playing the plain story, with no assists; the median, then the middle half, and how many runs were still going when fewer. A run's number marked * was played with an assist.`
      : 'No bots were run (--bots 0).';
  return [
    `# Playtest reports: ${reports.length} run${reports.length === 1 ? '' : 's'}`,
    '',
    'A handful of runs gives leads, not measurements: each number says how many runs it comes from.',
    '',
    ...runsTable(reports),
    '',
    '## Rings after each night',
    '',
    botNote,
    '',
    ...ringsTable(reports, bands),
    ...(places(reports, bands).length > 0 ? ['', ...places(reports, bands)] : []),
    '',
    '## Judging, day by day',
    '',
    ...judgingTable(reports),
    '',
    '## Souls sent wrong, by the rule they broke',
    '',
    ...rulesTable(reports),
    '',
    '## Pleas and kin',
    '',
    ...pleasLine(reports),
    '',
  ].join('\n');
}
