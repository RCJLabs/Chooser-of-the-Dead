import { fnv1a32, type Look, type Value } from '@cots/engine';
import type { BodyArtProvider, BodyScene, Portrait } from './contract';
import {
  BACK_WOUNDS,
  BLADE_Y,
  CX,
  FRONT_WOUNDS,
  H,
  half,
  hands,
  PORTRAIT_VIEWBOX,
  portraitScene,
  SIGN_VIEWS,
  standardHotspots,
  W,
  type WeaponKind,
  weaponKind,
} from './layout';

/**
 * Candidate art direction A: a hand-coloured woodcut. Heavy ink outlines,
 * parallel hatching for shade, a few flat washes on paper, like a printed
 * chronicle. SVG, so it's sharp at any size. Signs stay shape-coded: wounds
 * are gashes with drips, fever is stipple, sea-foam is bubbles and each hair
 * colour has its own cut (solid, lines, curls, cross-hatch).
 */

const PAPER = '#f1e6cc';
const INK = '#1c1510';
const SKIN = '#efd8b6';
const TROUSERS = '#6a5a47';
const WRAPS = '#cdbd97';
const WOOD = '#8c5e33';
const IRON = '#a3aaae';
const BLOOD = '#b3261e';
const AMBER = '#d98a1c';
const SILVER = '#c9ced2';
const GOLD = '#c79a3a';
const FOAM_EDGE = '#4f7584';
const HORN = '#efe3c2';

/** Tunic washes, picked per soul for variety (cosmetic only). */
const TUNICS = ['#a2543a', '#566e84', '#8c7a5c', '#6f7a4c'] as const;

const HAIR: Readonly<Record<string, string>> = { dark: INK, fair: '#e2c46e', red: '#b24a2a', grey: '#c9c5bb' };

const OUTLINE = `stroke="${INK}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"`;
const THIN = `stroke="${INK}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"`;
const FINE = `stroke="${INK}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"`;

/** The look's clothing colour where the day chose one (spread looks), else one picked by the name. */
const tunicOf = (look: Look) =>
  TUNICS[(look.tunic ?? fnv1a32(`${look.name}|${look.patronym}|tunic`)) % TUNICS.length] ?? TUNICS[0];

/** Pattern defs shared by every woodcut drawing (identical everywhere, so repeated ids are harmless). */
const DEFS = [
  '<defs>',
  `<pattern id="wc-hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><path d="M0 0V5" stroke="${INK}" stroke-width="1.5"/></pattern>`,
  `<pattern id="wc-hatch-fine" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(-40)"><path d="M0 0V4" stroke="${INK}" stroke-width="0.9"/></pattern>`,
  `<pattern id="wc-cross" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0V6M0 0H6" stroke="${INK}" stroke-width="1.1"/></pattern>`,
  `<pattern id="wc-strands" width="7" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(8)"><path d="M2 0V12" stroke="${INK}" stroke-width="1.4"/></pattern>`,
  `<pattern id="wc-cut" width="7" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(8)"><path d="M3 0V12" stroke="${PAPER}" stroke-width="1.3"/></pattern>`,
  `<pattern id="wc-curls" width="9" height="9" patternUnits="userSpaceOnUse"><path d="M1 6Q4.5 0 8 6" fill="none" stroke="${INK}" stroke-width="1.3"/></pattern>`,
  `<pattern id="wc-grain" width="40" height="6" patternUnits="userSpaceOnUse"><path d="M0 3Q10 1 20 3T40 3" fill="none" stroke="${INK}" stroke-width="0.8" opacity="0.6"/></pattern>`,
  '</defs>',
].join('');

/** Hair texture by colour: dark is solid ink with cut lines, fair is strands, red is curls, grey is cross-hatch. */
function hairFill(hair: string, d: string): string {
  const fill = HAIR[hair] ?? INK;
  const texture =
    hair === 'dark' ? 'wc-cut' : hair === 'fair' ? 'wc-strands' : hair === 'red' ? 'wc-curls' : 'wc-cross';
  return [
    `<path d="${d}" fill="${fill}"/>`,
    `<path d="${d}" fill="url(#${texture})"/>`,
    `<path d="${d}" fill="none" ${OUTLINE}/>`,
  ].join('');
}

function hairShape(look: Look, front: boolean): string {
  if (!front) {
    const back = 'M104 100C98 44 202 44 196 100C198 128 186 144 150 146C114 144 102 128 104 100Z';
    return look.gender === 'f' ? `${back}M136 140C134 160 138 178 150 192C162 178 166 160 164 140Z` : back;
  }
  const cap = 'M104 98C100 40 200 40 196 98C188 78 170 68 150 70C130 68 112 78 104 98Z';
  return look.gender === 'f'
    ? `${cap}M105 92C94 124 96 160 108 186L120 182C112 156 112 124 116 96Z M195 92C206 124 204 160 192 186L180 182C188 156 188 124 184 96Z`
    : cap;
}

function beard(look: Look, hair: string): string {
  if (look.beard === 'none' || look.gender === 'f') return '';
  const d =
    look.beard === 'short'
      ? 'M116 118Q124 150 150 156Q176 150 184 118Q178 136 164 140Q150 146 136 140Q122 136 116 118Z'
      : 'M116 118Q120 150 136 164L150 184L164 164Q180 150 184 118Q178 138 164 142Q150 148 136 142Q122 138 116 118Z';
  const parts = [hairFill(hair, d)];
  if (look.beard === 'braided') {
    parts.push(
      `<rect x="142" y="160" width="16" height="6" rx="2" fill="${GOLD}" ${THIN}/>`,
      `<rect x="144" y="170" width="12" height="5" rx="2" fill="${GOLD}" ${THIN}/>`,
    );
  }
  return parts.join('');
}

