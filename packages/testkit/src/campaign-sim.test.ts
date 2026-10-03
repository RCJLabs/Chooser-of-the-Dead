import { campaignOf, FACTIONS, reachableEndings } from '@cots/engine';
import { playScene } from '@cots/story';
import { describe, expect, it } from 'vitest';
import {
  JUDGING,
  type Judging,
  type NightStrategy,
  type SimOptions,
  simulateCampaign,
  simulateRun,
  storyPolicy,
} from './campaign-sim';
import { loadContent, loadScenes } from './content';

const bot = (name: string): Judging => {
  const j = JUDGING.find((x) => x.name === name);
  if (!j) throw new Error(`missing bot ${name}`);
  return j;
};

// A PR-sized economy check; `pnpm sim campaign --seeds 200` is the nightly size.
describe('the campaign economy', () => {
  it('keeps honest accounts, carries a careful player, and sinks a careless one', () => {
    const scenes = loadScenes('dev-full');
    const [good, bad] = simulateCampaign(
      loadContent('dev-full'),
      24,
      [bot('competent'), bot('careless')],
      ['payAll'],
      [storyPolicy('plain')],
      scenes,
    );
    expect(good?.ledgerErrors).toBe(0);
    expect(bad?.ledgerErrors).toBe(0);
    expect(good).toMatchObject({ demoted: 0, familyLost: 0 });
    expect(good?.meanUpgrades).toBeGreaterThanOrEqual(2);
    expect(bad?.demoted).toBeGreaterThan(0);
  }, 120_000);

  it('never demotes a novice during the demo’s three days', () => {
    const [r] = simulateCampaign(loadContent('web-demo'), 60, [bot('novice')], ['payAll']);
    expect(r?.demoted ?? 1).toBeLessThanOrEqual(1);
  }, 120_000);

  it('lets the sun set on a slow bot’s line (docs/tech-spec.md §41): the souls wait, and the accounts still add up', () => {
    const content = loadContent('dev-full');
    for (const seed of ['slow-0', 'slow-1']) {
      // Swearing vows (docs/tech-spec.md §75) it can't always keep, so the vows' columns are in the accounts too.
      const r = simulateRun(content, seed, bot('competent'), 'payAll', { paceS: 70, vows: 'dearest' });
      expect(r.ledgerOk).toBe(true);
      expect(r.leftAtDusk).toBeGreaterThan(0);
      expect(r.ledger.some((l) => (l.waiting?.carried.length ?? 0) > 0)).toBe(true);
      expect(r.ledger.some((l) => l.vow?.kept === false)).toBe(true);
      // Standing is every audit's columns added up: mistakes, story, the appeal, the line, the requests and the vow (no
      // scenes here, so nothing waits to be filed).
      for (const f of FACTIONS) {
        const sum = r.ledger.reduce(
          (n, l) =>
            n +
            (l.standing[f] ?? 0) +
            (l.story?.[f] ?? 0) +
            (l.appeal?.standing[f] ?? 0) +
            (l.waiting?.standing[f] ?? 0) +
            (l.vow?.standing[f] ?? 0) +
            (l.requests ?? []).reduce((m, q) => m + (q.standing[f] ?? 0), 0),
          0,
        );
        expect(r.standing[f], `${seed} ${f}`).toBe(sum);
      }
    }
  }, 120_000);
});

