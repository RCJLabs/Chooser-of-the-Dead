import type { Hotspot } from '@cots/art';
import {
  type CaseSpec,
  currentCase,
  type Destination,
  type Field,
  factionKey,
  freeQuestion,
  genderOfName,
  hasBoons,
  hintsLeft,
  kinRelation,
  type Lesson,
  memberField,
  memberSoul,
  nextHint,
  parseMemberField,
  patienceLeft,
  pleaOf,
  pressable,
  pressCostMs,
  pressTaught,
  questionCostMs,
  ruledOut,
  ruleText,
  SAID,
  type SoulState,
  soulCtx,
  stampsFor,
  storyOffer,
  sunCosts,
  sunLeft,
  toolsFor,
  turnedTo,
  type Verdict,
} from '@cots/engine';
import { copyText } from '@cots/platform';
import { effect } from '@preact/signals';
import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { art, usePixelFrame } from '../art';
import { campaignUi } from '../campaign/lazy';
import { padInUse } from '../gamepad';
import { clockText, listText, t } from '../i18n';
import { openReport, reportFor, reportTitle, reportUrl, type SoulReport } from '../report';
import { toTop } from '../scroll';
import {
  type Answer,
  act,
  answer,
  canTryAgain,
  citation,
  clock,
  closeCitation,
  closeReview,
  coachAcks,
  coachState,
  compareFirst,
  comparing,
  departed,
  drawerTab,
  effectiveLayout,
  endlessRules,
  lookAgain,
  noteCoached,
  noteTip,
  now,
  quitToSlots,
  review,
  type Session,
  session,
  settings,
  stampSheet,
  toast,
  toTitle,
  tryAgain,
  updateSettings,
} from '../store';
import { activeLesson, coachStep, tipStep } from './coach';
import { dragging, grab, place, spotOf, tidyDesk } from './desk';
import { fieldText, regionFields, regionSeen, registryEntry, sceneFor, signKey, skippedText } from './evidence';
import { hintsAllowed, pendingHintFocus } from './hint';
import { walkOff } from './motion';
import type { PaperId, PaperSpot } from './papers';
import { RulesPanel } from './Rules';
import { skyBackground } from './sky';

/** Focuses an element once, when it mounts (dialogs, the briefing's Begin button). */
export function useAutoFocus<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  // Layout effect: focus lands before the next key press can. It never scrolls the page: a screen
  // opens at its top even when the button focused for the keyboard is further down (docs/tech-spec.md §30).
  useLayoutEffect(() => ref.current?.focus({ preventScroll: true }), []);
  return ref;
}

// ---------- compare ----------

/**
 * An evidence id as Compare picks it: at a party (docs/tech-spec.md §69), with the member it's on, so a pick survives
 * turning to another member.
 */
export function pickId(id: string): string {
  const st = session.peek()?.state;
  return st?.party ? memberField(turnedTo(st), id) : id;
}

/** Picks an item for Compare; the second pick runs the comparison. */
export function pick(field: string): void {
  const id = pickId(field);
  const first = compareFirst.peek();
  if (!comparing.peek() || first === null) {
    comparing.value = true;
    compareFirst.value = id;
  } else if (first === id) {
    compareFirst.value = null;
  } else {
    act({ t: 'compare', a: first, b: id });
  }
}

export function toggleCompare(): void {
  comparing.value = !comparing.peek();
  compareFirst.value = null;
}

/** The most recent contradiction not yet questioned. */
export function questionable(s: Session): string | undefined {
  const { flagged, questioned } = s.state.soul;
  return [...flagged].reverse().find((f) => !questioned.includes(f.lie))?.lie;
}

// ---------- pieces ----------

/** What the shift is called: the Daily's number, the practice day, the campaign day. */
export function modeTitle(s: Session): string {
  if (s.mode.kind === 'practice') return t('ui.briefing.practice', { n: s.mode.day });
  if (s.mode.kind === 'endless') return t('ui.endless.round', { n: s.mode.round + 1, day: s.mode.day });
  if (s.mode.kind === 'primer') return t('primer.title');
  if (s.mode.kind === 'campaign') return t('ui.campaign.day', { n: s.mode.day });
  if (s.mode.kind === 'appeal') return t('ui.appeal.desk', { n: s.mode.day, dest: t(`dest.${s.mode.stamped}`) });
  if (s.mode.kind === 'again') return t('ui.again.desk', { name: s.mode.name });
  if (s.mode.archive) return t('ui.briefing.archive', { n: s.mode.n, date: s.mode.date });
  return s.mode.preview ? t('ui.briefing.preview') : t('ui.briefing.daily', { n: s.mode.n });
}

function SunBar({ s }: { s: Session }) {
  now.value; // re-render on every tick
  const st = s.state;
  const left = sunLeft(st, clock());
  const pct = st.config.untimed ? 100 : Math.round((left * 100) / st.sunMs);
  const time = st.config.untimed ? t('ui.sun.untimed') : st.clock.dusk ? t('ui.sun.dusk') : clockText(left);
  return (
    <header class={`sunbar${st.clock.dusk ? ' is-dusk' : ''}`}>
      <div class="sunbar__meter" aria-hidden="true">
        <div class="sunbar__fill" style={{ width: `${pct}%` }} />
      </div>
      <span class="sunbar__time" data-testid="sun">
        {time}
      </span>
      <span class="sunbar__count" data-testid="soul-count">
        {t('ui.soul.count', { n: Math.min(st.cursor + 1, st.cases.length), total: st.cases.length })}
      </span>
      {s.mode.kind === 'endless' && hasBoons(s.content) ? (
        <span class="sunbar__count" data-testid="endless-points">
          {t('ui.endless.scoreLive', { n: s.mode.score ?? s.mode.judged })}
        </span>
      ) : null}
      {s.mode.kind === 'endless' ? (
        <span class="sunbar__count" data-testid="strikes">
          {t('ui.endless.strikes', { n: s.mode.strikes, max: endlessRules(s).strikes })}
        </span>
      ) : null}
      <button
        type="button"
        class="btn btn--quiet"
        onClick={() => act({ t: 'pause' })}
        data-testid="pause"
        data-pad="Menu"
      >
        {t('ui.pause')}
      </button>
    </header>
  );
}

/** The sky over the desk, going down with the sun: warm, then rose, then dusk (shift/sky.ts). */
function Sky({ s }: { s: Session }) {
  now.value; // re-render on every tick
  const st = s.state;
  const daylight = st.config.untimed ? 1 : st.clock.dusk ? 0 : sunLeft(st, clock()) / st.sunMs;
  return <div class="sky" aria-hidden="true" style={{ background: skyBackground(daylight) }} />;
}

const pctOf = (v: number, of: number) => `${(v * 100) / of}%`;

/** The stamp's ink on the soul, over its legs and clear of every sign (docs/tech-spec.md §33). */
function Ink({ dest }: { dest: Destination }) {
  return (
    <div class={`ink ink--${dest.toLowerCase()}`} aria-hidden="true">
      {t(`dest.${dest}`)}
    </div>
  );
}

