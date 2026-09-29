import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { type Content, type Effect, FACTIONS, type Faction, type FamilyDef } from '@cots/engine';
import { EXTERNALS, parseFx, parseNeeds, type SceneEnv, walkScene } from '@cots/story';
import { Compiler } from 'inkjs/full';
import { ContentError } from './errors';

/*
 * Ink scenes (docs/tech-spec.md §5.4): one compiled story per file in a
 * pack's `scenes/` folder, id `scene.<file name>`. Scenes read the run through
 * the story package's externals and change it only through `# fx:` tags.
 */

export interface CompiledScene {
  readonly id: string;
  readonly file: string;
  /** Compiled Ink JSON, as inkjs's Story takes it. */
  readonly json: object;
  /** Marked `# draft` at the top: placeholder writing to be replaced. */
  readonly draft: boolean;
  /** Ink's own word count, for the writing budget. */
  readonly words: number;
  /** Ids from `# speaker:` tags; each needs a `speaker.<id>` string. */
  readonly speakers: readonly string[];
}

const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, ' '));

/** Compiles one `.ink` file, failing on any Ink error or warning and on anything a scene may not do. */
export function compileScene(file: string, source: string): CompiledScene {
  const name = basename(file, '.ink');
  const problems: string[] = [];
  if (!/^[a-z0-9]+(\.[a-z0-9-]+)*$/.test(name)) {
    problems.push('Scene files are named like "d3.morning.ink" (lower case, dots between words).');
  }
  const code = stripComments(source);
  if (/^\s*INCLUDE\b/m.test(code)) problems.push('A scene is one file; INCLUDE isn’t supported.');
  for (const m of code.matchAll(/^\s*EXTERNAL\s+([A-Za-z_]\w*)/gm)) {
    const fn = m[1] as string;
    if (!(EXTERNALS as readonly string[]).includes(fn)) {
      problems.push(`EXTERNAL ${fn} isn't one the game provides (${EXTERNALS.join(', ')}).`);
    }
  }
  code.split('\n').forEach((line, i) => {
    // What an option costs goes inside its brackets, where Ink gives the tag to the option itself.
    for (const m of line.matchAll(/#\s*(needs:[^#\]\n]*)/g)) {
      if (!/^\s*[*+][^[]*\[[^\]]*#\s*needs:[^\]]*\]/.test(line)) {
        problems.push(
          `line ${i + 1}: put a needs tag inside the option's brackets: * [Send twenty rings. #needs: rings 20]`,
        );
      }
      try {
        parseNeeds((m[1] as string).trim());
      } catch (e) {
        problems.push(`line ${i + 1}: ${(e as Error).message}`);
      }
    }
    if (!/^\s*[*+]/.test(line)) return;
    // A tag on a choice line can end up on the choice alone, where it never fires.
    if (/#\s*fx:/.test(line)) {
      problems.push(`line ${i + 1}: put effect tags on the line after the choice, not on the choice.`);
    }
    // The game echoes the picked option, so its whole text goes in brackets and the reply on the next line.
    else if (!/^\s*[*+][\s*+]*(\(\w+\)\s*)?(\{[^}]*\}\s*)*\[[^\]]+\]\s*(->\s*[\w.]+\s*)?$/.test(line)) {
      problems.push(`line ${i + 1}: write a choice as [its whole text] and what follows on the next line.`);
    }
  });
  // Every effect tag must parse, whether or not a walk reaches it, and be plain text.
  for (const m of code.matchAll(/#\s*(fx:[^#\n]*)/g)) {
    const tag = (m[1] as string).trim();
    if (/[{}]/.test(tag)) problems.push(`"${tag}": effect tags must be plain text.`);
    else {
      try {
        parseFx(tag);
      } catch (e) {
        problems.push((e as Error).message);
      }
    }
  }
  if (problems.length > 0) throw new ContentError(`${file}\n${problems.join('\n')}`);

  const compiler = new Compiler(source);
  let story: ReturnType<Compiler['Compile']>;
  try {
    story = compiler.Compile();
  } catch (e) {
    const errors = compiler.errors.length > 0 ? compiler.errors : [(e as Error).message];
    throw new ContentError(`${file}\n${errors.join('\n')}`);
  }
  const issues = [...compiler.errors, ...compiler.warnings];
  if (issues.length > 0) throw new ContentError(`${file}\n${issues.join('\n')}`);
  return {
    id: `scene.${name}`,
    file,
    json: JSON.parse(story.ToJson() as string) as object,
    draft: (story.globalTags ?? []).some((t) => t.trim() === 'draft'),
    words: compiler.GenerateStats()?.words ?? 0,
    speakers: [...new Set([...code.matchAll(/#\s*speaker:\s*([^\s#]+)/g)].map((m) => m[1] as string))].sort(),
  };
}

/** Compiles a pack's `scenes/*.ink`. */
export function loadScenes(dir: string): CompiledScene[] {
  const scenesDir = join(dir, 'scenes');
  if (!existsSync(scenesDir)) return [];
  return readdirSync(scenesDir)
    .filter((f) => f.endsWith('.ink'))
    .sort()
    .map((f) => compileScene(join(scenesDir, f), readFileSync(join(scenesDir, f), 'utf8')));
}

const standingAll = (n: number) => Object.fromEntries(FACTIONS.map((f) => [f, n])) as Record<Faction, number>;
/** Every flag reads as `n`, whatever its name. */
const flagsAll = (n: number): Record<string, number> => new Proxy({}, { get: () => n });

/**
 * Runs that bracket what a scene can meet on its day: a fresh start, a run
 * gone badly (everyone sick, every flag set, in debt, out of favour) and a run
 * gone well with someone already gone. Not a proof over all runs; the walk
 * covers every choice path in each.
 */
function sampleEnvs(content: Content, day: number, member?: FamilyDef): SceneEnv[] {
  const family = [...(content.campaign?.family ?? []), ...(member ? [member] : [])];
  const status = (s: (i: number) => string) => Object.fromEntries(family.map((m, i) => [m.id, s(i)]));
  return [
    {
      seed: 1,
      day,
      rings: content.campaign?.startRings ?? 0,
      flags: {},
      standing: standingAll(0),
      family: status(() => 'well'),
    },
    { seed: 2, day, rings: -25, flags: flagsAll(1), standing: standingAll(-3), family: status(() => 'sick') },
    {
      seed: 3,
      day,
      rings: 80,
      flags: flagsAll(3),
      standing: standingAll(4),
      family: status((i) => (i === 0 ? 'gone' : 'well')),
    },
  ];
}

/** Scene references, speakers and walks for one target (docs/tech-spec.md §10, "Ink"). */
export function lintScenes(
  content: Content,
  scenes: readonly CompiledScene[],
  strings: Readonly<Record<string, string>>,
): string[] {
  const problems: string[] = [];
  for (const scene of scenes) {
    for (const who of scene.speakers) {
      if (!(`speaker.${who}` in strings)) problems.push(`${scene.file} uses missing string "speaker.${who}".`);
    }
  }
  const byId = new Map(scenes.map((s) => [s.id, s]));
  const playedOn = new Map<string, number[]>();
  for (const d of content.days) {
    const played = [
      ...Object.entries(d.scenes ?? {}),
      // Scenes at the desk (docs/tech-spec.md §46), between the souls of the day's line.
      ...(d.queue.visits ?? []).map((v): [string, string] => [`at the desk, after ${v.at} souls`, v.scene]),
    ];
    for (const [when, id] of played) {
      if (!id) continue;
      if (!byId.has(id)) problems.push(`day ${d.day} plays missing scene "${id}" (${when}).`);
      else playedOn.set(id, [...(playedOn.get(id) ?? []), d.day]);
    }
    for (const v of d.queue.visits ?? []) {
      if (v.at >= d.queue.count[0]) problems.push(`day ${d.day} plays ${v.scene} past the end of its shortest line.`);
    }
  }
  // An origin's own scenes (docs/tech-spec.md §72), each after one of its day's, with whoever the origin brings home.
  const brings = new Map<string, FamilyDef>();
  for (const o of content.campaign?.origins ?? []) {
    for (const sc of o.scenes) {
      if (!byId.has(sc.scene)) problems.push(`origin ${o.id} plays missing scene "${sc.scene}".`);
      else playedOn.set(sc.scene, [...(playedOn.get(sc.scene) ?? []), sc.day]);
      if (o.member) brings.set(sc.scene, o.member);
    }
  }
  if (content.daily?.scenes || content.primer?.scenes) problems.push('The Daily and the primer have no story scenes.');
  if (content.daily?.queue.visits || content.primer?.queue.visits) {
    problems.push('The Daily and the primer have no one at the desk.');
  }
  const family = new Set([
    ...(content.campaign?.family ?? []).map((m) => m.id),
    ...(content.campaign?.origins ?? []).flatMap((o) => o.member?.id ?? []),
  ]);
  const checkEffect = (e: Effect, where: string) => {
    if ('family' in e && !family.has(e.family)) problems.push(`${where} changes unknown family member "${e.family}".`);
  };
  for (const scene of scenes) {
    const days = playedOn.get(scene.id);
    if (!days) {
      problems.push(`${scene.file}: no day plays ${scene.id}.`);
      continue;
    }
    for (const day of days) {
      for (const env of sampleEnvs(content, day, brings.get(scene.id))) {
        try {
          const walk = walkScene(scene.json, env);
          for (const path of walk.effects) for (const e of path) checkEffect(e, scene.file);
        } catch (e) {
          problems.push(`${scene.file} (day ${day}): ${(e as Error).message}`);
          break;
        }
      }
    }
  }
  return [...new Set(problems)];
}
