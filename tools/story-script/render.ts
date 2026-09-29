import type { Effect, StatePred } from '@cots/engine';
import { describe, type Expr, type Wording } from './expr';
import {
  type DayDoc,
  type EndingDoc,
  endingAnchor,
  type FlagDoc,
  flagAnchor,
  lineAnchor,
  type Mention,
  type SceneDoc,
  type ScriptModel,
  type SoulDoc,
  sceneAnchor,
  soulAnchor,
} from './model';
import type { Row, Segment } from './parse';

/*
 * The script as one page (docs/tech-spec.md §31): read in a browser, or
 * published as a private artifact, where the review (approve, needs changes,
 * notes) is kept with the page for Claude to read; opened as a local file it
 * keeps the review in the browser and copies it out.
 *
 * Design: the game's own palette (its paper and ink by day, its hall and
 * brass by night), IM Fell English SC for day headings, Literata for the
 * script, IBM Plex Sans Condensed for labels and conditions, IBM Plex Mono
 * for flags and line numbers. A day rail beside one reading column; each
 * line keeps its line number in the .ink file.
 */

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const signed = (n: number) => (n >= 0 ? `+${n}` : `−${Math.abs(n)}`);
const nf = new Intl.NumberFormat('en-US');

/** Names as the script says them: the family's first names, the powers', the speakers'. */
function wordsFor(model: ScriptModel) {
  const first = (full: string) =>
    (full.split(',')[0] ?? full)
      .trim()
      .replace(/^[a-z]+\s+/, '')
      .trim();
  const people = new Map(model.family.map((m) => [m.id, first(m.name)]));
  const flags = new Map(model.flags.map((f) => [f.name, f]));
  const person = (id: string) => esc(people.get(id) ?? id);
  const power = (id: string) => esc(model.strings[`faction.${id}`] ?? id);
  const speaker = (id: string) => esc(model.strings[`speaker.${id}`] ?? id);
  const flag = (name: string) => {
    const f = flags.get(name);
    const set = f?.setBy.map((m) => m.where).join('; ');
    const title = set ? `Set on ${set}` : 'Nothing sets it';
    return `<a class="flag" href="#${flagAnchor(name)}" title="${esc(title)}">${esc(name)}</a>`;
  };
  const wording: Wording = { person, power, flag };
  const titles = new Map(model.endings.map((e) => [e.id, e.title]));
  const ending = (id: string) => esc(titles.get(id) ?? id);
  const front = (id: string) => esc(model.strings[id] ?? id);
  return { person, power, speaker, flag, wording, flags, ending, front };
}
type Words = ReturnType<typeof wordsFor>;

function effectChips(effects: readonly Effect[], w: Words): string {
  return effects
    .map((e) => {
      if ('rings' in e) return `<span class="fx fx-rings">Rings ${signed(e.rings)}</span>`;
      if ('standing' in e) {
        return `<span class="fx ${e.by >= 0 ? 'fx-up' : 'fx-down'}">${w.power(e.standing)} ${signed(e.by)}</span>`;
      }
      if ('flag' in e) {
        const f = w.flag(e.flag);
        if (e.inc !== undefined) return `<span class="fx fx-flag">${f} ${signed(e.inc)}</span>`;
        if (e.set === 0) return `<span class="fx fx-flag">clears ${f}</span>`;
        if (e.set !== undefined && e.set !== 1) return `<span class="fx fx-flag">sets ${f} to ${e.set}</span>`;
        return `<span class="fx fx-flag">sets ${f}</span>`;
      }
      if ('sun' in e) {
        const s = Math.abs(e.sun);
        const time = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
        return `<span class="fx fx-sun">Next shift's sun ${e.sun < 0 ? '-' : '+'}${time}</span>`;
      }
      const change = { sick: 'falls sick', well: 'gets well', gone: 'is gone (dies, or goes to relatives)' }[e.becomes];
      return `<span class="fx fx-family">${w.person(e.family)} ${change}</span>`;
    })
    .join(' ');
}

/** Where the flags an effect sets are read again, leaving out the scene that sets them. */
function laterReaders(effects: readonly Effect[], scene: SceneDoc, w: Words): string {
  const out: string[] = [];
  for (const e of effects) {
    if (!('flag' in e)) continue;
    const readers = (w.flags.get(e.flag)?.readBy ?? []).filter((m) => !m.anchor.startsWith(sceneAnchor(scene.name)));
    if (readers.length === 0) {
      out.push(`<span class="later later-none">${esc(e.flag)}: nothing reads it yet</span>`);
      continue;
    }
    const shown = readers.slice(0, 3).map((m) => `<a href="#${m.anchor}">${esc(m.where)}</a>`);
    const more = readers.length > 3 ? ` <a href="#${flagAnchor(e.flag)}">and ${readers.length - 3} more</a>` : '';
    out.push(`<span class="later">${esc(e.flag)} is read on ${shown.join(', ')}${more}</span>`);
  }
  return out.length > 0 ? `<span class="laters">${out.join('')}</span>` : '';
}

function textHtml(text: readonly Segment[], w: Words): string {
  return text
    .map((s) => {
      if (typeof s === 'string') return esc(s);
      const then = s.then ? esc(s.then) : '<i>nothing</i>';
      const other = s.else ? esc(s.else) : '<i>nothing</i>';
      return (
        `<span class="alt"><span class="alt-if">if ${describe(s.cond, w.wording)}</span> ${then}` +
        ` <span class="alt-if">otherwise</span> ${other}</span>`
      );
    })
    .join('');
}

const cond = (e: Expr, w: Words) => describe(e, w.wording);
const partAnchor = (scene: SceneDoc, part: string) => `${sceneAnchor(scene.name)}-part-${part}`;

