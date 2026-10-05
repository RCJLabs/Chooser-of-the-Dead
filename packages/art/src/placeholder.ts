import type { Look, Value } from '@cots/engine';
import type { BodyArtProvider, BodyScene, BodyView, Portrait } from './contract';
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
 * The placeholder body-art provider: procedural SVG drawn from a soul's look
 * and its body signs. Every sign is shape-coded, never colour alone: fever is
 * stipple, sea-foam is bubbles, wounds are slashes, pendants have different
 * silhouettes and each hair colour has its own texture.
 */

const INK = '#2a211a';
const SKIN = '#d9cdbb';
const TUNIC = '#5d4b3a';
const TROUSERS = '#3e342b';
const WOUND = '#7a1f1a';

const HAIR: Readonly<Record<string, { fill: string; texture: string }>> = {
  dark: { fill: '#2e241c', texture: '' },
  fair: {
    fill: '#d8c07a',
    texture: '<path d="M2 0V10M6 0V10" stroke="#8a7440" stroke-width="1"/>',
  },
  red: {
    fill: '#a4432a',
    texture: '<path d="M1 7Q4 1 7 7" fill="none" stroke="#5a1d10" stroke-width="1.2"/>',
  },
  grey: {
    fill: '#a8a8a8',
    texture: '<path d="M1 2H5M4 7H9" stroke="#5f5f5f" stroke-width="1.2"/>',
  },
};

function hairPath(look: Look, view: BodyView): string {
  if (view === 'back') return 'M104 98C104 44 196 44 196 98C196 124 184 140 150 142C116 140 104 124 104 98Z';
  const cap = 'M106 96C104 48 196 48 194 96C184 76 116 76 106 96Z';
  return look.gender === 'f'
    ? `${cap}M106 92C98 120 100 150 110 172L118 170C112 146 112 118 114 94Z M194 92C202 120 200 150 190 172L182 170C188 146 188 118 186 94Z`
    : cap;
}

function slash(x: number, y: number): string {
  return [
    `<path d="M${x - 14} ${y - 8}L${x + 14} ${y + 8}" stroke="${WOUND}" stroke-width="5" stroke-linecap="round"/>`,
    ...[-7, 0, 7].map(
      (d) =>
        `<path d="M${x + d - 3} ${y + d / 2 + 5}L${x + d + 3} ${y + d / 2 - 5}" stroke="${WOUND}" stroke-width="2" stroke-linecap="round"/>`,
    ),
  ].join('');
}

const HAFT = '#6b4a2b';
const STEEL = '#9aa3a8';
const STEEL_EDGE = '#2a2f33';

/** The weapon in the fist, of the kind the soul's words name. The fist is drawn over its grip. */
function weapon(kind: WeaponKind, x: number, y: number, outward: 1 | -1): string {
  const b = (dx: number) => x + dx * outward;
  if (kind === 'sword') {
    return [
      `<path d="M${x - 4} ${y - 16}V${y - 88}L${x} ${y - 98}L${x + 4} ${y - 88}V${y - 16}Z" fill="${STEEL}" stroke="${STEEL_EDGE}" stroke-width="2"/>`,
      `<path d="M${x} ${y - 86}V${y - 22}" stroke="#6f777c" stroke-width="1.5"/>`,
      `<rect x="${x - 13}" y="${y - 19}" width="26" height="6" rx="2" fill="#5c4630" stroke="${STEEL_EDGE}" stroke-width="1.5"/>`,
      `<path d="M${x} ${y - 13}V${y + 14}" stroke="${HAFT}" stroke-width="6"/>`,
      `<circle cx="${x}" cy="${y + 19}" r="5.5" fill="${STEEL}" stroke="${STEEL_EDGE}" stroke-width="1.5"/>`,
    ].join('');
  }
  if (kind === 'spear') {
    return [
      `<path d="M${x} ${y - 112}V${y + 44}" stroke="${HAFT}" stroke-width="5" stroke-linecap="round"/>`,
      `<path d="M${x} ${y - 146}Q${x + 9} ${y - 126} ${x} ${y - 108}Q${x - 9} ${y - 126} ${x} ${y - 146}Z" fill="${STEEL}" stroke="${STEEL_EDGE}" stroke-width="2"/>`,
      `<path d="M${x} ${y - 140}V${y - 112}" stroke="#6f777c" stroke-width="1.2"/>`,
    ].join('');
  }
  if (kind === 'seax') {
    // A long single-edged knife: a straight back, the edge rising to an angled point.
    return [
      `<path d="M${b(-3)} ${y - 14}V${y - 66}L${b(3)} ${y - 76}L${b(8)} ${y - 58}V${y - 14}Z" fill="${STEEL}" stroke="${STEEL_EDGE}" stroke-width="2"/>`,
      `<rect x="${x - 8}" y="${y - 16}" width="16" height="4" rx="1.5" fill="#5c4630" stroke="${STEEL_EDGE}" stroke-width="1.2"/>`,
      `<path d="M${x} ${y - 12}V${y + 16}" stroke="${HAFT}" stroke-width="6" stroke-linecap="round"/>`,
    ].join('');
  }
  const top = y - 76;
  return [
    `<path d="M${x} ${top}V${y + 26}" stroke="${HAFT}" stroke-width="6" stroke-linecap="round"/>`,
    `<path d="M${x} ${top + 4}L${b(28)} ${top - 8}Q${b(36)} ${top + 16} ${b(26)} ${top + 34}L${x} ${top + 24}Z" fill="${STEEL}" stroke="${STEEL_EDGE}" stroke-width="2"/>`,
  ].join('');
}

