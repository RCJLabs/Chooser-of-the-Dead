import { fnv1a32, type Look, type Value } from '@cots/engine';
import type { BodyArtProvider, BodyScene, Portrait } from './contract';
import { BLADE_Y, H, portraitScene, SIGN_VIEWS, standardHotspots, W, type WeaponKind, weaponKind } from './layout';

/**
 * Candidate art direction B: indexed-palette pixel art. The body is drawn on
 * a 100x140 grid (one art pixel is 3x3 frame units, so the shared hotspots
 * still fit) and the game scales it in whole device pixels. Each part is
 * drawn on its own layer and outlined, like hand-placed selective outlines.
 * Signs stay shape-coded: wounds are slashes with drips, fever is a dither,
 * sea-foam is bubbles and each hair colour has its own texture.
 */

const GRID = 3;
const CW = W / GRID; // 100
const CH = H / GRID; // 140
const CX = 50;

// ---------- palette ----------

const PALETTE: string[] = [''];
const idx = new Map<string, number>();
/** A palette index for a colour (shared by every drawing, so indices are stable). */
function c(hex: string): number {
  const found = idx.get(hex);
  if (found !== undefined) return found;
  PALETTE.push(hex);
  idx.set(hex, PALETTE.length - 1);
  return PALETTE.length - 1;
}

const OUTLINE = c('#1b1410');
const SKIN = c('#e6c7a0');
const SKIN_SHADE = c('#c49a74');
const SKIN_DARK = c('#9c6e4c');
const LIPS = c('#8a5242');
const TROUSERS = c('#5a4a3a');
const TROUSERS_SHADE = c('#403428');
const WRAPS = c('#c9b58c');
const WRAPS_SHADE = c('#98845e');
const BELT = c('#3a2a1c');
const GOLD = c('#d6a640');
const WOOD = c('#8a5a2c');
const LEATHER = c('#6b4424');
const IRON = c('#aab2b6');
const IRON_SHADE = c('#6f7a82');
const IRON_LIGHT = c('#e6ecee');
const BLOOD = c('#c0281e');
const BLOOD_DARK = c('#7a1410');
const WHITE = c('#f8f8f4');
const FOAM_EDGE = c('#4f8497');
const AMBER = c('#e0901c');
const AMBER_LIGHT = c('#f8cc6a');
const SILVER = c('#d3d8dc');
const FEVER = c('#d8483a');
const FOG = c('#dce6ea');
const NAIL = c('#efe2c0');
const GLASS = c('#eef3ef');
const LABEL = c('#4d3f30');
const WALL = c('#b9aa8e');
const WALL_DARK = c('#a39377');
const FLOOR = c('#8b7a60');
const WEB = c('#8fa6ab');
const SCALE_RIM = c('#6f7a82');

const TUNICS: readonly (readonly [number, number])[] = [
  [c('#9c4632'), c('#6e2e22')],
  [c('#4f6a86'), c('#344a60')],
  [c('#8a7454'), c('#62503a')],
  [c('#6d7a45'), c('#4b552f')],
];

const HAIR: Readonly<Record<string, readonly [number, number, number]>> = {
  dark: [c('#3a2a20'), c('#20150e'), c('#5e4636')],
  fair: [c('#e0c070'), c('#b8963e'), c('#f6e2a4')],
  red: [c('#b44a26'), c('#7e2e16'), c('#de7c46')],
  grey: [c('#b8b8b2'), c('#85857f'), c('#e2e2dc')],
};

// ---------- an indexed canvas ----------