function rowHtml(scene: SceneDoc, r: Row, w: Words, reached: ReadonlyMap<string, string[]>): string {
  const id = lineAnchor(scene.name, r.line);
  let body: string;
  switch (r.kind) {
    case 'line': {
      const who = r.speaker ? `<span class="who">${w.speaker(r.speaker)}</span> ` : '';
      const fx = r.effects.length > 0 ? ` ${effectChips(r.effects, w)}${laterReaders(r.effects, scene, w)}` : '';
      body = `<p class="${r.speaker ? 'said' : 'told'}">${who}${textHtml(r.text, w)}${fx}</p>`;
      break;
    }
    case 'effects':
      body = `<p class="fxs">${effectChips(r.effects, w)}${laterReaders(r.effects, scene, w)}</p>`;
      break;
    case 'choice': {
      const needs = r.rings !== undefined ? ` <span class="needs">needs ${r.rings} rings</span>` : '';
      const when = r.cond ? ` <span class="only">only if ${cond(r.cond, w)}</span>` : '';
      const again = r.sticky ? ' <span class="only">can be chosen again</span>' : '';
      body = `<p class="opt"><span class="opt-mark" aria-hidden="true"></span><span class="opt-text">${esc(r.text)}</span>${needs}${when}${again}</p>`;
      break;
    }
    case 'gather':
      body = `<p class="gather">${r.depth > 1 ? 'then, in this branch, whichever was chosen' : 'then, whichever was chosen'}</p>`;
      break;
    case 'if':
      body = `<p class="cond">If ${cond(r.cond, w)}</p>`;
      break;
    case 'elif':
      body = `<p class="cond">Otherwise, if ${cond(r.cond, w)}</p>`;
      break;
    case 'else':
      body = '<p class="cond">Otherwise</p>';
      break;
    case 'jump': {
      const where =
        r.target === 'END' || r.target === 'DONE'
          ? 'the scene ends'
          : `it goes on at <a href="#${partAnchor(scene, r.target)}">${esc(r.target)}</a>`;
      body = `<p class="jump">${r.cond ? `If ${cond(r.cond, w)}, ${where}` : `Then ${where}`}.</p>`;
      break;
    }
    case 'part': {
      const from = reached.get(r.name) ?? [];
      const note = from.length > 0 ? `<span class="part-from">reached from ${from.join(', ')}</span>` : '';
      return (
        `<div class="r r-part" id="${partAnchor(scene, r.name)}"><span class="ln"></span>` +
        `<div class="rc"><h4 class="part">Part: ${esc(r.name)}</h4>${note}</div></div>`
      );
    }
  }
  return (
    `<div class="r r-${r.kind}${r.level > 0 ? ' in' : ''}" id="${id}" style="--lvl:${r.level}">` +
    `<a class="ln" href="#${id}" aria-label="Line ${r.line}">${r.line}</a><div class="rc">${body}</div></div>`
  );
}

function sceneHtml(s: SceneDoc, w: Words): string {
  const reached = new Map<string, string[]>();
  for (const r of s.rows) {
    if (r.kind !== 'jump' || r.target === 'END' || r.target === 'DONE') continue;
    const list = reached.get(r.target) ?? [];
    const link = `<a href="#${lineAnchor(s.name, r.line)}">line ${r.line}</a>`;
    list.push(r.cond ? `${link} (if ${cond(r.cond, w)})` : link);
    reached.set(r.target, list);
  }
  const noteId = `note-${s.name.replace(/\./g, '-')}`;
  const reads = s.reads.length > 0 ? `<span class="k">Reads</span> ${s.reads.map(w.flag).join(' ')}` : '';
  const sets = s.sets.length > 0 ? `<span class="k">Sets</span> ${s.sets.map(w.flag).join(' ')}` : '';
  return `
<section class="scene" id="${sceneAnchor(s.name)}" data-scene="${esc(s.name)}" data-hash="${esc(s.hash)}" data-day="${s.day}">
  <header class="scene-head">
    <p class="scene-title"><span class="when">${s.when === 'morning' ? 'Morning' : s.when === 'desk' ? `At the desk, after ${s.at ?? 0} souls` : 'Night'}</span>
      <span class="status ${s.draft ? 'is-draft' : 'is-signed'}">${s.draft ? 'Draft' : 'Signed off'}</span>
      <span class="verdict-chip" data-chip hidden></span><span class="changed-chip" data-changed hidden>Changed since your review</span></p>
    <p class="scene-meta"><span>${nf.format(s.words)} words</span> <code class="file">${esc(s.file)}</code></p>
    ${reads || sets ? `<p class="io">${[reads, sets].filter(Boolean).join('<span class="sep"></span>')}</p>` : ''}
  </header>
  <div class="rows">${s.rows.map((r) => rowHtml(s, r, w, reached)).join('')}</div>
  <footer class="review" data-review="${esc(s.name)}">
    <div class="verdicts" role="group" aria-label="Your verdict on ${esc(s.name)}">
      <button type="button" class="v v-ok" data-v="approved" aria-pressed="false">Approve</button>
      <button type="button" class="v v-changes" data-v="changes" aria-pressed="false">Needs changes</button>
    </div>
    <label class="note-label" for="${noteId}">Notes for Claude</label>
    <textarea id="${noteId}" rows="2" placeholder="What to change, and where (line numbers help)"></textarea>
    <p class="saved" aria-live="polite"></p>
  </footer>
</section>`;
}