// docs/build-plan.md §10: bots must reach every ending. Each ending names a player who should reach
// it; the first of a few seeds that does is enough.
const REACH: readonly [
  ending: string,
  judging: string,
  night: NightStrategy,
  story: string,
  options?: Pick<SimOptions, 'appeals' | 'serve' | 'oath'>,
][] = [
  ['ending.demoted', 'careless', 'payAll', 'plain'],
  ['ending.alone', 'novice', 'neglect', 'plain'],
  ['ending.naglfar', 'expert', 'payAll', 'naglfar'],
  ['ending.rebirth', 'expert', 'payAll', 'rebirth'],
  ['ending.smuggled', 'competent', 'payAll', 'ferry'],
  ['ending.transfer', 'expert', 'payAll', 'transfer'],
  // Freyja's and Hel's endings take the story and their requests too (docs/tech-spec.md §42).
  ['ending.hel', 'expert', 'payAll', 'hel', { serve: 'hel' }],
  ['ending.freyja', 'expert', 'payAll', 'freyja', { serve: 'freyja' }],
  // Under the oath (docs/tech-spec.md §49), which its achievement asks for: no warnings before the fines.
  ['ending.odin', 'expert', 'payAll', 'odin', { oath: true }],
  // A weak host: a novice who lets the appeals stand (righting mistakes sends souls where they belong).
  ['ending.wolf', 'novice', 'frugal', 'plain', { appeals: false }],
  ['ending.lastStand', 'competent', 'payAll', 'plain'],
];

describe('the endings', () => {
  it('can each be reached by a bot that plays for it, and so can what the campaign alone can earn', () => {
    const content = loadContent('dev-full');
    const scenes = loadScenes('dev-full');
    const achievements = content.achievements ?? [];
    const missed: string[] = [];
    const earned = new Set<string>();
    for (const [ending, judging, night, story, options] of REACH) {
      const seen: string[] = [];
      for (let i = 0; i < 6 && !seen.includes(ending); i++) {
        const r = simulateRun(content, `reach${i}`, bot(judging), night, {
          story: storyPolicy(story),
          scenes,
          achievements,
          ...options,
        });
        seen.push(r.ending ?? 'none');
        for (const id of r.achievements) earned.add(id);
      }
      if (!seen.includes(ending)) missed.push(`${ending} (${judging}, ${night}, ${story}): got ${seen.join(', ')}`);
    }
    expect(missed).toEqual([]);
    // docs/tech-spec.md §34: every achievement of the run, its endings and its shifts alone, a bot earns too.
    // (Those any mode can earn are shown earnable in the engine's tests, on the Daily.)
    const campaignOnly = achievements.filter(
      (a) =>
        a.when.at === 'run' ||
        a.when.at === 'ending' ||
        (a.when.at === 'shift' && a.when.modes.every((m) => m === 'campaign')),
    );
    expect(campaignOnly.length).toBeGreaterThan(0);
    expect(campaignOnly.map((a) => a.id).filter((id) => !earned.has(id))).toEqual([]);
  }, 300_000);

  // docs/tech-spec.md §72: an origin's scenes touch nothing an ending reads, so each can still be reached.
  it('can each still be reached in a run begun with an origin', () => {
    const content = loadContent('dev-full');
    const scenes = loadScenes('dev-full');
    const origins = (content.campaign?.origins ?? []).map((o) => o.id);
    expect(origins.length).toBeGreaterThan(0);
    const missed: string[] = [];
    for (const [k, [ending, judging, night, story, options]] of REACH.entries()) {
      const origin = origins[k % origins.length] as string;
      const seen: string[] = [];
      for (let i = 0; i < 6 && !seen.includes(ending); i++) {
        const r = simulateRun(content, `reach${i}`, bot(judging), night, {
          story: storyPolicy(story),
          scenes,
          origin,
          ...options,
        });
        seen.push(r.ending ?? 'none');
      }
      if (!seen.includes(ending)) missed.push(`${ending} as ${origin}: got ${seen.join(', ')}`);
    }
    expect(missed).toEqual([]);
  }, 300_000);

  it('covers every ending the full campaign can end on', () => {
    // Endings with a condition, and the finale; the demo's and the slice's finales end other runs.
    const ids = reachableEndings(loadContent('dev-full')).map((e) => e.id);
    expect(new Set(REACH.map(([e]) => e))).toEqual(new Set(ids));
  });
});