function slash(x: number, y: number): string {
  // A gash: a red lens with an ink edge, and two drips below it.
  return [
    `<path d="M${x - 17} ${y - 7}Q${x} ${y - 9} ${x + 17} ${y + 7}Q${x} ${y + 5} ${x - 17} ${y - 7}Z" fill="${BLOOD}" ${THIN}/>`,
    `<path d="M${x - 4} ${y + 2}v8M${x + 6} ${y + 5}v6" stroke="${BLOOD}" stroke-width="3" stroke-linecap="round"/>`,
  ].join('');
}

function wounds(n: Value | undefined, at: readonly (readonly [number, number])[]): string {
  const count = typeof n === 'number' ? Math.max(0, Math.min(at.length, n)) : 0;
  return at
    .slice(0, count)
    .map(([x, y]) => slash(x, y))
    .join('');
}

/** The weapon in the fist, of the kind the soul's words name. The fist is drawn over its grip. */
function weapon(kind: WeaponKind, x: number, y: number, outward: 1 | -1): string {
  const b = (dx: number) => x + dx * outward;
  const shaft = (from: number, to: number) => [
    `<path d="M${x} ${from}V${to}" stroke="${INK}" stroke-width="10" stroke-linecap="round"/>`,
    `<path d="M${x} ${from}V${to}" stroke="${WOOD}" stroke-width="5" stroke-linecap="round"/>`,
  ];
  if (kind === 'sword') {
    return [
      `<path d="M${x - 5} ${y - 16}V${y - 88}L${x} ${y - 100}L${x + 5} ${y - 88}V${y - 16}Z" fill="${IRON}" ${OUTLINE}/>`,
      `<path d="M${x - 1} ${y - 86}V${y - 22}" stroke="${INK}" stroke-width="1.6"/>`,
      `<path d="M${x + 2} ${y - 84}V${y - 26}" stroke="${PAPER}" stroke-width="1.4"/>`,
      `<rect x="${x - 15}" y="${y - 21}" width="30" height="7" rx="2" fill="${GOLD}" ${THIN}/>`,
      ...shaft(y - 14, y + 14),
      `<circle cx="${x}" cy="${y + 20}" r="6" fill="${GOLD}" ${THIN}/>`,
    ].join('');
  }
  if (kind === 'spear') {
    return [
      ...shaft(y - 112, y + 46),
      `<path d="M${x} ${y - 150}Q${x + 11} ${y - 128} ${x} ${y - 106}Q${x - 11} ${y - 128} ${x} ${y - 150}Z" fill="${IRON}" ${OUTLINE}/>`,
      `<path d="M${x} ${y - 144}V${y - 110}" stroke="${INK}" stroke-width="1.6"/>`,
      `<path d="M${x - 4} ${y - 110}H${x + 4}M${x - 4} ${y - 104}H${x + 4}" ${THIN}/>`,
    ].join('');
  }
  if (kind === 'seax') {
    // A long single-edged knife: a straight back, the edge rising to an angled point.
    return [
      `<path d="M${b(-4)} ${y - 14}V${y - 66}L${b(3)} ${y - 78}L${b(9)} ${y - 58}V${y - 14}Z" fill="${IRON}" ${OUTLINE}/>`,
      `<path d="M${b(2)} ${y - 62}L${b(6)} ${y - 56}V${y - 20}" fill="none" stroke="${PAPER}" stroke-width="1.4"/>`,
      `<rect x="${x - 9}" y="${y - 18}" width="18" height="6" rx="2" fill="${GOLD}" ${THIN}/>`,
      ...shaft(y - 12, y + 16),
    ].join('');
  }
  const top = y - 80;
  const head = `M${x} ${top + 2}L${b(20)} ${top - 4}Q${b(40)} ${top + 18} ${b(28)} ${top + 44}Q${b(18)} ${top + 30} ${x} ${top + 26}Z`;
  return [
    ...shaft(top - 6, y + 30),
    `<path d="${head}" fill="${IRON}" ${OUTLINE}/>`,
    `<path d="M${b(8)} ${top + 18}L${b(26)} ${top + 34}L${b(14)} ${top + 24}Z" fill="url(#wc-hatch)"/>`,
    `<path d="M${b(24)} ${top}Q${b(36)} ${top + 18} ${b(27)} ${top + 38}" fill="none" stroke="${PAPER}" stroke-width="2"/>`,
  ].join('');
}

/** A grip wrapped for a bigger hand: a thick leather band bound with crossing thongs. */
function wrongGrip(x: number, y: number): string {
  return [
    `<rect x="${x - 10}" y="${y - 48}" width="20" height="28" rx="4" fill="#6b4424" ${THIN}/>`,
    `<path d="M${x - 10} ${y - 44}L${x + 10} ${y - 34}M${x - 10} ${y - 34}L${x + 10} ${y - 24}M${x + 10} ${y - 44}L${x - 10} ${y - 34}" stroke="${WRAPS}" stroke-width="2"/>`,
  ].join('');
}

/**
 * The rune-lens over the blade's inscription: the lens sits beside the blade on the side toward the
 * body (so it stays in the frame whichever hand holds it), upright however the weapon leans, with the
 * owner's name above and the maker's mark below.
 */
