import { dailyContent, gameContent, manifest } from 'virtual:content';
import { placeholderSigil } from '@cots/art';
import {
  dailyDate,
  ENDLESS_SOULS,
  ENDLESS_STRIKES,
  type EndlessBoon,
  type EndlessOffer,
  endlessTwist,
  findBoon,
  hasBoons,
  shiftScore,
} from '@cots/engine';
import type { ShareResult } from '@cots/platform';
import type { ComponentType } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { AchievementsCard } from './achievements-ui';
import { artStyle } from './art';
import { AssistSettings, assistText, atSunSpeed } from './assists';
import { buildLabel } from './build';
import { openCampaign } from './campaign/lazy';
import { clockText, listText, t } from './i18n';
import { issueFormUrl, links } from './links';
import { openReport } from './report';
import { SavesSettings } from './saves-ui';
import { skippedText } from './shift/evidence';
import { Decree, RulesPanel } from './shift/Rules';
import { modeTitle, ReportDialog, ReviewDialog, useAutoFocus } from './shift/Shift';
import { hasBeds } from './sound/driver';
import {
  applyUpdate,
  begin,
  chooseEndless,
  currentAssists,
  type DatedRun,
  dailyProgress,
  dailyRecord,
  type EndlessMode,
  type EndlessResult,
  effectiveLayout,
  endlessOfferFor,
  endlessProgress,
  endlessResultBody,
  endlessRules,
  epochText,
  isoDate,
  lookAgain,
  resumeEndless,
  type Session,
  type Settings,
  savedStrikes,
  session,
  settings,
  shareBody,
  shareEndless,
  shareResult,
  startDaily,
  startEndless,
  startEndlessToday,
  startPractice,
  startPrimer,
  storageReady,
  streakOf,
  telemetryAvailable,
  today,
  toTitle,
  updateReady,
  updateSettings,
} from './store';

/** Loads the Case Lab and Body Lab only in dev-full; the MODE check is replaced at build time, so other builds drop them. */
function LabLoader() {
  const [labs, setLabs] = useState<readonly ComponentType[] | null>(null);
  useEffect(() => {
    if (import.meta.env.MODE === 'dev-full') {
      void Promise.all([import('./lab/CaseLab'), import('./lab/BodyLab')]).then(([a, b]) =>
        setLabs([a.CaseLab, b.BodyLab]),
      );
    }
  }, []);
  return labs ? labs.map((Lab, i) => <Lab key={i} />) : null;
}

/** One line identifying this build and device, for feedback forms. */
function buildLine(): string {
  return `${manifest.target} ${manifest.contentHash} · ${effectiveLayout()} · art ${artStyle.value} · ${window.innerWidth}x${window.innerHeight} · ${navigator.userAgent}`;
}

function feedbackUrl(): string | undefined {
  return issueFormUrl('playtest.yml', { build: buildLine() }, 'Playtest feedback');
}

function Links() {
  const feedback = feedbackUrl();
  const items = [
    feedback ? { href: feedback, label: t('ui.feedback'), id: 'feedback' } : null,
    links.community ? { href: links.community, label: t('ui.community'), id: 'community' } : null,
    telemetryAvailable() && links.privacy ? { href: links.privacy, label: t('ui.privacy'), id: 'privacy' } : null,
  ].filter((x) => x !== null);
  if (items.length === 0) return null;
  return (
    <nav class="links">
      {items.map((x) => (
        <a key={x.id} href={x.href} target="_blank" rel="noopener noreferrer" data-testid={`link-${x.id}`}>
          {x.label}
        </a>
      ))}
    </nav>
  );
}