describe('a jarl’s bribe (docs/tech-spec.md §47)', () => {
  it('is taken only by a bot that takes bribes: paid at the audit as a mistake, and the accounts add up', () => {
    const content = loadContent('dev-full');
    const paid = (bribes: boolean) =>
      simulateRun(content, 'bribe-0', bot('expert'), 'payAll', { bribes }).ledger.flatMap((l) =>
        (l.mistakes ?? []).filter((m) => (m.paid ?? 0) > 0).map((m) => ({ day: l.day, paid: m.paid })),
      );
    expect(paid(false)).toEqual([]);
    // The jarl's thirty for Valhalla on Day 9, and the miser's forty for a stamp home on Day 13 (§59).
    expect(paid(true)).toEqual([
      { day: 9, paid: 30 },
      { day: 13, paid: 40 },
    ]);
    expect(simulateRun(content, 'bribe-0', bot('expert'), 'payAll', { bribes: true }).ledgerOk).toBe(true);
  }, 120_000);

  it('is remembered: the night counts the rings, and Muninn remembers either answer', () => {
    const scenes = loadScenes('dev-full');
    const text = (id: string, day: number, flags: Record<string, number>) => {
      const json = scenes[id];
      if (!json) throw new Error(`no ${id}`);
      const env = {
        seed: 1,
        day,
        rings: 50,
        flags,
        standing: { odin: 0, freyja: 0, hel: 0, loki: 0, clerk: 0 },
        family: { mother: 'well', brother: 'well', sister: 'well' },
        word: 0,
        wrong: 0,
      };
      return playScene(json, env, [0, 0])
        .lines.map((l) => l.text)
        .join('\n');
    };
    expect(text('scene.d9.night', 9, { jarl_bribe: 1 })).toContain('the jarl');
    expect(text('scene.d9.night', 9, { jarl_refused: 1 })).not.toContain('the jarl');
    const took = text('scene.d13.night', 13, { jarl_bribe: 1 });
    const refused = text('scene.d13.night', 13, { jarl_refused: 1 });
    expect(took).toContain('I remember a jarl');
    expect(refused).toContain('I remember a jarl');
    expect(took).not.toBe(refused);
    expect(text('scene.d13.night', 13, {})).not.toContain('jarl');
  });
});

describe('the clerk’s contract, kept (docs/tech-spec.md §57)', () => {
  const scenes = loadScenes('dev-full');
  const mark = campaignOf(loadContent('dev-full')).favours?.find((f) => f.id === 'fav.clerk')?.at ?? 0;
  const env = (day: number, flags: Record<string, number>, clerk: number, rings = 50) => ({
    seed: 1,
    day,
    rings,
    flags,
    standing: { odin: 0, freyja: 0, hel: 0, loki: 0, clerk },
    family: { mother: 'well', brother: 'well', sister: 'well' },
    word: 0,
    wrong: 0,
  });
  const play = (id: string, e: ReturnType<typeof env>, choices: number[]) => {
    const json = scenes[id];
    if (!json) throw new Error(`no ${id}`);
    return playScene(json, e, choices);
  };

  it('is kept for one who said "Not yet", and offered again on Day 19 while they stay in his favour', () => {
    expect(mark).toBeGreaterThan(0);
    expect(play('scene.d18.morning', env(18, {}, 0), [1]).effects).toEqual(
      expect.arrayContaining([{ flag: 'clerk_later', set: 1 }]),
    );
    const again = play('scene.d19.morning', env(19, { clerk_later: 1 }, mark), [0]);
    expect(again.done).toBe(false);
    expect(again.choices.map((c) => c.text)).toEqual(['Sign it now and pay the ten rings.', '"No. Not now either."']);
    expect(play('scene.d19.morning', env(19, { clerk_later: 1 }, mark), [0, 0]).effects).toEqual(
      expect.arrayContaining([{ rings: -10 }, { flag: 'clerk_contract', set: 1 }, { standing: 'clerk', by: 2 }]),
    );
    expect(play('scene.d19.morning', env(19, { clerk_later: 1 }, mark), [0, 1]).effects).toEqual(
      expect.arrayContaining([{ flag: 'clerk_later', set: 0 }]),
    );
    // Too poor to pay: the offer is there, and can't be taken.
    expect(play('scene.d19.morning', env(19, { clerk_later: 1 }, mark, 5), [0]).choices[0]?.locked).toBe(true);
  });

  it('is not offered again below his favour, after "My place is at this gate", or once signed', () => {
    expect(play('scene.d19.morning', env(19, { clerk_later: 1 }, mark - 1), [0]).done).toBe(true);
    expect(play('scene.d19.morning', env(19, {}, mark + 5), [0]).done).toBe(true);
    expect(play('scene.d19.morning', env(19, { clerk_later: 1, clerk_contract: 1 }, mark + 5), [0]).done).toBe(true);
  });
});

