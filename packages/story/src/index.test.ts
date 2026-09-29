import { FACTIONS, type JournalEntry } from '@cots/engine';
import { Compiler } from 'inkjs/full';
import { describe, expect, it } from 'vitest';
import { journalEnv, parseFx, parseNeeds, playScene, type SceneEnv, sceneEnv, scenePaths, walkScene } from './index';

const compile = (src: string) => {
  const story = new Compiler(src).Compile();
  return story.ToJson() as string;
};

const env = (over: Partial<SceneEnv> = {}): SceneEnv => ({
  seed: 7,
  day: 3,
  rings: 12,
  flags: {},
  standing: Object.fromEntries(FACTIONS.map((f) => [f, 0])) as SceneEnv['standing'],
  family: { mother: 'well', sister: 'sick', brother: 'gone' },
  word: 0,
  wrong: 0,
  ...over,
});

const SCENE = `
EXTERNAL flag(name)
EXTERNAL rings()
EXTERNAL sick(id)
Skögul waits by the gate. # speaker: skogul
{ flag("met_loki"): She has heard about Loki. }
{ sick("sister"): A letter: your sister is worse. }
* [Pay the healer]
  You send what you can. # fx: rings -5
  # fx: family sister well
* [Keep the rings]
  You keep them. # fx: flag kept_rings
- The day begins. # fx: standing odin +1
`;

describe('playScene', () => {
  it('stops at the first choice with the lines so far', () => {
    const f = playScene(compile(SCENE), env(), []);
    expect(f.done).toBe(false);
    expect(f.choices).toEqual([
      { text: 'Pay the healer', locked: false },
      { text: 'Keep the rings', locked: false },
    ]);
    expect(f.lines.map((l) => l.text)).toEqual(['Skögul waits by the gate.', 'A letter: your sister is worse.']);
    expect(f.lines[0]?.speaker).toBe('skogul');
    expect(f.effects).toEqual([]);
  });

  it('reads the run through externals', () => {
    const f = playScene(compile(SCENE), env({ flags: { met_loki: 1 }, family: { sister: 'well' } }), []);
    expect(f.lines.map((l) => l.text)).toEqual(['Skögul waits by the gate.', 'She has heard about Loki.']);
  });

  it('reads the word among the dead and the souls sent wrong so far (docs/tech-spec.md §74)', () => {
    const json = compile(
      [
        'EXTERNAL word()',
        'EXTERNAL wrong()',
        '{ word() <= -2: They say you can’t be moved. }',
        '{ word() >= 2: They say you can be moved. }',
        '{ wrong() >= 15: Do you sleep? }',
        'The raven waits.',
      ].join('\n'),
    );
    const said = (over: Partial<SceneEnv>) => playScene(json, env(over), []).lines.map((l) => l.text);
    expect(said({ word: -3, wrong: 20 })).toEqual([
      'They say you can’t be moved.',
      'Do you sleep?',
      'The raven waits.',
    ]);
    expect(said({ word: 2, wrong: 14 })).toEqual(['They say you can be moved.', 'The raven waits.']);
    expect(said({})).toEqual(['The raven waits.']);
  });

  it('collects effects in order along the chosen path', () => {
    const json = compile(SCENE);
    const pay = playScene(json, env(), [0]);
    expect(pay.done).toBe(true);
    expect(pay.effects).toEqual([{ rings: -5 }, { family: 'sister', becomes: 'well' }, { standing: 'odin', by: 1 }]);
    const keep = playScene(json, env(), [1]);
    expect(keep.effects).toEqual([
      { flag: 'kept_rings', set: 1 },
      { standing: 'odin', by: 1 },
    ]);
    expect(keep.lines.slice(-3)).toEqual([
      { text: 'Keep the rings', tags: [], chosen: true },
      { text: 'You keep them.', tags: ['fx: flag kept_rings'] },
      {
        text: 'The day begins.',
        tags: ['fx: standing odin +1'],
        effects: [
          { flag: 'kept_rings', set: 1 },
          { standing: 'odin', by: 1 },
        ],
      },
    ]);
  });

  it('files what a choice did on the last line before the next choice, or the end', () => {
    const json = compile(
      [
        'Morning. # fx: rings 1',
        '* [Help] You help.',
        '  # fx: standing hel +2',
        '* [Refuse] You refuse. # fx: standing hel -1',
        '- Noon.',
        '* [Go on]',
        '  # fx: flag went_on',
        '- ',
      ].join('\n'),
    );
    const first = playScene(json, env(), []);
    expect(first.lines).toEqual([{ text: 'Morning.', tags: ['fx: rings 1'], effects: [{ rings: 1 }] }]);
    const help = playScene(json, env(), [0]);
    // Ink gives the tag under "You help." to "Noon."; either way it's what the choice did.
    expect(help.lines.map((l) => [l.text, l.effects ?? []])).toEqual([
      ['Morning.', [{ rings: 1 }]],
      ['Help', []],
      ['You help.', []],
      ['Noon.', [{ standing: 'hel', by: 2 }]],
    ]);
    // A choice with no text after it keeps its effects on its own line.
    const end = playScene(json, env(), [1, 0]);
    expect(end.done).toBe(true);
    expect(end.lines.at(-1)).toEqual({ text: 'Go on', tags: [], chosen: true, effects: [{ flag: 'went_on', set: 1 }] });
    expect(end.effects).toEqual([{ rings: 1 }, { standing: 'hel', by: -1 }, { flag: 'went_on', set: 1 }]);
  });

  it('keeps what a choice did with its own part of the scene when a new beat follows (docs/tech-spec.md §50)', () => {
    const json = compile(
      [
        'The clerk has one soul left.',
        '* [Help him.]',
        '  # fx: standing clerk +1',
        '  He beams.',
        '- The soul goes through.',
        '-> letter',
        '=== letter ===',
        'A letter from home. # beat',
        '* [Fly home at dawn.]',
        '  # fx: sun -120',
        '  You will be late.',
        '- -> END',
      ].join('\n'),
    );
    const f = playScene(json, env(), [0]);
    expect(f.lines.map((l) => [l.text, l.effects ?? []])).toEqual([
      ['The clerk has one soul left.', []],
      ['Help him.', []],
      ['He beams.', []],
      ['The soul goes through.', [{ standing: 'clerk', by: 1 }]],
      ['A letter from home.', []],
    ]);
    expect(playScene(json, env(), [0, 0]).lines.at(-1)).toMatchObject({
      text: 'You will be late.',
      effects: [{ sun: -120 }],
    });
  });

  it('is the same every time for the same seed and choices', () => {
    const json = compile('~ temp r = RANDOM(1, 1000)\nRolled {r}.\n* [a] A.\n* [b] B.\n- {shuffle: x|y|z}');
    const a = playScene(json, env({ seed: 99 }), [1]);
    const b = playScene(json, env({ seed: 99 }), [1]);
    expect(b).toEqual(a);
  });

  it('rejects a choice that is not offered', () => {
    expect(() => playScene(compile(SCENE), env(), [2])).toThrow(RangeError);
  });
});

