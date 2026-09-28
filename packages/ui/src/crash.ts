import { signal } from '@preact/signals';
import { issueFormUrl } from './links';

/*
 * When something breaks (docs/tech-spec.md §63). An error while drawing a screen takes the screen over
 * (crash-ui.tsx); any other error the game didn't catch gets a notice the player can dismiss. Either way the
 * player can send a report, and nothing saved is lost: the game saves after every move.
 */

/** What a problem report holds: the build, the error, where the player was, and the device. Nothing else. */
export interface ProblemReport {
  readonly v: 1;
  /** 'crash': a screen broke and was taken over. 'error': something else failed, and the game went on. */
  readonly kind: 'crash' | 'error';
  readonly build: string;
  readonly at: string;
  readonly message: string;
  readonly stack: readonly string[];
  /** The screen, and the shift if there is one: "shift · Daily #91 · day 1 · soul 3 of 8". */
  readonly where: string;
  /** Other problems earlier this session, newest last. */
  readonly earlier: readonly string[];
  readonly device: ProblemDevice;
}

export interface ProblemDevice {
  readonly ua: string;
  readonly w: number;
  readonly h: number;
  readonly dpr: number;
  readonly lang: string;
}

const MAX_MESSAGE = 300;
const MAX_STACK = 12;
const MAX_EARLIER = 5;
/** Past this, a report's link is shortened (the form's own limit is about 8,000 characters). */
const MAX_URL = 7000;

/** An error's name and message, whatever was thrown. */
export function messageOf(e: unknown): string {
  let text: string;
  try {
    text = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  } catch {
    text = 'Unknown error';
  }
  return text.slice(0, MAX_MESSAGE);
}

/** An error's first stack lines, trimmed (the scripts are minified: the build says which to rebuild). */
export function stackOf(e: unknown): string[] {
  const stack = e instanceof Error && typeof e.stack === 'string' ? e.stack : '';
  return stack
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .slice(0, MAX_STACK);
}

/** Errors browsers raise that aren't the game's doing and break nothing. */
const HARMLESS = [/ResizeObserver loop/i, /^AbortError\b/, /^NotAllowedError\b/];
const harmless = (message: string) => HARMLESS.some((re) => re.test(message));

/**
 * Whether an uncaught error event is the game's own: thrown from its scripts (an extension's, or another site's
 * "Script error.", isn't), and not one of the harmless kinds.
 */
export function isOursError(ev: { message: string; filename?: string; error?: unknown }, origin: string): boolean {
  const message = ev.error === undefined || ev.error === null ? ev.message : messageOf(ev.error);
  if (harmless(message) || harmless(ev.message)) return false;
  if (ev.filename?.startsWith(origin)) return true;
  return stackOf(ev.error).some((line) => line.includes(origin));
}

/** Whether a promise nobody caught failed with an error worth reporting (an Error, and not a harmless kind). */
export function isOursRejection(reason: unknown): boolean {
  return reason instanceof Error && !harmless(messageOf(reason));
}

/** Everything a report needs besides the error, from the page. */
export interface ProblemContext {
  readonly build: string;
  readonly where: string;
  readonly device: ProblemDevice;
  readonly now?: Date;
}

/** Messages of the problems seen this session, oldest first. */
const seen: string[] = [];

/** Forgets this session's problems (for tests). */
export function forgetProblems(): void {
  seen.length = 0;
}

/** Whether this message was already seen this session. */
export const seenBefore = (message: string): boolean => seen.includes(message);

/** A report of `e`, with the problems seen before it; it is then remembered as seen. */
export function noteProblem(kind: ProblemReport['kind'], e: unknown, ctx: ProblemContext): ProblemReport {
  const message = messageOf(e);
  const report: ProblemReport = {
    v: 1,
    kind,
    build: ctx.build,
    at: (ctx.now ?? new Date()).toISOString(),
    message,
    stack: stackOf(e),
    where: ctx.where,
    earlier: seen.filter((m) => m !== message).slice(-MAX_EARLIER),
    device: ctx.device,
  };
  seen.push(message);
  return report;
}

/** The report of a crash on screen, when a screen broke. */
export const crash = signal<ProblemReport | null>(null);
/** The latest other problem, until the player dismisses it. */
export const problem = signal<ProblemReport | null>(null);

export const problemTitle = (r: ProblemReport): string => `Problem: ${r.message.slice(0, 80)}`;

/**
 * The problem form on GitHub with the report filled in, if this build has an issues link. A report too long for
 * a link loses its earlier problems and most of its stack.
 */
export function problemUrl(r: ProblemReport): string | undefined {
  const url = (x: ProblemReport) => issueFormUrl('problem-report.yml', { report: JSON.stringify(x) }, problemTitle(x));
  const full = url(r);
  if (full === undefined || full.length <= MAX_URL) return full;
  return url({ ...r, stack: r.stack.slice(0, 4), earlier: [] });
}