function runeReading(
  x: number,
  y: number,
  lean: number,
  inscription: Value | undefined,
  mark: Value | undefined,
  kind: WeaponKind,
): string {
  // Where the inscription has gone as the weapon leans about the fist at (x, y).
  const along = BLADE_Y[kind];
  const sin = lean < 0 ? -LEAN_SIN : lean > 0 ? LEAN_SIN : 0;
  const cos = lean === 0 ? 1 : LEAN_COS;
  const inward = x < CX ? 1 : -1;
  const lx = r2(x - along * sin + 18 * inward);
  const ly = r2(y + along * cos);
  const staves = (seed: string, x0: number, y0: number) =>
    [...seed]
      .map((ch, i) => {
        const cx = r2(x0 + i * 5.5);
        const k = ch.charCodeAt(0) % 3;
        const branch =
          k === 0
            ? `M${cx} ${r2(y0 + 2)}L${r2(cx + 3)} ${r2(y0 - 1)}`
            : k === 1
              ? `M${cx} ${r2(y0 + 5)}L${r2(cx - 3)} ${r2(y0 + 2)}`
              : `M${r2(cx - 2)} ${r2(y0 + 3)}L${r2(cx + 2)} ${r2(y0 + 3)}`;
        return `<path d="M${cx} ${r2(y0 - 3)}V${r2(y0 + 8)}${branch}" stroke="${INK}" stroke-width="1.5" fill="none"/>`;
      })
      .join('');
  const owner = inscription === 'other' ? 'xqzv' : inscription === 'own' ? 'amik' : '';
  const maker = mark === 'markTrue' ? '+vlfberh+t' : mark === 'markCopy' ? '+vlfberht+' : '';
  // The handle points down and away from the blade.
  const handle = `M${r2(lx + 18 * inward)} ${r2(ly + 20)}L${r2(lx + 32 * inward)} ${r2(ly + 34)}`;
  return [
    `<path d="${handle}" stroke="${INK}" stroke-width="9" stroke-linecap="round"/>`,
    `<path d="${handle}" stroke="${WOOD}" stroke-width="5" stroke-linecap="round"/>`,
    `<circle cx="${lx}" cy="${ly}" r="24" fill="${PAPER}" fill-opacity="0.9" ${OUTLINE}/>`,
    owner ? staves(owner, lx - 12, ly - 10) : '',
    maker ? staves(maker.slice(-6), lx - 16, ly + 5) : '',
  ].join('');
}

type Pt = { x: number; y: number };

const r2 = (n: number) => Math.round(n * 100) / 100;

/** An SVG transform into a local frame: u runs across (toward the body), v runs down the arm or hand. */
const frame = (o: Pt, u: Pt, v: Pt) =>
  `transform="matrix(${r2(u.x)} ${r2(u.y)} ${r2(v.x)} ${r2(v.y)} ${r2(o.x)} ${r2(o.y)})"`;

/** An arm from the shoulder toward the hand at (x, y), ending at a cuff above the wrist. */
function armOf(sx: number, x: number, y: number) {
  const inw = x < CX ? 1 : -1;
  const dx = x - sx;
  const dy = y - 12 - 170;
  const len = Math.hypot(dx, dy);
  const d = { x: dx / len, y: dy / len };
  const cuff = { x: x - 8 * d.x, y: y - 12 - 8 * d.y };
  // The hand hangs a little straighter than the arm.
  const hl = Math.hypot(d.x * 0.85, d.y);
  const hd = { x: (d.x * 0.85) / hl, y: d.y / hl };
  return {
    inw,
    d,
    cuff,
    arm: frame(cuff, { x: inw * d.y, y: -inw * d.x }, d),
    hand: frame(cuff, { x: inw * hd.y, y: -inw * hd.x }, hd),
  };
}

/** Skin shapes merged under one contour: every part inked wider first, then every part filled. */
function flesh(fill: string[], strokes: [string, number][], contour: number, between = ''): string {
  return [
    ...fill.map(
      (d) => `<path d="${d}" fill="${INK}" stroke="${INK}" stroke-width="${contour * 2}" stroke-linejoin="round"/>`,
    ),
    ...strokes.map(
      ([d, w]) =>
        `<path d="${d}" fill="none" stroke="${INK}" stroke-width="${w + contour * 2}" stroke-linecap="round"/>`,
    ),
    // Anything that lies over the contour but under the skin (a seal's webbing).
    between,
    ...fill.map((d) => `<path d="${d}" fill="${SKIN}"/>`),
    ...strokes.map(
      ([d, w]) => `<path d="${d}" fill="none" stroke="${SKIN}" stroke-width="${w}" stroke-linecap="round"/>`,
    ),
  ].join('');
}

const seg = ([u, v, tu, tv, w]: [number, number, number, number, number]): [string, number] => [
  `M${u} ${v}L${tu} ${tv}`,
  w,
];

/** A long nail: a horn claw growing on from a fingertip, bending toward the palm. */
function nail(bx: number, by: number, tx: number, ty: number, w: number, len: number): string {
  const l = Math.hypot(tx - bx, ty - by);
  const f = { x: (tx - bx) / l, y: (ty - by) / l };
  const p = { x: f.y, y: -f.x };
  const at = (a: number, b: number) => `${r2(tx + f.x * a + p.x * b)} ${r2(ty + f.y * a + p.y * b)}`;
  const hw = w * 0.42;
  return `<path d="M${at(-1, hw)}Q${at(len * 0.6, hw)} ${at(len, -1.5)}Q${at(len * 0.45, -hw)} ${at(-1, -hw)}Z" fill="${HORN}" ${THIN}/>`;
}

/** The fingers of an open hand, little finger first: base u, v, tip u, v, width. Then the thumb. */
const FINGERS: [number, number, number, number, number][] = [
  [-7.2, 16.5, -10, 28, 4.3],
  [-2.5, 17.5, -4.2, 32.5, 4.7],
  [2.2, 17.5, 2.5, 34.5, 4.9],
  [6.8, 16.5, 8.6, 31.5, 4.7],
];
const THUMB: [number, number, number, number, number] = [8.2, 3, 13.4, 18, 5.6];

/** A seal's hand (docs/tech-spec.md §80): the fingers spread wide, little finger first, with webbing between. */
const SPREAD: [number, number, number, number, number][] = [
  [-7.2, 16.5, -21, 21, 4],
  [-2.5, 17.5, -10, 31, 4.4],
  [2.2, 17.5, 3, 35, 4.6],
  [6.8, 16.5, 15, 28, 4.4],
];
const WEB = '#6f8f96';
const WEB_RIB = '#3f5a60';

/**
 * A relaxed hand hanging from the cuff: palm, four fingers a little apart,
 * the thumb on the side toward the body. Drawn in the hand's own frame (u
 * across toward the body, v down the hand). Webbed, Loki's in the seal's guise, the fingers spread over a sea-grey
 * membrane that reaches past their middle joints.
 */