/** Long nails as claws past the knuckles; after the clippers, nothing sticks out. */
function claws(x: number, y: number): string {
  return [-9, -3, 3, 9]
    .map(
      (d) =>
        `<path d="M${x + d} ${y + 10}L${x + d * 1.3} ${y + 22}" stroke="#e6dcc0" stroke-width="3" stroke-linecap="round"/><path d="M${x + d} ${y + 10}L${x + d * 1.3} ${y + 22}" stroke="${INK}" stroke-width="1" stroke-linecap="round"/>`,
    )
    .join('');
}

/** A grip wrapped for a bigger hand: a thick, cross-bound band above the fist. */
function wrongGrip(x: number, y: number): string {
  return [
    `<rect x="${x - 9}" y="${y - 44}" width="18" height="26" rx="4" fill="#8a5a2b" stroke="${INK}" stroke-width="2"/>`,
    `<path d="M${x - 9} ${y - 40}L${x + 9} ${y - 30}M${x - 9} ${y - 30}L${x + 9} ${y - 20}" stroke="${INK}" stroke-width="1.5"/>`,
  ].join('');
}

/**
 * What the rune-lens shows on the weapon: a lens over the blade and the
 * carving under it. Stave patterns stand in for the runes (the text chip
 * reads them out), different for each owner and maker's mark.
 */
function runeReading(
  x: number,
  y: number,
  inscription: Value | undefined,
  mark: Value | undefined,
  kind: WeaponKind,
): string {
  const top = y + BLADE_Y[kind] - 14;
  const staves = (seed: string, x0: number, y0: number) =>
    [...seed]
      .map((ch, i) => {
        const cx = x0 + i * 5;
        const k = ch.charCodeAt(0) % 3;
        const branch =
          k === 0
            ? `M${cx} ${y0 + 2}L${cx + 3} ${y0 - 1}`
            : k === 1
              ? `M${cx} ${y0 + 4}L${cx - 3} ${y0 + 1}`
              : `M${cx - 2} ${y0 + 3}L${cx + 2} ${y0 + 3}`;
        return `<path d="M${cx} ${y0 - 3}V${y0 + 8}${branch}" stroke="${INK}" stroke-width="1.3" fill="none"/>`;
      })
      .join('');
  const owner = inscription === 'other' ? 'xqzv' : inscription === 'own' ? 'amik' : '';
  const maker = mark === 'markTrue' ? '+vlfberh+t' : mark === 'markCopy' ? '+vlfberht+' : '';
  return [
    `<circle cx="${x + 18}" cy="${top + 14}" r="22" fill="#f4efe0" fill-opacity="0.85" stroke="#3a2c20" stroke-width="3"/>`,
    `<path d="M${x + 34} ${top + 30}L${x + 46} ${top + 42}" stroke="#3a2c20" stroke-width="5" stroke-linecap="round"/>`,
    owner ? staves(owner, x + 6, top + 4) : '',
    maker ? staves(maker.slice(-6), x + 2, top + 18) : '',
  ].join('');
}

