/**
 * Playtest reports and saves (docs/tech-spec.md §63, docs/playtest.md).
 *
 *   pnpm playtest:read <file|folder|->… [--bots 20] [--target web-playtest] [--out summary.md]
 *     Sums up campaign playtest reports: each issue's body saved as a file (gh issue view N --json body -q .body > N.md),
 *     or reports pasted on their own; a folder reads every .md and .txt in it, and - reads stdin. Beside them, the bots'
 *     rings after each night: --bots runs of each profile (about 1.5 s a run; 0 skips them).
 *
 *   pnpm playtest:keep <backup.json> --name <tester>
 *     Keeps a tester's campaign saves, from a backup (Settings, on the title screen), as
 *     tests/fixtures/playtests/<tester>-slot<N>.json. A test opens every kept save with the current build.
 */
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { isTargetId } from '@cots/content-schema';
import { loadContent, loadScenes } from '@cots/testkit';
import { botBands } from './bots';
import { keepable } from './keep';
import { parseReports } from './parse';
import { summarize } from './summary';

const repoRoot = resolve(import.meta.dirname, '../..');
const [cmd, ...rest] = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
};
const FLAGS = new Set(['--bots', '--target', '--out', '--name']);
const positional = rest.filter((a, i) => !FLAGS.has(a) && !FLAGS.has(rest[i - 1] ?? ''));

function fail(message: string): never {
  console.error(message);
  process.exit(2);
}

/** Each file named, a folder's .md and .txt files, or stdin for -. */
function inputs(paths: readonly string[]): { name: string; text: string }[] {
  return paths.flatMap((p) => {
    if (p === '-') return [{ name: 'stdin', text: readFileSync(0, 'utf8') }];
    if (statSync(p).isDirectory()) {
      return readdirSync(p)
        .filter((f) => ['.md', '.txt'].includes(extname(f)))
        .sort()
        .map((f) => ({ name: basename(f, extname(f)), text: readFileSync(join(p, f), 'utf8') }));
    }
    return [{ name: basename(p, extname(p)), text: readFileSync(p, 'utf8') }];
  });
}

if (cmd === 'read') {
  if (positional.length === 0) fail('Name the reports to read: pnpm playtest:read reports/ (or files, or - for stdin)');
  const reports = inputs(positional).flatMap((f) => parseReports(f.text, f.name));
  if (reports.length === 0) fail('No playtest report found (each starts with "## Playtest report").');
  const target = flag('target') ?? 'web-playtest';
  if (!isTargetId(target)) fail(`No build target "${target}".`);
  const runs = Number(flag('bots') ?? '20');
  if (!Number.isInteger(runs) || runs < 0) fail('--bots takes a whole number of runs.');
  const started = performance.now();
  const bands = runs > 0 ? botBands(loadContent(target), loadScenes(target), runs) : [];
  const text = summarize(reports, bands);
  const out = flag('out');
  if (out) writeFileSync(out, text);
  else process.stdout.write(text);
  console.error(
    `playtest:read: ${reports.length} report${reports.length === 1 ? '' : 's'}${runs > 0 ? `, ${runs} bot runs a profile in ${((performance.now() - started) / 1000).toFixed(0)}s` : ''}${out ? `, written to ${out}` : ''}`,
  );
} else if (cmd === 'keep') {
  const [file] = positional;
  const name = flag('name');
  if (!file || !name) fail('Usage: pnpm playtest:keep <backup.json> --name <tester>');
  const kept = keepable(readFileSync(file, 'utf8'), name);
  if ('error' in kept) fail(`playtest:keep: ${kept.error}`);
  const dir = join(repoRoot, 'tests', 'fixtures', 'playtests');
  mkdirSync(dir, { recursive: true });
  for (const k of kept) {
    const path = join(dir, `${k.name}-slot${k.slot}.json`);
    writeFileSync(path, `${JSON.stringify(k)}\n`);
    const last = k.save.mornings.at(-1);
    console.log(`kept ${path.slice(repoRoot.length + 1)}: Day ${last?.day ?? '?'}, from ${k.build.target} (${k.made})`);
  }
} else {
  fail(
    'Usage: pnpm playtest:read <file|folder|->… [--bots N] [--target T] [--out F] | pnpm playtest:keep <backup.json> --name <tester>',
  );
}