function BodyStage({ s, c }: { s: Session; c: CaseSpec }) {
  const provider = art.value;
  const { soul } = s.state;
  const scene = sceneFor(c, soul);
  const svg = useMemo(() => provider.draw(scene), [provider, c.id, soul.view, soul.tools.join()]);
  const { w, h } = provider.frame;
  const stage = useRef<HTMLElement>(null);
  const pixelSize = usePixelFrame(stage, provider.frame);
  const tools = s.ctx.tools;
  return (
    <figure class="stage" data-art={provider.id} ref={stage}>
      <div class="stage__frame" style={pixelSize}>
        <div
          class="stage__art"
          role="img"
          aria-label={t(soul.view === 'front' ? 'ui.body.front' : 'ui.body.back')}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
        {provider.hotspots(scene).map((spot) => {
          const fields = regionFields(spot, s.state, s.ctx);
          if (fields.length === 0) return null;
          return (
            <button
              key={spot.id}
              type="button"
              tabIndex={-1}
              aria-hidden="true"
              class={`hotspot${regionSeen(spot, s.state, s.ctx) ? ' is-seen' : ''}`}
              data-region={spot.id}
              style={{
                left: pctOf(spot.x, w),
                top: pctOf(spot.y, h),
                width: pctOf(spot.w, w),
                height: pctOf(spot.h, h),
              }}
              onClick={() => act({ t: 'inspect', fields: fields.map((f) => f.id) })}
            />
          );
        })}
        {soul.stamp ? <Ink key={soul.stamp} dest={soul.stamp} /> : null}
      </div>
      <div class="stage__tools">
        {tools.has('flip') ? (
          <button
            type="button"
            class="btn btn--tool"
            data-testid="flip"
            data-pad="Y"
            onClick={() => act({ t: 'flip' })}
          >
            {t(soul.view === 'front' ? 'ui.flip.toBack' : 'ui.flip.toFront')} <kbd>F</kbd>
          </button>
        ) : null}
        {tools.has('feather') ? (
          <button
            type="button"
            class="btn btn--tool"
            data-testid="feather"
            disabled={soul.tools.includes('feather')}
            onClick={() => act({ t: 'tool', tool: 'feather' })}
          >
            {t('tool.feather')} <kbd>T</kbd>
          </button>
        ) : null}
      </div>
      {/* Later decrees' tools take the other side of the body, so no column outgrows a phone's stage. */}
      <div class="stage__tools stage__tools--more">
        {[...tools.keys()]
          .filter((id) => id !== 'flip' && id !== 'feather')
          .map((id) => (
            <button
              key={id}
              type="button"
              class="btn btn--tool"
              data-testid={id}
              aria-label={id === 'registry' ? t('ui.registry.search') : undefined}
              disabled={soul.tools.includes(id)}
              onClick={() => {
                act({ t: 'tool', tool: id });
                if (id === 'registry' && effectiveLayout() === 'drawer') drawerTab.value = 'registry';
              }}
            >
              {t(`tool.${id}`)}
              {id === 'registry' ? (
                <>
                  {' '}
                  <kbd>G</kbd>
                </>
              ) : null}
            </button>
          ))}
      </div>
    </figure>
  );
}

function Evidence({ s, c, f, variant }: { s: Session; c: CaseSpec; f: Field; variant: 'chip' | 'line' }) {
  const selected = comparing.value && compareFirst.value === pickId(f.id);
  const { soul } = s.state;
  const flag = soul.flagged.find((x) => x.lie === f.id);
  const questioned = soul.questioned.includes(f.id);
  // Pressing a soul on what it said (docs/tech-spec.md §66): how it took it, and what it added.
  const gave = soul.gave?.includes(f.id) ?? false;
  const held = !gave && (soul.pressed?.includes(f.id) ?? false);
  const canPress = variant === 'line' && pressable(s.state, s.ctx).includes(f.id);
  const badge = flag ? 'ui.contradicted' : gave ? 'ui.press.badge.gave' : held ? 'ui.press.badge.held' : null;
  return (
    <span
      class={`evidence evidence--${variant}${flag || gave ? ' is-lie' : ''}${f.id.startsWith(SAID) ? ' is-said' : ''}`}
    >
      <button
        type="button"
        class={`evidence__pick${selected ? ' is-selected' : ''}`}
        aria-pressed={comparing.value ? selected : undefined}
        data-field={f.id}
        onClick={() => pick(f.id)}
      >
        {fieldText(f, c)}
      </button>
      {/* Holding to a claim says nothing about whether it's true: its badge is quiet, not a lie's. */}
      {badge ? <span class={`evidence__badge${held ? ' evidence__badge--quiet' : ''}`}>{t(badge)}</span> : null}
      {f.id.startsWith(SAID) ? (
        <span class="evidence__badge evidence__badge--quiet">{t('ui.press.badge.said')}</span>
      ) : null}
      {flag && !questioned ? (
        <button
          type="button"
          class="btn btn--small"
          data-testid="question"
          onClick={() => act({ t: 'question', lie: f.id })}
        >
          {/* The day's first questions can be free: a god's favour (docs/tech-spec.md §43). */}
          {freeQuestion(s.state)
            ? t('ui.questionFree')
            : t('ui.question', { s: questionCostMs(s.state, s.ctx) / 1000 })}
        </button>
      ) : null}
      {canPress ? (
        <button
          type="button"
          class="btn btn--small"
          data-testid="press"
          aria-label={t('ui.press.aria', { line: fieldText(f, c), s: pressCostMs(s.ctx) / 1000 })}
          onClick={() => act({ t: 'press', field: f.id })}
        >
          {t('ui.press', { s: pressCostMs(s.ctx) / 1000 })}
        </button>
      ) : null}
    </span>
  );
}

/** Region label for the "look" chips; both hands show the same signs, so they share one chip. */
const regionLabel = (spot: Hotspot) =>
  t(spot.id === 'handL' || spot.id === 'handR' ? 'region.hands' : `region.${spot.id}`);

function Clues({ s, c }: { s: Session; c: CaseSpec }) {
  const st = s.state;
  const spots = art.value.hotspots(sceneFor(c, st.soul));
  const seen = c.evidence.fields.filter((f) => f.item === 'body' && st.soul.seen.includes(f.id));
  const pending: Hotspot[] = [];
  const pendingFields = new Set<string>();
  for (const spot of spots) {
    const fields = regionFields(spot, st, s.ctx).filter((f) => !st.soul.seen.includes(f.id));
    if (fields.length === 0 || fields.every((f) => pendingFields.has(f.id))) continue;
    for (const f of fields) pendingFields.add(f.id);
    pending.push(spot);
  }
  return (
    <div class="clues">
      {seen.map((f) => (
        <Evidence key={f.id} s={s} c={c} f={f} variant="chip" />
      ))}
      {pending.map((spot) => (
        <button
          key={spot.id}
          type="button"
          class="chip chip--look"
          data-region={spot.id}
          aria-label={t('ui.look', { region: regionLabel(spot) })}
          onClick={() => act({ t: 'inspect', fields: regionFields(spot, st, s.ctx).map((f) => f.id) })}
        >
          {t('ui.look.short', { region: regionLabel(spot) })}
        </button>
      ))}
    </div>
  );
}