class Canvas {
  readonly px = new Uint8Array(CW * CH);
  set(x: number, y: number, color: number): void {
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi >= 0 && yi >= 0 && xi < CW && yi < CH) this.px[yi * CW + xi] = color;
  }
  get(x: number, y: number): number {
    return x >= 0 && y >= 0 && x < CW && y < CH ? (this.px[y * CW + x] ?? 0) : 0;
  }
  rect(x: number, y: number, w: number, h: number, color: number): void {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, color);
  }
  /** A filled ellipse, by the integer test (no square roots). */
  ellipse(
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    color: number,
    keep?: (x: number, y: number) => boolean,
  ): void {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx * ry * ry + dy * dy * rx * rx <= rx * rx * ry * ry && (!keep || keep(x, y))) this.set(x, y, color);
      }
    }
  }
  line(x0: number, y0: number, x1: number, y1: number, color: number, width = 1): void {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let s = 0; s <= steps; s++) {
      const x = x0 + ((x1 - x0) * s) / steps;
      const y = y0 + ((y1 - y0) * s) / steps;
      if (width === 1) this.set(x, y, color);
      else this.rect(Math.round(x - (width - 1) / 2), Math.round(y - (width - 1) / 2), width, width, color);
    }
  }
  /** A convex polygon, filled by scanlines. */
  poly(points: readonly (readonly [number, number])[], color: number): void {
    const ys = points.map((p) => p[1]);
    for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y++) {
      const xs: number[] = [];
      for (let i = 0; i < points.length; i++) {
        const a = points[i] as readonly [number, number];
        const b = points[(i + 1) % points.length] as readonly [number, number];
        if ((a[1] <= y + 0.5 && b[1] > y + 0.5) || (b[1] <= y + 0.5 && a[1] > y + 0.5)) {
          xs.push(a[0] + ((y + 0.5 - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
        }
      }
      if (xs.length >= 2) {
        const lo = Math.min(...xs);
        const hi = Math.max(...xs);
        for (let x = Math.round(lo); x < Math.round(hi); x++) this.set(x, y, color);
      }
    }
  }
  /** Rows of characters; '.' is transparent. */
  sprite(x: number, y: number, rows: readonly string[], map: Readonly<Record<string, number>>, flip = false): void {
    rows.forEach((row, j) => {
      [...row].forEach((ch, i) => {
        const color = map[ch];
        if (color) this.set(flip ? x + row.length - 1 - i : x + i, y + j, color);
      });
    });
  }
  /** Rings the drawn pixels with an outline (4-neighbourhood). */
  outline(color: number): void {
    const edge: number[] = [];
    for (let y = 0; y < CH; y++) {
      for (let x = 0; x < CW; x++) {
        if (this.get(x, y) !== 0) continue;
        if (this.get(x - 1, y) || this.get(x + 1, y) || this.get(x, y - 1) || this.get(x, y + 1)) edge.push(y * CW + x);
      }
    }
    for (const i of edge) this.px[i] = color;
  }
  paste(layer: Canvas): void {
    layer.px.forEach((v, i) => {
      if (v !== 0) this.px[i] = v;
    });
  }
}

/** Draws a part on its own layer, outlines it and lays it on the canvas. */
function part(on: Canvas, draw: (l: Canvas) => void, edge: number | null = OUTLINE): void {
  const layer = new Canvas();
  draw(layer);
  if (edge !== null) layer.outline(edge);
  on.paste(layer);
}

// ---------- the figure ----------

const halfOf = (look: Look) => (look.build === 'lean' ? 15 : look.build === 'broad' ? 19 : 21);

function handsOf(look: Look, front: boolean): { R: number; L: number; y: number } {
  const off = halfOf(look) + 9;
  return front ? { R: CX - off, L: CX + off, y: 100 } : { R: CX + off, L: CX - off, y: 100 };
}

/** The look's clothing colour where the day chose one (spread looks), else one picked by the name. */
const tunicOf = (look: Look): readonly [number, number] =>
  TUNICS[(look.tunic ?? fnv1a32(`${look.name}|${look.patronym}|tunic`)) % TUNICS.length] ?? [OUTLINE, OUTLINE];

function hairTexture(hair: string): (x: number, y: number) => number {
  const [base, shade, light] = HAIR[hair] ?? HAIR.dark ?? [OUTLINE, OUTLINE, OUTLINE];
  if (hair === 'fair') return (x) => (x % 2 === 0 ? light : base);
  if (hair === 'red') return (x, y) => ((x + (y % 3)) % 3 === 0 ? shade : base);
  if (hair === 'grey') return (x, y) => ((x + y) % 2 === 0 ? light : base);
  return (x, y) => (y === 19 && x > 42 && x < 50 ? light : base);
}

function legs(cv: Canvas, look: Look): void {
  const hs = halfOf(look);
  for (const [x0, x1] of [
    [CX - hs + 3, CX - 1],
    [CX + 1, CX + hs - 3],
  ] as const) {
    part(cv, (l) => {
      l.rect(x0, 100, x1 - x0 + 1, 18, TROUSERS);
      l.rect(x0, 100, 2, 18, TROUSERS_SHADE);
      l.rect(x0, 118, x1 - x0 + 1, 13, WRAPS);
      for (let y = 119; y < 131; y += 3) l.line(x0, y, x1, y + 2, WRAPS_SHADE);
      l.rect(x0 - 1, 131, x1 - x0 + 3, 3, BELT);
    });
  }
}

function sleeves(cv: Canvas, look: Look, front: boolean): void {
  const hs = halfOf(look);
  const hp = handsOf(look, front);
  const [tunic, shade] = tunicOf(look);
  const left = Math.min(hp.R, hp.L);
  const right = Math.max(hp.R, hp.L);
  for (const [sx, ex, out] of [
    [CX - hs + 2, left, -1],
    [CX + hs - 2, right, 1],
  ] as const) {
    part(cv, (l) => {
      l.poly(
        [
          [sx - 3, 54],
          [sx + 4, 54],
          [ex + 4, hp.y - 4],
          [ex - 3, hp.y - 4],
        ],
        tunic,
      );
      // The outer edge in shade.
      l.line(sx + (out > 0 ? 3 : -3), 56, ex + (out > 0 ? 3 : -3), hp.y - 5, shade, 2);
    });
  }
}

function torso(cv: Canvas, look: Look, front: boolean): void {
  const hs = halfOf(look);
  const [tunic, shade] = tunicOf(look);
  part(cv, (l) => {
    for (let y = 52; y <= 103; y++) {
      const flare = y >= 97 ? 1 : 0;
      const inset = y === 52 ? 2 : y === 53 ? 1 : 0;
      for (let x = CX - hs - flare + inset; x <= CX + hs + flare - inset; x++) {
        // Light from the left: the right third in shade, dithered at the edge.
        const edge = CX + Math.round(hs / 3);
        const shaded = x > edge || (x === edge && (x + y) % 2 === 0);
        l.set(x, y, shaded ? shade : tunic);
      }
    }
    // Belt and buckle, hem trim.
    l.rect(CX - hs, 92, 2 * hs + 1, 4, BELT);
    if (front) {
      l.rect(CX - 2, 92, 4, 4, GOLD);
      l.set(CX - 1, 93, BELT);
      l.set(CX - 1, 94, BELT);
      // The neck opening.
      l.line(CX - 5, 53, CX, 58, shade);
      l.line(CX + 5, 53, CX, 58, shade);
    } else {
      for (let y = 56; y < 90; y += 3) l.set(CX, y, shade);
    }
    for (let x = CX - hs; x <= CX + hs; x += 2) l.set(x, 101, GOLD);
  });
}

function head(cv: Canvas, front: boolean): void {
  part(cv, (l) => {
    l.rect(45, 44, 10, 10, SKIN);
    l.rect(51, 44, 4, 10, SKIN_SHADE);
  });
  part(cv, (l) => {
    l.ellipse(50, 32, 14, 15, SKIN);
    if (front) l.ellipse(50, 32, 14, 15, SKIN_SHADE, (x) => x >= 61);
  });
}

function hairFront(cv: Canvas, look: Look, hair: string): void {
  const tex = hairTexture(hair);
  part(cv, (l) => {
    // A cap over the crown, deeper at the temples.
    for (let y = 15; y <= 31; y++) {
      for (let x = 34; x <= 66; x++) {
        const dx = x - 50;
        const dy = y - 32;
        const inHead = dx * dx * 256 + dy * dy * 225 <= 225 * 256;
        const cap =
          y <= 22 ||
          (y <= 25 && (x + y) % 3 !== 0 && y <= 23 + (Math.abs(dx) > 8 ? 2 : 0)) ||
          (Math.abs(dx) >= 12 && y <= 30);
        if (inHead && cap) l.set(x, y, tex(x, y));
      }
    }
    if (look.gender === 'f') {
      // Long locks falling in front of the shoulders.
      for (let y = 24; y <= 62; y++) {
        const taper = y > 56 ? 1 : 0;
        for (let x = 34 + taper; x <= 38 - taper; x++) l.set(x, y, tex(x, y));
        for (let x = 62 + taper; x <= 66 - taper; x++) l.set(x, y, tex(x, y));
      }
    }
  });
}

function hairBack(cv: Canvas, look: Look, hair: string): void {
  const tex = hairTexture(hair);
  part(cv, (l) => {
    l.ellipse(50, 32, 15, 16, 1);
    for (let i = 0; i < l.px.length; i++) if (l.px[i]) l.px[i] = tex(i % CW, Math.floor(i / CW));
    if (look.gender === 'f') {
      for (let y = 46; y <= 64; y++)
        for (let x = 48; x <= 52; x++) l.set(x, y, (y + x) % 4 === 0 ? OUTLINE : tex(x, y));
    }
  });
}

function beard(cv: Canvas, look: Look, hair: string): void {
  if (look.gender === 'f' || look.beard === 'none') return;
  const tex = hairTexture(hair);
  part(cv, (l) => {
    // Moustache and chin; the mouth line stays clear.
    for (let x = 44; x <= 56; x++) l.set(x, 38, tex(x, 38));
    const bottom = look.beard === 'short' ? 46 : 56;
    for (let y = 41; y <= bottom; y++) {
      const narrow = look.beard === 'short' ? Math.max(0, y - 43) : Math.max(0, Math.floor((y - 45) * 0.8));
      for (let x = 37 + narrow; x <= 63 - narrow; x++) {
        const dx = x - 50;
        const dy = y - 32;
        const jaw = dx * dx * 256 + dy * dy * 225 <= 225 * 256 || y > 44;
        if (jaw && !(y === 41 && x >= 47 && x <= 53)) l.set(x, y, tex(x, y));
      }
    }
    if (look.beard === 'braided') {
      for (const y of [50, 53]) for (let x = 48; x <= 52; x++) l.set(x, y, GOLD);
    }
  });
}

function face(cv: Canvas, scene: BodyScene): void {
  const { look, obs } = scene;
  // Brows and closed eyes.
  cv.line(42, 27, 46, 27, OUTLINE);
  cv.line(54, 27, 58, 27, OUTLINE);
  for (const [x, y] of [
    [42, 30],
    [43, 31],
    [44, 31],
    [45, 31],
    [46, 30],
    [54, 30],
    [55, 31],
    [56, 31],
    [57, 31],
    [58, 30],
  ] as const) {
    cv.set(x, y, OUTLINE);
  }
  cv.line(50, 32, 50, 35, SKIN_DARK);
  cv.set(51, 36, SKIN_DARK);
  if (look.age >= 60) {
    cv.line(45, 24, 55, 24, SKIN_SHADE);
    cv.set(40, 31, SKIN_DARK);
    cv.set(60, 31, SKIN_DARK);
  }
  if (obs.skin === 'feverFlush') {
    for (let y = 34; y <= 38; y++) {
      for (const x0 of [39, 55]) for (let x = x0; x <= x0 + 6; x++) if ((x + y) % 2 === 0) cv.set(x, y, FEVER);
    }
  }
  cv.line(47, 41, 53, 41, LIPS);
}

/**
 * Loki's tell in his later guises (docs/tech-spec.md §80): silver scales on the cheek, above any beard; a mare's
 * ears over the hair; a fly at the corner of the eye. (The seal's webbing is drawn with the hand.)
 */
function lokiTell(cv: Canvas, obs: BodyScene['obs']): void {
  if (obs.scales === 'silver') {
    // Rows of overlapping scales, each a silver crescent with a dark rim below.
    part(cv, (l) =>
      l.sprite(54, 32, ['.SSSSS.', 'SRSRSRS', 'SSSSSSS', '.RSRSR.', '..SSS..'], { S: SILVER, R: SCALE_RIM }),
    );
  }
  if (obs.ears === 'horse') {
    for (const m of [1, -1]) {
      const x = (n: number) => CX + m * (n - CX);
      part(cv, (l) => {
        l.poly(
          [
            [x(36), 4],
            [x(45), 18],
            [x(38), 22],
          ],
          SKIN,
        );
        l.line(x(38), 9, x(40), 18, SKIN_DARK);
      });
    }
  }
  if (obs.fly === 'fly') {
    // Glassy wings over a black body, at the outer corner of the eye.
    part(cv, (l) => {
      l.sprite(37, 29, ['WW.WW', '.WBW.', '..B..', '.B.B.'], { W: GLASS, B: OUTLINE });
    });
  }
}

/** Froth at the mouth: separate bubbles ringed in sea-blue, and a trickle of brine. */
function seaFoam(cv: Canvas): void {
  part(
    cv,
    (l) => {
      for (const [x, y] of [
        [45, 40],
        [48, 42],
        [51, 39],
        [54, 41],
      ] as const) {
        l.rect(x, y, 2, 2, WHITE);
      }
    },
    FOAM_EDGE,
  );
  cv.line(57, 43, 57, 47, FOAM_EDGE);
}

function breathFog(cv: Canvas): void {
  part(cv, (l) => {
    for (const [x, y, r] of [
      [63, 40, 3],
      [67, 37, 3],
      [70, 41, 3],
      [66, 43, 2],
    ] as const) {
      l.ellipse(x, y, r, r, FOG);
    }
  });
}

/** The feather held at the lips: a white vane along a dark quill. When breath stirs it, it lifts and shivers. */
function feather(cv: Canvas, stirs: boolean): void {
  const [x0, y0] = [31, 53];
  const [x1, y1] = stirs ? [46, 36] : [46, 41];
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.max(1, Math.hypot(dx, dy));
  const nx = -dy / len;
  const ny = dx / len;
  // The vane sits on the upper side of the quill.
  const side = ny < 0 ? 1 : -1;
  const at = (t: number, off: number): [number, number] => [
    x0 + dx * t + nx * off * side,
    y0 + dy * t + ny * off * side,
  ];
  part(cv, (l) => {
    l.poly([at(0.2, 0), at(0.35, 3.5), at(0.85, 2.5), at(1, 0)], WHITE);
    l.poly([at(0.3, 0), at(0.4, -2), at(0.8, -1.5), at(0.95, 0)], WHITE);
    l.line(x0, y0, x1, y1, SKIN_DARK);
  });
  if (stirs) {
    // Air lines beside the head, clear of the face.
    for (const [x, y] of [
      [33, 34],
      [32, 35],
      [32, 36],
      [32, 37],
      [33, 38],
      [30, 32],
      [29, 33],
      [29, 34],
      [29, 35],
      [29, 36],
      [29, 37],
      [30, 38],
    ] as const) {
      cv.set(x, y, OUTLINE);
    }
  }
}

const AXE = [
  'OOO.......',
  'OIIOO.....',
  'OIIIIOO...',
  'OIIIIIIO..',
  'OIIIIIILO.',
  'OSIIIIILO.',
  'OSSIIIILO.',
  '.OSSIIILO.',
  '..OSSIILO.',
  '...OOSLO..',
  '.....OO...',
];

const SWORD = [
  '..I..',
  ...Array.from({ length: 24 }, () => '.ILI.'),
  'GGGGG',
  '..W..',
  '..W..',
  '..W..',
  '..W..',
  '..W..',
  '..W..',
  '..W..',
  '..W..',
  '..W..',
  '..W..',
  '..W..',
  '..W..',
  '.III.',
  '.III.',
];

const SPEARHEAD = ['.I.', '.I.', 'III', 'ILI', 'ILI', 'ILI', 'III', '.I.', '.W.', '.W.'];

const SEAX = [
  '...I',
  '..II',
  '.IIL',
  ...Array.from({ length: 10 }, () => 'IIIL'),
  'GGGG',
  '.WW.',
  '.WW.',
  '.WW.',
  '.WW.',
  '.WW.',
  '.WW.',
  '.WW.',
  '.WW.',
  '.WW.',
];

/** The weapon in the fist, of the kind the soul's words name. The fist is drawn over its grip. */
function weapon(cv: Canvas, kind: WeaponKind, x: number, y: number, outward: 1 | -1): void {
  const map = { O: OUTLINE, I: IRON, S: IRON_SHADE, L: IRON_LIGHT, G: GOLD, W: WOOD };
  if (kind === 'sword') {
    part(cv, (l) => l.sprite(x - 2, y - 34, SWORD, map));
    return;
  }
  if (kind === 'spear') {
    part(cv, (l) => {
      l.rect(x, y - 37, 1, 52, WOOD);
      l.sprite(x - 1, y - 49, SPEARHEAD, map);
    });
    return;
  }
  if (kind === 'seax') {
    part(cv, (l) => l.sprite(outward > 0 ? x - 1 : x - 2, y - 27, SEAX, map, outward < 0));
    return;
  }
  part(cv, (l) => {
    l.rect(x, y - 27, 2, 38, WOOD);
  });
  cv.sprite(outward > 0 ? x + 2 : x - 10, y - 28, AXE, map, outward < 0);
}

function wrongGrip(cv: Canvas, x: number, y: number): void {
  part(cv, (l) => {
    l.rect(x - 2, y - 16, 6, 9, LEATHER);
    for (let j = 0; j < 9; j += 3) {
      l.set(x - 1, y - 16 + j, WRAPS);
      l.set(x + 1, y - 15 + j, WRAPS);
      l.set(x + 3, y - 14 + j, WRAPS);
    }
  });
}

function runeReading(
  cv: Canvas,
  x: number,
  y: number,
  inscription: Value | undefined,
  mark: Value | undefined,
  kind: WeaponKind,
): void {
  const cx = x + 7;
  const cy = y + Math.round(BLADE_Y[kind] / GRID) - 1;
  part(cv, (l) => {
    l.line(cx + 6, cy + 6, cx + 11, cy + 11, WOOD, 2);
  });
  part(cv, (l) => {
    l.ellipse(cx, cy, 8, 8, GLASS);
  });
  const staves = (seed: string, x0: number, y0: number) => {
    [...seed].forEach((ch, i) => {
      const sx = x0 + i * 2;
      cv.line(sx, y0, sx, y0 + 3, OUTLINE);
      const k = ch.charCodeAt(0) % 3;
      cv.set(k === 0 ? sx + 1 : sx - 1, y0 + (k === 2 ? 2 : 1), OUTLINE);
    });
  };
  const owner = inscription === 'other' ? 'xqzv' : inscription === 'own' ? 'amik' : '';
  const maker = mark === 'markTrue' ? '+vlfberh+t' : mark === 'markCopy' ? '+vlfberht+' : '';
  if (owner) staves(owner, cx - 4, cy - 5);
  if (maker) staves(maker.slice(-6), cx - 6, cy + 1);
}

/** An open hand spreads its fingers; webbed (the seal's tell, docs/tech-spec.md §80), wider, over a grey membrane. */
function hand(cv: Canvas, x: number, y: number, open: boolean, webbed = false): void {
  part(cv, (l) => {
    if (open && webbed) {
      l.poly(
        [
          [x - 2, y + 3],
          [x - 4.5, y + 7.5],
          [x, y + 7.5],
          [x, y + 3],
        ],
        WEB,
      );
      l.poly(
        [
          [x, y + 3],
          [x, y + 7.5],
          [x + 4.5, y + 7.5],
          [x + 2, y + 3],
        ],
        WEB,
      );
      for (const d of [-2, 0, 2]) l.line(x + d, y + 3, x + d * 2.6, y + 9, SKIN);
    } else if (open) for (const d of [-2, 0, 2]) l.line(x + d, y + 3, x + d * 1.4, y + 7, SKIN);
    l.ellipse(x, y, 4, 4, SKIN);
  });
}

function claws(cv: Canvas, x: number, y: number): void {
  part(cv, (l) => {
    for (const d of [-3, -1, 1, 3]) l.line(x + d, y + 4, x + d * 1.4, y + 10, NAIL);
  });
}

const GLYPHS: Readonly<Record<string, readonly string[]>> = {
  R: ['XX.', 'X.X', 'XX.', 'X.X', 'X.X'],
  L: ['X..', 'X..', 'X..', 'X..', 'XXX'],
};

function ornament(cv: Canvas, value: Value | undefined): void {
  if (value !== 'amber' && value !== 'silver') return;
  cv.line(45, 53, 50, 58, OUTLINE);
  cv.line(55, 53, 50, 58, OUTLINE);
  part(cv, (l) => {
    if (value === 'amber') {
      l.sprite(48, 59, ['..A..', '.AAA.', 'AALAA', 'AAAAA', '.AAA.'], { A: AMBER, L: AMBER_LIGHT });
    } else {
      l.sprite(48, 59, ['.SSS.', 'S...S', 'S...S', 'S...S', '.SSS.'], { S: SILVER });
    }
  });
}

/** An amulet on its own cord, left of any ornament: Thor's hammer, a cross, or both on one cord. */
function amulet(cv: Canvas, value: Value | undefined): void {
  if (value !== 'hammer' && value !== 'cross' && value !== 'hammerAndCross') return;
  // Mjölnir's head is wider than it is tall; the cross is taller than it is wide.
  const HAMMER = ['..I..', '..I..', '..I..', 'IIIII', 'IIIII'];
  const CROSS = ['..G..', 'GGGGG', '..G..', '..G..', '..G..', '..G..'];
  const map = { I: IRON, G: GOLD };
  cv.line(46, 51, 43, 58, OUTLINE);
  part(cv, (l) => {
    if (value === 'hammer') l.sprite(41, 59, HAMMER, map);
    else if (value === 'cross') l.sprite(41, 59, CROSS, map);
    else {
      l.sprite(37, 59, HAMMER, map);
      l.sprite(43, 59, CROSS, map);
    }
  });
}

function brokenRing(cv: Canvas): void {
  cv.line(54, 51, 59, 58, OUTLINE);
  part(cv, (l) => {
    l.sprite(57, 58, ['.GG..', 'G..G.', 'G...G', 'G...G', '.GGG.'], { G: GOLD });
  });
  cv.set(60, 57, OUTLINE);
}

function freshTally(cv: Canvas, look: Look): void {
  const x = CX + halfOf(look) - 7;
  part(cv, (l) => {
    l.rect(x, 86, 3, 15, WOOD);
    for (const y of [88, 91, 94, 97]) l.rect(x, y, 3, 1, NAIL);
  });
}

function wound(cv: Canvas, x: number, y: number): void {
  part(cv, (l) => {
    l.line(x - 5, y - 2, x + 5, y + 2, BLOOD, 2);
    l.set(x - 1, y + 2, BLOOD);
    l.set(x - 1, y + 3, BLOOD);
    l.set(x + 3, y + 3, BLOOD);
    l.set(x + 3, y + 4, BLOOD);
  });
  cv.set(x - 5, y - 2, BLOOD_DARK);
  cv.set(x + 5, y + 2, BLOOD_DARK);
}

/** Day 17's spear mark: a spear point cut over the heart before death (our right). */
function spearCut(cv: Canvas): void {
  part(cv, (l) => l.sprite(58, 66, ['.B.', 'BBB', 'BBB', '.B.', '.D.'], { B: BLOOD_DARK, D: OUTLINE }));
}

const FRONT_WOUNDS = [
  [43, 72],
  [56, 79],
  [47, 87],
] as const;
const BACK_WOUNDS = [
  [43, 69],
  [57, 77],
  [50, 86],
] as const;

function paint(scene: BodyScene): Canvas {
  const cv = new Canvas();
  const { look, obs } = scene;
  const front = scene.view === 'front';
  const hair = String(obs.hair ?? 'dark');
  const hp = handsOf(look, front);
  legs(cv, look);
  sleeves(cv, look, front);
  torso(cv, look, front);
  head(cv, front);
  if (front) {
    face(cv, scene);
    hairFront(cv, look, hair);
    beard(cv, look, hair);
    if (obs.lipScars === 'stitched') {
      // Brokkr's stitches: small scars across the lips (the subtlest sign in the game).
      for (const x of [47, 49, 51, 53]) for (let y = 40; y <= 42; y++) cv.set(x, y, SKIN_DARK);
    }
    lokiTell(cv, obs);
    if (obs.lips === 'seaFoam') seaFoam(cv);
    ornament(cv, obs.ornament);
    amulet(cv, obs.amulet);
    if (scene.cues.includes('brokenRing')) brokenRing(cv);
    if (scene.cues.includes('freshCarving')) freshTally(cv, look);
    if (obs.spearCut === true) spearCut(cv);
    if (scene.cues.includes('breathFog')) breathFog(cv);
    if (scene.tools.includes('feather')) feather(cv, obs.breath === 'stirs');
    const n = typeof obs.woundsFront === 'number' ? obs.woundsFront : 0;
    for (const [x, y] of FRONT_WOUNDS.slice(0, n)) wound(cv, x, y);
  } else {
    hairBack(cv, look, hair);
    const n = typeof obs.woundsBack === 'number' ? obs.woundsBack : 0;
    for (const [x, y] of BACK_WOUNDS.slice(0, n)) wound(cv, x, y);
  }
  const weaponHand = front && obs.grip === 'weapon' ? (obs.gripHand === 'left' ? 'L' : 'R') : null;
  if (weaponHand) {
    const x = weaponHand === 'L' ? hp.L : hp.R;
    const kind = weaponKind(scene.weapon);
    weapon(cv, kind, x, hp.y, x < CX ? -1 : 1);
    if (scene.cues.includes('wrongGrip')) wrongGrip(cv, x, hp.y);
    if (scene.tools.includes('runeLens')) runeReading(cv, x, hp.y, obs.inscription, obs.makersMark, kind);
  }
  // Webbed, the hand that holds no weapon opens to show it.
  const webbed = front && obs.webbing === 'webbed';
  for (const side of ['R', 'L'] as const) {
    const x = side === 'L' ? hp.L : hp.R;
    hand(cv, x, hp.y, front && (obs.grip === 'none' || (webbed && side !== weaponHand)), webbed);
    if (front && obs.nails === true && !scene.tools.includes('clippers')) claws(cv, x, hp.y);
    cv.sprite(x - 1, 113, GLYPHS[side] ?? [], { X: LABEL });
  }
  return cv;
}

// ---------- output ----------

/** Pixels as one path per palette colour, merged into rectangles. */
function toPaths(cv: Canvas): string {
  const rects = new Map<number, string[]>();
  let open = new Map<string, { x: number; y: number; w: number; h: number; color: number }>();
  const close = (r: { x: number; y: number; w: number; h: number; color: number }) => {
    const list = rects.get(r.color) ?? [];
    list.push(`M${r.x * GRID} ${r.y * GRID}h${r.w * GRID}v${r.h * GRID}h${-r.w * GRID}z`);
    rects.set(r.color, list);
  };
  for (let y = 0; y <= CH; y++) {
    const next = new Map<string, { x: number; y: number; w: number; h: number; color: number }>();
    if (y < CH) {
      let x = 0;
      while (x < CW) {
        const color = cv.get(x, y);
        let end = x + 1;
        while (end < CW && cv.get(end, y) === color) end++;
        if (color !== 0) {
          const key = `${color}:${x}:${end}`;
          const r = open.get(key);
          if (r) {
            r.h += 1;
            open.delete(key);
            next.set(key, r);
          } else next.set(key, { x, y, w: end - x, h: 1, color });
        }
        x = end;
      }
    }
    for (const r of open.values()) close(r);
    open = next;
  }
  return [...rects.entries()]
    .sort(([a], [b]) => a - b)
    .map(([color, d]) => `<path fill="${PALETTE[color]}" d="${d.join('')}"/>`)
    .join('');
}

const BACKDROP = [
  `<path fill="${PALETTE[WALL]}" d="M0 0h${W}v${H}h${-W}z"/>`,
  `<path fill="${PALETTE[WALL_DARK]}" d="M0 ${48 * GRID}h${W}v${GRID}h${-W}zM0 ${96 * GRID}h${W}v${GRID}h${-W}z"/>`,
  `<path fill="${PALETTE[FLOOR]}" d="M0 ${134 * GRID}h${W}v${6 * GRID}h${-W}z"/>`,
].join('');

function svg(cv: Canvas, viewBox: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" shape-rendering="crispEdges" role="img" aria-hidden="true">${BACKDROP}${toPaths(cv)}</svg>`;
}

function draw(scene: BodyScene): string {
  return svg(paint(scene), `0 0 ${W} ${H}`);
}

/** The head and shoulders, cropped on the pixel grid. */
function portrait(p: Portrait): string {
  return svg(paint(portraitScene(p)), '87 33 126 150');
}

export const pixelBody: BodyArtProvider = {
  id: 'pixel',
  frame: { w: W, h: H, grid: GRID },
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
