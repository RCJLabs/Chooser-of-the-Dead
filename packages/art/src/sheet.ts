import type { Content, Look, ObservationDef, Salience, ToolId, Value } from '@cots/engine';
import type { BodyArtProvider, BodyScene, BodyView, Hotspot } from './contract';

/**
 * A comparison sheet of body-art providers (docs/tech-spec.md §6.5, the M5
 * art decision): every body sign in every value, drawn by each provider at
 * the size a small phone shows the body and through a 3x loupe, plus a few
 * whole souls and thumbnails. Pure string building, so the Body Lab and the
 * `pnpm art:sheet` page share it.
 */

export interface Sign {
  /** Observation or cue key. */
  readonly key: string;
  /** A body observation, a cue, or the weapon the soul's words name (a look, not a sign). */
  readonly kind: 'obs' | 'cue' | 'weapon';
  /** Observation values, [false, true] for a cue shown or not, or weapon words. */
  readonly values: readonly Value[];
  readonly view: BodyView;
  readonly salience: Salience;
  /** Drawn only once this tool has been used (the feather, the rune-lens). */
  readonly tool?: ToolId;
}

/** A body that shows nothing in particular, so each row differs only in the sign it shows. */
export const PLAIN_OBS: Readonly<Record<string, Value>> = {
  grip: 'weapon',
  gripHand: 'right',
  woundsFront: 0,
  skin: 'normal',
  lips: 'normal',
  hair: 'dark',
  ornament: 'none',
  woundsBack: 0,
  breath: 'still',
};

export const PLAIN_LOOK: Look = {
  gender: 'm',
  name: 'Toki',
  patronym: 'Ulfsson',
  age: 34,
  build: 'broad',
  beard: 'short',
};

/** Every value an observation can show. */
export function signValues(o: ObservationDef, content: Pick<Content, 'facts'>): Value[] {
  if ('map' in o.from) return [...new Set([...o.from.map.map((m) => m.value), o.from.otherwise])];
  const id = o.from.fact;
  const fact = content.facts.find((f) => f.id === id);
  if (!fact) return [];
  const d = fact.domain;
  if (d.kind === 'enum') return [...d.values];
  if (d.kind === 'bool') return [false, true];
  return Array.from({ length: d.max - d.min + 1 }, (_, i) => d.min + i);
}

/** The body signs in some content: observations read off the body (not documents) and cues. */
export function bodySigns(content: Pick<Content, 'facts' | 'observations' | 'cues'>): Sign[] {
  return [
    ...content.observations
      .filter((o) => o.doc === undefined)
      .map(
        (o): Sign => ({
          key: o.key,
          kind: 'obs',
          values: signValues(o, content),
          view: o.view,
          salience: o.salience,
          ...(o.tool ? { tool: o.tool } : {}),
        }),
      ),
    ...content.cues.map(
      (c): Sign => ({ key: c.key, kind: 'cue', values: [false, true], view: c.view, salience: c.salience }),
    ),
  ];
}

/** The weapons the art draws, as a row of the sheet: what a soul holds follows what it says it held. */
export const WEAPON_SIGN: Sign = {
  key: 'weapon',
  kind: 'weapon',
  values: ['axe', 'sword', 'spear', 'seax'],
  view: 'front',
  salience: 3,
};

/**
 * What else a body shows for a sign to be seen: a seal's webbing is drawn on an open hand, so its row's souls hold
 * no weapon, and the loupe over the right hand finds it open.
 */
const SHOWN_WITH: Readonly<Record<string, Readonly<Record<string, Value>>>> = { webbing: { grip: 'none' } };

export function signScene(sign: Sign, value: Value, look: Look = PLAIN_LOOK): BodyScene {
  const shown = sign.kind === 'cue' && value === true;
  return {
    view: sign.view,
    look,
    obs: sign.kind === 'obs' ? { ...PLAIN_OBS, ...SHOWN_WITH[sign.key], [sign.key]: value } : PLAIN_OBS,
    cues: shown ? [sign.key] : [],
    tools: sign.tool ? [sign.tool] : [],
    ...(sign.kind === 'weapon' ? { weapon: String(value) } : {}),
  };
}

/** The screen a sheet imitates: the body stage's size in CSS pixels and the device's pixel ratio. */
export interface Screen {
  readonly name: string;
  readonly stageW: number;
  readonly stageH: number;
  readonly dpr: number;
}

/** The body stage on a 360x740 phone in portrait (measured in M5: 360x232 CSS px at 3x). */
export const SMALL_PHONE: Screen = { name: '360x740 phone', stageW: 360, stageH: 232, dpr: 3 };

/** The CSS size the body is drawn at on a screen: fit to the stage, in whole device pixels for pixel art. */
export function fitFrame(frame: BodyArtProvider['frame'], screen: Screen): { w: number; h: number } {
  if (frame.grid) {
    const cols = frame.w / frame.grid;
    const rows = frame.h / frame.grid;
    const k = Math.max(
      1,
      Math.floor(Math.min((screen.stageW * screen.dpr) / cols, (screen.stageH * screen.dpr) / rows)),
    );
    return { w: (k * cols) / screen.dpr, h: (k * rows) / screen.dpr };
  }
  const s = Math.min(screen.stageW / frame.w, screen.stageH / frame.h);
  return { w: frame.w * s, h: frame.h * s };
}

const px = (n: number) => `${Math.round(n * 10) / 10}px`;