function Lines({ s, c, items, empty }: { s: Session; c: CaseSpec; items: readonly Field[]; empty: string }) {
  // Reading a paper counts as looking at it.
  const ids = items.map((f) => f.id).join();
  useEffect(() => {
    const unseen = items.filter((f) => !s.state.soul.seen.includes(f.id)).map((f) => f.id);
    if (unseen.length > 0) act({ t: 'inspect', fields: unseen });
  }, [c.id, ids]);
  if (items.length === 0) return <p class="muted">{empty}</p>;
  return (
    <ul class="lines">
      {items.map((f) => (
        <li key={f.id}>
          <Evidence s={s} c={c} f={f} variant="line" />
        </li>
      ))}
    </ul>
  );
}

function Words({ s, c }: { s: Session; c: CaseSpec }) {
  // What a soul added when pressed comes right after the claim it was holding to (docs/tech-spec.md §66).
  const said = s.state.soul.said ?? [];
  const items = c.evidence.fields
    .filter((f) => f.item === 'testimony')
    .flatMap((f) => [f, ...said.filter((x) => x.id === `${SAID}${f.id}`)]);
  // The one-time tip for pressing (docs/tech-spec.md §66), beside the claims it's about.
  const tip = tipStep(s, coachState());
  return (
    <div class="words">
      <p class="words__who">
        {c.evidence.look.name} {c.evidence.look.patronym}
      </p>
      {tip ? (
        <div class="words__tip" data-testid="press-tip" role="note">
          <p>{t(tip.step.text)}</p>
          <button type="button" class="btn btn--small" data-testid="press-tip-ok" onClick={() => noteTip('press')}>
            {t('ui.coach.gotIt')}
          </button>
        </div>
      ) : null}
      <Lines s={s} c={c} items={items} empty={t('ui.words.none')} />
      {pressTaught(s.state, s.ctx) && items.length > 0 ? (
        <p class="muted words__patience" data-testid="patience">
          {t('ui.press.patience', { n: patienceLeft(s.state, s.ctx) })}
        </p>
      ) : null}
    </div>
  );
}

function Ravens({ s, c }: { s: Session; c: CaseSpec }) {
  const items = c.evidence.fields.filter((f) => f.item === 'huginn' || f.item === 'muninn');
  return <Lines s={s} c={c} items={items} empty={t('ui.ravens.none')} />;
}

/** The soul's saga tally: its carved lines, and under the rune-lens, any sign it was forged. */
function Tally({ s, c }: { s: Session; c: CaseSpec }) {
  const lens = s.state.soul.tools.includes('runeLens');
  const items = c.evidence.fields.filter((f) => f.item === 'tally' && (f.says !== undefined || lens));
  return (
    <div class="tally" data-testid="tally">
      <Lines s={s} c={c} items={items} empty="" />
      {!lens && s.ctx.tools.has('runeLens') ? <p class="muted">{t('ui.tally.lens')}</p> : null}
    </div>
  );
}

const hasTally = (c: CaseSpec) => c.evidence.fields.some((f) => f.item === 'tally');

/** The registry, looked up by this soul's name once the player searches it. */
function Registry({ s, c }: { s: Session; c: CaseSpec }) {
  const f = c.evidence.fields.find((x) => x.item === 'registry');
  const { name, patronym } = c.evidence.look;
  if (!f || !s.state.soul.tools.includes('registry')) {
    return <p class="muted">{t('ui.registry.unsearched', { name, patronym })}</p>;
  }
  const entry = registryEntry(c, f);
  return (
    <div class="registry" data-testid="registry-entry">
      {entry.kind === 'nobody' ? null : (
        <div
          class="registry__portrait"
          role="img"
          aria-label={t('ui.registry.portrait', { name, patronym })}
          dangerouslySetInnerHTML={{ __html: art.value.portrait(entry) }}
        />
      )}
      <Lines s={s} c={c} items={[f]} empty="" />
    </div>
  );
}

function CompareBar() {
  if (!comparing.value) return null;
  const s = session.value;
  // Under Týr's oath (an Endless curse, docs/tech-spec.md §68) a Compare that finds nothing is a strike: the bar says
  // so in place of its hint, so it's no bigger over the desk.
  const oath = s?.mode.kind === 'endless' && endlessRules(s).oath;
  return (
    <div class="comparebar" role="status">
      {oath ? (
        <strong class="comparebar__oath" data-testid="oath-note">
          {t('ui.endless.oath')}
        </strong>
      ) : (
        <span>{t('ui.compare.hint')}</span>
      )}
      <button type="button" class="btn btn--small" data-back onClick={toggleCompare}>
        {t('ui.compare.cancel')}
      </button>
    </div>
  );
}

function SendButton({ s }: { s: Session }) {
  const chosen = s.state.soul.stamp !== null;
  // A party goes together (docs/tech-spec.md §69): until every member has its stamp, Send goes on to the next.
  const party = s.state.party;
  const here = party ? turnedTo(s.state) : 0;
  const n = party?.souls.length ?? 1;
  const next = party
    ? Array.from({ length: n }, (_, k) => (here + 1 + k) % n).find((k) => memberSoul(s.state, k)?.stamp === null)
    : undefined;
  const nextName = party && next !== undefined ? (s.state.cases[party.start + next]?.evidence.look.name ?? '') : '';
  // Going on to the next member sends nobody, so it needs no holding.
  const hold = settings.value.holdToSend && next === undefined;
  const pointer = useRef('mouse');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [holding, setHolding] = useState(false);
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const cancel = () => {
    clearTimeout(timer.current);
    setHolding(false);
  };
  useEffect(() => cancel, []);
  return (
    <button
      type="button"
      class={`btn btn--send${holding ? ' is-holding' : ''}`}
      data-testid="send"
      disabled={!chosen}
      onPointerDown={(e) => {
        pointer.current = e.pointerType;
        if (!chosen || !hold || e.pointerType === 'mouse') return;
        setHolding(true);
        timer.current = setTimeout(() => {
          setHolding(false);
          act({ t: 'send' });
        }, 300);
      }}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onClick={(e) => {
        // Touch sends by holding; keyboard (detail 0) and mouse send on click.
        const touch = pointer.current === 'touch' || pointer.current === 'pen';
        pointer.current = 'mouse';
        if (hold && touch && e.detail !== 0) return;
        act({ t: 'send' });
      }}
    >
      {party && next !== undefined
        ? t('ui.party.nextSoul', { name: nextName })
        : party
          ? t(hold && coarse && !padInUse.value ? 'ui.party.send.hold' : 'ui.party.send', { n })
          : t(hold && coarse && !padInUse.value ? 'ui.send.hold' : 'ui.send')}{' '}
      <kbd>Enter</kbd>
    </button>
  );
}

function StampRack({ s }: { s: Session }) {
  const chosen = s.state.soul.stamp;
  return (
    <fieldset class="stamps">
      <legend class="sr-only">{t('ui.stamp.choose')}</legend>
      <span class="pad" aria-hidden="true">
        RT
      </span>
      {stampsFor(s.ctx).map((d, i) => (
        <button
          key={d}
          type="button"
          class={`stamp stamp--${d.toLowerCase()}`}
          aria-pressed={chosen === d}
          data-dest={d}
          onClick={() => act({ t: 'stamp', dest: d })}
        >
          <kbd>{i + 1}</kbd> {t(`dest.${d}`)}
        </button>
      ))}
      <SendButton s={s} />
    </fieldset>
  );
}

