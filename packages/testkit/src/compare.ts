import type { Content } from '@cots/engine';
import { type Judging, type NightStrategy, type RunResult, type SimOptions, simulateRun } from './campaign-sim';

/*
 * The tuning workbench (docs/tech-spec.md §63): the same bots on the same seeds, once with the content as built and
 * once with some of its numbers changed, and what changed between each pair of runs. Pairing takes most of the luck
 * out of the difference: each seed's bot meets the same souls and rolls the same dice until the change sends its run
 * another way.
 *
 * A change names a place in the compiled content (`campaign.minSunS`, `days[4].economy.wage`,
 * `campaign.shop[up.meadHorn].price`, `days[*].sunS`) and sets it (`=`), adds to it or takes from it (`+=`, `-=`), or
 * scales it (`*=`, rounded).
 * The place must exist and keep its type, so a misspelt path fails instead of comparing nothing. The variant skips
 * the compiler's lints: a value the compiler would refuse can make a run throw, and the compare says which.
 */

export type OverrideOp = '=' | '+=' | '-=' | '*=';

/** One change to the content, as `--set` takes it. */
export interface Override {
  readonly path: string;
  readonly op: OverrideOp;
  readonly value: unknown;
}

/** What a change did at one place: the place, found (`days[4].sunS`), and its value before and after. */
export interface Change {
  /** Which of the changes asked for did it, from 0. */
  readonly by: number;
  readonly at: string;
  readonly from: unknown;
  readonly to: unknown;
}

type Segment = { readonly key: string } | { readonly select: string };

/** `path=value`, `path+=n`, `path-=n` or `path*=n`; the value is JSON when it parses as JSON, and text otherwise. */
export function parseOverride(text: string): Override {
  const eq = text.indexOf('=');
  const before = text[eq - 1];
  const op: OverrideOp = before === '+' ? '+=' : before === '-' ? '-=' : before === '*' ? '*=' : '=';
  const path = text.slice(0, op === '=' ? eq : eq - 1).trim();
  const raw = text.slice(eq + 1).trim();
  if (eq < 0 || path === '' || raw === '') {
    throw new Error(`"${text}" isn't a change: write path=value, path+=n, path-=n or path*=n`);
  }
  let value: unknown = raw;
  try {
    value = JSON.parse(raw);
  } catch {
    // Text, as written (an id, say).
  }
  if (op !== '=' && typeof value !== 'number') throw new Error(`"${text}": ${op} takes a number`);
  segments(path);
  return { path, op, value };
}

/** A path's steps: keys between dots, and selections in brackets (which may hold dots: `shop[upg.lamp]`). */
function segments(path: string): Segment[] {
  const out: Segment[] = [];
  const bad = () => new Error(`"${path}" isn't a path: write keys between dots, and [id], [day], [index] or [*]`);
  let i = 0;
  while (i < path.length) {
    if (path[i] === '[') {
      const end = path.indexOf(']', i);
      if (end < 0 || end === i + 1) throw bad();
      out.push({ select: path.slice(i + 1, end).trim() });
      i = end + 1;
    } else {
      if (out.length > 0) {
        if (path[i] !== '.') throw bad();
        i++;
      }
      let j = i;
      while (j < path.length && path[j] !== '.' && path[j] !== '[') j++;
      const key = path.slice(i, j).trim();
      if (key === '' || path[i] === ']') throw bad();
      out.push({ key });
      i = j;
    }
  }
  if (out.length === 0) throw bad();
  return out;
}

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** The elements a bracket picks: `*` all; else the one whose id is it, or whose day is it, or at that index. */
function select(list: readonly unknown[], sel: string, where: string): number[] {
  if (sel === '*') return list.map((_, i) => i);
  const byId = list.findIndex((x) => isRecord(x) && x.id === sel);
  if (byId >= 0) return [byId];
  const n = /^\d+$/.test(sel) ? Number(sel) : undefined;
  const byDay = list.findIndex((x) => isRecord(x) && x.day === n);
  if (n !== undefined && byDay >= 0) return [byDay];
  if (
    n !== undefined &&
    list.every((x) => !isRecord(x) || (x.id === undefined && x.day === undefined)) &&
    n < list.length
  )
    return [n];
  const ids = list.flatMap((x) =>
    isRecord(x) && (typeof x.id === 'string' || typeof x.day === 'number') ? [x.id ?? x.day] : [],
  );
  const has =
    ids.length > 0 ? `it has ${ids.slice(0, 12).join(', ')}${ids.length > 12 ? ', …' : ''}` : `it has ${list.length}`;
  throw new Error(`${where} has no [${sel}]: ${has}`);
}