/** A run-state condition (endings, threads, when a story soul comes) in words. */
function stateWords(p: StatePred, w: Words): string {
  if ('all' in p) {
    const parts = p.all.map((q) => stateWords(q, w));
    return parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  }
  if ('any' in p) return p.any.map((q) => stateWords(q, w)).join(', or ');
  if ('not' in p) return `not (${stateWords(p.not, w)})`;
  const [head, key = ''] = p.state.split('.', 2) as [string, string?];
  const range = (unit: string) => {
    if (p.is !== undefined) return `exactly ${p.is}${unit}`;
    if (p.gte !== undefined && p.lte !== undefined) return `between ${p.gte} and ${p.lte}${unit}`;
    if (p.gte !== undefined) return `${p.gte}${unit} or more`;
    return `${p.lte ?? 0}${unit} or less`;
  };
  switch (head) {
    case 'day':
      if (p.gte !== undefined && p.lte === undefined) return `Day ${p.gte} or later`;
      if (p.is !== undefined) return `Day ${p.is}`;
      return `the day is ${range('')}`;
    case 'rings':
      return `${range(' rings')} in the purse`;
    case 'debtNights':
      return `${range(' nights')} in debt`;
    case 'flags':
      if (p.gte === 1 && p.lte === undefined) return `${w.flag(key)} is set`;
      if (p.lte === 0 && p.gte === undefined) return `${w.flag(key)} isn't set`;
      return `${w.flag(key)} is ${range('')}`;
    case 'standing':
      return `${w.power(key)}'s standing is ${range('')}`;
    case 'lead':
      return p.lte === 0 ? `${w.power(key)} doesn't lead the powers` : `${w.power(key)} leads the powers`;
    case 'naglfar':
      return `${range('')} souls sent on with their nails uncut`;
    case 'ragnarok':
      return `a host at Ragnarök of ${range('')}`;
    case 'family':
      if (key === 'home' && p.gte === 1 && p.lte === undefined) return 'someone is at home';
      return `${range('')} of the family ${key === 'home' ? 'at home' : key}`;
    case 'sent':
      return `${range('')} souls stamped ${esc(key)}`;
    case 'einherjar':
      return `${range('')} ${key === 'worthy' ? 'worthy' : 'unworthy'} einherjar`;
    case 'fronts':
      return `${range('')} fronts held at Ragnarök`;
    case 'front':
      return p.lte === 0 ? `${w.front(p.state)} didn't hold` : `${w.front(p.state)} held`;
    case 'ending':
      return p.lte === 0 ? `the run didn't end in ${w.ending(p.state)}` : `the run ended in ${w.ending(p.state)}`;
    // The forger's trail (docs/tech-spec.md §71): the night a carver was named, and whether he was the one.
    case 'trail':
      if (key === 'right') return p.lte === 0 ? "the carver named wasn't the one" : 'the carver named was the one';
      if (p.gte !== undefined && p.lte === undefined) return `a carver was named on Night ${p.gte} or later`;
      if (p.gte !== undefined && p.lte !== undefined)
        return `a carver was named between Night ${p.gte} and Night ${p.lte}`;
      return p.lte === 0 ? 'no carver has been named' : `no carver was named after Night ${p.lte}`;
    case 'member': {
      const how = p.state.split('.')[2] ?? '';
      const is = { well: 'is well', sick: 'is sick', gone: 'is gone', died: 'died', left: 'went to relatives' }[how];
      return p.lte === 0 ? `not (${w.person(key)} ${is ?? how})` : `${w.person(key)} ${is ?? how}`;
    }
    default:
      return `${esc(p.state)} is ${range('')}`;
  }
}

function soulHtml(s: SoulDoc, w: Words): string {
  const stamps = s.onStamp
    .map((on) => {
      const how = on.stamped === '*' ? 'Judged, whatever the stamp' : `Stamped ${esc(on.stamped)}`;
      return `<li><span class="k">${how}</span> ${effectChips(on.effects, w)}</li>`;
    })
    .join('');
  return `
<article class="soul" id="${soulAnchor(s.id)}">
  <p class="soul-kicker">At the gate: a story soul</p>
  <h4 class="soul-name">${esc(s.name)} <span class="soul-dest">belongs in ${esc(s.expect)}</span></h4>
  ${s.when ? `<p class="only">Comes only if ${stateWords(s.when, w)}.</p>` : ''}
  ${s.lines.map((l) => `<p class="said">${esc(l)}</p>`).join('')}
  ${stamps ? `<ul class="stamps">${stamps}</ul>` : ''}
</article>`;
}

function dayHtml(d: DayDoc, w: Words): string {
  const souls = d.souls.map((s) => soulHtml(s, w)).join('');
  return `
<section class="day" id="day-${d.day}" aria-labelledby="day-${d.day}-title">
  <h2 class="day-title" id="day-${d.day}-title">Day ${d.day}</h2>
  <blockquote class="decree"><span class="k">The decree</span> ${esc(d.decree)}</blockquote>
  ${d.morning ? sceneHtml(d.morning, w) : ''}
  ${(d.desk ?? []).map((s) => sceneHtml(s, w)).join('')}
  ${souls}
  ${d.night ? sceneHtml(d.night, w) : ''}
</section>`;
}

function mentions(ms: readonly Mention[]): string {
  return ms
    .map(
      (m) =>
        `<li><a href="#${m.anchor}">${esc(m.where)}</a>${m.detail ? ` <span class="detail">${esc(m.detail)}</span>` : ''}</li>`,
    )
    .join('');
}

function flagHtml(f: FlagDoc): string {
  const warn =
    f.setBy.length === 0
      ? '<span class="warn">nothing sets it</span>'
      : f.readBy.length === 0
        ? '<span class="warn">nothing reads it yet</span>'
        : '';
  return `
<article class="flag-entry" id="${flagAnchor(f.name)}">
  <h3><code>${esc(f.name)}</code> ${warn}</h3>
  <div class="flag-cols">
    <div><p class="k">Set</p><ul>${f.setBy.length > 0 ? mentions(f.setBy) : '<li class="muted">nowhere</li>'}</ul></div>
    <div><p class="k">Read</p><ul>${f.readBy.length > 0 ? mentions(f.readBy) : '<li class="muted">nowhere yet</li>'}</ul></div>
  </div>
</article>`;
}

function endingHtml(e: EndingDoc, w: Words): string {
  return `
<article class="ending" id="${endingAnchor(e.id)}">
  <h3>${esc(e.title)}</h3>
  <p class="only">${e.when ? `When ${stateWords(e.when, w)}.` : 'Only as the campaign’s last night, when nothing else has ended it.'}</p>
  ${e.text
    .split(/\n\s*\n/)
    .map((p) => `<p class="ending-text">${esc(p)}</p>`)
    .join('')}
</article>`;
}

