import type { Destination, Motive, QuestionKind, Salience, ToolId, Value, View } from '../content/types';
import type { Judgment } from '../logic/judge';
import type { Truth } from '../logic/pred';

export type Item = 'body' | 'testimony' | 'huginn' | 'muninn' | 'registry' | 'tally';

/** One thing the player can inspect: a body sign, a cue, or a line of testimony or raven report. */
export interface Field {
  readonly id: string;
  readonly item: Item;
  readonly view?: View;
  readonly tool?: ToolId;
  readonly salience: Salience;
  /** Sun-seconds to inspect or read it. Tool costs are counted once per proof, separately. */
  readonly cost: number;
  readonly obs?: { readonly key: string; readonly value: Value };
  readonly cue?: { readonly key: string };
  /** A statement about a fact. `null` means Muninn forgot. */
  readonly says?: { readonly fact: string; readonly value: Value | null };
  /** A forgery sign on the soul's saga tally: seen, it makes the whole tally worthless. */
  readonly tell?: ForgeryTell;
  readonly text?: { readonly msg: string; readonly params: Readonly<Record<string, string | number>> };
}

/** Cosmetic only: never affects judgment (checked by metamorphic tests). */
export interface Look {
  readonly gender: 'm' | 'f';
  readonly name: string;
  readonly patronym: string;
  readonly age: number;
  readonly build: 'lean' | 'broad' | 'heavy';
  readonly beard: 'none' | 'short' | 'long' | 'braided';
  /** Which clothing colour, on days that spread their looks; an art style takes it modulo its palette. */
  readonly tunic?: number;
}

export interface Evidence {
  readonly fields: readonly Field[];
  readonly look: Look;
  readonly persona: string;
  /**
   * Words the soul's facts or claims fix, by pool id (a fact's `words`: an Ulfberht is a sword).
   * Its lines already use them; this lets the art draw them when no line names them. Absent if none.
   */
  readonly words?: Readonly<Record<string, string>>;
}

/** How a forged tally gives itself away (never spelling: Younger Futhark spelling varied too much). */
export type ForgeryTell = 'elderRune' | 'mirroredRune' | 'brokenFormula';

export interface Lie {
  /** The testimony or tally field that tells it. */
  readonly field: string;
  /** Carved on a forged saga tally rather than spoken. */
  readonly via?: 'tally';
  readonly fact: string;
  readonly claimed: Value;
  readonly truth: Value;
  readonly motive: Motive;
  /** How the soul answers if questioned, fixed at generation so the validator knows what's revealed. */
  readonly onQuestion: QuestionKind;
  readonly reveals: readonly string[];
}

export interface CaseMeta {
  readonly seed: string;
  readonly tier: string;
  readonly attempts: number;
  readonly fallback: boolean;
  readonly decisive: readonly string[];
  readonly proof: readonly string[];
  readonly proofCostS: number;
  readonly difficulty: number;
  /** Ids of cue fields that point the wrong way (hidden from the player). */
  readonly decoys: readonly string[];
}

export interface CaseSpec {
  readonly id: string;
  readonly day: number;
  /** Position in the generated queue; scripted souls keep the position they were placed at. */
  readonly procIndex: number;
  /** The ScriptedCaseDef this soul was made from, if it is a story soul. */
  readonly script?: string;
  /** Made, and judged, under the day's noon decree (docs/tech-spec.md §45): see `soulCtx`. */
  readonly noon?: true;
  /** What an ordinary soul asks for at the desk (docs/tech-spec.md §59): a stamp where it doesn't belong, and the words. */
  readonly plea?: { readonly stamp: Destination; readonly text: string };
  readonly archetype: string;
  readonly truth: Truth;
  readonly lies: readonly Lie[];
  readonly evidence: Evidence;
  readonly expect: Judgment;
  readonly meta: CaseMeta;
}

export type RejectCode =
  | 'NO_ARCHETYPE'
  | 'TRUTH_UNSAT'
  | 'DEST_MISMATCH'
  | 'LIE_UNSPOKEN'
  | 'CONTENT_RULE'
  | 'UNSOUND'
  | 'FALSE_ALARM'
  | 'UNDETERMINED'
  | 'WRONG_DEST'
  | 'HIDDEN_LIE'
  | 'PRESUMPTION_UNSUPPORTED'
  | 'CUE_MISSING'
  | 'HIDDEN_FORGERY'
  | 'EFFORT_BAND'
  | 'TOO_MANY_TOOLS'
  | 'SALIENCE_FLOOR'
  | 'TOO_MANY_DOCS';

export interface GenAttempt {
  readonly tier: string;
  readonly attempt: number;
  readonly archetype: string | null;
  readonly code: RejectCode | 'ACCEPTED';
  readonly detail?: string;
}

export interface GenLog {
  readonly day: number;
  readonly procIndex: number;
  readonly target: Destination;
  readonly attempts: readonly GenAttempt[];
  readonly fallback: boolean;
}