describe('Ragna and the hill (docs/tech-spec.md §50)', () => {
  const scenes = loadScenes('dev-full');
  const env = (day: number, flags: Record<string, number>, mother = 'well') => ({
    seed: 1,
    day,
    rings: 50,
    flags,
    standing: { odin: 0, freyja: 0, hel: 0, loki: 0, clerk: 0 },
    family: { mother, brother: 'well', sister: 'well' },
    word: 0,
    wrong: 0,
  });
  const play = (id: string, day: number, flags: Record<string, number>, choices: number[], mother = 'well') => {
    const json = scenes[id];
    if (!json) throw new Error(`no ${id}`);
    return playScene(json, env(day, flags, mother), choices);
  };
  const text = (f: ReturnType<typeof play>) => f.lines.map((l) => l.text).join('\n');

  it('offers the hill on Night 10: carried up at dawn for the morning’s sun, or not; silver comes back', () => {
    // The clerk's choice comes first; then the hill: fly, silver, rest.
    const fly = play('scene.d10.night', 10, {}, [0, 0]);
    expect(fly.done).toBe(true);
    expect(fly.effects).toEqual(expect.arrayContaining([{ sun: -120 }, { flag: 'ragna_hill', set: 1 }]));
    const silver = play('scene.d10.night', 10, {}, [0, 1]);
    expect(silver.done).toBe(false);
    expect(text(silver)).toContain("The hill doesn't come down.");
    expect(silver.choices.map((c) => c.text)).toEqual(['Fly her up at dawn.', 'Let her rest until the thaw.']);
    expect(silver.effects.some((e) => 'rings' in e)).toBe(false);
    const rest = play('scene.d10.night', 10, {}, [0, 2]);
    expect(rest.effects).toEqual(expect.arrayContaining([{ flag: 'ragna_waits', set: 1 }]));
    expect(rest.effects.some((e) => 'sun' in e)).toBe(false);
    // Nobody asks if she's gone already.
    expect(play('scene.d10.night', 10, {}, [0], 'gone').done).toBe(true);
  });

  it('gives one more chance on Night 13, at a higher price, and loses her if refused', () => {
    expect(play('scene.d13.night', 13, {}, []).choices[0]?.text).not.toBe('Fly her up at dawn.');
    const again = play('scene.d13.night', 13, { ragna_waits: 1 }, [0]);
    expect(again.effects).toEqual(expect.arrayContaining([{ sun: -180 }, { flag: 'ragna_hill', set: 2 }]));
    const refused = play('scene.d13.night', 13, { ragna_waits: 1 }, [1]);
    expect(refused.effects).toEqual(
      expect.arrayContaining([
        { flag: 'ragna_refused', set: 1 },
        { family: 'mother', becomes: 'gone' },
      ]),
    );
    expect(text(play('scene.d14.night', 14, { ragna_refused: 1 }, []))).toContain('crossed my bridge');
    expect(text(play('scene.d14.night', 14, {}, []))).not.toContain('crossed my bridge');
  });

  it('is remembered: the mornings after, and her letter on Night 15', () => {
    expect(text(play('scene.d11.morning', 11, { ragna_hill: 1 }, []))).toContain('Eir');
    expect(text(play('scene.d11.morning', 11, {}, []))).not.toContain('Eir');
    expect(text(play('scene.d14.morning', 14, { ragna_hill: 2 }, []))).toContain('Eir');
    expect(text(play('scene.d14.morning', 14, { ragna_hill: 1 }, []))).not.toContain('Eir');
    expect(text(play('scene.d15.night', 15, { ragna_hill: 1 }, []))).toContain('My chest is quiet');
  });

  it('is taken by the bots: they give the morning’s sun, and she stays', () => {
    const content = loadContent('dev-full');
    const r = simulateRun(content, 'hill-0', bot('expert'), 'payAll', { story: storyPolicy('plain'), scenes });
    expect(r.ledger.find((l) => l.day === 11)?.dawnS).toBe(-120);
    expect(r.ledger.filter((l) => l.dawnS !== undefined).map((l) => l.day)).toEqual([11]);
    expect(r.familyLost).toBe(0);
  }, 120_000);
});

