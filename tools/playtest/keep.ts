import { isRunSave, type RunSave } from '@cots/engine';

/*
 * A tester's campaign saves, kept as test files (docs/tech-spec.md §63): taken from a backup (Settings, on the title
 * screen), one file a slot, in tests/fixtures/playtests. A test opens each with the current build, so a change that
 * would break a tester's run fails before it ships. A save holds a seed, the actions taken, the souls' generated
 * names and the choices made: nothing about the tester.
 *
 * The backup's envelope is checked here as the game checks it (packages/ui/src/save-data.ts, parseBackup and
 * validSlot): that module brings the browser's store with it, so the tools can't import it. Each save gets the
 * engine's own check.
 */

export interface KeptSave {
  readonly format: 'cots.playtest-save';
  readonly v: 1;
  /** Who it came from, as the file is named. */
  readonly name: string;
  /** The slot it was in, from 1. */
  readonly slot: number;
  /** The build the backup was made by, and when. */
  readonly build: { readonly target: string; readonly edition: string; readonly content: string };
  readonly made: string;
  readonly save: RunSave;
}

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** A name for files: lowercase letters, digits and dashes. */
export const fileName = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** The campaign saves in a backup's text, each ready to keep; or why there are none. */
export function keepable(text: string, name: string): KeptSave[] | { readonly error: string } {
  const who = fileName(name);
  if (who === '') return { error: 'Give the tester a name: letters or digits.' };
  let x: unknown;
  try {
    x = JSON.parse(text.trim());
  } catch {
    return { error: "The file isn't JSON." };
  }
  if (!isObject(x) || x.format !== 'cots.backup' || typeof x.v !== 'number')
    return { error: "The file isn't a backup." };
  if (x.v > 1) return { error: 'The file is from a newer version of the game.' };
  if (x.v !== 1 || !Array.isArray(x.slots)) return { error: "The file isn't a backup." };
  const b = isObject(x.build) ? x.build : {};
  const build = {
    target: typeof b.target === 'string' ? b.target : '?',
    edition: typeof b.edition === 'string' ? b.edition : '?',
    content: typeof b.content === 'string' ? b.content : '?',
  };
  const made = typeof x.made === 'string' ? x.made : '?';
  const kept = x.slots.flatMap((raw, i): KeptSave[] =>
    isObject(raw) && raw.v === 1 && typeof raw.rev === 'number' && isRunSave(raw.save)
      ? [{ format: 'cots.playtest-save', v: 1, name: who, slot: i + 1, build, made, save: raw.save }]
      : [],
  );
  return kept.length > 0 ? kept : { error: 'The backup has no campaign save the game can read.' };
}

/** Whether a kept file is one. */
export function isKeptSave(x: unknown): x is KeptSave {
  return isObject(x) && x.format === 'cots.playtest-save' && x.v === 1 && isRunSave(x.save);
}