function openHand(t: string, long: boolean, webbed = false): string {
  const palm = 'M-7.5 -8L-8 2Q-11 8 -10.5 14L-9 17.5H9L10 9Q9.5 3 7.5 -8Z';
  const fingers = webbed ? SPREAD : FINGERS;
  const parts: string[] = [];
  let web = '';
  if (webbed) {
    // Between each two fingers, out past the middle joint, its free edge scalloped toward the palm; a rib down each.
    // It lies over the fingers' contour, so the gaps between them read as membrane, not outline.
    const at = ([u, v, tu, tv]: [number, number, number, number, number], k: number): [number, number] => [
      u + (tu - u) * k,
      v + (tv - v) * k,
    ];
    const toward = (a: [number, number], b: [number, number], k: number): [number, number] => [
      a[0] + (b[0] - a[0]) * k,
      a[1] + (b[1] - a[1]) * k,
    ];
    const pt = ([u, v]: [number, number]) => `${r2(u)} ${r2(v)}`;
    const webs: string[] = [];
    const ribs: string[] = [];
    for (const [i, f] of fingers.slice(1).entries()) {
      const g = fingers[i] ?? f;
      const [a0, a1, b1, b0] = [at(g, 0), at(g, 0.88), at(f, 0.88), at(f, 0)];
      const base = toward(a0, b0, 0.5);
      const dip = toward(toward(a1, b1, 0.5), base, 0.25);
      webs.push(`M${pt(a0)}L${pt(a1)}Q${pt(dip)} ${pt(b1)}L${pt(b0)}Z`);
      ribs.push(`M${pt(base)}L${pt(toward(base, toward(toward(a1, b1, 0.5), dip, 0.5), 0.75))}`);
    }
    web = [
      `<path d="${webs.join('')}" fill="${WEB}" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/>`,
      `<path d="${ribs.join('')}" fill="none" stroke="${WEB_RIB}" stroke-width="1.1" stroke-linecap="round"/>`,
    ].join('');
  }
  parts.push(flesh([palm], [...fingers, THUMB].map(seg), 2.8, web));
  // Where the fingers meet, and the thumb's crease.
  const seams = webbed
    ? []
    : fingers.slice(1).map(([u, v, tu, tv], i) => {
        const [pu, pv, ptu, ptv] = fingers.at(i) ?? [u, v, tu, tv];
        return `M${r2((u + pu) / 2)} ${Math.max(v, pv) + 0.5}L${r2((tu + ptu) / 2)} ${r2(Math.min(tv, ptv) - 6)}`;
      });
  parts.push(`<path d="${seams.join('')}M8.3 6Q6.8 11 8.8 15.5" fill="none" ${FINE}/>`);
  if (long) parts.push(...[...fingers, THUMB].map(([u, v, tu, tv, w], i) => nail(u, v, tu, tv, w, i < 4 ? 9 : 7)));
  return `<g ${t}>${parts.join('')}</g>`;
}

/** A fist's fingers, index first: each band's height, where its knuckle bends (u), and its width. */
const BANDS: [number, number, number][] = [
  [-4.4, -10.6, 5.6],
  [1.2, -10.9, 5.6],
  [6.8, -10.3, 5.5],
  [12.1, -9.2, 5],
];
/** Where the fingertips end, against the heel of the hand. */
const TIPS_U = 5.5;
/** The thumb: from the heel of the hand, up over the index finger just under the guard. */
const FIST_THUMB = 'M10 -2.5Q5 -10.5 -4.5 -8';

/**
 * A fist closed round a weapon's grip, the grip upright through it. From the
 * front: the four fingers wrap across the grip, bending at the knuckles on
 * the outer side, their tips pressed against the heel of the hand on the
 * side toward the body; the thumb comes up from the heel, near the wrist,
 * and lies across the index finger. In the fist's frame: u across toward the
 * body, v down, (0, 0) on the grip.
 */
function fist(t: string, long: boolean): string {
  const bands = BANDS.map(([v, ku, w]): [string, number] => [`M${TIPS_U} ${v}L${ku} ${v}`, w]);
  const mids = BANDS.slice(1).map(([v], i) => (v + (BANDS[i]?.[0] ?? v)) / 2);
  const parts = [
    flesh([FIST], [...bands, [FIST_THUMB, 6.2]], 2.8),
    // Where the fingers lie against each other, and their tips.
    `<path d="${mids.map((m) => `M-12.4 ${m}Q-3 ${m + 1.2} ${TIPS_U} ${m}`).join('')}${BANDS.slice(1)
      .map(([v, , w]) => `M${TIPS_U} ${v - w / 2}A${w / 2} ${w / 2} 0 0 1 ${TIPS_U} ${v + w / 2}`)
      .join('')}" fill="none" ${FINE}/>`,
  ];
  if (long) parts.push(...BANDS.map(([v, , w]) => nail(TIPS_U, v, TIPS_U + 2.6, v + 1.3, w, 9)));
  parts.push(
    // The thumb over the index finger (and any long nail under it): its lower edge and tip.
    `<path d="${FIST_THUMB}" fill="none" stroke="${SKIN}" stroke-width="6.2" stroke-linecap="round"/>`,
    `<path d="M7.4 -0.9Q3.7 -7 -3.7 -5A3.1 3.1 0 0 1 -7.4 -9.2" fill="none" ${FINE}/>`,
  );
  return `<g ${t}>${parts.join('')}</g>`;
}

/**
 * How far a held weapon leans out from the fist, away from the body, in degrees: the same seen from the
 * front and from behind, where it has to show past the arm. Its sine and cosine, for what follows the
 * blade (the rune-lens).
 */
const LEAN = 14;
const LEAN_SIN = 0.2419;
const LEAN_COS = 0.9703;

/** The fist's palm and heel, which the fingers and thumb close over. */
const FIST = 'M-10 -4Q-10 -8 -6 -8H6Q11 -8 11 -2V10Q11 15 6 15H-5Q-10 15 -10 11Z';