/** An open hand spreads its fingers; webbed (the seal's tell, docs/tech-spec.md §80), wider, over a grey membrane. */
function hand(x: number, y: number, open: boolean, webbed = false): string {
  const spread = webbed ? 1.9 : 1.4;
  const web = webbed
    ? `<path d="M${x - 8} ${y + 8}L${x - 15.2} ${y + 20}Q${x - 7.6} ${y + 15} ${x} ${y + 21}Q${x + 7.6} ${y + 15} ${x + 15.2} ${y + 20}L${x + 8} ${y + 8}Z" fill="#8fa6ab" stroke="${INK}" stroke-width="1.5" stroke-linejoin="round"/>`
    : '';
  const fingers = open
    ? [-8, 0, 8]
        .map(
          (d) =>
            `<path d="M${x + d} ${y + 8}L${x + d * spread} ${y + (d === 0 ? 24 : 22)}" stroke="${INK}" stroke-width="2.5" stroke-linecap="round"/>`,
        )
        .join('')
    : '';
  return `${open ? web : ''}<circle cx="${x}" cy="${y}" r="13" fill="${SKIN}" stroke="${INK}" stroke-width="2"/>${fingers}`;
}

function figure(scene: BodyScene): string {
  const { look, view } = scene;
  const h = half(look);
  const hp = hands(look, view);
  const parts: string[] = [];
  // Legs and feet.
  parts.push(
    `<rect x="${CX - h + 10}" y="300" width="${h - 14}" height="104" rx="6" fill="${TROUSERS}"/>`,
    `<rect x="${CX + 4}" y="300" width="${h - 14}" height="104" rx="6" fill="${TROUSERS}"/>`,
    `<ellipse cx="${CX - h / 2}" cy="408" rx="${h / 2}" ry="8" fill="${INK}"/>`,
    `<ellipse cx="${CX + h / 2}" cy="408" rx="${h / 2}" ry="8" fill="${INK}"/>`,
  );
  // Arms, torso, belt.
  parts.push(
    `<path d="M${CX - h + 4} 170L${Math.min(hp.R, hp.L)} ${hp.y - 12}" stroke="${TUNIC}" stroke-width="22" stroke-linecap="round"/>`,
    `<path d="M${CX + h - 4} 170L${Math.max(hp.R, hp.L)} ${hp.y - 12}" stroke="${TUNIC}" stroke-width="22" stroke-linecap="round"/>`,
    `<path d="M${CX - h} 172Q${CX - h} 156 ${CX - h + 16} 156H${CX + h - 16}Q${CX + h} 156 ${CX + h} 172L${CX + h - 6} 306H${CX - h + 6}Z" fill="${TUNIC}" stroke="${INK}" stroke-width="2"/>`,
    `<rect x="${CX - h + 5}" y="276" width="${2 * h - 10}" height="10" fill="#3a2c20"/>`,
  );
  if (view === 'back')
    parts.push(`<path d="M${CX} 162V272" stroke="#4a3b2d" stroke-width="3" stroke-dasharray="6 6"/>`);
  // Neck and head.
  parts.push(
    `<rect x="136" y="132" width="28" height="30" fill="${SKIN}" stroke="${INK}" stroke-width="2"/>`,
    `<circle cx="${CX}" cy="96" r="44" fill="${SKIN}" stroke="${INK}" stroke-width="2"/>`,
  );
  // Hands (the weapon is drawn under the fist, front view only).
  const grip = scene.obs.grip;
  const weaponHand = grip === 'weapon' ? (scene.obs.gripHand === 'left' ? 'L' : 'R') : null;
  if (view === 'front' && weaponHand) {
    const x = weaponHand === 'L' ? hp.L : hp.R;
    const kind = weaponKind(scene.weapon);
    parts.push(weapon(kind, x, hp.y, x < CX ? -1 : 1));
    if (scene.cues.includes('wrongGrip')) parts.push(wrongGrip(x, hp.y));
    if (scene.tools.includes('runeLens')) {
      parts.push(runeReading(x, hp.y, scene.obs.inscription, scene.obs.makersMark, kind));
    }
  }
  // Webbed, the hand that holds no weapon opens to show it.
  const webbed = view === 'front' && scene.obs.webbing === 'webbed';
  for (const side of ['R', 'L'] as const) {
    const x = side === 'L' ? hp.L : hp.R;
    const open = view === 'front' && (grip === 'none' || (webbed && side !== weaponHand));
    parts.push(hand(x, hp.y, open, webbed));
    if (view === 'front' && scene.obs.nails === true && !scene.tools.includes('clippers')) parts.push(claws(x, hp.y));
    parts.push(
      `<text x="${x}" y="${hp.y + 42}" font-size="13" font-family="sans-serif" text-anchor="middle" fill="#8f7e63">${side}</text>`,
    );
  }
  return parts.join('');
}

