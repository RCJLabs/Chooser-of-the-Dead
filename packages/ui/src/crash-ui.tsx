import { copyText } from '@cots/platform';
import { signal } from '@preact/signals';
import type { ComponentChildren } from 'preact';
import { useEffect, useErrorBoundary, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { buildLabel } from './build';
import {
  crash,
  isOursError,
  isOursRejection,
  messageOf,
  noteProblem,
  type ProblemContext,
  type ProblemReport,
  problem,
  problemUrl,
  seenBefore,
} from './crash';
import { t } from './i18n';
import { pauseIfPlaying, screen, session } from './store';

/*
 * The game's outermost guard (docs/tech-spec.md §63). A screen that throws while drawing, or in one of its
 * effects, is replaced by one that says so: the sun is paused first, and the player can reload, report or copy
 * the details. Other errors the game didn't catch get a notice at the top that the player can dismiss. Saves are
 * written on every move, so a reload carries on from the last one.
 */

/** The dev build, which has the labs: the check is replaced at build time, so other builds drop the probe below. */
const LAB = import.meta.env.MODE === 'dev-full';

/** Words for this screen, even if the strings are what broke. */
const words = (key: string): string => {
  try {
    return t(key);
  } catch {
    return key;
  }
};

/** Where the player was: the screen, and the shift if there is one. */
function whereNow(): string {
  const parts: string[] = [screen.peek()];
  try {
    const s = session.peek();
    if (s) {
      parts.push(s.mode.kind === 'daily' ? `Daily #${s.mode.n}` : s.mode.kind, `day ${s.ctx.day}`);
      if (s.state.phase === 'shift') parts.push(`soul ${s.state.cursor + 1} of ${s.state.cases.length}`);
    }
  } catch {
    // What broke may be the shift itself.
  }
  return parts.join(' · ');
}

const context = (): ProblemContext => ({
  build: buildLabel,
  where: whereNow(),
  device: {
    ua: navigator.userAgent,
    w: window.innerWidth,
    h: window.innerHeight,
    dpr: window.devicePixelRatio,
    lang: navigator.language,
  },
});

/** Listens for errors the game didn't catch; the notice shows each new one once. */
function watchProblems(): () => void {
  const show = (e: unknown) => {
    const first = !seenBefore(messageOf(e));
    const report = noteProblem('error', e, context());
    if (first && !crash.peek()) problem.value = report;
  };
  const onError = (ev: ErrorEvent) => {
    if (isOursError(ev, location.origin)) show(ev.error ?? ev.message);
  };
  const onRejection = (ev: PromiseRejectionEvent) => {
    if (isOursRejection(ev.reason)) show(ev.reason);
  };
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}

export function CrashGuard({ children }: { children: ComponentChildren }) {
  const [error] = useErrorBoundary((e: unknown) => {
    try {
      pauseIfPlaying();
    } catch {
      // The shift may be what broke; it was saved at its last move either way.
    }
    crash.value = noteProblem('crash', e, context());
  });
  useEffect(watchProblems, []);
  if (error) return <CrashScreen report={crash.value ?? noteProblem('crash', error, context())} />;
  return (
    <>
      {children}
      <ProblemNotice />
      {LAB ? <CrashProbe /> : null}
    </>
  );
}

function ReportText({ report, id }: { report: ProblemReport; id: string }) {
  const [copied, setCopied] = useState<boolean | null>(null);
  const json = JSON.stringify(report);
  return (
    <>
      <textarea
        class="share share--small"
        readOnly
        rows={4}
        value={json}
        aria-label={words('ui.crash.textLabel')}
        data-testid={`${id}-text`}
      />
      <div class="row">
        <button
          type="button"
          class="btn"
          data-testid={`${id}-copy`}
          onClick={async () => setCopied(await copyText(json))}
        >
          {words(copied === true ? 'ui.report.copied' : copied === false ? 'ui.report.copyFailed' : 'ui.crash.copy')}
        </button>
      </div>
    </>
  );
}

function CrashScreen({ report }: { report: ProblemReport }) {
  const reload = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => reload.current?.focus({ preventScroll: true }), []);
  const url = problemUrl(report);
  return (
    <main class="screen screen--crash" data-testid="crash">
      <section class="card">
        <h1>{words('ui.crash.title')}</h1>
        <p>{words('ui.crash.body')}</p>
        <div class="row">
          <button
            type="button"
            class="btn btn--primary"
            ref={reload}
            data-testid="crash-reload"
            onClick={() => location.reload()}
          >
            {words('ui.crash.reload')}
          </button>
          {url ? (
            <a class="btn" href={url} target="_blank" rel="noopener noreferrer" data-testid="crash-report">
              {words('ui.crash.report')}
            </a>
          ) : null}
        </div>
        <p class="muted">{words('ui.crash.holds')}</p>
        <ReportText report={report} id="crash" />
      </section>
    </main>
  );
}

function ProblemNotice() {
  const r = problem.value;
  if (!r) return null;
  const url = problemUrl(r);
  return (
    <div class="problem" role="alert" data-testid="problem">
      <p>{words('ui.problem.note')}</p>
      <div class="row">
        {url ? (
          <a class="btn" href={url} target="_blank" rel="noopener noreferrer" data-testid="problem-report">
            {words('ui.problem.report')}
          </a>
        ) : null}
        <button
          type="button"
          class="btn btn--quiet"
          data-testid="problem-dismiss"
          onClick={() => {
            problem.value = null;
          }}
        >
          {words('ui.problem.dismiss')}
        </button>
      </div>
    </div>
  );
}

/*
 * For the tests, in the dev build only (it has the Case Lab): `cotsCrash('render')` breaks the next drawing of
 * the screen, and `cotsCrash('handler')` throws where nothing catches it, as a broken button would.
 */
const probe = signal(false);

function CrashProbe(): null {
  if (probe.value) throw new Error('A test crash, from the lab');
  return null;
}

if (LAB) {
  (globalThis as { cotsCrash?: (kind: 'render' | 'handler') => void }).cotsCrash = (kind) => {
    if (kind === 'render') probe.value = true;
    // From a microtask, as a broken button's handler would: Playwright's clock catches what timers throw.
    else
      queueMicrotask(() => {
        throw new Error('A test problem, from the lab');
      });
  };
}