function DailyCard() {
  const { n, date, preview } = today();
  const result = dailyRecord.value.results[String(n)];
  const progress = dailyProgress.value;
  const resumable = !result && progress?.n === n && progress.g === dailyContent?.genVersion;
  const streak = streakOf(dailyRecord.value, n);
  const newcomer = dailyContent?.primer !== undefined && !settings.value.primerDone && !result && !resumable;
  if (!dailyContent?.daily) return null;
  return (
    <section class="card card--daily">
      {newcomer ? (
        <>
          <p>{t('primer.hint')}</p>
          <button type="button" class="btn btn--big" data-testid="play-primer" onClick={startPrimer}>
            {t('primer.play')}
          </button>
        </>
      ) : null}
      {result ? (
        <p class="card__result" data-testid="daily-result">
          {t('ui.daily.result', { correct: result.correct, total: result.total })} {result.marks}
        </p>
      ) : null}
      {result && assistText(result.assists) ? (
        <p class="muted" data-testid="daily-assisted">
          {t('ui.daily.assisted', { list: assistText(result.assists) ?? '' })}
        </p>
      ) : null}
      <button
        type="button"
        class="btn btn--primary btn--big"
        data-testid="play-daily"
        disabled={!storageReady.value}
        onClick={() => startDaily()}
      >
        {resumable
          ? t('ui.daily.resume')
          : result
            ? t('ui.daily.replay')
            : preview
              ? t('ui.daily.preview', { date })
              : t('ui.daily.play', { n })}
      </button>
      {preview ? <p class="muted">{t('ui.daily.previewNote', { date: epochText() })}</p> : null}
      {streak.best > 0 ? (
        <p class="muted" data-testid="streak">
          {t('ui.daily.streak', { n: streak.current, best: streak.best })}
        </p>
      ) : null}
      <DailyArchive today={n} />
    </section>
  );
}

/** Earlier Dailies, newest first, to play for their own sake: never recorded, streak untouched. */
function DailyArchive({ today: n }: { today: number }) {
  const [pick, setPick] = useState(n - 1);
  if (n < 2) return null;
  const past = Array.from({ length: n - 1 }, (_, i) => n - 1 - i);
  return (
    <details class="archive" data-testid="daily-archive">
      <summary>{t('ui.daily.archive')}</summary>
      <p class="muted">{t('ui.daily.archiveNote')}</p>
      <div class="row">
        <select
          value={pick}
          aria-label={t('ui.daily.archive')}
          data-testid="archive-pick"
          onChange={(e) => setPick(Number((e.target as HTMLSelectElement).value))}
        >
          {past.map((k) => {
            const r = dailyRecord.value.results[String(k)];
            return (
              <option key={k} value={k}>
                {t('ui.daily.archiveRow', { n: k, date: isoDate(dailyDate(k)) })}
                {r ? ` · ${r.correct}/${r.total}` : ''}
              </option>
            );
          })}
        </select>
        <button
          type="button"
          class="btn"
          data-testid="archive-play"
          disabled={!storageReady.value}
          onClick={() => startDaily(pick)}
        >
          {t('ui.daily.archivePlay')}
        </button>
      </div>
    </details>
  );
}

function CampaignCard() {
  if (!gameContent.campaign) return null;
  return (
    <section class="card card--campaign">
      <h2>{t('ui.campaign')}</h2>
      <p>{t(manifest.edition === 'demo' ? 'ui.campaign.hint.demo' : 'ui.campaign.hint.full')}</p>
      <button
        type="button"
        class="btn btn--primary btn--big"
        data-testid="play-campaign"
        disabled={!storageReady.value}
        onClick={() => void openCampaign()}
      >
        {t('ui.campaign.play')}
      </button>
    </section>
  );
}

