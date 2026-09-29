import { gameContent, loadScenes, manifest } from 'virtual:content';
import {
  type AppealHeard,
  armsTonight,
  type BattleMark,
  type Bills,
  battleMarks,
  billForecast,
  billTotal,
  type Content,
  campaignOf,
  careFor,
  createDayContext,
  type DayGrade,
  type DayLedger,
  DESTINATIONS,
  debtLimit,
  defaultBills,
  deskVisit,
  type Effect,
  EPILOGUE_SECTIONS,
  economyFor,
  economyOf,
  epilogueFor,
  epilogueParams,
  eventLineChange,
  eventOn,
  type Faction,
  type FavourDef,
  type FrontBattle,
  factionKey,
  factionsMet,
  favoursFor,
  fedAtHome,
  fight,
  hostMarks,
  hostParts,
  hostsAt,
  huntOn,
  type JournalEntry,
  memberDef,
  type NamedSoul,
  type NightOutlook,
  namedIn,
  nightOutlook,
  type OriginDef,
  originOf,
  type RunEvent,
  type RunState,
  rankOf,
  reachableEndings,
  replayableDays,
  ruleText,
  scenesFor,
  sellPrice,
  shiftMods,
  shiftScore,
  shopFor,
  stampEffects,
  stampRings,
  standingFx,
  standingLead,
  type TrailMark,
  type TrailSuspect,
  threadsInPlay,
  trailBoard,
  weaveDay,
  weaveOf,
  weaveOpen,
  withEffects,
} from '@cots/engine';
import { journalEnv, playScene, type SceneLine, sceneEnv } from '@cots/story';
import { effect, signal } from '@preact/signals';
import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { AssistSettings, assistText, atSunSpeed } from '../assists';
import { clockText, hasText, listText, t } from '../i18n';
import { openReport } from '../report';
import { unreadableText } from '../saves';
import { CopyBox } from '../saves-ui';
import { toTop, toTopOf } from '../scroll';
import { skippedText } from '../shift/evidence';
import { Decree } from '../shift/Rules';
import { ReportDialog, ReviewDialog, useAutoFocus } from '../shift/Shift';
import { campaignPlace, useStoryText } from '../sound/place';
import { act, currentAssists, lookAgain, type Screen, session, settings, storageKept, toTitle } from '../store';
import { PlaytestButton, PlaytestDialog } from './playtest-ui';
import {
  active,
  answerPromotion,
  branchFrom,
  deleteSlot,
  dispatch,
  emptySlot,
  endAudit,
  hearAppeal,
  lastNight,
  leaveCampaign,
  letAppealStand,
  loadSlots,
  marshal,
  newCampaign,
  openSlot,
  replayFrom,
  SLOT_COUNT,
  type SlotRecord,
  sleep,
  slots,
  stepDown,
  toEnding,
  toGate,
  unreadable,
} from './run-store';

/*
 * The campaign's own screens (docs/build-plan.md §1, "Day loop"): the save
 * slots, then each day's morning, audit and night, and the ending. The shift
 * itself is the ordinary shift screen, stepping the run underneath.
 */

/** Compiled Ink scenes, loaded with the campaign. */
let scenes: Readonly<Record<string, object>> = {};

// The run's day and ending, for the sound, which chooses Day 20's gate and each ending's music by them.
effect(() => {
  const run = active.value?.run;
  campaignPlace.value = run ? { day: run.day, ending: run.ending ?? null } : null;
});

export async function enterCampaign(): Promise<void> {
  [scenes] = await Promise.all([loadScenes(), loadSlots()]);
}

/** One of the household's name: the family's, or that of someone an origin brings (docs/tech-spec.md §72). */
const familyName = (content: Content, id: string) => t(memberDef(content, id)?.name ?? id);

/** The name to use inside a sentence ("Ragna" rather than "Ragna, your mother"): `<name key>.short`, if there is one. */
const familyShort = (content: Content, id: string) => {
  const key = memberDef(content, id)?.name ?? id;
  return hasText(`${key}.short`) ? t(`${key}.short`) : t(key);
};

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

/** The name a power goes by on `day` (the stranger is Loki, but nobody says so until Day 12). */
const factionName = (f: Faction, day: number) => t(factionKey(gameContent, f, day));

/** "Hel will remember that (+3)." for each power the effects move, in the order they first move it. */
function standingNotes(effects: readonly Effect[] | undefined, day: number): string[] {
  const by = new Map<Faction, number>();
  for (const e of effects ?? []) if ('standing' in e) by.set(e.standing, (by.get(e.standing) ?? 0) + e.by);
  return [...by]
    .filter(([, n]) => n !== 0)
    .map(([f, n]) => t('ui.remember', { name: factionName(f, day), change: signed(n) }));
}

/** Seconds of sun a trip home at dawn gives or takes on the next shift (docs/tech-spec.md §50), in `effects`. */
const sunOf = (effects: readonly Effect[] | undefined) =>
  (effects ?? []).reduce((s, e) => s + ('sun' in e ? e.sun : 0), 0);

/** "2:00 less sun tomorrow": what an option's trip home at dawn does to the next shift, today's in the morning. */
const sunText = (s: number, when: 'today' | 'tomorrow') =>
  t(s < 0 ? 'ui.scene.sunLess' : 'ui.scene.sunMore', { time: clockText(Math.abs(s) * 1000), when });

/** Where the player stands with each power they've had dealings with, on one line. */
function StandingStrip({ run }: { run: RunState }) {
  const met = factionsMet(run);
  if (met.length === 0) return null;
  return (
    <p class="standing-strip" data-testid="standing-strip">
      <span class="muted">{t('ui.audit.standing')}:</span>{' '}
      {met.map((f, i) => (
        <span key={f} class="standing-strip__item">
          {i > 0 ? ' · ' : ''}
          {factionName(f, run.day)}{' '}
          <b class={run.standing[f] > 0 ? 'is-up' : run.standing[f] < 0 ? 'is-down' : undefined}>
            {signed(run.standing[f])}
          </b>
        </span>
      ))}
    </p>
  );
}

// ---------- grades (docs/tech-spec.md §49) ----------

/** How a best was played, when it wasn't plain: with assists, under the oath. */
function bestMarks(b: { readonly assisted?: true; readonly oath?: true }): string {
  const marks = [...(b.assisted ? [t('ui.grade.mark.assisted')] : []), ...(b.oath ? [t('ui.grade.mark.oath')] : [])];
  return marks.length > 0 ? ` (${listText(marks)})` : '';
}

const spareText = (ms: number) => (ms > 0 ? t('ui.grade.spare', { time: clockText(ms) }) : '');

/**
 * The day's grade at the audit: what it was made of, what the next grade up takes, and the day's best on this
 * device (the audit has already kept this one if it beat it).
 */
function DayMark({ grade: g, day }: { grade: DayGrade; day: number }) {
  const best = settings.value.dayBests[String(day)];
  const isBest = best && best.grade === g.grade && best.spareMs === g.spareMs && !best.assisted === !g.assisted;
  return (
    <section class="card day-mark" data-testid="day-mark">
      <h2 data-testid="day-grade">{t('ui.grade.title', { grade: t(`ui.grade.${g.grade}`) })}</h2>
      <p data-testid="day-grade-why">
        {t(`ui.grade.why.${g.grade}`, { n: g.mistakes, caught: g.caught, liars: g.liars })}
      </p>
      {best ? (
        <p class="muted" data-testid="day-best">
          {isBest
            ? t('ui.grade.bestYet', { day })
            : t('ui.grade.best', { day, grade: t(`ui.grade.${best.grade}`), spare: spareText(best.spareMs) }) +
              bestMarks(best)}
        </p>
      ) : null}
    </section>
  );
}

/** Days as runs, for a line: "2, 4–6, 9". */
function dayRuns(days: readonly number[]): string {
  const runs: string[] = [];
  for (let i = 0; i < days.length; ) {
    let j = i;
    while (j + 1 < days.length && days[j + 1] === (days[j] ?? 0) + 1) j++;
    runs.push(i === j ? String(days[i]) : `${days[i]}–${days[j]}`);
    i = j + 1;
  }
  return runs.join(', ');
}

/**
 * Each day's best on this device, once there's one (docs/tech-spec.md §49): a goal for replaying a day. The days
 * without one go on a single line, so the card stays short on a phone.
 */
function BestDays() {
  const bests = settings.value.dayBests;
  const days = gameContent.days.map((d) => d.day).filter((d) => d >= 1);
  const graded = days.filter((d) => bests[String(d)] !== undefined);
  if (graded.length === 0) return null;
  const rest = days.filter((d) => bests[String(d)] === undefined);
  return (
    <section class="card best-days" data-testid="best-days">
      <h2>{t('ui.bestDays.title')}</h2>
      <p class="muted">{t('ui.bestDays.note')}</p>
      <ul class="best-days__list">
        {graded.map((d) => {
          const b = bests[String(d)];
          return b ? (
            <li key={d} data-testid="best-day">
              {t('ui.bestDays.day', { day: d, grade: t(`ui.grade.${b.grade}`), spare: spareText(b.spareMs) })}
              {bestMarks(b)}
            </li>
          ) : null;
        })}
      </ul>
      {rest.length > 0 ? (
        <p class="muted" data-testid="best-days-none">
          {t('ui.bestDays.none', { n: rest.length, days: dayRuns(rest) })}
        </p>
      ) : null}
    </section>
  );
}

// ---------- endings ----------

/** Every ending this build's campaign can come to: the ones found on this device by name, the rest unnamed. */
function EndingsGallery() {
  const all = reachableEndings(gameContent);
  const seen = settings.value.endingsSeen;
  const found = all.filter((e) => seen.includes(e.id)).length;
  return (
    <section class="card gallery" data-testid="endings">
      <h2>{t('ui.gallery.title')}</h2>
      <p class="muted" data-testid="endings-count">
        {t('ui.gallery.count', { n: found, total: all.length })}
      </p>
      <ol class="gallery__list">
        {all.map((e) =>
          seen.includes(e.id) ? (
            <li key={e.id} data-testid="ending-found">
              <details>
                <summary>{t(e.title)}</summary>
                {paragraphs(t(e.text)).map((p) => (
                  <p key={p}>{p}</p>
                ))}
              </details>
            </li>
          ) : (
            <li key={e.id} class="muted" data-testid="ending-unfound">
              {t('ui.gallery.unfound')}
            </li>
          ),
        )}
      </ol>
    </section>
  );
}

/**
 * How the run stood when it ended: the host at Ragnarök part by part, with what the endings ask of it
 * (naming only endings found on this device), the powers' standing, and where the souls went.
 */
/** A text's paragraphs: an ending's words run to several, a blank line between each. */
function paragraphs(text: string): string[] {
  return text.split(/\n\s*\n/).filter((p) => p.trim() !== '');
}

/** What became of everyone (docs/tech-spec.md §55): the epilogue's lines for the run, by section. */
function Epilogue({ run }: { run: RunState }) {
  const campaign = campaignOf(gameContent);
  const lines = epilogueFor(run, campaign);
  if (lines.length === 0) return null;
  const params = epilogueParams(run);
  return (
    <section class="card epilogue" data-testid="epilogue">
      <h2>{t('ui.epilogue.title')}</h2>
      {campaign.epilogue?.draft ? <p class="scene__draft">{t('ui.campaign.draft')}</p> : null}
      {EPILOGUE_SECTIONS.map((section) => {
        const here = lines.filter((l) => l.section === section);
        return here.length === 0 ? null : (
          <div key={section} class="epilogue__section" data-section={section}>
            <h3>{t(`ui.epilogue.${section}`)}</h3>
            {here.map((l) => (
              <p key={l.slot} data-testid="epilogue-line" data-slot={l.slot}>
                {t(l.text, params)}
              </p>
            ))}
          </div>
        );
      })}
    </section>
  );
}

/** A front's name, and a host's, from the build's last battle (docs/tech-spec.md §54). */
function frontName(id: string): string {
  return t(campaignOf(gameContent).ragnarok?.fronts.find((f) => f.id === id)?.name ?? id);
}
function hostName(id: string): string {
  return t(campaignOf(gameContent).ragnarok?.hosts.find((h) => h.id === id)?.name ?? id);
}

/** Who stood at a front, the arms bought for it (docs/tech-spec.md §56), and how many of its own ran. */
function stoodText(f: FrontBattle): string {
  const who =
    f.stood.length > 0
      ? listText(f.stood.map((s) => t('ui.ragnarok.stood', { host: hostName(s.host), souls: s.souls })))
      : t('ui.ragnarok.nobody');
  // A battle fought before arms were sold has none; the chooser's own is where the player rode (§58).
  const arms = f.arms > 0 ? [t('ui.ragnarok.arms', { n: f.arms })] : [];
  const you = (f.ride ?? 0) > 0 ? [t('ui.ragnarok.you', { n: f.ride ?? 0 })] : [];
  const ran = f.ran > 0 ? [t('ui.ragnarok.ran', { n: f.ran })] : [];
  return [who, ...arms, ...you, ...ran].join('; ');
}

/**
 * Souls the battle names (docs/tech-spec.md §54), the first three by name and the day they came, then how many more
 * of `count` (a run begun before souls were named counts more than it names).
 */