/** The places a path names in `root`, each as its parent and key, with the path as found. */
function places(
  root: unknown,
  path: string,
): { parent: Record<string, unknown> | unknown[]; key: string | number; at: string }[] {
  let here: { node: unknown; at: string }[] = [{ node: root, at: '' }];
  const segs = segments(path);
  const found: { parent: Record<string, unknown> | unknown[]; key: string | number; at: string }[] = [];
  segs.forEach((seg, k) => {
    const last = k === segs.length - 1;
    const next: { node: unknown; at: string }[] = [];
    for (const { node, at } of here) {
      const where = at === '' ? 'the content' : at;
      if ('key' in seg) {
        if (!isRecord(node) || !Object.hasOwn(node, seg.key)) {
          const keys = isRecord(node)
            ? Object.keys(node).join(', ')
            : Array.isArray(node)
              ? 'a list: select with [ ]'
              : 'a value';
          throw new Error(`${where} has no "${seg.key}" (${isRecord(node) ? `it has ${keys}` : `it's ${keys}`})`);
        }
        const to = at === '' ? seg.key : `${at}.${seg.key}`;
        if (last) found.push({ parent: node, key: seg.key, at: to });
        else next.push({ node: node[seg.key], at: to });
      } else {
        if (!Array.isArray(node)) throw new Error(`${where} isn't a list, so [${seg.select}] picks nothing`);
        for (const i of select(node, seg.select, where)) {
          const item = node[i];
          const label =
            isRecord(item) && typeof item.id === 'string'
              ? item.id
              : isRecord(item) && typeof item.day === 'number'
                ? item.day
                : i;
          const to = `${at}[${label}]`;
          if (last) found.push({ parent: node, key: i, at: to });
          else next.push({ node: item, at: to });
        }
      }
    }
    here = next;
  });
  return found;
}

const kindOf = (x: unknown) => (Array.isArray(x) ? 'list' : x === null ? 'null' : typeof x);

/** A copy of the content with the changes made in order, and what each did; the content passed in is left alone. */
export function applyOverrides(
  content: Content,
  overrides: readonly Override[],
): { content: Content; changes: Change[] } {
  const copy = structuredClone(content) as unknown as Record<string, unknown>;
  const changes: Change[] = [];
  for (const [by, o] of overrides.entries()) {
    for (const { parent, key, at } of places(copy, o.path)) {
      const from = (parent as Record<string | number, unknown>)[key];
      let to: unknown;
      if (o.op === '=') {
        if (kindOf(from) !== kindOf(o.value)) throw new Error(`${at} is a ${kindOf(from)}, not a ${kindOf(o.value)}`);
        to = o.value;
      } else {
        if (typeof from !== 'number') throw new Error(`${at} is a ${kindOf(from)}: ${o.op} needs a number`);
        const by = o.value as number;
        to = o.op === '+=' ? from + by : o.op === '-=' ? from - by : Math.round(from * by);
      }
      if (typeof from === 'number' && Number.isInteger(from) && typeof to === 'number' && !Number.isInteger(to))
        throw new Error(`${at} takes whole numbers (the engine counts in them), not ${to}`);
      (parent as Record<string | number, unknown>)[key] = to;
      changes.push({ by, at, from, to });
    }
  }
  return { content: copy as unknown as Content, changes };
}

/** A paired difference: the two means, the mean difference and its 95% interval, and whether that holds 0. */
export interface Diff {
  readonly n: number;
  readonly base: number;
  readonly variant: number;
  readonly diff: number;
  readonly lo: number;
  readonly hi: number;
  /** The interval holds no difference: too little to tell from luck with these runs. */
  readonly noise: boolean;
}

/**
 * The mean of the pairs' differences, ± 1.96 standard errors (a normal approximation: fair from about 20 pairs; for
 * a share, rough when it sits near 0% or 100%).
 */
export function paired(base: readonly number[], variant: readonly number[]): Diff {
  const n = Math.min(base.length, variant.length);
  const mean = (xs: readonly number[]) => (xs.length > 0 ? xs.reduce((a, x) => a + x, 0) / xs.length : 0);
  const d = Array.from({ length: n }, (_, i) => (variant[i] ?? 0) - (base[i] ?? 0));
  const diff = mean(d);
  const sd = n > 1 ? Math.sqrt(d.reduce((a, x) => a + (x - diff) ** 2, 0) / (n - 1)) : Number.NaN;
  const half = n > 1 ? (1.96 * sd) / Math.sqrt(n) : Number.POSITIVE_INFINITY;
  const lo = diff - half;
  const hi = diff + half;
  return {
    n,
    base: mean(base.slice(0, n)),
    variant: mean(variant.slice(0, n)),
    diff,
    lo,
    hi,
    noise: !(lo > 0 || hi < 0),
  };
}

export interface Metric {
  readonly key: string;
  readonly label: string;
  /** A share of runs (shown in percent) or a number. */
  readonly kind: 'share' | 'number';
  /** The run's value, or null when the run has none (it ended before that night, or never fought). */
  readonly of: (r: RunResult) => number | null;
  /** Shown only when some run registers it (souls are left at dusk only when the bots are paced to leave them). */
  readonly unlessZero?: true;
}

/** Rings after a night, in runs that saw it. */
const ringsAfter = (night: number): Metric => ({
  key: `rings${night}`,
  label: `rings after night ${night}`,
  kind: 'number',
  of: (r) => r.ledger.find((l) => l.day === night)?.night?.rings ?? null,
});

/** What a comparison measures, with the nights whose rings it follows. */
export function metrics(nights: readonly number[]): Metric[] {
  return [
    { key: 'rings', label: 'rings at the end', kind: 'number', of: (r) => r.rings },
    { key: 'lowest', label: 'lowest rings', kind: 'number', of: (r) => r.lowest },
    { key: 'demoted', label: 'demoted', kind: 'share', of: (r) => (r.ending === 'ending.demoted' ? 1 : 0) },
    { key: 'familyLost', label: 'lost family', kind: 'share', of: (r) => (r.familyLost > 0 ? 1 : 0) },
    { key: 'day', label: 'days played', kind: 'number', of: (r) => r.day },
    { key: 'upgrades', label: 'upgrades', kind: 'number', of: (r) => r.upgrades },
    { key: 'left', label: 'souls left at dusk', kind: 'number', of: (r) => r.leftAtDusk, unlessZero: true },
    { key: 'fronts', label: 'fronts held', kind: 'number', of: (r) => r.fronts?.length ?? null },
    ...nights.map(ringsAfter),
  ];
}

export interface ProfileComparison {
  readonly judging: string;
  readonly strategy: NightStrategy;
  readonly runs: number;
  /** Pairs whose runs differ at all: none means the bots never met what changed. */
  readonly changed: number;
  readonly metrics: readonly { readonly metric: Metric; readonly diff: Diff }[];
  readonly endings: readonly { readonly ending: string; readonly base: number; readonly variant: number }[];
}

export interface CompareOptions {
  readonly seeds: number;
  /** How the bots play besides their judging and nights: the story, the scenes, their pace. */
  readonly sim?: SimOptions;
  /** The nights whose rings to follow. */
  readonly nights?: readonly number[];
}

/** The seeds' runs under the content as built and under the variant, for one kind of bot, set side by side. */
export function compareProfile(
  base: Content,
  variant: Content,
  judging: Judging,
  strategy: NightStrategy,
  options: CompareOptions,
): ProfileComparison {
  const seeds = Array.from({ length: options.seeds }, (_, i) => `c${i}`);
  const play = (content: Content, seed: string, which: string) => {
    try {
      return simulateRun(content, seed, judging, strategy, options.sim);
    } catch (e) {
      throw new Error(`The ${which} broke run ${seed} (${judging.name}, ${strategy}): ${(e as Error).message}`);
    }
  };
  const a = seeds.map((s) => play(base, s, 'content as built'));
  const b = seeds.map((s) => play(variant, s, 'variant'));
  const same = (x: RunResult, y: RunResult) =>
    x.ending === y.ending && x.rings === y.rings && JSON.stringify(x.ledger) === JSON.stringify(y.ledger);
  const changed = seeds.filter((_, i) => !same(a[i] as RunResult, b[i] as RunResult)).length;
  const measured = metrics(options.nights ?? []).map((metric) => {
    const pairs = seeds.flatMap((_, i) => {
      const x = metric.of(a[i] as RunResult);
      const y = metric.of(b[i] as RunResult);
      return x === null || y === null ? [] : [[x, y] as const];
    });
    return {
      metric,
      diff: paired(
        pairs.map(([x]) => x),
        pairs.map(([, y]) => y),
      ),
    };
  });
  const count = (runs: readonly RunResult[]) => {
    const out = new Map<string, number>();
    for (const r of runs) out.set(r.ending ?? 'none', (out.get(r.ending ?? 'none') ?? 0) + 1);
    return out;
  };
  const ca = count(a);
  const cb = count(b);
  const endings = [...new Set([...ca.keys(), ...cb.keys()])]
    .sort()
    .map((ending) => ({ ending, base: ca.get(ending) ?? 0, variant: cb.get(ending) ?? 0 }));
  return { judging: judging.name, strategy, runs: seeds.length, changed, metrics: measured, endings };
}

const signed = (x: number, digits: number) => {
  const t = Math.abs(x).toFixed(digits);
  return Number(t) === 0 ? t : `${x > 0 ? '+' : '-'}${t}`;
};

/** One kind of bot's comparison, as the CLI prints it. */
export function comparisonText(c: ProfileComparison): string {
  const lines = [`${c.judging} · ${c.strategy}: ${c.runs} pairs of runs, ${c.changed} changed`];
  if (c.changed === 0) {
    lines.push('  Nothing changed: these bots never met what the variant changes (they never question, hint or');
    lines.push('  compare wrongly, and never run out of sun unless --pace says so).');
    return lines.join('\n');
  }
  const rows = c.metrics
    .filter(
      ({ metric, diff: m }) =>
        m.n > 0 && !(metric.unlessZero && m.base === 0 && m.variant === 0 && m.lo === 0 && m.hi === 0),
    )
    .map(({ metric, diff }) => {
      const share = metric.kind === 'share';
      const v = (x: number) => (share ? `${(x * 100).toFixed(1)}%` : x.toFixed(1));
      const d = (x: number) => (share ? `${signed(x * 100, 1)} pts` : signed(x, 1));
      // Every pair the same: no change at all, which is not the same as a change too small to see.
      const same = diff.diff === 0 && diff.lo === 0 && diff.hi === 0;
      const ci = Number.isFinite(diff.lo) ? `(${d(diff.lo)} to ${d(diff.hi)})` : '(too few pairs)';
      return [
        `  ${metric.label.padEnd(22)}`,
        v(diff.base).padStart(8),
        v(diff.variant).padStart(9),
        (same ? 'same' : d(diff.diff)).padStart(11),
        same ? '' : `  ${ci}`,
        !same && diff.noise ? '  noise' : '',
        diff.n < c.runs ? `  [${diff.n} pairs]` : '',
      ]
        .join('')
        .trimEnd();
    });
  lines.push(
    `  ${'measure'.padEnd(22)}${'as built'.padStart(8)}${'variant'.padStart(9)}${'change'.padStart(11)}  (95% interval)`,
  );
  lines.push(...rows);
  const moved = c.endings.filter((e) => e.base !== e.variant);
  lines.push(
    moved.length === 0
      ? '  Endings: the same.'
      : `  Endings: ${moved.map((e) => `${e.ending} ${e.base} → ${e.variant}`).join(', ')}.`,
  );
  return lines.join('\n');
}