function SettingsCard() {
  const s = settings.value;
  const set = (patch: Partial<Settings>) => updateSettings(patch);
  return (
    <details class="card card--settings">
      <summary>{t('ui.settings')}</summary>
      <label>
        {t('ui.settings.layout')}{' '}
        <select
          value={s.layout}
          data-testid="setting-layout"
          onChange={(e) => set({ layout: (e.target as HTMLSelectElement).value as Settings['layout'] })}
        >
          <option value="auto">{t('ui.settings.layout.auto')}</option>
          <option value="desk">{t('ui.settings.layout.desk')}</option>
          <option value="drawer">{t('ui.settings.layout.drawer')}</option>
        </select>
      </label>
      <label>
        {t('ui.settings.text')}{' '}
        <input
          type="range"
          min="0.85"
          max="1.75"
          step="0.05"
          value={s.textScale}
          onInput={(e) => set({ textScale: Number((e.target as HTMLInputElement).value) })}
        />
      </label>
      <label>
        {t('ui.settings.sound')}{' '}
        <input
          type="range"
          min="0"
          max="1"
          step="0.1"
          value={s.sound}
          data-testid="setting-sound"
          onInput={(e) => set({ sound: Number((e.target as HTMLInputElement).value) })}
        />
      </label>
      {hasBeds.value ? (
        <>
          <label>
            {t('ui.settings.music')}{' '}
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={s.music}
              data-testid="setting-music"
              onInput={(e) => set({ music: Number((e.target as HTMLInputElement).value) })}
            />
          </label>
          <label>
            {t('ui.settings.ambience')}{' '}
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={s.ambience}
              data-testid="setting-ambience"
              onInput={(e) => set({ ambience: Number((e.target as HTMLInputElement).value) })}
            />
          </label>
        </>
      ) : null}
      <label>
        <input
          type="checkbox"
          checked={s.reduceMotion}
          data-testid="setting-motion"
          onChange={(e) => set({ reduceMotion: (e.target as HTMLInputElement).checked })}
        />{' '}
        {t('ui.settings.motion')}
      </label>
      <label>
        <input
          type="checkbox"
          checked={s.holdToSend}
          onChange={(e) => set({ holdToSend: (e.target as HTMLInputElement).checked })}
        />{' '}
        {t('ui.settings.hold')}
      </label>
      <label>
        <input
          type="checkbox"
          checked={s.untimedPractice}
          onChange={(e) => set({ untimedPractice: (e.target as HTMLInputElement).checked })}
        />{' '}
        {t('ui.settings.untimed')}
      </label>
      {gameContent.campaign ? (
        <label>
          <input
            type="checkbox"
            checked={s.coach}
            data-testid="setting-coach"
            onChange={(e) => set({ coach: (e.target as HTMLInputElement).checked })}
          />{' '}
          {t('ui.settings.coach')}
        </label>
      ) : null}
      <AssistSettings campaign={gameContent.campaign !== undefined} />
      <SavesSettings />
      {telemetryAvailable() ? (
        <label>
          <input
            type="checkbox"
            checked={s.telemetry}
            data-testid="setting-telemetry"
            onChange={(e) => set({ telemetry: (e.target as HTMLInputElement).checked, telemetryAsked: true })}
          />{' '}
          {t('ui.telemetry.setting')}
        </label>
      ) : null}
    </details>
  );
}

export function Title() {
  const days = gameContent.days.map((d) => d.day);
  return (
    <main class="screen screen--title" data-layout={effectiveLayout()}>
      {updateReady.value ? (
        <div class="banner" role="status" data-testid="update-ready">
          <span>{t('ui.update.ready')}</span>
          <button type="button" class="btn btn--primary btn--small" onClick={applyUpdate}>
            {t('ui.update.apply')}
          </button>
        </div>
      ) : null}
      <header class="title__header">
        <div class="title__sigil" dangerouslySetInnerHTML={{ __html: placeholderSigil() }} />
        <h1>{t('core.title')}</h1>
        <p class="muted">{t('core.tagline')}</p>
        {manifest.playtest ? (
          <p class="playtest-note" data-testid="playtest-note">
            {t('ui.playtest.note', { build: buildLabel })}
          </p>
        ) : null}
      </header>
      <DailyCard />
      <CampaignCard />
      <section class="card">
        <h2>{t('ui.practice')}</h2>
        <div class="row">
          {days.map((d) => (
            <button key={d} type="button" class="btn" data-testid={`practice-${d}`} onClick={() => startPractice(d)}>
              {t('ui.practice.day', { n: d })}
            </button>
          ))}
          {dailyContent?.primer && settings.value.primerDone ? (
            <button type="button" class="btn" data-testid="replay-primer" onClick={startPrimer}>
              {t('primer.title')}
            </button>
          ) : null}
        </div>
        <p class="muted">{t('ui.practice.hint')}</p>
      </section>
      <EndlessCard />
      <AchievementsCard />
      {manifest.edition === 'demo' && links.steam ? (
        <a class="btn btn--big wishlist" href={links.steam} target="_blank" rel="noopener noreferrer">
          {t('demo.wishlist')}
        </a>
      ) : null}
      <p class="muted howto">{t('ui.howto')}</p>
      <SettingsCard />
      <Links />
      <footer class="title__footer muted">
        <span data-testid="target">{manifest.target}</span> · <span data-testid="edition">{manifest.edition}</span> ·{' '}
        <span data-testid="packs">{manifest.packs.join(' · ')}</span> ·{' '}
        <span data-testid="layout">{effectiveLayout()}</span>
        <span class="title__keys">
          <br />
          {t('ui.keys', {
            n: new Set(gameContent.rules.map((r) => r.then)).size,
            registry: gameContent.tools.some((tool) => tool.id === 'registry') ? 'yes' : 'no',
          })}
        </span>
        <span class="pad-only" data-testid="pad-keys">
          <br />
          {t('ui.pad.keys')}
        </span>
      </footer>
      {manifest.lab ? <LabLoader /> : null}
    </main>
  );
}

