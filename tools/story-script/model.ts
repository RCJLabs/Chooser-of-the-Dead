import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import type { CompiledScene } from '@cots/content-compiler';
import type { Content, Destination, Effect, OriginPerk, StatePred } from '@cots/engine';
import { fnv1a32 } from '@cots/engine';
import { type Expr, flagsRead } from './expr';
import { parseScene, type Row } from './parse';

/*
 * The whole story as a script (docs/tech-spec.md §31): each day's scenes and
 * story souls in order, the endings, and an index of every story flag: which
 * scene, option or stamp sets it, and which scenes, endings and journal
 * threads react to it.
 */

const repoRoot = resolve(import.meta.dirname, '../..');

export interface SceneDoc {
  /** `scene.d9.night`. */
  readonly id: string;
  /** `d9.night`: the file name, and what `pnpm story:approve` takes. */
  readonly name: string;
  /** The `.ink` file, from the repository root. */
  readonly file: string;
  readonly day: number;
  readonly when: 'morning' | 'desk' | 'night';
  /** At the desk: once this many souls have been sent (docs/tech-spec.md §46). */
  readonly at?: number;
  /** A letter from home (docs/tech-spec.md §74): played after the day's own scene, on runs where `only` holds. */
  readonly letter?: boolean;
  readonly only?: StatePred;
  readonly draft: boolean;
  /** Ink's own count, as the writing budget uses. */
  readonly words: number;
  /** Changes whenever the source does, so a review can tell the scene was rewritten since. */
  readonly hash: string;
  readonly rows: readonly Row[];
  /** Flags the scene reads, in order of first use. */
  readonly reads: readonly string[];
  /** Flags the scene sets. */
  readonly sets: readonly string[];
}

/** A soul written for the story, as it comes to the gate. */
export interface SoulDoc {
  readonly id: string;
  readonly day: number;
  readonly name: string;
  readonly expect: Destination;
  /** What the soul says, in order. */
  readonly lines: readonly string[];
  readonly when?: StatePred;
  readonly onStamp: readonly { readonly stamped: Destination | '*'; readonly effects: readonly Effect[] }[];
  /** The favour someone at home asked about the soul (docs/tech-spec.md §74): who asked, and the desk's words. */
  readonly errand?: { readonly from: string; readonly text: string };
  /** What looking at the soul does (docs/tech-spec.md §74): an observation seen at the desk, and its effects. */
  readonly onSeen: readonly { readonly obs: string; readonly effects: readonly Effect[] }[];
}

export interface DayDoc {
  readonly day: number;
  /** The day's decree, as the morning shows it. */
  readonly decree: string;
  readonly morning?: SceneDoc;
  /** Scenes at the desk, between the souls, in the order they come (docs/tech-spec.md §46). */
  readonly desk?: readonly SceneDoc[];
  readonly night?: SceneDoc;
  /** Letters from home (docs/tech-spec.md §74), each after the morning's or the night's own scene. */
  readonly letters?: readonly SceneDoc[];
  readonly souls: readonly SoulDoc[];
}

/** Somewhere a flag is set or read. */
export interface Mention {
  readonly day?: number;
  /** "Day 9, night", "Ending: The green earth". */
  readonly where: string;
  /** The page anchor to link to. */
  readonly anchor: string;
  /** The option or stamp that sets it, or what a reader checks. */
  readonly detail?: string;
}

export interface FlagDoc {
  readonly name: string;
  readonly setBy: readonly Mention[];
  readonly readBy: readonly Mention[];
}

export interface EpilogueDoc {
  readonly id: string;
  readonly section: string;
  readonly when?: StatePred;
  readonly lines: readonly { readonly text: string; readonly when?: StatePred }[];
}

/** Who the chooser was in life (docs/tech-spec.md §72): what it gives, who it brings home, and its own scenes. */
export interface OriginDoc {
  readonly id: string;
  readonly name: string;
  readonly text: string;
  readonly perk: OriginPerk;
  /** Whoever the origin brings home, by the name the strings give them. */
  readonly member?: string;
  /** Its scenes in the order they're played, each after its day's own. */
  readonly scenes: readonly SceneDoc[];
}

