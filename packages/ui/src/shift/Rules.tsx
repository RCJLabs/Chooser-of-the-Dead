import {
  type DayCtx,
  kenningsToday,
  questionCostMs,
  ruleText,
  type ShiftState,
  sunCosts,
  toolCost,
} from '@cots/engine';
import { t } from '../i18n';

/** Decree, Freyja's whim and the rulebook in force: shown at the briefing and on the desk. */
export function Decree({ ctx }: { ctx: DayCtx }) {
  return (
    <div class="decree">
      <p data-testid="decree">{t(ctx.spec.decree)}</p>
      {Object.values(ctx.paramChoices).map((p) => (
        <p key={p.id} class="decree__whim" data-testid="whim">
          {t(p.text)}
        </p>
      ))}
    </div>
  );
}

/**
 * The rulebook in force. With the rule tracker on (an assist), `out` holds the rules that what the
 * player has seen of the soul already rules out: they're greyed and say so.
 */
/**
 * The rulebook, the day's decree first unless `decree` is false. With a shift's `state`, the costs are
 * what they are in that shift, after the campaign's upgrades.
 */
export function RulesPanel({
  ctx,
  decree = true,
  out,
  state,
}: {
  ctx: DayCtx;
  decree?: boolean;
  out?: ReadonlySet<string>;
  state?: ShiftState;
}) {
  return (
    <div class="rules">
      {decree ? <Decree ctx={ctx} /> : null}
      <h3>{t('ui.rules.title')}</h3>
      {out ? (
        <p class="rules__tracker muted" data-testid="rule-tracker">
          {t('ui.rules.tracker')}
        </p>
      ) : null}
      <ol class="rules__order">
        {ctx.rules.map((r) => (
          <li key={r.id} data-rule={r.id} class={out?.has(r.id) ? 'is-out' : undefined} data-out={out?.has(r.id)}>
            {t(ruleText(r, ctx.day))}
            {r.woven ? (
              <span class="rules__woven muted" data-testid="rule-woven">
                {' '}
                ({t('ui.rules.woven')})
              </span>
            ) : null}
            {out?.has(r.id) ? <span class="rules__out"> ({t('ui.rules.out')})</span> : null}
          </li>
        ))}
      </ol>
      {ctx.signLaws.length > 0 ? (
        <>
          <h3>{t('ui.rules.signs')}</h3>
          <ul>
            {ctx.signLaws.map((l) => (
              <li key={l.id}>{t(l.text)}</li>
            ))}
          </ul>
        </>
      ) : null}
      {ctx.factLaws.length > 0 ? (
        <>
          <h3>{t('ui.rules.customs')}</h3>
          <ul>
            {ctx.factLaws.map((l) => (
              <li key={l.id}>{t(l.text)}</li>
            ))}
          </ul>
        </>
      ) : null}
      {kenningsToday(ctx) ? <Kennings ctx={ctx} /> : null}
      {ctx.procedures.length > 0 ? (
        <>
          <h3>{t('ui.rules.procedures')}</h3>
          <ul>
            {ctx.procedures.map((p) => (
              <li key={p.id}>{t(p.text)}</li>
            ))}
          </ul>
        </>
      ) : null}
      <h3>{t('ui.rules.tools')}</h3>
      <ul>
        {[...ctx.tools].map(([id, s]) => (
          <li key={id}>
            {t('ui.rules.toolCost', { tool: t(`tool.${id}`), s: (state ? toolCost(state, ctx, id) : undefined) ?? s })}
          </li>
        ))}
        <li>
          {t('ui.rules.costs', {
            bad: sunCosts(ctx.content).badCompare / 1000,
            q: (state ? questionCostMs(state, ctx) : sunCosts(ctx.content).question) / 1000,
            h: sunCosts(ctx.content).hint / 1000,
          })}
        </li>
      </ul>
    </div>
  );
}

/** The page of kennings and sayings the skalds carve (docs/tech-spec.md §77), on days their tallies may be a skald's. */
function Kennings({ ctx }: { ctx: DayCtx }) {
  return (
    <>
      <h3>{t('ui.rules.kennings')}</h3>
      <p class="muted">{t('ui.rules.kennings.intro')}</p>
      <dl class="rules__kennings" data-testid="kennings">
        {(ctx.content.kennings ?? []).map((k) => (
          <div key={k.id} class="rules__kenning" data-kenning={k.id}>
            <dt>{t(k.term)}</dt>
            <dd>{t(k.means)}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}