function hair(scene: BodyScene): string {
  const value = String(scene.obs.hair ?? 'dark');
  const style = HAIR[value] ?? HAIR.dark;
  if (!style) return '';
  const d = hairPath(scene.look, scene.view);
  const texture = style.texture ? `<path d="${d}" fill="url(#cots-hair-${value})"/>` : '';
  return `<path d="${d}" fill="${style.fill}" stroke="${INK}" stroke-width="2"/>${texture}`;
}

function face(scene: BodyScene): string {
  const { look, obs } = scene;
  const parts: string[] = [
    // Closed eyes and a nose: the dead, resting.
    `<path d="M124 96Q132 101 140 96M160 96Q168 101 176 96" fill="none" stroke="${INK}" stroke-width="2.5" stroke-linecap="round"/>`,
    `<path d="M150 100L145 114H153" fill="none" stroke="${INK}" stroke-width="2" stroke-linecap="round"/>`,
  ];
  if (look.age >= 60) {
    parts.push(
      `<path d="M132 70Q150 66 168 70M136 78Q150 75 164 78" fill="none" stroke="#9c8d78" stroke-width="1.5"/>`,
    );
  }
  if (obs.skin === 'feverFlush') {
    const dots = (x: number) =>
      [
        [0, 0],
        [6, 0],
        [-6, 0],
        [3, 5],
        [-3, 5],
        [3, -5],
        [-3, -5],
      ]
        .map(([dx = 0, dy = 0]) => `<circle cx="${x + dx}" cy="${112 + dy}" r="1.8" fill="#9e2a20"/>`)
        .join('');
    parts.push(
      `<ellipse cx="124" cy="112" rx="13" ry="9" fill="#e07a6a" opacity="0.45"/>`,
      `<ellipse cx="176" cy="112" rx="13" ry="9" fill="#e07a6a" opacity="0.45"/>`,
      dots(124),
      dots(176),
    );
  }
  if (look.beard !== 'none') {
    const beard = HAIR[String(obs.hair ?? 'dark')]?.fill ?? '#2e241c';
    const d =
      look.beard === 'short'
        ? 'M120 128Q150 158 180 128Q176 146 150 150Q124 146 120 128Z'
        : 'M122 128Q150 150 178 128Q174 150 162 164L150 170L138 164Q126 150 122 128Z';
    parts.push(`<path d="${d}" fill="${beard}" stroke="${INK}" stroke-width="1.5"/>`);
    if (look.beard === 'braided') {
      parts.push(`<path d="M143 156H157M144 162H156" stroke="#c8a96a" stroke-width="2.5"/>`);
    }
  }
  // Lips: a plain line, or sea-foam bubbles.
  parts.push(
    `<path d="M140 124Q150 128 160 124" fill="none" stroke="#7d5a4c" stroke-width="2.5" stroke-linecap="round"/>`,
  );
  if (obs.lipScars === 'stitched') {
    // Brokkr's stitches: small scars across the lips (the subtlest sign in the game).
    parts.push(
      `<path d="M142 120V130M146 121V131M150 121V131M154 121V131M158 120V130" stroke="#6b3a2e" stroke-width="1.6" stroke-linecap="round"/>`,
    );
  }
  parts.push(lokiTell(obs));
  if (obs.lips === 'seaFoam') {
    for (const [x, y, r] of [
      [140, 126, 3.5],
      [147, 130, 4],
      [155, 129, 3],
      [161, 125, 3.5],
      [151, 123, 2.5],
    ] as const) {
      parts.push(`<circle cx="${x}" cy="${y}" r="${r}" fill="#f4f7f8" stroke="#6f8791" stroke-width="1.2"/>`);
    }
  }
  if (scene.cues.includes('breathFog')) {
    parts.push(
      `<g opacity="0.8"><circle cx="180" cy="122" r="6" fill="#e8eef2" stroke="#8fa3ae" stroke-width="1"/>`,
      `<circle cx="189" cy="116" r="7" fill="#e8eef2" stroke="#8fa3ae" stroke-width="1"/>`,
      `<circle cx="197" cy="123" r="5" fill="#e8eef2" stroke="#8fa3ae" stroke-width="1"/></g>`,
    );
  }
  if (scene.tools.includes('feather')) {
    const stirs = obs.breath === 'stirs';
    const tilt = stirs ? -16 : 0;
    parts.push(
      `<g transform="rotate(${tilt} 138 126)">`,
      `<path d="M96 156L136 126" stroke="${INK}" stroke-width="2"/>`,
      `<path d="M100 150C104 134 124 122 136 126C128 138 112 152 100 150Z" fill="#f2ede2" stroke="${INK}" stroke-width="1.5"/>`,
      '</g>',
    );
    if (stirs) {
      // Air lines beside the head, clear of the face, so "stirs" reads at phone size.
      parts.push(
        `<path d="M100 102Q92 112 100 122M88 96Q76 112 88 128" fill="none" stroke="${INK}" stroke-width="2.6" stroke-linecap="round"/>`,
      );
    }
  }
  return parts.join('');
}

