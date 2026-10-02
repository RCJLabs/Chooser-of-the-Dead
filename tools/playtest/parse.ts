/*
 * Reading the campaign playtest report (packages/ui/src/campaign/playtest.ts, docs/tech-spec.md §38, §63) back
 * into numbers. A report is Markdown: a header of bullets, a Days table in plain ASCII, and lists. It's read from
 * whatever a tester sent: the issue's body (its form headings around the report), or the report on its own. Older
 * builds' reports lack some columns (Sun left, Pressed, Arms, Nails, Vow) and the grade's lucky stamps; those read as
 * absent.
 */

export interface ReportDay {
  readonly day: number;
  /** The day's grade, and the liars caught before their stamp; absent in Story Mode and older saves. */
  readonly grade?: string;
  readonly liars?: { readonly caught: number; readonly of: number };
  /** Souls judged rightly on a guess (docs/tech-spec.md §76); absent where the build doesn't ask stamps for proof. */
  readonly lucky?: number;
  readonly assistedGrade: boolean;
  /** The vow sworn for the day (docs/tech-spec.md §75), by id, and whether it was kept; absent on a day with none. */
  readonly vow?: { readonly id: string; readonly kept: boolean };
  readonly right: number;
  readonly wrong: number;
  readonly unjudged: number;
  /** Sun left when the last soul was sent, in seconds (absent before builds that report it). */
  readonly sunLeftS?: number;
  /** Claims pressed, and lies that gave way (docs/tech-spec.md §66); absent before builds that report it. */
  readonly pressed?: { readonly n: number; readonly gave: number };
  readonly pay: number;
  readonly bonus: number;
  /** Negative, as the table signs it. */
  readonly fines: number;
  /** The rings after the night, when the night has come. */
  readonly rings?: number;
  readonly reprieve?: number;
  /** The assists the day was played with, as the report words them ('' for none). */
  readonly assists: string;
}

export interface ReportMistake {
  readonly day: number;
  /** A wrong stamp; the right stamp with a step skipped; or a count from a save that didn't itemise them. */
  readonly kind: 'wrong' | 'skipped' | 'count';
  readonly stamped?: string;
  readonly expected?: string;
  /** The rule that decided where the soul belonged, as the report quotes it (or its id, if the build lost it). */
  readonly rule?: string;
  readonly count: number;
  readonly noon: boolean;
  readonly bribe: boolean;
  readonly plea: boolean;
}

export interface Report {
  /** Where it came from: a file name, and its place in the file when there are several. */
  readonly label: string;
  readonly build?: string;
  readonly target?: string;
  readonly slot?: number;
  readonly seed?: string;
  readonly flags: readonly string[];
  readonly now?: { readonly day: number; readonly phase: string; readonly rings: number; readonly debtNights: number };
  readonly ending?: string;
  /** From the issue form, when it was filed through it. */
  readonly device?: string;
  readonly days: readonly ReportDay[];
  readonly mistakes: readonly ReportMistake[];
  /**
   * The pleas section's sums; absent in builds without pleas or kin. Offers taken and souls found out lying (docs/tech-
   * spec.md §73) where the report counts them.
   */
  readonly pleas?: {
    readonly asked: number;
    readonly granted: number;
    readonly kin: number;
    readonly offers?: number;
    readonly taken?: number;
    readonly lied?: number;
  };
}

const START = '## Playtest report';

/** Every report in a text (an issue's body, or several pasted together), labelled after `source`. */
export function parseReports(text: string, source: string): Report[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const starts = lines.flatMap((l, i) => (l.trim() === START ? [i] : []));
  return starts.map((start, k) => {
    const end = starts[k + 1] ?? lines.length;
    const label = starts.length > 1 ? `${source} #${k + 1}` : source;
    // The issue form's device question may come before or after the report.
    return parseReport(lines.slice(start, end), label, deviceOf(lines));
  });
}

