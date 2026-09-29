import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { type CampaignPart, TARGETS } from '@cots/content-schema';
import { afterEach, describe, expect, it } from 'vitest';
import { compileTarget, loadPacks } from './compile';

const packsDir = resolve(import.meta.dirname, '../../../content/packs');

let out = '';
afterEach(() => {
  if (out) rmSync(out, { recursive: true, force: true });
  out = '';
});

/** Compiles the full game from the real packs, with the campaign pack's part changed. */
function compileWith(change: (campaign: CampaignPart) => CampaignPart): () => void {
  const packs = loadPacks(packsDir);
  const pack = packs.get('campaign');
  if (!pack?.content.campaign) throw new Error('the campaign pack has no campaign');
  pack.content.campaign = change(pack.content.campaign);
  return () => {
    out = mkdtempSync(join(tmpdir(), 'cots-campaign-'));
    compileTarget('dev-full', TARGETS['dev-full'], packs, out);
  };
}

type Requests = NonNullable<CampaignPart['requests']>;
type Favours = NonNullable<CampaignPart['favours']>;

// docs/tech-spec.md §42.
describe('the gods’ requests, as content', () => {
  const withRequests = (change: (list: Requests['list']) => Requests['list']) =>
    compileWith((c) => (c.requests ? { ...c, requests: { ...c.requests, list: change(c.requests.list) } } : c));
  it('refuses words that are missing, a favour that is no mistake, and one that stops before it starts', () => {
    const first = (edit: (r: Requests['list'][number]) => Requests['list'][number]) =>
      withRequests(([r, ...rest]) => (r ? [edit(r), ...rest] : rest));
    expect(first((r) => ({ ...r, text: 'request.nobody' }))).toThrow(
      /request req\.\w+ uses missing string "request\.nobody"/,
    );
    expect(first((r) => ({ ...r, to: r.from }))).toThrow(/asks for souls sent where they already belong/);
    expect(first((r) => ({ ...r, until: r.since }))).toThrow(/stops before it starts/);
    expect(withRequests((list) => [...list, ...list.slice(0, 1)])).toThrow(/Duplicate request "req\.\w+"/);
  }, 60_000);
});

// docs/tech-spec.md §43.
describe('the gods’ favours, as content', () => {
  const withFavours = (change: (list: Favours) => Favours) =>
    compileWith((c) => ({ ...c, favours: change(c.favours ?? []) }));
  it('compiles as shipped, and refuses words that are missing or a favour named twice', () => {
    expect(withFavours((list) => list)).not.toThrow();
    expect(withFavours(([f, ...rest]) => (f ? [{ ...f, text: 'favour.nobody' }, ...rest] : rest))).toThrow(
      /favour fav\.\w+ uses missing string "favour\.nobody"/,
    );
    expect(withFavours((list) => [...list, ...list.slice(0, 1)])).toThrow(/Duplicate favour "fav\.\w+"/);
  }, 60_000);
});

// docs/tech-spec.md §44.
describe('promotion, as content', () => {
  type Ranks = NonNullable<CampaignPart['promotion']>['ranks'];
  const withRanks = (change: (ranks: Ranks) => Ranks) =>
    compileWith((c) => (c.promotion ? { ...c, promotion: { ...c.promotion, ranks: change(c.promotion.ranks) } } : c));
  it('refuses a rank whose words are missing, or a rank named twice', () => {
    expect(withRanks(([r, ...rest]) => (r ? [{ ...r, name: 'rank.nobody' }, ...rest] : rest))).toThrow(
      /rank rank\.\w+ uses missing string "rank\.nobody"/,
    );
    expect(withRanks((list) => [...list, ...list.slice(0, 1)])).toThrow(/Duplicate rank "rank\.\w+"/);
  }, 60_000);
});

