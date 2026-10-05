import type { Look } from '@cots/engine';
import type { BodyScene, BodyView, Hotspot, HotspotId, Portrait } from './contract';

/**
 * The figure layout every provider shares: a standing body facing us in a
 * 300x420 frame, with the same anchors (head, hands, wound sites) and the
 * same hotspot regions. Keeping them shared means a player's taps land in the
 * same places whichever art is on, and the gameplay grouping of signs into
 * regions stays one decision.
 */

export const W = 300;
export const H = 420;
export const CX = 150;

/** Half the torso's width by build. */
export const half = (look: Look): number => (look.build === 'lean' ? 46 : look.build === 'broad' ? 58 : 64);

/** Where each hand is on screen. The body faces us, so its right hand is on our left (and swaps when flipped). */
export function hands(look: Look, view: BodyView): { R: number; L: number; y: number } {
  const off = half(look) + 26;
  return view === 'front' ? { R: CX - off, L: CX + off, y: 300 } : { R: CX + off, L: CX - off, y: 300 };
}

export const FRONT_WOUNDS: readonly (readonly [number, number])[] = [
  [CX - 22, 216],
  [CX + 18, 238],
  [CX - 8, 262],
];
export const BACK_WOUNDS: readonly (readonly [number, number])[] = [
  [CX - 20, 208],
  [CX + 20, 232],
  [CX, 258],
];

const HAND_KEYS = ['grip', 'gripHand', 'nails', 'wrongGrip', 'inscription', 'makersMark', 'webbing'];

export type WeaponKind = 'axe' | 'sword' | 'spear' | 'seax';
export const WEAPON_KINDS: readonly WeaponKind[] = ['axe', 'sword', 'spear', 'seax'];

/** The drawing for a weapon word ("bearded axe" is an axe); an axe when the words don't say. */
export function weaponKind(word: string | undefined): WeaponKind {
  const w = (word ?? '').toLowerCase();
  return w.includes('sword') ? 'sword' : w.includes('spear') ? 'spear' : w.includes('seax') ? 'seax' : 'axe';
}

/** Where a rune-lens sits over each weapon's blade, as a y offset from the fist. */
export const BLADE_Y: Readonly<Record<WeaponKind, number>> = { axe: -62, sword: -62, spear: -122, seax: -46 };

/** Which signs each region shows. */
export const REGION_KEYS: Readonly<Record<HotspotId, readonly string[]>> = {
  hair: ['hair', 'ears'],
  face: ['skin', 'lips', 'lipScars', 'breath', 'breathFog', 'scales', 'fly'],
  neck: ['ornament', 'amulet', 'brokenRing'],
  chest: ['woundsFront', 'freshCarving', 'spearCut'],
  handR: HAND_KEYS,
  handL: HAND_KEYS,
  back: ['woundsBack'],
};

/** The view each sign is drawn on (gameplay data: the content says which side of the body a sign is on). */
export const SIGN_VIEWS: Readonly<Record<string, BodyView>> = {
  grip: 'front',
  gripHand: 'front',
  woundsFront: 'front',
  skin: 'front',
  lips: 'front',
  hair: 'front',
  ornament: 'front',
  woundsBack: 'back',
  breath: 'front',
  breathFog: 'front',
  brokenRing: 'front',
  nails: 'front',
  wrongGrip: 'front',
  inscription: 'front',
  makersMark: 'front',
  freshCarving: 'front',
  amulet: 'front',
  lipScars: 'front',
  spearCut: 'front',
  // Loki's tells in his later guises (docs/tech-spec.md §80).
  scales: 'front',
  ears: 'front',
  fly: 'front',
  webbing: 'front',
};

/** The hotspot regions over the shared layout, in 300x420 frame units. */
export function standardHotspots(scene: BodyScene): Hotspot[] {
  const h = half(scene.look);
  const hp = hands(scene.look, scene.view);
  const region = (id: HotspotId, x: number, y: number, w: number, hh: number): Hotspot => ({
    id,
    x,
    y,
    w,
    h: hh,
    keys: REGION_KEYS[id],
  });
  if (scene.view === 'back') return [region('back', CX - h, 158, 2 * h, 146)];
  return [
    // From above the crown, so a mare's ears (docs/tech-spec.md §80) are under it too.
    region('hair', 100, 18, 100, 66),
    region('face', 100, 84, 100, 56),
    region('neck', 110, 140, 80, 62),
    region('chest', CX - h, 202, 2 * h, 102),
    region('handR', hp.R - 26, 226, 52, 110),
    region('handL', hp.L - 26, 226, 52, 110),
  ];
}

/** The body a portrait is cropped from: a front view with only the traits that tell faces apart. */
export function portraitScene(p: Portrait): BodyScene {
  const look: Look = { gender: p.gender, name: '', patronym: '', age: 35, build: p.build, beard: p.beard };
  return { view: 'front', look, obs: { hair: p.hair }, cues: [], tools: [] };
}

/** The head-and-shoulders crop of the shared layout, as an SVG viewBox. */
export const PORTRAIT_VIEWBOX = '86 34 128 150';
