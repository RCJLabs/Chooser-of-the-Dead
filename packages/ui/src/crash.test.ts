import { beforeEach, describe, expect, it } from 'vitest';
import {
  forgetProblems,
  isOursError,
  isOursRejection,
  messageOf,
  noteProblem,
  type ProblemContext,
  problemUrl,
  seenBefore,
  stackOf,
} from './crash';

const ORIGIN = 'https://rcjlabs.github.io';
const ctx: ProblemContext = {
  build: 'web-demo · abc1234 · content 5f3e',
  where: 'shift · Daily #91 · day 1 · soul 3 of 8',
  device: { ua: 'test', w: 412, h: 915, dpr: 2, lang: 'en' },
  now: new Date('2027-03-01T12:00:00Z'),
};

/** How long a report's link would be, untrimmed. */
const issueLength = (r: object) => `template=problem-report.yml&report=${encodeURIComponent(JSON.stringify(r))}`.length;

/** An error thrown from the game's own script. */
function ours(message: string): Error {
  const e = new Error(message);
  e.stack = `Error: ${message}\n    at judge (${ORIGIN}/Chooser-of-the-Dead/assets/store-abc.js:1:2345)\n    at x (${ORIGIN}/Chooser-of-the-Dead/assets/index-def.js:1:99)`;
  return e;
}

beforeEach(forgetProblems);

describe('what a problem report says', () => {
  it('names the error and keeps the first lines of its stack', () => {
    expect(messageOf(new TypeError('x is undefined'))).toBe('TypeError: x is undefined');
    expect(messageOf('a string')).toBe('a string');
    expect(messageOf(new Error('m'.repeat(1000)))).toHaveLength(300);
    const e = new Error('deep');
    e.stack = ['Error: deep', ...Array.from({ length: 40 }, (_, i) => `    at f${i} (x.js:1:${i})`)].join('\n');
    expect(stackOf(e)).toHaveLength(12);
    expect(stackOf(e)[1]).toBe('at f0 (x.js:1:0)');
    expect(stackOf('not an error')).toEqual([]);
  });

  it('holds the build, the error, where the player was, the device, and the problems before it', () => {
    noteProblem('error', ours('first'), ctx);
    noteProblem('error', ours('second'), ctx);
    noteProblem('error', ours('first'), ctx);
    const r = noteProblem('crash', ours('broken screen'), ctx);
    expect(r).toMatchObject({
      v: 1,
      kind: 'crash',
      build: 'web-demo · abc1234 · content 5f3e',
      at: '2027-03-01T12:00:00.000Z',
      message: 'Error: broken screen',
      where: 'shift · Daily #91 · day 1 · soul 3 of 8',
      device: { ua: 'test', w: 412, h: 915, dpr: 2, lang: 'en' },
    });
    expect(r.earlier).toEqual(['Error: first', 'Error: second', 'Error: first']);
    // Nothing else: no save, no names, no settings.
    expect(Object.keys(r).sort()).toEqual([
      'at',
      'build',
      'device',
      'earlier',
      'kind',
      'message',
      'stack',
      'v',
      'where',
    ]);
  });

  it('remembers which problems it has seen, so the notice shows each once', () => {
    expect(seenBefore('Error: once')).toBe(false);
    noteProblem('error', ours('once'), ctx);
    expect(seenBefore('Error: once')).toBe(true);
  });

  it('opens the problem form with the report filled in, shortening a report too long for a link', () => {
    const r = noteProblem('crash', ours('broken'), ctx);
    const url = new URL(problemUrl(r) ?? '');
    expect(url.pathname).toBe('/RCJLabs/Chooser-of-the-Dead/issues/new');
    expect(url.searchParams.get('template')).toBe('problem-report.yml');
    expect(url.searchParams.get('title')).toBe('Problem: Error: broken');
    expect(JSON.parse(url.searchParams.get('report') ?? '')).toEqual(r);
    const long = { ...r, stack: Array.from({ length: 12 }, (_, i) => `at f${i} (${'x'.repeat(800)})`) };
    expect(problemUrl({ ...long, stack: long.stack.slice(0, 4), earlier: [] })?.length).toBeLessThanOrEqual(7000);
    expect(issueLength(long)).toBeGreaterThan(7000);
    const short = problemUrl(long) ?? '';
    expect(short.length).toBeLessThanOrEqual(7000);
    expect(JSON.parse(new URL(short).searchParams.get('report') ?? '').stack).toHaveLength(4);
  });
});

describe('which errors are the game’s', () => {
  it('counts errors thrown from its own scripts', () => {
    expect(
      isOursError({ message: 'Uncaught Error: x', filename: `${ORIGIN}/Chooser-of-the-Dead/assets/a.js` }, ORIGIN),
    ).toBe(true);
    expect(isOursError({ message: 'Uncaught Error: x', error: ours('x') }, ORIGIN)).toBe(true);
  });

  it('leaves out other sites’ and extensions’ scripts, and what browsers raise harmlessly', () => {
    expect(isOursError({ message: 'Script error.', filename: '' }, ORIGIN)).toBe(false);
    expect(isOursError({ message: 'x', filename: 'chrome-extension://abc/content.js' }, ORIGIN)).toBe(false);
    expect(
      isOursError(
        { message: 'ResizeObserver loop completed with undelivered notifications.', filename: `${ORIGIN}/a.js` },
        ORIGIN,
      ),
    ).toBe(false);
  });

  it('counts promises that failed with an error, but not a cancelled share or a refused permission', () => {
    expect(isOursRejection(new Error('Bad key: ../x'))).toBe(true);
    const abort = new Error('Share canceled');
    abort.name = 'AbortError';
    expect(isOursRejection(abort)).toBe(false);
    const refused = new Error('Write permission denied.');
    refused.name = 'NotAllowedError';
    expect(isOursRejection(refused)).toBe(false);
    expect(isOursRejection('just a string')).toBe(false);
    expect(isOursRejection(undefined)).toBe(false);
  });
});