/** The answer to the playtest form's "What did you play on?", if it was answered. */
function deviceOf(lines: readonly string[]): string | undefined {
  const at = lines.findIndex((l) => /^###\s+What did you play on\?/.test(l.trim()));
  if (at < 0) return undefined;
  const answer = lines.slice(at + 1).find((l) => l.trim() !== '');
  return answer && !/^_No response_$/.test(answer.trim()) && !answer.startsWith('#') ? answer.trim() : undefined;
}

/** The lines of a report's `### name` section, up to the next heading. */
function section(lines: readonly string[], name: string): string[] {
  const at = lines.findIndex((l) => l.trim() === `### ${name}`);
  if (at < 0) return [];
  const rest = lines.slice(at + 1);
  const end = rest.findIndex((l) => /^#{1,3}\s/.test(l.trim()));
  return end < 0 ? rest : rest.slice(0, end);
}

const bullet = (lines: readonly string[], name: string): string | undefined => {
  const prefix = `- **${name}:** `;
  return lines
    .find((l) => l.startsWith(prefix))
    ?.slice(prefix.length)
    .trim();
};

/** "+12", "-5", "0": a signed whole number. */
const num = (cell: string | undefined): number | undefined => {
  const m = /^([+-]?\d+)$/.exec((cell ?? '').trim());
  return m?.[1] !== undefined ? Number(m[1]) : undefined;
};

/** "1:23": seconds. */
const clock = (cell: string | undefined): number | undefined => {
  const m = /^(\d+):(\d{2})$/.exec((cell ?? '').trim());
  return m?.[1] !== undefined && m[2] !== undefined ? Number(m[1]) * 60 + Number(m[2]) : undefined;
};

const cellsOf = (row: string): string[] =>
  row
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());

function parseDays(lines: readonly string[]): ReportDay[] {
  const table = section(lines, 'Days').filter((l) => l.trim().startsWith('|'));
  const [head, , ...rows] = table;
  if (!head) return [];
  const heads = cellsOf(head);
  const col = (name: string, cells: readonly string[]) => {
    const i = heads.indexOf(name);
    return i >= 0 ? cells[i] : undefined;
  };
  return rows.flatMap((row) => {
    const cells = cellsOf(row);
    const day = num(col('Day', cells));
    if (day === undefined) return [];
    const g = /^(\w+) \((\d+)\/(\d+) liars(?:, (\d+) lucky)?\)(, assisted)?$/.exec(col('Grade', cells) ?? '');
    const vow = /^(\S+) (kept|broken)/.exec(col('Vow', cells) ?? '');
    const rings = /^(-?\d+)(?: \(reprieve ([+-]?\d+)\))?$/.exec(col('Rings after the night', cells) ?? '');
    const sun = clock(col('Sun left', cells));
    const pressed = /^(\d+)(?: \((\d+) gave way\))?$/.exec(col('Pressed', cells) ?? '');
    return [
      {
        day,
        ...(g?.[1] ? { grade: g[1], liars: { caught: Number(g[2]), of: Number(g[3]) } } : {}),
        ...(g?.[4] !== undefined ? { lucky: Number(g[4]) } : {}),
        assistedGrade: g?.[5] !== undefined,
        ...(vow?.[1] ? { vow: { id: vow[1], kept: vow[2] === 'kept' } } : {}),
        right: num(col('Right', cells)) ?? 0,
        wrong: num(col('Wrong', cells)) ?? 0,
        unjudged: num(col('Unjudged', cells)) ?? 0,
        ...(sun !== undefined ? { sunLeftS: sun } : {}),
        ...(pressed?.[1] !== undefined ? { pressed: { n: Number(pressed[1]), gave: Number(pressed[2] ?? 0) } } : {}),
        pay: num(col('Pay', cells)) ?? 0,
        bonus: num(col('Bonus', cells)) ?? 0,
        fines: num(col('Fines', cells)) ?? 0,
        ...(rings?.[1] !== undefined ? { rings: Number(rings[1]) } : {}),
        ...(rings?.[2] !== undefined ? { reprieve: Number(rings[2]) } : {}),
        assists: col('Assists', cells) ?? '',
      },
    ];
  });
}

function parseMistakes(lines: readonly string[]): ReportMistake[] {
  return section(lines, 'Mistakes').flatMap((line): ReportMistake[] => {
    const head = /^- Day (\d+): (.*)$/.exec(line.trim());
    if (!head?.[1] || head[2] === undefined) return [];
    const day = Number(head[1]);
    const text = head[2];
    const flags = {
      noon: text.includes(' After the noon decree.'),
      bribe: / A bribe: \d+ rings for the stamp\./.test(text),
      plea: text.includes(' A plea granted.'),
    };
    const count = /^(\d+) sent wrong \(not itemised/.exec(text);
    if (count?.[1]) return [{ day, kind: 'count', count: Number(count[1]), ...flags }];
    const skipped = /^the right stamp, (.+?), but a step skipped\./.exec(text);
    if (skipped?.[1]) return [{ day, kind: 'skipped', stamped: skipped[1], expected: skipped[1], count: 1, ...flags }];
    const wrong = /^stamped (.+?) for a soul that belonged in (.+?)\. The rule: (.*)$/.exec(text);
    if (!wrong?.[1] || !wrong[2] || wrong[3] === undefined) return [];
    const quoted = /^“([^”]*)”/.exec(wrong[3]);
    const rule = quoted?.[1] ?? wrong[3].split(' ')[0] ?? '';
    return [{ day, kind: 'wrong', stamped: wrong[1], expected: wrong[2], rule, count: 1, ...flags }];
  });
}

function parsePleas(lines: readonly string[]): Report['pleas'] {
  const body = section(lines, 'Pleas and kin');
  if (body.length === 0) return undefined;
  if (body.some((l) => l.trim() === 'Nobody asked yet.')) return { asked: 0, granted: 0, kin: 0 };
  const m = body.map((l) => /^Pleas: (\d+), granted: (\d+)\. Kin who came: (\d+)\.$/.exec(l.trim())).find(Boolean);
  if (!m) return undefined;
  const offers = body.map((l) => /^Offers: (\d+), taken: (\d+)\.$/.exec(l.trim())).find(Boolean);
  const lied = body.map((l) => /^Found out lying: (\d+)\.$/.exec(l.trim())).find(Boolean);
  return {
    asked: Number(m[1]),
    granted: Number(m[2]),
    kin: Number(m[3]),
    ...(offers ? { offers: Number(offers[1]), taken: Number(offers[2]) } : {}),
    ...(lied ? { lied: Number(lied[1]) } : {}),
  };
}

function parseReport(lines: readonly string[], label: string, device: string | undefined): Report {
  const build = bullet(lines, 'Build');
  const run = bullet(lines, 'Run') ?? '';
  const parts = run.split(' · ').map((p) => p.trim());
  const slot = /^slot (\d+)$/.exec(parts[0] ?? '');
  const seed = /^seed `([^`]*)`$/.exec(parts[1] ?? '');
  const now = /^Day (\d+), (.+?) · (-?\d+) rings(?: · (\d+) nights? in debt)?$/.exec(bullet(lines, 'Now') ?? '');
  const ending = bullet(lines, 'Ending');
  const pleas = parsePleas(lines);
  return {
    label,
    ...(build ? { build, target: build.split(' · ')[0]?.trim() } : {}),
    ...(slot?.[1] ? { slot: Number(slot[1]) } : {}),
    ...(seed?.[1] !== undefined ? { seed: seed[1] } : {}),
    flags: parts.slice(seed ? 2 : 1).filter((p) => p !== ''),
    ...(now?.[1] && now[2] && now[3]
      ? { now: { day: Number(now[1]), phase: now[2], rings: Number(now[3]), debtNights: Number(now[4] ?? 0) } }
      : {}),
    ...(ending ? { ending } : {}),
    ...(device ? { device } : {}),
    days: parseDays(lines),
    mistakes: parseMistakes(lines),
    ...(pleas ? { pleas } : {}),
  };
}