// docs/tech-spec.md §52.
describe('day events, as content', () => {
  type Events = NonNullable<CampaignPart['events']>;
  const withEvents = (change: (events: Events) => Events) =>
    compileWith((c) => (c.events ? { ...c, events: change(c.events) } : c));
  const first = (edit: (e: Events['pool'][number]) => Events['pool'][number]) =>
    withEvents((d) => ({ ...d, pool: d.pool.map((e, i) => (i === 0 ? edit(e) : e)) }));
  it('compiles as shipped, and refuses missing words, an event named twice, or more drawn than there are', () => {
    expect(withEvents((d) => d)).not.toThrow();
    expect(first((e) => ({ ...e, text: 'event.nobody' }))).toThrow(/day event event\.\w+ uses missing string/);
    expect(withEvents((d) => ({ ...d, pool: [...d.pool, ...d.pool.slice(0, 1)] }))).toThrow(
      /Duplicate day event "event\.\w+"/,
    );
    expect(withEvents((d) => ({ ...d, perRun: d.pool.length + 1 }))).toThrow(/draws \d+ day events, from only \d+/);
  }, 60_000);
  it('refuses souls of a kind a day lacks, one bound where its kind never goes, and too short a line', () => {
    const storm = (edit: (e: Events['pool'][number]) => Events['pool'][number]) =>
      withEvents((d) => ({ ...d, pool: d.pool.map((e) => (e.id === 'event.storm' ? edit(e) : e)) }));
    // Days 5-8 have no bedridden souls, and a drowned raider is never Valhalla's.
    expect(storm((e) => ({ ...e, souls: [{ kind: 'arch.bedridden', to: ['TRANSFER'], n: 1 }] }))).toThrow(
      /day event event\.storm: day 5 has no arch\.bedridden bound for TRANSFER/,
    );
    expect(storm((e) => ({ ...e, souls: [{ kind: 'arch.drowned_raider', to: ['VALHALLA'], n: 1 }] }))).toThrow(
      /has no arch\.drowned_raider bound for VALHALLA/,
    );
    expect(storm((e) => ({ ...e, fewer: 9 }))).toThrow(/day event event\.storm leaves day \d+ too short a line/);
  }, 60_000);
});

// docs/tech-spec.md §53.
describe('the Norns’ weave, as content', () => {
  type Weaving = NonNullable<CampaignPart['weaving']>;
  const withWeaving = (change: (w: Weaving) => Weaving) =>
    compileWith((c) => (c.weaving ? { ...c, weaving: change(c.weaving) } : c));
  const first = (edit: (w: Weaving['weaves'][number]) => Weaving['weaves'][number]) =>
    withWeaving((d) => ({ ...d, weaves: d.weaves.map((w, i) => (i === 0 ? edit(w) : w)) }));
  it('compiles as shipped, and refuses missing words, an unknown ending or rule, and a weave named twice', () => {
    expect(withWeaving((d) => d)).not.toThrow();
    expect(first((w) => ({ ...w, name: 'weave.nobody' }))).toThrow(/weave weave\.\w+ uses missing string/);
    expect(withWeaving((d) => ({ ...d, after: ['ending.nowhere'] }))).toThrow(/opens after "ending\.nowhere"/);
    expect(first((w) => ({ ...w, order: { 'rule.nothing': 10 } }))).toThrow(/moves unknown rule "rule\.nothing"/);
    expect(withWeaving((d) => ({ ...d, weaves: [...d.weaves, ...d.weaves.slice(0, 1)] }))).toThrow(
      /Duplicate weave "weave\.\w+"/,
    );
  }, 60_000);
  it('refuses a weave that changes no day, one that leaves no catch-all last, and souls it can’t bring', () => {
    // Rán's rule moved to where it already is changes nothing.
    expect(first((w) => ({ ...w, order: { 'rule.ran': 500 }, souls: [] }))).toThrow(/weave weave\.\w+ changes no day/);
    // Hel's catch-all read before Valhalla's is no catch-all.
    expect(first((w) => ({ ...w, order: { 'rule.hel': 650 }, souls: [] }))).toThrow(
      /the last rule read doesn't always apply/,
    );
    // Drowned raiders are never Odin's.
    expect(first((w) => ({ ...w, souls: [{ kind: 'arch.drowned_raider', to: ['VALHALLA'], n: 1 }] }))).toThrow(
      /has no arch\.drowned_raider bound for VALHALLA/,
    );
  }, 60_000);
});

