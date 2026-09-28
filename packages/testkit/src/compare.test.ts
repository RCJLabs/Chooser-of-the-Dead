import { campaignOf } from '@cots/engine';
import { describe, expect, it } from 'vitest';
import { JUDGING } from './campaign-sim';
import { applyOverrides, compareProfile, comparisonText, paired, parseOverride } from './compare';
import { loadContent } from './content';

const demo = loadContent('web-demo');
const expert = JUDGING[0] ?? JUDGING.at(-1);
if (!expert) throw new Error('no bots');
const change = (...texts: string[]) => applyOverrides(demo, texts.map(parseOverride));

describe('changes to the content', () => {
  it('reads a path, how it changes and what to', () => {
    expect(parseOverride('campaign.minSunS=90')).toEqual({ path: 'campaign.minSunS', op: '=', value: 90 });
    expect(parseOverride(' days[*].sunS += 30 ')).toEqual({ path: 'days[*].sunS', op: '+=', value: 30 });
    expect(parseOverride('days[*]*=2')).toEqual({ path: 'days[*]', op: '*=', value: 2 });
    expect(parseOverride('campaign.debtFloor-=10')).toEqual({ path: 'campaign.debtFloor', op: '-=', value: 10 });
    expect(parseOverride('days[4].economy.fines=[5,10]').value).toEqual([5, 10]);
    expect(parseOverride('campaign.finale=ending.x').value).toBe('ending.x');
    expect(() => parseOverride('campaign.minSunS')).toThrow(/isn't a change/);
    expect(() => parseOverride('campaign.minSunS=')).toThrow(/isn't a change/);
    expect(() => parseOverride('campaign.finale+=x')).toThrow(/\+= takes a number/);
    expect(() => parseOverride('campaign..minSunS=1')).toThrow(/isn't a path/);
    expect(() => parseOverride('days[.sunS=1')).toThrow(/isn't a path/);
  });

  it('changes a copy, and says what each change did', () => {
    const { content, changes } = change('campaign.minSunS=90', 'sun.question-=5', 'days[2].sunS+=30');
    expect(changes).toEqual([
      { by: 0, at: 'campaign.minSunS', from: 120, to: 90 },
      { by: 1, at: 'sun.question', from: 20, to: 15 },
      { by: 2, at: 'days[2].sunS', from: demo.days[1]?.sunS, to: (demo.days[1]?.sunS ?? 0) + 30 },
    ]);
    expect(campaignOf(content).minSunS).toBe(90);
    // The content as built is left alone.
    expect(campaignOf(demo).minSunS).toBe(120);
    expect(demo.days[1]?.sunS).not.toBe(content.days[1]?.sunS);
  });

  it('picks list items by id, by day, by index, or all of them', () => {
    const [upgrade] = campaignOf(demo).shop;
    if (!upgrade) throw new Error('no upgrade');
    expect(change(`campaign.shop[${upgrade.id}].price*=2`).changes).toEqual([
      { by: 0, at: `campaign.shop[${upgrade.id}].price`, from: upgrade.price, to: upgrade.price * 2 },
    ]);
    expect(change('campaign.draupnir.nights[1]=12').changes).toEqual([
      { by: 0, at: 'campaign.draupnir.nights[1]', from: 18, to: 12 },
    ]);
    const wages = change('days[*].economy.wage*=1.5');
    expect(wages.changes.map((c) => c.at)).toEqual(demo.days.map((d) => `days[${d.day}].economy.wage`));
    for (const c of wages.changes) expect(c.to).toBe(Math.round((c.from as number) * 1.5));
  });

  it('refuses a place that isn’t there, or a value of another kind', () => {
    expect(() => change('campaign.startRing=5')).toThrow(/campaign has no "startRing" \(it has lastDay, .*startRings/);
    expect(() => change('days[9].sunS=5')).toThrow(/days has no \[9\]: it has 1, 2, 3/);
    expect(() => change('campaign.shop[0].price=5')).toThrow(/has no \[0\]: it has up\./);
    expect(() => change('campaign[1]=5')).toThrow(/campaign isn't a list/);
    expect(() => change('sun.question=fast')).toThrow(/sun.question is a number, not a string/);
    expect(() => change('campaign.draupnir.nights+=1')).toThrow(/is a list: \+= needs a number/);
    expect(() => change('campaign.minSunS=90.5')).toThrow(/takes whole numbers/);
  });
});

describe('paired differences', () => {
  it('gives the mean difference and its 95% interval', () => {
    const d = paired([1, 2, 3, 4], [2, 4, 4, 6]);
    expect(d).toMatchObject({ n: 4, base: 2.5, variant: 4, diff: 1.5, noise: false });
    // sd of [1, 2, 1, 2] is √(1/3); 1.96 × that ÷ √4.
    expect(d.hi - d.diff).toBeCloseTo((1.96 * Math.sqrt(1 / 3)) / 2, 10);
    expect(paired([1, 2, 3], [3, 1, 3]).noise).toBe(true);
    expect(paired([5, 5], [5, 5])).toMatchObject({ diff: 0, lo: 0, hi: 0, noise: true });
    expect(paired([1], [2]).lo).toBe(Number.NEGATIVE_INFINITY);
  });
});

describe('comparing the bots’ runs', () => {
  const options = { seeds: 4, nights: [3] };

  it('finds nothing to compare when the bots never meet the change', () => {
    // The bots never question a soul, so what questioning costs never touches their runs.
    const { content } = change('sun.question=5');
    const c = compareProfile(demo, content, expert, 'payAll', options);
    expect(c.changed).toBe(0);
    expect(comparisonText(c)).toContain('Nothing changed');
  });

  it('measures what a change moves, run for run', () => {
    const { content } = change('campaign.startRings+=50');
    const c = compareProfile(demo, content, expert, 'payAll', options);
    expect(c).toMatchObject({ judging: 'expert', strategy: 'payAll', runs: 4, changed: 4 });
    const end = c.metrics.find((m) => m.metric.key === 'rings')?.diff;
    expect(end?.diff).toBeGreaterThan(40);
    expect(end?.noise).toBe(false);
    expect(c.metrics.find((m) => m.metric.key === 'demoted')?.diff).toMatchObject({ diff: 0, noise: true });
    const text = comparisonText(c);
    expect(text).toMatch(/^expert · payAll: 4 pairs of runs, 4 changed$/m);
    expect(text).toMatch(/^ {2}rings at the end +\d+\.\d +\d+\.\d +\+\d+\.\d {2}\(\+[\d.]+ to \+[\d.]+\)$/m);
    expect(text).toMatch(/^ {2}demoted +0\.0% +0\.0% +same$/m);
    expect(text).toContain('Endings: the same.');
  });

  it('says which run a broken variant broke', () => {
    expect(() => compareProfile(demo, { ...demo, days: [] }, expert, 'payAll', options)).toThrow(
      /The variant broke run c0 \(expert, payAll\): No day spec for day 1/,
    );
  });
});
