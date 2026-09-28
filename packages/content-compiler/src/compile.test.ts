import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { TARGETS } from '@cots/content-schema';
import { afterEach, describe, expect, it } from 'vitest';
import { ContentError, compileTarget, DAILY_CHECK_RANGE, loadPacks, writeLeakTokens } from './compile';

let root = '';
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

type PackFixture = { yaml?: string; strings?: Record<string, string>; files?: Record<string, string> };
/** What the sun costs besides the tools: every build needs it, from one pack. */
const SUN = 'badCompare: 10\nquestion: 20\nhint: 15\nduskGrace: 60\n';

function fixture(overrides: Record<string, PackFixture> = {}) {
  root = mkdtempSync(join(tmpdir(), 'cots-content-'));
  const packs = {
    core: { yaml: 'id: core\ndependsOn: []\n', strings: { 'core.title': 'Chooser' }, files: { 'sun.yaml': SUN } },
    daily: { yaml: 'id: daily\ndependsOn: [core]\n', strings: { 'daily.intro': 'Daily' } },
    demo: { yaml: 'id: demo\ndependsOn: [core]\n', strings: { 'demo.days': 'Days 1-3' } },
    campaign: {
      yaml: 'id: campaign\ndependsOn: [core, demo]\ncanary: test-canary-campaign-0001\n',
      strings: { 'campaign.days': 'Days 4-20' },
    },
    ...overrides,
  };
  for (const [id, pack] of Object.entries(packs) as [string, PackFixture][]) {
    mkdirSync(join(root, 'packs', id, 'strings'), { recursive: true });
    if (pack.yaml) writeFileSync(join(root, 'packs', id, 'pack.yaml'), pack.yaml);
    writeFileSync(join(root, 'packs', id, 'strings', 'en.json'), JSON.stringify(pack.strings ?? {}));
    for (const [file, text] of Object.entries(pack.files ?? {})) {
      mkdirSync(dirname(join(root, 'packs', id, file)), { recursive: true });
      writeFileSync(join(root, 'packs', id, file), text);
    }
  }
  return join(root, 'packs');
}

describe('content compiler', () => {
  it('ships campaign content only in full targets', () => {
    const packs = loadPacks(fixture());
    const out = join(root, 'generated');
    compileTarget('web-demo', TARGETS['web-demo'], packs, out);
    compileTarget('electron-full', TARGETS['electron-full'], packs, out);

    const demo = readFileSync(join(out, 'web-demo', 'index.ts'), 'utf8');
    expect(demo).not.toContain('campaign');
    expect(readFileSync(join(out, 'web-demo', 'manifest.json'), 'utf8')).not.toContain('test-canary');

    const full = JSON.parse(readFileSync(join(out, 'electron-full', 'manifest.json'), 'utf8'));
    expect(full.packs).toEqual(['core', 'daily', 'demo', 'campaign']);
    expect(full.canaries).toEqual(['test-canary-campaign-0001']);
  });

  it('writes leak tokens with the canary first', () => {
    const packs = loadPacks(fixture());
    writeLeakTokens(packs, join(root, 'generated'));
    const tokens = JSON.parse(readFileSync(join(root, 'generated', 'leak', 'campaign.tokens.json'), 'utf8'));
    expect(tokens).toEqual({
      pack: 'campaign',
      canary: 'test-canary-campaign-0001',
      tokens: ['test-canary-campaign-0001', 'campaign.days'],
    });
  });

  it('counts a pack’s achievements among its leak tokens', () => {
    const secret =
      '- { id: ach.secret, title: ach.secret.title, text: ach.secret.text, hidden: true, when: { at: run, test: { state: flags.found, gte: 1 } } }\n';
    const packs = loadPacks(
      fixture({
        campaign: {
          yaml: 'id: campaign\ndependsOn: [core, demo]\ncanary: test-canary-campaign-0001\n',
          strings: { 'campaign.days': 'Days 4-20', 'ach.secret.title': 'Secret', 'ach.secret.text': 'Find it.' },
          files: { 'achievements.yaml': secret },
        },
      }),
    );
    writeLeakTokens(packs, join(root, 'generated'));
    const tokens = JSON.parse(readFileSync(join(root, 'generated', 'leak', 'campaign.tokens.json'), 'utf8'));
    expect(tokens.tokens).toEqual(expect.arrayContaining(['ach.secret', 'ach.secret.title', 'ach.secret.text']));
  });

  it('rejects a demo pack that depends on the campaign', () => {
    const dir = fixture({ demo: { yaml: 'id: demo\ndependsOn: [core, campaign]\n' } });
    expect(() => loadPacks(dir)).toThrow(/may not depend on "campaign"/);
  });

  it('rejects the same string key in two packs', () => {
    const dir = fixture({ daily: { yaml: 'id: daily\ndependsOn: [core]\n', strings: { 'core.title': 'x' } } });
    expect(() => loadPacks(dir)).toThrow(/defined in both/);
  });

  it('requires a campaign canary', () => {
    const dir = fixture({ campaign: { yaml: 'id: campaign\ndependsOn: [core, demo]\n' } });
    expect(() => loadPacks(dir)).toThrow(/needs a canary/);
  });

  it('refuses a demo target that includes a canary pack', () => {
    const packs = loadPacks(fixture());
    const leaky = { ...TARGETS['web-demo'], packs: ['core', 'demo', 'campaign'] as const };
    expect(() => compileTarget('leaky', leaky, packs, join(root, 'generated'))).toThrow(ContentError);
  });

  it('reports duplicate YAML keys and unknown fields', () => {
    expect(() => loadPacks(fixture({ core: { yaml: 'id: core\nid: core\ndependsOn: []\n' } }))).toThrow(ContentError);
    expect(() => loadPacks(fixture({ core: { yaml: 'id: core\ndependsOn: []\nextra: 1\n' } }))).toThrow(ContentError);
  });
});

