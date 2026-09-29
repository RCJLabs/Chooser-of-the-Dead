/*
 * The conditions scenes are written with (docs/story-drafts.md, "Reading the
 * run"): calls to the game's externals (flag, standing, rings, day, home,
 * sick, word, wrong), numbers and strings, not / and / or, comparisons and brackets. Parsed
 * so the script can say them in words and list the flags each one reads.
 */

export type Expr =
  | { readonly call: string; readonly args: readonly (string | number)[] }
  | { readonly num: number }
  | { readonly str: string }
  | { readonly not: Expr }
  | { readonly and: readonly Expr[] }
  | { readonly or: readonly Expr[] }
  | { readonly cmp: Cmp; readonly a: Expr; readonly b: Expr };

export type Cmp = '==' | '!=' | '<' | '<=' | '>' | '>=';

type Token = { readonly t: 'id' | 'num' | 'str' | 'op'; readonly v: string };

function tokens(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const rest = src.slice(i);
    const ws = /^\s+/.exec(rest);
    if (ws) {
      i += ws[0].length;
      continue;
    }
    const m =
      /^(==|!=|<=|>=|&&|\|\||[<>!(),])/.exec(rest) ??
      /^-?\d+/.exec(rest) ??
      /^"[^"]*"/.exec(rest) ??
      /^[A-Za-z_]\w*/.exec(rest);
    if (!m) throw new Error(`can't read the condition "${src}" at "${rest}"`);
    const v = m[0];
    const t: Token['t'] = /^-?\d/.test(v) ? 'num' : v.startsWith('"') ? 'str' : /^[A-Za-z_]/.test(v) ? 'id' : 'op';
    out.push({ t, v });
    i += v.length;
  }
  return out;
}

/** Parses a condition as Ink scenes write it: `flag("ulf_debt") && home("brother")`. */
export function parseExpr(src: string): Expr {
  const ts = tokens(src);
  let at = 0;
  const peek = () => ts[at];
  const take = (v?: string): Token => {
    const tok = ts[at];
    if (!tok || (v !== undefined && tok.v !== v)) throw new Error(`can't read the condition "${src}"`);
    at++;
    return tok;
  };
  const isWord = (tok: Token | undefined, ...words: string[]) => tok !== undefined && words.includes(tok.v);

  const or = (): Expr => {
    const parts = [and()];
    while (isWord(peek(), '||', 'or')) {
      take();
      parts.push(and());
    }
    return parts.length === 1 ? (parts[0] as Expr) : { or: parts };
  };
  const and = (): Expr => {
    const parts = [not()];
    while (isWord(peek(), '&&', 'and')) {
      take();
      parts.push(not());
    }
    return parts.length === 1 ? (parts[0] as Expr) : { and: parts };
  };
  const not = (): Expr => {
    if (isWord(peek(), 'not', '!')) {
      take();
      return { not: not() };
    }
    return cmp();
  };
  const cmp = (): Expr => {
    const a = primary();
    const op = peek();
    if (op && ['==', '!=', '<', '<=', '>', '>='].includes(op.v)) {
      take();
      return { cmp: op.v as Cmp, a, b: primary() };
    }
    return a;
  };
  const primary = (): Expr => {
    const tok = take();
    if (tok.v === '(') {
      const e = or();
      take(')');
      return e;
    }
    if (tok.t === 'num') return { num: Number(tok.v) };
    if (tok.t === 'str') return { str: tok.v.slice(1, -1) };
    if (tok.t === 'id') {
      if (!isWord(peek(), '(')) throw new Error(`"${tok.v}" in "${src}" isn't one of the game's functions`);
      take('(');
      const args: (string | number)[] = [];
      while (!isWord(peek(), ')')) {
        const arg = take();
        if (arg.t === 'str') args.push(arg.v.slice(1, -1));
        else if (arg.t === 'num') args.push(Number(arg.v));
        else throw new Error(`can't read the arguments in "${src}"`);
        if (isWord(peek(), ',')) take(',');
      }
      take(')');
      return { call: tok.v, args };
    }
    throw new Error(`can't read the condition "${src}"`);
  };

  const e = or();
  if (at !== ts.length) throw new Error(`can't read the condition "${src}"`);
  return e;
}

/** Every flag a condition reads. */
export function flagsRead(e: Expr): string[] {
  if ('call' in e) return e.call === 'flag' && typeof e.args[0] === 'string' ? [e.args[0]] : [];
  if ('not' in e) return flagsRead(e.not);
  if ('and' in e) return e.and.flatMap(flagsRead);
  if ('or' in e) return e.or.flatMap(flagsRead);
  if ('cmp' in e) return [...flagsRead(e.a), ...flagsRead(e.b)];
  return [];
}

/** How the words for a condition are made: names for the family and the powers, and how a flag looks. */
export interface Wording {
  /** A family member's name by id ("brother" is Ulf). */
  readonly person: (id: string) => string;
  /** A power's name by id ("odin" is Odin). */
  readonly power: (id: string) => string;
  /** A flag's name as the page shows it (a link to its entry, in the page). */
  readonly flag: (name: string) => string;
}