/** An SVG document at a CSS size, optionally cropped to a region of its frame. */
function sized(svg: string, w: number, h: number, crop?: { x: number; y: number; w: number; h: number }): string {
  const viewBoxed = crop ? svg.replace(/viewBox="[^"]*"/, `viewBox="${crop.x} ${crop.y} ${crop.w} ${crop.h}"`) : svg;
  return `<div class="art" style="width:${px(w)};height:${px(h)}">${viewBoxed}</div>`;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The hotspot showing a key, padded a little and kept inside the frame. */
function regionOf(art: BodyArtProvider, scene: BodyScene, key: string): Hotspot | undefined {
  return art.hotspots(scene).find((h) => h.keys.includes(key));
}

function loupe(art: BodyArtProvider, scene: BodyScene, key: string, scale: number, zoom: number): string {
  const spot = regionOf(art, scene, key);
  if (!spot) return '';
  const pad = art.frame.w * 0.03;
  const x = Math.max(0, spot.x - pad);
  const y = Math.max(0, spot.y - pad);
  const w = Math.min(art.frame.w - x, spot.w + 2 * pad);
  const h = Math.min(art.frame.h - y, spot.h + 2 * pad);
  return sized(art.draw(scene), w * scale * zoom, h * scale * zoom, { x, y, w, h });
}

export interface SheetOptions {
  readonly screen?: Screen;
  /** Loupe magnification over the phone size. */
  readonly zoom?: number;
  /** How a sign's value reads (e.g. from the string table). */
  readonly label?: (sign: Sign, value: Value) => string;
  /** A few whole souls to compare style on. */
  readonly souls?: readonly BodyScene[];
}

const defaultLabel = (sign: Sign, value: Value) =>
  sign.kind === 'cue'
    ? `${sign.key}: ${value ? 'shown' : 'absent'}`
    : sign.kind === 'weapon'
      ? `"my ${String(value)}"`
      : `${sign.key}: ${String(value)}`;

/** The comparison sheet as an HTML fragment (style with SHEET_CSS). */
export function artSheet(
  providers: readonly BodyArtProvider[],
  signs: readonly Sign[],
  opts: SheetOptions = {},
): string {
  const screen = opts.screen ?? SMALL_PHONE;
  const zoom = opts.zoom ?? 3;
  const label = opts.label ?? defaultLabel;
  const out: string[] = [];

  out.push('<section class="sheet__souls"><h2>Whole souls</h2>');
  out.push(
    `<p class="sheet__note">Each at the size a ${esc(screen.name)} shows the body, then as a 64px thumbnail. Pixel art is letterboxed to whole device pixels.</p>`,
  );
  for (const art of providers) {
    out.push(`<div class="sheet__row"><h3>${esc(art.id)}</h3><div class="sheet__cells">`);
    const size = fitFrame(art.frame, screen);
    for (const scene of opts.souls ?? []) out.push(`<figure>${sized(art.draw(scene), size.w, size.h)}</figure>`);
    for (const scene of opts.souls ?? []) {
      out.push(`<figure>${sized(art.draw(scene), (64 * art.frame.w) / art.frame.h, 64)}</figure>`);
    }
    for (const hair of ['dark', 'fair', 'red', 'grey']) {
      out.push(
        `<figure>${sized(art.portrait({ gender: hair === 'red' ? 'f' : 'm', hair, beard: hair === 'red' ? 'none' : 'long', build: 'broad' }), 96, 112)}<figcaption>portrait</figcaption></figure>`,
      );
    }
    out.push('</div></div>');
  }
  out.push('</section>');

  for (const sign of signs) {
    out.push(
      `<section class="sheet__sign" id="sign-${esc(sign.key)}"><h2>${esc(sign.key)} <small>salience ${sign.salience} · ${sign.view}${sign.tool ? ` · after ${esc(sign.tool)}` : ''}</small></h2>`,
    );
    for (const art of providers) {
      const size = fitFrame(art.frame, screen);
      const scale = size.w / art.frame.w;
      out.push(`<div class="sheet__row"><h3>${esc(art.id)}</h3><div class="sheet__cells">`);
      for (const value of sign.values) {
        const scene = signScene(sign, value);
        const region = sign.kind === 'weapon' ? 'grip' : sign.key;
        out.push(
          `<figure>${sized(art.draw(scene), size.w, size.h)}${loupe(art, scene, region, scale, zoom)}<figcaption>${esc(label(sign, value))}</figcaption></figure>`,
        );
      }
      out.push('</div></div>');
    }
    out.push('</section>');
  }
  return out.join('');
}

export const SHEET_CSS = `
.sheet__souls, .sheet__sign { margin: 0 0 2rem; }
.sheet__sign h2 small, .sheet__note { font-weight: normal; color: var(--sheet-muted, #6b5f4f); font-size: 0.85rem; }
.sheet__row { display: grid; grid-template-columns: 7rem 1fr; gap: 0.5rem; align-items: start; border-top: 1px solid var(--sheet-line, #d8ccb4); padding: 0.5rem 0; }
.sheet__row h3 { margin: 0; font-size: 0.9rem; }
.sheet__cells { display: flex; flex-wrap: wrap; gap: 0.75rem; align-items: flex-end; }
.sheet__cells figure { margin: 0; display: flex; flex-direction: column; align-items: center; gap: 0.25rem; }
.sheet__cells figcaption { font-size: 0.75rem; max-width: 12rem; text-align: center; }
.sheet__cells .art { background: #e9dfc8; display: flex; }
.sheet__cells .art svg { display: block; width: 100%; height: 100%; }
@media (max-width: 600px) { .sheet__row { grid-template-columns: 1fr; } }
`;