/** The forger's trail (docs/tech-spec.md §71): who can be the carver, when he can be named, and what naming does. */
function trailHtml(t: NonNullable<ScriptModel['trail']>, w: Words): string {
  const nights = t.nights.map((n) => `Night ${n}`).join(' or ');
  const suspects = t.suspects
    .map(
      (s) =>
        `<li><b>${esc(s.name)}</b>: ${esc(s.text)} <span class="muted">(${s.hands.map(esc).join(' and ')})</span></li>`,
    )
    .join('');
  return `
    <section class="appendix" id="trail">
      <h2>The forger’s trail</h2>
      <p>From Day ${t.since}, one of these carvers, drawn for the run, cuts every forged tally, and each forged tally shows one of his two habits. ${t.when ? `The board opens when ${stateWords(t.when, w)}; on` : 'On'} ${nights} he can be named, once.</p>
      <ol class="threads">${suspects}</ol>
      <p class="only">Naming the right carver:</p><p>${effectChips(t.right, w) || 'nothing'}</p>
      <p class="only">Naming another:</p><p>${effectChips(t.wrong, w) || 'nothing'}</p>
    </section>`;
}

const SECTION_NAMES: Readonly<Record<string, string>> = {
  home: 'At home',
  powers: 'The powers',
  dead: 'The dead you judged',
};

function epilogueHtml(s: ScriptModel['epilogue'][number], w: Words): string {
  const lines = s.lines
    .map(
      (l, i) =>
        `<li><p class="only">${l.when ? `${i === 0 ? 'If' : 'Else, if'} ${stateWords(l.when, w)}:` : i === 0 ? 'Always:' : 'Otherwise:'}</p><p class="ending-text">${esc(l.text)}</p></li>`,
    )
    .join('');
  return `
<article class="ending" id="epilogue-${esc(s.id)}">
  <h3>${esc(SECTION_NAMES[s.section] ?? s.section)}: ${esc(s.id.replace(/^epi\./, ''))}</h3>
  ${s.when ? `<p class="only">Only when ${stateWords(s.when, w)}.</p>` : ''}
  <ol class="threads">${lines}</ol>
</article>`;
}

/** The review's controls and storage: the artifact's own store when it has one, else this browser. */
const CLIENT = `
(function () {
  var KEY = 'cots.storyReview.v1';
  var sections = [].slice.call(document.querySelectorAll('section.scene'));
  var names = sections.map(function (el) { return el.getAttribute('data-scene'); });
  var byName = {};
  sections.forEach(function (el) { byName[el.getAttribute('data-scene')] = el; });
  var reviews = {};
  var db = null;
  var timers = {};
  var queue = {};
  var storeNote = document.getElementById('store-note');

  function readLocal() {
    try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; }
  }
  function writeLocal() {
    try { localStorage.setItem(KEY, JSON.stringify(reviews)); return true; } catch (e) { return false; }
  }
  function saved(name, text) {
    var p = byName[name] && byName[name].querySelector('.saved');
    if (p) p.textContent = text;
  }
  function persist(name) {
    var r = reviews[name] || {};
    var body = { scene: name, verdict: r.verdict || '', note: r.note || '', hash: r.hash || '', at: new Date().toISOString() };
    if (db) {
      var doc = db.doc('reviews/' + name);
      queue[name] = (queue[name] || Promise.resolve()).then(function () { return doc.set(body); }).then(
        function () { saved(name, 'Saved with this page.'); },
        function (err) { saved(name, 'Not saved (' + ((err && err.code) || 'error') + '). Copy your review to keep it.'); }
      );
    } else {
      saved(name, writeLocal() ? 'Saved in this browser.' : 'Not saved: this browser keeps nothing here. Copy your review to keep it.');
    }
  }
  function change(name, patch) {
    var r = reviews[name] || {};
    var next = { verdict: r.verdict || '', note: r.note || '', hash: byName[name].getAttribute('data-hash') };
    for (var k in patch) next[k] = patch[k];
    reviews[name] = next;
  }

  function render() {
    var ok = 0, changes = 0;
    names.forEach(function (name) {
      var el = byName[name];
      var r = reviews[name] || {};
      el.querySelectorAll('button.v').forEach(function (b) {
        b.setAttribute('aria-pressed', String(r.verdict === b.getAttribute('data-v')));
      });
      var ta = el.querySelector('textarea');
      if (ta && document.activeElement !== ta && ta.value !== (r.note || '')) ta.value = r.note || '';
      var chip = el.querySelector('[data-chip]');
      chip.hidden = !r.verdict;
      chip.textContent = r.verdict === 'approved' ? 'Approved' : r.verdict === 'changes' ? 'Needs changes' : '';
      chip.className = 'verdict-chip ' + (r.verdict === 'approved' ? 'is-ok' : 'is-changes');
      el.querySelector('[data-changed]').hidden = !((r.verdict || r.note) && r.hash && r.hash !== el.getAttribute('data-hash'));
      el.setAttribute('data-verdict', r.verdict || '');
      if (r.verdict === 'approved') ok++;
      if (r.verdict === 'changes') changes++;
    });
    document.getElementById('n-ok').textContent = ok;
    document.getElementById('n-changes').textContent = changes;
    document.getElementById('n-open').textContent = names.length - ok - changes;
    document.querySelectorAll('.rail [data-day]').forEach(function (li) {
      var day = li.getAttribute('data-day');
      var marks = names.filter(function (n) { return byName[n].getAttribute('data-day') === day; }).map(function (n) {
        var v = (reviews[n] || {}).verdict;
        return '<i class="mark ' + (v === 'approved' ? 'is-ok' : v === 'changes' ? 'is-changes' : '') + '"></i>';
      });
      li.querySelector('.marks').innerHTML = marks.join('');
    });
  }

  document.addEventListener('click', function (ev) {
    var b = ev.target.closest && ev.target.closest('button.v');
    if (!b) return;
    var name = b.closest('[data-review]').getAttribute('data-review');
    var v = b.getAttribute('data-v');
    change(name, { verdict: (reviews[name] || {}).verdict === v ? '' : v });
    render();
    persist(name);
  });
  document.addEventListener('input', function (ev) {
    var ta = ev.target;
    if (!ta || ta.tagName !== 'TEXTAREA' || !ta.closest('[data-review]')) return;
    var name = ta.closest('[data-review]').getAttribute('data-review');
    change(name, { note: ta.value });
    render();
    clearTimeout(timers[name]);
    saved(name, 'Saving…');
    timers[name] = setTimeout(function () { persist(name); }, 900);
  });

  function reviewText() {
    var ok = names.filter(function (n) { return (reviews[n] || {}).verdict === 'approved'; });
    var changes = names.filter(function (n) { return (reviews[n] || {}).verdict === 'changes'; });
    var others = names.filter(function (n) { var r = reviews[n] || {}; return r.note && r.verdict !== 'changes'; });
    var lines = ['Story review (script ' + document.getElementById('page').getAttribute('data-version') + ')', ''];
    lines.push('Approved (' + ok.length + '): ' + (ok.join(', ') || 'none'));
    if (ok.length) lines.push('  pnpm story:approve ' + ok.join(' '));
    lines.push('', 'Needs changes (' + changes.length + '):');
    changes.forEach(function (n) { lines.push('- ' + n + ': ' + ((reviews[n] || {}).note || '(no note)')); });
    if (others.length) {
      lines.push('', 'Notes on other scenes:');
      others.forEach(function (n) {
        var r = reviews[n];
        lines.push('- ' + n + (r.verdict === 'approved' ? ' (approved)' : '') + ': ' + r.note);
      });
    }
    return lines.join('\\n');
  }
  var out = document.getElementById('review-out');
  var outText = document.getElementById('review-text');
  document.getElementById('copy-review').addEventListener('click', function () {
    var text = reviewText();
    outText.value = text;
    var done = document.getElementById('copy-done');
    function show() { out.hidden = false; outText.focus(); outText.select(); done.textContent = 'Select all and copy it.'; }
    try {
      navigator.clipboard.writeText(text).then(function () {
        out.hidden = false;
        done.textContent = 'Copied. Paste it to Claude, or run the command on your machine.';
      }, show);
    } catch (e) { show(); }
  });
  document.getElementById('close-review').addEventListener('click', function () { out.hidden = true; });

  reviews = readLocal();
  render();
  var claude = window.claude;
  if (claude && typeof claude.use === 'function') {
    claude.use('db').then(function (store) {
      if (!store) return;
      db = store;
      storeNote.textContent = 'Kept with this page, where Claude can read it.';
      var first = true;
      db.collection('reviews').onSnapshot(function (snap) {
        var next = {};
        snap.docs.forEach(function (doc) { var v = doc.data(); if (v) next[doc.id] = v; });
        if (first) {
          first = false;
          // Anything reviewed here before the store answered goes into it.
          var local = reviews;
          reviews = next;
          Object.keys(local).forEach(function (n) { if (!next[n] && byName[n]) { reviews[n] = local[n]; persist(n); } });
        } else {
          // Keep what is being typed; take everything else as stored.
          var active = document.activeElement && document.activeElement.closest && document.activeElement.closest('[data-review]');
          var typing = active && active.getAttribute('data-review');
          if (typing && reviews[typing]) next[typing] = reviews[typing];
          reviews = next;
        }
        render();
      }, function () {
        db = null;
        storeNote.textContent = 'The page’s store isn’t answering, so your review is kept in this browser.';
      });
    }, function () {});
  }
})();
`;