const FLIP: Readonly<Record<Cmp, Cmp>> = { '==': '==', '!=': '!=', '<': '>', '<=': '>=', '>': '<', '>=': '<=' };
const NEGATE: Readonly<Record<Cmp, Cmp>> = { '==': '!=', '!=': '==', '<': '>=', '<=': '>', '>': '<=', '>=': '<' };

/** An amount compared, in words: "3 or more", "fewer than 5". */
function amount(op: Cmp, n: number, unit = ''): string {
  const u = unit ? ` ${unit}` : '';
  switch (op) {
    case '==':
      return `exactly ${n}${u}`;
    case '!=':
      return `anything but ${n}${u}`;
    case '<':
      return `fewer than ${n}${u}`;
    case '<=':
      return `${n}${u} or fewer`;
    case '>':
      return `more than ${n}${u}`;
    case '>=':
      return `${n}${u} or more`;
  }
}

/**
 * A condition in words, as a reader of the script needs it: "Ulf is at home and ulf_debt is set".
 * `negated` says it the other way round (for "Otherwise" and `not`).
 */
export function describe(e: Expr, w: Wording, negated = false): string {
  if ('not' in e) return describe(e.not, w, !negated);
  if ('and' in e || 'or' in e) {
    // De Morgan: "not (a and b)" reads as "a isn't … or b isn't …".
    const both = 'and' in e;
    const parts = both ? e.and : (e as { or: readonly Expr[] }).or;
    const joinAnd = both !== negated;
    const words = parts.map((p) => {
      const d = describe(p, w, negated);
      const mixed = ('and' in p || 'or' in p) && 'and' in p !== joinAnd;
      return mixed ? `(${d})` : d;
    });
    return words.join(joinAnd ? ' and ' : ', or ');
  }
  if ('cmp' in e) {
    // Put the call first: "rings() >= 5" and "5 <= rings()" read the same.
    let { a, b, cmp: op } = e;
    if (!('call' in a) && 'call' in b) [a, b, op] = [b, a, FLIP[op]];
    if (negated) op = NEGATE[op];
    const n = 'num' in b ? b.num : null;
    if ('call' in a && n !== null) return called(a, w, op, n);
    // Two of the run's numbers against each other: "letters_honest is more than letters_kind".
    if ('call' in a && 'call' in b) return `${term(a, w)} is ${RELATION[op]} ${term(b, w)}`;
    return `${negated ? 'not: ' : ''}${JSON.stringify(e)}`;
  }
  if ('call' in e) return called(e, w, negated ? '==' : '!=', 0);
  return negated ? 'never' : 'always';
}

const RELATION: Readonly<Record<Cmp, string>> = {
  '==': 'the same as',
  '!=': 'not the same as',
  '<': 'less than',
  '<=': 'at most',
  '>': 'more than',
  '>=': 'at least',
};

/** One of the run's numbers, named as a reader would: a flag, "your rings", "Odin's standing". */
function term(e: { readonly call: string; readonly args: readonly (string | number)[] }, w: Wording): string {
  const arg = String(e.args[0] ?? '');
  switch (e.call) {
    case 'flag':
      return w.flag(arg);
    case 'rings':
      return 'your rings';
    case 'standing':
      return `${w.power(arg)}'s standing`;
    case 'day':
      return 'the day';
    case 'word':
      return 'the word among the dead';
    case 'wrong':
      return 'the souls sent wrong so far';
    default:
      return `${e.call}(${e.args.map((x) => JSON.stringify(x)).join(', ')})`;
  }
}

/** One external compared with a number (a bare call means "is not 0"). */
function called(
  e: { readonly call: string; readonly args: readonly (string | number)[] },
  w: Wording,
  op: Cmp,
  n: number,
): string {
  const arg = String(e.args[0] ?? '');
  const truthy = (op === '!=' && n === 0) || (op === '>=' && n === 1) || (op === '>' && n === 0);
  const falsy = (op === '==' && n === 0) || (op === '<' && n === 1) || (op === '<=' && n === 0);
  switch (e.call) {
    case 'flag':
      if (truthy) return `${w.flag(arg)} is set`;
      if (falsy) return `${w.flag(arg)} isn't set`;
      return `${w.flag(arg)} is ${amount(op, n)}`;
    case 'home':
      if (truthy) return `${w.person(arg)} is at home`;
      if (falsy) return `${w.person(arg)} isn't at home`;
      break;
    case 'sick':
      if (truthy) return `${w.person(arg)} is sick`;
      if (falsy) return `${w.person(arg)} isn't sick`;
      break;
    case 'rings':
      return `you have ${amount(op, n, n === 1 ? 'ring' : 'rings')}`;
    case 'standing':
      return `${w.power(arg)}'s standing is ${amount(op, n)}`;
    case 'day':
      if (op === '>=') return `it's Day ${n} or later`;
      if (op === '<') return `it's before Day ${n}`;
      if (op === '==') return `it's Day ${n}`;
      return `the day is ${amount(op, n)}`;
    // The word among the dead (docs/tech-spec.md §73) runs from stern (below 0) to soft (above).
    case 'word':
      return `the word among the dead is ${amount(op, n)}`;
    case 'wrong':
      return `${amount(op, n, n === 1 ? 'soul' : 'souls')} sent wrong so far`;
  }
  return `${e.call}(${e.args.map((x) => JSON.stringify(x)).join(', ')}) is ${amount(op, n)}`;
}