/**
 * The same fist from behind: the fingers and thumb curl round the far side of
 * the grip, out of sight, so what shows is the back of the hand. It runs from
 * the wrist, on the side toward the body, to the row of knuckles down the
 * outer side, where the fingers turn away round the grip; tendons fan out to
 * the knuckles. Only the curve of the index finger shows over the top.
 */
function fistBehind(t: string): string {
  const back = 'M-9 -6Q-8 -9 -4 -9H5Q11 -9 11.5 -3V10Q11.5 15.5 5.5 15.5H-5Q-9 15.5 -9 11Z';
  // The knuckles: a rounded bump for each finger along the outer side, the index's at the top.
  const knuckles = BANDS.map(([v, , w]): [string, number] => [`M-9.6 ${v}L-9.4 ${v}`, w + 0.8]);
  // Three tendons, from the wrist's side toward the knuckles of the first three fingers.
  const tendons = BANDS.slice(0, 3)
    .map(([v]) => `M5.5 ${r2(v * 0.3 - 1.5)}Q0 ${r2(v * 0.65 - 0.5)} -5.5 ${r2(v * 0.95)}`)
    .join('');
  return `<g ${t}>${[
    flesh([back], knuckles, 2.8),
    // The dips between the knuckles, the tendons, and the fold of the index finger along the top.
    `<path d="${BANDS.slice(1)
      .map(([v], i) => {
        const m = (v + (BANDS[i]?.[0] ?? v)) / 2;
        return `M-12.6 ${r2(m)}L-10.2 ${r2(m)}`;
      })
      .join('')}${tendons}M-6 -6.6Q1 -8.2 8 -6.2" fill="none" ${FINE}/>`,
  ].join('')}</g>`;
}

/** Tablet-woven trim: a band of little diamonds. */
function trim(x0: number, x1: number, y: number): string {
  const n = Math.max(1, Math.floor((x1 - x0) / 10));
  const step = (x1 - x0) / n;
  const marks = Array.from({ length: n }, (_, i) => {
    const cx = x0 + step * (i + 0.5);
    return `M${cx} ${y - 3}L${cx + 3} ${y}L${cx} ${y + 3}L${cx - 3} ${y}Z`;
  }).join('');
  return `<path d="M${x0} ${y - 5}H${x1}M${x0} ${y + 5}H${x1}" ${THIN}/><path d="${marks}" fill="${INK}"/>`;
}

function figure(scene: BodyScene, uid: string): string {
  const { look, view } = scene;
  const h = half(look);
  const hp = hands(look, view);
  const tunic = tunicOf(look);
  const front = view === 'front';
  const parts: string[] = [];

  // Legs: trousers, leg wraps bound with crossing bands, shoes.
  for (const lx of [CX - h + 10, CX + 4]) {
    const w = h - 14;
    parts.push(
      `<rect x="${lx}" y="300" width="${w}" height="60" fill="${TROUSERS}" ${OUTLINE}/>`,
      `<rect x="${lx}" y="300" width="${w / 2}" height="60" fill="url(#wc-hatch-fine)"/>`,
      `<rect x="${lx + 1}" y="356" width="${w - 2}" height="42" fill="${WRAPS}" ${OUTLINE}/>`,
      `<path d="M${lx + 1} 364L${lx + w - 1} 374M${lx + 1} 376L${lx + w - 1} 386M${lx + 1} 388L${lx + w - 1} 396" ${THIN}/>`,
      `<path d="M${lx - 6} 410Q${lx - 4} 396 ${lx + 4} 396H${lx + w - 2}Q${lx + w + 6} 400 ${lx + w + 4} 410Z" fill="${INK}"/>`,
    );
  }

  // Hands hang below the cuffs: an open hand, or the wrist of a fist that closes over the weapon later.
  const grip = scene.obs.grip;
  const weaponHand = grip === 'weapon' ? (scene.obs.gripHand === 'left' ? 'L' : 'R') : null;
  const kind = weaponKind(scene.weapon);
  const wx = weaponHand === 'L' ? hp.L : hp.R;
  // The weapon leans out from the fist, away from the body, seen from either side.
  const lean = wx < CX ? -LEAN : LEAN;
  const held = (svg: string) => `<g transform="rotate(${lean} ${wx} ${hp.y})">${svg}</g>`;
  // From behind, the arm is between the viewer and the weapon: the weapon goes down first, under the
  // wrist and the sleeve. (From the front it goes over them, after the torso.)
  if (weaponHand && !front) parts.push(held(weapon(kind, wx, hp.y, wx < CX ? -1 : 1)));
  const long = front && scene.obs.nails === true && !scene.tools.includes('clippers');
  const arms = (['R', 'L'] as const).map((side) => {
    const x = side === 'L' ? hp.L : hp.R;
    const sx = x < CX ? CX - h + 4 : CX + h - 4;
    return { side, x, sx, fist: weaponHand === side, ...armOf(sx, x, hp.y) };
  });
  const webbed = front && scene.obs.webbing === 'webbed';
  for (const a of arms) {
    if (!a.fist) {
      parts.push(openHand(a.hand, long, webbed));
      continue;
    }
    const from = `M${r2(a.cuff.x - 6 * a.d.x)} ${r2(a.cuff.y - 6 * a.d.y)}L${a.x} ${hp.y}`;
    parts.push(
      `<path d="${from}" stroke="${INK}" stroke-width="20" stroke-linecap="round"/>`,
      `<path d="${from}" stroke="${SKIN}" stroke-width="14" stroke-linecap="round"/>`,
    );
  }

  // Sleeves: an ink edge under a coloured sleeve, ending in a cuff, then the torso.
  for (const a of arms) {
    const end = `L${r2(a.cuff.x)} ${r2(a.cuff.y)}`;
    const shade = `M${a.sx + (a.x - a.sx) * 0.55} ${170 + (hp.y - 182) * 0.55}L${r2(a.cuff.x - 18 * a.d.x)} ${r2(a.cuff.y - 18 * a.d.y)}`;
    parts.push(
      `<path d="M${a.sx} 170${end}" stroke="${INK}" stroke-width="30"/>`,
      `<circle cx="${a.sx}" cy="170" r="15" fill="${INK}"/>`,
      `<path d="M${a.sx} 170${end}" stroke="${tunic}" stroke-width="22"/>`,
      `<circle cx="${a.sx}" cy="170" r="11" fill="${tunic}"/>`,
      `<path d="${shade}" stroke="url(#wc-hatch)" stroke-width="16" stroke-linecap="round" opacity="0.7"/>`,
      `<rect x="-16.5" y="-10" width="33" height="10" rx="2" fill="${tunic}" ${OUTLINE} ${a.arm}/>`,
    );
  }
  const torso = `M${CX - h} 172Q${CX - h} 156 ${CX - h + 16} 156H${CX + h - 16}Q${CX + h} 156 ${CX + h} 172L${CX + h + 4} 312H${CX - h - 4}Z`;
  parts.push(
    `<clipPath id="wc-torso-${uid}"><path d="${torso}"/></clipPath>`,
    `<path d="${torso}" fill="${tunic}"/>`,
    `<rect x="${front ? CX + h * 0.35 : CX - h - 4}" y="150" width="${h * 0.7 + 4}" height="170" fill="url(#wc-hatch)" clip-path="url(#wc-torso-${uid})"/>`,
    `<path d="${torso}" fill="none" ${OUTLINE}/>`,
    trim(CX - h + 2, CX + h + 2, 304),
    `<rect x="${CX - h - 2}" y="274" width="${2 * h + 4}" height="12" fill="#3b2a1c" ${THIN}/>`,
  );
  if (front) {
    parts.push(
      `<path d="M136 158L150 180L164 158" fill="none" ${THIN}/>`,
      trim(CX - 26, CX + 26, 164),
      `<rect x="${CX - 8}" y="273" width="16" height="14" fill="${GOLD}" ${THIN}/>`,
      `<path d="M${CX} 276V284" ${THIN}/>`,
    );
  } else {
    parts.push(`<path d="M${CX} 160V272" stroke="${INK}" stroke-width="2" stroke-dasharray="7 5"/>`);
  }

  // Neck and head.
  parts.push(
    `<rect x="136" y="128" width="28" height="34" fill="${SKIN}" ${OUTLINE}/>`,
    `<path d="M150 132H164V160H150Z" fill="url(#wc-hatch-fine)"/>`,
    `<ellipse cx="${CX}" cy="96" rx="43" ry="46" fill="${SKIN}" ${OUTLINE}/>`,
  );
  // The cheek's shade, unless the salmon's scales are cut there instead.
  if (front && scene.obs.scales !== 'silver') {
    parts.push(`<path d="M172 118Q178 108 180 96" fill="none" stroke="url(#wc-hatch)" stroke-width="10"/>`);
  }

  // The weapon under the fist, from the front, with any wrap on its grip; the wrap and the rune readings
  // are front-view signs.
  if (weaponHand && front) {
    const wrap = scene.cues.includes('wrongGrip') ? wrongGrip(wx, hp.y) : '';
    parts.push(held(weapon(kind, wx, hp.y, wx < CX ? -1 : 1) + wrap));
    if (scene.tools.includes('runeLens')) {
      parts.push(runeReading(wx, hp.y, lean, scene.obs.inscription, scene.obs.makersMark, kind));
    }
  }
  for (const a of arms) {
    const t = `transform="matrix(${a.inw} 0 0 1 ${a.x} ${hp.y})"`;
    if (a.fist) parts.push(front ? fist(t, long) : fistBehind(t));
    parts.push(
      `<text x="${a.x}" y="${hp.y + 46}" font-size="14" font-family="Georgia, serif" font-weight="bold" text-anchor="middle" fill="${INK}" stroke="${PAPER}" stroke-width="4" paint-order="stroke">${a.side}</text>`,
    );
  }
  return parts.join('');
}

function face(scene: BodyScene): string {
  const { look, obs } = scene;
  const parts: string[] = [
    // Heavy lids, brows and a carved nose: the dead, resting.
    `<path d="M122 94Q131 101 140 94M160 94Q169 101 178 94" fill="none" stroke="${INK}" stroke-width="3.2" stroke-linecap="round"/>`,
    `<path d="M124 97l-2 4M131 99v4M138 97l2 4M162 97l-2 4M169 99v4M176 97l2 4" ${THIN}/>`,
    `<path d="M120 82Q130 76 140 81M160 81Q170 76 180 82" fill="none" stroke="${INK}" stroke-width="3.5" stroke-linecap="round"/>`,
    `<path d="M151 92L146 112Q150 116 156 112" fill="none" ${THIN}/>`,
  ];
  if (look.age >= 60) {
    parts.push(`<path d="M132 66Q150 61 168 66M136 73Q150 69 164 73M118 102l-5 3M182 102l5 3" fill="none" ${THIN}/>`);
  }
  if (obs.skin === 'feverFlush') {
    const stipple = (x: number) =>
      [
        [0, 0],
        [6, -2],
        [-6, 2],
        [3, 5],
        [-3, -5],
        [8, 4],
        [-8, -3],
        [2, -7],
      ]
        .map(([dx = 0, dy = 0]) => `<circle cx="${x + dx}" cy="${112 + dy}" r="1.9" fill="${INK}"/>`)
        .join('');
    parts.push(
      `<ellipse cx="124" cy="112" rx="14" ry="10" fill="${BLOOD}" opacity="0.4"/>`,
      `<ellipse cx="176" cy="112" rx="14" ry="10" fill="${BLOOD}" opacity="0.4"/>`,
      stipple(124),
      stipple(176),
    );
  }
  parts.push(beard(look, String(obs.hair ?? 'dark')));
  // Lips: a dry line, or sea-foam bubbles and a trickle of brine.
  parts.push(
    `<path d="M138 124Q150 129 162 124" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>`,
  );
  if (obs.lipScars === 'stitched') {
    // Brokkr's stitches: small scars across the lips (the subtlest sign in the game).
    parts.push(
      `<path d="M141 119V131M145.5 120V132M150 120V132M154.5 120V132M159 119V131" stroke="${INK}" stroke-width="1.8" stroke-linecap="round"/>`,
    );
  }
  parts.push(lokiTell(obs));
  if (obs.lips === 'seaFoam') {
    parts.push(
      `<path d="M162 127Q165 136 162 146" fill="none" stroke="${FOAM_EDGE}" stroke-width="3" stroke-linecap="round"/>`,
    );
    for (const [x, y, r] of [
      [139, 126, 4],
      [147, 131, 4.5],
      [156, 130, 3.5],
      [162, 125, 4],
      [151, 123, 3],
    ] as const) {
      parts.push(`<circle cx="${x}" cy="${y}" r="${r}" fill="#ffffff" stroke="${FOAM_EDGE}" stroke-width="1.8"/>`);
    }
  }
  if (scene.cues.includes('breathFog')) {
    // A carved cloud: scalloped, with a curl.
    parts.push(
      `<path d="M176 128Q174 118 184 116Q188 106 198 112Q208 110 208 120Q214 128 204 132Q196 138 186 134Q176 136 176 128Z" fill="#e3eaec" ${THIN}/>`,
      `<path d="M186 126Q190 120 196 124" fill="none" ${THIN}/>`,
    );
  }
  if (scene.tools.includes('feather')) {
    const stirs = obs.breath === 'stirs';
    parts.push(
      `<g transform="rotate(${stirs ? -16 : 0} 138 126)">`,
      `<path d="M94 158L137 126" stroke="${INK}" stroke-width="2.5"/>`,
      `<path d="M98 152C102 134 124 120 137 126C129 140 112 154 98 152Z" fill="${PAPER}" ${THIN}/>`,
      `<path d="M104 146L112 138M110 144L119 134M116 140L125 130" ${THIN}/>`,
      '</g>',
    );
    if (stirs) {
      // Air lines beside the head, clear of the face.
      parts.push(
        `<path d="M100 102Q92 112 100 122M88 96Q76 112 88 128" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>`,
      );
    }
  }
  return parts.join('');
}

/**
 * Loki's tell in his later guises (docs/tech-spec.md §80), whichever the soul shows: a salmon's silver scales on the
 * cheek, above any beard; a mare's ears, tall and pointed, over the hair; a fly at the corner of the eye. (The seal's
 * webbing is drawn with the open hand.)
 */
function lokiTell(obs: BodyScene['obs']): string {
  const parts: string[] = [];
  if (obs.scales === 'silver') {
    // Overlapping scales, the lower row over the upper, like a fish's.
    for (const [x, y] of [
      [166, 107],
      [173, 106],
      [180, 107],
      [169.5, 112],
      [176.5, 112],
      [173, 117],
    ] as const) {
      parts.push(
        `<path d="M${x - 3.6} ${y}A3.6 3.6 0 0 0 ${x + 3.6} ${y}Z" fill="${SILVER}" stroke="${INK}" stroke-width="1.3"/>`,
      );
    }
  }
  if (obs.ears === 'horse') {
    for (const m of [1, -1]) {
      const x = (n: number) => r2(CX + m * (n - CX));
      parts.push(
        `<path d="M${x(112)} 72Q${x(92)} 52 ${x(97)} 28Q${x(113)} 40 ${x(126)} 60Z" fill="${SKIN}" ${OUTLINE}/>`,
        `<path d="M${x(110)} 62Q${x(101)} 48 ${x(101)} 37" fill="none" stroke="#b07a62" stroke-width="3" stroke-linecap="round"/>`,
      );
    }
  }
  if (obs.fly === 'fly') {
    // At the outer corner of the eye: two glassy wings, a black body, its legs.
    parts.push(
      `<ellipse cx="113.5" cy="95.5" rx="3.6" ry="2.1" transform="rotate(-35 113.5 95.5)" fill="#eef2f3" stroke="${INK}" stroke-width="1"/>`,
      `<ellipse cx="121.5" cy="95.5" rx="3.6" ry="2.1" transform="rotate(35 121.5 95.5)" fill="#eef2f3" stroke="${INK}" stroke-width="1"/>`,
      `<path d="M115.5 101l-3 2.2M119.5 101l3 2.2M115.8 103l-2.4 3M119.2 103l2.4 3" stroke="${INK}" stroke-width="0.9" stroke-linecap="round"/>`,
      `<ellipse cx="117.5" cy="100.5" rx="2.4" ry="3.7" fill="${INK}"/>`,
      `<circle cx="117.5" cy="96.3" r="1.9" fill="${INK}"/>`,
    );
  }
  return parts.join('');
}

function ornament(value: Value | undefined): string {
  if (value !== 'amber' && value !== 'silver') return '';
  const cord = `<path d="M136 156L150 178L164 156" fill="none" stroke="${INK}" stroke-width="2"/>`;
  return value === 'amber'
    ? `${cord}<path d="M150 174C162 186 160 200 150 202C140 200 138 186 150 174Z" fill="${AMBER}" ${THIN}/><path d="M146 184Q147 190 150 194" fill="none" stroke="${PAPER}" stroke-width="2"/>`
    : `${cord}<circle cx="150" cy="188" r="10" fill="none" stroke="${INK}" stroke-width="8"/><circle cx="150" cy="188" r="10" fill="none" stroke="${SILVER}" stroke-width="4"/>`;
}

/** An amulet on its own cord, left of any ornament: Thor's hammer, a cross, or both on one cord. */
function amulet(value: Value | undefined): string {
  if (value !== 'hammer' && value !== 'cross' && value !== 'hammerAndCross') return '';
  const hammer = (x: number) =>
    `<path d="M${x - 2} 175H${x + 2}V185H${x + 8}L${x + 7} 193H${x - 7}L${x - 8} 185H${x - 2}Z" fill="${IRON}" ${THIN}/>`;
  const cross = (x: number) =>
    `<path d="M${x - 2} 175H${x + 2}V181H${x + 7}V185H${x + 2}V197H${x - 2}V185H${x - 7}V181H${x - 2}Z" fill="${GOLD}" ${THIN}/>`;
  const cord = `<path d="M138 152L128 175" fill="none" stroke="${INK}" stroke-width="2"/>`;
  if (value === 'hammer') return `${cord}${hammer(128)}`;
  if (value === 'cross') return `${cord}${cross(128)}`;
  return `${cord}<path d="M120 175H136" stroke="${INK}" stroke-width="2"/>${hammer(120)}${cross(136)}`;
}

/** An oath-ring on a thong, snapped open, beside any pendant. */
function brokenRing(on: boolean): string {
  if (!on) return '';
  return [
    `<path d="M160 150L178 178" fill="none" stroke="${INK}" stroke-width="2"/>`,
    `<path d="M187 182A10 10 0 1 1 176 173" fill="none" stroke="${INK}" stroke-width="8" stroke-linecap="round"/>`,
    `<path d="M187 182A10 10 0 1 1 176 173" fill="none" stroke="${GOLD}" stroke-width="4" stroke-linecap="round"/>`,
    `<path d="M180 170L184 164M188 177L194 176" stroke="${INK}" stroke-width="2" stroke-linecap="round"/>`,
  ].join('');
}

/** A tally stick in the belt, its notches fresh and pale. */
function freshTally(on: boolean, look: Look): string {
  if (!on) return '';
  const x = CX + half(look) - 22;
  const t = `rotate(12 ${x + 5} 284)`;
  return [
    `<rect x="${x}" y="260" width="11" height="46" rx="2" fill="${WOOD}" ${THIN} transform="${t}"/>`,
    ...[266, 274, 282, 290].map(
      (y) => `<path d="M${x + 1} ${y}L${x + 10} ${y + 2}" stroke="${PAPER}" stroke-width="3" transform="${t}"/>`,
    ),
  ].join('');
}

/**
 * Day 17's spear mark: a spear point cut over the heart before death (the soul's left, our right). A
 * small blade shape with its socket, dark red with an ink edge and no drips: a mark, not a wound.
 */
function spearCut(on: boolean): string {
  if (!on) return '';
  return [
    '<path d="M176 202L181.5 214L176 224L170.5 214Z" fill="#8f1d15" stroke="#1c1510" stroke-width="2" stroke-linejoin="round"/>',
    '<path d="M176 206V220" stroke="#f1e6cc" stroke-width="1.2" stroke-linecap="round"/>',
    '<path d="M176 224V231M172.5 227H179.5" stroke="#1c1510" stroke-width="2.2" stroke-linecap="round"/>',
  ].join('');
}

/** A carved ground under the feet: a hatched band with a few tufts. */
const GROUND = [
  `<path d="M11 404H${W - 11}V${H - 11}H11Z" fill="url(#wc-hatch)"/>`,
  `<path d="M11 404H${W - 11}" ${THIN}/>`,
  `<path d="M40 404l4 -9l3 9M58 404l3 -7l3 7M236 404l4 -9l3 9M254 404l3 -7l3 7" fill="none" ${THIN}/>`,
].join('');

/**
 * The id of the torso's clip path. The torso's shape depends only on the view
 * and the build, so the id does too: drawings on one page with the same torso
 * share an id and a shape (like the patterns in DEFS), and a drawing changes
 * only when what it shows changes.
 */
function torsoId(scene: BodyScene): string {
  return `${scene.view}-${half(scene.look)}`;
}

function draw(scene: BodyScene): string {
  const uid = torsoId(scene);
  const hair = String(scene.obs.hair ?? 'dark');
  const front = scene.view === 'front';
  const body = front
    ? [
        figure(scene, uid),
        hairFill(hair, hairShape(scene.look, true)),
        face(scene),
        ornament(scene.obs.ornament),
        amulet(scene.obs.amulet),
        brokenRing(scene.cues.includes('brokenRing')),
        freshTally(scene.cues.includes('freshCarving'), scene.look),
        spearCut(scene.obs.spearCut === true),
        wounds(scene.obs.woundsFront, FRONT_WOUNDS),
      ]
    : [figure(scene, uid), hairFill(hair, hairShape(scene.look, false)), wounds(scene.obs.woundsBack, BACK_WOUNDS)];
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-hidden="true">`,
    DEFS,
    `<rect x="4" y="4" width="${W - 8}" height="${H - 8}" fill="${PAPER}" stroke="${INK}" stroke-width="4"/>`,
    `<rect x="11" y="11" width="${W - 22}" height="${H - 22}" fill="none" stroke="${INK}" stroke-width="1.2"/>`,
    GROUND,
    ...body,
    '</svg>',
  ].join('');
}

function portrait(p: Portrait): string {
  return draw(portraitScene(p)).replace(/viewBox="[^"]*"/, `viewBox="${PORTRAIT_VIEWBOX}"`);
}

export const woodcutBody: BodyArtProvider = {
  id: 'woodcut',
  frame: { w: W, h: H },
  hotspots: standardHotspots,
  draw,
  portrait,
  conformance: {
    grip: 3,
    gripHand: 2,
    woundsFront: 3,
    skin: 3,
    lips: 2,
    hair: 3,
    ornament: 2,
    woundsBack: 3,
    breath: 3,
    breathFog: 2,
    brokenRing: 2,
    nails: 2,
    wrongGrip: 2,
    inscription: 2,
    makersMark: 2,
    freshCarving: 2,
    amulet: 2,
    lipScars: 1,
    spearCut: 2,
    scales: 1,
    ears: 2,
    fly: 1,
    webbing: 2,
  },
  views: SIGN_VIEWS,
};
