import type { Content, FamilyDef, OriginDef, OriginScene } from '../content/types';
import type { FamilyMember, RunState } from './state';

/*
 * Who the chooser was in life (docs/tech-spec.md §72): picked for a new run of the full game and kept with it. Each
 * origin gives a perk that only ever changes speed or money (docs/roadmap.md), brings someone to the household beside
 * the family every run has, and has scenes of its own, each played after one of the day's own. A run begun without
 * one, and every run in a build without them, plays as before.
 */

/** The run's origin, if it was begun with one this build knows. */
export function originOf(run: Pick<RunState, 'origin'>, content: Content): OriginDef | undefined {
  return run.origin === undefined ? undefined : content.campaign?.origins?.find((o) => o.id === run.origin);
}

/** The household the run began with: the family every run has, and whoever its origin brings. */
export function familyDefs(run: Pick<RunState, 'origin'>, content: Content): FamilyDef[] {
  const member = originOf(run, content)?.member;
  return [...(content.campaign?.family ?? []), ...(member ? [member] : [])];
}

/**
 * The household the purse feeds tonight: everyone at home but those who keep themselves while they're well (someone
 * an origin brings, docs/tech-spec.md §72).
 */
export function fedAtHome(run: Pick<RunState, 'origin' | 'family'>, content: Content): FamilyMember[] {
  const keep = new Set(familyDefs(run, content).flatMap((f) => (f.ownKeep ? [f.id] : [])));
  return run.family.filter((m) => m.status !== 'gone' && !(m.status === 'well' && keep.has(m.id)));
}

/** One of the household by id, whichever run it's in: the family, or someone an origin brings (ids never repeat). */
export function memberDef(content: Content, id: string): FamilyDef | undefined {
  const campaign = content.campaign;
  return (
    (campaign?.family ?? []).find((m) => m.id === id) ?? campaign?.origins?.find((o) => o.member?.id === id)?.member
  );
}

/**
 * The scenes the run plays on the morning or night of its day, in order: the day's own, then its origin's for then.
 * Each is played once, so what's still to play is the first of these not yet played.
 */
export function scenesFor(run: Pick<RunState, 'origin' | 'day'>, content: Content, at: 'morning' | 'night'): string[] {
  const own = content.days.find((d) => d.day === run.day)?.scenes?.[at];
  const origin = (originOf(run, content)?.scenes ?? []).filter((s: OriginScene) => s.day === run.day && s.at === at);
  return [...(own ? [own] : []), ...origin.map((s) => s.scene)];
}
