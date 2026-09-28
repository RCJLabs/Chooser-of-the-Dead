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
  /**
   * A statement about a companion in the soul's party (docs/tech-spec.md §69): member `soul`'s fact. Never about the
   * soul itself, so nothing that reads `says` reads it; it's checked against the companion's own evidence.
   */
  readonly about?: { readonly soul: number; readonly fact: string; readonly value: Value };
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
  /**
   * A lie about a companion (docs/tech-spec.md §69): about party member `about`, so `fact`, `claimed` and `truth` are
   * that soul's. Owning up to it reveals nothing about the liar.
   */
  readonly about?: number;
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
  /**
   * What else the proof needs, on the soul's companions (docs/tech-spec.md §69): what shows a lie about one false,
   * when catching it decides the soul. Absent when nothing.
   */
  readonly crossProof?: readonly { readonly soul: number; readonly field: string }[];
}

/** A soul's place in a party at the desk (docs/tech-spec.md §69). */
export interface PartyTag {
  /** The same for every member, and no one else in the line. */
  readonly id: string;
  readonly kind: string;
  /** Its place in the party, from 0; members stand in the line in this order. */
  readonly index: number;
  readonly size: number;
  /** How the desk names the party. */
  readonly title: { readonly msg: string; readonly params: Readonly<Record<string, string | number>> };
  /**
   * A retinue's (docs/tech-spec.md §70): the jarl's place in the party, and the fact that holds the hall he's bound for
   * on each of his sworn men.
   */
  readonly lord?: { readonly at: number; readonly fact: string };
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
  /** Whose kin it is (docs/tech-spec.md §60): a soul the run sent to a hall where it didn't belong. */
  readonly kin?: { readonly name: string; readonly day: number; readonly hall: Destination };
  /** The party it came with (docs/tech-spec.md §69), if any. */
  readonly party?: PartyTag;
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