describe('gameplay content lints', () => {
  const core = (files: Record<string, string>, strings: Record<string, string> = {}): PackFixture => ({
    yaml: 'id: core\ndependsOn: []\n',
    strings: { 'core.title': 'Chooser', 'rule.hel': 'Hel', 'dest.HEL': 'Hel', ...strings },
    files: {
      'facts.yaml': '- { id: cause, domain: { enum: [battle, sickness] } }\n',
      'rules.yaml': '- { id: rule.hel, order: 999, since: 1, when: { always: true }, then: HEL, text: rule.hel }\n',
      'sun.yaml': SUN,
      ...files,
    },
  });
  const day = (archetype: string) => ({
    yaml: 'id: demo\ndependsOn: [core]\n',
    strings: { 'demo.days': 'Days 1-3', 'decree.d1': 'Decree' },
    files: {
      'days/day-01.yaml': [
        'day: 1',
        'sunS: 360',
        'decree: decree.d1',
        'queue:',
        '  count: [6, 6]',
        `  archetypes: [{ id: ${archetype}, w: 1 }]`,
        '  mix: { HEL: [100, 100] }',
        '  knobs: { lieRate: 100, maxLies: 1, decoyRate: 0, ravenRate: 0, forgetRate: 0, proofCostS: [0, 20], maxTools: 0, maxDocs: 3, salienceFloor: 2 }',
      ].join('\n'),
    },
  });
  const archetype = (lie: string) =>
    `- { id: arch.liar, since: 1, personas: [braggart], truth: { cause: { is: sickness } }, lies: [${lie}] }\n`;
  const compile = (packs: Record<string, PackFixture>) =>
    compileTarget('web-demo', TARGETS['web-demo'], loadPacks(fixture(packs)), join(root, 'generated'));

  it('compiles consistent content and emits it', () => {
    compile({ core: core({ 'archetypes.yaml': archetype('') }), demo: day('arch.liar') });
    const content = JSON.parse(readFileSync(join(root, 'generated', 'web-demo', 'content.json'), 'utf8'));
    expect(content.days.map((d: { day: number }) => d.day)).toEqual([1]);
    expect(content.facts[0]).toMatchObject({ id: 'cause', domain: { kind: 'enum' }, since: 1, inert: 'battle' });
  });

  it('rejects missing strings, unknown archetypes and unvoiceable lies', () => {
    expect(() =>
      compile({ core: core({ 'archetypes.yaml': archetype('') }), demo: { ...day('arch.nobody') } }),
    ).toThrow(/unknown archetype "arch.nobody"/);
    const lie = '{ fact: cause, claim: battle, p: 90, motive: wantsValhalla, onQuestion: { confess: 1 } }';
    expect(() => compile({ core: core({ 'archetypes.yaml': archetype(lie) }), demo: day('arch.liar') })).toThrow(
      /can't voice its lie cause=battle/,
    );
    const noText = core({
      'rules.yaml': '- { id: rule.hel, order: 999, since: 1, when: { always: true }, then: HEL, text: rule.missing }\n',
    });
    expect(() => compile({ core: noText, demo: day('arch.liar') })).toThrow(/missing string "rule.missing"/);
    // Every sign needs chip text for each value it can show.
    const sign = core({
      'archetypes.yaml': archetype(''),
      'observations.yaml': '- { key: cause, view: front, since: 1, salience: 3, cost: 1, from: { fact: cause } }\n',
    });
    expect(() => compile({ core: sign, demo: day('arch.liar') })).toThrow(/missing string "obs.cause.sickness"/);
  });

  it('rejects strings that are not valid ICU messages', () => {
    expect(() =>
      compile({
        core: core({ 'archetypes.yaml': archetype('') }, { 'core.bad': '{n, plural, one {x}' }),
        demo: day('arch.liar'),
      }),
    ).toThrow(/Invalid ICU message:\n"core.bad"/);
  });

  it('rejects words a fact fixes that its values or pools do not have', () => {
    const withWords = (words: string) =>
      core({
        'archetypes.yaml': archetype(''),
        'facts.yaml': `- { id: cause, domain: { enum: [battle, sickness] }, words: ${words} }\n`,
        'pools.yaml': 'pool.weapons: [axe, sword]\n',
      });
    const build = (words: string) => () => compile({ core: withWords(words), demo: day('arch.liar') });
    expect(build('{ battle: { pool.weapons: sword } }')).not.toThrow();
    expect(build('{ drowned: { pool.weapons: sword } }')).toThrow(/words for "drowned", which it can't be/);
    expect(build('{ battle: { pool.boats: sword } }')).toThrow(/unknown pool "pool.boats"/);
    expect(build('{ battle: { pool.weapons: spear } }')).toThrow(/fixes "spear", which pool.weapons doesn't have/);
  });

  it('rejects speaking chances for values a slot’s fact cannot have', () => {
    const speech = (slot: string) =>
      core({ 'archetypes.yaml': archetype(''), 'speech.yaml': `- ${slot}\n` }, { 'tm.d': 'Died.' });
    const build = (slot: string) => () => compile({ core: speech(slot), demo: day('arch.liar') });
    expect(build('{ slot: death, fact: cause, chance: 20, chances: { sickness: 60 }, since: 1 }')).not.toThrow();
    expect(build('{ slot: death, fact: cause, chance: 20, chances: { drowned: 60 }, since: 1 }')).toThrow(
      /chance for "drowned", which cause can't be/,
    );
    expect(build('{ slot: flavor, chance: 20, chances: { sickness: 60 }, since: 1 }')).toThrow(
      /chances by value but no fact/,
    );
  });

  const dailyPack = (archetype: string): PackFixture => {
    const spec = day(archetype).files['days/day-01.yaml'].replace('decree: decree.d1', 'decree: daily.decree');
    return {
      yaml: 'id: daily\ndependsOn: [core]\n',
      strings: { 'daily.intro': 'Daily', 'daily.decree': 'Everything' },
      files: { 'daily.yaml': spec },
    };
  };

  it('emits the Daily from core and daily packs only, and lints it', () => {
    const demoOnly = {
      ...day('arch.liar'),
      files: { ...day('arch.liar').files, 'archetypes.yaml': archetype('').replace('arch.liar', 'arch.demoOnly') },
    };
    compile({ core: core({ 'archetypes.yaml': archetype('') }), daily: dailyPack('arch.liar'), demo: demoOnly });
    const out = (f: string) => JSON.parse(readFileSync(join(root, 'generated', 'web-demo', f), 'utf8'));
    expect(out('daily.json').daily).toMatchObject({ day: 1, decree: 'daily.decree' });
    expect(out('daily.json').days).toEqual([]);
    expect(out('daily.json').archetypes.map((a: { id: string }) => a.id)).toEqual(['arch.liar']);
    expect(out('content.json').archetypes.map((a: { id: string }) => a.id)).toEqual(['arch.liar', 'arch.demoOnly']);
    // The runtime guard's table: one 8-hex checksum per Daily in the range.
    const checks = out('daily-checks.json');
    expect(checks).toMatchObject({ g: 1, from: DAILY_CHECK_RANGE.from });
    expect(checks.hashes).toHaveLength((DAILY_CHECK_RANGE.to - DAILY_CHECK_RANGE.from + 1) * 8);
    expect(() =>
      compile({
        core: core({ 'archetypes.yaml': archetype('') }),
        daily: dailyPack('arch.nobody'),
        demo: day('arch.liar'),
      }),
    ).toThrow(/the Daily \(day 1 mechanics\) uses unknown archetype "arch.nobody"/);
  });

  it('lints a scripted queue', () => {
    const primer = (id: string, dest: string): PackFixture => {
      const spec = day('arch.liar')
        .files['days/day-01.yaml'].replace('decree: decree.d1', 'decree: daily.decree')
        .replace('  count: [6, 6]', `  count: [1, 1]\n  script: [{ id: ${id}, dest: ${dest} }]`);
      return {
        yaml: 'id: daily\ndependsOn: [core]\n',
        strings: { 'daily.intro': 'Daily', 'daily.decree': 'Everything' },
        files: { 'primer.yaml': spec },
      };
    };
    const base = core({ 'archetypes.yaml': archetype('') });
    expect(() => compile({ core: base, daily: primer('arch.liar', 'HEL'), demo: day('arch.liar') })).not.toThrow();
    expect(() => compile({ core: base, daily: primer('arch.other', 'HEL'), demo: day('arch.liar') })).toThrow(
      /the primer \(day 1 mechanics\) scripts "arch.other", which isn't in its queue/,
    );
    expect(() => compile({ core: base, daily: primer('arch.liar', 'RAN'), demo: day('arch.liar') })).toThrow(
      /scripts a RAN soul, but no rule in force sends anyone there/,
    );
  });

  it('lints a day’s lesson', () => {
    const lesson = (lines: string, teach = true): PackFixture => {
      const d = day('arch.liar');
      let spec = d.files['days/day-01.yaml'];
      if (teach) spec = spec.replace('  count: [6, 6]', '  count: [6, 6]\n  teachFirst: arch.liar');
      return {
        ...d,
        strings: { ...d.strings, 'coach.d1.look': 'Look', 'coach.d1.stamp': 'Stamp' },
        files: { 'days/day-01.yaml': `${spec}\nlesson:\n  steps:\n${lines}` },
      };
    };
    const base = core({ 'archetypes.yaml': archetype('') });
    const look = '    - { id: d1.look, text: coach.d1.look, focus: face, until: { seen: body.front.skin } }\n';
    const stamp = '    - { id: d1.stamp, text: coach.d1.stamp, focus: judge }\n';
    expect(() => compile({ core: base, demo: lesson(look + stamp) })).not.toThrow();
    expect(() => compile({ core: base, demo: lesson(look + stamp, false) })).toThrow(
      /day 1's lesson has no teaching soul/,
    );
    expect(() => compile({ core: base, demo: lesson(look.replace('focus: face', 'focus: toes') + stamp) })).toThrow(
      /highlights "toes", which the coach doesn't know/,
    );
    const lens = '    - { id: d1.lens, text: coach.d1.look, focus: runeLens, until: { tool: runeLens } }\n';
    expect(() => compile({ core: base, demo: lesson(lens + stamp) })).toThrow(
      /waits on the runeLens, which isn't taught by day 1/,
    );
    expect(() => compile({ core: base, demo: lesson(stamp + look) })).toThrow(/the last step lasts until the soul/);
    const whim = '    - { id: d1.whim, text: coach.d1.look, focus: face, until: { seen: "whim:freyjaWhim" } }\n';
    expect(() => compile({ core: base, demo: lesson(whim + stamp) })).toThrow(/the day has no param "freyjaWhim"/);
  });

  it('lints Endless twists', () => {
    const twists = (yaml: string, strings: Record<string, string> = { 'twist.a': 'A twist' }): PackFixture => {
      const d = day('arch.liar');
      return { ...d, strings: { ...d.strings, ...strings }, files: { ...d.files, 'endless.yaml': yaml } };
    };
    const base = core({ 'archetypes.yaml': archetype('') });
    const ok = '- { id: twist.a, since: 1, decree: twist.a, knobs: { lieRate: 200 }, mix: { HEL: [60, 80] } }\n';
    expect(() => compile({ core: base, demo: twists(ok) })).not.toThrow();
    expect(() => compile({ core: base, demo: twists(ok + ok) })).toThrow(/twist\.a/);
    expect(() => compile({ core: base, demo: twists(ok, {}) })).toThrow(/uses missing string "twist\.a"/);
    expect(() => compile({ core: base, demo: twists(ok.replace('since: 1', 'since: 2')) })).toThrow(
      /starts on day 2, after the build's last day/,
    );
    expect(() => compile({ core: base, demo: twists(ok.replace('HEL', 'RAN')) })).toThrow(
      /asks for RAN souls, which no rule sends anywhere by day 1/,
    );
    expect(() => compile({ core: base, demo: twists(ok.replace('[60, 80]', '[80, 60]')) })).toThrow(
      /empty share for HEL/,
    );
  });

  it('lints achievements', () => {
    const base = core({ 'archetypes.yaml': archetype('') });
    const earn = (yaml: string, strings: Record<string, string> = { 'ach.a.title': 'A', 'ach.a.text': 'Do A.' }) => {
      const d = day('arch.liar');
      return { ...d, strings: { ...d.strings, ...strings }, files: { ...d.files, 'achievements.yaml': yaml } };
    };
    const ok =
      '- { id: ach.a, title: ach.a.title, text: ach.a.text, when: { at: shift, modes: [daily], test: { state: perfect, is: 1 } } }\n';
    expect(() => compile({ core: base, demo: earn(ok) })).not.toThrow();
    expect(() => compile({ core: base, demo: earn(ok + ok) })).toThrow(/Duplicate achievement "ach\.a"/);
    expect(() => compile({ core: base, demo: earn(ok, {}) })).toThrow(
      /achievement ach\.a uses missing string "ach\.a\.title"/,
    );
    // Each moment has its own numbers: a soul has no `perfect`, a shift no `rings`.
    expect(() => compile({ core: base, demo: earn(ok.replace('at: shift', 'at: soul')) })).toThrow(
      /achievement ach\.a reads "perfect", which a soul doesn't have/,
    );
    expect(() => compile({ core: base, demo: earn(ok.replace('perfect', 'rings')) })).toThrow(
      /reads "rings", which a shift doesn't have/,
    );
    const run =
      '- { id: ach.a, title: ach.a.title, text: ach.a.text, when: { at: run, test: { state: flags.met, gte: 1 } } }\n';
    expect(() => compile({ core: base, demo: earn(run) })).not.toThrow();
    expect(() => compile({ core: base, demo: earn(run.replace('flags.met', 'flag.met')) })).toThrow(
      /reads "flag\.met", which a run doesn't have/,
    );
    const ending = '- { id: ach.a, title: ach.a.title, text: ach.a.text, when: { at: ending, endings: [ending.x] } }\n';
    expect(() => compile({ core: base, demo: earn(ending) })).toThrow(
      /waits on ending "ending\.x", which the build doesn't have/,
    );
    // Modes and moments the game doesn't have don't parse.
    expect(() => compile({ core: base, demo: earn(ok.replace('[daily]', '[weekly]')) })).toThrow(/achievements\.yaml/);
    expect(() => compile({ core: base, demo: earn(ok.replace('at: shift', 'at: dawn')) })).toThrow(
      /achievements\.yaml/,
    );
  });

  it('lints a rule’s later wordings', () => {
    const worded = (texts: string, strings: Record<string, string> = { 'rule.hel.2': 'Hel, from day 2' }) =>
      core(
        {
          'rules.yaml': `- { id: rule.hel, order: 999, since: 1, when: { always: true }, then: HEL, text: rule.hel, texts: ${texts} }\n`,
          'archetypes.yaml': archetype(''),
        },
        strings,
      );
    const ok = '[{ since: 2, text: rule.hel.2 }]';
    expect(() => compile({ core: worded(ok), demo: day('arch.liar') })).not.toThrow();
    expect(() => compile({ core: worded(ok, {}), demo: day('arch.liar') })).toThrow(
      /rule rule\.hel's wording from day 2 uses missing string "rule\.hel\.2"/,
    );
    expect(() => compile({ core: worded('[{ since: 1, text: rule.hel.2 }]'), demo: day('arch.liar') })).toThrow(
      /rule rule\.hel's later wordings must come in day order, after day 1/,
    );
  });

  it('takes the sun’s costs from exactly one pack', () => {
    const plain = core({ 'archetypes.yaml': archetype('') });
    expect(() => compile({ core: plain, demo: day('arch.liar') })).not.toThrow();
    const none = {
      ...plain,
      files: Object.fromEntries(Object.entries(plain.files ?? {}).filter(([f]) => f !== 'sun.yaml')),
    };
    expect(() => compile({ core: none, demo: day('arch.liar') })).toThrow(/No pack defines sun\.yaml/);
    const twice = day('arch.liar');
    expect(() => compile({ core: plain, demo: { ...twice, files: { ...twice.files, 'sun.yaml': SUN } } })).toThrow(
      /Only one pack may define sun\.yaml/,
    );
    const odd = core({ 'archetypes.yaml': archetype(''), 'sun.yaml': `${SUN}lunch: 5\n` });
    expect(() => compile({ core: odd, demo: day('arch.liar') })).toThrow(/sun\.yaml/);
  });

  it('lints pressing a soul (docs/tech-spec.md §66), from one pack', () => {
    const press = [
      'since: 3',
      'cost: 10',
      'patience: 2',
      'gives: { braggart: 15 }',
      'details:',
      '  - { on: { fact: cause, claimed: battle }, says: { fact: grip, value: weapon } }',
    ].join('\n');
    const hold = "- { id: p.hold, on: { kind: hold, fact: '*' }, msgs: [p.hold.1] }";
    const detail = '- { id: p.grip, on: { kind: detail, fact: grip, value: weapon }, msgs: [p.grip.1] }';
    const lines = `${hold}\n${detail}\n`;
    const said = { 'p.hold.1': 'Held.', 'p.grip.1': 'Gripped.' };
    const facts =
      '- { id: cause, domain: { enum: [battle, sickness] } }\n- { id: grip, domain: { enum: [weapon, none] } }\n';
    const pressed = (yaml: string, templates = lines, strings: Record<string, string> = said) =>
      core(
        {
          'archetypes.yaml': archetype(''),
          'facts.yaml': facts,
          'press.yaml': yaml,
          'templates/press.yaml': templates,
        },
        strings,
      );
    const build = (c: PackFixture) => () => compile({ core: c, demo: day('arch.liar') });
    expect(build(pressed(press))).not.toThrow();
    const content = JSON.parse(readFileSync(join(root, 'generated', 'web-demo', 'content.json'), 'utf8'));
    expect(content.press).toMatchObject({ since: 3, cost: 10, patience: 2, gives: { braggart: 15 } });
    expect(content.pressLines.map((t: { id: string }) => t.id)).toEqual(['p.hold', 'p.grip']);
    // Odds for every way a soul can talk.
    expect(build(pressed(press.replace('braggart: 15', 'veteran: 25')))).toThrow(/no odds for a braggart soul/);
    // What a soul adds needs a line, a fact the build has, a value it can take, and another fact than the claim's.
    expect(build(pressed(press, `${hold}\n`))).toThrow(/detail 1 has no line to say grip is weapon/);
    expect(build(pressed(press.replace('value: weapon', 'value: sword')))).toThrow(/grip is sword, which it can't/);
    expect(build(pressed(press.replace('fact: grip', 'fact: cause')))).toThrow(/of cause with cause/);
    expect(build(pressed(press.replace('fact: grip', 'fact: lips')))).toThrow(/unknown fact "lips"/);
    // A line for any claim held to, and the strings they say.
    expect(build(pressed(press, `${detail}\n`))).toThrow(/No fallback press line/);
    expect(build(pressed(press, lines, { 'p.hold.1': 'Held.' }))).toThrow(/press line p.grip uses missing string/);
    const twice = day('arch.liar');
    expect(() =>
      compile({ core: pressed(press), demo: { ...twice, files: { ...twice.files, 'press.yaml': press } } }),
    ).toThrow(/Only one pack may define press\.yaml/);
  });

  it('requires the last rule in force to always apply', () => {
    const partial = core({
      'rules.yaml':
        '- { id: rule.hel, order: 999, since: 1, when: { fact: cause, is: sickness }, then: HEL, text: rule.hel }\n',
      'archetypes.yaml': archetype(''),
    });
    expect(() => compile({ core: partial, demo: day('arch.liar') })).toThrow(/last rule in force must always apply/);
  });
});