/**
 * Loki's tell in his later guises (docs/tech-spec.md §80): silver scales on the cheek, above any beard; a mare's
 * ears over the hair; a fly at the corner of the eye. (The seal's webbing is drawn with the hand.)
 */
function lokiTell(obs: BodyScene['obs']): string {
  const parts: string[] = [];
  if (obs.scales === 'silver') {
    for (const [x, y] of [
      [168, 104],
      [176, 104],
      [184, 104],
      [172, 110],
      [180, 110],
      [176, 116],
    ] as const) {
      parts.push(
        `<path d="M${x - 4} ${y}A4 4 0 0 0 ${x + 4} ${y}Z" fill="#cfd6db" stroke="${INK}" stroke-width="1.4"/>`,
      );
    }
  }
  if (obs.ears === 'horse') {
    parts.push(
      `<path d="M114 68Q96 46 102 20Q118 34 130 58ZM186 68Q204 46 198 20Q182 34 170 58Z" fill="${SKIN}" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>`,
      `<path d="M114 60Q105 46 106 32M186 60Q195 46 194 32" fill="none" stroke="#a87f6e" stroke-width="3" stroke-linecap="round"/>`,
    );
  }
  if (obs.fly === 'fly') {
    parts.push(
      `<ellipse cx="114" cy="96" rx="4" ry="2.3" transform="rotate(-35 114 96)" fill="#eef2f3" stroke="${INK}" stroke-width="1"/>`,
      `<ellipse cx="122" cy="96" rx="4" ry="2.3" transform="rotate(35 122 96)" fill="#eef2f3" stroke="${INK}" stroke-width="1"/>`,
      `<path d="M116 101l-3 2.2M120 101l3 2.2M116.3 103.4l-2.4 3M119.7 103.4l2.4 3" stroke="${INK}" stroke-width="1" stroke-linecap="round"/>`,
      `<ellipse cx="118" cy="101" rx="2.6" ry="4" fill="${INK}"/>`,
      `<circle cx="118" cy="96.5" r="2" fill="${INK}"/>`,
    );
  }
  return parts.join('');
}

function ornament(value: Value | undefined): string {
  if (value !== 'amber' && value !== 'silver') return '';
  const cord = `<path d="M136 150L150 176L164 150" fill="none" stroke="#3a2c20" stroke-width="2"/>`;
  return value === 'amber'
    ? `${cord}<path d="M150 172C160 184 158 196 150 198C142 196 140 184 150 172Z" fill="#d98e1f" stroke="#6b3d05" stroke-width="2"/><circle cx="147" cy="186" r="2" fill="#f6d28a"/>`
    : `${cord}<circle cx="150" cy="186" r="9" fill="none" stroke="#c9ced3" stroke-width="5"/><circle cx="150" cy="186" r="9" fill="none" stroke="#5c6166" stroke-width="1"/>`;
}

