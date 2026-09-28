import { nextHint, stampsFor, turnedTo } from '@cots/engine';
import { campaignUi } from '../campaign/lazy';
import {
  act,
  answer,
  citation,
  closeCitation,
  closeReview,
  comparing,
  drawerTab,
  review,
  screen,
  session,
  stampSheet,
} from '../store';
import { hintsAllowed } from './hint';
import { questionable, toggleCompare } from './Shift';

const INTERACTIVE = 'button, a, input, textarea, select, [role="tab"]';

function focusSend(): void {
  requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('[data-testid="send"]')?.focus());
}

/**
 * The shift's keyboard map (docs/tech-spec.md §6.4): F turn over, T feather, G registry,
 * C compare, Q question, H hint, 1-9 stamps (focus moves to Send), Enter send,
 * R rules, [ and ] turn to the party's other souls (§69), Esc cancels or pauses.
 */
export function onShiftKey(e: KeyboardEvent): void {
  if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
  const s = session.peek();
  if (!s || screen.peek() !== 'shift' || s.state.phase !== 'shift') return;
  // Someone at the desk (docs/tech-spec.md §46): their scene has the keys, and the sun stays held until it ends.
  if (s.mode.kind === 'campaign' && campaignUi.peek()?.deskDue()) return;
  const target = e.target instanceof Element ? e.target : null;
  if (target?.closest('input, textarea, select')) return;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;

  // A soul looked at again (docs/tech-spec.md §67) holds the sun until it's put away.
  if (review.peek()) {
    if (key === 'Escape') {
      closeReview();
      e.preventDefault();
    }
    return;
  }
  if (s.state.clock.pausedAt !== null) {
    if (key === 'Escape' || key === 'p') {
      act({ t: 'resume' });
      e.preventDefault();
    }
    return;
  }
  if (answer.peek() || citation.peek()) {
    if (key === 'Escape') {
      if (answer.peek()) answer.value = null;
      else closeCitation();
      e.preventDefault();
    }
    return;
  }
  if (e.repeat) return;

  switch (key) {
    case 'f':
      if (s.ctx.tools.has('flip')) act({ t: 'flip' });
      break;
    case 't':
      if (s.ctx.tools.has('feather')) act({ t: 'tool', tool: 'feather' });
      break;
    case 'g':
      if (s.ctx.tools.has('registry')) {
        act({ t: 'tool', tool: 'registry' });
        drawerTab.value = 'registry';
      }
      break;
    case 'c':
      toggleCompare();
      break;
    case 'q': {
      const lie = questionable(s);
      if (lie) act({ t: 'question', lie });
      break;
    }
    case 'h':
      if (hintsAllowed(s) && nextHint(s.state)) act({ t: 'hint' });
      break;
    case 'r':
      drawerTab.value = 'rules';
      break;
    case 'p':
      act({ t: 'pause' });
      break;
    case 'Escape':
      if (comparing.peek()) toggleCompare();
      else if (stampSheet.peek()) stampSheet.value = false;
      else act({ t: 'pause' });
      break;
    case 'Enter':
      // A focused button handles Enter itself.
      if (target?.closest(INTERACTIVE)) return;
      if (s.state.soul.stamp) act({ t: 'send' });
      break;
    case '[':
    case ']': {
      // A party at the desk (docs/tech-spec.md §69): the member before or after, round the party.
      const party = s.state.party;
      if (!party) return;
      const n = party.souls.length;
      act({ t: 'turn', to: (turnedTo(s.state) + (key === ']' ? 1 : n - 1)) % n });
      break;
    }
    default: {
      if (!/^[1-9]$/.test(key)) return;
      const dest = stampsFor(s.ctx)[Number(key) - 1];
      if (!dest) return;
      act({ t: 'stamp', dest });
      stampSheet.value = true;
      focusSend();
    }
  }
  e.preventDefault();
}