/** What an Endless run is called: the day's by number, or a free run. */
const runName = (dated: DatedRun | null): string =>
  !dated
    ? t('ui.endless.free')
    : dated.preview
      ? t('ui.endless.datedPreview', { date: dated.date })
      : t('ui.endless.dated', { n: dated.n });

/** A share button with its status line and the text itself (for copying by hand). */
function ShareBox({ text, url, share }: { text: string; url: string | undefined; share: () => Promise<ShareResult> }) {
  const [shared, setShared] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        class="btn btn--primary"
        data-testid="share"
        onClick={async () => {
          const r = await share();
          setShared(
            r === 'copied'
              ? t('ui.summary.copied')
              : r === 'shared'
                ? t('ui.summary.shared')
                : t('ui.summary.shareFailed'),
          );
        }}
      >
        {t('ui.summary.share')}
      </button>
      {shared ? (
        <p role="status" data-testid="share-status">
          {shared}
        </p>
      ) : null}
      <textarea
        class="share"
        readOnly
        rows={4}
        aria-label={t('ui.share.textLabel')}
        data-testid="share-text"
        value={url ? `${text}\n${url}` : text}
      />
    </>
  );
}

/**
 * Endless on the title screen: today's run (the same souls for everyone, once), a free run, and the
 * saved run to pick up. While today's run is under way it can only be resumed.
 */
function EndlessCard() {
  const { n, date, preview } = today();
  const saved = endlessProgress.value;
  const played = settings.value.endlessToday;
  const playedToday = played?.n === n ? played : null;
  const todayOpen = saved?.mode.dated?.n === n;
  const best = settings.value.endlessBest;
  const run = hasBoons(gameContent);
  return (
    <section class="card" data-testid="endless-card">
      <h2>{t('ui.endless')}</h2>
      <p class="muted">{t('ui.endless.hint', { n: ENDLESS_SOULS, strikes: ENDLESS_STRIKES })}</p>
      {run ? <p class="muted">{t('ui.endless.runHint')}</p> : null}
      {playedToday ? <EndlessToday result={playedToday} /> : null}
      {saved ? (
        <p data-testid="endless-saved">
          {runName(saved.mode.dated)} · {endlessStatus(saved, savedStrikes(saved))}
        </p>
      ) : null}
      <div class="row">
        {saved ? (
          <button
            type="button"
            class="btn btn--primary"
            data-testid="endless-resume"
            disabled={!storageReady.value}
            onClick={resumeEndless}
          >
            {t('ui.endless.resume', { round: saved.mode.round + 1 })}
          </button>
        ) : null}
        {!playedToday && !todayOpen ? (
          <button
            type="button"
            class={saved ? 'btn' : 'btn btn--primary'}
            data-testid="endless-today"
            disabled={!storageReady.value}
            onClick={startEndlessToday}
          >
            {runName({ n, date, preview })}
          </button>
        ) : null}
        {!todayOpen ? (
          <button
            type="button"
            class="btn"
            data-testid="endless-start"
            disabled={!storageReady.value}
            onClick={startEndless}
          >
            {t('ui.endless.free')}
          </button>
        ) : null}
        {best > 0 ? (
          <span class="muted" data-testid="endless-best">
            {t(run ? 'ui.endless.bestScore' : 'ui.endless.best', { n: best })}
          </span>
        ) : null}
      </div>
      {saved && !todayOpen ? <p class="muted">{t('ui.endless.replaces')}</p> : null}
      {!playedToday && !saved ? <p class="muted">{t('ui.endless.todayNote')}</p> : null}
    </section>
  );
}

/** Today's Endless result, to share after the run has gone. */
function EndlessToday({ result }: { result: EndlessResult }) {
  const [open, setOpen] = useState(false);
  return (
    <div class="endless__today">
      <p class="card__result" data-testid="endless-today-result">
        {result.score !== undefined
          ? t('ui.endless.todayScore', { score: result.score, round: result.round + 1 })
          : t('ui.endless.todayResult', { n: result.judged, round: result.round + 1 })}{' '}
        <button
          type="button"
          class="btn btn--quiet btn--small"
          data-testid="endless-today-share"
          onClick={() => setOpen(!open)}
        >
          {t('ui.summary.share')}
        </button>
      </p>
      {open ? <ShareBox {...endlessResultBody(result)} share={() => shareEndless(result)} /> : null}
    </div>
  );
}