describe('what an option costs', () => {
  const COSTLY = compile(
    [
      'EXTERNAL rings()',
      'The healer names her price.',
      '* [Send twenty rings. #needs: rings 20]',
      '  # fx: rings -20',
      '  You send them.',
      '* [Wait.] You wait.',
      '- Night.',
    ].join('\n'),
  );

  it('shows an option the run can’t afford, locked, with what it needs', () => {
    const poor = playScene(COSTLY, env({ rings: 12 }), []);
    expect(poor.choices).toEqual([
      { text: 'Send twenty rings.', rings: 20, locked: true },
      { text: 'Wait.', locked: false },
    ]);
    expect(() => playScene(COSTLY, env({ rings: 12 }), [0])).toThrow(RangeError);
    const rich = playScene(COSTLY, env({ rings: 20 }), []);
    expect(rich.choices[0]).toEqual({ text: 'Send twenty rings.', rings: 20, locked: false });
    expect(playScene(COSTLY, env({ rings: 20 }), [0]).effects).toEqual([{ rings: -20 }]);
  });

  it('never walks a locked option, and a point where every option is locked is an error', () => {
    expect(scenePaths(COSTLY, env({ rings: 12 })).map((p) => p.choices)).toEqual([[1]]);
    expect(scenePaths(COSTLY, env({ rings: 20 })).map((p) => p.choices)).toEqual([[0], [1]]);
    const stuck = compile('* [Pay. #needs: rings 5] Paid.\n* [Pay more. #needs: rings 9] Paid more.');
    expect(() => scenePaths(stuck, env({ rings: 1 }))).toThrow(/every option needs more rings/);
  });

  it('reads needs tags, and rejects malformed ones', () => {
    expect(parseNeeds('needs: rings 20')).toEqual({ rings: 20 });
    expect(parseNeeds('speaker: skogul')).toBeNull();
    expect(() => parseNeeds('needs: 20 rings')).toThrow(/malformed needs tag/);
  });
});

