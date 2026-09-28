import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { isTargetId } from '@cots/content-schema';
import { ENGINE_MAJOR, resumeSave } from '@cots/engine';
import { loadContent, loadScenes } from '@cots/testkit';
import { describe, expect, it } from 'vitest';
import { playtestReport } from '../../packages/ui/src/campaign/playtest';
import { isKeptSave } from './keep';
import { parseReports } from './parse';

/*
 * Every tester's save kept with `pnpm playtest:keep` (docs/tech-spec.md §63) still opens with this build, and its
 * report still reads back. A change that breaks one breaks a run a tester may still be playing. The bot's example is
 * there so the test has a save to open before any tester has sent one.
 */

const dir = resolve(import.meta.dirname, '../../tests/fixtures/playtests');
const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')) : [];

describe("testers' kept saves", () => {
  it('has at least one to open', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    it(`${file} opens with this build, and its report reads back`, () => {
      const kept: unknown = JSON.parse(readFileSync(join(dir, file), 'utf8'));
      if (!isKeptSave(kept)) throw new Error(`${file} isn't a kept save`);
      const target = isTargetId(kept.build.target) ? kept.build.target : 'dev-full';
      const content = loadContent(target);
      const { run } = resumeSave(kept.save, content, ENGINE_MAJOR);
      expect(run.day).toBe(kept.save.mornings.at(-1)?.day);
      const text = playtestReport({
        save: kept.save,
        run,
        slot: kept.slot - 1,
        build: `${kept.build.target} · kept`,
        content,
        scenes: loadScenes(target),
        t: (key) => key,
      });
      const [report] = parseReports(text, file);
      expect(report?.days.map((d) => d.day)).toEqual(run.ledger.map((l) => l.day));
      expect(report?.now?.rings).toBe(run.rings);
    });
  }
});