/**
 * How an Endless run stands: souls judged rightly and strikes, and its score where Endless is a run
 * (docs/tech-spec.md §68).
 */
function endlessStatus(m: { judged: number; strikes: number; score?: number | undefined }, max: number): string {
  return hasBoons(gameContent)
    ? t('ui.endless.statusScore', { score: m.score ?? m.judged, n: m.judged, strikes: m.strikes, max })
    : t('ui.endless.status', { n: m.judged, strikes: m.strikes, max });
}

/** A boon or a curse on offer: its name and what it does, the whole card a button. */
function BoonCard({ b, first }: { b: EndlessBoon; first?: boolean }) {
  const ref = useRef<HTMLButtonElement>(null);
  // The choice comes before Begin: the keyboard and a controller start on the first boon.
  useLayoutEffect(() => {
    if (first) ref.current?.focus({ preventScroll: true });
  }, [first]);
  return (
    <button
      type="button"
      class={`boon boon--${b.kind}`}
      data-testid={b.kind}
      data-boon={b.id}
      ref={ref}
      onClick={() => chooseEndless(b.id)}
    >
      <strong class="boon__name">{t(b.name)}</strong>
      <span class="boon__text">{t(b.text)}</span>
    </button>
  );
}

/** Endless's choice between rounds (docs/tech-spec.md §68): one of three boons, or the curse on offer. */
function EndlessOfferBox({ s, offer }: { s: Session; offer: EndlessOffer }) {
  const { worth } = endlessRules(s);
  return (
    <section class="card endless-offer" data-testid="endless-offer" aria-labelledby="endless-offer-title">
      <h2 id="endless-offer-title">{t('ui.endless.offer', { n: offer.round + 1 })}</h2>
      <div class="boons">
        {offer.boons.map((b, i) => (
          <BoonCard key={b.id} b={b} first={i === 0} />
        ))}
      </div>
      {offer.curse ? (
        <>
          <p class="endless-offer__curse">{t('ui.endless.offerCurse', { worth: worth + 1, now: worth })}</p>
          <div class="boons">
            <BoonCard b={offer.curse} first={offer.boons.length === 0} />
          </div>
        </>
      ) : null}
    </section>
  );
}

/** What an Endless run has taken, and what a soul judged rightly scores now. Nothing before its first pick. */
function EndlessPicks({ s, m }: { s: Session; m: EndlessMode }) {
  const picks = m.picks ?? [];
  if (!hasBoons(s.content) || picks.length === 0) return null;
  const counts = new Map<string, number>();
  for (const p of picks) counts.set(p.id, (counts.get(p.id) ?? 0) + 1);
  return (
    <section class="card" data-testid="endless-picks">
      <h2>{t('ui.endless.picks')}</h2>
      <ul class="picks">
        {[...counts].map(([id, n]) => {
          const b = findBoon(s.content, id);
          if (!b) return null;
          const name = t(b.name);
          return (
            <li key={id} class={`pick pick--${b.kind}`} data-boon={id}>
              <strong>{n > 1 ? t('ui.endless.pickCount', { name, n }) : name}</strong> {t(b.text)}
            </li>
          );
        })}
      </ul>
      <p class="muted" data-testid="endless-worth">
        {t('ui.endless.worth', { n: endlessRules(s).worth })}
      </p>
    </section>
  );
}