describe('the levy and Solveig’s boy (docs/tech-spec.md §51)', () => {
  const scenes = loadScenes('dev-full');
  const env = (day: number, flags: Record<string, number>, brother = 'well') => ({
    seed: 1,
    day,
    rings: 50,
    flags,
    standing: { odin: 0, freyja: 0, hel: 0, loki: 0, clerk: 0 },
    family: { mother: 'well', brother, sister: 'well' },
    word: 0,
    wrong: 0,
  });
  const play = (id: string, day: number, flags: Record<string, number>, choices: number[], brother = 'well') => {
    const json = scenes[id];
    if (!json) throw new Error(`no ${id}`);
    return playScene(json, env(day, flags, brother), choices);
  };
  const text = (f: ReturnType<typeof play>) => f.lines.map((l) => l.text).join('\n');

  it('lets Ulf go with the levy on Night 15, if he stayed home; silver can’t keep him', () => {
    // The ferryman's choice first; then Ulf: go, pay the steward, stay.
    const go = play('scene.d15.night', 15, { ulf_home: 1 }, [1, 0]);
    expect(go.effects).toEqual(
      expect.arrayContaining([
        { flag: 'ulf_levy', set: 1 },
        { standing: 'odin', by: 1 },
      ]),
    );
    const steward = play('scene.d15.night', 15, { ulf_home: 1 }, [1, 1]);
    expect(text(steward)).toContain("I'm not a debt.");
    expect(steward.effects.some((e) => 'rings' in e)).toBe(false);
    expect(steward.choices.map((c) => c.text)).toEqual([
      '"Go, then. Keep your shield up."',
      '"Stay. They need you at home."',
    ]);
    expect(play('scene.d15.night', 15, { ulf_home: 1 }, [1, 2]).effects).toEqual(
      expect.arrayContaining([{ flag: 'ulf_stayed', set: 1 }]),
    );
    // Away in the north, or gone, he isn't asked: the levy is news.
    const north = play('scene.d15.night', 15, { ulf_shipyard: 1 }, [1]);
    expect(north.done).toBe(true);
    expect(text(north)).toContain('gone up to the pass');
    expect(play('scene.d15.night', 15, { ulf_home: 1 }, [1], 'gone').done).toBe(true);
  });

  it('brings the levy home on Night 16: Ulf hurt if he went, and the neighbours know where Kari went', () => {
    const hurt = play('scene.d16.night', 16, { ulf_levy: 1, kari_valhalla: 1 }, []);
    expect(hurt.effects).toEqual(expect.arrayContaining([{ family: 'brother', becomes: 'sick' }]));
    expect(text(hurt)).toContain('three shields down from Kari');
    expect(text(hurt)).toContain("Odin's benches");
    const stayed = play('scene.d16.night', 16, { ulf_stayed: 1, kari_ran: 1 }, []);
    expect(stayed.effects.some((e) => 'family' in e)).toBe(false);
    expect(text(stayed)).toContain('I should have been next to him');
    expect(text(stayed)).toContain('at a loom by the sea');
    expect(text(play('scene.d16.night', 16, {}, []))).toContain("Solveig's boy didn't come down from the pass");
  });

  it('is granted by a bot that grants pleas: a mistake, and Odin’s standing', () => {
    const content = loadContent('dev-full');
    const day16 = (pleas: boolean) =>
      simulateRun(content, 'plea-0', bot('expert'), 'payAll', { pleas }).ledger.find((l) => l.day === 16);
    expect((day16(false)?.mistakes ?? []).some((m) => m.pled)).toBe(false);
    expect((day16(true)?.mistakes ?? []).filter((m) => m.pled)).toEqual([
      expect.objectContaining({ expected: 'VALHALLA', stamped: 'RAN', pled: true }),
    ]);
  }, 120_000);
});