const CSS = `
:root {
  --ground: #efe6d2; --sheet: #f6f0e3; --ink: #2a211a; --muted: #67583f; --faint: #8a7a5e; --rule: #d3c4a3;
  --brass: #86601f; --brass-soft: #e7d8b4; --blood: #9a3a26; --blood-soft: #f1d3c8; --moss: #3d6a33; --moss-soft: #d5e4c9;
  --focus: #2e5b9a;
  --display: "IM Fell English SC", "Iowan Old Style", Georgia, serif;
  --read: "Literata", "Iowan Old Style", Georgia, serif;
  --ui: "IBM Plex Sans Condensed", "Arial Narrow", system-ui, sans-serif;
  --mono: "IBM Plex Mono", ui-monospace, Menlo, Consolas, monospace;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --ground: #15110d; --sheet: #1c1712; --ink: #efe6d2; --muted: #b8aa8c; --faint: #8d7f64; --rule: #3a2f24;
    --brass: #d5b676; --brass-soft: #3a2d19; --blood: #e2826a; --blood-soft: #3e2119; --moss: #8fc482; --moss-soft: #1f2d1b;
    --focus: #8fbcff; color-scheme: dark;
  }
}
:root[data-theme="dark"] {
  --ground: #15110d; --sheet: #1c1712; --ink: #efe6d2; --muted: #b8aa8c; --faint: #8d7f64; --rule: #3a2f24;
  --brass: #d5b676; --brass-soft: #3a2d19; --blood: #e2826a; --blood-soft: #3e2119; --moss: #8fc482; --moss-soft: #1f2d1b;
  --focus: #8fbcff; color-scheme: dark;
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
html { scroll-padding-top: 4.5rem; }
body { margin: 0; background: var(--ground); color: var(--ink); font: 400 1rem/1.6 var(--read); padding-inline: 16px; padding-bottom: 7rem; }
a { color: inherit; text-decoration-color: var(--rule); text-underline-offset: 0.18em; }
a:hover { text-decoration-color: var(--brass); }
:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; border-radius: 3px; }
code, .file { font-family: var(--mono); font-size: 0.82em; }
.k { font: 600 0.72rem/1.4 var(--ui); letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
.muted { color: var(--muted); }

.top { max-width: 76rem; margin: 0 auto; padding-block: 2.5rem 1.5rem; display: grid; gap: 0.75rem; }
.eyebrow { margin: 0; font: 600 0.8rem/1.2 var(--ui); letter-spacing: 0.14em; text-transform: uppercase; color: var(--brass); }
h1 { margin: 0; font: 400 clamp(2.4rem, 6vw, 3.6rem)/1 var(--display); letter-spacing: 0.01em; text-wrap: balance; }
.lede { margin: 0; max-width: 62ch; color: var(--muted); }
.stats { display: flex; flex-wrap: wrap; gap: 0.5rem 1.75rem; margin: 0.5rem 0 0; }
.stats div { display: grid; }
.stats dt { font: 600 0.7rem/1.3 var(--ui); letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
.stats dd { margin: 0; font: 500 1.35rem/1.2 var(--ui); font-variant-numeric: tabular-nums; }
.key { max-width: 62ch; font: 0.9rem/1.5 var(--ui); color: var(--muted); }
.key summary { cursor: pointer; font-weight: 600; color: var(--ink); }
.key ul { margin: 0.5rem 0 0; padding-left: 1.1rem; display: grid; gap: 0.3rem; }

.shell { max-width: 76rem; margin: 0 auto; display: grid; grid-template-columns: 9.5rem minmax(0, 1fr); gap: 2.5rem; }
.rail { position: sticky; top: env(safe-area-inset-top, 0px); align-self: start; max-height: 100vh; overflow-y: auto; padding-block: 1rem; font: 500 0.9rem/1.2 var(--ui); }
.rail ol { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.1rem; }
.rail a { display: flex; align-items: center; gap: 0.5rem; padding: 0.3rem 0.4rem; border-radius: 4px; text-decoration: none; }
.rail a:hover { background: var(--brass-soft); }
.rail-n { min-width: 3.4em; font-variant-numeric: tabular-nums; }
.marks { display: inline-flex; gap: 3px; }
.mark { width: 0.55rem; height: 0.55rem; border-radius: 50%; border: 1.5px solid var(--faint); }
.mark.is-ok { background: var(--moss); border-color: var(--moss); }
.mark.is-changes { background: var(--blood); border-color: var(--blood); }
.rail-more { margin-top: 0.75rem; display: grid; gap: 0.1rem; border-top: 1px solid var(--rule); padding-top: 0.75rem; }

.script { min-width: 0; max-width: 46rem; }
.day { padding-block: 2rem 1rem; border-top: 2px solid var(--ink); }
.day-title { margin: 0 0 0.75rem; font: 400 2.1rem/1.1 var(--display); }
.decree { margin: 0 0 1.5rem; padding: 0.75rem 1rem; background: var(--sheet); border-left: 3px solid var(--brass); font-style: italic; }
.decree .k { display: block; font-style: normal; margin-bottom: 0.2rem; }

.scene { margin-block: 1.5rem 2.5rem; }
.scene-head { display: grid; gap: 0.35rem; padding-bottom: 0.75rem; margin-bottom: 0.5rem; border-bottom: 1px solid var(--rule); }
.scene-title { margin: 0; display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.5rem 0.75rem; }
.when { font: 400 1.6rem/1.1 var(--display); }
.status, .verdict-chip, .changed-chip, .warn { font: 600 0.7rem/1 var(--ui); letter-spacing: 0.08em; text-transform: uppercase; padding: 0.3rem 0.5rem; border-radius: 3px; }
.status.is-draft { background: var(--brass-soft); color: var(--brass); }
.status.is-signed { background: var(--moss-soft); color: var(--moss); }
.verdict-chip.is-ok { background: var(--moss); color: var(--ground); }
.verdict-chip.is-changes, .changed-chip, .warn { background: var(--blood-soft); color: var(--blood); }
.scene-meta { margin: 0; display: flex; flex-wrap: wrap; gap: 0.25rem 1rem; font: 0.85rem/1.4 var(--ui); color: var(--muted); }
.io { margin: 0; font: 0.85rem/1.8 var(--ui); display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.25rem 0.4rem; }
.io .sep { width: 0.75rem; }
.flag { font-family: var(--mono); font-size: 0.8em; padding: 0.05rem 0.3rem; border-radius: 3px; background: var(--brass-soft); color: var(--ink); text-decoration: none; white-space: nowrap; }
.flag:hover { outline: 1px solid var(--brass); }

.rows { display: grid; }
.r { display: grid; grid-template-columns: 2.4rem minmax(0, 1fr); align-items: baseline; }
.ln { font: 0.7rem/1.9 var(--mono); color: var(--faint); text-decoration: none; text-align: right; padding-right: 0.8rem; user-select: none; }
.ln:hover { color: var(--brass); }
.r:target .rc { background: var(--brass-soft); }
.rc { min-width: 0; margin-left: calc(max(var(--lvl, 0) - 1, 0) * 1.1rem); }
.r.in .rc { border-left: 1px solid var(--rule); padding-left: 0.85rem; }
.rc p { margin: 0.2rem 0; }
.told { max-width: 62ch; }
.said { max-width: 62ch; }
.who { font: 600 0.72rem/1 var(--ui); letter-spacing: 0.1em; text-transform: uppercase; color: var(--brass); margin-right: 0.35rem; }
.opt { margin-top: 0.8rem !important; font-weight: 600; display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.2rem 0.6rem; }
.opt-mark { width: 0.55rem; height: 0.55rem; background: var(--brass); transform: rotate(45deg) translateY(-0.08rem); flex: none; }
.opt-text { max-width: 58ch; }
.needs { font: 600 0.72rem/1 var(--ui); letter-spacing: 0.04em; padding: 0.25rem 0.45rem; border: 1px solid var(--brass); color: var(--brass); border-radius: 3px; }
.only { font: 400 0.82rem/1.5 var(--ui); color: var(--muted); font-style: italic; }
.cond { font: 600 0.82rem/1.6 var(--ui); color: var(--brass); margin-top: 0.6rem !important; }
.cond .flag { font-weight: 400; }
.gather { font: 400 0.75rem/1.5 var(--ui); letter-spacing: 0.06em; text-transform: uppercase; color: var(--faint); display: flex; align-items: center; gap: 0.6rem; margin-top: 0.8rem !important; }
.gather::after { content: ""; flex: 1; border-top: 1px dashed var(--rule); }
.jump { font: 0.85rem/1.5 var(--ui); color: var(--muted); }
.part { margin: 1.25rem 0 0; font: 400 1.2rem/1.2 var(--display); }
.part-from { display: block; font: 0.8rem/1.4 var(--ui); color: var(--muted); }
.alt { font-family: var(--read); background: var(--sheet); border: 1px dashed var(--rule); border-radius: 3px; padding: 0 0.25rem; }
.alt-if { font: 600 0.72rem/1 var(--ui); color: var(--brass); }
.fxs { display: flex; flex-wrap: wrap; gap: 0.3rem 0.4rem; align-items: baseline; }
.fx { font: 500 0.75rem/1 var(--ui); padding: 0.28rem 0.45rem; border-radius: 3px; background: var(--sheet); border: 1px solid var(--rule); white-space: nowrap; }
.fx-up { border-color: var(--moss); color: var(--moss); }
.fx-down { border-color: var(--blood); color: var(--blood); }
.fx-rings { border-color: var(--brass); }
.fx .flag { background: none; padding: 0; }
.laters { display: grid; gap: 0.1rem; flex-basis: 100%; }
.later { font: 0.78rem/1.45 var(--ui); color: var(--muted); }
.later-none { color: var(--blood); }

.soul { margin-block: 1.5rem; padding: 1rem 1.1rem; background: var(--sheet); border: 1px solid var(--rule); border-radius: 4px; }
.soul-kicker { margin: 0; font: 600 0.7rem/1.2 var(--ui); letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); }
.soul-name { margin: 0.2rem 0 0.4rem; font: 400 1.35rem/1.2 var(--display); }
.soul-dest { font: 500 0.8rem/1 var(--ui); color: var(--muted); margin-left: 0.4rem; }
.soul .said { margin: 0.3rem 0; font-style: italic; }
.stamps { list-style: none; padding: 0; margin: 0.6rem 0 0; display: grid; gap: 0.35rem; }
.stamps li { display: flex; flex-wrap: wrap; gap: 0.3rem 0.5rem; align-items: baseline; }

.review { margin-top: 1rem; padding: 0.85rem 1rem; background: var(--sheet); border: 1px solid var(--rule); border-radius: 4px; display: grid; gap: 0.5rem; }
.verdicts { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.v, .btn { font: 600 0.85rem/1 var(--ui); padding: 0.6rem 0.9rem; min-height: 2.5rem; border-radius: 4px; border: 1px solid var(--rule); background: var(--ground); color: var(--ink); cursor: pointer; }
.v:hover, .btn:hover { border-color: var(--brass); }
.v-ok[aria-pressed="true"] { background: var(--moss); border-color: var(--moss); color: var(--ground); }
.v-changes[aria-pressed="true"] { background: var(--blood); border-color: var(--blood); color: var(--ground); }
.note-label { font: 600 0.72rem/1 var(--ui); letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
textarea { width: 100%; font: 0.95rem/1.5 var(--read); color: var(--ink); background: var(--ground); border: 1px solid var(--rule); border-radius: 4px; padding: 0.5rem 0.6rem; resize: vertical; }
.saved { margin: 0; min-height: 1.2em; font: 0.78rem/1.4 var(--ui); color: var(--muted); }

.appendix { padding-block: 2rem; border-top: 2px solid var(--ink); }
.appendix > h2 { margin: 0 0 0.5rem; font: 400 2.1rem/1.1 var(--display); }
.appendix > p { max-width: 62ch; color: var(--muted); }
.flag-entry { padding-block: 0.9rem; border-bottom: 1px solid var(--rule); }
.flag-entry h3 { margin: 0 0 0.4rem; display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: baseline; font-size: 1rem; }
.flag-cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); gap: 0.5rem 1.5rem; font: 0.88rem/1.5 var(--ui); }
.flag-cols p { margin: 0; }
.flag-cols ul { margin: 0.2rem 0 0; padding-left: 1rem; }
.detail { color: var(--muted); }
.ending { padding-block: 0.9rem; border-bottom: 1px solid var(--rule); }
.ending h3 { margin: 0; font: 400 1.35rem/1.2 var(--display); }
.ending-text { max-width: 62ch; }
.threads { padding-left: 1.1rem; font: 0.9rem/1.6 var(--ui); display: grid; gap: 0.4rem; }

.bar { position: fixed; left: 0; right: 0; bottom: 0; z-index: 5; background: var(--ink); color: var(--ground); padding: 0.7rem 16px calc(0.7rem + env(safe-area-inset-bottom, 0px)); display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem 1.25rem; font: 0.88rem/1.3 var(--ui); }
.bar b { font-variant-numeric: tabular-nums; }
.bar .where { margin: 0; opacity: 0.8; flex: 1 1 14rem; }
.bar .tally { margin: 0; }
.bar .btn { background: var(--brass); border-color: var(--brass); color: var(--ground); }
.out { position: fixed; left: 16px; right: 16px; bottom: 5.5rem; z-index: 6; max-width: 40rem; margin: 0 auto; background: var(--sheet); border: 1px solid var(--rule); border-radius: 6px; padding: 1rem; display: grid; gap: 0.5rem; box-shadow: 0 8px 30px rgb(0 0 0 / 0.25); }
.out textarea { font: 0.8rem/1.45 var(--mono); min-height: 10rem; }
.out p { margin: 0; font: 0.85rem/1.4 var(--ui); }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }

@media (max-width: 56rem) {
  .shell { grid-template-columns: minmax(0, 1fr); gap: 0; }
  .rail { position: sticky; z-index: 4; background: var(--ground); max-height: none; overflow-x: auto; padding-block: 0.4rem; border-bottom: 1px solid var(--rule); }
  .rail ol { display: flex; gap: 0.25rem; }
  .rail a { flex-direction: column; gap: 0.2rem; padding: 0.3rem 0.45rem; }
  .rail-n { min-width: 0; font-size: 0.8rem; }
  .rail-word { display: none; }
  .rail-more { display: none; }
}
@media (prefers-reduced-motion: no-preference) { html { scroll-behavior: smooth; } }
`;