export function Briefing() {
  const focus = useAutoFocus<HTMLButtonElement>();
  const s = session.value;
  const offer = s ? endlessOfferFor(s) : null;
  // Once the choice is made, Begin takes the focus the offer had.
  const chosen = useRef(offer !== null);
  useLayoutEffect(() => {
    if (chosen.current && !offer) focus.current?.focus({ preventScroll: true });
    chosen.current = offer !== null;
  }, [offer === null]);
  if (!s) return null;
  const st = s.state;
  // The shift takes up the assists as it begins; until then, show the sun they'll give it.
  const assists = currentAssists(false, st.config.untimed);
  const assisted = assistText(assists);
  return (
    <main class="screen screen--briefing">
      <h1 data-testid="briefing-title">{modeTitle(s)}</h1>
      {s.mode.kind === 'daily' && s.mode.guard === 'mismatch' ? (
        <div class="banner banner--bad" role="alert" data-testid="guard-mismatch">
          <p>{t('ui.guard.mismatch')}</p>
          <button type="button" class="btn btn--small" onClick={() => openReport(s, 0)}>
            {t('ui.guard.report')}
          </button>
        </div>
      ) : null}
      {s.mode.kind === 'endless' ? (
        <p class="briefing__queue" data-testid="endless-status">
          {endlessStatus(s.mode, endlessRules(s).strikes)}
        </p>
      ) : null}
      {offer ? <EndlessOfferBox s={s} offer={offer} /> : null}
      {s.mode.kind === 'endless' ? <EndlessPicks s={s} m={s.mode} /> : null}
      {s.mode.kind === 'endless' && endlessTwist(s.content, s.mode.seed, s.mode.round) ? (
        <p class="briefing__twist" data-testid="endless-twist">
          {t('ui.endless.twist', { day: s.mode.day })}
        </p>
      ) : null}
      <Decree ctx={s.ctx} />
      <p class="briefing__queue">
        {st.config.untimed
          ? t('ui.briefing.untimed', { n: st.cases.length })
          : t('ui.briefing.queue', { n: st.cases.length, time: clockText(atSunSpeed(st.sunMs, assists.sunPct)) })}
      </p>
      {assisted ? (
        <p class="muted" data-testid="briefing-assists">
          {t('ui.assist.on', { list: assisted })}
        </p>
      ) : null}
      <div class="row">
        <button
          type="button"
          class="btn btn--primary btn--big"
          data-testid="begin"
          ref={focus}
          disabled={offer !== null}
          onClick={begin}
        >
          {t('ui.begin')}
        </button>
        <button type="button" class="btn" data-back onClick={toTitle}>
          {t('ui.back')}
        </button>
      </div>
      <section class="card">
        <h2>{t('ui.tab.rules')}</h2>
        <RulesPanel ctx={s.ctx} decree={false} />
      </section>
      <ReportDialog />
    </main>
  );
}

/** Endless is over: three strikes. */
export function EndlessOver() {
  const focus = useAutoFocus<HTMLButtonElement>();
  const s = session.value;
  if (s?.mode.kind !== 'endless') return null;
  const m = s.mode;
  const { text, url } = shareBody(s);
  // Where Endless is a run (docs/tech-spec.md §68), it ends when the strikes it can take are gone, and it has a score.
  const run = hasBoons(s.content);
  const score = m.score ?? m.judged;
  return (
    <main class="screen screen--summary">
      <h1 data-testid="endless-over">{t(run ? 'ui.endless.outOf' : 'ui.endless.over')}</h1>
      <p class="muted" data-testid="endless-run">
        {runName(m.dated)}
      </p>
      <p class="summary__score" data-testid="endless-score">
        {run
          ? t('ui.endless.scoreOver', { score, n: m.judged, day: m.day })
          : t('ui.endless.score', { n: m.judged, day: m.day })}
      </p>
      <p data-testid="endless-record">
        {score > m.bestBefore
          ? t('ui.endless.newBest')
          : t(run ? 'ui.endless.bestScore' : 'ui.endless.best', { n: settings.value.endlessBest })}
      </p>
      <EndlessPicks s={s} m={m} />
      <section class="card">
        <ShareBox text={text} url={url} share={() => shareResult(s)} />
      </section>
      <div class="row">
        <button type="button" class="btn btn--primary" data-testid="endless-again" ref={focus} onClick={startEndless}>
          {t('ui.endless.free')}
        </button>
        <button type="button" class="btn" data-testid="home" data-back onClick={toTitle}>
          {t('ui.summary.home')}
        </button>
      </div>
    </main>
  );
}