export interface EndingDoc {
  readonly id: string;
  readonly title: string;
  readonly text: string;
  readonly when?: StatePred;
}

export interface ScriptModel {
  readonly target: string;
  /** Changes whenever any scene or story soul's words do. */
  readonly version: string;
  readonly days: readonly DayDoc[];
  readonly endings: readonly EndingDoc[];
  readonly flags: readonly FlagDoc[];
  /** Journal threads: what the journal lists as still in play, and when. */
  readonly threads: readonly { readonly text: string; readonly when: StatePred }[];
  /** The epilogue (docs/tech-spec.md §55): each slot's lines, and when each is said. */
  readonly epilogue: readonly EpilogueDoc[];
  /** The vertical slice's jump, when the build has one: the day it jumps to and the flags it sets. */
  readonly slice?: { readonly after: number; readonly day: number; readonly flags: readonly string[] };
  /** The forger's trail (docs/tech-spec.md §71), when the build has one. */
  readonly trail?: {
    readonly since: number;
    readonly when?: StatePred;
    readonly nights: readonly number[];
    readonly suspects: readonly { readonly name: string; readonly text: string; readonly hands: readonly string[] }[];
    readonly right: readonly Effect[];
    readonly wrong: readonly Effect[];
  };
  /** The origins a run of the full game can be begun with (docs/tech-spec.md §72); none in the demo. */
  readonly origins: readonly OriginDoc[];
  /** The family by id ("brother"), with the names the strings give them ("Ulf, your brother"). */
  readonly family: readonly { readonly id: string; readonly name: string }[];
  readonly strings: Readonly<Record<string, string>>;
  readonly totals: { readonly scenes: number; readonly drafts: number; readonly words: number };
}

export const sceneAnchor = (name: string) => `scene-${name.replace(/\./g, '-')}`;
export const lineAnchor = (name: string, line: number) => `${sceneAnchor(name)}-L${line}`;
export const flagAnchor = (flag: string) => `flag-${flag}`;
export const soulAnchor = (id: string) => `soul-${id.replace(/\./g, '-')}`;
export const endingAnchor = (id: string) => `ending-${id.replace(/\./g, '-')}`;

/** Every flag a run-state condition reads (`{ state: flags.wood, gte: 1 }`). */
export function stateFlags(p: StatePred): string[] {
  if ('all' in p) return p.all.flatMap(stateFlags);
  if ('any' in p) return p.any.flatMap(stateFlags);
  if ('not' in p) return stateFlags(p.not);
  return p.state.startsWith('flags.') ? [p.state.slice('flags.'.length)] : [];
}

/** Every condition a row checks (its option's, its branch's, its jump's, its line's inline ones). */
export function rowConditions(r: Row): Expr[] {
  switch (r.kind) {
    case 'choice':
    case 'jump':
      return r.cond ? [r.cond] : [];
    case 'if':
    case 'elif':
      return [r.cond];
    case 'line':
      return r.text.flatMap((s) => (typeof s === 'string' ? [] : [s.cond]));
    default:
      return [];
  }
}

const unique = <T>(xs: readonly T[]) => [...new Set(xs)];

/** An observation's key in words: `woundsBack` is "wounds back". */
export const obsWords = (key: string) => key.replace(/([A-Z])/g, ' $1').toLowerCase();