describe('choosing the slain at the pass (docs/tech-spec.md §78)', () => {
  const scenes = loadScenes('dev-full');
  const home: Record<string, string> = { mother: 'well', brother: 'well', sister: 'well' };
  const gone = { ...home, brother: 'gone' };
  const env = (day: number, flags: Record<string, number>, family: Record<string, string>) => ({
    seed: 1,
    day,
    rings: 50,
    flags,
    standing: { odin: 0, freyja: 0, hel: 0, loki: 0, clerk: 0 },
    family,
    word: 0,
    wrong: 0,
  });
  const play = (id: string, day: number, flags: Record<string, number>, choices: number[], family = home) => {
    const json = scenes[id];
    if (!json) throw new Error(`no ${id}`);
    return playScene(json, env(day, flags, family), choices);
  };
  const text = (f: ReturnType<typeof play>) => f.lines.map((l) => l.text).join('\n');

  it('is foretold on Night 15, whatever Ulf does', () => {
    const nights: [Record<string, number>, number[]][] = [
      [{ ulf_home: 1 }, [1, 0]],
      [{ ulf_home: 1 }, [1, 2]],
      [{ ulf_shipyard: 1 }, [1]],
    ];
    for (const [flags, choices] of nights) {
      const night = play('scene.d15.night', 15, flags, choices);
      expect(night.done).toBe(true);
      expect(text(night)).toContain('We ride before light');
    }
  });

  it('offers Kari, Ulf if he went with the levy and is home, and Aslak; or choosing no one', () => {
    const roster = (flags: Record<string, number>, family = home) =>
      play('scene.d16.morning', 16, flags, [], family).choices.map((c) => c.text);
    expect(roster({ ulf_levy: 1 })).toEqual(['Kari.', 'Ulf.', 'Aslak.', "I won't choose."]);
    expect(roster({ ulf_stayed: 1 })).toEqual(['Kari.', 'Aslak.', "I won't choose."]);
    expect(roster({ ulf_levy: 1 }, gone)).toEqual(['Kari.', 'Aslak.', "I won't choose."]);
    // Whoever is chosen falls, and Odin minds whom: the best is what he'd have taken anyway; your own blood is more,
    // and the oldest less.
    const pick = (i: number) => play('scene.d16.morning', 16, { ulf_levy: 1 }, [i]);
    expect(pick(0).effects).toEqual([{ flag: 'chose_kari', set: 1 }]);
    expect(pick(1).effects).toEqual([
      { flag: 'chose_ulf', set: 1 },
      { standing: 'odin', by: 2 },
      { family: 'brother', becomes: 'gone' },
    ]);
    expect(pick(2).effects).toEqual([
      { flag: 'chose_aslak', set: 1 },
      { standing: 'odin', by: -1 },
    ]);
    // Not choosing is a choice too: Skögul takes the bravest, and Odin minds being refused.
    const none = pick(3);
    expect(none.effects).toEqual([
      { flag: 'chose_none', set: 1 },
      { standing: 'odin', by: -1 },
    ]);
    expect(text(none)).toContain("finds Solveig's boy");
    // Then the decree, as on any morning.
    for (const f of [pick(0), pick(1), pick(2), none]) {
      expect(f.done).toBe(true);
      expect(text(f)).toContain('"Liars," says Skögul');
    }
  });

  it('sends the news of whoever fell home that night, and Skögul says one thing of it at supper', () => {
    // Ulf, chosen: gone since the morning, so your mother writes, or your aunt; nobody else sickens.
    const ulf = play('scene.d16.night', 16, { ulf_levy: 1, chose_ulf: 1 }, [], gone);
    expect(text(ulf)).toContain("Ulf didn't come down from the pass");
    expect(ulf.lines.some((l) => l.speaker === 'mother')).toBe(true);
    expect(text(ulf)).toContain('second cup');
    expect(ulf.effects).toEqual([]);
    const aunt = play('scene.d16.night', 16, { ulf_levy: 1, chose_ulf: 1 }, [], { ...gone, mother: 'gone' });
    expect(text(aunt)).toContain('Your aunt writes for Asa. Ulf didn');
    // Aslak, chosen: Solveig's boy came home, Ulf is hurt all the same if he went, and Bera knows where her man is.
    const aslak = play('scene.d16.night', 16, { ulf_levy: 1, chose_aslak: 1, aslak_judged: 1, aslak_valhalla: 1 }, []);
    expect(aslak.effects).toEqual([{ family: 'brother', becomes: 'sick' }]);
    expect(text(aslak)).toContain("Old Aslak didn't come down");
    expect(text(aslak)).toContain("Aslak's on Odin's benches");
    expect(text(aslak)).toContain('Odin asked after the old man');
    const elsewhere = text(play('scene.d16.night', 16, { chose_aslak: 1, aslak_judged: 1 }, []));
    expect(elsewhere).toContain("Solveig's boy did.");
    expect(elsewhere).toContain("I don't know where he is tonight");
    // Kari, chosen, or taken by Skögul: the letters as before; Odin's thanks, or her reproach.
    expect(text(play('scene.d16.night', 16, { chose_kari: 1, kari_valhalla: 1 }, []))).toContain(
      'From Odin, for the boy at the pass',
    );
    expect(text(play('scene.d16.night', 16, { chose_none: 1, kari_ran: 1 }, []))).toContain('point yourself one day');
    // A run from before the choosing: Kari fell, and Skögul says nothing of it.
    const before = text(play('scene.d16.night', 16, { kari_valhalla: 1 }, []));
    expect(before).toContain("Solveig's boy didn't come down from the pass");
    expect(before).not.toMatch(/From Odin|second cup|point yourself|asked after the old man/);
    // The next night your mother writes about everything but Ulf.
    expect(text(play('scene.d17.night', 17, { chose_ulf: 1 }, [], gone))).toContain('None of it is about Ulf.');
    expect(text(play('scene.d17.night', 17, {}, []))).toContain("a neighbour's wedding");
  });

  it('is chosen by the bots as their gods would: Kari for Odin and the plain, Aslak against him, never Ulf', () => {
    const content = loadContent('dev-full');
    const run = (story: string) =>
      simulateRun(content, 'slain-0', bot('expert'), 'payAll', { story: storyPolicy(story), scenes });
    const kariAsked = (r: ReturnType<typeof run>) =>
      (r.ledger.find((l) => l.day === 16)?.pleas ?? []).some((p) => p.name === 'Kari Solveigarson');
    const plain = run('plain');
    expect(kariAsked(plain)).toBe(true);
    expect(plain.epilogue).not.toContain('epi.levy.aslak');
    const hel = run('hel');
    expect(kariAsked(hel)).toBe(false);
    expect(hel.epilogue).toContain('epi.levy.aslak');
    expect(hel.epilogue.some((k) => k.startsWith('epi.aslak.'))).toBe(true);
    for (const r of [plain, hel]) expect(r.familyLost).toBe(0);
  }, 240_000);
});