function namesText(named: readonly NamedSoul[], count = named.length): string {
  const shown = named.slice(0, 3).map((n) => t('ui.ragnarok.soul', { name: n.name, day: n.day }));
  const more = Math.max(0, count - shown.length);
  return listText(more > 0 ? [...shown, t('ui.ragnarok.more', { n: more })] : shown);
}

/** Who ran from a front's own host, by name, and the story's own souls in it where that host stood (§54). */
function FrontNames({ run, f }: { run: RunState; f: FrontBattle }) {
  const own = campaignOf(gameContent).ragnarok?.hosts.find((h) => h.front === f.id);
  if (!own) return null;
  const { runs, story } = namedIn(run, own.hall);
  const stood = f.stood.some((s) => s.host === own.id);
  return (
    <>
      {runs.length > 0 ? (
        <p class="front__names" data-testid="front-ran">
          {t('ui.ragnarok.fled', { names: namesText(runs, f.ran) })}
        </p>
      ) : null}
      {stood && story.length > 0 ? (
        <p class="front__names" data-testid="front-stood">
          {t('ui.ragnarok.foughtHere', { names: namesText(story) })}
        </p>
      ) : null}
    </>
  );
}

/** What an ending asks of the battle, in words. */
function markText(m: BattleMark): string {
  return listText([
    ...(m.held.length > 0 ? [t('ui.ragnarok.markHeld', { fronts: listText(m.held.map(frontName)) })] : []),
    ...(m.atLeast !== undefined ? [t('ui.ragnarok.markAtLeast', { n: m.atLeast })] : []),
    ...(m.atMost !== undefined ? [t('ui.ragnarok.markAtMost', { n: m.atMost })] : []),
  ]);
}

/** In the ending's report, who ran from a front's own host, by name (docs/tech-spec.md §54). */
function ReportRan({ run, f }: { run: RunState; f: FrontBattle }) {
  const own = campaignOf(gameContent).ragnarok?.hosts.find((h) => h.front === f.id);
  const runs = own ? namedIn(run, own.hall).runs : [];
  return runs.length > 0 ? (
    <span class="report__ran" data-testid="report-ran">
      {t('ui.ragnarok.fled', { names: namesText(runs, f.ran) })}
    </span>
  ) : null;
}

