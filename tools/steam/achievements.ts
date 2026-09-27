/**
 * The achievements to set up in Steamworks (docs/steam.md), as a table to copy from: Steam's API name (what the shell
 * unlocks, apps/electron/src/steam.ts), the name and description players see, and whether it's hidden.
 *
 * Usage: pnpm steam:achievements [--demo]
 */
import { resolve } from 'node:path';
import { buildTarget, loadPacks } from '@cots/content-compiler';
import { TARGETS } from '@cots/content-schema';
import { steamName } from '../../apps/electron/src/steam';

const repoRoot = resolve(import.meta.dirname, '../..');
const target = process.argv.includes('--demo') ? 'electron-demo' : 'electron-full';
const { content, strings } = buildTarget(TARGETS[target], loadPacks(resolve(repoRoot, 'content/packs')));
const cell = (s: string | undefined) => (s ?? '(missing)').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

const achievements = content.achievements ?? [];
console.log(`${achievements.length} achievements in ${target}\n`);
console.log('| API name | Name | Description | Hidden |');
console.log('|---|---|---|---|');
for (const a of achievements) {
  console.log(
    `| ${steamName(a.id) ?? `(no Steam name for ${a.id})`} | ${cell(strings[a.title])} | ${cell(strings[a.text])} | ${a.hidden ? 'yes' : ''} |`,
  );
}
