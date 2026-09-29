import { resolve } from 'node:path';
import { buildTarget, loadPacks } from '@cots/content-compiler';
import { TARGETS } from '@cots/content-schema';
import { FACTIONS, type Faction } from '@cots/engine';
import { playScene, type SceneEnv, scenePaths } from '@cots/story';
import { expect, describe as group, it } from 'vitest';
import { sceneName, signOff } from './approve';
import { describe, flagsRead, parseExpr, type Wording } from './expr';
import { buildModel, type SceneDoc } from './model';
import { parseScene, type Row, readings } from './parse';
import { renderScript } from './render';

/*
 * The story script (docs/tech-spec.md §31): conditions in words, scenes read
 * as the game plays them, every line and option the game can show found in
 * the script, the flag index, signing off, and the page.
 */

const built = buildTarget(TARGETS['dev-full'], loadPacks(resolve(import.meta.dirname, '../../content/packs')));
const model = buildModel({ ...built, target: 'dev-full' });
// The days' scenes, and the origins' (docs/tech-spec.md §72).
const scenes: SceneDoc[] = [
  ...model.days.flatMap((d) => [d.morning, ...(d.desk ?? []), d.night].filter((s): s is SceneDoc => !!s)),
  ...model.origins.flatMap((o) => o.scenes),
];

const plain: Wording = {
  person: (id) => ({ brother: 'Ulf', sister: 'Asa', mother: 'Ragna' })[id] ?? id,
  power: (id) => id[0]?.toUpperCase() + id.slice(1),
  flag: (name) => name,
};
const words = (src: string) => describe(parseExpr(src), plain);

group('conditions', () => {
  it('reads the conditions scenes use, and says them in words', () => {
    expect(words('flag("ulf_debt")')).toBe('ulf_debt is set');
    expect(words('not flag("met_loki")')).toBe("met_loki isn't set");
    expect(words('home("brother")')).toBe('Ulf is at home');
    expect(words('not home("sister")')).toBe("Asa isn't at home");
    expect(words('sick("sister")')).toBe('Asa is sick');
    expect(words('rings() < 5')).toBe('you have fewer than 5 rings');
    expect(words('rings() >= 5')).toBe('you have 5 rings or more');
    expect(words('5 <= rings()')).toBe('you have 5 rings or more');
    expect(words('flag("truth") >= 3')).toBe('truth is 3 or more');
    expect(words('standing("hel") > 2')).toBe("Hel's standing is more than 2");
    expect(words('flag("loki_deal") || (flag("ulf_shipyard") && home("brother"))')).toBe(
      'loki_deal is set, or (ulf_shipyard is set and Ulf is at home)',
    );
    // Said the other way round, as "otherwise" and "not" need it.
    expect(words('not (flag("a") && home("brother"))')).toBe("a isn't set, or Ulf isn't at home");
    expect(words('not (rings() < 5)')).toBe('you have 5 rings or more');
    // Two of the run's numbers against each other.
    expect(words('flag("letters_honest") > flag("letters_kind")')).toBe('letters_honest is more than letters_kind');
    expect(words('not (flag("a") > flag("b"))')).toBe('a is at most b');
  });

  it('lists the flags a condition reads, and refuses what isn’t a condition', () => {
    expect(flagsRead(parseExpr('flag("a") && (flag("b") || not flag("c")) && home("brother")'))).toEqual([
      'a',
      'b',
      'c',
    ]);
    expect(() => parseExpr('flag("a") &&')).toThrow();
    expect(() => parseExpr('ulf_debt')).toThrow(/isn't one of the game's functions/);
  });
});

const SAMPLE = `# draft
// FIRST DRAFT: rewrite or sign off.
EXTERNAL flag(name)
EXTERNAL home(id)
{ not home("brother"): -> away }
"Good news." # speaker: ulf
{ flag("ulf_debt"):
  "It would pay the fine." # speaker: ulf
- else:
  "Nothing owed." # speaker: ulf
}
* ["Go."]
  # fx: flag ulf_shipyard
  # fx: rings +10
  He goes.
* { flag("met_loki") } [Ask what they build. #needs: rings 5]
  "A ship." # speaker: ulf
  ** ["Stay."]
     # fx: flag ulf_home
     He stays, and your {home("sister"):sister|family} cheers.
- The hall counts rings.
-> END

=== away ===
{
- home("mother"):
  Mother writes.
- else:
  Nobody writes.
}
-> END
`;