function RagnarokReport({ run }: { run: RunState }) {
  const marks = hostMarks(gameContent);
  const host = hostParts(run);
  const seen = settings.value.endingsSeen;
  const title = (id: string) => {
    const e = campaignOf(gameContent).endings.find((x) => x.id === id);
    return e && seen.includes(id) ? t(e.title) : t('ui.ending.unfound');
  };
  const met = factionsMet(run);
  const sent = DESTINATIONS.filter((d) => (run.sent?.[d] ?? 0) > 0);
  const rows: readonly [string, number, number][] = [
    ['ui.ending.worthy', host.worthy, 2 * host.worthy],
    ['ui.ending.unworthy', host.unworthy, -host.unworthy],
    ['ui.ending.folkvangr', host.folkvangr, 2 * host.folkvangr],
    ['ui.ending.helLegion', host.hel, 2 * host.hel],
    ['ui.ending.naglfar', host.naglfar, -2 * host.naglfar],
  ];
  const battle = run.battle;
  // What the endings ask of the battle, in a build that has one, whether or not the run got that far.
  const asked = battleMarks(gameContent);
  return (
    <>
      {battle || asked.length > 0 ? (
        <section class="card" data-testid="battle-report">
          <h2>{t('ui.ragnarok.report')}</h2>
          {battle ? null : <p data-testid="battle-unfought">{t('ui.ragnarok.unfought')}</p>}
          <ul class="report__fronts">
            {(battle?.fronts ?? []).map((f) => (
              <li key={f.id} data-front={f.id} data-held={f.held}>
                {t('ui.ragnarok.reportFront', {
                  front: frontName(f.id),
                  verdict: t(f.held ? 'ui.ragnarok.held' : 'ui.ragnarok.fell'),
                  strength: f.strength,
                  foe: f.foe,
                })}
                <span class="muted"> ({stoodText(f)})</span>
                <ReportRan run={run} f={f} />
              </li>
            ))}
          </ul>
          {asked.length > 0 ? (
            <>
              <p class="muted report__lead">{t('ui.ragnarok.marks')}</p>
              <ul class="report__marks" data-testid="battle-marks">
                {asked.map((m) => (
                  <li key={m.ending}>{t('ui.ragnarok.mark', { ending: title(m.ending), what: markText(m) })}</li>
                ))}
              </ul>
            </>
          ) : null}
        </section>
      ) : null}
      {marks.length > 0 ? (
        <section class="card" data-testid="host">
          <h2>{t('ui.ending.host')}</h2>
          <table class="ledger">
            <tbody>
              {rows.map(([key, n, worth]) => (
                <tr key={key}>
                  <td>{t(key, { n })}</td>
                  <td class="num">{signed(worth)}</td>
                </tr>
              ))}
              <tr class="ledger__total">
                <td>{t('ui.ending.hostTotal')}</td>
                <td class="num" data-testid="host-total">
                  {host.total}
                </td>
              </tr>
            </tbody>
          </table>
          <p class="muted report__lead">{t('ui.ending.marks')}</p>
          <ul class="report__marks" data-testid="host-marks">
            {marks.map((m) => (
              <li key={`${m.ending}:${m.atLeast ?? ''}:${m.atMost ?? ''}`}>
                {m.atLeast !== undefined
                  ? t('ui.ending.markAtLeast', { ending: title(m.ending), n: m.atLeast })
                  : t('ui.ending.markAtMost', { ending: title(m.ending), n: m.atMost ?? 0 })}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {met.length > 0 ? (
        <section class="card" data-testid="final-standing">
          <h2>{t('ui.ending.standing')}</h2>
          <table class="ledger">
            <tbody>
              {[...met]
                .sort((x, y) => run.standing[y] - run.standing[x])
                .map((f) => (
                  <tr key={f}>
                    <td>
                      {factionName(f, run.day)}
                      {standingLead(run, f) > 0 ? <span class="muted"> {t('ui.ending.led')}</span> : null}
                    </td>
                    <td class="num">{signed(run.standing[f])}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </section>
      ) : null}
      {sent.length > 0 ? (
        <section class="card" data-testid="sent">
          <h2>{t('ui.ending.sent')}</h2>
          <p>{sent.map((d) => `${t(`dest.${d}`)} ${run.sent?.[d] ?? 0}`).join(' · ')}</p>
        </section>
      ) : null}
    </>
  );
}

// ---------- save slots ----------

function SlotSummary({ record }: { record: SlotRecord }) {
  const run = record.save.mornings[record.save.mornings.length - 1];
  if (!run) return null;
  const home = run.family.filter((m) => m.status !== 'gone').length;
  return (
    <p data-testid="slot-summary">
      {t('ui.campaign.summary', { day: run.day, rings: run.rings, home, family: run.family.length })}
      {run.story ? ` · ${t('ui.campaign.story')}` : ''}
      {run.oath ? ` · ${t('ui.campaign.sworn')}` : ''}
      {run.weave ? ` · ${t('ui.campaign.woven')}` : ''}
      {run.slice ? ` · ${t('ui.campaign.slice')}` : ''}
      <OriginName run={run} />
    </p>
  );
}

/** Who she was in life (docs/tech-spec.md §72), after the run's other marks; nothing for a run begun without. */
function OriginName({ run }: { run: RunState }) {
  const o = originOf(run, gameContent);
  return o ? <span data-testid="origin-name">{` · ${t(o.name)}`}</span> : null;
}

/** A night that ends the run stays in the day's log; any other night starts a new morning. */
function hasEnded(record: SlotRecord): boolean {
  return record.save.log[record.save.log.length - 1]?.t === 'endNight';
}

type Start = 'campaign' | 'play' | 'fromJump';

/** How a new run can start: the campaign, or (in builds that have one) the vertical slice, played or from its jump. */
function StartChoice({ i, value, onChange }: { i: number; value: Start; onChange: (s: Start) => void }) {
  if (!gameContent.campaign?.slice) return null;
  const options: Start[] = ['campaign', 'play', 'fromJump'];
  return (
    <fieldset class="slot__start">
      {options.map((o) => (
        <label key={o}>
          <input
            type="radio"
            name={`start-${i}`}
            checked={value === o}
            data-testid={`start-${o}-${i}`}
            onChange={() => onChange(o)}
          />{' '}
          {t(`ui.campaign.start.${o}`, { day: gameContent.campaign?.slice?.day ?? 0 })}
        </label>
      ))}
    </fieldset>
  );
}

/** What an origin gives, in words (docs/tech-spec.md §72): its perk, a line each, then who it brings home. */
function perkLines(o: OriginDef): string[] {
  const p = o.perk;
  return [
    ...(p.tools ?? []).map((x) => t('ui.origin.tool', { tool: t(`tool.${x.tool}`), s: x.costS })),
    ...(p.freeQuestions ? [t('ui.origin.questions', { n: p.freeQuestions })] : []),
    ...(p.sunS ? [t('ui.origin.sun', { s: p.sunS })] : []),
    ...(p.startRings ? [t('ui.origin.rings', { n: p.startRings })] : []),
    ...(p.shopPct ? [t('ui.origin.shop', { off: 100 - p.shopPct })] : []),
    ...(o.member ? [t('ui.origin.member', { name: t(o.member.name) })] : []),
  ];
}

/**
 * Who she was in life (docs/tech-spec.md §72), for a new run of the full game: one of the build's origins, or nobody
 * in particular, the household as it always was. Not for the vertical slice. Folded, saying the choice, so three
 * empty slots stay short on a phone.
 */
function OriginChoice({ i, value, onChange }: { i: number; value: string; onChange: (id: string) => void }) {
  const origins = gameContent.campaign?.origins;
  if (!origins) return null;
  const chosen = origins.find((o) => o.id === value);
  return (
    <details class="slot__origins" data-testid={`origins-${i}`}>
      <summary>
        {t('ui.origin.legend')} <span class="muted">{chosen ? t(chosen.name) : t('ui.origin.none')}</span>
      </summary>
      <fieldset class="slot__origin">
        <legend class="sr-only">{t('ui.origin.legend')}</legend>
        <label class="origin">
          <input
            type="radio"
            name={`origin-${i}`}
            checked={value === ''}
            data-testid={`origin-none-${i}`}
            onChange={() => onChange('')}
          />
          <span class="origin__body">
            <b>{t('ui.origin.none')}</b>
            <span class="origin__text">{t('ui.origin.none.text')}</span>
          </span>
        </label>
        {origins.map((o) => (
          <label key={o.id} class="origin">
            <input
              type="radio"
              name={`origin-${i}`}
              checked={value === o.id}
              data-testid={`origin-${o.id}-${i}`}
              onChange={() => onChange(o.id)}
            />
            <span class="origin__body">
              <b>{t(o.name)}</b>
              <span class="origin__text">{t(o.text)}</span>
              {perkLines(o).map((line) => (
                <span key={line} class="origin__perk">
                  {line}
                </span>
              ))}
            </span>
          </label>
        ))}
      </fieldset>
    </details>
  );
}

function Slot({ i, record }: { i: number; record: SlotRecord | null }) {
  const [story, setStory] = useState(false);
  const [oath, setOath] = useState(false);
  const [woven, setWoven] = useState(false);
  const [start, setStart] = useState<Start>('campaign');
  const [origin, setOrigin] = useState('');
  const [confirm, setConfirm] = useState(false);
  const days = record ? replayableDays(record.save) : [];
  const [day, setDay] = useState(days[days.length - 1] ?? 1);
  if (!record) {
    return (
      <section class="card slot" data-testid={`slot-${i}`}>
        <h2>{t('ui.campaign.slot', { n: i + 1 })}</h2>
        <p class="muted">{t('ui.campaign.empty')}</p>
        <label class="slot__story">
          <input
            type="checkbox"
            checked={story}
            disabled={oath}
            data-testid={`story-${i}`}
            onChange={(e) => setStory((e.target as HTMLInputElement).checked)}
          />{' '}
          {t('ui.campaign.storyMode')}
        </label>
        {/* The oath (docs/tech-spec.md §49): for players who want it hard. Not with Story Mode. */}
        <label class="slot__story">
          <input
            type="checkbox"
            checked={oath}
            disabled={story}
            data-testid={`oath-${i}`}
            onChange={(e) => setOath((e.target as HTMLInputElement).checked)}
          />{' '}
          {t('ui.campaign.oath')}
        </label>
        {/* The Norns' weave (docs/tech-spec.md §53): opened by reaching an ending on this device. */}
        {campaignOf(gameContent).weaving ? (
          <label class="slot__story">
            <input
              type="checkbox"
              checked={woven && weaveOpen(gameContent, settings.value.endingsSeen)}
              disabled={!weaveOpen(gameContent, settings.value.endingsSeen)}
              data-testid={`weave-${i}`}
              onChange={(e) => setWoven((e.target as HTMLInputElement).checked)}
            />{' '}
            {t('ui.campaign.weave')}
            {weaveOpen(gameContent, settings.value.endingsSeen) ? null : (
              <span class="muted"> ({t('ui.campaign.weaveLocked')})</span>
            )}
          </label>
        ) : null}
        <StartChoice i={i} value={start} onChange={setStart} />
        {start === 'campaign' ? <OriginChoice i={i} value={origin} onChange={setOrigin} /> : null}
        <div class="row">
          <button
            type="button"
            class="btn btn--primary"
            data-testid={`new-${i}`}
            onClick={() =>
              start === 'campaign'
                ? newCampaign(i, story, undefined, oath && !story, woven, origin || undefined)
                : newCampaign(i, story, start, oath && !story, woven)
            }
          >
            {t('ui.campaign.new')}
          </button>
        </div>
      </section>
    );
  }
  const ended = hasEnded(record);
  return (
    <section class="card slot" data-testid={`slot-${i}`}>
      <h2>{t('ui.campaign.slot', { n: i + 1 })}</h2>
      <SlotSummary record={record} />
      {ended ? <p class="muted">{t('ui.campaign.endedShort')}</p> : null}
      <div class="row">
        <button type="button" class="btn btn--primary" data-testid={`continue-${i}`} onClick={() => openSlot(i)}>
          {ended ? t('ui.campaign.seeEnding') : t('ui.campaign.continue')}
        </button>
        <PlaytestButton i={i} />
      </div>
      {days.length > 0 ? (
        <div class="row">
          <label>
            {t('ui.campaign.replay')}{' '}
            <select
              value={day}
              data-testid={`replay-day-${i}`}
              onChange={(e) => setDay(Number((e.target as HTMLSelectElement).value))}
            >
              {days.map((d) => (
                <option key={d} value={d}>
                  {t('ui.campaign.day', { n: d })}
                </option>
              ))}
            </select>
          </label>
          <button type="button" class="btn" data-testid={`replay-${i}`} onClick={() => replayFrom(i, day)}>
            {t('ui.campaign.replayGo')}
          </button>
          <button
            type="button"
            class="btn"
            data-testid={`branch-${i}`}
            disabled={emptySlot() === null}
            onClick={() => branchFrom(i, day)}
          >
            {t('ui.campaign.branchGo')}
          </button>
        </div>
      ) : null}
      {days.length > 0 ? (
        <p class="muted">{t(emptySlot() === null ? 'ui.campaign.replayWarnFull' : 'ui.campaign.replayWarn')}</p>
      ) : null}
      {confirm ? (
        <div class="row">
          <span>{t('ui.campaign.deleteConfirm')}</span>
          <button
            type="button"
            class="btn btn--danger btn--small"
            data-testid={`delete-yes-${i}`}
            onClick={() => {
              deleteSlot(i);
              setConfirm(false);
            }}
          >
            {t('ui.campaign.deleteYes')}
          </button>
          <button type="button" class="btn btn--small" data-back onClick={() => setConfirm(false)}>
            {t('ui.campaign.cancel')}
          </button>
        </div>
      ) : (
        <button
          type="button"
          class="btn btn--quiet btn--small"
          data-testid={`delete-${i}`}
          onClick={() => setConfirm(true)}
        >
          {t('ui.campaign.delete')}
        </button>
      )}
    </section>
  );
}

/** A slot whose save this build can't read: kept as found, to copy for a bug report or clear. */
function UnreadableSlot({ i }: { i: number }) {
  const [copy, setCopy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  return (
    <section class="card slot slot--unreadable" data-testid={`slot-${i}`}>
      <h2>{t('ui.campaign.slot', { n: i + 1 })}</h2>
      <p data-testid={`unreadable-${i}`}>{t('ui.campaign.unreadable')}</p>
      <div class="row">
        <button
          type="button"
          class="btn btn--small"
          data-testid={`unreadable-copy-${i}`}
          aria-expanded={copy}
          onClick={() => setCopy(!copy)}
        >
          {t('ui.campaign.unreadable.copy')}
        </button>
        {confirm ? null : (
          <button
            type="button"
            class="btn btn--quiet btn--small"
            data-testid={`unreadable-clear-${i}`}
            onClick={() => setConfirm(true)}
          >
            {t('ui.campaign.unreadable.clear')}
          </button>
        )}
      </div>
      {copy ? (
        <CopyBox text={unreadableText(i)} file={`chooser-of-the-slain-slot-${i + 1}.json`} id={`unreadable-${i}`} />
      ) : null}
      {confirm ? (
        <div class="row">
          <span>{t('ui.campaign.unreadable.confirm')}</span>
          <button
            type="button"
            class="btn btn--danger btn--small"
            data-testid={`unreadable-clear-yes-${i}`}
            onClick={() => deleteSlot(i)}
          >
            {t('ui.campaign.deleteYes')}
          </button>
          <button type="button" class="btn btn--small" data-back onClick={() => setConfirm(false)}>
            {t('ui.campaign.cancel')}
          </button>
        </div>
      ) : null}
    </section>
  );
}

function SlotsScreen() {
  const focus = useAutoFocus<HTMLHeadingElement>();
  const kept = storageKept.value;
  return (
    <main class="screen screen--campaign">
      <h1 ref={focus} tabIndex={-1} data-testid="campaign-title">
        {t('ui.campaign')}
      </h1>
      <p class="muted">{t(manifest.edition === 'demo' ? 'ui.campaign.hint.demo' : 'ui.campaign.hint.full')}</p>
      {kept === 'maybe' || kept === 'session' ? (
        <p class="muted" data-testid="backup-hint">
          {t('ui.campaign.backupHint')}
        </p>
      ) : null}
      {Array.from({ length: SLOT_COUNT }, (_, i) =>
        unreadable.value[i] ? (
          <UnreadableSlot key={`${i}:unreadable`} i={i} />
        ) : (
          <Slot key={`${i}:${slots.value[i]?.rev ?? 0}`} i={i} record={slots.value[i] ?? null} />
        ),
      )}
      <EndingsGallery />
      <BestDays />
      <PlaytestDialog slots={slots.value} scenes={scenes} />
      <div class="row">
        <button type="button" class="btn" data-testid="campaign-back" data-back onClick={toTitle}>
          {t('ui.back')}
        </button>
      </div>
    </main>
  );
}

// ---------- scenes ----------

/** A scene's lines as played so far, each followed by notes of whom it moved. */
function SceneLines({
  lines,
  day,
  prefix,
  when,
}: {
  lines: readonly SceneLine[];
  day: number;
  prefix: string;
  /** Which shift a trip home at dawn lands on, for its note; none in the journal or Story Mode. */
  when?: 'today' | 'tomorrow';
}) {
  return (
    <>
      {lines.flatMap((line, i) => [
        <p
          key={`${prefix}:${i}`}
          class={`scene__line${line.chosen ? ' scene__line--chosen' : line.speaker ? ' scene__line--said' : ''}`}
          data-line={i}
        >
          {line.speaker ? <b class="scene__speaker">{t(`speaker.${line.speaker}`)}: </b> : null}
          {line.text}
        </p>,
        ...standingNotes(line.effects, day).map((note) => (
          <p key={`${prefix}:${i}:${note}`} class="scene__note" data-testid="scene-note">
            {note}
          </p>
        )),
        ...(when && sunOf(line.effects) !== 0
          ? [
              <p key={`${prefix}:${i}:sun`} class="scene__note" data-testid="scene-sun-note">
                {`${sunText(sunOf(line.effects), when)}.`}
              </p>,
            ]
          : []),
      ])}
    </>
  );
}

/** What an option that costs rings would leave after tonight's bills. */
function Leaves({ n, floor }: { n: number | null; floor: number }) {
  if (n === null) return null;
  return (
    <>
      {' '}
      <span class={`scene__cost${n < floor ? ' is-debt' : ''}`} data-testid="scene-leaves">
        ({t('ui.scene.leaves', { n })})
      </span>
    </>
  );
}

/** What an option's trip home at dawn does to the next shift's sun (docs/tech-spec.md §50). */
function SunCost({ s, when }: { s: number; when: 'today' | 'tomorrow' }) {
  if (s === 0) return null;
  return (
    <>
      {' '}
      <span class="scene__cost" data-testid="scene-sun">
        ({sunText(s, when)})
      </span>
    </>
  );
}

/**
 * Plays one Ink scene; its effects reach the run once, when the player finishes it. A scene opens at the
 * top of the page, and each choice brings the lines it adds (the choice, then what follows) to the top of
 * the view; the first option, or Continue, takes the keyboard's focus without scrolling (§30).
 */
function SceneView({ id, run, onDone }: { id: string; run: RunState; onDone?: () => void }) {
  useStoryText();
  const [env] = useState(() => sceneEnv(run, id));
  const [choices, setChoices] = useState<number[]>([]);
  const json = scenes[id];
  const focus = useRef<HTMLButtonElement>(null);
  const section = useRef<HTMLElement>(null);
  // How many lines were shown when the last choice was made: the index of the first line it added.
  const shown = useRef(0);
  useLayoutEffect(() => {
    if (choices.length === 0) toTop();
    else toTopOf(section.current?.querySelector(`[data-line="${shown.current}"]`));
    focus.current?.focus({ preventScroll: true });
  }, [choices.length]);
  const a = active.value;
  if (!json || !a) return null;
  const frame = playScene(json, env, choices);
  const first = frame.choices.findIndex((c) => !c.locked);
  // Options that cost rings are weighed against tonight's bills, with the scene's effects so far (and at
  // night each option's own: a healer who cures means no medicine to buy) (docs/tech-spec.md §23).
  const outlookAfter = (effects: readonly Effect[]) => {
    const r = withEffects(run, effects);
    return { rings: r.rings, night: nightOutlook(r, { content: gameContent, ctx: a.ctx }, defaultBills(r)) };
  };
  const costly = !frame.done && frame.choices.some((c) => c.rings !== undefined);
  const now = costly ? outlookAfter(frame.effects) : null;
  const leaves = (i: number) =>
    now && run.phase === 'night' ? outlookAfter(playScene(json, env, [...choices, i]).effects).night.rings : null;
  const floor = campaignOf(gameContent).debtFloor;
  // A trip home at dawn (docs/tech-spec.md §50) lands on today's shift in the morning, else on tomorrow's. Story
  // Mode has no sun to lose.
  const when = run.story ? undefined : run.phase === 'morning' ? 'today' : 'tomorrow';
  const sunAfter = (i: number) =>
    when && !frame.done ? sunOf(playScene(json, env, [...choices, i]).effects) - sunOf(frame.effects) : 0;
  return (
    <section ref={section} class="card scene" data-testid="scene" data-scene={id}>
      {frame.draft ? (
        <p class="scene__draft" data-testid="scene-draft">
          {t('ui.campaign.draft')}
        </p>
      ) : null}
      <SceneLines lines={frame.lines} day={run.day} prefix={String(choices.length)} when={when} />
      {now ? (
        <p class="scene__purse" data-testid="scene-purse">
          {t('ui.scene.purse', {
            rings: now.rings,
            bills: now.night.cost.hearth + now.night.cost.food + now.night.cost.medicine,
            draupnir: now.night.draupnir,
            phase: run.phase,
          })}
        </p>
      ) : null}
      <div class="scene__choices">
        {frame.done ? (
          <button
            type="button"
            class="btn btn--primary"
            data-testid="scene-done"
            ref={focus}
            onClick={() => {
              dispatch({ t: 'scene', id, choices, effects: frame.effects });
              // What follows the scene (the day's orders, the night's bills, or the next scene) opens at the top.
              toTop();
              onDone?.();
            }}
          >
            {t('ui.campaign.next')}
          </button>
        ) : (
          frame.choices.map((c, i) =>
            c.locked ? (
              // An option the purse can't cover stays in sight, with what it needs.
              <button
                key={`${choices.length}:${c.text}`}
                type="button"
                class="btn scene__choice is-locked"
                data-testid="scene-choice-locked"
                disabled
              >
                {c.text}{' '}
                <span class="scene__cost">({t('ui.scene.needsRings', { n: c.rings ?? 0, have: env.rings })})</span>
              </button>
            ) : (
              <button
                key={`${choices.length}:${c.text}`}
                type="button"
                class="btn scene__choice"
                data-testid="scene-choice"
                ref={i === first ? focus : undefined}
                onClick={() => {
                  shown.current = frame.lines.length;
                  setChoices([...choices, i]);
                }}
              >
                {c.text}
                <Leaves n={c.rings !== undefined ? leaves(i) : null} floor={floor} />
                <SunCost s={when ? sunAfter(i) : 0} when={when ?? 'tomorrow'} />
              </button>
            ),
          )
        )}
      </div>
    </section>
  );
}

// ---------- someone at the desk ----------

/** The scene of whoever is at the desk now (docs/tech-spec.md §46), if this build ships it: read by the shift. */
export function deskDue(): string | null {
  const a = active.value;
  const id = a ? deskVisit(a.run, gameContent)?.scene : undefined;
  return id && scenes[id] ? id : null;
}

/**
 * Someone at the desk (docs/tech-spec.md §46): their scene over the desk, with the sun held from when they come
 * (a pause, which the shift saves) until the scene ends. Their words reach the run at the day's audit.
 */
export function DeskVisitDialog({ id }: { id: string }) {
  useEffect(() => {
    if (session.peek()?.state.clock.pausedAt === null) act({ t: 'pause' });
  }, [id]);
  const a = active.value;
  if (!a) return null;
  return (
    <div class="overlay overlay--scene" data-testid="desk-visit">
      <div class="dialog dialog--scene" role="dialog" aria-modal="true" aria-label={t('ui.desk.visit')}>
        <SceneView id={id} run={a.run} onDone={() => act({ t: 'resume' })} />
      </div>
    </div>
  );
}

// ---------- journal ----------

/** Whether the journal is open over the morning, night or ending screen (which stays as it was underneath). */
const journalOpen = signal(false);

function JournalButton() {
  return (
    <button type="button" class="btn btn--quiet" data-testid="journal-open" onClick={() => (journalOpen.value = true)}>
      {t('ui.journal')}
    </button>
  );
}

/** A scene from the journal, played again with the choices made and the view it had then. */
function JournalScene({ entry, seed }: { entry: JournalEntry; seed: string }) {
  const json = scenes[entry.scene];
  const day = gameContent.days.find((d) => d.day === entry.day);
  const when = day?.scenes;
  const desk = (day?.queue.visits ?? []).some((v) => v.scene === entry.scene);
  const label =
    when?.morning === entry.scene
      ? 'ui.journal.morning'
      : when?.night === entry.scene
        ? 'ui.journal.night'
        : desk
          ? 'ui.journal.desk'
          : null;
  let lines: readonly SceneLine[] | null = null;
  try {
    lines = json ? playScene(json, journalEnv(seed, entry), entry.choices).lines : null;
  } catch {
    // A rewrite since then changed its choices; the journal says so rather than guessing.
    lines = null;
  }
  return (
    <section class="journal__scene" data-testid="journal-scene">
      {label ? <h4>{t(label)}</h4> : null}
      {lines ? (
        <SceneLines lines={lines} day={entry.day} prefix={entry.scene} />
      ) : (
        <p class="muted">{t('ui.journal.changed')}</p>
      )}
    </section>
  );
}

/**
 * What's still in play (the threads the endings hang on), then every scene played, newest day first:
 * letters, choices and all. Only the days opened are played again.
 */
function JournalView() {
  const a = active.value;
  const focus = useAutoFocus<HTMLButtonElement>();
  const entries = a?.record.save.journal ?? [];
  const days = [...new Set(entries.map((e) => e.day))].sort((x, y) => y - x);
  const [open, setOpen] = useState<readonly number[]>(days.slice(0, 1));
  if (!a) return null;
  const threads = threadsInPlay(a.run, gameContent);
  const close = () => {
    journalOpen.value = false;
  };
  return (
    <div
      class="journal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="journal-title"
      data-testid="journal"
      onKeyDown={(e) => {
        if (e.key === 'Escape') close();
      }}
    >
      <div class="journal__page">
        <div class="journal__head">
          <h2 id="journal-title">{t('ui.journal')}</h2>
          <button type="button" class="btn" ref={focus} data-testid="journal-close" data-back onClick={close}>
            {t('ui.journal.close')}
          </button>
        </div>
        {threads.length > 0 ? (
          <section class="card journal__threads" data-testid="journal-threads">
            <h3>{t('ui.journal.threads')}</h3>
            <ul>
              {threads.map((th) => (
                <li key={th.id}>{t(th.text, th.n !== undefined ? { n: th.n } : {})}</li>
              ))}
            </ul>
          </section>
        ) : null}
        {days.length === 0 ? <p class="muted">{t('ui.journal.empty')}</p> : null}
        {days.map((day) => (
          <details
            key={day}
            class="journal__day"
            open={open.includes(day)}
            data-testid="journal-day"
            onToggle={(e) => {
              const now = (e.currentTarget as HTMLDetailsElement).open;
              if (now !== open.includes(day)) setOpen(now ? [...open, day] : open.filter((d) => d !== day));
            }}
          >
            <summary>
              <h3 class="journal__dayTitle">{t('ui.campaign.day', { n: day })}</h3>
            </summary>
            {open.includes(day)
              ? entries
                  .filter((e) => e.day === day)
                  .map((e) => <JournalScene key={e.scene} entry={e} seed={a.run.seed} />)
              : null}
          </details>
        ))}
      </div>
    </div>
  );
}

/** After a night below the debt floor, how many more end the run, on the morning and night screens. */
function DebtBanner({ run }: { run: RunState }) {
  const limit = debtLimit(gameContent);
  if (run.debtNights < 1 || limit === null) return null;
  return (
    <div class="banner banner--bad" role="status" data-testid="debt-banner">
      <p>
        {t('ui.debt.banner', {
          n: run.debtNights,
          floor: campaignOf(gameContent).debtFloor,
          left: limit - run.debtNights,
        })}
      </p>
    </div>
  );
}

/**
 * The scene still to be played now, if there is one this build ships: the day's own first, then its origin's
 * (docs/tech-spec.md §72).
 */
function pendingScene(run: RunState, which: 'morning' | 'night'): string | null {
  return scenesFor(run, gameContent, which).find((id) => scenes[id] && !run.scenes.includes(id)) ?? null;
}

// ---------- morning ----------

function NightNews({ events }: { events: readonly RunEvent[] }) {
  const news = events.flatMap((e) => {
    if (e.e === 'family') return [t(`ui.news.${e.change}`, { name: familyShort(gameContent, e.id) })];
    if (e.e === 'draupnir') return [t('ui.news.draupnir', { n: e.rings })];
    // The reprieve (docs/tech-spec.md §56) says who paid, in the build's words.
    const reprieve = campaignOf(gameContent).reprieve;
    if (e.e === 'reprieve' && reprieve) return [t(reprieve.text)];
    return [];
  });
  if (news.length === 0) return null;
  return (
    <section class="card card--news" data-testid="night-news">
      {news.map((n) => (
        <p key={n}>{n}</p>
      ))}
    </section>
  );
}

function RulebookChanges({ day }: { day: number }) {
  if (day === 1) return null;
  const added = gameContent.rules.filter((r) => r.since === day);
  const reworded = gameContent.rules.filter((r) => r.since < day && r.texts?.some((x) => x.since === day));
  const repealed = gameContent.rules.filter((r) => r.until === day);
  const tools = gameContent.tools.filter((x) => x.since === day);
  const procedures = (gameContent.procedures ?? []).filter((p) => p.since === day);
  if (added.length + reworded.length + repealed.length + tools.length + procedures.length === 0) return null;
  return (
    <div class="changes" data-testid="rulebook-changes">
      {added.map((r) => (
        <p key={r.id}>
          <span class="badge badge--new">{t('ui.campaign.new.badge')}</span> {t(ruleText(r, day))}
        </p>
      ))}
      {reworded.map((r) => (
        <p key={r.id} data-testid="rule-changed">
          <span class="badge badge--new">{t('ui.campaign.changed.badge')}</span> {t(ruleText(r, day))}
        </p>
      ))}
      {repealed.map((r) => (
        <p key={r.id}>
          <span class="badge badge--old">{t('ui.campaign.repealed.badge')}</span> {t(ruleText(r, day - 1))}
        </p>
      ))}
      {procedures.map((p) => (
        <p key={p.id}>
          <span class="badge badge--new">{t('ui.campaign.new.badge')}</span> {t(p.text)}
        </p>
      ))}
      {tools.map((x) => (
        <p key={x.id}>
          <span class="badge badge--new">{t('ui.campaign.new.badge')}</span>{' '}
          {t('ui.campaign.newTool', { tool: t(`tool.${x.id}`), s: x.cost })}
        </p>
      ))}
    </div>
  );
}

function Morning() {
  const a = active.value;
  if (!a) return null;
  const { run, ctx } = a;
  const scene = pendingScene(run, 'morning');
  const sunS = ctx.spec.sunS + (shiftMods(run, gameContent).sunS ?? 0);
  // Story Mode has no sun (and no fines): only the rule tracker means anything there. Under the oath (docs/tech-spec.md
  // §49) fines are never waived.
  const assists = currentAssists(!run.story && !run.oath, run.story);
  const assisted = assistText(assists);
  const bills = billTotal(run, economyOf({ content: gameContent, ctx }), defaultBills(run), gameContent);
  const tonight = bills.hearth + bills.food + bills.medicine + (rankOf(run, gameContent)?.tithe ?? 0);
  return (
    <main class="screen screen--morning">
      <h1 data-testid="morning-title">{t('ui.campaign.day', { n: run.day })}</h1>
      <p class="muted">
        {t('ui.campaign.purse', { n: run.rings })}
        {run.story ? ` · ${t('ui.campaign.story')}` : ''}
        {run.oath ? ` · ${t('ui.campaign.sworn')}` : ''}
        {run.weave ? ` · ${t('ui.campaign.woven')}` : ''}
        <OriginName run={run} />
        <RankName run={run} />
      </p>
      <StandingStrip run={run} />
      <DebtBanner run={run} />
      {a.rewound ? (
        <div class="banner" role="status">
          <p>{t('ui.campaign.rewound')}</p>
        </div>
      ) : null}
      <NightNews events={lastNight.value} />
      {scene ? (
        <SceneView key={scene} id={scene} run={run} />
      ) : (
        <>
          <AppealCard run={run} />
          <PromotionCard run={run} />
          <RequestCards run={run} fined={!run.story && !assists.noFines} />
          <EventCard run={run} sunS={ctx.spec.sunS} sunPct={assists.sunPct} />
          <section class="card">
            <Decree ctx={ctx} />
            <WeaveNote run={run} />
            <RulebookChanges day={run.day} />
            <WaitingNote run={run} />
            <FavoursToday run={run} noFines={assists.noFines === true} />
            <p class="briefing__queue">
              {run.story
                ? t('ui.campaign.untimed')
                : t('ui.campaign.sun', { time: clockText(atSunSpeed(sunS * 1000, assists.sunPct)) })}
            </p>
            {!run.story && run.dawnS ? (
              <p class="muted" data-testid="dawn-note">
                {t(run.dawnS < 0 ? 'ui.campaign.dawnLess' : 'ui.campaign.dawnMore', {
                  time: clockText(Math.abs(run.dawnS) * 1000),
                })}
              </p>
            ) : null}
            <p class="muted" data-testid="tonight-bills">
              {t('ui.campaign.tonightBills', { n: tonight })}
            </p>
          </section>
          <FavourGuide run={run} />
          <details class="card morning__assists" data-testid="morning-assists">
            <summary>
              {t('ui.settings.assists')}
              {assisted ? <span class="muted">: {assisted}</span> : null}
            </summary>
            <AssistSettings campaign={!run.story && !run.oath} sun={!run.story} titled={false} />
            {run.oath ? (
              <p class="muted" data-testid="oath-terms">
                {t('ui.campaign.oathTerms')}
              </p>
            ) : null}
          </details>
          <div class="row">
            <button type="button" class="btn btn--primary btn--big" data-testid="to-gate" onClick={toGate}>
              {t('ui.campaign.toGate')}
            </button>
          </div>
        </>
      )}
      <div class="row">
        <JournalButton />
        <button type="button" class="btn btn--quiet" data-testid="campaign-quit" onClick={leaveCampaign}>
          {t('ui.campaign.quit')}
        </button>
      </div>
      {journalOpen.value ? <JournalView /> : null}
    </main>
  );
}

// ---------- the Norns' weave ----------

/** The Norns' weave (docs/tech-spec.md §53), the morning of the first day it changes: its name and what it does. */
function WeaveNote({ run }: { run: RunState }) {
  const weave = weaveOf(run, gameContent);
  if (!weave || weaveDay(gameContent, weave) !== run.day) return null;
  return (
    <div class="banner" role="status" data-testid="weave-note">
      <p>
        <b>{t('ui.weave.title', { name: t(weave.name) })}</b>
      </p>
      <p>{t(weave.text)}</p>
    </div>
  );
}

// ---------- day events ----------

/**
 * The favour that spares the well any chance of falling sick tonight (docs/tech-spec.md §43), if one does: the day's,
 * as its audit filed them, or before then, those the gate will grant.
 */
function sparingFavour(run: RunState): FavourDef | undefined {
  const today = run.ledger[run.ledger.length - 1];
  const ids = today?.day === run.day ? (today.favours ?? []) : favoursFor(run, gameContent).map((f) => f.id);
  return (campaignOf(gameContent).favours ?? []).find(
    (f) => ids.includes(f.id) && 'sickNights' in f.effect && f.effect.sickChancePct === 0,
  );
}

/** What a day event does tonight (docs/tech-spec.md §52): its bills, and the sickness it brings to the door. */
function eventTonight(run: RunState): { id: string; text: string }[] {
  const ev = eventOn(run, gameContent, run.day);
  if (!ev) return [];
  const bills = Object.entries(ev.costsPct ?? {}).map(([bill, pct]) => ({
    id: `bill-${bill}`,
    text: pct === 0 ? t('ui.event.free', { bill }) : t('ui.event.dearer', { bill, pct: pct ?? 100 }),
  }));
  if (!ev.sickChance) return bills;
  const p = careFor(run, gameContent).sickAnyway ?? 0;
  const spared = sparingFavour(run);
  const sick =
    p > 0 || !spared
      ? { id: 'sick', text: t('ui.event.sick', { p }) }
      : { id: 'spared', text: t('ui.event.spared', { god: factionName(spared.faction, run.day) }) };
  return [...bills, sick];
}

/** Today's day event (docs/tech-spec.md §52), at the morning: what happened, and what it does to the day and night. */
function EventCard({ run, sunS, sunPct }: { run: RunState; sunS: number; sunPct: number | undefined }) {
  const ev = eventOn(run, gameContent, run.day);
  if (!ev) return null;
  const change = eventLineChange(ev, run.day);
  const own = gameContent.days.find((d) => d.day === run.day)?.sunS ?? sunS;
  const sun = sunS - own;
  const notes = [
    ...(change === 0
      ? []
      : [{ id: 'line', text: t(change > 0 ? 'ui.event.more' : 'ui.event.fewer', { n: Math.abs(change) }) }]),
    ...(sun === 0 || run.story
      ? []
      : [
          {
            id: 'sun',
            text: t(sun < 0 ? 'ui.event.sunLess' : 'ui.event.sunMore', {
              time: clockText(atSunSpeed(Math.abs(sun) * 1000, sunPct)),
            }),
          },
        ]),
    ...eventTonight(run),
  ];
  return (
    <section class="card event" data-testid="day-event" data-event={ev.id}>
      <h2 data-testid="day-event-name">{t(ev.name)}</h2>
      <p>{t(ev.text)}</p>
      {notes.map((n) => (
        <p key={n.id} class="muted" data-testid={`day-event-${n.id}`}>
          {n.text}
        </p>
      ))}
    </section>
  );
}

/** Tonight's part of the day's event, on the night screen. */
function EventNight({ run }: { run: RunState }) {
  const ev = eventOn(run, gameContent, run.day);
  const lines = eventTonight(run);
  if (!ev || lines.length === 0) return null;
  return (
    <>
      {lines.map((l) => (
        <p key={l.id} class={l.id === 'sick' ? 'warn' : 'muted'} data-testid={`event-night-${l.id}`}>
          {t('ui.event.tonight', { name: t(ev.name), text: l.text })}
        </p>
      ))}
    </>
  );
}

// ---------- promotion ----------

/** The rank held (docs/tech-spec.md §44), after the purse. */
function RankName({ run }: { run: RunState }) {
  const rank = rankOf(run, gameContent);
  return rank ? <span data-testid="rank"> · {t(rank.name)}</span> : null;
}

/** The morning's offer of a rank: what it brings and what it costs, to take or not. */
function PromotionCard({ run }: { run: RunState }) {
  const def = campaignOf(gameContent).promotion;
  const rank = run.offer ? def?.ranks[run.offer - 1] : undefined;
  if (!def || !rank) return null;
  return (
    <section class="card promotion" data-testid="promotion">
      <h2>{t('ui.promotion.title', { rank: t(rank.name) })}</h2>
      <p class="promotion__words">{t(rank.text)}</p>
      <p class="muted">
        {t('ui.promotion.terms', {
          days: def.cleanDays,
          souls: rank.souls,
          warnings: -rank.warnings,
          wage: rank.wage,
          tithe: rank.tithe,
        })}
      </p>
      <div class="row">
        <button
          type="button"
          class="btn btn--primary"
          data-testid="promotion-take"
          onClick={() => answerPromotion(true)}
        >
          {t('ui.promotion.take')}
        </button>
        <button type="button" class="btn" data-testid="promotion-decline" onClick={() => answerPromotion(false)}>
          {t('ui.promotion.decline')}
        </button>
      </div>
    </section>
  );
}

/** At night, the rank held and its tithe, and the way back down a rank. */
function RankCard({ run }: { run: RunState }) {
  const ranks = campaignOf(gameContent).promotion?.ranks ?? [];
  const rank = rankOf(run, gameContent);
  const today = run.ledger[run.ledger.length - 1];
  const stepped = today?.day === run.day ? today.steppedDown : undefined;
  const from = stepped ? ranks[stepped - 1] : undefined;
  if (!rank && !from) return null;
  const below = run.rank && run.rank > 1 ? ranks[run.rank - 2] : undefined;
  return (
    <section class="card" data-testid="rank-card">
      {from ? <p data-testid="stepped-down">{t('ui.rank.stepped', { rank: t(from.name) })}</p> : null}
      {rank ? (
        <>
          <p>{t('ui.rank.held', { rank: t(rank.name), tithe: rank.tithe })}</p>
          <button type="button" class="btn" data-testid="step-down" onClick={stepDown}>
            {below ? t('ui.rank.stepDownTo', { rank: t(below.name) }) : t('ui.rank.stepDown')}
          </button>
        </>
      ) : null}
    </section>
  );
}

// ---------- the gods' favour ----------

/**
 * Whether a favour does anything today: Story Mode has no sun and no fines, and the assist can waive fines. Rings for
 * nails left long (docs/tech-spec.md §57) are paid in any mode.
 */
const moot = (f: FavourDef, story: boolean, noFines: boolean): boolean =>
  'sunS' in f.effect || 'freeQuestions' in f.effect ? story : 'finePct' in f.effect ? story || noFines : false;

/** The favours the gate will grant today (docs/tech-spec.md §43), of those that do anything today. */
function FavoursToday({ run, noFines }: { run: RunState; noFines: boolean }) {
  const today = favoursFor(run, gameContent).filter((f) => !moot(f, run.story, noFines));
  return (
    <>
      {today.map((f) => (
        <p key={f.id} class="morning__favour" data-testid="favour-today">
          {t('ui.favour.today', { god: factionName(f.faction, run.day), text: t(f.text) })}
        </p>
      ))}
    </>
  );
}

/**
 * Every favour of the powers met so far, the standing each takes and the standing now: for a player deciding whom to
 * court. A power the story hasn't brought in yet stays out of it, as it does from the standing strip.
 */
function FavourGuide({ run }: { run: RunState }) {
  const met = factionsMet(run);
  const all = (campaignOf(gameContent).favours ?? []).filter((f) => met.includes(f.faction));
  if (all.length === 0) return null;
  const today = new Set(favoursFor(run, gameContent).map((f) => f.id));
  return (
    <details class="card morning__favours" data-testid="favours">
      <summary>{t('ui.favour.title')}</summary>
      <ul class="favours">
        {all.map((f) => (
          <li key={f.id} data-testid="favour" class={today.has(f.id) ? 'is-yours' : undefined}>
            {t('ui.favour.item', {
              god: factionName(f.faction, run.day),
              at: f.at,
              now: signed(run.standing[f.faction]),
              text: t(f.text),
            })}
            {today.has(f.id) ? <b> {t('ui.favour.yours')}</b> : null}
          </li>
        ))}
      </ul>
    </details>
  );
}

/** At the audit, the favours that lightened the day's fines (or waived them), when there were fines to lighten. */
function FinesEased({ ledger, day }: { ledger: DayLedger; day: number }) {
  if (ledger.fines === 0 && !ledger.eased) return null;
  const eased = (campaignOf(gameContent).favours ?? []).filter(
    (f) => (ledger.favours ?? []).includes(f.id) && 'finePct' in f.effect,
  );
  return (
    <>
      {eased.map((f) => (
        <p key={f.id} class="muted ledger__note" data-testid="favour-fines">
          {t('ui.favour.today', { god: factionName(f.faction, day), text: t(f.text) })}
        </p>
      ))}
    </>
  );
}

/** Who paid the day's rings for nails left long (docs/tech-spec.md §57), by the name they go by today. */
function nailPayer(ledger: DayLedger, day: number): string {
  const f = (campaignOf(gameContent).favours ?? []).find(
    (x) => (ledger.favours ?? []).includes(x.id) && 'nailRings' in x.effect,
  );
  return f ? factionName(f.faction, day) : '';
}

/** The day's favours that act at night (the sick's extra night), as the gate granted them. */
function FavoursTonight({ run }: { run: RunState }) {
  const today = run.ledger[run.ledger.length - 1];
  const ids = today?.day === run.day ? (today.favours ?? []) : [];
  const tonight = (campaignOf(gameContent).favours ?? []).filter((f) => ids.includes(f.id) && 'sickNights' in f.effect);
  return (
    <>
      {tonight.map((f) => (
        <p key={f.id} class="muted" data-testid="favour-tonight">
          {t('ui.favour.tonight', { god: factionName(f.faction, run.day), text: t(f.text) })}
        </p>
      ))}
    </>
  );
}

// ---------- the line ----------

/** The souls who waited at the gate through the night (docs/tech-spec.md §41): first in today's line. */
function WaitingNote({ run }: { run: RunState }) {
  const waiting = run.waiting ?? [];
  if (waiting.length === 0) return null;
  const names = listText(waiting.map((c) => `${c.evidence.look.name} ${c.evidence.look.patronym}`));
  return (
    <p class="morning__line" data-testid="waiting">
      {t('ui.line.morning', { count: waiting.length, names })}
    </p>
  );
}

/** What became of a soul the sun set on: it waits for tomorrow, dies in the night, or simply went unjudged. */
function leftNote(ledger: DayLedger, id: string | undefined): string {
  if (id !== undefined && ledger.waiting?.carried.some((s) => s.id === id)) return t('ui.audit.waits');
  if (id !== undefined && ledger.waiting?.died.some((s) => s.id === id)) return t('ui.audit.diedWaiting');
  return t('ui.summary.unjudged');
}

// ---------- the gods' requests ----------

/** Standing changes as words: "Odin -2 and Freyja +1". */
const fxText = (fx: Readonly<Partial<Record<Faction, number>>>, day: number) =>
  listText(
    Object.entries(fx)
      .filter(([, n]) => (n ?? 0) !== 0)
      .map(([f, n]) => `${factionName(f as Faction, day)} ${signed(n ?? 0)}`),
  );

/**
 * This morning's requests (docs/tech-spec.md §42): who asks, for which souls, what it's worth and what it costs
 * (with no fine in Story Mode or with the no-fines assist, which can be set on this same page).
 */
function RequestCards({ run, fined }: { run: RunState; fined: boolean }) {
  const campaign = campaignOf(gameContent);
  return (
    <>
      {(run.requests ?? []).map((r) => {
        const god = factionName(r.god, run.day);
        return (
          <section key={r.id} class="card request" data-testid="request">
            <h2>{t('ui.request.title', { god })}</h2>
            <p class="request__words">{t(r.text)}</p>
            <p class="muted">
              {t('ui.request.terms', {
                n: r.n,
                from: t(`dest.${r.from}`),
                to: t(`dest.${r.to}`),
                god,
                reward: fxText(r.reward, run.day),
                fined: fined ? 'yes' : 'no',
                cost: fxText(standingFx(campaign, r.from, r.to), run.day),
              })}
            </p>
          </section>
        );
      })}
    </>
  );
}

/** How the day's requests went, under the audit's standing. */
function RequestResults({ ledger, day }: { ledger: DayLedger; day: number }) {
  const settled = ledger.requests ?? [];
  if (settled.length === 0) return null;
  return (
    <ul class="request-results" data-testid="request-results">
      {settled.map((r) => {
        const god = factionName(r.god, day);
        return (
          <li key={r.id}>
            {r.met
              ? t('ui.request.met', { god, reward: fxText(r.standing, day) })
              : t('ui.request.unmet', { god, done: r.done, n: r.n })}
          </li>
        );
      })}
    </ul>
  );
}

// ---------- appeals ----------

/**
 * The morning's appeal (docs/tech-spec.md §40): who asks to be judged again, what hangs on it, and hearing
 * it at the desk or letting the verdict stand; once decided, how it went.
 */
function AppealCard({ run }: { run: RunState }) {
  const appeal = run.appeal;
  const def = campaignOf(gameContent).appeals;
  if (appeal && def) {
    const look = appeal.case.evidence.look;
    return (
      <section class="card appeal" data-testid="appeal">
        <h2>{t('ui.appeal.title')}</h2>
        <p>
          {t('ui.appeal.body', {
            name: `${look.name} ${look.patronym}`,
            dest: t(`dest.${appeal.stamped}`),
            n: appeal.day,
          })}
        </p>
        <p class="appeal__plea">{t(`ui.appeal.plea.${appeal.stamped}`)}</p>
        <p class="muted">{t('ui.appeal.terms', { n: appeal.day, bonus: def.bonus, fine: def.fine })}</p>
        <div class="row">
          <button type="button" class="btn btn--primary" data-testid="appeal-hear" onClick={hearAppeal}>
            {t('ui.appeal.hear')}
          </button>
          <button type="button" class="btn" data-testid="appeal-stand" onClick={letAppealStand}>
            {t('ui.appeal.stand')}
          </button>
        </div>
      </section>
    );
  }
  return run.appealHeard ? <AppealResult heard={run.appealHeard} seed={run.seed} /> : null;
}

function AppealResult({ heard, seed }: { heard: AppealHeard; seed: string }) {
  const dest = (d: AppealHeard['to']) => (d ? t(`dest.${d}`) : '');
  const rule = createDayContext(gameContent, heard.day, seed).rules.find((r) => r.id === heard.rule);
  const text =
    heard.outcome === 'righted'
      ? t('ui.appeal.righted', { name: heard.name, dest: dest(heard.to), rings: heard.rings })
      : heard.outcome === 'upheld'
        ? t('ui.appeal.upheld', { name: heard.name, dest: dest(heard.expected), rings: heard.rings })
        : heard.outcome === 'wrong'
          ? t('ui.appeal.wrong', { name: heard.name, dest: dest(heard.expected), rings: -heard.rings })
          : t('ui.appeal.stood', { name: heard.name });
  return (
    <section class="card appeal" data-testid="appeal-result" role="status">
      <p>{text}</p>
      {heard.outcome === 'wrong' && rule ? (
        <p class="muted">{t('ui.appeal.rule', { rule: t(ruleText(rule, heard.day)) })}</p>
      ) : null}
    </section>
  );
}

// ---------- audit ----------

function Audit() {
  const a = active.value;
  const s = session.value;
  if (!a) return null;
  const ledger = a.run.ledger[a.run.ledger.length - 1];
  const shift = a.run.shift;
  if (!ledger || !shift) return null;
  const economy = economyFor(a.run, { content: gameContent, ctx: a.ctx });
  const waived = a.run.story || (ledger.assists?.noFines === true && !a.run.oath);
  const forgiven = Math.min(ledger.wrong, waived ? ledger.wrong : economy.warnings);
  const assisted = assistText(ledger.assists);
  const score = shiftScore(shift);
  // What story souls paid for their stamps (docs/tech-spec.md §47), already in the purse with the story's effects.
  const paid = shift.verdicts.flatMap((v) => {
    const c = shift.cases[v.index];
    const rings = c && v.stamped !== null ? stampRings(gameContent, c, v.stamped) : 0;
    return c && rings !== 0 ? [{ id: c.id, name: `${c.evidence.look.name} ${c.evidence.look.patronym}`, rings }] : [];
  });
  return (
    <main class="screen screen--audit">
      <h1 data-testid="audit-title">{t('ui.audit.title', { n: a.run.day })}</h1>
      <p class="summary__score" data-testid="audit-score">
        {t('ui.summary.score', { correct: ledger.correct, total: ledger.correct + ledger.wrong + ledger.unjudged })}
      </p>
      {assisted ? (
        <p class="muted" data-testid="audit-assists">
          {t('ui.assist.on', { list: assisted })}
        </p>
      ) : null}
      <table class="ledger" data-testid="ledger">
        <tbody>
          <tr>
            <td>{t('ui.audit.pay', { n: ledger.correct, wage: economy.wage })}</td>
            <td class="num">{signed(ledger.pay)}</td>
          </tr>
          {ledger.bonus > 0 ? (
            <tr>
              <td>{t('ui.audit.bonus', { n: score.caught })}</td>
              <td class="num">{signed(ledger.bonus)}</td>
            </tr>
          ) : null}
          {(ledger.nails ?? 0) > 0 ? (
            <tr data-testid="audit-nails">
              <td>{t('ui.audit.nails', { god: nailPayer(ledger, a.run.day) })}</td>
              <td class="num">{signed(ledger.nails ?? 0)}</td>
            </tr>
          ) : null}
          {forgiven > 0 ? (
            <tr>
              <td>{t('ui.audit.forgiven', { n: forgiven })}</td>
              <td class="num">0</td>
            </tr>
          ) : null}
          {ledger.fines > 0 || (ledger.eased ?? 0) > 0 ? (
            <tr>
              <td>{t(forgiven > 0 ? 'ui.audit.fines' : 'ui.audit.finesAll', { n: ledger.wrong - forgiven })}</td>
              <td class="num">{signed(-ledger.fines)}</td>
            </tr>
          ) : null}
          {ledger.appeal && ledger.appeal.rings !== 0 ? (
            <tr data-testid="audit-appeal">
              <td>{t('ui.audit.appeal', { n: ledger.appeal.day, name: ledger.appeal.name })}</td>
              <td class="num">{signed(ledger.appeal.rings)}</td>
            </tr>
          ) : null}
          {paid.map((p) => (
            <tr key={p.id} data-testid="audit-paid">
              <td>{t('ui.audit.paid', { name: p.name })}</td>
              <td class="num">{signed(p.rings)}</td>
            </tr>
          ))}
          <tr class="ledger__total">
            <td>{t('ui.campaign.purseLabel')}</td>
            <td class="num" data-testid="audit-rings">
              {a.run.rings}
            </td>
          </tr>
        </tbody>
      </table>
      <FinesEased ledger={ledger} day={a.run.day} />
      {ledger.grade ? <DayMark grade={ledger.grade} day={a.run.day} /> : null}
      <StandingTable run={a.run} ledger={ledger} />
      <RequestResults ledger={ledger} day={a.run.day} />
      <TrailPinned run={a.run} />
      <ol class="verdicts">
        {shift.verdicts.map((v) => {
          const c = shift.cases[v.index];
          const name = c ? `${c.evidence.look.name} ${c.evidence.look.patronym}` : '';
          return (
            <li key={v.index} class={v.correct ? 'is-right' : 'is-wrong'} data-testid="verdict">
              <span aria-hidden="true">{v.stamped === null ? '⬛' : v.correct ? '🟩' : '🟥'}</span>{' '}
              {t('ui.summary.row', { name, dest: t(`dest.${v.expected}`) })}
              {v.stamped === null ? (
                <span class="muted" data-testid="left-note">
                  {' '}
                  ({leftNote(ledger, c?.id)})
                </span>
              ) : v.correct ? null : v.stamped === v.expected ? (
                <span class="muted">
                  {' '}
                  ({t('ui.summary.skipped', { procs: listText(skippedText(v.skipped, a.ctx)) })})
                </span>
              ) : (
                <span class="muted"> ({t('ui.summary.you', { dest: t(`dest.${v.stamped}`) })})</span>
              )}
              {c && v.stamped !== null
                ? standingNotes(stampEffects(gameContent, c, v.stamped), a.run.day).map((note) => (
                    <span key={note} class="verdict__note" data-testid="verdict-note">
                      {' '}
                      {note}
                    </span>
                  ))
                : null}{' '}
              {/* A mistake can be looked at again, and tried again except under the oath (docs/tech-spec.md §67). */}
              {s && v.stamped !== null && !v.correct ? (
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
              {s ? (
                <button
                  type="button"
                  class="btn btn--quiet btn--small"
                  data-testid="report-soul"
                  aria-label={t('ui.report.rowLabel', { name })}
                  onClick={() => openReport(s, v.index)}
                >
                  {t('ui.report.row')}
                </button>
              ) : null}
            </li>
          );
        })}
      </ol>
      <div class="row">
        <button type="button" class="btn btn--primary btn--big" data-testid="go-home" onClick={endAudit}>
          {t('ui.audit.home')}
        </button>
      </div>
      <ReportDialog />
      <ReviewDialog />
    </main>
  );
}

/**
 * A table that can be wider than the screen (the audit's standing, with every column, or with large text): it
 * scrolls in its own box, by keyboard too, never the page, with its first column held in place. A column scrolled
 * to comes to rest against that one, never half under it, where a sign half hidden could read as another: the box
 * snaps to the held column's width, and leaves room after the last column for it to come to rest there too.
 */
function LedgerScroll({ label, children }: { label: string; children: ComponentChildren }) {
  const box = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const el = box.current;
    const table = el?.querySelector('table');
    if (!el || !table) return;
    const fit = () => {
      const heads = el.querySelectorAll<HTMLElement>('thead th');
      const held = heads[0]?.offsetWidth ?? 0;
      const last = heads[heads.length - 1]?.offsetWidth ?? 0;
      el.style.setProperty('--held', `${held}px`);
      const tail = table.offsetWidth > el.clientWidth ? Math.max(0, el.clientWidth - held - last) : 0;
      el.style.setProperty('--tail', `${tail}px`);
    };
    fit();
    if (typeof ResizeObserver === 'undefined') return;
    // Refitted in the next frame, not in the observer's own callback: the box's padding changing there would be a
    // resize within the same frame, which the browser reports as an error ("ResizeObserver loop").
    let frame = 0;
    const watch = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fit);
    });
    watch.observe(el);
    watch.observe(table);
    return () => {
      cancelAnimationFrame(frame);
      watch.disconnect();
    };
  }, []);
  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: a box that scrolls must take focus to scroll by keyboard.
    <section ref={box} class="ledger-scroll" aria-label={label} tabIndex={0}>
      {children}
    </section>
  );
}

/**
 * Where the player stands with each power they've had dealings with, and what moved it since the
 * last audit: today's mistakes at the gate, and the story (last night's scene, this morning's, the
 * story souls). The last audit's standing plus both columns is the standing now.
 */
function StandingTable({ run, ledger }: { run: RunState; ledger: DayLedger }) {
  const rows = factionsMet(run);
  if (rows.length === 0) return null;
  // The morning's appeal moved standing too, when it righted a mistake or made one: its own column, so they add up.
  const appeal = ledger.appeal?.standing ?? {};
  const appealed = Object.keys(appeal).length > 0;
  // So did the line at dusk (docs/tech-spec.md §41): a crowded gate, and the living lost in the night.
  const line = ledger.waiting?.standing ?? {};
  const waited = Object.keys(line).length > 0;
  // And the gods' requests done in full (§42).
  const asked: Partial<Record<Faction, number>> = {};
  for (const r of ledger.requests ?? [])
    for (const [f, n] of Object.entries(r.standing)) asked[f as Faction] = (asked[f as Faction] ?? 0) + (n ?? 0);
  const favoured = Object.keys(asked).length > 0;
  return (
    <>
      <LedgerScroll label={t('ui.audit.standing')}>
        <table class="ledger" data-testid="standing">
          <thead>
            <tr>
              <th class="ledger__who">{t('ui.audit.standing')}</th>
              <th class="num">{t('ui.audit.mistakes')}</th>
              {appealed ? <th class="num">{t('ui.audit.appealColumn')}</th> : null}
              {waited ? <th class="num">{t('ui.audit.lineColumn')}</th> : null}
              {favoured ? <th class="num">{t('ui.audit.requestsColumn')}</th> : null}
              <th class="num">{t('ui.audit.story')}</th>
              <th class="num">{t('ui.audit.now')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((f) => (
              <tr key={f}>
                <td class="ledger__who">{factionName(f, run.day)}</td>
                <td class="num">{signed(ledger.standing[f] ?? 0)}</td>
                {appealed ? <td class="num">{signed(appeal[f] ?? 0)}</td> : null}
                {waited ? <td class="num">{signed(line[f] ?? 0)}</td> : null}
                {favoured ? <td class="num">{signed(asked[f] ?? 0)}</td> : null}
                <td class="num">{signed(ledger.story?.[f] ?? 0)}</td>
                <td class="num">{signed(run.standing[f])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </LedgerScroll>
      <p class="muted ledger__note">{t('ui.audit.standingNote')}</p>
      {waited ? <p class="muted ledger__note">{t('ui.audit.lineNote')}</p> : null}
      {favoured ? <p class="muted ledger__note">{t('ui.audit.requestsNote')}</p> : null}
    </>
  );
}

// ---------- night ----------

/** The family: who is well, sick (and, when planning the night, how soon they need medicine) or gone. */
function FamilyList({ run, plan = false }: { run: RunState; plan?: boolean }) {
  // Hel's favour can give the sick a night more (docs/tech-spec.md §43).
  const care = careFor(run, gameContent);
  return (
    <ul class="family" data-testid="family">
      {run.family.map((m) => {
        const name = familyName(gameContent, m.id);
        // Someone who keeps themselves while well is off the food bill until they're sick (docs/tech-spec.md §72).
        const status =
          m.status === 'gone'
            ? t(m.gone === 'died' ? 'ui.family.died' : 'ui.family.left')
            : m.status === 'sick'
              ? plan
                ? t('ui.family.sickLeft', { left: care.sickNights - m.sickNights })
                : t('ui.family.sick')
              : memberDef(gameContent, m.id)?.ownKeep
                ? t('ui.family.ownKeep')
                : t('ui.family.well');
        const needs = [
          m.status !== 'gone' && m.cold > 0 ? t('ui.family.cold', { n: m.cold }) : null,
          m.status !== 'gone' && m.hungry > 0 ? t('ui.family.hungry', { n: m.hungry }) : null,
        ].filter((x) => x !== null);
        return (
          <li key={m.id} class={`family__member is-${m.status}`} data-member={m.id}>
            <b>{name}</b>: {status}
            {needs.length > 0 ? <span class="muted"> ({needs.join(', ')})</span> : null}
          </li>
        );
      })}
    </ul>
  );
}

/** What the bills as set do tonight: who is lost, who surely falls sick, who gets worse, and the odds for the rest. */
function Outlook({ run, outlook, bills }: { run: RunState; outlook: NightOutlook; bills: Bills }) {
  const lines: { key: string; id: string; text: string; bold?: boolean }[] = outlook.members.flatMap((n, i) => {
    const was = run.family[i];
    const name = familyShort(gameContent, n.member.id);
    const how = memberDef(gameContent, n.member.id)?.adult ? 'died' : 'left';
    if (n.change === 'died' || n.change === 'left') {
      return [{ key: n.member.id, id: 'outlook-lost', text: t('ui.night.lost', { name, how: n.change }), bold: true }];
    }
    if (n.change === 'sick') {
      return [
        { key: n.member.id, id: 'outlook-sickens', text: t('ui.night.sickens', { name, cause: n.cause ?? 'cold' }) },
      ];
    }
    if (was?.status === 'sick' && n.member.status === 'sick') {
      const left = careFor(run, gameContent).sickNights - n.member.sickNights;
      return [{ key: n.member.id, id: 'outlook-worse', text: t('ui.night.worse', { name, how, left }) }];
    }
    return [];
  });
  // A day event's sickness (docs/tech-spec.md §52) has its own line; this is what the bills as set add to it.
  const anyway = careFor(run, gameContent).sickAnyway ?? 0;
  const risk = Math.max(0, ...outlook.members.map((n) => n.risk)) - anyway;
  const need = !bills.hearth && !bills.food ? 'both' : !bills.hearth ? 'hearth' : 'food';
  return (
    <>
      {lines.map((l) => (
        <p key={l.key} class="warn" data-testid={l.id}>
          {l.bold ? <b>{l.text}</b> : l.text}
        </p>
      ))}
      {risk > 0 ? (
        <p class="warn" data-testid="outlook-risk">
          {t('ui.night.risk', { need, p: risk })}
        </p>
      ) : null}
    </>
  );
}

/** The bills of the next few nights, so what's spent tonight can be weighed against them. */
function NightsAhead({ run }: { run: RunState }) {
  const ahead = billForecast(run, gameContent);
  if (ahead.length === 0) return null;
  // Fed from the purse: someone who keeps themselves while well isn't (docs/tech-spec.md §72).
  const home = fedAtHome(run, gameContent).length;
  return (
    // A region that can take the focus: on a narrow screen the table scrolls sideways, by keyboard too.
    // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling region must take the focus to scroll by keyboard
    <section class="ahead" data-testid="nights-ahead" aria-labelledby="nights-ahead-title" tabIndex={0}>
      <h3 id="nights-ahead-title">{t('ui.night.ahead')}</h3>
      <table class="ledger">
        <thead>
          <tr>
            <th>{t('ui.night.aheadNight')}</th>
            <th class="num">{t('ui.night.aheadBills', { n: home })}</th>
            <th class="num">{t('ui.night.aheadMedicine')}</th>
          </tr>
        </thead>
        <tbody>
          {ahead.map((b) => (
            <tr key={b.day} data-testid="night-ahead">
              <td class="ahead__night">
                {t('ui.night.title', { n: b.day })}
                {b.draupnir > 0 ? <span class="muted"> {t('ui.night.aheadDraupnir', { n: b.draupnir })}</span> : null}
              </td>
              <td class="num">{b.hearth + b.food}</td>
              <td class="num">{b.medicine}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {/* The same each night while the rank is held (docs/tech-spec.md §44). */}
      {(ahead[0]?.tithe ?? 0) > 0 ? (
        <p class="muted" data-testid="ahead-tithe">
          {t('ui.night.aheadTithe', { n: ahead[0]?.tithe ?? 0 })}
        </p>
      ) : null}
    </section>
  );
}

function BillsCard({ run, outlook }: { run: RunState; outlook: NightOutlook }) {
  const a = active.value;
  if (!a) return null;
  const economy = economyFor(a.run, { content: gameContent, ctx: a.ctx });
  const bills = run.bills ?? defaultBills(run);
  const set = (next: Bills) => dispatch({ t: 'bills', bills: next });
  const home = run.family.filter((m) => m.status !== 'gone');
  const sick = home.filter((m) => m.status === 'sick');
  // Food for those the purse feeds: not someone who keeps themselves while well (docs/tech-spec.md §72).
  const fed = fedAtHome(run, gameContent).length;
  const floor = campaignOf(gameContent).debtFloor;
  const limit = debtLimit(gameContent);
  return (
    <section class="card bills" data-testid="bills">
      <h2>{t('ui.night.bills')}</h2>
      <label>
        <input
          type="checkbox"
          checked={bills.hearth}
          data-testid="bill-hearth"
          onChange={(e) => set({ ...bills, hearth: (e.target as HTMLInputElement).checked })}
        />{' '}
        {t('ui.night.hearth', { cost: economy.costs.hearth })}
      </label>
      <label>
        <input
          type="checkbox"
          checked={bills.food}
          data-testid="bill-food"
          onChange={(e) => set({ ...bills, food: (e.target as HTMLInputElement).checked })}
        />{' '}
        {t('ui.night.food', { n: fed, cost: economy.costs.food * fed })}
      </label>
      {sick.map((m) => (
        <label key={m.id}>
          <input
            type="checkbox"
            checked={bills.medicine.includes(m.id)}
            data-testid={`bill-medicine-${m.id}`}
            onChange={(e) => {
              const on = (e.target as HTMLInputElement).checked;
              const medicine = on ? [...bills.medicine, m.id] : bills.medicine.filter((x) => x !== m.id);
              set({ ...bills, medicine });
            }}
          />{' '}
          {t('ui.night.medicine', { name: familyName(gameContent, m.id), cost: economy.costs.medicine })}
        </label>
      ))}
      {outlook.tithe > 0 ? <p data-testid="tithe">{t('ui.night.tithe', { n: outlook.tithe })}</p> : null}
      <Outlook run={run} outlook={outlook} bills={bills} />
      {outlook.draupnir > 0 ? (
        <p data-testid="draupnir-tonight">{t('ui.night.draupnir', { n: outlook.draupnir })}</p>
      ) : null}
      <p data-testid="after-bills">{t('ui.night.after', { n: outlook.rings })}</p>
      {outlook.reprieve ? (
        <p data-testid="reprieve-note">
          <b>{t('ui.night.reprieve')}</b>
        </p>
      ) : outlook.ends?.why === 'debt' ? (
        <p class="warn" data-testid="debt-warning">
          <b>{t('ui.night.demoted', { floor })}</b>
        </p>
      ) : outlook.rings < floor && limit !== null ? (
        <p class="warn" data-testid="debt-warning">
          {t('ui.night.debt', { floor, limit })}
        </p>
      ) : run.debtNights > 0 ? (
        <p data-testid="debt-cleared">{t('ui.night.debtCleared', { floor })}</p>
      ) : null}
      {outlook.ends?.why === 'home' ? (
        <p class="warn" data-testid="home-warning">
          <b>{t('ui.night.empty')}</b>
        </p>
      ) : null}
      <NightsAhead run={run} />
    </section>
  );
}

/** Sleep, and the night's bills are paid; when that would end the run, only after saying so. */
function SleepRow({ ends }: { ends: NightOutlook['ends'] }) {
  const [confirm, setConfirm] = useState(false);
  if (confirm && ends) {
    return (
      <div class="row confirm" data-testid="sleep-confirm">
        <p class="warn">{t(ends.why === 'debt' ? 'ui.night.confirmDebt' : 'ui.night.confirmHome')}</p>
        <button type="button" class="btn btn--danger" data-testid="sleep-anyway" onClick={sleep}>
          {t('ui.night.sleepAnyway')}
        </button>
        <button type="button" class="btn" data-testid="sleep-cancel" data-back onClick={() => setConfirm(false)}>
          {t('ui.night.notYet')}
        </button>
      </div>
    );
  }
  return (
    <div class="row">
      <button
        type="button"
        class="btn btn--primary btn--big"
        data-testid="sleep"
        onClick={() => (ends ? setConfirm(true) : sleep())}
      >
        {t('ui.night.sleep')}
      </button>
    </div>
  );
}

function ShopCard({ run }: { run: RunState }) {
  const items = shopFor(run, gameContent);
  const owned = campaignOf(gameContent).shop.filter((u) => run.upgrades.includes(u.id));
  if (items.length === 0 && owned.length === 0) return null;
  // What's yours sells back for a share of its price, where the build buys it back (docs/tech-spec.md §56).
  const selling = owned.flatMap((u) => {
    const n = sellPrice(run, gameContent, u.id);
    return n === null ? [] : [{ u, n }];
  });
  return (
    <section class="card shop" data-testid="shop">
      <h2>{t('ui.night.shop')}</h2>
      {items.map((u) => (
        <div key={u.id} class="shop__item">
          <p>
            <b>{t(u.name)}</b>: {t(u.text)}
          </p>
          <button
            type="button"
            class="btn btn--small"
            data-testid={`buy-${u.id}`}
            disabled={run.rings < u.price}
            onClick={() => dispatch({ t: 'buy', item: u.id })}
          >
            {t('ui.night.buy', { price: u.price })}
          </button>
        </div>
      ))}
      {selling.length > 0 ? (
        <div class="shop__owned" data-testid="owned">
          <h3>{t('ui.shop.owned')}</h3>
          {selling.map(({ u, n }) => (
            <div key={u.id} class="shop__item">
              <p>
                <b>{t(u.name)}</b>
              </p>
              <button
                type="button"
                class="btn btn--small"
                data-testid={`sell-${u.id}`}
                aria-label={t('ui.shop.sellLabel', { name: t(u.name), n })}
                onClick={() => dispatch({ t: 'sell', item: u.id })}
              >
                {t('ui.shop.sell', { n })}
              </button>
            </div>
          ))}
        </div>
      ) : owned.length > 0 ? (
        <p class="muted" data-testid="owned">
          {t('ui.night.owned', { items: owned.map((u) => t(u.name)).join(', ') })}
        </p>
      ) : null}
    </section>
  );
}

/**
 * Arms for the last battle (docs/tech-spec.md §56): from their night, one lot a night for the front of your choice, each
 * dearer than the last. Each front says how it would stand if the horn blew tonight, the fronts held in the order
 * listed, as the horn's own screen first lists them.
 */
function ArmsCard({ run }: { run: RunState }) {
  const campaign = campaignOf(gameContent);
  const def = campaign.ragnarok;
  const lot = armsTonight(run, gameContent);
  if (!campaign.arms || !def || !lot) return null;
  const tonight = fight(
    run,
    def,
    def.fronts.map((f) => f.id),
  );
  const short = run.rings < lot.price;
  const bought = run.armsBought ?? 0;
  return (
    <section class="card shop" data-testid="arms">
      <h2>{t('ui.arms.title')}</h2>
      <p class="muted">{t('ui.arms.lead', { strength: lot.strength })}</p>
      {lot.bought ? (
        <p data-testid="arms-tonight">{t('ui.arms.tonight')}</p>
      ) : short ? (
        <p data-testid="arms-short">{t('ui.arms.short', { price: lot.price })}</p>
      ) : null}
      {campaign.arms.fronts.map((a) => {
        const f = tonight.fronts.find((x) => x.id === a.front);
        return (
          <div key={a.front} class="shop__item" data-testid="arms-front" data-front={a.front}>
            <p>
              <b>{t(a.name)}</b>: {t(a.text)}
              {f ? (
                <span class="muted">
                  {' '}
                  {t('ui.arms.now', {
                    front: frontName(a.front),
                    held: f.held ? 'yes' : 'no',
                    strength: f.strength,
                    foe: f.foe,
                    arms: f.arms,
                  })}
                </span>
              ) : null}
            </p>
            <button
              type="button"
              class="btn btn--small"
              data-testid={`arm-${a.front}`}
              disabled={lot.bought || short}
              aria-label={t('ui.arms.buyLabel', { name: t(a.name), price: lot.price })}
              onClick={() => dispatch({ t: 'arm', front: a.front })}
            >
              {t('ui.arms.buy', { price: lot.price })}
            </button>
          </div>
        );
      })}
      {bought > 0 ? (
        <p class="muted" data-testid="arms-bought">
          {t('ui.arms.armed', { n: bought, total: campaign.arms.prices.length })}
        </p>
      ) : null}
    </section>
  );
}

/** What the desk pinned to the carvers' board today (docs/tech-spec.md §71), once the hunt is on. */
function TrailPinned({ run }: { run: RunState }) {
  const n = (run.trail?.marks ?? []).filter((m) => m.day === run.day).length;
  if (n === 0 || !huntOn(run, gameContent)) return null;
  return (
    <p class="muted" data-testid="audit-trail">
      {t('ui.trail.audit', { n })}
    </p>
  );
}

/** A carver as the board names him. */
const carverName = (s: TrailSuspect) => `${s.look.name} ${s.look.patronym}`;

/** One of a carver's habits, as the board says it. */
const handName = (h: string) => t(`trail.hand.${h}`);

/** The marks pinned, a line for each habit seen: where it was seen, and when. */
function markLines(marks: readonly TrailMark[]): string[] {
  const hands = [...new Set(marks.map((m) => m.hand))];
  return hands.map((h) =>
    t('ui.trail.markLine', {
      hand: handName(h),
      souls: listText(
        marks
          .filter((m) => m.hand === h)
          .map((m) =>
            t(m.via === 'tally' ? 'ui.trail.mark.tally' : 'ui.trail.mark.muninn', { name: m.name, day: m.day }),
          ),
      ),
    }),
  );
}

/**
 * The carvers' board (docs/tech-spec.md §71): who could have cut the forged tallies, his knife's two habits, and the
 * marks pinned from the desk, which rule men out. On the trail's nights, a name to give, once, asked twice, among the men
 * the marks leave (the board is never wrong about who they rule out); on the night one is given, what came of it.
 */
function TrailCard({ run }: { run: RunState }) {
  const board = trailBoard(run, gameContent);
  const [naming, setNaming] = useState<string | null>(null);
  if (!board) return null;
  const { def, named } = board;
  return (
    <section class="card trail" data-testid="trail">
      <h2>{t(def.title)}</h2>
      {named ? (
        <p data-testid="trail-named" data-right={named.right ? 'yes' : 'no'}>
          {t('ui.trail.named', { name: carverName(named.suspect) })}{' '}
          {t(named.right ? def.named.right : def.named.wrong, { name: carverName(named.suspect) })}
        </p>
      ) : (
        <p class="muted">{t(def.intro)}</p>
      )}
      <ul class="trail__carvers">
        {board.suspects.map(({ suspect, possible }) => (
          <li
            key={suspect.id}
            class={possible ? 'trail__carver' : 'trail__carver trail__carver--out'}
            data-testid="trail-carver"
            data-carver={suspect.id}
            data-possible={possible ? 'yes' : 'no'}
          >
            <p>
              <b>{carverName(suspect)}</b>: {t(suspect.text)}{' '}
              <span class="muted">
                {t('ui.trail.hands', { a: handName(suspect.hands[0] ?? ''), b: handName(suspect.hands[1] ?? '') })}
              </span>{' '}
              <span class="trail__status">{t(possible ? 'ui.trail.possible' : 'ui.trail.ruledOut')}</span>
            </p>
            {board.tonight && possible && naming !== suspect.id ? (
              <button
                type="button"
                class="btn btn--small"
                data-testid={`name-${suspect.id}`}
                aria-label={t('ui.trail.nameLabel', { name: carverName(suspect) })}
                onClick={() => setNaming(suspect.id)}
              >
                {t('ui.trail.name')}
              </button>
            ) : null}
            {board.tonight && possible && naming === suspect.id ? (
              <div class="trail__confirm" data-testid="trail-confirm">
                <p>{t('ui.trail.confirm', { name: carverName(suspect) })}</p>
                <div class="row">
                  <button
                    type="button"
                    class="btn btn--small"
                    data-testid="trail-confirm-yes"
                    onClick={() => {
                      setNaming(null);
                      dispatch({ t: 'accuse', suspect: suspect.id });
                    }}
                  >
                    {t('ui.trail.confirmYes', { name: carverName(suspect) })}
                  </button>
                  <button
                    type="button"
                    class="btn btn--small btn--quiet"
                    data-testid="trail-confirm-no"
                    onClick={() => setNaming(null)}
                  >
                    {t('ui.trail.confirmNo')}
                  </button>
                </div>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      <p data-testid="trail-marks">{t('ui.trail.marks', { n: board.marks.length })}</p>
      {board.marks.length > 0 ? (
        <ul class="trail__marks">
          {markLines(board.marks).map((line) => (
            <li key={line} class="trail__mark">
              {line}
            </li>
          ))}
        </ul>
      ) : null}
      {named ? null : board.tonight ? (
        <p data-testid="trail-when">
          <b>{t('ui.trail.tonight')}</b>
        </p>
      ) : board.next !== undefined ? (
        <p class="muted" data-testid="trail-when">
          {t('ui.trail.later', { n: board.next })}
        </p>
      ) : null}
    </section>
  );
}

function Night() {
  const a = active.value;
  if (!a) return null;
  const { run } = a;
  const scene = pendingScene(run, 'night');
  const outlook = scene ? null : nightOutlook(run, { content: gameContent, ctx: a.ctx });
  return (
    <main class="screen screen--night">
      <h1 data-testid="night-title">{t('ui.night.title', { n: run.day })}</h1>
      <p class="muted" data-testid="night-rings">
        {t('ui.campaign.purse', { n: run.rings })}
      </p>
      <StandingStrip run={run} />
      <DebtBanner run={run} />
      {scene ? (
        <SceneView key={scene} id={scene} run={run} />
      ) : outlook ? (
        <>
          <section class="card">
            <h2>{t('ui.night.family')}</h2>
            <FamilyList run={run} plan />
            <FavoursTonight run={run} />
            <EventNight run={run} />
          </section>
          <TrailCard run={run} />
          <BillsCard run={run} outlook={outlook} />
          <RankCard run={run} />
          <ShopCard run={run} />
          <ArmsCard run={run} />
          <SleepRow key={outlook.ends?.why ?? 'none'} ends={outlook.ends} />
        </>
      ) : null}
      <div class="row">
        <JournalButton />
        <button type="button" class="btn btn--quiet" data-testid="campaign-quit" onClick={leaveCampaign}>
          {t('ui.campaign.quit')}
        </button>
      </div>
      {journalOpen.value ? <JournalView /> : null}
    </main>
  );
}

// ---------- ending ----------

/**
 * The horn (docs/tech-spec.md §54): the hosts the run filled, and the fronts in the order they're to be held, which the
 * player sets; each front says, as it's ordered, whether it will hold.
 */
function Ragnarok() {
  const a = active.value;
  const def = campaignOf(gameContent).ragnarok;
  const focus = useAutoFocus<HTMLHeadingElement>();
  const [order, setOrder] = useState<string[]>(() => def?.fronts.map((f) => f.id) ?? []);
  // The front the chooser rides to (docs/tech-spec.md §58): none until the player picks one.
  const [ride, setRide] = useState<string | null>(null);
  // A front moved to the top or the bottom keeps the focus on the button it still has.
  const [moved, setMoved] = useState<{ id: string; by: -1 | 1 } | null>(null);
  useLayoutEffect(() => {
    if (!moved) return;
    const i = order.indexOf(moved.id);
    const edge = (moved.by < 0 && i === 0) || (moved.by > 0 && i === order.length - 1);
    if (!edge) return;
    const other = moved.by < 0 ? 'front-later' : 'front-earlier';
    document.querySelector<HTMLButtonElement>(`[data-front="${moved.id}"] [data-testid="${other}"]`)?.focus();
  }, [moved, order]);
  if (!a || !def) return null;
  const { run } = a;
  const battle = fight(run, def, order, ride ?? undefined);
  const unridden = def.ride !== undefined && ride === null;
  const move = (i: number, by: -1 | 1) => {
    const id = order[i];
    if (!id || i + by < 0 || i + by >= order.length) return;
    const next = order.filter((x) => x !== id);
    next.splice(i + by, 0, id);
    setOrder(next);
    setMoved({ id, by });
  };
  const held = battle.fronts.filter((f) => f.held).length;
  return (
    <main class="screen screen--ragnarok">
      <h1 ref={focus} tabIndex={-1} data-testid="ragnarok-title">
        {t('ui.ragnarok.title')}
      </h1>
      <p class="ragnarok__lead">{t(def.text)}</p>
      <section class="card" data-testid="hosts">
        <h2>{t('ui.ragnarok.hosts')}</h2>
        <ul class="ragnarok__hosts">
          {hostsAt(run, def).map((h) => {
            const { runs, story } = namedIn(run, h.hall);
            return (
              <li key={h.id} data-testid="host" data-host={h.id}>
                <strong>{hostName(h.id)}</strong>: {t('ui.ragnarok.host', { souls: h.souls })}
                {h.misfits > 0 ? `, ${t('ui.ragnarok.runs', { n: h.misfits })}` : ''}.{' '}
                <span class="muted">
                  {t('ui.ragnarok.own', { front: frontName(h.front) })}
                  {h.only ? ` ${t('ui.ragnarok.only')}` : ''}
                </span>
                {story.length > 0 ? (
                  <span class="host__names" data-testid="host-stand">
                    {t('ui.ragnarok.stand', { names: namesText(story) })}
                  </span>
                ) : null}
                {runs.length > 0 ? (
                  <span class="host__names" data-testid="host-runs">
                    {t('ui.ragnarok.willRun', { names: namesText(runs, h.misfits) })}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
        <p class="muted">{t('ui.ragnarok.rule')}</p>
      </section>
      {def.ride ? (
        <fieldset class="card ragnarok__ride" data-testid="ride">
          <legend>{t('ui.ragnarok.ride')}</legend>
          <p class="muted">{t('ui.ragnarok.rideLead', { strength: def.ride.strength })}</p>
          {def.fronts.map((f) => (
            <label key={f.id} class="ride__option">
              <input
                type="radio"
                name="ride"
                value={f.id}
                checked={ride === f.id}
                data-testid={`ride-${f.id}`}
                onChange={() => setRide(f.id)}
              />{' '}
              {t('ui.ragnarok.rideTo', { front: t(f.name) })}
            </label>
          ))}
        </fieldset>
      ) : null}
      <section class="card" data-testid="fronts">
        <h2>{t('ui.ragnarok.fronts')}</h2>
        <p class="muted">{t('ui.ragnarok.order')}</p>
        <ol class="ragnarok__fronts">
          {battle.order.map((id, i) => {
            const f = battle.fronts.find((x) => x.id === id);
            const d = def.fronts.find((x) => x.id === id);
            if (!f || !d) return null;
            return (
              <li
                key={id}
                class={`front ${f.held ? 'is-held' : 'is-fell'}`}
                data-testid="front"
                data-front={id}
                data-held={f.held}
              >
                <div class="front__head">
                  <strong class="front__name">{t(d.name)}</strong>
                  <span class="front__verdict" data-testid="front-verdict">
                    {t(f.held ? 'ui.ragnarok.holds' : 'ui.ragnarok.falls')}
                  </span>
                </div>
                <p class="muted">{t(d.text)}</p>
                <p>
                  {t('ui.ragnarok.against', { strength: f.strength, foe: f.foe })}: {stoodText(f)}
                </p>
                <div class="row front__move">
                  <button
                    type="button"
                    class="btn"
                    data-testid="front-earlier"
                    disabled={i === 0}
                    aria-label={t('ui.ragnarok.earlierLabel', { front: t(d.name) })}
                    onClick={() => move(i, -1)}
                  >
                    {t('ui.ragnarok.earlier')}
                  </button>
                  <button
                    type="button"
                    class="btn"
                    data-testid="front-later"
                    disabled={i === battle.order.length - 1}
                    aria-label={t('ui.ragnarok.laterLabel', { front: t(d.name) })}
                    onClick={() => move(i, 1)}
                  >
                    {t('ui.ragnarok.later')}
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
        <p aria-live="polite" data-testid="fronts-held">
          {t('ui.ragnarok.count', { n: held, total: battle.fronts.length })}
        </p>
      </section>
      {unridden ? (
        <p class="muted" data-testid="ride-first">
          {t('ui.ragnarok.rideFirst')}
        </p>
      ) : null}
      <div class="row">
        <button
          type="button"
          class="btn btn--primary"
          data-testid="sound-horn"
          disabled={unridden}
          onClick={() => marshal(battle.order, ride ?? undefined)}
        >
          {t('ui.ragnarok.sound')}
        </button>
      </div>
    </main>
  );
}

/** How the last battle went, front by front, before the ending (docs/tech-spec.md §54). */
function BattleView() {
  const a = active.value;
  const def = campaignOf(gameContent).ragnarok;
  const focus = useAutoFocus<HTMLHeadingElement>();
  const battle = a?.run.battle;
  if (!a || !def || !battle) return null;
  return (
    <main class="screen screen--battle">
      <h1 ref={focus} tabIndex={-1} data-testid="battle-title">
        {t('ui.ragnarok.title')}
      </h1>
      <ul class="battle__fronts">
        {battle.fronts.map((f) => {
          const d = def.fronts.find((x) => x.id === f.id);
          if (!d) return null;
          return (
            <li
              key={f.id}
              class={`card front ${f.held ? 'is-held' : 'is-fell'}`}
              data-testid="battle-front"
              data-front={f.id}
              data-held={f.held}
            >
              <h2 class="front__name">
                {t(d.name)}: {t(f.held ? 'ui.ragnarok.held' : 'ui.ragnarok.fell')}
              </h2>
              <p>{t(f.held ? d.held : d.fell)}</p>
              <p class="muted">
                {t('ui.ragnarok.against', { strength: f.strength, foe: f.foe })}: {stoodText(f)}
              </p>
              <FrontNames run={a.run} f={f} />
            </li>
          );
        })}
      </ul>
      <div class="row">
        <button type="button" class="btn btn--primary" data-testid="to-ending" onClick={toEnding}>
          {t('ui.ragnarok.after')}
        </button>
      </div>
    </main>
  );
}

function Ending() {
  useStoryText();
  const a = active.value;
  const focus = useAutoFocus<HTMLHeadingElement>();
  if (!a) return null;
  const { run } = a;
  const ending = campaignOf(gameContent).endings.find((e) => e.id === run.ending);
  return (
    <main class="screen screen--ending">
      <h1 ref={focus} tabIndex={-1} data-testid="ending-title">
        {ending ? t(ending.title) : run.ending}
      </h1>
      {ending ? (
        <div class="ending__text" data-testid="ending-text">
          {paragraphs(t(ending.text)).map((p) => (
            <p key={p}>{p}</p>
          ))}
        </div>
      ) : null}
      <Epilogue run={run} />
      <p class="muted" data-testid="ending-found-count">
        {t('ui.gallery.count', {
          n: reachableEndings(gameContent).filter((e) => settings.value.endingsSeen.includes(e.id)).length,
          total: reachableEndings(gameContent).length,
        })}
      </p>
      <NightNews events={lastNight.value} />
      <section class="card">
        <p>{t('ui.ending.stats', { days: run.day, worthy: run.einherjar.worthy, unworthy: run.einherjar.unworthy })}</p>
        <FamilyList run={run} />
      </section>
      <RagnarokReport run={run} />
      <div class="row">
        <button type="button" class="btn btn--primary" data-testid="ending-slots" onClick={leaveCampaign}>
          {t('ui.ending.slots')}
        </button>
        <JournalButton />
      </div>
      {journalOpen.value ? <JournalView /> : null}
    </main>
  );
}

export function CampaignScreen({ which }: { which: Screen }) {
  switch (which) {
    case 'morning':
      return <Morning />;
    case 'audit':
      return <Audit />;
    case 'night':
      return <Night />;
    case 'ragnarok':
      return <Ragnarok />;
    case 'battle':
      return <BattleView />;
    case 'ending':
      return <Ending />;
    default:
      return <SlotsScreen />;
  }
}
