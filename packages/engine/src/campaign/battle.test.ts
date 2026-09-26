import { loadContent } from '@cots/testkit';
import { fc, test } from '@fast-check/vitest';
import { describe, expect, it } from 'vitest';
import type { RagnarokDef } from '../content/types';
import { type Battle, fight, heldFronts, hostsAt, namedIn } from './battle';
import { newRun } from './run';
import type { RunState } from './state';

// The last battle (docs/tech-spec.md §54), on a small made-up field: three hosts, three fronts.
const DEF: RagnarokDef = {
  text: 'ragnarok.text',
  hosts: [
    { id: 'host.a', name: 'host.a', hall: 'VALHALLA', front: 'front.a' },
    { id: 'host.b', name: 'host.b', hall: 'HEL', front: 'front.b' },
    { id: 'host.c', name: 'host.c', hall: 'RAN', front: 'front.c', only: true },
  ],
  fronts: [
    { id: 'front.a', name: 'a', text: 'a', held: 'a', fell: 'a', foe: 40 },
    { id: 'front.b', name: 'b', text: 'b', held: 'b', fell: 'b', foe: 60 },
    { id: 'front.c', name: 'c', text: 'c', held: 'c', fell: 'c', foe: 10, perNail: 2 },
  ],
};

/** The same field, where the chooser rides out too (docs/tech-spec.md §58). */
const RIDDEN: RagnarokDef = { ...DEF, ride: { strength: 15 } };

const base = newRun(loadContent('dev-full'), 'battle');

/** A run with so many worthy and unworthy einherjar, souls sent to Hel and Rán, misfits among them, and long nails. */
function runWith(p: {
  worthy?: number;
  unworthy?: number;
  hel?: number;
  helMisfits?: number;
  ran?: number;
  ranMisfits?: number;
  nails?: number;
  /** Strength bought with arms (docs/tech-spec.md §56), by front. */
  armed?: Record<string, number>;
}): RunState {
  return {
    ...base,
    einherjar: { worthy: p.worthy ?? 0, unworthy: p.unworthy ?? 0 },
    sent: { HEL: p.hel ?? 0, RAN: p.ran ?? 0 },
    misfits: { HEL: p.helMisfits ?? 0, RAN: p.ranMisfits ?? 0 },
    naglfar: p.nails ?? 0,
    ...(p.armed ? { armed: p.armed } : {}),
  };
}

const front = (b: Battle, id: string) => b.fronts.find((f) => f.id === id);

describe('the hosts', () => {
  it('are the souls sent to each hall rightly, and those sent there by mistake (to Valhalla: the unworthy)', () => {
    const hosts = hostsAt(runWith({ worthy: 30, unworthy: 4, hel: 50, helMisfits: 6, ran: 9, ranMisfits: 2 }), DEF);
    expect(hosts.map((h) => [h.id, h.souls, h.misfits, h.only])).toEqual([
      ['host.a', 30, 4, false],
      ['host.b', 44, 6, false],
      ['host.c', 7, 2, true],
    ]);
  });
});

describe('the souls it names', () => {
  it('are each host’s own, those who’ll run apart from the story’s, in the order of the days they came', () => {
    const run: RunState = {
      ...base,
      named: [
        { name: 'Geir Hallsson', day: 6, hall: 'HEL', runs: true },
        { name: 'Asgaut Thorolfsson', day: 9, hall: 'HEL', runs: false },
        { name: 'Bjorn Ketilsson', day: 11, hall: 'VALHALLA', runs: true },
        // Appealed on Day 4 and sent wrong again: added last, it's still told by its day.
        { name: 'Ulfhild Grimsdottir', day: 3, hall: 'HEL', runs: true },
      ],
    };
    expect(namedIn(run, 'HEL').runs.map((n) => n.name)).toEqual(['Ulfhild Grimsdottir', 'Geir Hallsson']);
    expect(namedIn(run, 'HEL').story.map((n) => n.name)).toEqual(['Asgaut Thorolfsson']);
    expect(namedIn(run, 'RAN')).toEqual({ runs: [], story: [] });
    expect(namedIn(base, 'HEL')).toEqual({ runs: [], story: [] });
  });
});