/** Builds the script from a compiled build and the scenes' sources. */
export function buildModel(build: {
  readonly content: Content;
  readonly strings: Readonly<Record<string, string>>;
  readonly scenes: readonly CompiledScene[];
  readonly target: string;
}): ScriptModel {
  const { content, strings } = build;
  const t = (key: string) => strings[key] ?? key;
  const byId = new Map(build.scenes.map((s) => [s.id, s]));
  const scripted = new Map((content.scripted ?? []).map((c) => [c.id, c]));

  const sceneDoc = (id: string | undefined, day: number, when: SceneDoc['when'], at?: number): SceneDoc | undefined => {
    if (!id) return undefined;
    const compiled = byId.get(id);
    if (!compiled) throw new Error(`Day ${day} plays ${id}, which this build doesn't have`);
    const source = readFileSync(compiled.file, 'utf8');
    const file = relative(repoRoot, compiled.file);
    const parsed = parseScene(source, file);
    const reads = unique(parsed.rows.flatMap((r) => rowConditions(r).flatMap(flagsRead)));
    const sets = unique(
      parsed.rows.flatMap((r) =>
        r.kind === 'effects' || r.kind === 'line' ? r.effects.flatMap((e) => ('flag' in e ? [e.flag] : [])) : [],
      ),
    );
    return {
      id,
      name: id.replace(/^scene\./, ''),
      file,
      day,
      when,
      ...(at !== undefined ? { at } : {}),
      draft: parsed.draft,
      words: compiled.words,
      hash: fnv1a32(source).toString(36),
      rows: parsed.rows,
      reads,
      sets,
    };
  };

  // Someone in the household by id, by the name used inside a sentence ("Ulf" rather than "Ulf, your brother").
  const household = [
    ...(content.campaign?.family ?? []),
    ...(content.campaign?.origins ?? []).flatMap((o) => o.member ?? []),
  ];
  const shortName = (id: string) => {
    const key = household.find((m) => m.id === id)?.name ?? id;
    return strings[`${key}.short`] ?? t(key);
  };
  const letters = content.campaign?.letters ?? [];

  const days: DayDoc[] = content.days
    .filter(
      (d) =>
        d.scenes ||
        (d.queue.scripted ?? []).length > 0 ||
        (d.queue.visits ?? []).length > 0 ||
        letters.some((l) => l.day === d.day),
    )
    .map((d) => {
      const morning = sceneDoc(d.scenes?.morning, d.day, 'morning');
      const desk = [...(d.queue.visits ?? [])]
        .sort((a, b) => a.at - b.at)
        .flatMap((v) => sceneDoc(v.scene, d.day, 'desk', v.at) ?? []);
      const night = sceneDoc(d.scenes?.night, d.day, 'night');
      // Letters from home (docs/tech-spec.md §74), the morning's before the night's, each in the order it's sent.
      const sent = [
        ...letters.filter((l) => l.day === d.day && l.at === 'morning'),
        ...letters.filter((l) => l.day === d.day && l.at === 'night'),
      ].flatMap((l) => {
        const doc = sceneDoc(l.scene, d.day, l.at);
        return doc ? [{ ...doc, letter: true, ...(l.when ? { only: l.when } : {}) }] : [];
      });
      const souls = (d.queue.scripted ?? []).map(({ case: id }): SoulDoc => {
        const c = scripted.get(id);
        if (!c) throw new Error(`Day ${d.day} places ${id}, which this build doesn't have`);
        const name = `${c.look.name} ${c.look.patronym}`;
        return {
          id,
          day: d.day,
          name,
          expect: c.expect,
          lines: (c.lines ?? []).map(t),
          ...(c.when ? { when: c.when } : {}),
          onStamp: c.onStamp ?? [],
          ...(c.errand
            ? {
                errand: {
                  from: shortName(c.errand.from),
                  text: t(c.errand.text)
                    .replace(/\{from\}/g, shortName(c.errand.from))
                    .replace(/\{name\}/g, name),
                },
              }
            : {}),
          onSeen: c.onSeen ?? [],
        };
      });
      return {
        day: d.day,
        decree: t(d.decree),
        ...(morning ? { morning } : {}),
        ...(desk.length > 0 ? { desk } : {}),
        ...(night ? { night } : {}),
        ...(sent.length > 0 ? { letters: sent } : {}),
        souls,
      };
    })
    .sort((a, b) => a.day - b.day);

  const origins: OriginDoc[] = (content.campaign?.origins ?? []).map((o) => ({
    id: o.id,
    name: t(o.name),
    text: t(o.text),
    perk: o.perk,
    ...(o.member ? { member: t(o.member.name) } : {}),
    scenes: [...o.scenes]
      .sort((a, b) => a.day - b.day || (a.at === b.at ? 0 : a.at === 'morning' ? -1 : 1))
      .flatMap((sc) => sceneDoc(sc.scene, sc.day, sc.at) ?? []),
  }));

  const endings: EndingDoc[] = [...(content.campaign?.endings ?? [])]
    .sort((a, b) => a.order - b.order)
    .map((e) => ({ id: e.id, title: t(e.title), text: t(e.text), ...(e.when ? { when: e.when } : {}) }));

  // The flag index: every place a flag is set or read.
  const set = new Map<string, Mention[]>();
  const read = new Map<string, Mention[]>();
  // A reader is listed once per place (its first line); a setter once per option or stamp that sets it.
  const add = (map: Map<string, Mention[]>, flag: string, m: Mention) => {
    const list = map.get(flag) ?? [];
    const same = (x: Mention) =>
      x.where === m.where && x.detail === m.detail && (map === read || x.anchor === m.anchor);
    if (!list.some(same)) list.push(m);
    map.set(flag, list);
  };
  const dayName = (s: SceneDoc) =>
    `Day ${s.day}, ${s.when === 'desk' ? 'at the desk' : s.when}${s.letter ? ' (a letter from home)' : ''}`;
  const indexScene = (s: SceneDoc, where: string) => {
    // The options open at each depth, so a setter can say which choice it follows.
    const path: string[] = [];
    for (const r of s.rows) {
      if (r.kind === 'choice') {
        path.length = r.depth - 1;
        path.push(r.text);
      } else if (r.kind === 'gather') path.length = r.depth - 1;
      else if (r.kind === 'part') path.length = 0;
      for (const f of rowConditions(r).flatMap(flagsRead)) {
        add(read, f, { day: s.day, where, anchor: lineAnchor(s.name, r.line) });
      }
      if (r.kind === 'effects' || r.kind === 'line') {
        for (const e of r.effects) {
          if (!('flag' in e)) continue;
          const detail = path.length > 0 ? path.map((p) => `“${p}”`).join(' → ') : undefined;
          add(set, e.flag, { day: s.day, where, anchor: lineAnchor(s.name, r.line), ...(detail ? { detail } : {}) });
        }
      }
    }
  };

  for (const d of days) {
    for (const s of [d.morning, ...(d.desk ?? []), d.night, ...(d.letters ?? [])]) if (s) indexScene(s, dayName(s));
    // A letter is sent only on runs its condition holds for (docs/tech-spec.md §74).
    for (const s of d.letters ?? []) {
      for (const f of s.only ? stateFlags(s.only) : []) {
        add(read, f, { day: d.day, where: dayName(s), anchor: sceneAnchor(s.name), detail: 'sent only if' });
      }
    }
    for (const soul of d.souls) {
      // What looking at the soul does (docs/tech-spec.md §74).
      for (const on of soul.onSeen) {
        for (const e of on.effects) {
          if (!('flag' in e)) continue;
          add(set, e.flag, {
            day: d.day,
            where: `Day ${d.day}, ${soul.name}`,
            anchor: soulAnchor(soul.id),
            detail: `looked at: ${obsWords(on.obs)}`,
          });
        }
      }
      for (const on of soul.onStamp) {
        for (const e of on.effects) {
          if (!('flag' in e)) continue;
          add(set, e.flag, {
            day: d.day,
            where: `Day ${d.day}, ${soul.name}`,
            anchor: soulAnchor(soul.id),
            detail: on.stamped === '*' ? 'judged, whatever the stamp' : `stamped ${on.stamped}`,
          });
        }
      }
      for (const f of soul.when ? stateFlags(soul.when) : []) {
        add(read, f, {
          day: d.day,
          where: `Day ${d.day}, ${soul.name}`,
          anchor: soulAnchor(soul.id),
          detail: 'comes to the gate only if',
        });
      }
    }
  }
  // An origin's scenes (docs/tech-spec.md §72), played only in runs begun with it.
  for (const o of origins) for (const s of o.scenes) indexScene(s, `${dayName(s)} (${o.name})`);
  const slice = content.campaign?.slice;
  for (const f of Object.keys(slice?.preset.flags ?? {})) {
    add(set, f, {
      ...(slice ? { day: slice.day } : {}),
      where: `The vertical slice's jump to Day ${slice?.day}`,
      anchor: 'slice',
      detail: 'stands in for the skipped days',
    });
  }
  // A reprieve sets its flag (docs/tech-spec.md §56), the night a debt would have ended the run.
  const reprieve = content.campaign?.reprieve;
  if (reprieve) {
    add(set, reprieve.flag, {
      where: 'The reprieve',
      anchor: 'endings',
      detail: 'the first night a debt would have ended the run',
    });
  }
  // The forger's trail (docs/tech-spec.md §71): the board opens while its `when` holds, and naming a carver sets flags.
  const trail = content.campaign?.trail;
  if (trail) {
    for (const f of trail.when ? stateFlags(trail.when) : []) {
      add(read, f, {
        day: trail.since,
        where: 'The forger’s trail',
        anchor: 'trail',
        detail: 'the board opens only if',
      });
    }
    const named = [
      ['naming the right carver', trail.right],
      ['naming another carver', trail.wrong],
    ] as const;
    for (const [detail, effects] of named) {
      for (const e of effects) {
        if ('flag' in e) add(set, e.flag, { where: 'The forger’s trail', anchor: 'trail', detail });
      }
    }
  }
  for (const e of endings) {
    for (const f of e.when ? stateFlags(e.when) : []) {
      add(read, f, { where: `Ending: ${e.title}`, anchor: endingAnchor(e.id) });
    }
  }
  for (const th of content.campaign?.threads ?? []) {
    const fs = [...stateFlags(th.when), ...(th.count?.startsWith('flags.') ? [th.count.slice(6)] : [])];
    for (const f of fs) {
      add(read, f, {
        where: `Journal thread: ${t(th.text).replace(/\{n\}/g, 'N')}`,
        anchor: 'threads',
      });
    }
  }
  // The epilogue (docs/tech-spec.md §55): each line reads the flags its condition names, and its slot's.
  for (const slot of content.campaign?.epilogue?.slots ?? []) {
    for (const line of slot.lines) {
      const fs = unique([...(slot.when ? stateFlags(slot.when) : []), ...(line.when ? stateFlags(line.when) : [])]);
      for (const f of fs) add(read, f, { where: `Epilogue: ${t(line.text)}`, anchor: 'epilogue' });
    }
  }
  const flags: FlagDoc[] = unique([...set.keys(), ...read.keys()])
    .sort()
    .map((name) => ({ name, setBy: set.get(name) ?? [], readBy: read.get(name) ?? [] }));

  const scenes = [
    ...days.flatMap((d) =>
      [d.morning, ...(d.desk ?? []), d.night, ...(d.letters ?? [])].filter((s): s is SceneDoc => s !== undefined),
    ),
    ...origins.flatMap((o) => o.scenes),
  ];
  const souls = days.flatMap((d) => d.souls);
  const version = fnv1a32([...scenes.map((s) => s.hash), ...souls.flatMap((s) => s.lines)].join('|')).toString(36);
  return {
    target: build.target,
    version,
    days,
    endings,
    flags,
    threads: (content.campaign?.threads ?? []).map((th) => ({ text: t(th.text), when: th.when })),
    epilogue: (content.campaign?.epilogue?.slots ?? []).map((s) => ({
      id: s.id,
      section: s.section,
      ...(s.when ? { when: s.when } : {}),
      lines: s.lines.map((l) => ({ text: t(l.text), ...(l.when ? { when: l.when } : {}) })),
    })),
    ...(slice ? { slice: { after: slice.after, day: slice.day, flags: Object.keys(slice.preset.flags ?? {}) } } : {}),
    ...(trail
      ? {
          trail: {
            since: trail.since,
            ...(trail.when ? { when: trail.when } : {}),
            nights: trail.nights,
            suspects: trail.suspects.map((s) => ({
              name: `${s.look.name} ${s.look.patronym}`,
              text: t(s.text),
              hands: s.hands.map((h) => t(`trail.hand.${h}`)),
            })),
            right: trail.right,
            wrong: trail.wrong,
          },
        }
      : {}),
    origins,
    // The family, and whoever an origin brings home (docs/tech-spec.md §72).
    family: household.map((m) => ({ id: m.id, name: t(m.name) })),
    strings,
    totals: {
      scenes: scenes.length,
      drafts: scenes.filter((s) => s.draft).length,
      words: scenes.reduce((n, s) => n + s.words, 0),
    },
  };
}