/** Asked once, after the first finished Daily, and only in builds with a telemetry endpoint. */
function TelemetryAsk() {
  if (!telemetryAvailable() || settings.value.telemetryAsked) return null;
  return (
    <section class="card card--ask" data-testid="telemetry-ask">
      <h2>{t('ui.telemetry.ask.title')}</h2>
      <p>{t('ui.telemetry.ask.body')}</p>
      <div class="row">
        <button
          type="button"
          class="btn btn--primary"
          data-testid="telemetry-yes"
          onClick={() => updateSettings({ telemetry: true, telemetryAsked: true })}
        >
          {t('ui.telemetry.yes')}
        </button>
        <button
          type="button"
          class="btn"
          data-testid="telemetry-no"
          onClick={() => updateSettings({ telemetry: false, telemetryAsked: true })}
        >
          {t('ui.telemetry.no')}
        </button>
        {links.privacy ? (
          <a href={links.privacy} target="_blank" rel="noopener noreferrer">
            {t('ui.telemetry.more')}
          </a>
        ) : null}
      </div>
    </section>
  );
}

function PrimerDone() {
  return (
    <section class="card card--ready" data-testid="primer-done">
      <h2>{t('primer.done.title')}</h2>
      <p>{t('primer.done.body')}</p>
      <div class="row">
        <button type="button" class="btn btn--primary" data-testid="primer-to-daily" onClick={() => startDaily()}>
          {t('primer.toDaily')}
        </button>
      </div>
    </section>
  );
}

export function Summary() {
  const s = session.value;
  if (!s) return null;
  const st = s.state;
  const score = shiftScore(st);
  const daily = s.mode.kind === 'daily';
  const { text, url } = shareBody(s);
  const feedback = feedbackUrl();
  return (
    <main class="screen screen--summary">
      <h1>{t(st.endedBy === 'dusk' ? 'ui.summary.dusk' : 'ui.summary.done')}</h1>
      <p class="summary__score" data-testid="score">
        {t('ui.summary.score', { correct: score.correct, total: score.total })}
      </p>
      {score.spareMs > 0 ? (
        // Whole seconds, rounded down like the share text.
        <p>{t('ui.summary.spare', { time: clockText(score.spareMs - (score.spareMs % 1000)) })}</p>
      ) : null}
      <p>{t('ui.summary.caught', { n: score.caught })}</p>
      {s.mode.kind === 'primer' ? <PrimerDone /> : null}
      <ol class="verdicts">
        {st.verdicts.map((v) => {
          const c = st.cases[v.index];
          const name = c ? `${c.evidence.look.name} ${c.evidence.look.patronym}` : '';
          return (
            <li key={v.index} class={v.correct ? 'is-right' : 'is-wrong'} data-testid="verdict">
              <span aria-hidden="true">{v.stamped === null ? '⬛' : v.correct ? '🟩' : '🟥'}</span>{' '}
              {t('ui.summary.row', { name, dest: t(`dest.${v.expected}`) })}
              {v.stamped === null ? (
                <span class="muted"> ({t('ui.summary.unjudged')})</span>
              ) : v.correct ? null : v.stamped === v.expected ? (
                <span class="muted">
                  {' '}
                  ({t('ui.summary.skipped', { procs: listText(skippedText(v.skipped, s.ctx)) })})
                </span>
              ) : (
                <span class="muted"> ({t('ui.summary.you', { dest: t(`dest.${v.stamped}`) })})</span>
              )}{' '}
              {/* A mistake can be looked at again, and tried again (docs/tech-spec.md §67). */}
              {v.stamped !== null && !v.correct ? (
                <button
                  type="button"
                  class="btn btn--small"
                  data-testid="look-again"
                  aria-label={t('ui.review.openLabel', { name })}
                  onClick={() => lookAgain(v.index)}
                >
                  {t('ui.review.open')}
                </button>
              ) : null}{' '}
              <button
                type="button"
                class="btn btn--quiet btn--small"
                data-testid="report-soul"
                aria-label={t('ui.report.rowLabel', { name })}
                onClick={() => openReport(s, v.index)}
              >
                {t('ui.report.row')}
              </button>
            </li>
          );
        })}
      </ol>
      {daily ? (
        <section class="card">
          <ShareBox text={text} url={url} share={() => shareResult(s)} />
        </section>
      ) : null}
      {daily ? <TelemetryAsk /> : null}
      <div class="row">
        <button type="button" class="btn" data-testid="home" data-back onClick={toTitle}>
          {t('ui.summary.home')}
        </button>
        {feedback ? (
          <a
            class="btn btn--quiet"
            href={feedback}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="summary-feedback"
          >
            {t('ui.feedback')}
          </a>
        ) : null}
      </div>
      <ReportDialog />
      <ReviewDialog />
    </main>
  );
}