/** Ask Skögul where to look: she points at a piece of what decides the soul, for some sun. */
function HintButton({ s }: { s: Session }) {
  if (!hintsAllowed(s)) return null;
  const none = nextHint(s.state) === null;
  // An Endless run's hints are the ones it took (docs/tech-spec.md §68): the button says how many are left.
  const left = hintsLeft(s.state);
  const cost = sunCosts(s.content).hint / 1000;
  return (
    <button
      type="button"
      class="btn"
      data-testid="hint"
      data-pad="LT"
      disabled={none || left === 0}
      title={left === 0 ? t('ui.hint.noneLeft') : none ? t('ui.hint.none') : t('ui.hint.label', { s: cost })}
      aria-label={t('ui.hint.label', { s: cost })}
      onClick={() => act({ t: 'hint' })}
    >
      {t('ui.hint')}
      {left !== undefined ? <span data-testid="hints-left"> ({t('ui.hint.left', { n: left })})</span> : null}{' '}
      <kbd>H</kbd>
    </button>
  );
}

function ActionBar({ s }: { s: Session }) {
  return (
    <nav class="actionbar">
      <button
        type="button"
        class="btn"
        aria-pressed={comparing.value}
        data-testid="compare"
        data-pad="X"
        onClick={toggleCompare}
      >
        {t('ui.compare')} <kbd>C</kbd>
      </button>
      <HintButton s={s} />
      <button
        type="button"
        class="btn btn--primary"
        data-testid="judge"
        data-pad="RT"
        onClick={() => (stampSheet.value = true)}
      >
        {t('ui.judge')}
      </button>
    </nav>
  );
}

function StampSheet({ s }: { s: Session }) {
  if (!stampSheet.value) return null;
  return (
    <div class="sheet" role="dialog" aria-label={t('ui.stamp.choose')}>
      <div class="sheet__head">
        <h2>{t('ui.stamp.choose')}</h2>
        <button type="button" class="btn btn--quiet" data-back onClick={() => (stampSheet.value = false)}>
          {t('ui.back')}
        </button>
      </div>
      <StampRack s={s} />
    </div>
  );
}

/** With the rule tracker on (as the shift began), the rules what's been seen of this soul rules out. */
function trackerOut(s: Session): ReadonlySet<string> | undefined {
  return s.state.config.assists?.tracker ? new Set(ruledOut(s.state, s.ctx)) : undefined;
}

interface PaperDef {
  readonly id: PaperId;
  readonly title: string;
  readonly body: ComponentChildren;
  /** The soul's own paper, which comes in with it; the rules stay on the desk. */
  readonly soul: boolean;
}

/**
 * A paper on the desk layout, in its place or lying where it was put (shift/desk.ts). Its title picks it
 * up; a double click on the title puts it back.
 */
function DeskPaper({ p, spot, rank }: { p: PaperDef; spot?: PaperSpot; rank?: number }) {
  const moving = dragging.value?.id === p.id;
  const cls = `paper paper--${p.id}${p.soul ? ' paper--soul' : ''}${spot ? ' is-loose' : ''}${moving ? ' is-moving' : ''}`;
  const style = spot
    ? { left: `${spot.x * 100}%`, top: `${spot.y * 100}%`, width: `${spot.w * 100}%`, zIndex: 3 + (rank ?? 0) }
    : undefined;
  // The rulebook has nothing in it to press, so when it's long enough to scroll it takes the keyboard's focus
  // itself, as a named region; the soul's papers have their evidence to press.
  const rules = p.id === 'rules';
  return (
    // A controller's LB and RB move from paper to paper, and into one with nothing in it to press (gamepad.ts).
    <div
      class={cls}
      style={style}
      data-panel=""
      tabIndex={rules ? 0 : -1}
      {...(rules ? { role: 'region', 'aria-label': t(p.title) } : {})}
    >
      <h2
        class="paper__title"
        title={t('ui.desk.move')}
        data-pad={p.id === 'rules' ? 'View' : undefined}
        onPointerDown={(e) => grab(e, p.id)}
        onDblClick={() => place(p.id, null)}
      >
        {t(p.title)}
      </h2>
      {p.body}
    </div>
  );
}

function SoulDesk({ s, c, layout }: { s: Session; c: CaseSpec; layout: 'desk' | 'drawer' }) {
  // Each soul starts at the top, where a shift that scrolls (large text on a phone) was left further down.
  useLayoutEffect(toTop, []);
  // Keyboard players land on the first thing to look at when a new soul arrives.
  useEffect(() => {
    if (document.activeElement === document.body || document.activeElement === null) {
      document.querySelector<HTMLElement>('.chip--look')?.focus({ preventScroll: true });
    }
  }, [c.id]);
  // The soul's papers slide in as it walks up, and only then: a paper picked up later doesn't slide again.
  const [arriving, setArriving] = useState(true);
  useEffect(() => {
    const done = setTimeout(() => setArriving(false), 600);
    return () => clearTimeout(done);
  }, []);

  if (layout === 'desk') {
    const papers: PaperDef[] = [
      {
        id: 'rules',
        title: 'ui.tab.rules',
        body: <RulesPanel ctx={soulCtx(s.ctx, c)} state={s.state} out={trackerOut(s)} />,
        soul: false,
      },
      { id: 'words', title: 'ui.tab.words', body: <Words s={s} c={c} />, soul: true },
      { id: 'ravens', title: 'ui.tab.ravens', body: <Ravens s={s} c={c} />, soul: true },
      ...(s.ctx.tools.has('registry')
        ? [{ id: 'registry', title: 'ui.tab.registry', body: <Registry s={s} c={c} />, soul: true } as const]
        : []),
      ...(hasTally(c)
        ? [{ id: 'tally', title: 'ui.tab.tally', body: <Tally s={s} c={c} />, soul: true } as const]
        : []),
    ];
    const loose = papers
      .map((p) => ({ p, spot: spotOf(p.id) }))
      .filter((x): x is { p: PaperDef; spot: PaperSpot } => x.spot !== undefined)
      .sort((a, b) => a.spot.z - b.spot.z);
    const docked = papers.filter((p) => spotOf(p.id) === undefined);
    const rules = docked.find((p) => p.id === 'rules');
    return (
      <div class={`desk${arriving ? ' is-arriving' : ''}`}>
        {rules ? <DeskPaper p={rules} /> : null}
        <section class="desk__center" data-panel="">
          <BodyStage s={s} c={c} />
          <Clues s={s} c={c} />
        </section>
        <section class="desk__right">
          {docked
            .filter((p) => p.id !== 'rules')
            .map((p) => (
              <DeskPaper key={p.id} p={p} />
            ))}
        </section>
        <section class="desk__bottom" data-panel="">
          <span class="pad-legend" aria-hidden="true">
            <span class="pad">LB</span>
            <span class="pad">RB</span> {t('ui.pad.papers')}
          </span>
          <button
            type="button"
            class="btn"
            aria-pressed={comparing.value}
            data-testid="compare"
            data-pad="X"
            onClick={toggleCompare}
          >
            {t('ui.compare')} <kbd>C</kbd>
          </button>
          <HintButton s={s} />
          <StampRack s={s} />
          {loose.length > 0 ? (
            <button type="button" class="btn btn--quiet" data-testid="tidy" onClick={tidyDesk}>
              {t('ui.desk.tidy')}
            </button>
          ) : null}
        </section>
        {loose.map(({ p, spot }, i) => (
          <DeskPaper key={p.id} p={p} spot={spot} rank={i} />
        ))}
        <CompareBar />
      </div>
    );
  }

  // A soul without a tally has no tally tab; fall back to its words.
  const tab = drawerTab.value === 'tally' && !hasTally(c) ? 'words' : drawerTab.value;
  const tabs = [
    ['words', 'ui.tab.words'],
    ['ravens', 'ui.tab.ravens'],
    ...(hasTally(c) ? ([['tally', 'ui.tab.tally']] as const) : []),
    ...(s.ctx.tools.has('registry') ? ([['registry', 'ui.tab.registry']] as const) : []),
    ['rules', 'ui.tab.rules'],
  ] as const;
  return (
    <div class="drawer">
      <BodyStage s={s} c={c} />
      <Clues s={s} c={c} />
      <div class="tabs" role="tablist">
        <span class="pad" aria-hidden="true">
          LB
        </span>
        {tabs.map(([id, label]) => (
          <button
            key={id}
            id={`tab-${id}`}
            type="button"
            role="tab"
            aria-selected={tab === id}
            aria-controls="drawer-panel"
            data-tab={id}
            data-pad={id === 'rules' ? 'View' : undefined}
            onClick={() => (drawerTab.value = id)}
          >
            {t(label)}
          </button>
        ))}
        <span class="pad" aria-hidden="true">
          RB
        </span>
      </div>
      {/*
       * Keyed by tab, so each tab opens at its top rather than where the last one was scrolled to. It can take
       * the focus, so a keyboard can scroll a long tab (the rules) as well as a pointer can.
       */}
      <div
        key={tab}
        id="drawer-panel"
        class="drawer__panel"
        role="tabpanel"
        aria-labelledby={`tab-${tab}`}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling tab panel must take the focus to scroll by keyboard
        tabIndex={0}
      >
        {tab === 'words' ? (
          <Words s={s} c={c} />
        ) : tab === 'ravens' ? (
          <Ravens s={s} c={c} />
        ) : tab === 'registry' ? (
          <Registry s={s} c={c} />
        ) : tab === 'tally' ? (
          <Tally s={s} c={c} />
        ) : (
          <>
            {/* The tab says it's the rules; this says so to a screen reader's list of headings too. */}
            <h2 class="sr-only">{t('ui.tab.rules')}</h2>
            <RulesPanel ctx={soulCtx(s.ctx, c)} state={s.state} out={trackerOut(s)} />
          </>
        )}
      </div>
      <CompareBar />
      <ActionBar s={s} />
      <StampSheet s={s} />
    </div>
  );
}