group('reading a scene', () => {
  const parsed = parseScene(SAMPLE, 'sample.ink');
  const kinds = parsed.rows.map((r) => `${r.level}:${r.kind}`);

  it('reads every kind of row the scenes use, nested as the game plays them', () => {
    expect(parsed.draft).toBe(true);
    expect(kinds).toEqual([
      '0:jump',
      '0:line',
      '0:if',
      '1:line',
      '0:else',
      '1:line',
      '0:choice',
      '1:effects',
      '1:line',
      '0:choice',
      '1:line',
      '1:choice',
      '2:effects',
      '2:line',
      '0:gather',
      '0:line',
      '0:jump',
      '0:part',
      '0:if',
      '1:line',
      '0:else',
      '1:line',
      '0:jump',
    ]);
    const choice = parsed.rows.find(
      (r): r is Extract<Row, { kind: 'choice' }> => r.kind === 'choice' && r.depth === 1 && !!r.cond,
    );
    expect(choice).toMatchObject({ text: 'Ask what they build.', rings: 5, sticky: false, line: 16 });
    const fx = parsed.rows.find((r) => r.kind === 'effects');
    expect(fx).toMatchObject({ effects: [{ flag: 'ulf_shipyard', set: 1 }, { rings: 10 }] });
    const inline = parsed.rows.find((r): r is Extract<Row, { kind: 'line' }> => r.kind === 'line' && r.line === 20);
    expect(inline && readings(inline.text)).toEqual([
      'He stays, and your sister cheers.',
      'He stays, and your family cheers.',
    ]);
    expect(parsed.rows[1]).toMatchObject({ kind: 'line', speaker: 'ulf', text: ['"Good news."'] });
  });

  it('refuses Ink the script can’t show rather than show it wrong', () => {
    expect(() => parseScene('VAR x = 1\nHello.')).toThrow(/doesn't read/);
    expect(() => parseScene('~ x = 2')).toThrow(/doesn't read/);
    expect(() => parseScene('A {~coin|shell}.')).toThrow(/isn't a condition/);
    expect(() => parseScene('{ flag("a"):\nText.')).toThrow(/never closed/);
    expect(() => parseScene('Text. -> away')).toThrow(/middle of a line/);
  });
});

/** Runs that bracket a scene's day, as the compiler walks them: fresh, gone badly, gone well. */
function envs(day: number): SceneEnv[] {
  const family = model.family.map((m) => m.id);
  const standing = (n: number) => Object.fromEntries(FACTIONS.map((f) => [f, n])) as Record<Faction, number>;
  const every = (n: number): Record<string, number> => new Proxy({}, { get: () => n });
  const status = (s: (i: number) => string) => Object.fromEntries(family.map((id, i) => [id, s(i)]));
  return [
    { seed: 1, day, rings: 10, flags: {}, standing: standing(0), family: status(() => 'well') },
    { seed: 2, day, rings: -25, flags: every(1), standing: standing(-3), family: status(() => 'sick') },
    {
      seed: 3,
      day,
      rings: 80,
      flags: every(3),
      standing: standing(4),
      family: status((i) => (i === 0 ? 'gone' : 'well')),
    },
  ];
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

group('the script against the game', () => {
  it('has every scene the build ships, each played on its day (at the desk too)', () => {
    expect(scenes.map((s) => s.id).sort()).toEqual(built.scenes.map((s) => s.id).sort());
    expect(scenes.filter((s) => s.when === 'desk').map((s) => s.name)).toEqual([
      'd11.desk',
      'd15.desk',
      'd17.desk',
      'd18.desk',
    ]);
    expect(scenes.every((s) => s.id === `scene.${s.name}` && s.file.endsWith(`${s.name}.ink`))).toBe(true);
    expect(model.totals.words).toBe(scenes.reduce((n, s) => n + s.words, 0));
  });

  it('shows every line and option the game can show, on every path through every scene', () => {
    const json = new Map(built.scenes.map((s) => [s.id, s.json]));
    let checked = 0;
    for (const s of scenes) {
      const said = new Set(
        s.rows.flatMap((r) => (r.kind === 'line' ? readings(r.text) : r.kind === 'choice' ? [norm(r.text)] : [])),
      );
      for (const env of envs(s.day)) {
        const story = json.get(s.id) as object;
        for (const path of scenePaths(story, env)) {
          for (const line of playScene(story, env, path.choices).lines) {
            expect(said.has(norm(line.text)), `${s.file}: "${line.text}"`).toBe(true);
            checked++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(2000);
  });

  it('indexes where each flag is set and read', () => {
    const flag = (name: string) => model.flags.find((f) => f.name === name);
    // Ulf's shipyard: two options on Day 9's night and the slice's jump set it; later nights, a thread and Day 17 read it.
    const shipyard = flag('ulf_shipyard');
    expect(shipyard?.setBy.map((m) => [m.where, m.detail])).toEqual([
      ['Day 9, night', '“"Go. We need the silver."”'],
      ['Day 9, night', '“"Ask him what they\'re building."” → “"Go, then."”'],
      ["The vertical slice's jump to Day 12", 'stands in for the skipped days'],
    ]);
    const readers = shipyard?.readBy.map((m) => m.where) ?? [];
    expect(readers).toEqual(
      expect.arrayContaining([
        'Day 11, night',
        'Day 17, night',
        "Journal thread: Ulf still owes the jarl his share of the smith's fine.",
        'Journal thread: Ulf is shaping planks at a shipyard in the north, for a man with very clean hands.',
      ]),
    );
    // Each place once, however many of its lines read the flag.
    expect(new Set(readers).size).toBe(readers.length);
    // Story souls' stamps, and endings.
    expect(flag('geir_hel')?.setBy[0]).toMatchObject({ where: 'Day 6, Geir Hallsson', detail: 'stamped HEL' });
    expect(flag('wood')?.readBy.map((m) => m.where)).toContain('Ending: The green earth');
    // Every flag something reads is set somewhere.
    expect(model.flags.filter((f) => f.setBy.length === 0).map((f) => f.name)).toEqual([]);
  });
});

group('signing off', () => {
  it('removes the draft mark and the draft comment, and nothing else', () => {
    const { source, changed } = signOff(SAMPLE);
    expect(changed).toBe(true);
    expect(source.split('\n').slice(0, 2)).toEqual(['EXTERNAL flag(name)', 'EXTERNAL home(id)']);
    expect(source).toBe(SAMPLE.split('\n').slice(2).join('\n'));
    expect(parseScene(source).draft).toBe(false);
    expect(signOff(source)).toEqual({ source, changed: false });
    // A comment that isn't the draft note stays.
    expect(signOff("# draft\n// Ulf's letter.\nHi.").source).toBe("// Ulf's letter.\nHi.");
  });

  it('takes a scene by any of its names', () => {
    expect(['d9.night', 'scene.d9.night', 'd9.night.ink'].map(sceneName)).toEqual(['d9.night', 'd9.night', 'd9.night']);
  });
});

group('the page', () => {
  const { body, document } = renderScript(model, '2026-09-24');

  it('holds every day, scene, line and flag, with the review controls', () => {
    expect(body.startsWith('<title>Chooser Story Script</title>')).toBe(true);
    for (const s of scenes) {
      expect(body).toContain(`id="scene-${s.name.replace(/\./g, '-')}"`);
      expect(body).toContain(`data-review="${s.name}"`);
    }
    for (const f of model.flags) expect(body).toContain(`id="flag-${f.name}"`);
    expect(body).toContain('Only if'.toLowerCase());
    expect(document.startsWith('<!doctype html>')).toBe(true);
    expect(document).toContain(body);
  });

  it('escapes the story’s text', () => {
    // One script: the page's own. Nothing from the story can add another.
    expect(body.match(/<script/g)).toHaveLength(1);
    // Quotes in lines are entities, never left to close an attribute.
    expect(body).toContain('&quot;What if they lie?&quot;');
  });
});