/** An amulet on its own cord, left of any ornament: Thor's hammer, a cross, or both on one cord. */
function amulet(value: Value | undefined): string {
  if (value !== 'hammer' && value !== 'cross' && value !== 'hammerAndCross') return '';
  const hammer = (x: number) =>
    `<path d="M${x - 1.5} 176H${x + 1.5}V186H${x + 7}V192H${x - 7}V186H${x - 1.5}Z" fill="#8c9296" stroke="${INK}" stroke-width="1.5"/>`;
  const cross = (x: number) =>
    `<path d="M${x - 1.5} 176H${x + 1.5}V181H${x + 6}V184H${x + 1.5}V196H${x - 1.5}V184H${x - 6}V181H${x - 1.5}Z" fill="#c08a3e" stroke="${INK}" stroke-width="1.5"/>`;
  const cord = `<path d="M138 152L128 176" fill="none" stroke="#3a2c20" stroke-width="2"/>`;
  if (value === 'hammer') return `${cord}${hammer(128)}`;
  if (value === 'cross') return `${cord}${cross(128)}`;
  return `${cord}<path d="M121 176H135" stroke="#3a2c20" stroke-width="2"/>${hammer(121)}${cross(135)}`;
}

/** A tally stick tucked in the belt, its notches fresh and pale (drawn only as a cue). */
function freshTally(on: boolean, look: Look): string {
  if (!on) return '';
  const x = CX + half(look) - 22;
  return [
    `<rect x="${x}" y="262" width="10" height="44" rx="2" fill="#7a5a36" stroke="${INK}" stroke-width="2" transform="rotate(12 ${x + 5} 284)"/>`,
    ...[268, 276, 284, 292].map(
      (y) =>
        `<path d="M${x + 1} ${y}L${x + 9} ${y + 2}" stroke="#f4ead2" stroke-width="2.5" transform="rotate(12 ${x + 5} 284)"/>`,
    ),
  ].join('');
}

/** An oath-ring on a thong, snapped open: drawn beside any pendant so both stay readable. */
function brokenRing(on: boolean): string {
  if (!on) return '';
  return [
    `<path d="M160 146L178 176" fill="none" stroke="#3a2c20" stroke-width="2"/>`,
    `<path d="M186 180A9 9 0 1 1 176 172" fill="none" stroke="#b08d3c" stroke-width="4" stroke-linecap="round"/>`,
    `<path d="M180 170L184 166M186 176L191 175" stroke="${INK}" stroke-width="1.8" stroke-linecap="round"/>`,
  ].join('');
}

/** Day 17's spear mark: a spear point cut over the heart before death (our right). */
function spearCut(on: boolean): string {
  if (!on) return '';
  return [
    `<path d="M176 202L182 214L176 224L170 214Z" fill="${WOUND}" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>`,
    `<path d="M176 224V231M172 227H180" stroke="${INK}" stroke-width="2" stroke-linecap="round"/>`,
  ].join('');
}

function wounds(n: Value | undefined, at: readonly (readonly [number, number])[]): string {
  const count = typeof n === 'number' ? Math.max(0, Math.min(at.length, n)) : 0;
  return at
    .slice(0, count)
    .map(([x, y]) => slash(x, y))
    .join('');
}

function defs(): string {
  const patterns = Object.entries(HAIR)
    .filter(([, s]) => s.texture)
    .map(
      ([k, s]) =>
        `<pattern id="cots-hair-${k}" width="10" height="10" patternUnits="userSpaceOnUse">${s.texture}</pattern>`,
    );
  return `<defs>${patterns.join('')}</defs>`;
}

function draw(scene: BodyScene): string {
  const body =
    scene.view === 'front'
      ? [
          figure(scene),
          hair(scene),
          face(scene),
          ornament(scene.obs.ornament),
          amulet(scene.obs.amulet),
          brokenRing(scene.cues.includes('brokenRing')),
          freshTally(scene.cues.includes('freshCarving'), scene.look),
          spearCut(scene.obs.spearCut === true),
          wounds(scene.obs.woundsFront, FRONT_WOUNDS),
        ]
      : [figure(scene), hair(scene), wounds(scene.obs.woundsBack, BACK_WOUNDS)];
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-hidden="true">`,
    defs(),
    ...body,
    '</svg>',
  ].join('');
}

export const placeholderBody: BodyArtProvider = {
  id: 'placeholder',
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

/** A registry portrait: the same drawing as the body, cropped to the head and shoulders. */
function portrait(p: Portrait): string {
  return draw(portraitScene(p)).replace(/viewBox="[^"]*"/, `viewBox="${PORTRAIT_VIEWBOX}"`);
}