const FONTS =
  'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans+Condensed:wght@400;500;600&family=IM+Fell+English+SC&family=Literata:ital,opsz,wght@0,7..72,400;0,7..72,600;1,7..72,400&display=swap';

/**
 * The page. `body` is what an artifact publishes (the platform wraps it in its own document);
 * `document` is the same page as a standalone file.
 */
export function renderScript(model: ScriptModel, generated: string): { body: string; document: string } {
  const w = wordsFor(model);
  const souls = model.days.reduce((n, d) => n + d.souls.length, 0);
  const rail = model.days
    .map(
      (d) =>
        `<li data-day="${d.day}"><a href="#day-${d.day}"><span class="rail-n"><span class="rail-word">Day </span>${d.day}</span><span class="marks" aria-hidden="true"></span></a></li>`,
    )
    .join('');
  const unread = model.flags.filter((f) => f.setBy.length > 0 && f.readBy.length === 0).length;
  const unset = model.flags.filter((f) => f.setBy.length === 0).length;
  const body = `<title>Chooser Story Script</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS}">
<style>${CSS}</style>
<div data-version="${esc(model.version)}" id="page">
<header class="top">
  <p class="eyebrow">Chooser of the Slain</p>
  <h1>Story script</h1>
  <p class="lede">Every scene of the ${model.days.length}-day campaign as the game plays it: each line, each option, what it needs and what it changes, and where each change is read again. Approve a scene, or mark it for changes and say what; the review is kept with this page for Claude to read.</p>
  <dl class="stats">
    <div><dt>Scenes</dt><dd>${model.totals.scenes}</dd></div>
    <div><dt>Still draft</dt><dd>${model.totals.drafts}</dd></div>
    <div><dt>Words</dt><dd>${nf.format(model.totals.words)}</dd></div>
    <div><dt>Story souls</dt><dd>${souls}</dd></div>
    <div><dt>Flags</dt><dd>${model.flags.length}</dd></div>
  </dl>
  <details class="key">
    <summary>How to read it</summary>
    <ul>
      <li>The small numbers are line numbers in the scene's <code>.ink</code> file.</li>
      <li><b>◆ Options</b> are what the player picks. <i>Only if</i> says when one is offered at all; <i>needs N rings</i> shows it greyed out until the purse can cover it.</li>
      <li>Indented lines belong to the option or condition above them. <i>Then, whichever was chosen</i> is where the options join again.</li>
      <li>Boxes are what happens to the run: rings, a power's standing, a family member, or a story flag set. Under a flag, where it's read again.</li>
      <li><span class="flag">flag</span> names link to the flag's entry at the end: every place that sets it and every scene, ending and journal thread that reads it.</li>
      <li>Generated ${esc(generated)} from the ${esc(model.target)} build (script ${esc(model.version)}).</li>
    </ul>
  </details>
</header>
<div class="shell">
  <nav class="rail" aria-label="Days">
    <ol>${rail}</ol>
    <div class="rail-more"><a href="#flags">Flags</a><a href="#endings">Endings</a><a href="#epilogue">Epilogue</a><a href="#threads">Journal threads</a>${model.trail ? '<a href="#trail">The forger’s trail</a>' : ''}</div>
  </nav>
  <main class="script">
    ${model.days.map((d) => dayHtml(d, w)).join('')}
    <section class="appendix" id="flags">
      <h2>Flags</h2>
      <p>What the story remembers between days. A flag nothing reads yet is a choice with no later consequence${unread > 0 ? ` (${unread} of them)` : ''}${unset > 0 ? `; ${unset} ${unset === 1 ? 'is' : 'are'} read but never set` : ''}.</p>
      ${model.flags.map(flagHtml).join('')}
      ${
        model.slice
          ? `<p id="slice" class="muted">The vertical slice (a demo path through Days 1–${model.slice.after}, then Day ${model.slice.day}) jumps over the days between and sets ${model.slice.flags.map(w.flag).join(', ')} to stand in for them.</p>`
          : ''
      }
    </section>
    <section class="appendix" id="endings">
      <h2>Endings</h2>
      <p>Checked every night, in this order; the first that holds ends the run.</p>
      ${model.endings.map((e) => endingHtml(e, w)).join('')}
    </section>
    <section class="appendix" id="epilogue">
      <h2>Epilogue</h2>
      <p>After the ending's own words, what became of everyone. Each part says the first of its lines whose condition holds.</p>
      ${model.epilogue.map((s) => epilogueHtml(s, w)).join('')}
    </section>
    <section class="appendix" id="threads">
      <h2>Journal threads</h2>
      <p>What the journal lists as still in play, while its condition holds.</p>
      <ul class="threads">${model.threads.map((th) => `<li>${esc(th.text.replace(/\{n\}/g, 'N'))} <span class="muted">(while ${stateWords(th.when, w)})</span></li>`).join('')}</ul>
    </section>
    ${model.trail ? trailHtml(model.trail, w) : ''}
  </main>
</div>
<div class="bar" role="region" aria-label="Your review">
  <p class="tally"><b id="n-ok">0</b> approved · <b id="n-changes">0</b> need changes · <b id="n-open">${model.totals.scenes}</b> to read</p>
  <p class="where" id="store-note">Kept in this browser. Copy your review to send it.</p>
  <button type="button" class="btn" id="copy-review">Copy review</button>
</div>
<div class="out" id="review-out" hidden>
  <p id="copy-done"></p>
  <label class="sr" for="review-text">Your review</label>
  <textarea id="review-text" readonly></textarea>
  <div><button type="button" class="btn" id="close-review">Close</button></div>
</div>
</div>
<script>${CLIENT}</script>`;
  const document = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
</head>
<body data-version="${esc(model.version)}">
${body}
</body>
</html>
`;
  return { body, document };
}