/** What leaving a paused shift does to it, by mode (a campaign has its own Save and quit). */
function leaveNote(mode: Session['mode']): string {
  if (mode.kind === 'daily') return mode.ranked ? 'ui.leave.daily' : 'ui.leave.replay';
  return `ui.leave.${mode.kind}`;
}

function PauseOverlay() {
  const focus = useAutoFocus<HTMLButtonElement>();
  const mode = session.value?.mode;
  const campaign = mode?.kind === 'campaign';
  // Leaving an appeal takes it back to its morning, still to be heard.
  const leave = session.value?.leave ?? toTitle;
  return (
    <div class="overlay" role="dialog" aria-modal="true" aria-labelledby="pause-title">
      <div class="dialog">
        <h2 id="pause-title">{t('ui.paused')}</h2>
        <p>{t('ui.paused.body')}</p>
        <div class="row">
          <button
            type="button"
            class="btn btn--primary"
            data-testid="resume"
            data-back
            ref={focus}
            onClick={() => act({ t: 'resume' })}
          >
            {t('ui.resume')}
          </button>
          {campaign ? (
            <button type="button" class="btn" data-testid="save-quit" onClick={quitToSlots}>
              {t('ui.campaign.quit')}
            </button>
          ) : mode ? (
            // The shift is paused, and a Daily or Endless run is already saved as it stands.
            <button type="button" class="btn" data-testid="leave-shift" onClick={leave}>
              {t('ui.leave')}
            </button>
          ) : null}
        </div>
        {mode && !campaign ? (
          <p class="muted" data-testid="leave-note">
            {t(leaveNote(mode))}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function AnswerDialog() {
  const a = answer.value;
  return a ? <AnswerBox a={a} /> : null;
}

function AnswerBox({ a }: { a: Answer }) {
  const focus = useAutoFocus<HTMLButtonElement>();
  return (
    <div class="overlay" role="dialog" aria-modal="true" aria-labelledby="answer-title" aria-describedby="answer-lines">
      <div class="dialog dialog--answer">
        <h2 id="answer-title">{a.title ?? t('ui.answer.title', { name: a.name })}</h2>
        {/* Read out with the dialog: the answer is the point of asking. */}
        <div id="answer-lines">
          {a.lines.map((l) => (
            <p key={l} class="dialog__line">
              {l}
            </p>
          ))}
          {a.added ? (
            <>
              <p class="dialog__line" data-testid="answer-added">
                {a.added}
              </p>
              <p class="muted">{t('ui.press.added')}</p>
            </>
          ) : null}
        </div>
        <button
          type="button"
          class="btn btn--primary"
          data-testid="answer-close"
          data-back
          ref={focus}
          onClick={() => (answer.value = null)}
        >
          {t('ui.answer.close')}
        </button>
      </div>
    </div>
  );
}

/**
 * Fields a verdict says were never looked at, as the player reads them. A companion's (docs/tech-spec.md §69), named
 * `@<member>:<field>`, is read with the companion's name.
 */
function missedText(cases: readonly CaseSpec[], c: CaseSpec, index: number, ids: readonly string[]): string[] {
  return ids.flatMap((id) => {
    const at = parseMemberField(id);
    const whose = at && c.party ? cases[index - c.party.index + at.soul] : c;
    const f = whose?.evidence.fields.find((x) => x.id === (at?.field ?? id));
    if (!whose || !f) return [];
    return [at ? t('ui.party.on', { name: whose.evidence.look.name, what: fieldText(f, whose) }) : fieldText(f, whose)];
  });
}

/**
 * The one-time tip for a party at the desk (docs/tech-spec.md §69), and then, the first time one comes, for a jarl's
 * retinue (§70): which to show, if either.
 */
function partyTip(s: Session): 'party' | 'retinue' | null {
  const c = coachState();
  if (!c.on || s.state.party === undefined || activeLesson(s, c)) return null;
  const tips = c.tips ?? [];
  if (!tips.includes('party')) return 'party';
  const retinue = s.state.cases[s.state.party.start]?.party?.lord !== undefined;
  return retinue && !tips.includes('retinue') ? 'retinue' : null;
}

/**
 * A party at the desk (docs/tech-spec.md §69): what brought them, and each of them, to turn to, marked with its stamp
 * once it has one. They go together, when all are stamped.
 */
function PartyStrip({ s }: { s: Session }) {
  const party = s.state.party;
  if (!party) return null;
  const members = s.state.cases.slice(party.start, party.start + party.souls.length);
  const title = members[0]?.party?.title;
  // A retinue's jarl (docs/tech-spec.md §70), marked as such.
  const lordAt = members[0]?.party?.lord?.at;
  const here = turnedTo(s.state);
  const tip = partyTip(s);
  return (
    <section class="party" data-testid="party" aria-label={t('ui.party.label', { n: members.length })}>
      {title ? (
        <p class="party__title" data-testid="party-title">
          {t(title.msg, title.params)}
        </p>
      ) : null}
      <div class="party__members">
        {members.map((m, k) => {
          const stamped = memberSoul(s.state, k)?.stamp;
          return (
            <button
              key={m.id}
              type="button"
              class={`party__member${k === here ? ' is-here' : ''}`}
              aria-current={k === here ? 'true' : undefined}
              data-testid="party-member"
              data-member={k}
              onClick={() => act({ t: 'turn', to: k })}
            >
              {m.evidence.look.name}
              {k === lordAt ? (
                <span class="party__lord" data-testid="party-lord">
                  {t('ui.party.lord')}
                </span>
              ) : null}
              {stamped ? (
                <span class="party__stamp" data-testid="party-stamp">
                  {t(`dest.${stamped}`)}
                </span>
              ) : null}
            </button>
          );
        })}
        <span class="party__keys" aria-hidden="true">
          <kbd>[</kbd> <kbd>]</kbd>
        </span>
      </div>
      {tip ? (
        <div class="party__tip" data-testid={`${tip}-tip`} role="note">
          <p>{t(`coach.${tip}`)}</p>
          <button type="button" class="btn btn--small" data-testid={`${tip}-tip-ok`} onClick={() => noteTip(tip)}>
            {t('ui.coach.gotIt')}
          </button>
        </div>
      ) : null}
    </section>
  );
}

function CitationSlip({ s }: { s: Session }) {
  const v = citation.value;
  return v ? <CitationBox key={v.index} s={s} v={v} /> : null;
}

function CitationBox({ s, v }: { s: Session; v: Verdict }) {
  const focus = useAutoFocus<HTMLButtonElement>();
  const c = s.state.cases[v.index];
  const rule = s.ctx.rules.find((r) => r.id === v.rule);
  const missed = c ? missedText(s.state.cases, c, v.index, v.missed) : [];
  const skipped = skippedText(v.skipped, s.ctx);
  const name = c?.evidence.look.name ?? '';
  const dest = t(`dest.${v.expected}`);
  return (
    <div
      class="overlay"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="citation-title"
      aria-describedby="citation-body"
    >
      <div class="dialog dialog--citation">
        <h2 id="citation-title">{t('ui.citation.title')}</h2>
        {/* Read out with the dialog, not just its title and button: why the stamp was wrong. */}
        <div id="citation-body">
          {v.stamped === v.expected && skipped.length > 0 ? (
            <p data-testid="citation-skipped">
              {t('ui.citation.skippedOnly', { name, dest, procs: listText(skipped) })}
            </p>
          ) : (
            <p>{t('ui.citation.should', { name, dest })}</p>
          )}
          {v.stamped !== v.expected && skipped.length > 0 ? (
            <p data-testid="citation-skipped">{t('ui.citation.skipped', { procs: listText(skipped) })}</p>
          ) : null}
          {rule ? <p class="dialog__rule">{t(ruleText(rule, s.ctx.day))}</p> : null}
          {missed.length > 0 ? <p>{t('ui.citation.missed', { fields: listText(missed) })}</p> : null}
        </div>
        <div class="row">
          <button
            type="button"
            class="btn btn--primary"
            data-testid="citation-close"
            data-back
            ref={focus}
            onClick={closeCitation}
          >
            {t('ui.citation.close')}
          </button>
          {v.stamped !== null ? (
            <button type="button" class="btn" data-testid="citation-look" onClick={() => lookAgain(v.index)}>
              {t('ui.review.open')}
            </button>
          ) : null}
          <button
            type="button"
            class="btn btn--quiet"
            data-testid="citation-report"
            onClick={() => openReport(s, v.index)}
          >
            {t('ui.report.dispute')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- a judged soul, looked at again (docs/tech-spec.md §67) ----------

/** How a judged soul is drawn to look at again: turned whichever way, with every tool's reading on it. */
const REVIEW_SOUL: SoulState = {
  seen: [],
  view: 'front',
  flipped: true,
  tools: [],
  flagged: [],
  questioned: [],
  stamp: null,
};

/** One side of a judged soul: its signs that decided it outlined, and the ones never looked at marked. */
function ReviewStage({
  c,
  view,
  marks,
}: {
  c: CaseSpec;
  view: 'front' | 'back';
  marks: ReadonlyMap<string, 'missed' | 'proof'>;
}) {
  const provider = art.value;
  const scene = sceneFor(c, { ...REVIEW_SOUL, view, tools: toolsFor(c.evidence.fields) });
  const svg = useMemo(() => provider.draw(scene), [provider, c.id, view]);
  const { w, h } = provider.frame;
  const stage = useRef<HTMLElement>(null);
  const pixelSize = usePixelFrame(stage, provider.frame);
  return (
    <figure class="stage stage--review" data-art={provider.id} data-view={view} ref={stage}>
      <div class="stage__frame" style={pixelSize}>
        <div
          class="stage__art"
          role="img"
          aria-label={t(view === 'front' ? 'ui.body.front' : 'ui.body.back')}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
        {provider.hotspots(scene).map((spot) => {
          const kinds = c.evidence.fields
            .filter((f) => f.item === 'body' && (f.view ?? 'front') === view && spot.keys.includes(signKey(f) ?? ''))
            .map((f) => marks.get(f.id));
          const mark = kinds.includes('missed') ? 'missed' : kinds.includes('proof') ? 'proof' : null;
          if (!mark) return null;
          return (
            <span
              key={spot.id}
              class={`review__mark is-${mark}`}
              data-region={spot.id}
              aria-hidden="true"
              style={{
                left: pctOf(spot.x, w),
                top: pctOf(spot.y, h),
                width: pctOf(spot.w, w),
                height: pctOf(spot.h, h),
              }}
            />
          );
        })}
      </div>
    </figure>
  );
}

/** A judged soul looked at again, from its citation, the day's summary or the audit. */
export function ReviewDialog() {
  const r = review.value;
  const s = session.value;
  const c = r && s ? s.state.cases[r.index] : undefined;
  const v = r && s ? s.state.verdicts[r.index] : undefined;
  return s && c && v ? <ReviewBox key={c.id} s={s} c={c} v={v} held={r?.held === true} /> : null;
}

function ReviewBox({ s, c, v, held }: { s: Session; c: CaseSpec; v: Verdict; held: boolean }) {
  const focus = useAutoFocus<HTMLButtonElement>();
  const ctx = soulCtx(s.ctx, c);
  const rule = ctx.rules.find((x) => x.id === v.rule);
  const byId = new Map(c.evidence.fields.map((f) => [f.id, f]));
  const proof = c.meta.proof.flatMap((id) => {
    const f = byId.get(id);
    return f ? [f] : [];
  });
  const missed = new Set(v.missed);
  const lies = c.lies.flatMap((l) => {
    const f = byId.get(l.field);
    return f ? [f] : [];
  });
  const marks = new Map(proof.map((f) => [f.id, missed.has(f.id) ? ('missed' as const) : ('proof' as const)]));
  // What the proof needed on the soul's companions (docs/tech-spec.md §69): what showed its lie about one false.
  const across = (c.meta.crossProof ?? []).map((x) => {
    const id = memberField(x.soul, x.field);
    return { id, text: missedText(s.state.cases, c, v.index, [id])[0] ?? id, missed: missed.has(id) };
  });
  const name = `${c.evidence.look.name} ${c.evidence.look.patronym}`;
  const expected = t(`dest.${v.expected}`);
  const skipped = skippedText(v.skipped, ctx);
  const again = canTryAgain(s);
  return (
    <div
      class="overlay overlay--review"
      role="dialog"
      aria-modal="true"
      aria-labelledby="review-title"
      data-testid="review"
    >
      <div class="dialog dialog--review">
        <h2 id="review-title">{t('ui.review.title', { name })}</h2>
        <p>
          {v.stamped === v.expected
            ? t('ui.review.skipped', { dest: expected, procs: listText(skipped) })
            : t('ui.review.sent', { stamped: t(`dest.${v.stamped}`), expected })}
        </p>
        {rule ? (
          <>
            <h3>{t('ui.review.rule')}</h3>
            <p class="dialog__rule">{t(ruleText(rule, ctx.day))}</p>
          </>
        ) : null}
        <div class="review__stages">
          {(['front', 'back'] as const)
            .filter((view) => view === 'front' || ctx.tools.has('flip'))
            .map((view) => (
              <ReviewStage key={view} c={c} view={view} marks={marks} />
            ))}
        </div>
        <h3>{t('ui.review.proof')}</h3>
        <ul class="lines review__list" data-testid="review-proof">
          {proof.map((f) => (
            <li key={f.id} data-field={f.id} class={missed.has(f.id) ? 'is-missed' : undefined}>
              {fieldText(f, c)} {missed.has(f.id) ? <span class="evidence__badge">{t('ui.review.missed')}</span> : null}
            </li>
          ))}
          {across.map((x) => (
            <li key={x.id} data-field={x.id} class={x.missed ? 'is-missed' : undefined}>
              {x.text} {x.missed ? <span class="evidence__badge">{t('ui.review.missed')}</span> : null}
            </li>
          ))}
        </ul>
        {v.missed.length === 0 && v.stamped !== v.expected ? <p class="muted">{t('ui.review.allSeen')}</p> : null}
        {lies.length > 0 ? (
          <>
            <h3>{t('ui.review.lies')}</h3>
            <ul class="lines review__list" data-testid="review-lies">
              {lies.map((f) => (
                <li key={f.id}>
                  {fieldText(f, c)} <span class="evidence__badge">{t('ui.review.lie')}</span>
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {held ? <p class="muted">{t('ui.review.held')}</p> : null}
        <div class="row">
          {again ? (
            <button type="button" class="btn btn--primary" data-testid="review-again" onClick={() => tryAgain(v.index)}>
              {t('ui.review.again')}
            </button>
          ) : null}
          <button
            type="button"
            class={again ? 'btn' : 'btn btn--primary'}
            data-testid="review-close"
            data-back
            ref={focus}
            onClick={closeReview}
          >
            {t('ui.review.close')}
          </button>
        </div>
      </div>
    </div>
  );
}

/** "Report this soul": the report as text, a copy button and the pre-filled GitHub form. */
export function ReportDialog() {
  const r = reportFor.value;
  return r ? <ReportBox r={r} /> : null;
}

function ReportBox({ r }: { r: SoulReport }) {
  const focus = useAutoFocus<HTMLButtonElement>();
  const [copied, setCopied] = useState<boolean | null>(null);
  const json = JSON.stringify(r);
  const url = reportUrl(r);
  return (
    <div class="overlay overlay--top" role="dialog" aria-modal="true" aria-labelledby="report-title">
      <div class="dialog">
        <h2 id="report-title">{t('ui.report.title')}</h2>
        <p>{t('ui.report.body')}</p>
        <p class="muted">{reportTitle(r)}</p>
        <textarea
          class="share share--small"
          readOnly
          rows={4}
          value={json}
          aria-label={t('ui.report.textLabel')}
          data-testid="report-text"
        />
        <div class="row">
          {url ? (
            <a class="btn btn--primary" href={url} target="_blank" rel="noopener noreferrer" data-testid="report-open">
              {t('ui.report.open')}
            </a>
          ) : null}
          <button
            type="button"
            class="btn"
            data-testid="report-copy"
            onClick={async () => setCopied(await copyText(json))}
          >
            {t(copied === true ? 'ui.report.copied' : copied === false ? 'ui.report.copyFailed' : 'ui.report.copy')}
          </button>
          <button
            type="button"
            class="btn btn--quiet"
            data-testid="report-close"
            data-back
            ref={focus}
            onClick={() => (reportFor.value = null)}
          >
            {t('ui.report.close')}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The coach: the primer's steps, or the lesson of a day's first soul. One instruction at a time, with Next
 * for reading steps. Skipping the primer leaves it; skipping a lesson only puts it away.
 */
function CoachBar({ s, lesson }: { s: Session; lesson: Lesson | null }) {
  const now = coachStep(s, coachAcks.value, lesson);
  const primer = s.mode.kind === 'primer';
  if (!primer && !lesson) return null;
  const step = now?.step;
  return (
    <div class="coach" data-testid="coach" data-step={step?.id ?? 'none'}>
      <p class="coach__text" role="status" aria-live="polite">
        {step ? t(step.text) : ''}
      </p>
      <div class="coach__actions">
        {step?.next ? (
          <button
            type="button"
            class="btn btn--primary btn--small"
            data-testid="coach-next"
            onClick={() => (coachAcks.value = [...coachAcks.value, step.id])}
          >
            {t(primer ? 'primer.next' : 'ui.coach.next')}
          </button>
        ) : null}
        <button
          type="button"
          class="btn btn--quiet btn--small"
          data-testid="coach-skip"
          onClick={() => {
            if (primer) {
              updateSettings({ primerDone: true });
              toTitle();
            } else noteCoached(s.ctx.day);
          }}
        >
          {t(primer ? 'primer.skip' : 'ui.coach.skip')}
        </button>
      </div>
    </div>
  );
}

/**
 * What a story soul offers for a stamp where it doesn't belong (docs/tech-spec.md §47), said openly while it's at
 * the desk: taking it is a choice, never a slip. The stamp is still wrong, with its citation.
 */
function OfferNote({ s, c }: { s: Session; c: CaseSpec }) {
  const offer = storyOffer(s.content, c);
  if (!offer) return null;
  const name = `${c.evidence.look.name} ${c.evidence.look.patronym}`;
  return (
    <p class="shift__note" data-testid="offer-banner">
      {t('ui.offer', { name, n: offer.rings, dest: t(`dest.${offer.dest}`) })}
    </p>
  );
}

/**
 * What a soul asks for, openly, where it doesn't belong (docs/tech-spec.md §51, §59), while it's at the desk: a story
 * soul's plea, or an ordinary soul's.
 */
function PleaNote({ s, c }: { s: Session; c: CaseSpec }) {
  const plea = pleaOf(s.content, c);
  if (!plea) return null;
  const { name, patronym, gender } = c.evidence.look;
  // Granted, the soul stands with the host of the hall it asked for, where the last battle has one.
  const host = s.content.campaign?.ragnarok?.hosts.some((h) => h.hall === plea.dest) ?? false;
  const kinGender = c.kin ? genderOfName(c.kin.name) : 'm';
  return (
    <p class="shift__note" data-testid="plea-banner">
      {t(plea.text, { name: `${name} ${patronym}`, gender, dest: t(`dest.${plea.dest}`), kinGender })}
      {host && <span data-testid="plea-stands"> {t('ui.plea.stands', { gender })}</span>}
    </p>
  );
}

/** Kin of a soul sent to a hall where it didn't belong (docs/tech-spec.md §60), who says so while at the desk. */
function KinNote({ s, c }: { s: Session; c: CaseSpec }) {
  const def = s.content.campaign?.kin;
  if (!def || !c.kin) return null;
  const { name, patronym, gender } = c.evidence.look;
  return (
    <p class="shift__note" data-testid="kin-banner">
      {t(def.text, {
        name: `${name} ${patronym}`,
        gender,
        kin: c.kin.name,
        kinGender: genderOfName(c.kin.name),
        relation: kinRelation(gender, c.kin.name),
        hall: c.kin.hall,
        day: c.kin.day,
      })}
    </p>
  );
}

/**
 * A noon decree (docs/tech-spec.md §45): from `notice` souls before it holds, the raven's news on the desk with the
 * new choices, and once it holds, a line to say what changed at noon. The rulebook shows the rules of the soul at
 * the desk throughout.
 */
function NoonNote({ s }: { s: Session }) {
  const noon = s.ctx.noon;
  if (!noon) return null;
  const first = s.state.cases.findIndex((x) => x.noon);
  const shown = first >= 0 && s.state.cursor >= first - noon.notice;
  // The new choices in their own words ("Freyja claims the red-haired today.").
  const news = (s.ctx.spec.noon?.redraw ?? []).flatMap((name) => {
    const p = noon.ctx.paramChoices[name];
    return p ? [t(p.text)] : [];
  });
  // A live region from the start of the shift, so the raven's news is read out when it comes.
  return (
    <div class="shift__noon-region" role="status" aria-live="polite">
      {!shown ? null : s.state.cursor < first ? (
        <div class="shift__noon" data-testid="noon-raven">
          <p>{t(noon.text)}</p>
          {news.map((line) => (
            <p key={line} class="decree__whim">
              {line}
            </p>
          ))}
        </div>
      ) : (
        <p class="shift__request" data-testid="noon-since">
          {t('ui.noon.since', { news: news.join(' ') })}
        </p>
      )}
    </div>
  );
}

export function ToastView() {
  const msg = toast.value;
  return (
    <div class="toast-region" role="status" aria-live="polite">
      {msg ? (
        <p key={msg.id} class={`toast toast--${msg.tone}`}>
          {msg.text}
        </p>
      ) : null}
    </div>
  );
}

/**
 * A sent soul walks off the way its stamp sends it while the next one walks up (shift/motion.ts). A plain
 * signal effect runs as soon as the send's batch ends, before the desk re-renders (useSignalEffect would wait
 * for the next frame, after it), so the copy is of the soul where it stood, ink and all.
 */
function useWalkOff(): void {
  useEffect(() => {
    let seen = departed.peek();
    return effect(() => {
      const sent = departed.value;
      if (!sent || sent === seen) return;
      seen = sent;
      const frame = document.querySelector<HTMLElement>('.shift .stage__frame');
      if (frame) walkOff(frame, sent.dest);
    });
  }, []);
}

export function ShiftScreen() {
  useWalkOff();
  const s = session.value;
  if (!s) return null;
  const layout = effectiveLayout();
  const paused = s.state.clock.pausedAt !== null;
  // Someone at the desk (docs/tech-spec.md §46): a campaign scene between souls, with the sun held.
  const campaign = s.mode.kind === 'campaign' ? campaignUi.value : null;
  const visit = campaign?.deskDue() ?? null;
  const reviewing = review.value !== null;
  const blocked =
    paused ||
    visit !== null ||
    answer.value !== null ||
    citation.value !== null ||
    reportFor.value !== null ||
    reviewing;
  const c = currentCase(s.state);
  const lesson = activeLesson(s, coachState());
  const coach = coachStep(s, coachAcks.value, lesson);
  return (
    <main
      class={`shift shift--${layout}${paused ? ' is-paused' : ''}${comparing.value ? ' is-comparing' : ''}`}
      data-layout={layout}
      data-coach={coach?.focus ?? pendingHintFocus(s.state)}
    >
      {/* The page's name for screen readers; the desk shows it in the sun bar and the soul count. */}
      <h1 class="sr-only">{modeTitle(s)}</h1>
      <div class="shift__desk" inert={blocked}>
        <Sky s={s} />
        <SunBar s={s} />
        {s.mode.kind === 'appeal' || s.mode.kind === 'again' ? (
          <p class="shift__appeal" data-testid={`${s.mode.kind}-banner`}>
            {modeTitle(s)}
          </p>
        ) : null}
        {/* The gods' requests today, and how far along each is (docs/tech-spec.md §42). */}
        {s.mode.kind === 'campaign'
          ? (s.mode.requests ?? []).map((r) => (
              <p key={r.id} class="shift__request" data-testid="request-progress">
                {t('ui.request.progress', {
                  god: t(factionKey(s.content, r.god, s.ctx.day)),
                  done: s.state.verdicts.filter((v) => v.expected === r.from && v.stamped === r.to).length,
                  n: r.n,
                  to: t(`dest.${r.to}`),
                })}
              </p>
            ))
          : null}
        <NoonNote s={s} />
        {/* A soul the sun set on yesterday, back first today and judged by today's rules (docs/tech-spec.md §41). */}
        {s.mode.kind === 'campaign' && c && c.day < s.ctx.day ? (
          <p class="shift__appeal" data-testid="waited-banner">
            {t('ui.line.waited', { n: c.day })}
          </p>
        ) : null}
        {/* What the soul says of itself: an offer, whose kin it is, a plea. One box, empty (and hidden) for most. */}
        {s.mode.kind === 'campaign' && c ? (
          <div class="shift__notes">
            <OfferNote s={s} c={c} />
            <KinNote s={s} c={c} />
            <PleaNote s={s} c={c} />
          </div>
        ) : null}
        <CoachBar s={s} lesson={lesson} />
        <PartyStrip s={s} />
        {c ? <SoulDesk key={c.id} s={s} c={c} layout={layout} /> : null}
      </div>
      {/* A soul looked at again holds the sun, and covers the desk instead of the pause (docs/tech-spec.md §67). */}
      {visit && campaign ? (
        <campaign.DeskVisitDialog id={visit} />
      ) : reviewing ? (
        <ReviewDialog />
      ) : paused ? (
        <PauseOverlay />
      ) : null}
      <AnswerDialog />
      <CitationSlip s={s} />
      <ReportDialog />
    </main>
  );
}
