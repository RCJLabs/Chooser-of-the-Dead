import type { Content } from '@cots/engine';
import { JUDGING, PLAIN, type SceneTable, simulateRun } from '@cots/testkit';
import { type Band, quantile } from './summary';

/**
 * The bots' rings after each night (docs/tech-spec.md §63), for setting playtesters beside: `runs` runs of each
 * judging profile, paying every bill, playing the plain story. About a second and a half a run.
 */
export function botBands(
  content: Content,
  scenes: SceneTable | undefined,
  runs: number,
  names: readonly string[] = ['expert', 'competent', 'novice'],
): Band[] {
  return names.flatMap((name) => {
    const judging = JUDGING.find((j) => j.name === name);
    if (!judging || runs <= 0) return [];
    const byDay = new Map<number, number[]>();
    for (let i = 0; i < runs; i++) {
      const r = simulateRun(content, `playtest-bots-${i}`, judging, 'payAll', {
        story: PLAIN,
        ...(scenes ? { scenes } : {}),
      });
      for (const l of r.ledger) if (l.night) byDay.set(l.day, [...(byDay.get(l.day) ?? []), l.night.rings]);
    }
    const days = [...byDay].map(
      ([day, xs]) =>
        [day, { p25: quantile(xs, 0.25), median: quantile(xs, 0.5), p75: quantile(xs, 0.75), n: xs.length }] as const,
    );
    return [{ name, runs, byDay: new Map(days) }];
  });
}