describe('journalEnv', () => {
  it('gives a scene the view it had when it was played', () => {
    const e = env({ flags: { met_loki: 1 }, rings: 30, word: -2, wrong: 5 });
    const entry: JournalEntry = {
      day: e.day,
      scene: 'scene.d3.night',
      choices: [1],
      rings: e.rings,
      flags: e.flags,
      standing: e.standing,
      family: e.family as JournalEntry['family'],
      word: e.word,
      wrong: e.wrong,
    };
    const run = {
      seed: 'journal-seed',
      day: e.day,
      rings: e.rings,
      flags: e.flags,
      standing: e.standing,
      family: [],
      word: e.word,
      ledger: [{ wrong: 2 }, { wrong: 3 }],
    };
    expect(journalEnv('journal-seed', entry)).toEqual({
      ...sceneEnv(run as never, 'scene.d3.night'),
      family: e.family,
    });
  });

  it('reads an entry kept before the journal held the word and the souls sent wrong as neither yet', () => {
    const e = env();
    const entry: JournalEntry = {
      day: e.day,
      scene: 'scene.d3.night',
      choices: [],
      rings: e.rings,
      flags: e.flags,
      standing: e.standing,
      family: e.family as JournalEntry['family'],
    };
    expect(journalEnv('journal-seed', entry)).toMatchObject({ word: 0, wrong: 0 });
  });
});

describe('parseFx', () => {
  it('parses every effect form', () => {
    expect(parseFx('fx: rings -5')).toEqual({ rings: -5 });
    expect(parseFx('fx: rings +3')).toEqual({ rings: 3 });
    expect(parseFx(' fx: standing freyja +1')).toEqual({ standing: 'freyja', by: 1 });
    expect(parseFx('fx: flag owes_loki')).toEqual({ flag: 'owes_loki', set: 1 });
    expect(parseFx('fx: flag thorvald +1')).toEqual({ flag: 'thorvald', inc: 1 });
    expect(parseFx('fx: flag deals = 2')).toEqual({ flag: 'deals', set: 2 });
    expect(parseFx('fx: family sister sick')).toEqual({ family: 'sister', becomes: 'sick' });
    expect(parseFx('fx: family mother gone')).toEqual({ family: 'mother', becomes: 'gone' });
    expect(parseFx('fx: sun -120')).toEqual({ sun: -120 });
    expect(parseFx('fx: sun +60')).toEqual({ sun: 60 });
  });

  it('ignores other tags and throws on malformed effects', () => {
    expect(parseFx('speaker: skogul')).toBeNull();
    for (const bad of [
      'fx: rings',
      'fx: rings five',
      'fx: standing thor +1',
      'fx: flag a-b',
      'fx: family x dead',
      'fx: sun',
      'fx: sun soon',
      'fx: gold 5',
    ]) {
      expect(() => parseFx(bad), bad).toThrow();
    }
  });
});

describe('walkScene', () => {
  it('visits every path to its end', () => {
    const w = walkScene(compile(SCENE), env());
    expect(w.paths).toBe(2);
    expect(w.effects.map((e) => e.length)).toEqual([3, 2]);
  });

  it('finds a malformed effect on a path that is rarely taken', () => {
    const json = compile('* [a] Fine.\n* [b] Broken. # fx: rings lots\n- End.');
    expect(() => playScene(json, env(), [0])).not.toThrow();
    expect(() => walkScene(json, env())).toThrow(/bad number/);
  });

  it('gives the choices of each path, and the same effects as playing it', () => {
    const src = [
      'EXTERNAL rings()',
      '* [a]',
      '  ** [a1]',
      '     # fx: flag a1',
      '     A1.',
      '  ** { rings() > 100 } [a2]',
      '     # fx: flag a2',
      '     A2.',
      '* [b]',
      '  B. # fx: rings -3',
      '- End. # fx: flag done',
    ].join('\n');
    const json = compile(src);
    const paths = scenePaths(json, env());
    expect(paths.map((p) => p.choices)).toEqual([[0, 0], [1]]);
    expect(paths.map((p) => p.effects)).toEqual([
      [
        { flag: 'a1', set: 1 },
        { flag: 'done', set: 1 },
      ],
      [{ rings: -3 }, { flag: 'done', set: 1 }],
    ]);
    for (const p of paths) expect(p.effects).toEqual(playScene(json, env(), p.choices).effects);
    expect(scenePaths(json, env({ rings: 500 })).map((p) => p.choices)).toEqual([[0, 0], [0, 1], [1]]);
  });

  it('gives up on scenes with too many paths', () => {
    const src = Array.from({ length: 10 }, (_, i) => `* [a${i}] A.\n* [b${i}] B.\n-`).join('\n');
    expect(() => walkScene(compile(src), env(), 100)).toThrow(/more than 100 paths/);
  });
});
