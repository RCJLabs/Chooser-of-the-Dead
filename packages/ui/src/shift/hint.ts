import { type HotspotId, REGION_KEYS } from '@cots/art';
import { type Field, runRules, type ShiftState } from '@cots/engine';
import type { Session } from '../store';

/*
 * Skögul's hint (docs/tech-spec.md §26): the engine picks the piece of deciding evidence to point at;
 * this says where it is (her line) and what to highlight until the player has looked.
 */

/**
 * Hints are for shifts with a sun or a story: not the primer (the coach guides it), a campaign run under the oath
 * (docs/tech-spec.md §49), or Endless (a score), unless the run took Skögul's hints as a boon (§68).
 */
export const hintsAllowed = (s: Session): boolean => {
  if (s.mode.kind === 'endless') {
    return s.state.config.mods?.hints !== undefined && runRules(s.content, s.mode.picks ?? []).hints > 0;
  }
  return s.mode.kind !== 'primer' && s.state.config.oath !== true;
};

/** Where Skögul points for a piece of evidence: her line's string key, and what to highlight. */
export function hintTarget(f: Field, state: ShiftState): { readonly text: string; readonly focus: string } {
  // A reading taken with a tool (the feather, the rune-lens, the registry) starts with the tool.
  if (f.tool && f.tool !== 'flip') return { text: `ui.hint.${f.tool}`, focus: f.tool };
  if (f.item === 'testimony') return { text: 'ui.hint.words', focus: 'words' };
  if (f.item === 'huginn' || f.item === 'muninn') return { text: 'ui.hint.ravens', focus: 'ravens' };
  if (f.item === 'tally') return { text: 'ui.hint.tally', focus: 'tally' };
  // A sign on the body: the region it's under, turning the body over first when it's on the other side.
  const key = f.obs?.key ?? f.cue?.key ?? '';
  const region = (Object.keys(REGION_KEYS) as HotspotId[]).find((id) => REGION_KEYS[id].includes(key));
  const name = region === 'handR' || region === 'handL' ? 'hands' : (region ?? 'hands');
  const turn = (f.view ?? 'front') !== state.soul.view;
  return { text: `ui.hint.${name}`, focus: turn ? `flip ${name}` : name };
}

/** What to highlight for the last thing Skögul pointed at, until the player has looked at it. */
export function pendingHintFocus(state: ShiftState): string | undefined {
  const c = state.cases[state.cursor];
  const id = [...(state.soul.hinted ?? [])].reverse().find((h) => !state.soul.seen.includes(h));
  const f = id ? c?.evidence.fields.find((x) => x.id === id) : undefined;
  return f ? hintTarget(f, state).focus : undefined;
}