describe('the last battle', () => {
  it('holds a front its own host can: 2 a soul there, less 1 for each who runs', () => {
    // 20 worthy make 40, but 2 unworthy run: the wolf's 40 needs 21 of them. (The drowned hold the shore alone.)
    const b = fight(runWith({ worthy: 20, unworthy: 2, ran: 5 }), DEF, ['front.a']);
    expect(front(b, 'front.a')).toMatchObject({ held: false, ran: 2, strength: 38 });
    const held = fight(runWith({ worthy: 21, unworthy: 2, ran: 5 }), DEF, ['front.a']);
    expect(front(held, 'front.a')).toMatchObject({ held: true, strength: 40, stood: [{ host: 'host.a', souls: 21 }] });
  });

  it('makes up a front its host can’t hold with souls the others can spare, 1 a soul', () => {
    // Hel's 40 hold her gate (60) with 10 to spare: the wolf's front needs 40 - 2*15 = 10 of them.
    const b = fight(runWith({ worthy: 15, hel: 40, ran: 5 }), DEF, ['front.a', 'front.b']);
    expect(heldFronts(b)).toEqual(['front.a', 'front.b', 'front.c']);
    expect(front(b, 'front.a')?.stood).toEqual([
      { host: 'host.a', souls: 15, strength: 30 },
      { host: 'host.b', souls: 10, strength: 10 },
    ]);
    expect(front(b, 'front.b')).toMatchObject({ strength: 60, stood: [{ host: 'host.b', souls: 30, strength: 60 }] });
  });

  it('holds the fronts in the order given: where both can’t be held, the first is', () => {
    // 14 worthy (28) and 35 at Hel's (70): holding both takes 40 + 60 = 100 of 98. The drowned hold the shore alone.
    const run = runWith({ worthy: 14, hel: 35, ran: 5 });
    expect(heldFronts(fight(run, DEF, ['front.a', 'front.b']))).toEqual(['front.a', 'front.c']);
    expect(heldFronts(fight(run, DEF, ['front.b', 'front.a']))).toEqual(['front.b', 'front.c']);
    // The front that fell kept whoever wasn't needed elsewhere, and they weren't enough.
    const b = fight(run, DEF, ['front.b', 'front.a']);
    expect(front(b, 'front.a')).toMatchObject({ held: false });
    expect(front(b, 'front.a')?.strength).toBeLessThan(40);
  });

  it('sends a fallen front’s souls where they’re needed: an empty shore takes them', () => {
    // The wolf's front can't be held (20 worthy, 2 who run, against 40); the shore has no drowned, and takes 10.
    const b = fight(runWith({ worthy: 20, unworthy: 2 }), DEF, ['front.a', 'front.c']);
    expect(heldFronts(b)).toEqual(['front.c']);
    expect(front(b, 'front.c')?.stood).toEqual([{ host: 'host.a', souls: 10, strength: 10 }]);
    expect(front(b, 'front.a')).toMatchObject({ held: false, strength: 18, stood: [{ host: 'host.a', souls: 10 }] });
  });

  it('keeps a host marked `only` at its own front, and Naglfar grows with every nail left long', () => {
    // The drowned (20) hold the shore against 10 + 2 a nail: 40 against 30 with 10 nails, 42 with 16.
    expect(front(fight(runWith({ ran: 20, nails: 10 }), DEF, []), 'front.c')).toMatchObject({ foe: 30, held: true });
    expect(front(fight(runWith({ ran: 20, nails: 16 }), DEF, []), 'front.c')).toMatchObject({ foe: 42, held: false });
    // Their spare souls go nowhere else: the wolf's front stands empty and falls.
    const b = fight(runWith({ ran: 50 }), DEF, ['front.a', 'front.c']);
    expect(heldFronts(b)).toEqual(['front.c']);
    expect(front(b, 'front.a')?.stood).toEqual([]);
  });

  it('adds the chooser’s strength where the player rides, and it can hold a front that would fall (§58)', () => {
    // 20 worthy, 2 who run: 38 against the wolf's 40. Riding there makes it 53.
    const run = runWith({ worthy: 20, unworthy: 2, ran: 5 });
    expect(front(fight(run, RIDDEN, ['front.a']), 'front.a')).toMatchObject({ held: false, strength: 38 });
    const rode = fight(run, RIDDEN, ['front.a'], 'front.a');
    expect(rode.ride).toBe('front.a');
    expect(front(rode, 'front.a')).toMatchObject({ held: true, ride: 15, strength: 53 });
    expect(rode.fronts.filter((f) => f.id !== 'front.a').every((f) => f.ride === undefined)).toBe(true);
    // Riding elsewhere doesn't help it; nor does riding where there's no such front, or in a battle without the ride.
    expect(front(fight(run, RIDDEN, ['front.a'], 'front.b'), 'front.a')?.held).toBe(false);
    expect(fight(run, RIDDEN, ['front.a'], 'front.x').ride).toBeUndefined();
    expect(front(fight(run, DEF, ['front.a'], 'front.a'), 'front.a')).toMatchObject({ held: false, strength: 38 });
  });

  it('takes an order with unknown and repeated fronts, and puts the fronts it leaves out after, in order', () => {
    const b = fight(runWith({ worthy: 50, hel: 50, ran: 10 }), DEF, ['front.b', 'nope', 'front.b']);
    expect(b.order).toEqual(['front.b', 'front.a', 'front.c']);
    expect(heldFronts(b)).toEqual(['front.a', 'front.b', 'front.c']);
  });

  test.prop(
    [
      fc.record({
        worthy: fc.nat(60),
        unworthy: fc.nat(10),
        hel: fc.nat(80),
        helMisfits: fc.nat(10),
        ran: fc.nat(30),
        ranMisfits: fc.nat(5),
        nails: fc.nat(20),
        armsA: fc.nat(40),
        armsC: fc.nat(20),
      }),
      fc.shuffledSubarray(['front.a', 'front.b', 'front.c'], { minLength: 3, maxLength: 3 }),
      fc.constantFrom(undefined, 'front.a', 'front.b', 'front.c'),
    ],
    { numRuns: 300 },
  )('holds every front it says it holds, and no front it says fell was held', (p, order, ride) => {
    const run = runWith({
      ...p,
      helMisfits: Math.min(p.helMisfits, p.hel),
      ranMisfits: Math.min(p.ranMisfits, p.ran),
      armed: { 'front.a': p.armsA, 'front.c': p.armsC },
    });
    const b = fight(run, RIDDEN, order, ride);
    const hosts = hostsAt(run, RIDDEN);
    for (const f of b.fronts) {
      if (f.held) expect(f.strength, f.id).toBeGreaterThanOrEqual(f.foe);
      else expect(f.strength, f.id).toBeLessThan(f.foe);
      // The chooser is at one front at most: the one ridden to.
      expect(f.ride ?? 0, f.id).toBe(f.id === ride ? 15 : 0);
    }
    // Nobody is in two places: each host's souls at the fronts add up to at most what it has.
    for (const h of hosts) {
      const placed = b.fronts.reduce((n, f) => n + (f.stood.find((s) => s.host === h.id)?.souls ?? 0), 0);
      expect(placed, h.id).toBeLessThanOrEqual(h.souls);
    }
    // Holding more in another order is never possible by adding a front this order let fall: each fell
    // because it couldn't be held along with those before it.
    for (const f of b.fronts.filter((x) => !x.held)) {
      const before = b.order.slice(0, b.order.indexOf(f.id));
      const again = fight(run, RIDDEN, [...before.filter((id) => front(b, id)?.held), f.id], ride);
      expect(front(again, f.id)?.held, f.id).toBe(false);
    }
  });
});