// docs/tech-spec.md §54.
describe('the last battle, as content', () => {
  type Ragnarok = NonNullable<CampaignPart['ragnarok']>;
  const withBattle = (change: (d: Ragnarok) => Ragnarok) =>
    compileWith((c) => (c.ragnarok ? { ...c, ragnarok: change(c.ragnarok) } : c));
  it('compiles as shipped, and refuses missing words, a front endings can’t read, and hosts that share', () => {
    expect(withBattle((d) => d)).not.toThrow();
    expect(withBattle((d) => ({ ...d, text: 'ragnarok.nothing' }))).toThrow(/the last battle uses missing string/);
    expect(
      withBattle((d) => ({ ...d, fronts: d.fronts.map((f, i) => (i === 0 ? { ...f, fell: 'x.y' } : f)) })),
    ).toThrow(/front front\.\w+ uses missing string "x\.y"/);
    expect(
      withBattle((d) => ({
        ...d,
        fronts: [...d.fronts, { ...(d.fronts[0] as Ragnarok['fronts'][number]), id: 'wall' }],
      })),
    ).toThrow(/front wall: a front's id is "front\.<name>"/);
    const [a, b] = d0Hosts();
    expect(withBattle((d) => ({ ...d, hosts: [{ ...a, front: 'front.nowhere' }, ...d.hosts.slice(1)] }))).toThrow(
      /host host\.\w+ has unknown front "front\.nowhere"/,
    );
    expect(withBattle((d) => ({ ...d, hosts: [a, { ...b, front: a.front }, ...d.hosts.slice(2)] }))).toThrow(
      /both have front\.\w+ for their own front/,
    );
    expect(withBattle((d) => ({ ...d, hosts: [a, { ...b, hall: a.hall }, ...d.hosts.slice(2)] }))).toThrow(
      /are both the souls sent to VALHALLA/,
    );
  }, 60_000);
  it('refuses an ending that reads a front there isn’t, or the battle in a build without one', () => {
    const reads = (state: string) =>
      compileWith((c) => ({
        ...c,
        endings: (c.endings ?? []).map((e) =>
          e.id === 'ending.wolf'
            ? {
                ...e,
                when: {
                  all: [
                    { state: 'day', gte: 20 },
                    { state, gte: 1 },
                  ],
                },
              }
            : e,
        ),
      }));
    expect(reads('front.moon')).toThrow(/ending ending\.wolf reads unknown front "front\.moon"/);
    expect(compileWith(({ ragnarok: _, ...c }) => c)).toThrow(
      /ending ending\.\w+ reads the last battle, but this build has none/,
    );
  }, 60_000);
});

/** The shipped battle's first two hosts. */
function d0Hosts(): [
  NonNullable<CampaignPart['ragnarok']>['hosts'][number],
  NonNullable<CampaignPart['ragnarok']>['hosts'][number],
] {
  const hosts = loadPacks(packsDir).get('campaign')?.content.campaign?.ragnarok?.hosts ?? [];
  const [a, b] = hosts;
  if (!a || !b) throw new Error('the battle needs two hosts');
  return [a, b];
}

type Epilogue = NonNullable<CampaignPart['epilogue']>;

// docs/tech-spec.md §55.
describe('the epilogue, as content', () => {
  const slot = (lines: Epilogue['slots'][number]['lines']): Epilogue['slots'][number] => ({
    id: 'epi.test',
    section: 'home',
    lines,
  });
  const withEpilogue = (slots: Epilogue['slots'], when?: Epilogue['when']) =>
    compileWith((c) => ({ ...c, epilogue: { ...(when ? { when } : {}), slots } }));
  it('reads the family by name and the ending the run came to, and nothing that isn’t there', () => {
    const fine = slot([
      { when: { state: 'member.mother.died', gte: 1 }, text: 'ending.wolf.text' },
      { when: { state: 'ending.wolf', gte: 1 }, text: 'ending.wolf.text' },
      { text: 'ending.lastStand.text' },
    ]);
    expect(withEpilogue([fine], { state: 'day', gte: 20 })).not.toThrow();
    expect(withEpilogue([slot([{ when: { state: 'member.uncle.gone', gte: 1 }, text: 'ending.wolf.text' }])])).toThrow(
      /epilogue slot epi\.test, line 1 reads "member\.uncle\.gone", but nobody in the family is "uncle"/,
    );
    expect(withEpilogue([slot([{ when: { state: 'ending.moon', gte: 1 }, text: 'ending.wolf.text' }])])).toThrow(
      /epilogue slot epi\.test, line 1 reads "ending\.moon", which isn't an ending/,
    );
    expect(withEpilogue([slot([{ when: { state: 'member.mother', gte: 1 }, text: 'ending.wolf.text' }])])).toThrow(
      /reads unknown run state "member\.mother"/,
    );
    expect(withEpilogue([slot([{ text: 'epi.nobody' }])])).toThrow(
      /epilogue slot epi\.test uses missing string "epi\.nobody"/,
    );
    expect(withEpilogue([fine, fine])).toThrow(/Duplicate epilogue slot "epi\.test"/);
  }, 60_000);

  it('refuses a line that can never show, and an ending or thread that reads the ending', () => {
    expect(withEpilogue([slot([{ text: 'ending.wolf.text' }, { text: 'ending.lastStand.text' }])])).toThrow(
      /epilogue slot epi\.test: line 1 always holds, so the lines after it never show/,
    );
    const endingReads = compileWith((c) => ({
      ...c,
      endings: (c.endings ?? []).map((e) =>
        e.id === 'ending.wolf' ? { ...e, when: { state: 'ending.odin', gte: 1 } } : e,
      ),
    }));
    expect(endingReads).toThrow(/ending ending\.wolf reads the run's ending: only the epilogue can/);
  }, 60_000);
});

type Arms = NonNullable<CampaignPart['arms']>;

// docs/tech-spec.md §56.
describe('arms and the reprieve, as content', () => {
  const withArms = (change: (a: Arms) => Arms) => compileWith((c) => (c.arms ? { ...c, arms: change(c.arms) } : c));
  it('compiles as shipped, and refuses arms for a front the battle hasn’t, twice for one, or without words', () => {
    expect(withArms((a) => a)).not.toThrow();
    const [first, ...rest] = [...(loadPacks(packsDir).get('campaign')?.content.campaign?.arms?.fronts ?? [])];
    if (!first) throw new Error('the campaign sells no arms');
    expect(withArms((a) => ({ ...a, fronts: [{ ...first, front: 'front.moon' }, ...rest] }))).toThrow(
      /arms for front\.moon: the battle has no such front/,
    );
    expect(withArms((a) => ({ ...a, fronts: [first, first, ...rest] }))).toThrow(
      /arms for front\.\w+ are listed twice/,
    );
    expect(withArms((a) => ({ ...a, fronts: [{ ...first, name: 'arms.nobody' }, ...rest] }))).toThrow(
      /uses missing string "arms\.nobody"/,
    );
    expect(withArms((a) => ({ ...a, from: 99 }))).toThrow(/Arms go on sale after the last night/);
  }, 60_000);

  it('refuses a reprieve from an ending there isn’t', () => {
    const packs = loadPacks(packsDir);
    const demo = packs.get('demo')?.content.campaign;
    if (!demo?.reprieve) throw new Error('the demo pack has no reprieve');
    const reprieve = { ...demo.reprieve, ending: 'ending.moon' };
    expect(compileWith((c) => ({ ...c, reprieve }))).toThrow(
      /The reprieve stays "ending\.moon", which isn't an ending/,
    );
  }, 60_000);
});

type Trail = NonNullable<CampaignPart['trail']>;

// docs/tech-spec.md §71.
describe('the forger’s trail, as content', () => {
  const withTrail = (change: (t: Trail) => Trail | undefined) =>
    compileWith((c) => {
      if (!c.trail) return c;
      const { trail, ...rest } = c;
      const changed = change(trail);
      return changed ? { ...rest, trail: changed } : rest;
    });
  const suspect = (edit: (s: Trail['suspects'][number]) => Trail['suspects'][number]) =>
    withTrail((t) => ({ ...t, suspects: t.suspects.map((s, i) => (i === 0 ? edit(s) : s)) }));
  it('compiles as shipped, and refuses carvers that can’t be told apart, strangers’ names, or bad nights', () => {
    expect(withTrail((t) => t)).not.toThrow();
    expect(suspect((s) => ({ ...s, hands: [s.hands[0] ?? 'elderRune', s.hands[0] ?? 'elderRune'] }))).toThrow(
      /carver \w+ on the forger's trail has the same habit twice/,
    );
    expect(
      withTrail((t) => ({ ...t, suspects: t.suspects.map((s) => ({ ...s, hands: t.suspects[0]?.hands ?? s.hands })) })),
    ).toThrow(/has the same two habits as another carver/);
    expect(suspect((s) => ({ ...s, look: { ...s.look, name: 'Ketil' } }))).toThrow(
      /is named Ketil, which no names\.reserved pool keeps from generated souls/,
    );
    expect(suspect((s) => ({ ...s, text: 'trail.nobody' }))).toThrow(/uses missing string "trail\.nobody"/);
    expect(withTrail((t) => ({ ...t, suspects: [...t.suspects, ...t.suspects.slice(0, 1)] }))).toThrow(
      /Duplicate carver "\w+" on the forger's trail/,
    );
    expect(withTrail((t) => ({ ...t, nights: [t.since - 1] }))).toThrow(/names night \d+, which isn't a night/);
    expect(withTrail((t) => ({ ...t, nights: [20] }))).toThrow(/names night 20, which isn't a night/);
    expect(withTrail((t) => ({ ...t, when: { state: 'trail.moon', gte: 1 } }))).toThrow(
      /the forger's trail reads unknown run state "trail\.moon"/,
    );
  }, 60_000);

  it('refuses a carver’s face on a story soul where no trail gives one', () => {
    expect(withTrail(() => undefined)).toThrow(/wears the face of a carver, but this build has no forger's trail/);
  }, 60_000);
});

type Origins = NonNullable<CampaignPart['origins']>;

// docs/tech-spec.md §72.
describe('origins, as content', () => {
  const withOrigins = (change: (list: Origins) => Origins) =>
    compileWith((c) => ({ ...c, origins: change(c.origins ?? []) }));
  const first = (edit: (o: Origins[number]) => Origins[number]) =>
    withOrigins(([o, ...rest]) => (o ? [edit(o), ...rest] : rest));
  it('compiles as shipped, and refuses missing words, an origin twice, or one that gives nothing', () => {
    expect(withOrigins((list) => list)).not.toThrow();
    expect(first((o) => ({ ...o, text: 'origin.nobody' }))).toThrow(/origin \w+ uses missing string "origin\.nobody"/);
    expect(withOrigins((list) => [...list, ...list.slice(0, 1)])).toThrow(/Duplicate origin "\w+"/);
    expect(first((o) => ({ ...o, perk: {} }))).toThrow(/origin \w+ gives no perk/);
  }, 60_000);

  it('refuses someone at home who is family already, or whom two origins bring', () => {
    expect(first((o) => ({ ...o, member: { id: 'mother', name: 'family.mother', adult: true } }))).toThrow(
      /origin \w+ brings "mother", who is family already/,
    );
    expect(withOrigins(([a, b, ...rest]) => (a && b ? [a, { ...b, member: a.member }, ...rest] : rest))).toThrow(
      /origin \w+ brings "\w+", whom another origin brings/,
    );
  }, 60_000);

  it('refuses a scene that is missing, or two in one slot', () => {
    expect(first((o) => ({ ...o, scenes: [...o.scenes, { day: 2, at: 'night', scene: 'scene.o.nowhere' }] }))).toThrow(
      /origin \w+ plays missing scene "scene\.o\.nowhere"/,
    );
    expect(
      first((o) => ({ ...o, scenes: [...o.scenes, { day: 1, at: 'night', scene: 'scene.o.seeress.1' }] })),
    ).toThrow(/origin \w+ plays two scenes on the night of day 1/);
  }, 60_000);
});

type Word = NonNullable<CampaignPart['word']>;

// docs/tech-spec.md §73.
describe('word among the dead, as content', () => {
  const withWord = (change: (w: Word) => Word) => compileWith((c) => (c.word ? { ...c, word: change(c.word) } : c));
  const level = (i: number, edit: (l: Word['levels'][number]) => Word['levels'][number]) =>
    withWord((w) => ({ ...w, levels: w.levels.map((l, k) => (k === i ? edit(l) : l)) }));
  it('compiles as shipped, and refuses levels out of order, past its bounds or twice, and missing words', () => {
    expect(withWord((w) => w)).not.toThrow();
    expect(withWord((w) => ({ ...w, levels: [...w.levels].reverse() }))).toThrow(
      /The last word level word\.stern holds up to a word; it should hold the rest\./,
    );
    expect(level(1, (l) => ({ ...l, upTo: -3 }))).toThrow(
      /The word level word\.even holds up to -3, not past the level before it\./,
    );
    expect(level(1, (l) => ({ ...l, upTo: 3 }))).toThrow(
      /The word level word\.even holds up to 3, the word's bound or past it\./,
    );
    expect(withWord((w) => ({ ...w, levels: [w.levels[0] ?? w.levels[1], ...w.levels] as Word['levels'] }))).toThrow(
      /Duplicate word level "word\.stern"/,
    );
    expect(level(0, (l) => ({ ...l, text: 'word.nobody' }))).toThrow(
      /word level word\.stern uses missing string "word\.nobody"/,
    );
    expect(withWord((w) => ({ ...w, found: { ...w.found, text: 'word.nobody' } }))).toThrow(
      /the word among the dead uses missing string "word\.nobody"/,
    );
  }, 60_000);

  it('refuses offers to bring that there are none of, and offers no soul would make', () => {
    expect(withWord((w) => ({ ...w, offers: [] }))).toThrow(
      /The word level word\.soft brings offers, but there are none to bring\./,
    );
    expect(withWord((w) => ({ ...w, offers: [{ from: 'HEL', to: 'HEL', rings: 5 }] }))).toThrow(
      /The offer from HEL to HEL pays for the hall the soul already belongs in\./,
    );
    expect(withWord((w) => ({ ...w, offers: [{ from: 'HEL', to: 'RETURN', rings: 5 }] }))).toThrow(
      /The offer from HEL to RETURN pays for a stamp no soul asks for\./,
    );
    expect(withWord((w) => ({ ...w, offers: [{ from: 'DETAIN', to: 'VALHALLA', rings: 5 }] }))).toThrow(
      /The offer from DETAIN to VALHALLA comes from a hall whose souls never plead\./,
    );
  }, 60_000);

  it('refuses a word with no pleas for it to set the chance of', () => {
    expect(
      compileWith((c) => {
        const { pleas: _, ...rest } = c;
        return rest;
      }),
    ).toThrow(/The word among the dead sets how often souls ask, but the campaign has no pleas\./);
  }, 60_000);
});

type Letters = NonNullable<CampaignPart['letters']>;

// docs/tech-spec.md §74.
describe('letters from home, as content', () => {
  const withLetters = (change: (list: Letters) => Letters) =>
    compileWith((c) => ({ ...c, letters: change(c.letters ?? []) }));
  const talk = { day: 14, at: 'night' as const, scene: 'scene.e.talk' };
  it('compiles as shipped, and refuses a letter after the last day, sent twice, or reading what a run lacks', () => {
    expect(withLetters((list) => list)).not.toThrow();
    expect(withLetters((list) => [...list, { ...talk, day: 21 }])).toThrow(
      /the letter scene\.e\.talk on the night of day 21 comes after the campaign's last day/,
    );
    expect(withLetters((list) => [...list, talk])).toThrow(
      /the letter scene\.e\.talk on the night of day 14 is sent twice/,
    );
    expect(withLetters((list) => [...list, { ...talk, day: 15, when: { state: 'mood.odin', gte: 1 } }])).toThrow(
      /the letter scene\.e\.talk on the night of day 15 reads unknown run state "mood\.odin"/,
    );
  }, 60_000);

  it('refuses a letter whose scene is missing', () => {
    expect(withLetters((list) => [...list, { ...talk, scene: 'scene.e.nowhere' }])).toThrow(
      /the letter on the night of day 14 plays missing scene "scene\.e\.nowhere"/,
    );
  }, 60_000);
});
