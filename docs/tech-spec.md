# Chooser of the Slain: technical spec

This is the detailed design behind [`build-plan.md`](build-plan.md). When the two disagree on a game-design matter (unlock days, story beats), `build-plan.md` §1–2 wins. The YAML and TypeScript below are sketches, not final code.

## 0. Environment notes and review corrections (checked 2026-09-23)

**Repo and local tools**
- `RCJLabs/Chooser-of-the-Dead` (named `Vikings-R-Us` until September 2026, §64) is **public, by decision** (see §8.4).
- Local tools: Node 22.22, pnpm 10.33, JDK 21, no Android SDK.
- `/opt/pw-browsers/chromium-1194` matches **Playwright 1.56.x**; 1.57 ships chromium-1200. Pin `@playwright/test@1.56.1` and set `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`.

**Package versions (all compatible with each other)**
- vite 8.3 (Rolldown). @preact/preset-vite 2.10 and vitest 5.0 both accept Vite 8.
- preact 10.29, @preact/signals 2.11, zod 4.6, yaml 2.9.
- inkjs 2.4 ships `inkjs/compiler/*`, so Ink compiles in Node without the .NET compiler.
- intl-messageformat 12.1. @messageformat/core hasn't been published since Oct 2024.
- fast-check 4.10, electron 44, electron-builder 26.
- @capacitor/* 8.5: its Android template uses minSdk 24 and targetSdk/compileSdk 36.
- vite-plugin-pwa 1.3 (supports Vite 8).

**Corrections the review made to the first draft**
1. **Steam integration:** steamworks.js looks unmaintained (npm 0.4.0, Aug 2024). Use **steamworks-ffi-node** (0.11.2, Aug 2026) behind a `SteamPort` adapter. It calls Steamworks SDK 1.64 through koffi FFI (no native rebuild per Electron version) and covers achievements, stats, cloud, overlay and input.
2. **Public repo:** anyone can clone and build the full campaign. The decision is to accept that and protect the work with a license plus reserved content rights (§8.4). The build-time content split still keeps the campaign off the web demo and out of the Steam demo.
3. **Saves:** "state = f(seed, log)" is right for replays but wrong as the only save format across updates. Add day snapshots and save the in-progress day's already-generated queue. Make Ink scenes stateless (§5.4, §7).
4. **Fairness** needs trust levels, presumptions and perception classes, not only "every lie is exposed" (§3).
5. **Compare works field by field**, and only on what the player has actually looked at.
6. **Heraldry** is pattern + emblem + color. Color alone would break "never color alone".
7. **Dailies:**
   - The share text must not reveal answers and must include a generator version.
   - The engine must use integer math only. Functions like Math.sin, exp and pow can give slightly different results in Safari and Chrome, which would split the Daily.
8. **More leak paths:** string tables, Ink JSON, assets and source maps. Scope each of them to a pack.
9. **Schedule:** about 12–13 months full-time to 1.0 on both stores.
10. **Title:** don't put "R-Us" in the commercial title (Toys"R"Us enforces "R Us" marks). Ship as *Chooser of the Slain*.

---

## 1. Repo and package layout

```
Chooser-of-the-Dead/                  (public; see §8.4 for license)
├─ package.json  pnpm-workspace.yaml  tsconfig.*.json  biome.json
├─ packages/
│  ├─ engine/            pure TS; tsconfig lib ES2023 with no DOM. rng/ logic/ gen/ sim/ narrative/ save/ runes/
│  ├─ content-schema/    zod schemas; z.infer types are the single source of truth
│  ├─ content-compiler/  YAML + Ink + strings -> generated/<target>/**, lints, leak tokens, TS codegen (FactId/ObsKey unions)
│  ├─ ui/                Preact components, layouts, input/commands, i18n runtime, art interfaces
│  ├─ art/               BodyArtProvider contract, shared layout, woodcut (default), pixel, placeholder
│  ├─ art-final/         (M5+) sprite provider, same contract
│  ├─ platform/          Platform interface; adapters web | itch | electron | android (aliased per target)
│  └─ testkit/           fast-check arbitraries, brute-force oracle solver, bots, sweep harness, golden utils
├─ apps/
│  ├─ web/               Vite entry; vite.config.ts holds the TARGET matrix; PWA config
│  ├─ electron/          main.ts, preload.ts, steam.ts, saves.ts, electron-builder.yml   (M6)
│  └─ android/           capacitor.config.ts plus the android/ Gradle project           (M9)
├─ content/packs/
│  ├─ core/      facts, laws, channels, cues, rules library, named predicates, stamps, tools, personas,
│  │             archetypes, testimony/raven/question templates, name pools, heraldry, strings/en.json
│  ├─ daily/     daily composer, twist-decree pool, 3-case primer, strings
│  ├─ demo/      days/01..03, scripted cases, ink/*.ink, letters, strings
│  └─ campaign/  days/04..20, characters, endings, ink/, strings, pack.yaml (holds a canary)
├─ assets/{core,demo,campaign}/        pack-scoped art and audio
├─ tools/  case-lab/  sim/  replay/  leak-check/  lint-boundaries/  glyph-check/  body-lab/
├─ tests/  e2e/  golden/  replays/  fixtures/saves/
└─ .github/workflows/  ci.yml nightly.yml deploy-web.yml itch.yml steam.yml android.yml
```

**Build targets.** Each is `pnpm build:<t>`, which runs `content:compile --target t`, then `vite build --mode t`, then the shell packaging step (M6/M9).

| Target | Packs | @platform | PWA | base | Ships to |
|---|---|---|---|---|---|
| web-demo | core, daily, demo | web | yes | `/Chooser-of-the-Dead/` (the path Pages reports, §64) | GitHub Pages |
| web-itch | core, daily, demo | itch (web without service worker) | no | `./` | itch.io zip via butler |
| web-playtest | all | itch | no | `./` | a restricted itch.io page (§38) |
| web-full | all | web | yes | `./` | GitHub Pages at `/full/`, installable (§65) |
| electron-demo | core, daily, demo | electron | no | `./` | Steam demo app (its own appId) |
| electron-full | all | electron | no | `./` | Steam |
| android-full | all | android | no | `./` | Play (Capacitor) |
| dev-full | all + Case Lab | web | no | `/` | local only |

**How demo builds exclude the campaign**
1. **Pack dependency graph in the compiler.** `daily → core`, `demo → core`, `campaign → core, demo`. Any reference that breaks it is a build error. Output goes to `generated/<target>/`, which contains only the allowed packs.
2. **Vite `virtual:content` plugin.** It resolves only to `generated/<target>/index.ts`. The boundary check (`tools/lint-boundaries`) blocks any other import of `content/**` or `generated/**`.
3. **Everything is pack-scoped:** strings (`strings/<pack>.en.json`), Ink JSON, assets, achievement metadata and the PWA's offline cache list.
4. **Post-build leak check** (a CI gate on web-demo, web-itch and electron-demo). It scans every emitted file (js, json, css, html, map, webmanifest, service-worker cache list) for the campaign canary and every campaign-owned ID (string keys, scene names, character IDs, asset names). **Positive control:** the same scan must find them in the full builds, so the check can't pass by doing nothing. Public targets ship no source maps.
5. **Source:** the repo is public by decision, so layers 1–4 keep the campaign off the *demo builds*, not out of the source (§8.4).

Mechanics code (e.g. the DETAIN handler) ships in every bundle. That's acceptable: mechanics aren't content. People digging through the demo can see mechanic names.

---

## 2. Core TypeScript types

These live in `content-schema` as zod schemas; the engine re-exports the inferred types.

```ts
export type Day = number;                              // campaign 1..20; daily/endless use synthetic DaySpecs
export type PackId = 'core' | 'daily' | 'demo' | 'campaign';
export type Destination = 'VALHALLA'|'FOLKVANGR'|'HEL'|'RAN'|'RETURN'|'DETAIN'|'TRANSFER';
export type ToolId = 'flip'|'feather'|'runeLens'|'clippers'|'loupe';
export type Faction = 'odin'|'freyja'|'hel'|'loki'|'clerk';
export type Value = string | number | boolean;
export type FactId = GeneratedFactId;                  // codegen'd union from facts.yaml
export type ObsKey = GeneratedObsKey;                  // 'skin'|'lips'|'nails'|'woundsFront'|'feather'|'tallyTell'|'faceMatch'|...
export type FieldId = string;                          // 'body.front.lips' | 'testimony.3' | 'tally.cause' | 'muninn.lord' | 'q.2'

// ---- Facts: hidden ground truth ----
export interface FactDef {
  id: FactId; pack: PackId;
  domain: { enum: readonly string[] } | { bool: true } | { int: readonly [number, number] } | { ref: 'people'|'lords'|'registry' };
  since: Day; inert: Value;          // before `since` the fact is pinned to `inert` (keeps early days simple)
  presumption?: Value;               // taught custom used when there's no evidence ("the fallen are dead")
  derived?: Pred;                    // computed, never sampled (e.g. fled)
}
export type Truth = Readonly<Record<FactId, Value>>;

// ---- One predicate language for rules, laws, whims, archetypes, scripted `if`s, game-overs, endings ----
export type Pred =
  | { fact: FactId; is: Value } | { fact: FactId; in: readonly Value[] } | { fact: FactId; gte?: number; lte?: number }
  | { state: string; is?: Value; gte?: number; lte?: number }        // GameState path (endings, scripted inserts)
  | { all: readonly Pred[] } | { any: readonly Pred[] } | { not: Pred }
  | { ref: string }                  // named, day-versioned predicate (e.g. pred.worthy)
  | { param: string }                // day parameter (e.g. freyjaWhim)
  | { always: true };

export interface Rule {              // ordered decision list: first TRUE wins
  id: string; pack: PackId; since: Day; until?: Day; order: number;
  when: Pred; then: Destination;
  decree: string;                    // i18n key for Odin's flavor text. The clerk's summary is GENERATED from `when`.
}
export interface Procedure { id: 'trimNails'; pack: PackId; since: Day; until?: Day; when: Pred } // judgment = dest + procedures

// ---- What the player is taught (rulebook "Signs" and "Customs") ----
export interface Law {
  id: string; pack: PackId; since: Day; text: string;
  if: ObsPattern;                    // {obs,is|in} | {all:[...]} | {fn:'ownerMatchesName'|'faceMatchesRegistry'}
  then: FactConstraint;              // conjunction of {fact, in:[...]} only, so propagation stays trivial
}
export interface Perception {        // GAMEPLAY content; art must conform to it (§6.5)
  view?: 'front'|'back'; tool?: ToolId; zoom?: boolean;
  salience: 1|2|3;                   // 1 subtle, 3 obvious at default zoom
  occludedBy?: readonly LookGene[];  // e.g. 'beard:full' hides lips, so they can't be perceived
}
export interface Channel {           // ways a fact CAN be evidenced (planner input)
  fact: FactId; via: { obs: ObsKey; law: string } | { says: SourceKind };
  trust: 3|4; perceive: Perception; since: Day; subtlety: 1|2|3;
}
export interface Cue { fact: FactId; value: Value; obs: ObsKey; is: Value; perceive: Perception } // hint, no law (e.g. breath-fog)
export type SourceKind = 'testimony'|'tally'|'huginn'|'muninn'|'registry'|'clerkRegister'|'confession';

// ---- Evidence: what gets rendered ----
export interface Field {
  id: FieldId; item: 'body'|'weapon'|SourceKind; perceive: Perception;
  obs?: { key: ObsKey; value: Value };              // interpreted via laws
  says?: { fact: FactId; value: Value | null };     // statement; null = Muninn "forgot"
  display: { msg?: string; params?: Record<string, Value>; runes?: string; hotspot?: string };
}
export interface Evidence { fields: readonly Field[]; look: AppearanceGenome; persona: string }

export interface Lie {
  field: FieldId; source: 'testimony'|'tally'; fact: FactId; claimed: Value; truth: Value;
  motive: 'wantsValhalla'|'avoidHel'|'hideFaith'|'evadeRegistry'|'mistaken'|'mischief';
  tell?: 'elderRune'|'mirroredRune'|'brokenFormula';    // required iff source === 'tally'
  onQuestion: 'confess'|'excuse'|'insist'|'deflect';    // fixed at generation, so the validator knows the reveals
  reveals: readonly FactId[];
}

export interface CaseSpec {          // output of the generator AND of compiled scripted cases
  id: string; pack: PackId; origin: 'procedural'|'scripted'; procIndex?: number; archetype?: string; character?: string;
  truth: Truth; lies: readonly Lie[]; evidence: Evidence;
  expect: { dest: Destination; procedures: readonly Procedure['id'][]; rule: string }
        | { dilemma: { acceptable: readonly Destination[]; why: string } };
  onStamp?: Partial<Record<Destination | '*', readonly Effect[]>>;
  meta?: { seed: string; attempts: number; proof: readonly FieldId[]; proofCostS: number; difficulty: number }; // stripped in prod
}

export interface Knobs {
  lieRate: number; maxLies: 0|1|2|3; forgeryRate: number; decoyRate: number;
  redundancy: 1|2|3;                 // hard channels per decisive fact
  salienceFloor: 1|2|3; dropout: number;                 // Muninn blanks, never on a sole channel
  proofCostS: readonly [number, number];                 // band for the minimal-proof cost, in sun-seconds
  maxTools: number; maxDocs: number;                     // phone density cap
  vigilance: number;                                     // rate of rare critical cases (alive, Loki, outlaw)
}
export interface DaySpec {
  day: Day; pack: PackId; sunS: number;
  decree: { msg: string; addRules: string[]; removeRules: string[]; stamps: Destination[]; tools: ToolId[];
            laws: string[]; procedures: string[] };
  params?: Record<string, { pool: string } | Pred>;      // freyjaWhim etc.
  queue: {
    procedural: { count: readonly [number, number]; archetypes: { id: string; w: number }[];
                  mix: Partial<Record<Destination, readonly [number, number]>>; knobs: Knobs; teachFirst?: string };
    scripted: { case: string; at: number | readonly [number, number]; if?: Pred }[];
  };
  scenes?: { morning?: string; night?: string }; letters?: string[];
  economy: { wage: number; docBonus: number; warnings: number; fines: readonly number[]; costs: Record<string, number> };
  budget?: { words: number };
}

// ---- Runtime (engine-owned, JSON-serializable, never reads a clock) ----
export type Phase = 'morning'|'shift'|'audit'|'night'|'scene'|'ragnarok'|'ending';
export interface CaseRuntime {
  caseId: string; arrivedAt: number; view: 'front'|'back'; seen: FieldId[]; tools: ToolId[];
  penaltyMs: number; flagged: string[]; questioned: string[]; trimmed: boolean; stamp?: Destination;
}
export interface GameState {
  v: 1; mode: 'campaign'|'daily'|'endless'; seed: string; genVersion: number;
  day: Day; phase: Phase; scene?: { knot: string; choices: number[] };
  clock: { sunMs: number; shiftStart: number; pausedMs: number; penaltyMs: number; story: boolean; speed: number };
  queue: string[]; cursor: number; cur?: CaseRuntime;
  rings: number; debtNights: number; standing: Record<Faction, number>;
  einherjar: { worthy: number; unworthy: number }; plot: { naglfar: number; lokiDeals: number; foiled: boolean };
  family: Record<string, { warmth: number; fed: number; health: number; status: 'ok'|'sick'|'gone' }>;
  upgrades: string[]; flags: Record<string, Value>; history: JudgmentRecord[]; recentTemplates: string[];
}
export type Action =
  | { t: 'newRun'; seed: string; mode: GameState['mode']; opts: RunOptions }
  | { t: 'beginShift'|'flip'|'trim'|'send'|'pause'|'resume'|'dusk'; at: number }
  | { t: 'reveal'; field: FieldId; at: number } | { t: 'tool'; tool: ToolId; target?: FieldId; at: number }
  | { t: 'compare'; a: FieldId; b: FieldId; at: number } | { t: 'question'; contradiction: string; at: number }
  | { t: 'stamp'; dest: Destination; at: number }
  | { t: 'choose'; index: number } | { t: 'buy'; item: string } | { t: 'endNight' } | { t: 'replayDay'; day: Day };
export declare function step(s: GameState, a: Action, c: Content): { state: GameState; events: GameEvent[] };
```

---

## 3. Case generation and fairness (the core system)

### 3.1 Model: four layers
- **The chain:** Truth T (facts) → render → Evidence E (fields) → player knowledge K(d) → solve → judgment (destination + procedures).
  - K(d) = the laws taught by day d, presumptions, the trust ladder, and what can be perceived with day d's tools.
- **Trust ladder:**
  - **4:** a physical sign read through a taught law; raven statements (Muninn may leave a blank, but ravens are never false); confessions.
  - **3:** the saga tally. It drops to 0 if any forgery sign is visible.
  - **2:** testimony.
  - **1:** presumption.
  - **0:** unknown.
- **Loki cases need no special handling.** T is the disguise persona's facts plus `loki=true`. Everything renders consistently with the persona except the lips, which a law covers. There's no "physical evidence can lie" exception.
- **Upgrades change speed only, never what can be perceived.** The validator always uses day d's baseline tools.
- **Cue, then confirm.** Tool-only facts (alive, forgery) get a tool-free *cue*: breath-fog, Huginn's "still twitching", a stick that looks off. Players confirm with the tool when cued, so nobody has to feather every soul.
  - False cues appear on normal cases at `decoyRate`, so the tool stays necessary.

### 3.2 Fairness contract (the validator checks every case)
- **F1 Soundness.** Every non-lie field agrees with T under ALL laws, including ones not yet taught, so the world stays consistent across days.
- **F2 No false alarms.** Every conflict among perceivable fields includes a lie or a forged field.
- **F3 Determinacy.** `solve(E,d)` reaches a definite judgment, equal to the expected destination and procedures.
- **F4 Exposure.** Every lie that changes the outcome is part of at least one detectable contradiction. F3 implies this, but it's checked separately so failures are easier to diagnose.
- **F5 Forgery detectability.** Every forged tally carries at least one sign that's visible on day d.
- **F6 Presumption safety.** If a decisive fact differs from its presumption, there is positive evidence at trust 3 or higher (or a confession).
  - **F6b:** if every way to see that fact needs a tool, there must also be a tool-free cue at or above the visibility floor.
- **F7 Effort.** Minimal-proof cost is within `proofCostS`. Tools ≤ `maxTools`. Every proof field has salience ≥ `salienceFloor`. Documents ≤ `maxDocs`.
- **F8 Content rules.**
  - Ages are limited to 18–85, so no children can appear.
  - A blocklist of banned combinations applies.
  - Names are unique within a day.
  - Symbols appropriated by extremists (valknut, serifed Othala, Algiz as "life rune", doubled Sowilo, Tyr rune, Wolfsangel, black sun) are banned from branding and UI art; runes stay allowed in in-world inscriptions.

### 3.3 Solver (from the player's point of view; three-valued; sound but conservative)
```ts
function solve(ev: Evidence, ctx: DayCtx): SolveResult {
  const P = ev.fields.filter(f => perceivable(f, ctx));      // tools(d), view, not occluded
  const B = initBeliefs(ctx.facts);                          // presumption @1, else full domain @0; each entry keeps a support set
  const tallyTrust = P.some(isPerceivableTell) ? 0 : 3;
  for (const f of P.filter(f => trustOf(f, tallyTrust) >= 3))
    narrow(B, constraintsOf(f, ctx.laws), trustOf(f), [f.id]);   // empty intersection => F2 violation
  propagate(B, ctx.factLaws);                                // fixpoint; support = union of field ids
  const cx: Contradiction[] = [];
  for (const s of P.filter(isTestimony)) {
    const b = B[s.says!.fact];
    if (b.level >= 3 && !b.values.has(s.says!.value)) cx.push({ lie: s.id, against: b.support, fact: s.says!.fact });
    else if (b.level <= 1) setSoft(B, s, 2);                 // testimony-vs-testimony clash => both dropped + internal contradiction
  }
  for (const c of cx) for (const r of revealsOf(c, ev)) narrow(B, r, 4, [`q:${c.lie}`]);  // planned confessions only
  propagate(B, ctx.factLaws);
  return { judgment: judge3(ctx.rules, ctx.procedures, B, ctx.params), contradictions: cx, beliefs: B };
}
// Kleene 3-valued logic: is -> T if values=={v}, F if v∉values, else U. all/any/not per Kleene.
function judge3(rules, procs, B, params) {
  for (const r of rules) {                                   // sorted by order, filtered by since/until
    const v = eval3(r.when, B, params);
    if (v === T) return { dest: r.then, rule: r.id, procedures: procs.filter(p => must(eval3(p.when, B))) };
    if (v === U) return { undetermined: r.id, blocking: unknownFacts(r.when, B) };
  }
  throw new Error('rulebook not total');                     // lint guarantees the last rule is {always:true}
}
function minimalProof(ev, ctx, expected): FieldId[] {        // 1-minimal: dropping any single field breaks it
  let keep = perceivableIds(ev, ctx);
  for (const id of byCostDesc(keep)) { const t = keep.filter(x => x !== id);
    if (same(solve(restrict(ev, t), ctx).judgment, expected)) keep = t; }
  return keep;
}
```
The minimal proof feeds four things:
- **Difficulty** (it's the effort measure).
- **Timer tuning.**
- **The bot's checklist.**
- **The in-game citation:** "Rule 4 applied; you did not inspect: skin (fever-flush)." This makes the fairness something players can *feel*.

### 3.4 Lie and contradiction model
- **A lie** is a statement field whose value differs from the truth. It comes from testimony (any fact) or a forged tally, which must carry a forgery sign.
- **Conflict detection:** each fact keeps a list of constraints with where they came from. Two constraints that allow no common value form a conflict set S1 ∪ S2.
- **Kinds of contradiction:**
  - **Direct:** the same fact.
  - **Inferential:** through a law, e.g. "died in battle" vs {no front wounds, no back wounds}.
  - **Identity:** the face vs. the registry portrait of the claimed name, or the owner inscription vs. the name.
  - **Internal:** two testimony lines disagree.
  - **Forged support:** lying testimony and a forged tally agree, and both contradict physical evidence.
- **"Detectable on day d"** means every field involved can be perceived with that day's tools, and every law involved has been taught.
- **Compare(a, b) at runtime** is valid when there's a conflict (S1, S2) with a in S1 and b in S2, **and** the player has seen everything in S1 ∪ S2 (`cur.seen`).
  - Invalid: "the ravens see no conflict", costing 10 sun-seconds.
  - Valid: creates a contradiction chip and earns the documentation bonus.
- **Decoys:**
  - Irrelevant oddities (old scars, mud, charms) have no law attached, so they can never create a conflict.
  - Irrelevant but detectable lies waste time without changing the outcome. They're good streamer comedy.

### 3.5 Question responses (template-based, deterministic)
1. Map the contradiction c to the lying field λ. For internal conflicts, use the planned lie.
2. `kind = λ.onQuestion`. The planner forces `confess` when F3 needs the reveal; otherwise it picks from a persona × motive weight table.
3. Pick a template:
   - Filter `QuestionTemplate.on` by fact, claimed value, truth, persona and kind (wildcards allowed).
   - Keep the most specific matches.
   - Make a weighted pick with `rng = hash(caseSeed,'q',c.id)`, excluding `state.recentTemplates` (the last 20).
   - Fall back to a generic template for that kind. The coverage lint guarantees one exists for every lie the generator can produce.
4. Fill ICU parameters (`{name}`, `{trueCause}`, `{lord}`, gender `select`) and render one to three lines.
5. Apply the effect:
   - `confess`: adds a confession field (trust 4) with its reveals, which can then be used in Compare.
   - `insist` (a truthful spirit against a forged tally): highlights the forgery sign, and the tally's trust drops to 0.
   - `excuse`: retracts the claim, no reveal.
   - `deflect` (Loki): no reveal, but a telltale line.
   - Every Question costs 20 sun-seconds.
- **Testimony uses the same machinery at generation time.** Each persona has a speech plan: opener, identity, death, deeds, faith, closer. Each slot picks a template whose `asserts` matches the planned statement (true or a lie), so every line carries a claim that Compare can use.

### 3.6 Generator algorithm
**`generateDay(runSeed, spec, state)`**
1. Pick n from `count`.
2. Build a **destination bag** from `mix` (like Tetris's 7-bag) and shuffle it by seed. Slot 0 targets the `teachFirst` rule.
3. Insert scripted cases whose `if` holds. Procedural slots keep their own `procIndex`, so moving a scripted case never shifts procedural seeds.
4. Run `generateCase` for each slot.
5. Day-level checks:
   - The destination mix is within bounds.
   - No more than 3 of the same destination in a row.
   - No character type makes up more than 40% of the day.
   - Names are unique (re-roll only the cosmetic stream).
   - Σ(expected time for a competent player) ÷ sunS is between 0.8 and 1.05.
   - Fix problems by swapping slots, at most 5 swaps. If that fails, log `DAY_SOFT_FAIL` and accept.

**`generateCase`**
```ts
const TIERS = [ {id:'strict',n:24}, {id:'widenBand',n:12}, {id:'anyArchetype',n:12}, {id:'retarget',n:8} ];
for (const tier of TIERS) for (let a = 0; a < tier.n; a++) {
  const rng = streams(`${genVersion}|${runSeed}|${day}|${procIndex}|${tier.id}|${a}`); // .arch .truth .lies .plan .look .dialog
  const arch = pickArchetype(ctx, slot.target, tier, rng.arch);   // precomputed archetype×day→dest table
  const T = sampleTruth(arch, ctx, rng.truth);            if (!T.ok) { rej('TRUTH_UNSAT', T.why); continue; }
  const J = judge(ctx.rules, T.value, ctx.params);        if (J.dest !== slot.target && tier.id !== 'retarget') { rej('DEST_MISMATCH'); continue; }
  const L = pickLies(arch, T.value, J, ctx.knobs, rng.lies);
  const plan = planEvidence(T.value, L, J, ctx, rng.plan); if (!plan.ok) { rej('NO_CHANNEL', plan.fact); continue; }
  const E = render(T.value, L, plan.value, ctx, rng.look, rng.dialog);
  const v = validate(E, T.value, L, J, ctx);               if (!v.ok) { rej(v.code, v.detail); continue; }   // F1–F8
  return accept(E, v.metrics);
}
return fallbackPool(ctx.day, slot.target, runSeed);        // curated, pre-validated; logged as a FALLBACK
```
- **`planEvidence`:**
  - Needed facts = decisive(T) ∪ the facts of each lie, where decisive(T) = {f | ∃v≠T[f]: judge(T[f:=v]) ≠ J}.
  - For each needed fact, pick `redundancy` channels available by day d, at least one at trust 3 or higher, weighted by the day's subtlety preference.
  - Add cues (F6b).
  - Muninn leaves blanks only on channels that aren't the only source for a needed fact.
  - Compose documents within `maxDocs`: a tally only if needed or on a random roll; a weapon only if grip isn't `none`.
  - Add decoys at `decoyRate`.
- **Separate random streams:**
  - Cosmetic changes (a new beard sprite) touch only `look`, so gameplay and Dailies stay stable. This is checked by metamorphic tests.
  - The whole case is a pure function of (seed, day, procIndex).
- **Budget per day:** at most 400 attempts. Target: under 5 ms per case in Node, 99th percentile.

### 3.7 Difficulty knobs and score
- **Knobs:** the `Knobs` fields, plus:
  - rule depth (the firing rule's position)
  - vigilance load (how many always-check items the rules imply)
  - how similar registry decoys look (distance in noticeable face traits)
  - how subtle forgery signs are
- **Score:** `difficulty = proofCostS + 8·questionsNeeded + 5·ruleDepth + 6·subtleProofFields + 4·distinctTools + 3·lies`. The weights start as guesses. Refit them from the public Daily alpha's telemetry (solve time and error rate as functions of these features).
- **By mode:**
  - Campaign: ramps through the DaySpecs.
  - Daily: a fixed "medium" band.
  - Endless: ramps with souls judged.

### 3.8 Logging and CI thresholds
- **GenLog per case:**
  - Identity: `{seed, day, procIndex, target}`.
  - Attempts: `attempts[]` of `{tier, a, archetype, code, detail}`.
    - Rejection codes: TRUTH_UNSAT, DEST_MISMATCH, NO_CHANNEL, UNDETERMINED(rule, blockingFacts), WRONG_DEST(via lie), FALSE_ALARM(fields), FORGERY_UNDETECTABLE, CUE_MISSING, EFFORT_BAND(cost), SALIENCE_FLOOR(field), DAY_CONSTRAINT.
  - On acceptance: `{archetype, dest, rule, decisiveFacts, lies, contradictions, proof, proofCostS, difficulty, ms}`.
  - Production builds keep counters only; full logs go to dev and CI.
- **Sweep report thresholds (CI fails if breached):**
  - Acceptance per (day, character type) ≥ 30%.
  - Mean attempts ≤ 3, 99th percentile ≤ 15.
  - Fallback rate ≤ 0.05%.
  - Generation time under 5 ms per case, 99th percentile.
  - Destination mix within spec on ≥ 99% of days.
  - The bot that checks everything scores exactly 100%.
  - The bot that believes testimony scores ≤ 65%, which proves the evidence matters.

### 3.9 Scripted cases and dilemmas
- Scripted cases compile to CaseSpec. Unspecified facts are sampled from the character's archetype with the case's own seed.
- They go through the same `validate`.
- **Branching:** if a case branches on flags (`if`), validate every combination of the flags it references.
- **Dilemmas** (`dilemma:`):
  - F1, F2 and F5 must still hold.
  - F3 becomes "result ∈ acceptable, or undetermined by design".
  - Citations are off, and the choice sets story flags.
- **Moral choices are explicit, never disguised as mistakes.** Example: Loki's "skip the trim" is a scene choice or deal action. An accidental mistake never advances the conspiracy.

### 3.10 What the validator can't prove, and the mitigations
The validator proves a case can be *deduced*, not that a human can *see* the evidence. Mitigations:
- Perception classes (salience, zoom, occlusion) are gameplay data, and the art has to meet them.
- Citations show the proof, so every mistake comes with an explanation.
- A "Report this soul" button exports the seed and the case.
- Opt-in alpha telemetry records error rates per rule and per sign.
- A weekly Case Lab review of 20 random cases per DaySpec.

---

## 4. Day loop, state machine, timer and scoring

```
Title -> newRun -> MORNING(d): decree scroll, rulebook diff (NEW/REPEALED badges), Ink morning scene
  -> beginShift -> SHIFT(d): [arrive -> reveal/flip/tool* -> compare/question/trim* -> stamp -> send]*
        ends on queue empty | dusk (the current soul may finish, grace <= 60 s)
  -> AUDIT(d): pay, citations/fines, standings, einherjar, plot; game-over table -> ENDING(early)
  -> NIGHT(d): letters/scenes (Ink), family upkeep, shop (speed-only upgrades), explicit plot choices
  -> endNight -> SNAPSHOT(d+1) -> MORNING(d+1)
Day 20: MORNING -> LAST SHIFT (surge queue) -> RAGNAROK (computed battle report scene) -> ENDING
replayDay(k): restore snapshot k (confirm: discards later days), as in Papers, Please
```

**Timer**
- Sun time = real time during SHIFT plus penalties: flip 2 s, feather 10 s, rune-lens 8 s, question 20 s, invalid compare 10 s.
- `elapsed = at − shiftStart − pausedMs + penaltyMs`. Actions carry `at` in integer ms from the UI's `performance.now()` offset. The UI dispatches `dusk`; the engine verifies it.
- The timer pauses on `visibilitychange`, blur or app pause. The desk blurs while paused, so pausing can't be used to think for free.
- Story Mode never reaches dusk. Assist sets sun speed from 0.5× to 2×; Daily results are then flagged "assisted".
- Starting curve (bot-tuned):
  - Day 1: 6 souls in 6 min.
  - Day 10: 12 in 9 min.
  - Day 19: 16 in 11 min.

**Scoring and economy** (defaults; bot-tuned)
- **Correct** means the destination and procedures are both right. It pays `wage` (5 rising to 8), plus `docBonus` +1 if you flagged a liar's contradiction before stamping.
- **Wrong:**
  - An immediate "Muninn's citation" slip.
  - The first 2 per day are warnings, then fines escalate [5, 10, 15].
  - A table of (expected, stamped) pairs sets standing changes. Example: sending Freyja's claim to Valhalla gives Freyja −2 and Odin +1.
- **Einherjar:** every VALHALLA stamp adds to worthy or unworthy. Unworthy einherjar flee at Ragnarök.
- **Night:**
  - Costs: hearth, food per person, medicine per sick member.
  - Nights in debt wear down family health.
  - Two nights in a row below −30 → the *Demoted* ending.
- **Draupnir** drips eight rings every ninth night (Snorri), so there's a bonus on nights 9 and 18.
- **Game-overs and endings** live in `endings.yaml` as ordered conditions on GameState, using the same predicate engine.
  - Checked at every audit for early endings: fired, demoted, transferred to the clerk, family leaves.
  - Checked again after Ragnarök. Strength = worthy − 0.5·unworthy + Freyja's host + Hel's legion − Naglfar progress, and ranges of strength map to endings.

**Modes**
- **Daily:**
  - A synthetic DaySpec from the daily pack: 8 souls, 6 min of sun, a "twist decree", no story.
  - The puzzle number comes from the **local** calendar date, as Wordle does; the UI passes it to the engine.
  - Share text: `Chooser of the Slain - Daily #97 (g2) / Decree: Freyja wants the left-handed / [+][+][x][+][+][+][+][+] 7/8, dusk +1:42 / <url>`. It shows correctness only and **never destination icons**, which would spoil the answers.
  - During the alpha, Dailies use Day 1–6 mechanics only. Loki and the clerk unlock in Dailies at launch.
- **Endless:** adds a new rule from the library every 5 souls; 3 citations ends the run; the seed is shareable.
- **Suggested full-game extra:** a Daily archive. The web demo offers only today's Daily.

---

## 5. Content pipeline and authoring

### 5.1 Stages (`packages/content-compiler`)
1. Load YAML with `yaml` 2.x:
   - YAML 1.2 core schema, so `NO` stays a string (matters in a Norse game).
   - `uniqueKeys` on.
   - A `LineCounter`, so errors point to file:line.
2. Parse each file with its zod schema.
3. Resolve references and build indices.
4. Run the lints (§10).
5. Precompute:
   - archetype × day → destination tables (about 300 sampled truths per pair)
   - rule summaries and rulebook pages
   - fallback pools
6. Compile Ink per scene with `inkjs/compiler`, then validate tags and externals.
7. Validate ICU strings with intl-messageformat and build a pseudo-localized variant.
8. Emit per target: `generated/<target>/{manifest.json, core.json, daily.json, days/day-NN.json, ink/*.json, strings/<pack>.en.json}`, plus `generated/types.ts` and `generated/leak/<pack>.tokens.json`.
9. `content:watch` recompiles the changed pack. Vite HMR invalidates `virtual:content`, so the Case Lab and the game hot-reload.

### 5.2 YAML examples (unlock days match build-plan §2)

> These sketches predate the implementation. The real files live in `content/packs/*`, and §13 lists where M1 differs (for example, `alive` is its own fact and there's no `cause: none`).

```yaml
# content/packs/core/facts.yaml
- { id: cause, domain: { enum: [battle, sickness, oldAge, drowned, accident, none] }, since: 1, inert: battle }
- { id: grip,  domain: { enum: [ownWeapon, borrowedWeapon, none] }, since: 1, inert: ownWeapon }
- { id: alive, domain: { bool: true }, since: 3, inert: false, presumption: false }   # Customs 1: "the fallen are dead"
- { id: faith, domain: { enum: [old, primeSigned, baptized] }, since: 10, inert: old }
- { id: loki,  domain: { bool: true }, since: 12, inert: false, presumption: false }
- id: fled
  domain: { bool: true }
  derived: { all: [ { fact: woundsBack, gte: 1 }, { fact: woundsFront, lte: 0 } ] }
- { id: age, domain: { int: [18, 85] }, since: 1, inert: 30 }                         # no children among the dead

# content/packs/core/laws.yaml
- { id: law.fever, since: 1, if: { obs: skin, is: feverFlush }, then: { fact: cause, in: [sickness] }, text: law.fever }
- id: law.unwounded                  # taught with Flip on day 2 (needs the back view)
  since: 2
  if: { all: [ { obs: woundsFront, is: 0 }, { obs: woundsBack, is: 0 } ] }
  then: { fact: cause, in: [sickness, oldAge, drowned, accident] }
  text: law.unwounded
- { id: law.breath, since: 3,  if: { obs: feather, is: stirs }, then: { fact: alive, in: [true] }, text: law.breath }
- { id: law.pendants, since: 10, if: { obs: pendant, is: hammerAndCross }, then: { fact: faith, in: [primeSigned] }, text: law.pendants }
- { id: law.lips,   since: 12, if: { obs: lips, is: stitchScars }, then: { fact: loki, in: [true] }, text: law.lips }

# content/packs/core/predicates.yaml   (day-versioned, so the rulebook diff shows the change)
- id: pred.worthy
  versions:
    - { since: 1, is: { all: [ { fact: cause, is: battle }, { fact: grip, in: [ownWeapon, borrowedWeapon] } ] } }
    - { since: 2, is: { all: [ { fact: cause, is: battle }, { fact: grip, in: [ownWeapon, borrowedWeapon] }, { fact: fled, is: false } ] } }
    - { since: 7, is: { all: [ { fact: cause, is: battle }, { fact: grip, is: ownWeapon }, { fact: fled, is: false } ] } }

# content/packs/core/rules.yaml   (first TRUE wins, by order)
- { id: rule.return,    order: 100, since: 3,  when: { fact: alive, is: true }, then: RETURN, decree: decree.return }
- { id: rule.detain,    order: 200, since: 12, when: { fact: loki, is: true }, then: DETAIN, decree: decree.detain }
- { id: rule.transfer,  order: 300, since: 10, when: { fact: faith, is: baptized }, then: TRANSFER, decree: decree.transfer }
- { id: rule.ran,       order: 500, since: 5,  when: { fact: cause, is: drowned }, then: RAN, decree: decree.ran }
- { id: rule.folkvangr, order: 600, since: 4,  when: { all: [ { ref: pred.worthy }, { param: freyjaWhim } ] }, then: FOLKVANGR, decree: decree.freyja }
- { id: rule.valhalla,  order: 700, since: 1,  when: { ref: pred.worthy }, then: VALHALLA, decree: decree.valhalla }
- { id: rule.hel,       order: 999, since: 1,  when: { always: true }, then: HEL, decree: decree.hel }
- { id: proc.trimNails, kind: procedure, since: 8, when: { fact: nails, is: untrimmed } }

# content/packs/core/archetypes/straw-braggart.yaml
id: arch.straw_braggart
since: 1
personas: [braggart, veteran]
truth: { cause: { in: [sickness, oldAge] }, age: { gte: 45 }, grip: { in: [ownWeapon, none] } }
motive: wantsValhalla
lies:
  - { fact: cause, claim: battle, p: 0.85, onQuestion: { confess: 3, excuse: 1 }, reveals: [cause] }
weight: 3

# content/packs/demo/days/day-03.yaml
day: 3
pack: demo
sunS: 420
decree: { msg: decree.d3, addRules: [rule.return], stamps: [RETURN], tools: [feather], laws: [law.breath], procedures: [] }
queue:
  procedural:
    count: [7, 9]
    teachFirst: rule.return
    archetypes: [ { id: arch.honest_warrior, w: 4 }, { id: arch.straw_braggart, w: 3 }, { id: arch.fled_coward, w: 2 }, { id: arch.not_quite_dead, w: 1 } ]
    mix: { VALHALLA: [0.3, 0.5], HEL: [0.3, 0.5], RETURN: [0.1, 0.2] }
    knobs: { lieRate: 0.3, maxLies: 1, forgeryRate: 0, decoyRate: 0.1, redundancy: 2, salienceFloor: 2,
             dropout: 0, proofCostS: [8, 35], maxTools: 1, maxDocs: 3, vigilance: 0.1 }
  scripted: [ { case: case.thorvald.d3, at: [3, 5] } ]
scenes: { morning: d3_morning, night: d3_night }
letters: [letter.d3.mother]
economy: { wage: 5, docBonus: 1, warnings: 2, fines: [5, 10, 15], costs: { hearth: 6, food: 4, medicine: 10 } }
budget: { words: 1400 }

# content/packs/demo/cases/thorvald-d3.yaml
id: case.thorvald.d3
pack: demo
character: thorvald
truth: { alive: true, cause: none, grip: ownWeapon, woundsFront: 2, woundsBack: 0, nails: trimmed }
look: { ref: look.thorvald }                  # fixed genome, so he is recognizable
testimony:
  - { msg: case.thorvald.d3.l1, says: { fact: name, value: Thorvald } }   # "Thorvald Ketilsson. Again. Is this Valhalla?"
  - { msg: case.thorvald.d3.l2, says: { fact: cause, value: battle } }    # "Axe to the ribs, holding the ford."
lies: [ { field: testimony.2, source: testimony, fact: cause, claimed: battle, truth: none, motive: mistaken, onQuestion: excuse, reveals: [] } ]
cues: [ { fact: alive, obs: breathFog, is: faint } ]
expect: { dest: RETURN, procedures: [], rule: rule.return }
onStamp:
  RETURN: [ { flag: thorvald_returned, inc: 1 } ]
  '*':    [ { flag: thorvald_misfiled, set: true } ]

# content/packs/core/templates/testimony-death.yaml
- id: tm.death.battle.shieldwall
  slot: death
  asserts: { fact: cause, value: $stated }      # the planned statement (truth or lie)
  requires: { stated: battle }
  personas: [braggart, veteran]
  msg: tm.death.battle.shieldwall                # "I held the shield wall at {place} until {foe} split it. And me."
  params: { place: pool.battlefields, foe: pool.foes }
  weight: 3

# content/packs/core/templates/question.yaml
- id: q.cause.battle_vs_sick.confess.braggart
  on: { fact: cause, claimed: battle, truth: [sickness, oldAge], persona: [braggart], kind: confess }
  msgs: [q.cause.braggart.confess.1, q.cause.braggart.confess.2]   # "...Fine. The coughing sickness." / "But I was PLANNING a glorious death. Next spring."
  weight: 2
- { id: q.any.excuse, on: { fact: '*', kind: excuse }, msgs: [q.any.excuse.1], weight: 1 }   # coverage fallback
```

### 5.3 Rulebook rendered from data
- **Order of Judgment:** rules sorted by `order`, with NEW and REPEALED badges.
  - The clerk's summary is **generated from the rule structure** through a phrase table (`phr.cause.is.battle: "fell in battle"`), and it's the authoritative text. Odin's decree is flavor only.
- **Other pages:** Signs = laws. Customs = presumptions plus the trust ladder ("The ravens do not lie. The dead often do."). Heraldry = pattern + emblem + color. Registry. Futhark table.
- **Lints:**
  - Predicates at most 2 levels deep and at most 3 clauses per rule, so the text stays readable.
  - The last rule must match everything.
  - No rule may be fully shadowed (checked by enumerating the relevant fact domains).

### 5.4 Ink integration (per-scene, stateless, pure)
- **One compiled JSON per scene file, per pack.** Nothing about Ink persists across scenes; memory across days lives in engine `flags`.
  - This avoids Ink save-compatibility problems and makes demo saves importable into the full game.
- **Externals** are read-only views of the state at scene start, bound with lookaheadSafe=true.
- **Side effects** come from tags: `# fx: standing freyja +1`, `# fx: flag owes_loki`, `# fx: rings -5`, `# portrait: skogul/annoyed`. The engine applies them **once, at scene end**.
- **Choices** are logged as `{t:'choose', index}`. To render or replay, the engine re-runs the scene from its start, which is cheap for short scenes.
```ts
export function playScene(json: object, knot: string, env: SceneEnv, choices: readonly number[]): SceneFrame {
  const story = new Story(json);
  story.state.storySeed = env.seed;                               // hash(runSeed, day, knot) -> deterministic RANDOM/shuffles
  story.BindExternalFunction('flag', (k: string) => env.flags[k] ?? 0, true);
  story.BindExternalFunction('standing', (f: string) => env.standing[f] ?? 0, true);
  story.BindExternalFunction('rings', () => env.rings, true);
  story.ChoosePathString(knot);
  const lines: SceneLine[] = [], effects: Effect[] = []; let i = 0;
  for (;;) {
    while (story.canContinue) { const text = story.Continue()!, tags = story.currentTags ?? [];
      lines.push({ text, tags }); effects.push(...parseFx(tags)); }
    if (!story.currentChoices.length) return { lines, effects, done: true };
    if (i === choices.length) return { lines, effects, choices: story.currentChoices.map(c => c.text), done: false };
    story.ChooseChoiceIndex(choices[i++]);
  }
}
```
- **Ink lint:** every `EXTERNAL` has a binding, every `fx` tag parses, every knot a DaySpec references exists, and a random-walk test reaches every knot.
- **Localization:** English only at 1.0, authored inline in Ink. Later, translate with one Ink file per language.

---

## 6. UI architecture

### 6.1 Wiring
- `game = signal<GameState>`. `dispatch(a)` runs `step`, sets `game.value`, and pushes events to an animation and audio bus.
- Selectors are `computed(...)`.
- UI-only signals: desk positions (saved per layout), the compare selection, open panels and the loupe.
- The engine runs on the main thread; generating a day takes under 30 ms. Case Lab sweeps run in a Web Worker.

### 6.2 Components
- **app:** App, ScreenRouter (state-driven, no URL routing), Providers (Content, Platform, Settings, Layout, Input, I18n).
- **screens:** Title, ModeSelect, DailyIntro, DailyResult, CampaignMap (replay any day), Morning (DecreeScroll + RulebookDiff + InkScene), Shift, Audit, Night (Family, Shop, Letters), Ending, Settings, Credits, Lab (dev only).
- **shift:** SunClock, QueueStrip, SoulArrival, WritOfPassage (the stamp target), StampRack/StampSheet, ToolTray (Flip, Feather, RuneLens, Clippers, Loupe), CompareBar, QuestionDialog, CitationSlip, ClueLedger (chips).
- **evidence:** BodyStage (HotspotLayer + Loupe), TestimonyScroll, TallyStick, RavenReport (Huginn/Muninn), WeaponCard (Inscription + RuneLens overlay), RegistryBook, ClerkRegister, Rulebook (OrderOfJudgment, Signs, Customs, Heraldry, Futhark).
- **story:** InkScene, LetterView, PortraitView.
- **layout:** Surface, DeskLayout/Paper, DrawerLayout/Tabs/BottomSheet, `useLayoutMode()`.
- **input:** commands.ts, keymap.ts, gamepad.ts, focusGraph.ts, pointer.ts.
- **Also:** a11y, i18n, audio.

### 6.3 Desk vs. Drawer from one tree
Panels are registered once. The layout decides how each one is contained:
```tsx
const SURFACES: SurfaceDef[] = [
  { id: 'body', title: 'ui.body', render: () => <BodyStage/>, desk: { x: .30, y: .06, w: .34 }, drawer: 'stage' },
  { id: 'testimony', title: 'ui.words', render: () => <TestimonyScroll/>, desk: { x: .66, y: .08, w: .28 }, drawer: 'tab' },
  { id: 'tally', title: 'ui.tally', render: () => <TallyStick/>, when: c => c.has('tally'), drawer: 'tab' },
  /* ravens, weapon, registry, rulebook ... */
];
const Layout = useLayoutMode() === 'desk' ? DeskLayout : DrawerLayout;   // <Layout surfaces={visible(SURFACES)} />
```
- **Choosing the mode:** desk if min(w, h) ≥ 600 and w/h ≥ 1.2 (covers the Deck, desktop and landscape tablets). Otherwise drawer. Settings can override.
- **Desk:**
  - Papers drag with pointer capture and a translate3d transform, throttled to animation frames.
  - Clicking brings a paper to the front; papers stay inside the viewport.
  - A "Tidy desk" button and a rulebook dock.
  - Positions are saved. Fonts are sized to stay readable through 1080p stream compression.
- **Drawer (portrait phone):**
  - A top bar with sun, rings and queue.
  - The body stage, about 45% of the height, with a flip toggle and loupe.
  - A row of clue chips.
  - A bottom sheet with tabs: Words / Tally / Ravens / Weapon / Registry / Rules.
  - An action bar: Tools, Compare, Judge.
  - Landscape phones get a side sheet instead.
- **Density limits:**
  - `maxDocs` per case, enforced by the generator.
  - At most 3 taps to any field.
  - Touch targets at least 44 px.
  - Every body sign is also a text chip. That gives accessible text, and it's how Compare works on phones.

### 6.4 Input model
All inputs map to one `Command` union: `focus(dir)`, `activate`, `back`, `flip`, `tool(id)`, `compareToggle`, `question`, `stamp(dest)`, `send`, `open(surface)`, `cycleSurface(±1)`, `zoom(Δ)`, `pause`.
- **Keyboard:**
  - Tab and arrows move focus; Enter/Space activate.
  - F flip, C compare, Q question, 1–7 stamps (once the writ is open), R rulebook.
  - `[` and `]` cycle papers; Esc goes back or pauses.
- **Gamepad** (polled each frame, with edge detection; built after M7 with some changes, §36):
  - A activate, B back, X compare, Y question.
  - LB/RB cycle panels; d-pad or stick moves focus; right stick moves the loupe.
  - Start pauses; View opens the rulebook.
- **Focus graph:** each interactive element registers `useFocusable({id, group, rect})`, and spatial navigation works within a group (groups are panels). Keyboard, gamepad, Deck Verified and screen readers all use the same graph; screen readers also get DOM order plus ARIA.
- **Pointer:**
  - Tapping a hotspot reveals it and opens the loupe.
  - Long-press (350 ms) pins a field for Compare in drawer mode.
  - Pinch or wheel zooms the loupe.
- **Stamping is two-step:** choose a stamp, the writ shows a preview, then Send by holding 300 ms on touch, pressing Enter, or pressing A. Hold-to-send can be turned off.

### 6.5 Art-agnostic body renderer
**The contract**
- **The engine owns:**
  - `AppearanceGenome`: build, skin, hair, hairColor, beard, eyes, nose, scar, helmet, tunic, heraldry.
  - The gameplay signs: grip, wounds front/back with type, nails, pendant, lips, skin signs, colors.
  - Their **perception classes**: salience, zoom, view, occlusion.
- **Art owns:** drawing them, hotspot shapes, and a *conformance* declaration.
- **Swapping art never changes generation or Dailies.** Salience and occlusion are gameplay data, and the art must meet them.
```ts
interface BodyArtProvider {
  id: string; manifest: ArtManifest;
  layers(look: AppearanceGenome, obs: BodyObs, view: 'front'|'back'|'portrait'): LayerDraw[];
}
type LayerDraw = { kind: 'svg'; markup: string; z: number }
               | { kind: 'sprite'; atlas: string; frame: string; palette?: PaletteSwap; z: number; at?: [number, number] };
// manifest.json (both providers): frame {w,h,scaleMode:'integer'|'smooth'}; views.front|back.layers[{slot,z,palette:['skin','hair','lordA','lordB']}];
// anchors {neck:[.5,.23], handR:[.18,.55], lips:[.5,.14], w1..w6:[...]}; hotspots {lips:{poly,zoom:3}, nailsR, pendant, chest, skin, colors, grip};
// conformance {"lips.stitchScars": 1, "skin.feverFlush": 2, ...}   // must be >= the required gameplay salience
```
**Providers**
- **Placeholder:** procedural SVG generated from the genome.
  - Heraldry is pattern (stripes, chevron, checky) + emblem + color.
  - Wounds are shape-coded: slash = blade, dot = arrow, star = crush.
  - Signs get icon badges plus texture (fever = stipple, foam = bubbles).
  - Pendants have distinct silhouettes.
- **Pixel art option:** indexed PNG layers recolored at runtime through a lookup table (OffscreenCanvas, cached as an ImageBitmap per layer and palette), scaled in whole-pixel steps (`image-rendering: pixelated`, letterboxed).
- **Portraits** for the registry and letters use the same provider in `portrait` view.
- **Registry decoys** differ from the real face in 1–2 noticeable traits (a knob).

**Contract tests (CI)**
- Every provider covers every trait × sign × view.
- Every required hotspot ID exists.
- Conformance meets the required salience.
- Occluding variants match the gameplay `occludedBy` data.
- A **Body Lab** page renders the full grid of variants for visual checks.

### 6.6 Accessibility, text and fonts
- **Text scale** from 0.85 to 1.75 (rem-based, layouts reflow).
- **Reduced motion:** follow `prefers-reduced-motion`, plus a settings toggle.
- **Story Mode and Assist:** auto-transliterate runes, highlight hotspots, adjust sun speed.
- **Never color alone:** heraldry, wound glyphs and stamp icons all have text labels.
- **Captions** for audio cues ("Huginn arrives").
- **Screen readers:** a live region for testimony, and labeled hotspots.
- **Deck:** text at least 12 px at 1280×800 (Valve's floor is 9 px).
- **Fonts:**
  - Noto Sans Runic, subset to the Runic block.
  - A UI/body font covering Old Norse letters (á é í ó ú ý æ ǫ ø ð þ ö).
  - A CI glyph check compares every character in each pack's strings against each font's glyph table.
- **Pseudo-localization toggle** (+35% length) to catch overflow and hardcoded strings.

---

## 7. Persistence and replays

**Storage**
- Interface: `SaveStore { list(); read(name); write(name, data) /* atomic */; remove(name) }`.
- **Adapters:**
  - web: IndexedDB via `idb`, plus `navigator.storage.persist()`
  - Electron: IPC to real files (write to a temp file, fsync, rename)
  - Android: Capacitor Filesystem
- **Files:** `settings.json`, `daily.json` (streaks and history), `slot-1..3.sav`, `endless.json`. Keeping them separate reduces Steam Cloud conflicts.

```ts
interface SaveV1 {
  format: 'cots.save'; schema: 1;
  build: { version: string; engineMajor: number; contentHash: string; genVersion: number };
  slot: string; meta: { createdAt: string; updatedAt: string; day: number; playtimeS: number };   // UI metadata only
  run: { seed: string; mode: 'campaign'|'endless'; opts: RunOptions };
  snapshots: { day: number; state: GameState; hash: string }[];      // one per day start (about 10–30 KB each)
  current: { day: number; log: Action[]; queue: CaseSpec[] } | null; // queue MATERIALIZED -> survives generator patches
}
```
- **When saves are written:** after every `send`, at scene end and at night end. Debounced 500 ms; flushed on `pagehide` or app pause.
- **Resuming:** restore the day snapshot and replay `current.log` over the saved queue, for an exact mid-day resume even after an update. If `engineMajor` changed, show "The Norns rewound the day" and restart from the snapshot.
- **Migrations:** a `migrations[v]` chain, with fixtures of every past version in `tests/fixtures/saves/`. Validate on load with `zod/mini`. On failure, keep a `.bak` and offer an export.
- **Save codes:** base64(gzip(JSON)) export/import strings on web builds.
  - They let players move between Pages and itch, which have separate storage.
  - They also cover Safari, which deletes a site's storage after 7 days without use unless it's installed to the home screen.
- **Replay files for bug reports:**
  - Format: `{ format:'cots.replay', build:{version, commit, contentHash, target, genVersion}, start:{snapshot}|{fresh:{seed,mode,opts}}, queue, actions, checkpoints:[{i, hash}], env:{layout, viewport, settings, ua}, breadcrumbs: string[] }`.
  - The state checksum is FNV-1a over canonical JSON (sorted keys), taken every 20 actions.
  - "Report a problem" builds the file and offers copy, share or download.
  - `pnpm replay file --step` checks invariants and finds the first checkpoint that diverges. The Case Lab has a timeline scrubber.

---

## 8. Platform shells

### 8.0 Platform interface
- `Platform { kind; storage; share(text,url); achievements.unlock(id); lifecycle.onPause/onResume/onBack; window.fullscreen?/quit?; links.store; haptics? }`.
- It's resolved **at build time** through the `@platform` alias, so web bundles contain no Electron or Capacitor code.

### 8.1 Electron (Steam), from M6
As built, with the differences from this sketch: §62.

```ts
// apps/electron/src/main.ts (sketch)
if (process.platform === 'linux')             // Steam Linux Runtime / Deck: known-required switches
  for (const s of ['no-sandbox','no-zygote','in-process-gpu','disable-dev-shm-usage']) app.commandLine.appendSwitch(s);
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
app.whenReady().then(() => {
  protocol.handle('app', req => serveDist(req));                  // CSP default-src 'self'; no remote content ever
  const steam = SteamPort.init(APP_ID);                           // steamworks-ffi-node in MAIN only; null if not launched via Steam
  ipcMain.handle('save:list', () => saves.list());
  ipcMain.handle('save:read', (_e, n) => saves.read(n));
  ipcMain.handle('save:write', (_e, n, d) => saves.writeAtomic(n, d));   // name whitelist /^[a-z0-9_-]{1,32}\.(sav|json)$/
  ipcMain.on('steam:unlock', (_e, id) => steam?.unlock(id));
  const win = new BrowserWindow({ webPreferences: { preload, contextIsolation: true, sandbox: true }, backgroundColor: '#15110d' });
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => (openIfAllowlisted(url), { action: 'deny' }));
  win.loadURL('app://game/index.html');
});
app.on('before-quit', () => steam?.shutdown());
```
- **Save folders** (built explicitly to match Auto-Cloud):
  - Windows: `%APPDATA%/ChooserOfTheSlain/saves`.
  - macOS: `~/Library/Application Support/ChooserOfTheSlain/saves`.
  - Linux: `~/.config/ChooserOfTheSlain/saves`. Hardcode `.config`; don't rely on `$XDG_CONFIG_HOME`.
- **Auto-Cloud settings:**
  - Root `WinAppDataRoaming`, subdirectory `ChooserOfTheSlain/saves`, pattern `*.sav;*.json`, all operating systems.
  - Overrides: `MacAppSupport`, and `LinuxHome` + `.config/ChooserOfTheSlain/saves`.
  - Steam syncs at launch and exit and handles conflicts itself.
- **steamworks-ffi-node:**
  - List it in `asarUnpack` (redistributables, koffi binaries, prebuilds), because the app archive breaks it.
  - Never turn on `nodeIntegration`.
  - Its Electron overlay is experimental, so don't depend on it. Achievements still unlock without the overlay; show an in-game toast.
  - Add rich presence ("Day 7 - judging the fallen").
- **Steam Deck:**
  - Ship a native Linux build, with Windows under Proton as a fallback. Test both in M6.
  - Detect the Deck with the Steamworks Utils check and default to fullscreen.
  - Gamepad API plus the focus graph, with Deck/Xbox button glyphs.
  - Desk layout at 1280×800 with text of at least 12 px.
  - Pause on suspend (blur, visibility, `powerMonitor`). No launcher.
  - Aim for Verified. If any function needs touch or the trackpad, the rating drops to "Playable".
- **Packaging:** `electron-builder --dir` for win-unpacked and linux-unpacked. Include `steam_appid.txt` only in dev.
- **Demo:** `electron-demo` is a separate app with its own appId and only the demo packs. Nice to have: the full game imports demo progress from the demo's save folder.
- **CI (`steam.yml`, tag `steam-v*`):** a Windows + Ubuntu matrix builds with electron-builder, then `game-ci/steam-deploy` uploads through SteamPipe to the `beta` branch using the `STEAM_CONFIG_VDF` secret. You promote builds to the default branch by hand.
- **macOS: deferred.** Unsigned or ad-hoc builds are fragile, notarization costs $99/year, and you'd need test hardware.

### 8.2 Capacitor (Google Play, paid), from M9
- **Version:** Capacitor ≥ 8.4. Its template targets SDK 36, which new apps have needed since 2026-08-31, with minSdk 24.
- **Edge-to-edge screens:** use the built-in SystemBars. It injects `--safe-area-inset-*` CSS variables (on API 34 and below too, since 8.4). Write `padding-top: var(--safe-area-inset-top, env(safe-area-inset-top))`.
- **Plugins:**
  - @capacitor/app: back button (close the top drawer or modal, then pause, then confirm exit); `appStateChange`/`pause` pauses the sun.
  - @capacitor/filesystem: `Directory.Data` for saves.
  - @capacitor/share: the native share sheet for the Daily.
  - @capacitor/haptics: the stamp thunk.
  - @capacitor/splash-screen.
- **Backup:** Android Auto Backup (`allowBackup` plus `dataExtractionRules` that include the saves folder) gives free restore across devices, up to 25 MB.
- **Orientation:** both. Drawer on phones, desk on tablets in landscape.
- **WebView check:** at startup, check the Chromium version (105+ is needed for container queries and `:has()`). If it's older, show an "update Android System WebView" screen.
- **Store setup:**
  - Paid app, so you need a payments profile.
  - Declare no ads and no in-app purchases.
  - Data safety: "no data collected" (the Android build has no telemetry).
  - IARC content rating.
  - If your Play account is a personal one created after 2023-11-13, you must run a closed test with at least 12 testers opted in for 14 consecutive days before production access. Recruit testers from the Daily alpha.
- **CI (`android.yml`, tag `android-v*`):** `build:android-full`, then `npx cap sync android`, then Gradle `bundleRelease` (JDK 21, keystore from secrets), then `r0adkll/upload-google-play` to the internal track. Use Play App Signing.
- Capacitor also keeps a paid iOS app possible after launch.

### 8.3 Web demo (PWA) and itch
- **PWA (`web-demo` only):**
  - vite-plugin-pwa with `registerType: 'prompt'`. Show the update prompt only on the Title or Night screens, never mid-shift.
  - Offline cache limited to demo assets; `navigateFallback: index.html`.
  - `scope` and `start_url` equal to `base`.
- **Store buttons:** "Wishlist on Steam" before launch; "Buy on Steam / Google Play" after.
- **Optional opt-in telemetry during the alpha:**
  - A Cloudflare Worker + D1 database (free tier).
  - Per-case records: rule, signs, time, correctness. No personal data.
  - It's the only way to close the gap between "deducible" and "visible".
- **itch (`web-itch`):**
  - `base: './'`, no service worker, zipped.
  - itch's limits: at most 1,000 files, 500 MB extracted, 200 MB per file, 240-character paths, with `index.html` at the root.
  - CI uploads with `butler push dist/web-itch rcjlabs/chooser-of-the-slain:html5 --userversion $V`.
  - The iframe may block `navigator.clipboard`, so fall back to a selected textarea and `execCommand('copy')`.
  - Storage is separate from Pages, so offer save codes.

### 8.4 GitHub, Pages and licensing (public repo)
1. **Decision:** the repo stays public. Anyone can build the full game from source; the demo builds still exclude the campaign.
2. **Branches:**
   - Push `main` (done).
   - In Settings, make `main` the default branch and protect it (require CI).
   - Set Pages source to "GitHub Actions".
   - Check that the `github-pages` environment allows deployments from `main`.
   - Retire the concept branch once it's merged.
3. **`deploy-web.yml`** runs on pushes to `main`: pnpm install, `build:web-demo`, `leak-check`, `upload-pages-artifact`, `deploy-pages`. A custom domain changes the `base` path; set `COTS_BASE`.
4. **License:**
   - Code: GPL-3.0-only (`LICENSE`).
   - Story text, dialogue, art, audio, and the game's name and branding: all rights reserved (`CONTENT-LICENSE.md`).
   - So forks can reuse the code but can't legally ship the campaign or art. Steam and Google Play both accept copyright takedowns.
5. **Secrets (later):** `STEAM_CONFIG_VDF`, `STEAM_USERNAME`, `BUTLER_API_KEY`, `ANDROID_KEYSTORE_B64`/`_PASS`, `PLAY_SA_JSON`. Never commit keys or keystores; the repo is public.

---

## 9. Testing strategy

| Layer | Tool | What it covers | When |
|---|---|---|---|
| Unit | Vitest | 3-valued truth tables; propagation; rune transliteration; RNG/hash checksums; ICU rendering; state transitions; scoring | every commit |
| Property | fast-check (`@fast-check/vitest`) | F1–F8 for every procedural case; determinism; order independence (`generateCase(seed,d,i)` equals the day's case i); snapshot/restore equivalence; economy invariants | PR: 200 seeds × 20 days; nightly: 10k × 20, split across 4 runners |
| Differential | testkit oracle | brute force over the (small) decisive-fact domains must equal the 3-valued solver | PR (small), nightly |
| Adversarial | fast-check | deliberately broken plans (drop the exposing channel, forged tally without a sign, occluded lips, missing cue): the validator must reject everything the oracle calls undetermined or wrong | PR |
| Metamorphic | fast-check | changing only the cosmetic `look` stream keeps the judgment and proof; field order doesn't matter; adding a decoy doesn't change the judgment | PR |
| Golden days | snapshots | 12 fixed seeds × 20 days as summary JSON (archetype, dest, rule, lies, proof, difficulty); **the next 180 days' Daily checksums** must match the `DAILY_GEN` schedule unless its version is bumped | PR |
| Content | compiler lints | the list in §10 | PR |
| Replays | replay CLI | a library of replays in `tests/replays`: exact checkpoint checksums when contentHash matches, otherwise "no crash + invariants hold" | PR |
| Saves | Vitest | fixtures v1..vN migrate, validate and resume | PR |
| E2E | Playwright 1.56.1 | screens: phone 412×915 (touch), small phone 360×740, landscape phone 844×390, tablet, desktop 1920×1080, Deck 1280×800. Flows: a Daily, Day 1, compare/question, Story Mode, 150% text, reduced motion, keyboard only, gamepad (stub `navigator.getGamepads` via `addInitScript`). Plus axe scans, visual snapshots and a 44 px tap-target audit | PR: smoke; nightly: full |
| Build | leak-check, size budget | public targets clean, positive control passes on full builds; web-demo initial JS ≤ 250 KB gzipped | PR |
| Sims | bots | balance report (below) | nightly and on demand |

```ts
test.prop([fc.string({ minLength: 1, maxLength: 12 }), fc.integer({ min: 1, max: 20 })], { numRuns: RUNS })(
  'procedural cases are fair and order-independent', (seed, day) => {
    const d = generateDay(seed, content.day(day), content.baselineState(day));
    for (const c of d.cases.filter(c => c.origin === 'procedural')) {
      expect(validate(c, ctx(day)).ok).toBe(true);
      expect(oracleSolve(c.evidence, ctx(day))).toEqual(c.expect);
      expect(generateCase(seed, day, c.procIndex!)).toEqual(c);
    }
  });
```

**Bot policies**
- **oracle:** knows the truth (sanity check).
- **ideal:** checks everything perceivable.
- **efficient:** follows the minimal proof (a lower bound on time).
- **competent:** a checklist per day; uses tools when cued; misses signs at rates set by salience ({1: 25%, 2: 8%, 3: 1%}).
- **novice:** a shorter checklist and more Questions.
- **trusting:** believes testimony.
- Night strategies: frugal, familyFirst, upgradesFirst.
- Story strategies: pro-Odin, Loki-ally, Freyja-favorite, etc.

**Reports:** accuracy and throughput by policy and day versus sun time; income; family survival; which endings happen. **Every ending must be reachable by at least one policy.** The per-action human time model is calibrated later from alpha telemetry.

---

## 10. Dev tooling

**Case Lab** (`?lab`; exists only in `dev-full`, and the leak check asserts it's absent from public builds)
- Inputs: seed, day, procIndex, archetype and knob overrides.
- Panels:
  - the truth
  - the lies, with their question kinds
  - the evidence, drawn by the real components
  - the solver's trace: fields → laws → beliefs with support → the rule-by-rule three-valued evaluation
  - the minimal proof (highlighted) and the list of contradictions
  - the question templates that matched
  - rejection history (attempt, reason) and the difficulty score
- Buttons: "Play this case", "Permalink", and **"Export as scripted YAML"**, which turns a great procedural case into an authored one.
- Tabs: Sweep (N seeds run in a Worker, with histograms) and Replay viewer.

**Content linter** (`pnpm content:lint`, also run by compile)
- **Structure:**
  - zod schemas, with file:line errors
  - references resolve
  - the pack dependency graph holds
  - `since` ordering (nothing refers to a fact before it exists)
- **Rules:**
  - the rulebook covers every case, and no rule is shadowed
  - limits on predicate depth and clauses
  - laws are consistent: no sign implies contradictory facts
  - every archetype can be generated on each day it's used (≥ 200 draws with acceptance ≥ 30%)
- **Coverage:**
  - channels: every fact a rule reads has at least one hard channel by that rule's `since` day
  - cues for tool-only facts
  - testimony and question templates cover the lie catalog × personas × kinds, with variety targets (≥ 3 per common claim)
- **Text:**
  - i18n keys exist; unused keys are flagged
  - ICU syntax parses
  - string lengths fit their UI slot (a testimony line ≤ 140 chars)
- **Ink:** externals bound, `fx` tags parse, knots exist and are reachable.
- **Assets and fonts:** assets exist per pack; glyph coverage.
- **Budgets and content rules:** word budgets per day; the age domain, the banned-topic list, and only adults dying in the family.

**Day simulator CLI**
- `pnpm sim day --day 9 --seeds 2000 --bots trusting,competent,ideal --report out/day9.md`
- `pnpm sim campaign --seeds 500 --policy frugal,lokiAlly`
- `pnpm sim daily --from 2027-01-01 --days 365 --check-hashes`

**Also**
- **Body Lab:** a grid of every variant, hotspot and palette, with a checklist of how visible each sign is.
- **Scenario jumper:** start on day N with preset rings, standing and flags, to test Ink scenes.
- A pseudo-localization toggle and `pnpm replay`.

---

## 11. Milestones

See the table in `build-plan.md` §12. Engineering exit criteria:

- **M0 Foundations:**
  - pnpm workspace; Biome + the import-boundary check.
  - Engine purity check (no DOM, `Math.random`, `Date`, trig/exp `Math`, `localeCompare`/`Intl`).
  - CI runs typecheck, lint and tests, builds all 6 targets, and runs the leak check with both controls.
  - Hello-world deployed to Pages.
  - Playwright smoke on chromium-1194.
  - LICENSE and the content notice.
- **M1 Fairness engine:**
  - Facts, laws, channels, cues, rules, the three-valued solver, the generator, the F1–F8 validator, the minimal proof, and question responses for Day 1–5 mechanics.
  - A 10k-seed run meets the §3.8 thresholds.
  - Oracle, adversarial and metamorphic tests pass.
  - Case Lab v1 (text only).
- **M2 Playable core loop:**
  - Shift screen in drawer and desk layouts, with the placeholder body art.
  - Hotspots, flip, feather, compare, question, stamp, citation.
  - Sun timer and pause.
  - Daily mode and share text.
  - IndexedDB settings and streaks; keyboard input.
  - 5 outside testers finish a Daily on phone and on desktop.
- **M3 Public Daily alpha:**
  - PWA on Pages plus itch.
  - A 3-case primer.
  - Feedback forms, "Report this soul", opt-in telemetry.
  - A guard that checks Daily checksums don't change.
  - **Pay the Steam Direct fee** (the 30-day wait before release, plus tax and bank checks).
- **M4 Campaign systems:**
  - Full day loop, economy, family, factions, and a shop that only speeds you up.
  - Per-scene Ink and scripted cases.
  - Save slots, snapshots, replay any day, replay files, migrations.
  - Rune-lens and forged tallies; the registry with portraits; nails and clippers.
  - Days 1–6 playable with draft text; an economy bot simulation.
- **M5 Vertical slice:**
  - Days 1–3 at final quality, plus **Day 12 (Loki)** to prove the late game.
  - Two art directions built as providers, judged on:
    - how readable the subtle signs are on a 360 px phone
    - production cost, from the manifest's number of variants
    - how they look on streams and in thumbnails
    - how appealing the store capsule is
  - Then: the decision, a style guide and an asset list; an audio pass; trailer capture; capsule art commissioned.
- **M6 Steam page + Electron:**
  - The store page public by mid-April 2027.
  - electron-full and electron-demo on the Steam beta branch.
  - Auto-Cloud verified on Windows and Linux; achievements.
  - Deck tested with both native and Proton builds.
- **M7 Content production:**
  - Days 4–20 with all mechanics, 8+ endings, Endless.
  - Weekly builds to private testers.
  - Every ending reachable by bots; nightly sweeps pass.
  - At least 5 full external playthroughs.
- **M8 Steam demo + Next Fest:**
  - The demo app live (Days 1–3 + Daily), festival registration, a trailer, and a list of press and streamers.
  - Next Fest rules: one per game, the game must be unreleased, and a demo is required. Make the Steam demo public 2–4 weeks before the fest.
- **M9 Android / Play:**
  - The Capacitor shell, Filesystem saves and Auto Backup, back button and pause, safe-area insets, share, haptics, the WebView check.
  - Tested on a cheap phone.
  - The 12-tester closed test started.
- **M10 Beta:**
  - Bug bash and balance from sims plus telemetry.
  - Accessibility audit and Deck review.
  - IARC and the Steam content survey.
  - A release candidate with zero critical (P0) or major (P1) bugs.
- **M11 Launch:** Steam and Play 1.0, and the web demo's buttons switch to "Buy".

---

## 12. Top risks and mitigations

| Risk | Mitigation |
|---|---|
| **Public repo** (decided) | Anyone can build the full game. GPL code, all-rights-reserved content and a reserved name let you file takedowns against resold copies. |
| **Deducible but not visible** (case fairness) | Perception classes are gameplay data the art must meet; the F6b cue rule; citations show the proof; "Report this soul"; alpha telemetry per rule and sign; weekly Case Lab reviews; a visibility floor per day. |
| **Late-game combinatorics** (high rejection rates, repetitive cases) | Generate by targeting archetypes, with precomputed compatibility tables; CI acceptance thresholds per (day, archetype); a new archetype with every new mechanic; rule-depth and vigilance knobs; variety constraints. |
| **Phone UI density** | Drawer layout, clue chips, field-level compare; `maxDocs` enforced by the generator; 44 px targets; 360×740 and landscape end-to-end tests; a tap-target audit; the Daily alpha as the phone UX test bed from M3; a cheap phone in M9. |
| **Content volume (~50k words)** | Word budgets per day; systemic templates carry most variety; sparse character beats (Thorvald appears about 6 times); write in passes (outline, draft, polish); consider a freelance editor. |
| **Dailies diverging between versions or devices** | Integer-only engine; a `genVersion` schedule keyed by effective date; checksums for the next 180 days; version in the share text; PWA updates only on prompt. |
| **Saves or replays breaking after updates** | Snapshots plus the saved in-progress queue; per-scene Ink; migration fixtures; replays in compatibility mode. |
| **Steam technology** | steamworks-ffi-node behind `SteamPort`; the Linux switches; `asarUnpack`; the overlay treated as optional; Deck tested in M6, not M10. |
| **Play policy and timeline** | SDK 36 via Capacitor 8; a 14-day closed test built into the schedule; edge-to-edge insets; the WebView check. |
| **Real-time timer on mobile** | Pause when hidden, blur while paused, Story Mode, Assist sun speed. |
| **Tone, religion, rating** (target PEGI 12 / ESRB T) | The satire targets bureaucracy, not belief; a sensitivity read of the clerk's storyline; family deaths are adults only (children can fall ill or leave, never die); schema-enforced content rules. |
| **Trademark** | Ship as *Chooser of the Slain*. |
| **Scope** (3 modes × 3 storefronts) | The cut list in build-plan §12; Steam first if needed. |

**Design decisions this spec relies on** (also in build-plan §1)
- Freyja's claim is a daily **whim** over visible facts. The generator aims for about 30–50% of worthy souls.
- A hammer + cross pendant means **prime-signed** (Egils saga), and they stay yours. Only the baptized are TRANSFERred.
- RETURN relies on the presumption "the fallen are dead" plus cues.
- **Rune forgery signs are categorical** (an Elder Futhark rune, a mirrored rune, a broken "X á mik" owner formula). Younger Futhark spelling varies too much for spelling to be fair.
- Upgrades never affect whether a case can be solved.
- The Naglfar plot advances only through explicit choices.
- Days 1–3 of the demo include a Question moment and Thorvald's RETURN.

**Tech decisions**
- Per-pack bundles are the leak boundary; per-day chunks within a pack are fine.
- Keep zod out of the client except `zod/mini` for save validation.
- Use intl-messageformat. Templates are whole sentences with ICU gender `select`, never glued-together fragments.
- The engine bans `localeCompare` and `Intl`.
- Service workers only in `web-demo`; never in itch, Electron or Capacitor builds.

---

## 13. M1 implementation notes (the fairness engine as built)

**Where things live**
- Engine: `packages/engine/src/{logic,gen,narrative}`.
- Content: `content/packs/{core,demo,campaign}`.
- Tests: `packages/*/src/**/*.test.ts` and `tests/golden`.

**Decisions that differ from the sketches above**
- **The engine owns the content types.** They live in `packages/engine/src/content/types.ts`, and the engine imports nothing. `content-schema` parses YAML into exactly those types; its `z.ZodType<EngineType>` annotations turn any drift into a type error.
- **`alive` is its own fact**, presumed false. There is no `cause: none`: a not-quite-dead soul still has `cause: battle`.
- **Two kinds of laws.** *Signs* (`kind: sign`) read an observation, e.g. a fever flush means sickness. *Customs* (`kind: fact`) relate facts, e.g. no wounds anywhere means no battle death. Observations declared `from: { fact }` are read directly, with no law.
- **Facts that don't exist yet are known.** A fact before its `since` day is pinned and known to the solver at level 4 ("world"). On day 1 there are no back wounds, so the front of the body decides; the flip arrives with the rule on day 2.
- **Body evidence is complete.** Every observation active that day is rendered. The planner only decides testimony, raven lines, cues and decoys. So channel "redundancy" became `ravenRate`, and the knobs are `lieRate` (a percent multiplier on archetype lie chances), `maxLies`, `decoyRate`, `ravenRate`, `forgetRate`, `proofCostS`, `maxTools`, `maxDocs` and `salienceFloor`.
- **Archetype `require` predicates** (e.g. Freyja's whim, or its negation) compile into sampling constraints, so targeted destinations don't depend on rejection sampling.
- **Smaller changes:**
  - `teachFirst` names an archetype, not a rule.
  - Each dialogue pool (place, foe, weapon) is drawn once per soul, so all of a soul's lines agree. A mismatch would look like a lie.
  - Names come from a per-day shuffle, so they are unique within a day and each soul stays a pure function of (seed, day, index).
- **Leak tokens** now include every content id a pack owns. Ids and string keys are matched as quoted literals; the canary is matched raw.
- **dependency-cruiser was dropped** (it doesn't support TypeScript 7 yet). `tools/lint-boundaries` enforces engine purity and content imports.

**Known limits**
- A derived fact's trust level is the lowest level among its inputs, which is conservative.
- A statement about a derived fact (Huginn's "watched this one run") narrows that fact but isn't pushed back to its inputs.
- The partial-evidence oracle test only checks that the solver is never *more* certain than brute force.
- In days 1–5 every decisive fact can be seen on the body, so a confession never decides a case. The reveal path is implemented and tested; it starts to matter with identity and registry mechanics (day 6+).
- Day summaries are pinned in `tests/golden/days-1-5.json`; Daily checksums arrived with M2 (§14).

**Tooling**
- `pnpm sim sweep --seeds N [--days 1-5]` prints acceptance, attempts, fallbacks, timing, destination mix and bot scores, and fails on the §3.8 thresholds. CI runs 200 seeds as a test; `nightly.yml` runs 10,000, split by days across four parallel jobs (Days 1–10, 11–15, 16–18, 19–20: about equal work, since later days are heavier), with the Dailies, the campaign bots and the deeper fairness run as jobs of their own. Each range must meet the thresholds by itself, which implies the whole sweep would: a mean, a rate or a p99 that holds in every part holds for the whole.
- `pnpm exec tsx tools/sim/dump.ts <day> <seed> [index]` prints souls with evidence, lies, proof and question answers.
- `pnpm golden:update` rewrites the golden summaries after an intended generator change. Bump `genVersion` too.
- The Case Lab (`pnpm dev`) shows a soul's truth, evidence, solver beliefs and support, rule evaluation, questions and generation log, plus a 100-seed sweep.

## 14. M2 implementation notes (the playable core loop as built)

**Where things live**
- Shift engine: `packages/engine/src/shift/shift.ts` (state machine, scoring, share text, `queueChecksum`).
- The Daily's spec: `content/packs/daily/daily.yaml`, compiled to `generated/<target>/daily.json`.
- UI: `packages/ui/src/store.ts` (time, persistence, session), `screens.tsx` (title, briefing, summary) and `shift/` (the shift screen, keyboard map, evidence text).
- Body art: `packages/art/src/placeholder.ts` (was `packages/art-placeholder/src/body.ts` until M5). Storage and sharing: `packages/platform/src/{storage,share}.ts`.
- Tests: `packages/engine/src/shift/shift.test.ts`, `packages/art/src/contract.test.ts`, `tests/golden/dailies.test.ts`, `tests/e2e/daily.spec.ts`.

**Decisions**
- **The shift is a pure state machine**, `stepShift(state, action, ctx) → {state, events}`.
  - Every action carries `at`, integer ms from the UI's monotonic clock; the engine never reads a clock.
  - Sun time is real time minus pauses plus penalties.
  - Penalties: the first turn-over of each soul 2 s, the feather 10 s, a compare that finds nothing 10 s, a question 20 s.
  - After dusk the soul at the gate can still be judged for 60 s. Then every soul left is recorded as unjudged.
- **The solver referees Compare.** A compare catches a lie only if the solver, run on the fields the player has looked at, shows that pair contradicts (the lie, plus a field in its support). Questioning needs a caught lie.
- **What counts as looking.** The body needs an explicit look: tap a region or its chip. Papers are implicit: showing a paper marks its lines as seen. A citation lists the proof fields the player never looked at.
- **The Daily has its own content bundle.** `dailyContent` is built from the core and daily packs only, so the demo and full builds play the same Daily. `queueChecksum` values for Dailies #1–#180 are pinned in `tests/golden/dailies.json`.
- **Tuning the Daily's mix.**
  - RETURN is 0–2 per Daily, so finding one living soul doesn't tell you the rest are dead.
  - The mix leans towards HEL, which puts the testimony-trusting bot at 59.1% over 10,000 Dailies (the gate is 65%).
- **Preview Dailies.** Before `DAILY_EPOCH`, the title offers an unnumbered "Daily preview · date" (seed `daily:<n>`, n ≤ 0) so testers can play now. Its share text says "Daily preview <date>".
- **Saving a Daily in progress.**
  - The action log is saved after every action (not the state). A reload replays it and resumes paused on the same timeline.
  - The log and the results are mirrored to localStorage, which writes synchronously. An IndexedDB write still in flight is lost when the page unloads, which would let a just-sent soul be judged again. On load the fuller copy wins.
  - A 5 s heartbeat saves the last time the sun was seen running, so a reload or crash refunds at most about 5 s of sun.
  - Leaving the page (hidden, blurred or unloaded) pauses the sun, and the desk is blurred while paused.
  - One ranked attempt per Daily; replays don't count. The streak counts consecutive Dailies played to the end.
- **Strings are ICU MessageFormat.** The UI uses intl-messageformat. The compiler checks every message parses, and requires chip text for every sign value, tool and destination.
- **Storage** is an IndexedDB key-value store with an in-memory fallback. The first finished Daily asks for persistent storage. Electron and Android use the same store until their shells (M6, M9).
- **Body art contract (§6.5), simplified to** `draw(scene) → SVG`, `hotspots(scene)`, `conformance` and `views`. Contract tests check that:
  - every value of every sign draws differently;
  - every sign sits under a hotspot on its view;
  - conformance meets the gameplay salience;
  - hotspots stay inside the frame and don't overlap.
- **Hold-to-send** (300 ms) applies to touch and pen; mouse clicks and Enter send at once. A setting turns it off.

**Deferred and known limits**
- Desk papers sit in a fixed grid. Dragging, "Tidy desk" and saved positions are deferred to the M5 UI pass.
- No gamepad or focus graph yet (M6, with the Deck). Keyboard play uses native focus plus the keymap. (Controller support came after M7: §36.)
- Landscape phones get the drawer, not the side sheet from §6.3.
- Blur-to-pause also fires when a desktop player clicks another window. That's intended.
- A crash or reload refunds up to 5 s of sun (the heartbeat interval).
- The runtime Daily checksum guard arrived in M3 (§15).
- Only the web build's share text carries a link. The itch, Steam and Android builds share text alone.
- Web demo JS is 47.7 KB gzipped (budget 250 KB).

## 15. M3 implementation notes (the public Daily alpha as built)

**Where things live**
- Primer: `content/packs/daily/primer.yaml` (three scripted souls) and `packages/ui/src/shift/coach.ts` (the coach steps).
- Checksum guard: `packages/engine/src/shift/checks.ts`; the compiler writes `generated/<target>/daily-checks.json`.
- Traces: `packages/engine/src/shift/trace.ts` rebuilds what happened to each soul from the action log.
- Reports and feedback: `packages/ui/src/report.ts`, `links.ts`, `.github/ISSUE_TEMPLATE/`.
- Telemetry: `packages/ui/src/telemetry*.ts` (client) and `apps/telemetry` (Cloudflare Worker + D1).
- Deploys: `.github/workflows/deploy-itch.yml`, `deploy-telemetry.yml`. What only the owner can do is in `docs/alpha-launch.md`.

**Decisions**
- **The primer is a scripted day.** `queue.script` fixes each slot's archetype and destination. `lieRate: 200` makes the coward's lie certain. It plays untimed with a fixed seed, so everyone gets the same three souls:
  1. an honest warrior (look, read the rules, stamp);
  2. a coward who claims he never fled (turn over, catch the lie);
  3. a not-quite-dead soul (the mist cue, then the feather).
  - Sea-foam and Freyja's whim are explained in text afterwards.
  - Coach steps end when the player does the thing, or presses Next for reading steps. `data-coach` on the shift root drives the highlight in CSS, so nothing extra lands in the DOM (no marker for the lie).
- **The checksum guard.**
  - Each build ships a table of the checksum every Daily from −120 to 400 should have (8 hex characters each, about 2 KB gzipped), computed once per compile from the Daily content.
  - On starting a Daily, the device computes its own checksum and compares: `ok`, `mismatch` or `unchecked` (outside the table, or another generator version).
  - A mismatch shows a warning with a report button and marks the share text "unverified". The result keeps the guard value. With telemetry on, the mismatch is also sent.
- **"Report this soul"** opens a dialog with the report as text, a copy button and a GitHub issue-form link with the report pre-filled. The form's text fields are filled by their ids; dropdowns and checkboxes can't be. The GitHub mobile app drops the pre-fill, hence the copy button.
  - The report holds the build, mode, seed, day, soul index, the queue checksum, the verdict, this soul's actions (times relative to its first action) and the browser, screen and language.
  - The Case Lab reads a pasted report and jumps to that soul. It can also open the Daily and primer specs.
- **Telemetry is opt-in and off by default.**
  - The question is asked once, after the first finished Daily, and only in builds with `VITE_TELEMETRY_URL`. Without that variable there is no telemetry UI at all.
  - One record per finished shift is sent as a text/plain `fetch` with `keepalive` and no credentials. For each soul it holds the rule, archetype, stamp, sun used, penalties, tools, and the kinds of sign looked at or missed (keys, not values).
  - The Worker validates the record against a strict zod schema (bounded identifiers, enums, no free text), checks the origin, gets a random id per shift and keeps only the date.
  - The Worker's tests validate a record the game's own code builds from a played Daily, and the e2e tests validate the browser's real POST against the same schema.
- **PWA updates** use `registerType: 'prompt'`, and the web adapter registers the worker itself. The update is offered only on the title screen. Builds without the PWA get a no-op `virtual:pwa-register`.
- **Settings are mirrored to localStorage** like Daily progress and results. The mirror wins on load, because it's written synchronously.
- **A telemetry base URL may carry a path.** `new URL('/v1/…', base)` would have dropped it; the e2e test caught this.

**Deferred and known limits**
- The checksum table covers Dailies −120 to 400. Later Dailies report "unchecked" until the range is extended and a build shipped.
- The telemetry Worker has validation and an origin check but no rate limit. Anyone can post well-formed junk from outside a browser. D1's free tier caps writes (about 100k rows a day).
- Players need a GitHub account to file reports and feedback. Otherwise they can copy the report text and paste it into the community channel.
- The primer covers turning over, the feather and one lie. Sea-foam and the whim are text only.
- Web demo JS is 56.9 KB gzipped (budget 250 KB), up from 48 KB. Most of that is the checksum table, the new strings and the new UI; the service-worker update client is about 1 KB.
- Telemetry exists only in the web and itch builds. The Steam and Play builds ignore a telemetry URL even if one is set, which matches Play's "no data collected".

## 16. M4 implementation notes (campaign systems as built)

**Where things live**
- The run: `packages/engine/src/campaign/` (`run.ts` the day loop, economy, family and endings; `save.ts` saves, resume and replaying a day; `state.ts` the run state and the paths endings can read).
- Story: `packages/story` plays compiled Ink; the compiler's `scenes.ts` compiles and lints `scenes/*.ink`. Story souls are `cases/*.yaml`, made by `engine/src/gen/scripted.ts`. What is placeholder writing, and the rules for writing scenes, are in `docs/story-drafts.md`.
- Campaign UI: `packages/ui/src/campaign/` (`run-store.ts` slots, saving and resume; `screens.tsx` slots, morning, audit, night, ending). It loads on first use, with scenes in a chunk of their own.
- Content: `content/packs/demo` (Days 1–3 and their campaign rules) and `content/packs/campaign` (Days 4–8 and 11, the registry, the rune-lens, procedures, tallies).
- Tools: `pnpm sim campaign [--target]` (the economy bots), the testkit's `scenarioSave` (a save on any morning, for tests), and a second e2e preview server for the full build.

**Decisions**
- **The run is pure.** `stepRun(run, action, env)` wraps the shift. Morning scenes, beginning the shift, the shift's own actions, the audit, bills, the shop, night scenes and ending the night are all actions. A save keeps each morning's state, the day's actions and the day's queue, so a resume is exact and any day can be replayed from its morning. A save from another engine version starts its day again ("the Norns rewound the day").
- **Economy and family** (all numbers are per day, in its spec):
  - Wages per soul judged rightly, a bonus when the lie was caught, a few forgiven mistakes, then fines that escalate.
  - Bills: hearth, food for everyone at home, medicine for the sick. An unmet need is a seeded gamble (so replays fall sick the same way), and two nights of the same need in a row always make someone sick.
  - Two nights sick without medicine lose them: adults die; children are sent to relatives.
  - Draupnir drips rings on nights 9 and 18. Two nights below the debt floor is the Demoted ending.
  - Story Mode has no sun and no fines.
- **Standing** with Odin, Freyja, Hel, Loki and the clerk moves by an (expected, stamped) table, and through scenes and story souls. The shop sells speed only.
- **Scenes are stateless Ink.** Each file is compiled on its own. A scene reads the run through six externals and changes it only through `# fx:` tags, applied once when the scene ends.
  - The compiler rejects Ink errors and warnings, unknown externals, malformed effects, effects on choice lines, text outside a choice's brackets (the game echoes the picked option), missing speakers, and scenes no day plays.
  - It walks every choice path in three sample runs.
- **Story souls** are generated from their own truth constraints with a fixed identity and a seed of their own (the same soul in every run), then validated by the same F1–F8 contract. The compiler proves each can be made on every day that places it, under every whim. Stamping one can set flags or move standing at the audit. Thorvald (Day 3) and Geir (Day 6) are the first.
- **Later decrees reuse the fairness engine.** Each needed one general addition:
  - Registry (Day 6): an observation can be read from a document (`doc`), which becomes its own evidence item. The registry lookup is a tool; a namesake's entry always shows different hair; a cue (the broken oath-ring) says when to look.
  - Rune-lens (Day 7): owner's runes and maker's marks are tool readings on the weapon; a borrowed weapon sends a soul to Hel.
  - Procedures (Day 8): a judgment is a destination plus the procedures due. Clipping nails is the first. The solver must see the hands to settle it; a right stamp on unclipped nails is a mistake with its own citation. The key is left out of judgments without procedures, so older cases and Dailies keep their exact shape.
  - Saga tallies (Day 11): tally lines count at trust 3 unless a forgery sign is seen through the rune-lens, which voids the whole tally. A tally is also believed whole or not at all: if its lines can't all be true together (given what's been seen), none of them counts, even with no line refuted outright. The solver narrows line by line and rolls back on any contradiction; the oracle filters the possible worlds by all lines jointly. (A CI counterexample had "never fled" and "fell in battle" on one tally with only the front seen: jointly impossible, yet the old solver trusted both and judged VALHALLA.) A forger's lie is carved, never spoken. F5 requires a visible sign and a cue for every forgery. The trusting bot believes tallies as well as words.
- **Mechanics live in the campaign pack.** New facts sort after the old ones, and new random draws use their own forks, so the Daily and Days 1–5 generate exactly as before (goldens unchanged). A Days 6-on golden now pins the full game's days.
- **Leak check vs shared code.** Campaign ids and string keys must not appear in the UI code every build shares. Tool buttons and chips build their keys from data, and the one pool the UI names (crimes) lives in core.

**Economy simulation** (`pnpm sim campaign --seeds 200`; bots judge at a fixed accuracy and follow a night strategy)

| Judging (accuracy) | Demo, Days 1–3: demoted | Full, Days 1–6: demoted | Full: rings at the end (competent: mean / min) |
|---|---|---|---|
| Expert (97%) | 0% | 0% | — |
| Competent (85%) | 0% | 0% | 126 / 49 (pay all bills) |
| Novice (65%) | 0.5–1.5% | 3.5–14% | — |
| Careless (40%) | 23–34% | 92–98% | — |

The range in each cell spans the three night strategies (pay everything, skip the hearth on odd nights, buy upgrades first). No bot lost a family member, because every strategy pays for medicine; the unit tests cover losing one.

**Deferred and known limits**
- The campaign runs to Day 6. Days 7, 8 and 11 have mechanics and specs (playable in Practice in full builds) but no story. Days 9, 10 and 12–20 are M7.
- All story text is draft (about 1.7k words of Ink plus strings); see `docs/story-drafts.md`. The scene lint walks three sample runs, not every run.
- By Day 6 a competent player has about 126 rings and nothing left to buy. The economy needs more sinks or costs as days are added.
- A scene restarts if the page reloads mid-scene (choices are logged only when it ends); a shift resumes paused where it was.
- Minimal proofs are 1-minimal, not cheapest: with a tool, the proof can keep the tool reading where a raven line would do. Proof costs run a little high on those days.
- A forged tally is always also contradicted by the body, so the rune-lens is a second route rather than the only one. Forgeries that only the lens can catch need facts with no cheap physical sign.
- Web demo JS is 63.6 KB gzipped on first load (the campaign screens and the Ink runtime, 40.8 KB, load when the campaign is opened; the demo's scenes are 2.6 KB).

## 17. M5 implementation notes (the vertical slice as built)

**Where things live**
- Art: `packages/art` (was `art-placeholder`): the contract (`contract.ts`), the shared figure layout and hotspot regions (`layout.ts`), the placeholder, the two candidates (`woodcut.ts`, now the default and in the main bundle; `pixel.ts`, loaded on demand), and the comparison sheet (`sheet.ts`). The UI's art switch is `packages/ui/src/art.ts`; `pnpm art:sheet` writes the trial page; dev-full's title screen has a Body Lab.
- Days 10 and 12: the campaign pack (`faith`, `thorsHammer`, `trickster`, the `amulet` and `lipScars` signs, `rule.transfer`, `rule.detain`, five archetypes, templates, `days/day-10.yaml`, `day-12.yaml`).
- The slice: `campaign.yaml` `slice`; Day 12's scenes and story soul (`scenes/d12.*.ink`, `cases/loki-12.yaml`).
- Sound: `packages/ui/src/audio.ts`. Writing: `docs/voice.md`. Art and store briefs: `docs/art-brief.md`. Next Fest: `docs/next-fest.md`.

**Decisions**
- **The art contract grew.** Each provider draws its own registry portraits. Pixel art declares its grid, and the stage sizes it so each art pixel covers whole device pixels (a ResizeObserver; the frame is letterboxed). Every provider shares one layout, so taps land in the same places and a region's signs are one decision.
- **Choosing art.** `?art=woodcut|pixel|placeholder` picks the art and the device remembers it. Feedback links name it. Art never changes a case.
- **The woodcut was chosen** (September 2026) and is the default. After the choice, its hands were redrawn: open hands with fingers and a thumb, and a fist closed round the grip with the thumb over the index finger. The held weapon now shows from behind too, though `grip` stays a front-view sign (the back view has no hand hotspots). From behind, the fist shows its back (knuckles down the outer side; the fingers and thumb curl out of sight) and the weapon passes behind the forearm: a playtest found the first version, with the weapon over the arm and a fist that looked like its front, read as an arm turned backwards. The weapon leans out 14° from the fist, away from the body, in both views, so it shows past the arm from behind and turning the body doesn't change its angle; the rune-lens reading follows the blade, upright, on the side toward the body so it stays in the frame.
- **The weapon a soul names is the weapon drawn.** Testimony already shares one weapon word per soul; the shift passes it to the art (axe, sword, spear, seax). No generation change, so Dailies and goldens stay put.
- **Day 10:** faith is heathen by presumption. The amulet is the sign: a cross means baptized, a hammer heathen, and both on one cord prime-signed (who stay ours). TRANSFER comes after outlaws. A false convert's claim is caught by his hammer.
- **Day 12:** `trickster` (not `loki`, which is a faction id in shared code and would trip the leak check). Its only sign is stitch scars on the lips (salience 1), so the day's floor drops to 1. DETAIN comes first. Loki's one lie is "just a plain man", and questioning it gets a `deflect`, which reveals nothing.
- **Rules accumulate,** so Day 11 now includes the Day 10 souls; the Days 6-on golden pins Days 10–12 (Days 6–8 unchanged).
- **The slice** is a run flag. After the slice's first day range it jumps to the late day, adding what the skipped days would have brought (the run's own flags win), and the late day's night ends with the slice's finale. It can also start on the late day.
- **Sound** is synthesised (no files). `soundFor()` maps shift events to sounds, so the audio pass replaces only the recipes. Nothing is created at volume 0; audio starts on the first gesture and holds while paused.

**Measured**
- The body on screen: 166×232 CSS px on a 360×740 phone; 216×302 on a 740×360 landscape phone (it was 74×103 before the landscape layout: the body now runs down the left with the tools beside it).
- Every sign reads at phone size in all three styles except the feather, whose "stirs" was weak everywhere; all three now draw air lines beside the head.
- Days 10–12, 500 seeds: every generation gate met, the trusting bot at 57%, DETAIN about one soul a day on Day 12. Fairness properties pass at 800 runs with the new days included.
- Web demo first load 66.3 KB gzip; each art candidate is a 4.6 KB chunk loaded only when chosen. With the woodcut as the default (in the main bundle), the first load is 72.2 KB gzip.

**Known limits**
- The candidates are drawn in code: they show readability and cost, not how commissioned art would look.
- Loki's scars read at a glance in the woodcut, which may make him too easy. The pixel scars show only through the loupe, and on a bearded face they can look like teeth.
- The slice's stand-in for Days 4–11 (rings, standing, `ulf_shipyard`) is a guess. Day 12 has a generated teaching Loki as well as the story Loki. The slice plays only in full builds, which aren't deployed anywhere public.
- Days 7–11 still have no story; the plain campaign still ends after Day 6.
- The brute-force oracle enumerates every world the evidence allows, which is exponential in the free facts. Days 10–12 made the partial-evidence property the slowest check (about 100 ms a run); its budget is now 250 ms a run. M7's days will need the oracle to enumerate only the facts the day's rules, laws and constraints can reach.
- Everything written in M5 is draft (`docs/story-drafts.md`). The sound is a placeholder.

## 18. M7 implementation notes (the full campaign as built)

**Where things live**
- The design and its open questions: `docs/m7-design.md`. Story drafts, flags and which choices reach which ending: `docs/story-drafts.md`.
- Days 9 and 13–20: the campaign pack (`days/`, `rules.yaml`, `laws.yaml`, `facts.yaml` with `liar` and `spearMark`, `world.yaml`, archetypes, Muninn's lines in `templates/ravens.yaml`). Scenes for Days 7–11 and 13–20: `scenes/d{7…20}.*.ink`; Thorvald's Day 16 visit: `cases/thorvald-16.yaml`.
- The fast oracle: `packages/testkit/src/oracle.ts` (the slow reference, for Days ≤ 12: `oracle-reference.ts`).
- Endings state (`sent`, `naglfar`, `ragnarok`, `lead.<faction>`): `packages/engine/src/campaign/state.ts`. Endless: `packages/engine/src/shift/endless.ts` and the UI's `EndlessMode` (`packages/ui/src/store.ts`).
- The story-playing sim: `packages/testkit/src/campaign-sim.ts` (policies), `scenePaths` in `packages/story`, `pnpm sim campaign --story all`.

**Decisions**
- **The oracle stays exact without enumerating everything.** Unary constraints narrow facts first; linked facts form groups (fact laws, derived facts, tally lines, the liar's claims); only the group the rules read is enumerated, and the others need only be satisfiable.
- **Liars (Day 16) are a fact of the truth.** `liar` is never sampled: the generator plans lies before judging and sets it from them. The solver proves it from a caught lie, a seen forgery, or claims that can't all be true together, and otherwise presumes the soul honest. Both oracles prove it only from evidence, never from another presumption (M7.7: a presumed-heathen soul who said he was prime-signed had counted as a liar).
- **Statements about derived facts constrain what they're made of.** A raven's "never fled" now means no wound in the back, as a tally's always did, so the laws reason from it. Fixed with the above after the partial-evidence property found both (three counterexamples, pinned as tests).
- **Observation keys never reuse a campaign fact's id.** The art draws signs by observation key and ships in every build, so `spearMark` the sign leaked a campaign token into the demo; the sign is `spearCut` (like `nails`/`nailsGrown`, `lipScars`/`trickster`).
- **Standing moves only on wrong stamps** (a fix: catch-all rows had matched right ones since M4).
- **Story branches read flags and the family's state,** and letters hold when a family member is gone. Day 17 decides where the family is (ship, ferry, wood or home) and drops the other plans, so the ending matches the player's last choice; taking Loki's deal on Day 18 replaces it.
- **Bots choose by effects, not words.** A policy scores every path through a scene by the flags, standing and rings it changes, so rewriting a scene keeps the bots working.
- **Endless reuses the day specs:** each round is the first five souls of its day's queue, so the day's teaching soul comes first.

**Measured**
- The oracle: Day 12 from 76 ms a soul (1.3 s worst) to 0.16 ms (1.6 ms worst). Fairness properties take about 5 s each at 800 runs.
- Sweep, Days 1–20 × 300 seeds (74,554 souls): mean 1.03 attempts, p99 2, no fallbacks, generation p99 1.8 ms, ideal bot 100%, trusting bot 56.4% (Day 4 alone is 69.8%, above 65%, unchanged since M4).
- Every ending reached by a bot built for it (test in `campaign-sim.test.ts`, with a negative control). Endings by 12 seeds: see `docs/m7-design.md`.
- Economy with the story played: competent players end on about 368 rings, experts about 691; careless players are always demoted.
- Writing: 40 scenes, all draft, about 11,700 words of scenes in the full builds.

**Known limits**
- The economy misses its target: a competent player can still afford the ferry without giving anything up. Squeezing harder demotes most novices (fines sink them, not bills). This needs playtests, not bots.
- Faction endings mostly go to careful players: mistakes cost the god who lost the soul, so a competent player's Odin ends near −16 whatever they choose.
- Host-strength thresholds (260 for Rebirth, 240 for the wolf) are absolute numbers for these queue sizes. The reach test catches drift if the queues change.
- The partial-evidence property runs 150 random seeds per CI run; it took 12,000 more runs to show the fixes held. The nightly's larger runs are the real guard.
- All M7 writing is first draft; the clerk's storyline needs its sensitivity read.

## 19. After M7: what the dead say (audit item 1)

**Where things live**
- Picking lines: `packages/engine/src/gen/render.ts` (`choose`, `deal`, `pinnedWords`); the soul's place in its day reaches it through `dressCase`'s `voice`.
- Content: `spreadLines` in the story days' knobs (demo Days 1–3, campaign Days 4–20), `words` on the campaign's `blade` fact, `chances` in the campaign's `speech.yaml`. New variants are in the campaign pack's templates and strings.
- Tests: `packages/engine/src/gen/voice.test.ts` (tells, weapons, repeats, and that spreading changes only words), `packages/ui/src/dialogue.test.ts` (the fixed strings), compiler lints for `words` and `chances`.

**Decisions**
- **Spreading lines keeps every soul a pure function of (seed, day, index).** A day deals each kind of line (a slot and claim, a raven report, a tally line) into a deck: its variants in a per-day order, each as often as its weight, spaced out (smooth weighted round-robin), cut at a per-day point. Soul *i* says the variant at position *i*. A soul whose persona can't say it takes the variant whose places in the deck are furthest from its own. It only chooses among the same templates, so judgments, proofs, lies and field ids are unchanged (a metamorphic test checks this). Avoiding "the last 20 lines heard", as §3.5 planned, would make each soul depend on the souls before it.
- **The Daily keeps its words.** Its spec has no `spreadLines`, the new variants are in the campaign pack, and the core strings changed only in wording, so its pinned checksums hold. Without the knob, lines are drawn exactly as before (same draws, same order).
- **Facts can fix words.** A fact's `words` (value → pool → word) fixes the word for a soul that has the value or claims it; its lines use it, and the evidence records it (`evidence.words`, only when set) so the art draws it when no line names it.
- **Honest souls vouch for themselves too.** The guise slot is spoken at 15% by honest souls from Day 12, and Loki can wear any persona, so neither the line nor how he talks gives him away.
- **Per-value speaking chances.** Liars always speak their claim; honest souls speak by chance. For claims that liars favour (baptism from Day 10, a true Ulfberht from Day 7) the honest chance is 60%, so the claim alone stops being nearly always a lie. A chance draw is one draw whatever its odds, so nothing else in the plan moves.

**Measured** (16–30 seeds of Days 1–20 in the full build, before → after)
- Lines that repeat one heard earlier that day: 59% → 31% (Day 20: 68% → 43%). The same line as one of the last three souls: 42% → 10%; as the soul just before: 21% → 3%. Variants alone got near repeats to 18%; spreading halved that.
- Day 20's most-used line: 10 times a day on average (14 at worst) → 5 (7 at worst). Muninn forgets about 8 souls a day; his most-used forgetting line went from all 8 (12 at worst) to 2.4 (3 at worst).
- Loki's lines: a lie 100% of the time → 35% (13–46% by line). Highest lie share of any line: 100% → 65% (a baptism claim).
- Contradictions: "my father's axe" with another weapon (27% of those lines), an Ulfberht drawn or named as a non-sword (91% of marked or claimed blades), "seventy winters" at any age, a braggart who died old confessing to a cough, a forger telling both tally stories: all 0. Also reworded: Huginn's "never gave ground" and "dropped the weapon early", which he also said of souls who died in bed or drowned (about a quarter of those reports), and the soul's own "went into the mud".
- Day goldens (12 seeds × 20 days) and the Daily checksums are unchanged.

**Known limits**
- Some claims stay soft tells: a coward's "I did not run" is a lie 63% of the time, because cowards who claim it mostly fled. It's never proof, and the body decides.
- An axe can't be an Ulfberht, so a player who knows that can skip the lens on axe-bearers. That's true to the world; it makes the Ulfberht check a little easier than the validator's proof cost assumes.
- Spreading helps most with lines many souls say. A claim few souls make can still repeat a few souls apart (a deck is only as long as its variants' weights), so the real fix for repetition is still more variants: about 770 new words here, all first draft.
- Honest and veteran souls still have no flavour lines. Adding them would add a line where there was none, which moves field ids in the day goldens, so it's left for a content pass.

## 20. After M7: showing what choices do (audit item 2)

**What changed**
- **The audit's standing adds up.** It had shown today's mistakes under "Today" while story effects moved "In all" unseen. The run now keeps the story's standing since the last audit (`storyStanding`: scenes, story souls' stamps, the slice's jump), and each audit files it in its ledger (`DayLedger.story`) beside the day's mistakes. The table shows Mistakes, Story and Now: the last audit's Now plus both columns is today's.
- **A standing strip** on the morning and night screens, for the powers the player has had dealings with (`factionsMet`: any whose standing has moved on the record, even back to 0). The rest stay out of sight until the story brings them in.
- **Notes after choices.** A scene's frame files what each choice did on the last line before the next choice (or the end); the scene then shows "Hel will remember that (+3)." for each power moved. Ink gives a tag written under a line to the next line, so a line's own tags can't say which choice an effect belongs to; filing by stretch puts the note in one predictable place. The audit adds the same note to a story soul's verdict (`stampEffects`).
- **Aliases.** `aliases` in a campaign's config gives a power another name until a day: Loki is "The stranger" until Day 12, when Skögul names him, in the strip, the table and the notes. Before this, the full game's Day 4 audit already listed "Loki" after the Day 3 stranger scene.

**Tests**
- Engine: the ledger files story standing from last night's scene to this audit, the columns add up over several days, a power that moved back to 0 stays met, story souls' stamps and the slice's jump count as story, and the alias holds until Day 12.
- Story: where effects are filed, including a choice with no text after it.
- e2e (phone and desktop): the Day 1 note and strip, a Day 1 audit row whose columns add up (a mistake −1, a choice +1, now 0), and Day 3's stranger named only as the stranger.

**Known limits**
- A note can come a few lines after the reply it belongs to (on Day 1 it comes after three closing lines), because it waits for the end of the choice's stretch.
- Saves from before this change have no story column for days already audited; their rows show 0 there, so those days don't add up.
- The notes are plain text under the choice. Whether players want them, or would rather discover standing on their own, is a playtest question.

## 21. After M7: the journal (audit item 3)

**What changed**
- **The save keeps a journal.** A save held only today's actions, so a day's scenes, letters and choices were gone the next morning. `RunSave.journal` records each scene played: its day, the choices made, and what the scene could read of the run as it began (rings, flags, standing, the family), since nothing else in the save can rebuild that for an older day. A replayed day drops its entries and the later days'; a scene played again (a day restarted after an engine update) replaces its entry. Under 1 KB a scene (the flags grow as the story goes), so a whole campaign adds about 20 KB to a save.
- **The Journal button** on the morning, night and ending screens opens a page over the screen (a scene half-read underneath keeps its place). It lists the threads still in play, then every day's scenes, newest first, played again read-only with the choices made and the standing notes. Only the days opened are played again.
- **Threads** are content (`threads` in `campaign.yaml`): a text key shown while a run-state condition holds, with an optional count. The campaign has ten: Skögul's loan, Ulf's fine and his shipyard, the stranger's deal, the ferry, knowing of the wood, the family's plan (the wood or home), the clerk's contract, and how much you've heard of the after.
- **Options you can't afford stay in sight.** A `needs: rings N` tag inside an option's brackets shows the option greyed out with what it needs, instead of an Ink condition hiding it. The seven rings-gated options (the roof, Ulf's fine, Skögul's loan, the healer, the ferry twice, the clerk's fee) now use it; story gates stay hidden. The runner won't take a locked option; bots and the compiler's walks skip them, and a point where every option is locked fails the build.

**Tests**
- Engine: every scene played is kept with its choices and the run as it began; a replay drops the discarded days and a replayed scene replaces its entry; threads follow their conditions and counts.
- Story: locked options are shown with their cost, can't be taken, aren't walked, and a point with only locked options fails; the env a journal entry gives equals the one the scene had.
- Compiler: a `needs` tag outside an option's brackets, or malformed, is rejected.
- e2e: the journal after a day and after a reload (phone and desktop), a locked option on Day 2's night with an emptied purse, and the thread list in the full build.

**Known limits**
- Saves from before the journal have no entries for the days already played.
- Ink's word count reads a `needs` tag as words, so each adds about three to the scene word totals.
- The threads name what's in play, not whether it will work: the ferry thread doesn't say whether you'll have the hundred rings. That's item 5's planning, not the journal's.

## 22. After M7: the Ragnarök report, the endings gallery, branching replays (audit item 4)

**What changed**
- **The ending screen reports how the run stood.** (Since §54 the endings read the last battle instead, and the report shows it in place of the host.) The host at Ragnarök part by part (worthy einherjar twice over, the unworthy against, Freyja's host and Hel's legion twice over, Naglfar's nails against), adding up to the host; what the endings ask of it (read from their conditions by `hostMarks`, so the 260 and 240 come from `campaign.yaml`, not the UI); each power's standing at the end, with whoever was ahead of the rest; and where the souls went. The host section only appears in builds whose endings read the host (not the demo).
- **Endings are kept per device.** Reaching an ending adds it to the device's settings (`endingsSeen`, any slot, any run; a slot that ended before this counts when it's opened). The slots screen lists the endings this build can reach (`reachableEndings`: those with a condition, and the finale), naming the ones found (their text behind a click) and not the rest. The report names an ending only once it's been found here: "An ending you haven't found: a host of 260 or more."
- **A replay can branch.** Each slot offers "Replay here" (as before: the day starts again and the later days are forgotten) and "Replay in a new slot", which copies the save up to that morning into the first empty slot and leaves the original as it was. With every slot full the button is off, and the note says to empty one.

**Tests**
- Engine: the host's parts add up to its strength; the reachable endings of the demo (3) and the full game (11); the marks (the green earth at 260 or more, the wolf at 240 or less; none in the demo). The campaign sim's reach test now uses the same list.
- e2e: the demo's ending reports standing and souls, counts 1 of 3, and the gallery names it alone; a replay in a new slot keeps the original at Day 2; in the full game, a quick Demoted ending shows the host and names neither unfound ending.

**Known limits**
- The marks give the host's part of an ending's condition only. The green earth asks for more (the wood, what you've learned, someone at home), which the report doesn't list, so as not to spell out endings not yet found.
- Endings found are kept per device and browser, with the settings; a new browser starts the gallery again.
- Replaying in a new slot needs an empty slot; there are three.

## 23. After M7: planning the night (audit item 5)

**What changed**
- **The night screen says what the bills as set will do.** The engine works out tonight (`nightOutlook`) with the same code the night itself runs, so the screen and the night can't disagree; only who falls sick by chance is left open, and the screen gives the odds instead.
  - The family list says how soon each sick person needs medicine ("needs medicine tonight", "within 2 nights").
  - Under the bills, one line for each consequence: who dies or is sent to relatives without medicine tonight, who stays sick and how many more nights they can go without it, who falls sick for certain after another cold or hungry night, and the chance for anyone else well ("30% each").
  - "After tonight" now counts Draupnir's rings on his nights (it used to leave them out, so on nights 9 and 18 it was 8 rings short), and the screen says when he drips.
- **Tonight's bills are in sight before the choices that cost rings.** An option with a `needs: rings` tag has the purse and tonight's bills (all paid) above it, and at night what it would leave after them, counting its own effects (the healer who cures Asa means no medicine to buy for her). The morning briefing gives tonight's bills too.
- **The nights ahead.** The bills card lists the next three nights' firewood and food (for those at home now) and medicine a head, marking Draupnir's nights (`billForecast`, which follows the vertical slice's jump and stops at the run's last day).
- **The debt that ends a run looks like it.** After a night below the floor, the morning and night screens carry a banner saying how many more end the run (the number read from the demoted ending's condition, `debtLimit`). When the bills as set would end the run, by the debt or with no one left at home, the bills card says so and Sleep asks first.
- Family members can have a short name for use in sentences, an optional `<name key>.short` string ("Ragna" beside "Ragna, your mother"); the night's news uses it too.

**Tests**
- Engine: a property test that the outlook matches the night itself on 150 random nights (purse, debt, every certain change, and chance only ever making someone well sick); who is lost, who surely falls sick and the odds; Draupnir and the debt that ends the run; no one left at home; the forecast in the full game, the demo and the slice.
- UI strings: every branch of the new messages.
- e2e: the night's consequences and the nights ahead, and the news the next morning; the purse and what an option leaves at Day 2's night; the debt banner, warning and the sleep that asks first, on the way to Demoted.

**Known limits**
- The preview of an option counts its effects up to the next choice in the scene, not what later choices would add.
- The forecast assumes the family stays as it is tonight: food for everyone at home now, medicine a head for whoever falls sick.
- Chance is shown as a percentage, not hidden. The design reason to keep it (skipping a bill is a gamble) still holds; the player just knows the odds.

## 24. After M7: assists (audit item 6)

**What changed**
- **Sun speed**: ×0.5, ×0.75, ×1, ×1.5 or ×2, as the plan had it. A slower sun is the same shift with more of it: the sun's length is divided by the speed, and tool costs and penalties stay as they are, so in effect everything runs at the chosen speed. Shifts with no sun (Story Mode, practice without sun, Endless, the primer) ignore it.
- **The rule tracker**: the rulebook greys out, and marks "ruled out", the rules that what the player has seen of the soul already rules out. It asks the solver for only what can't be wrong (`certainOnly`): no presumptions, and no saga tally believed, since it may be forged with the sign not yet seen; body signs, the ravens, tool readings, confessions and caught lies count. So it never greys out the rule that applies, which a property test checks on Days 1–20 with random parts of each soul seen and asked. With everything seen it rules out about 6.3 rules a soul (120 queues, Days 1–20), where on average 4.6 rules come before the one that applies.
- **No fines** in the campaign: citations still come but cost nothing, and the audit counts every mistake forgiven. Story Mode keeps its own no-sun, no-fines rule, and shows only the tracker.
- **Where they're set and kept**: device settings, in the title screen's settings and on each campaign morning. A shift takes them up with its `begin` action (the campaign's `beginShift`) and keeps them in its config, so a resumed Daily, a resumed campaign day and a bug report's replay all use the assists the shift began with, whatever the settings say now. The day's ledger keeps them too, and the audit says which were on.
- **Results say so**: a Daily played with another sun speed or the tracker adds them to its share text ("· sun ×0.5, rule tracker") and shows "Played with …" under its result on the title screen.
- **Telemetry**: shifts played with an assist aren't sent. The worker's schema is strict and has no field for assists, so it would refuse them; sending them means adding the field to the worker and deploying it first.

**Measured** (campaign sim, 40 runs per policy, plain story; `pnpm sim campaign` and `pnpm sim campaign --no-fines`)

| Bot | Night strategy | Demoted | Demoted with no fines |
|---|---|---|---|
| novice (65% right) | pays everything | 97.5% | 0% |
| novice | frugal | 42.5% | 0% |
| novice | upgrades first | 100% | 37.5% |
| careless (40%) | pays everything | 100% | 100% |
| competent (85%) | any | 0% | 0% |

Fines are what sink a novice. In a scratch run of 30 seeds, cutting every bill by a quarter instead (fines kept) still left 19 of 30 novices demoted, and at 80% accuracy none were. Novices who get through without fines mostly come to the wolf's ending: their mistakes leave the host at 240 or less. The sim can't measure the sun speed or the tracker, because its bots have an accuracy, not a clock; whether those lift real players' accuracy is for playtests.

**Tests**
- Engine: the sun speed from the `begin` action (only the speeds on offer) and dusk at the slower sun's end; the share text's notes; the tracker on a Day 1 soul (nothing ruled out before looking, the weapon rule once the empty hand is seen); the tracker's property test; fines waived and the day's ledger keeping the assists; a campaign day resumed mid-shift keeping its assists.
- e2e: the Daily with the sun at ×0.5 and the tracker (12:00 of sun, the rules the body rules out greyed and the one that applies not, the share text, the note under the result); a campaign day at ×2 with no fines (3:00 of sun, every mistake forgiven, the audit's note).

**Known limits**
- Assists apply from the next shift; changing one mid-shift does nothing to that shift.
- The tracker only greys rules out. It never says which rule applies, and it reads nothing from testimony or a tally, so it rules out less than a player who reads an honest tally rightly.
- Endless keeps one best score, with or without the tracker.

## 25. After M7: a lesson for each new mechanic (audit item 7)

**What changed**
- **The coach teaches every day that brings something new**, not just the primer. Each such day already puts a teaching soul first (`queue.teachFirst`); its spec now has a `lesson`, a few coach steps for that soul: Days 1–8 and 10–17 (Day 9 brings nothing new). The lessons are content, in each pack's day files with their text in the pack's strings, so the campaign's never reach a demo build.
- **A step** names what to highlight (`focus`) and what ends it (`until`): a field looked at (by id, or `whim:<param>` for the sign the day's whim reads, worked out on the day), a tool used, the body turned over, or a lie caught; or it's a reading step ended by Next. The last step lasts until the soul is judged. Steps a soul can't give are left out: on Day 2, "catch the lie" only shows when the fled soul lies (35 of 40 teaching souls).
- **Who is taught**: campaign and practice shifts, on the day's first soul, when it is the teaching soul. A lesson is taught once per device: judging its soul, or skipping it, records the day (`coached` in the settings). Days 1–3 are skipped for anyone who has played the primer, which teaches the same. A setting turns the lessons off.
- **The primer's steps now use the same form**, so one coach runs both.
- **New highlights**: hair, neck, the registry, the rune-lens, the clippers, the ravens, the tally and Compare.
- **The compiler checks** each lesson: a teaching soul to ride on, known highlights, strings that exist, tools taught by that day, a whim param the day has, and a last step that waits for the stamp.

**Tests**
- Unit: every lesson can be followed to its stamp on 25 generated teaching souls a day, by a player who does only what each step asks; lessons show once, not after the primer for Days 1–3, and not when turned off; the primer's steps are as they were.
- e2e: Day 6's lesson in practice (the registry highlighted, then the stamp), gone for the next soul and the next practice; skipping Day 8's; the setting off for Day 7; Day 1's lesson in a new campaign.

**Known limits**
- The sun keeps running during a lesson. Most steps ask for what the soul needs anyway; the reading steps cost a few seconds.
- The lesson texts are first drafts for the writing pass.
- A lesson rides on the day's first soul only. A player who fumbles it gets no second lesson that day, though replaying the day doesn't bring it back either (it's recorded once the soul is judged).

## 26. After M7: Skögul's hint (audit item 8)

**What changed**
- **A Hint button (and H)** asks Skögul where to look, for 15 seconds of sun (`hint` in the core pack's `sun.yaml` since §63; a question costs 20). The engine's `hint` action points at the first piece of the soul's deciding evidence (its minimal proof, `meta.proof`) that the player hasn't looked at and she hasn't already pointed at, and keeps what she pointed at in the soul's state, so replays and resumes are exact.
- **She says where, not what**: "Skögul points at the hands", "taps the registry", "hands you the rune-lens", "looks up at the ravens". What she pointed at stays highlighted (the coach's highlights) until the player has looked, with the flip highlighted too when it's on the other side of the body.
- **Nothing left to show**: once everything that decides the soul has been seen, the button is off and says so, and asking costs nothing. Following her hints to the end always shows enough to decide the soul, given the answers of a liar who confesses when questioned (a property test on Days 1–20).
- Not offered in Endless (a score with no sun) or the primer (the coach leads it). Shifts without a sun (Story Mode, practice without sun) get hints for free.
- The rulebook's costs line and the keys line mention it.

**Tests**
- Engine: the first hint points at the first unseen proof field, for 15 s; the next at the next; nothing to point at (and no cost) once the proof has been seen; the property test above.
- UI: every proof field on Days 1–20 has a line and a highlight the coach knows.
- e2e: in the Daily, a hint costs 15 s of sun, names a place and highlights it, and a careful player's look at everything leaves the button off with its reason.

**Known limits**
- A hint isn't counted anywhere: the Daily's share text, the audit and the endings don't know it was used. It costs sun instead, like a question.
- She points in the proof's order, not at what's quickest to check next.
- When a soul can only be decided by a liar's confession, she never says to question them: she only points at evidence.

## 27. After M7: more reasons to replay Endless and the Daily (audit item 9)

**What changed**
- **Today's Endless.** The Endless card offers today's run, numbered like the Daily (`Endless #91` on 2027-03-01, a dated preview before `DAILY_EPOCH`) and the same for everyone (`endlessSeed(n)`), and a free run with a seed of its own (the old Endless). Today's counts once: its result is kept on the device (`endlessToday` in the settings) and stays on the card with its share text, and today's run can't be begun again.
- **Share text** says how many souls, how far and on which day's rules, and whether the rule tracker was on; never where anyone went. `Chooser of the Slain · Endless #91 (g1)` / `23 souls judged rightly · round 9, Day 9's rules`. A free run shares as `Endless · free run`.
- **A run survives a reload.** It is saved after every action, as the Daily's progress is (IndexedDB plus a synchronous localStorage mirror): the run as its round began, the round's actions, and the score as it stands. Resuming rebuilds the round, replays the actions and leaves it paused on the soul it was left on. After an update that changes the generator, the round starts again from its first soul; the rounds before it keep their score. Starting another run ends a saved one where it stands (and records it, if it was a day's run); while today's is under way, the card offers only Resume.
- **Twists.** A round that brings nothing new takes a twist: a day with no teaching soul (Days 9 and 18–20) and every round after the last day; in the demo, every round after Day 3. A twist is its own decree plus different knobs or a different destination mix for the day's souls, never different rules; with nothing new to teach, the day's teaching soul no longer comes first. Twists are content (`endless.yaml` in the demo and campaign packs, each `since` the first day whose mechanics it needs), drawn per round from the run's seed (`endlessTwist`); `endlessContext` gives the round's day context with the twist in it, so the briefing and the rulebook show the twist's decree. Demo: liars, the straw-dead, a battle's worth of the fallen, mist (more decoy cues). Campaign: Freyja's day, a sea battle, the forgers, Loki's friends, Muninn forgetting. The full game draws from both lists.
- **Past Dailies.** The Daily card has a fold listing every earlier Daily, newest first, with this device's result if it was played here. One plays from this build's generator for its own sake: never recorded, streak untouched, and marked "from the archive" in the briefing and `(archive)` in the share text. `dailyDate(n)` dates them (the inverse of the Daily's numbering).

**Tests**
- Engine: which rounds twist (full: 9 and 18–20 and every round after 20; demo: from round 4); a twisted round keeps its day's rules and reads its twist's decree, and doesn't open on the teaching soul; every twist makes a full round on every day it can come to; the liars twist makes more lies than the day it twists; the share text, with and without the tracker; `dailyDate` against the Daily numbering (and a property test that it undoes `daysFromCivil`).
- Compiler: twist lints (a duplicate id, a missing decree string, `since` after the build's last day, a mix asking for souls no rule sends anywhere by then, an empty range).
- e2e: today's Endless resumed after a reload with its strike, recorded once, its share text kept on the title card after another reload, then a free run saved; the demo's round 4 twist (its decree, the score carried over); a Daily from the archive played to the end leaves today's Daily and the streak alone.

**Known limits**
- Nothing stops a player from clearing site data and playing today's Endless again. As with the Daily there's no server; it's an honor system.
- An archive Daily is regenerated by the current generator, so after a generator change it can differ from what players got that day (the share text's `(gN)` says which).
- A twist changes knobs and the mix, not rules, so late twists change the flavor more than the difficulty. Measured on the days Endless twists (full game: Days 9 and 18–20, 40 seeds each; demo: Day 3), first five souls: no fallbacks, about 1.03 attempts a soul; the mix twists move the souls as meant (the straw-dead: HEL 33% to 52%; the battle: Valhalla 17% to 45%; Freyja: Fólkvangr 8% to 24%; the sea: Rán 12% to 29%; Loki: DETAIN 8% to 21%). The liars twist doubles each soul's chance to lie, but most late souls already lie when they can (one lie at most), so it adds 11% more lies in the full game and 40% in the demo. The other knob twists (mist, forgers, Muninn) change the evidence, not where anyone goes. The twist texts are first drafts.
- Only the latest day's Endless result is kept (plus the best score): no history or streak.
- Endless still sends no telemetry. Archive plays are sent like a replayed Daily (both are marked only by the Daily number), so alpha numbers per Daily can include players who already knew the souls.
- A soul report from a twisted round carries the round's seed (`<run seed>|endless|<round>`), but rebuilding that soul needs `endlessContext`: the Case Lab's seed-and-day input gives the untwisted day.

## 28. After M7: save safety (audit item 10)

**What changed**
- **Backups.** Settings has a Saves section. Back up gives a file to download, and the same text to copy where downloads are blocked (some itch.io frames). It holds everything worth keeping: the campaign slots, Daily results, the Endless best and the latest day's result, endings found, lessons taken, and any unfinished Daily or Endless run. Restore reads a file or pasted text. `packages/ui/src/save-data.ts` has the format and the merge rules (pure, tested); `saves.ts` the storage.
- **Restoring merges; it never writes over anything newer.** Daily results this device lacks are added; one it has stays. A campaign goes into its own slot if that's free, else the first free one; if the same run (same seed) is already here, whichever copy was saved later wins; with no free slot it's reported and skipped. Records merge: the higher Endless best, every ending and lesson from both, the later day's Endless result. This device keeps its own settings (layout, text size, sound, assists and, above all, its telemetry answer). An unfinished run comes along only where there's none here, and a Daily only if it's today's, on the same generator, and not yet played here. Text that isn't a backup, or a backup from a newer version, is refused with a reason.
- **Unreadable saves are kept, not taken for empty.** A slot whose copies (IndexedDB and localStorage) can't be read, because they're damaged or written by a newer version, used to show as empty, so a New campaign would have written over it. Now it's shown as unreadable, with Save a copy (the data as found, for a bug report) and Clear this slot (confirmed). Nothing writes over it until then, and branching skips it. A save that reads but won't open (the engine rejects it: a day this build doesn't have, say) is marked the same way when opened. The slot check now also covers what the slot list reads of each morning, so a save broken inside can't break the list. Settings and a Daily record this build can't read are set aside under `<key>.unread` before anything writes over them, and backups carry them.
- **Asking the browser to keep the saves.** A browser may clear a site's data (Safari after 7 days unused unless the game is on the Home Screen; others under storage pressure) unless it grants persistent storage. The game now asks (`navigator.storage.persist()`) once a session when a campaign is saved, as it did after a ranked Daily and now also after a day's Endless run. The Saves section says whether the browser has agreed, may clear the saves, or keeps them only for the tab (a private window); the campaign's slot list suggests a backup when saves may not be kept.

**Tests**
- Unit (`save-data.test.ts`): reading (not JSON, not a backup, a newer version); Daily results added and never replaced, bad ones skipped; this device's settings kept, only the records in them merged; where a campaign goes (its own slot, the first free one, none free); the later copy of the same run wins, with a revision past this device's so it's the copy loaded next time; unreadable slots never written over; unplayable and damaged campaigns in a backup skipped; unfinished runs taken on only where allowed; a whole device restored onto an empty one.
- e2e (`saves.spec.ts`): a backup (the text, and the downloaded file) restored into a fresh browser brings the Daily results, the streak, the Endless best and the campaign, but not the text size, and restoring it again changes nothing; text that isn't a backup, or is a newer one, is refused; a damaged slot and one that won't open show as unreadable, survive a reload, can be copied, and are cleared only when asked; the persistence request once a campaign is saved, and the status line before and after.

**Known limits**
- Nothing is automatic: the player has to make a backup. Each browser grants persistent storage by its own rules (Chrome by engagement or installation, Firefox asks the player, Safari decides for itself), so asking guarantees nothing.
- The Steam and Play shells get their own file stores later (M6, M9). There, a blob download may do nothing (Android's WebView doesn't handle them), so copying the text is the way until those shells add a native save dialog.
- A backup is plain JSON and easy to edit; a restored Daily result is taken at its word, like everything else on the device (there's no server).
- The demo refuses a full game's campaign save that has days it doesn't have; the other way round works.
- Three late campaigns make a backup of a few hundred KB (a Day 20 save is about 135 KB): fine as a file, heavy to paste on a phone.
- Only campaign slots, settings and the Daily record are protected from being written over when unreadable. Unreadable unfinished Daily or Endless progress is ignored, as before.

## 29. After M7: small fixes from the audit

**What changed**
- **Leaving a shift.** The pause screen of a practice, primer, Daily or Endless shift now has Leave (a campaign day keeps its Save and quit). A line under it says what leaving does: a practice shift ends; the primer can be taken again from the title screen; today's Daily and an Endless run wait on the title screen, paused where they were left (both are already saved after every action); a replayed Daily isn't kept.
- **Costs after upgrades.** The Question button and the rulebook's costs (each tool, and a question) show what they cost in this shift, after the campaign's upgrades (`toolCost`, `questionCostMs`). They used to show the base price (a question always said 20 s).
- **The keys line** counts the stamps the build has (`1-5 stamps` in the demo, `1-7` in the full game) and names G, the registry, where the build has one.
- **A rule's wording by day.** A rule can take new wording from a given day (`texts: [{ since, text }]` in the rulebook; `ruleText(rule, day)`), so the rulebook, citations and the morning's list of changes show the wording in force that day. The Valhalla rule no longer says "(from day 2)": on Day 1 it says "fell in battle, weapon in hand", and from Day 2, when turning the body over is taught, it adds "and never fled". Day 2's morning lists it as Changed. (What the rule asks already changed that day, through `pred.worthy`'s versions; only the words lagged.) The compiler checks that each later wording's string exists and that the days go up.
- **The story's names are kept for the story.** The demo and campaign packs reserve names in `names.reserved.*` pools: the family's (Ragna, Ulf, Asa) and the story's (Thorvald, Geir, Hrafn). No generated soul is given one, or has a father of that name. Before, over 40 runs of 20 days, a run met about 7.5 generated Ulfs, 3 Asas and 8.5 Hrafns, and 48% of Day 12s had a generated Hrafn in the same queue as the story's (Loki, wearing a dead hero's face that day; the audit counted 31% with its own seeds). After: none.
- **Fewer look-alikes.** Days that spread their looks (`spreadLooks`, set on every demo and campaign day, never the Daily) give each soul its name, and its build, beard and clothing colour, by its place among the day's souls of its gender. Each name and each combination is used once before any is used twice. The clothing colour is now part of the look (`look.tunic`, which the art styles use, else the old hash of the name). Over the same 40 runs, pairs of souls in a day with the same gender, build, beard, hair and clothing went from 1.27 on Day 20 (5.25 when clothing is ignored) to none on any day; the same name twice in a day went from 5 cases to none.
- **A font for runes.** A forgery sign quotes the rune ᛗ, and a system without a runic font shows a blank box. The game now ships Noto Sans Runic (SIL Open Font License 1.1; the runic block only, 6.6 KB) first in its font list, for U+16A0–16F8 only, so the browser fetches it only when a rune is on screen.
- (The forged tally's confession giving two contradictory reasons was fixed with audit item 1.)

**The Daily is unchanged.** Its spec spreads nothing, and the reserved pools are in the demo and campaign packs while the Daily is built from the core and daily packs only; its pinned checksums hold. Golden summaries for Days 1–20 changed in names only.

**Tests**
- Engine: a property test on Days 1–20 (12 random seeds a run): no reserved name given or used as a father; each gender's names, and its build-beard-clothing combinations, are all different until there are more souls of that gender than names or combinations. The Daily's spec and pools are left alone. `ruleText` picks the latest wording by the day.
- Compiler: a later wording with a missing string, or out of day order, is refused.
- e2e: leaving a paused practice shift, Daily (resumed on the same soul) and Endless run (kept with its score); the keys line in both builds; on the campaign's Day 2 the Valhalla rule is listed as Changed, and after the horn of mead the rulebook at the gate says a question costs 15 s; on Day 11 the rune in a forgery sign is drawn with the bundled font, read from Chromium's record of the fonts that drew it. Without the fix, a system font drew it (FreeMono, on this machine).

**Known limits**
- The pools run out on the busiest days. There are 22 men's and 19 women's names to go round, and 48 looks for men but only 12 for women (three builds, four colours). Over 2,000 runs, 2 Day 20s had more than 22 men and repeated a name, and 1 had 13 women and repeated a look: about 1 run in 700. More names in the demo and campaign pools, and more women's looks in the art, would remove it.
- Souls of the same gender, build, beard and hair still meet on busy days (2.0 pairs on Day 20): their clothing tells them apart. At a glance, the woodcut's clothing colour is the smallest of those differences.
- The Daily keeps its old names and looks, as changing them would change the live Daily. With 8 souls, repeats there are rare.
- The runic font isn't in the web demo's offline cache: the demo shows no runes. Other scripts outside the fonts players have would still show blank boxes; the game uses none.
- What a player sees in the Leave note is a first draft, like the other new texts.

## 30. After M7: screens open at the top

**What changed**
- **Every screen opens at its top.** Nothing reset the scroll when the screen changed, and a scene gave the keyboard's focus to its first option, at the bottom, with a plain `focus()`, which scrolls the page to it. Measured on the phone before the fix, each screen opened at the very bottom: Day 1's morning at 341 of 341 px, the night at 302 of 302, the night's bills after its scene at 146 of 146, and Day 2's morning at 128 of 128. Now `App` scrolls to the top whenever `screen` changes, and so does each part of a screen: a scene when it starts, and whatever follows it (the day's orders, the night's bills, or the next scene).
- **Focus never scrolls the page.** `useAutoFocus` and the scene give focus with `preventScroll`, so the keyboard still starts on the same button while the page stays at its top.
- **A choice in a scene** brings the lines it adds (the chosen line, then what follows) to the top of the view, with a little room above (`scroll-margin-top`), or as near as the page's end allows. The next option takes the focus. Before, the page stayed pinned to its end.
- **A reload** opens at the top (`history.scrollRestoration = 'manual'`). The browser used to put the page back where it had been scrolled, though the screen it reopens may be a different one.
- **The phone's evidence tabs** each open at their top (the panel is keyed by tab). Before, a tab opened where the last one had been scrolled to.
- The helpers are in `packages/ui/src/scroll.ts` (`toTop`, `toTopOf`).

**Tests**
- e2e (`scroll.spec.ts`, phone and desktop). Each of these opens at the top after the last screen was scrolled to its end: the campaign's slots, Day 1's morning scene, its orders, the audit, the night, its bills, and Day 2's morning. After each scene choice, the first new line is at the top of the view (or the page is at its end) and the next option has the focus. Also covered: the title's way into a practice shift and back, a reload, and the phone's tabs. Without the fix, 6 of the 7 fail; the desktop briefing fits on its screen either way.

**Known limits**
- The page jumps at once, with no animation.
- Overlays (the journal, citations, dialogs) open over the page, which stays where it was underneath, as before.
- On a small phone, a screen's first button can now start below the fold. It still has the keyboard's focus, so Enter works as before.

## 31. After M7: a readable script for reviewing the story

**What changed**
- **`pnpm story:script`** (`tools/story-script/`) writes the story as one page (`dist/story-script/index.html`, and `page.html` for publishing as an artifact).
  - `parse.ts` reads each scene's source into rows in the small part of Ink the scenes are written in: lines with speakers, options (their conditions, `#needs: rings N`, `+`), `{ cond: … }` blocks with `- cond:` and `- else:` branches, gathers, jumps (with and without a condition), parts (knots), effect tags, and inline `{cond:a|b}`. Anything else is refused rather than shown wrong.
  - `expr.ts` parses the conditions and says them in words ("Ulf is at home", "you have 5 rings or more"), turning them round for "otherwise".
  - `model.ts` puts together days, scenes, story souls, endings, journal threads and a flag index: every option, story-soul stamp and slice jump that sets a flag, and every scene, story soul, ending and thread that reads it.
  - `render.ts` makes the page: the game's palette in both themes, and each line with its `.ink` line number.
- **Review.** Each scene has Approve, Needs changes and a note.
  - Published as an artifact with the `db` capability, the page keeps one document per scene in `reviews/<scene>`: `{scene, verdict, note, hash, at}`. `hash` is the scene's source hash when reviewed, so the page flags a scene rewritten since. Claude reads the collection to apply a review.
  - Opened as a local file, the page keeps the review in `localStorage`, and Copy review gives the text, with the `pnpm story:approve` command for the approved scenes.
- **`pnpm story:approve <scene…>`** signs scenes off. It removes the `# draft` line and the draft comment under it.
- **What the index found.** 45 flags. None is read without being set somewhere. 22 are set but read nowhere yet, which means choices with no later consequence beyond their own effects: `asked_namesake`, `asked_twice`, `broke_loki`, `covered_loki`, `ferryman_doubted`, `geir_judged`, `heard_pension`, `helped_clerk`, `kept_quiet`, `letters_honest`, `letters_kind`, `loki_in_valhalla`, `promised_medicine`, `refused_loki`, `reported_carver`, `reported_loki`, `roof_mended`, `sided_freyja`, `sided_hel`, `sided_odin`, `told_skogul`, `ulf_fine_paid`. No code reads them either.

**Tests** (`tools/story-script/script.test.ts`)
- Conditions in words, both ways round, and the flags they read.
- A sample scene read row by row, with its nesting.
- Ink the script can't show is refused.
- Every line and option the game can show, on every path through every scene in three runs (fresh, gone badly, gone well, as the compiler walks them), is in the script: over 2,000 lines.
- The flag index for known flags (`ulf_shipyard`, `geir_hel`, `wood`), and no flag read without a setter.
- Signing off changes only the draft mark.
- The page: every scene, review control and flag entry is present, there is one script (the page's own), and the story's text is escaped.

**Known limits**
- The script shows each scene as written, with its structure. It doesn't show one playthrough at a time.
- Only scenes and story souls' lines are in it. The dead's everyday lines, question answers and decrees come from string tables, not from scenes.
- Word counts are Ink's own, as the writing budget uses them.
- Reviews are per scene. A note points at lines by their numbers.
- The review lives with one published artifact. Publishing again from another conversation without its link makes a new, empty one.
- The page loads its fonts from Google Fonts, and uses system fonts when offline.

## 32. After M7: more campaign (phase 2)

**What changed**
- **Ten story souls** (`content/packs/campaign/cases/`), each validated by the compiler on its day under every param choice (Freyja's whims, Odin's claims):

  | Day | Soul | Comes when | Stamp | What it tests or pays off |
  |---|---|---|---|---|
  | 4 | Old Hrolf, who helped Ulf patch the roof | `roof_mended` (Day 2) | HEL | An honest straw death; the night's letter reports it |
  | 5 | Solveig, a neighbour drowned at the herring | always | RÁN | Rán's first day; Ulf's letter carries the news |
  | 8 | Hallbjorn, the smith from Day 7 | `ulf_fine_paid` or `ulf_debt` (two versions) | VALHALLA | A braggart swearing his copied Ulfberht is real |
  | 9 | Thorvald's second visit | `thorvald_returned` (Day 3) | RETURN | Still alive |
  | 10 | Bard, a shipwright from Ulf's yard | `ulf_shipyard` (Day 9) | RÁN, clipped | Drowned with long nails: the Naglfar decree |
  | 13 or 15 | Bjarni, the tally carver from Day 11 (since §71, whichever carver the run drew) | `reported_carver` set (Day 13, drowned by the jarl) or not (Day 15, old age; since §71, a winter fever) | RÁN or TRANSFER | His own forged tally claims a battle |
  | 17 | Thrand, an old skald | always | VALHALLA | The spear mark |
  | 19 | Halla, the midwife who delivered you | always | TRANSFER | Hel's hall is full |

- **Sun.** Days 5, 17 and 19 always get a soul more, so they get 30 s more sun (570, 910, 950). A conditional soul adds a soul without adding sun, as Geir's and Loki's days do.
- **Names.** Every story soul's name is in its pack's `names.reserved.*` pool, and the compiler now fails a story soul whose name isn't. The new names (Hrolf, Solveig, Hallbjorn, Bard, Bjarni, Thrand, Halla) aren't in the generated pools, so generated souls, the goldens and the Daily are unchanged.
- **Words.** Archetypes and story souls take `words`, by pool (`{ pool.weapons: seax }`), which fix the words their generated lines use; the facts' own words still win (an Ulfberht is a sword). A fisherwoman no longer mentions "my sword". The compiler checks each word is in its pool, as it does for facts.
- **Scenes.** Days 4–6 are fuller (about 860 words to 1,340), with the same choices and effects, so the bots choose as before. Lines across Days 4–19 now read the 22 flags nothing read (§31), and two new stamp flags (`hrolf_judged`, `solveig_judged`) keep a night from mentioning a soul you never judged. Day 6's night had said "You didn't see him" to a player who had judged Geir with a third stamp; it now reads `geir_judged`.
- **The story script** says a comparison of two of the run's numbers in words ("letters_honest is more than letters_kind"), and the flag index has no flag left that's set but read nowhere.

**Tests**
- Compiler: a story soul with an unreserved name fails, and so do words from an unknown pool or a word its pool doesn't have.
- Engine (`campaign/run.test.ts`): every story soul with `words` has them in its evidence and says no other weapon; a fact's words win over the soul's (Hallbjorn's copy stays a sword). Without the change, the test fails.
- The compiler's check of each placed soul, which fails if a soul goes elsewhere (checked by sending Halla to HEL on Day 19: the build fails).
- The campaign sims: the good bot isn't demoted, the bad bot is, and every ending is still reachable.

**Known limits**
- All the new writing is first draft, for review in the story script.
- A story soul also says generated lines (how it died, its weapon, its back), fixed per content version and day param. Each new soul's lines were read together with its generated ones, and the clashes rewritten, but a later change to the templates can bring a new one. The script shows only the written lines.
- The sims' story policies choose by effects. None pays 5 rings for the roof, so Old Hrolf never appears in the economy sims; the compiler still proves his day works.

## 33. After M7: the desk's feel

**What changed**
- **Ink.** A chosen stamp leaves its ink on the soul: the destination's name in a double border, rotated, in a dark ink of the stamp's colour family, landing with a thud. It sits over the legs, below every hotspot (the lowest ends at y 336 of the 420-unit frame), takes no clicks and is hidden from screen readers; the stamp button already says which stamp is chosen. Choosing another stamp re-inks. A stamp button also presses down under the hand.
- **Souls walk up and off.** A new soul walks up from the queue (0.36 s). A sent soul walks off the way its stamp sends it (0.42 s): up for Valhalla and Fólkvangr, down for Hel and Rán, back the way it came for RETURN, aside for TRANSFER and DETAIN. The one walking off is a copy (`shift/motion.ts`): its drawing and ink only, with no buttons, roles, labels or test ids, inert and hidden from screen readers. It fades early, so the next soul can be looked at straight away. The copy is taken in a plain signal effect on `departed`, which runs as the send's batch ends, before the desk re-renders. Taken later, it would be of the next soul, or of a squeezed stage while both are mounted.
- **Papers.** On the desk layout the soul's papers slide in as it walks up, one after another; the rules stay put.
- **Moving papers** (the plan's "papers can be dragged around", `shift/desk.ts`, `shift/papers.ts`). Each paper on the desk layout has a title strip that picks it up. A press that doesn't move is a click, not a drag.
  - A moved paper leaves its column and lies loose, over the others, the last moved on top. It's positioned across the whole desk, not in its grid area.
  - Its spot is a fraction of the desk, so it survives a resize. It keeps its width and stays on the desk with its title in reach, and the stamp rack stays on top of it.
  - The settings keep the spots (`deskPapers`) for the next shift and a reload.
  - A double click on a title puts that paper back; "Tidy the desk" puts them all back.
  - The drag listens on the window, because a paper leaving its column replaces its element.
  - The drawer layout (phones) has no loose papers.
- **The sky** (`shift/sky.ts`). The ground behind the desk goes from warm to rose (a third of the day left) to dusk blue as the sun goes down, a two-colour gradient re-rendered with the sun's tick. The style only changes when the daylight moves a hundredth.
  - The stage and the papers keep their own grounds, so the signs are as easy to see as the art promises.
  - Every sky colour keeps the desk's text (ink, muted, accent) at 4.5:1 or better. The first draft's day colour had muted text at 3.9:1 and was darkened.
- **Reduce motion.** A new setting, `reduceMotion`. With it, or the device's own reduced-motion setting, the stylesheet stills every animation and no soul walks off. The ink is simply there, and the sky still changes colour, since that's the time of day rather than movement.
- None of it changes the game: no state, no timing, no focus, and the Daily is unchanged.

**Tests**
- Unit (`shift/sky.test.ts`, `shift/papers.test.ts`):
  - the sky darkens at every step from dawn to dusk, and the text stays at 4.5:1 on it;
  - loose papers stay on the desk, and the pile renumbers in order.
- e2e (`tests/e2e/desk.spec.ts`), phone and desktop:
  - A fast player plays the Daily at full speed. Each soul is stamped and sent as it walks up, and each new soul's first sign is clicked straight after a send, which the copy walking off must not intercept. Every soul's ink is checked. Every soul walks off the right way with its ink, holding nothing but a picture, and is gone afterwards. 8 of 8 judged rightly.
  - With the setting, and separately with the device's reduced-motion setting: no animations, no soul walking off, the ink still shown.
  - Desktop only: a paper dragged by its title lands where it was put. It stays there for the next soul and after a reload. A click isn't a drag, a double click puts it back, and "Tidy the desk" puts all back.
  - Under a fake clock: the sky is darker four minutes in, and darker still at dusk.
- `art.spec.ts` now waits for the soul to finish walking up before measuring where it stands.

**Known limits**
- The motion is a placeholder for the art direction to restyle ([`docs/art-brief.md`](art-brief.md), "Motion"). No sound was added: the stamp and send already have their placeholder sounds.
- Dragging is for a pointer (mouse, pen or touch on a tablet's desk layout). Keyboard and screen-reader players keep the papers in their places, which lose nothing.
- A paper can be put down over the body. That's the player's arrangement, and "Tidy the desk" undoes it.
- The walking-off copy duplicates the drawing's SVG ids for 0.4 s. The shared hatching patterns are identical for every soul, and each soul's clip path has its own id, so nothing draws wrongly.
- Whether the motion feels right is a matter for playtesters, not tests.

## 34. After M7: achievements (phase 6)

**Rules**
- Achievements reward skill or finding something, never playing a lot: no counts of Dailies played, souls judged in total or days survived.
- Accuracy counts with assists on. Speed, and doing it without help, don't.
- Daily achievements count only the day's Daily played for the record (`ranked`). A past Daily from the archive, or today's played again, doesn't count, because its answers can be known.
- The primer walks the player through its souls, so it earns nothing. The failure endings (demoted, an empty house) earn nothing.

**Content** (`achievements.yaml` in any pack, `AchievementSchema`). Each achievement has:
- an id;
- title and text string keys;
- `hidden`: unnamed in the gallery until earned;
- `when`: the moment it's checked at and a test there. The test is a StatePred, the same form endings use, over that moment's numbers (`engine/achievements.ts`):

| Moment | Checked | Numbers |
|---|---|---|
| `soul` | as each soul is judged | `correct`, `lies`, `caught`, `questioned`, `confessed`, `hints`, `afterDusk`, `story`, `day`, `assisted`, `stamped.<DEST>` |
| `shift` | as a shift ends | `total`, `judged`, `correct`, `wrong`, `perfect`, `lies`, `caught`, `missedLies`, `hints`, `questions`, `confessions`, `sunLeft` (percent), `dusk`, `day`, `assisted`, `untimed` |
| `endless` | as each Endless soul is scored | `score`, `round`, `strikes` |
| `run` | whenever the campaign run changes | the run's own paths (`STATE_PATHS`: flags, standing, family, day…) |
| `ending` | as a run ends | the ending's id |

- `soul` and `shift` also name the modes that count: `daily`, `archive`, `practice`, `endless`, `primer`, `campaign`.
- A soul's numbers come from the shift as it stood just before the send, while its hints and questions are still on it.
- A shift's numbers are rebuilt from its action log (`traceShift`), so hints on every soul count.
- The compiler checks strings, unique ids, that each test reads only what its moment has, and that each ending exists. Achievement ids join their pack's leak tokens, so the campaign's stay out of the demo builds.

**The first 21** (first-draft text; the demo builds have the first 8):

| Pack | Achievement | Earned by |
|---|---|---|
| core | Asked nicely | questioning a liar until they confess |
| core | Last light | judging a soul rightly after the sun has set |
| core | Nothing gets past you | calling out every lie in a shift that tells at least three |
| daily | Clean slate | a perfect Daily (assists allowed) |
| daily | Nobody's help | a perfect Daily with no hints and no assists |
| daily | Home before dark | a perfect Daily with half the sun left, no assists |
| demo | The long watch | 25 souls rightly in one Endless run |
| demo | Not a scratch | 15 souls rightly in Endless before the first strike |
| campaign | the nine story endings | each ending, hidden, titled as the ending |
| campaign | Stitched | detaining Loki (hidden) |
| campaign | Unlucky, not dead | sending Thorvald home on Day 3 and on Day 16 (hidden) |
| campaign | Nobody left behind | reaching Ragnarök with the whole family home |
| campaign | Spotless | a perfect campaign day, Day 10 or later |

Since then: Oathsworn (campaign), for reaching Day 20 under the oath (§49), the 22nd.

**In the game**
- The settings keep what's earned (`achievements`: id → the time first earned), so it's on the device and in backups like the other records.
- A backup merges by id, keeping the earlier time. Ids the build doesn't have come along, as endings do, so a full-game backup keeps them when it goes through the demo.
- A notice names what was just earned. Earned during a shift, it waits for the next screen that isn't the shift, so nothing covers the desk while the sun runs; a shift begun while one is showing hides it. It sits at the top for a few seconds, takes no clicks, and is a polite live region for screen readers.
- The gallery is a card on the title screen: earned ones with their date, the rest marked "Not yet earned", hidden ones as "Hidden" until found.
- Records from before achievements count. On every start, and after restoring a backup, the game grants what they show: endings found, the Endless best, and Dailies played for the record. A test that reads a number a record doesn't keep, such as hints or strikes, isn't guessed at: it isn't earned that way.
- `Platform.unlockAchievement(id)` tells the platform. It's called for each new achievement, and for all of them on every start, so an adapter must take the same id twice. The web builds do nothing with it. The Steam adapter (M6) and the Play adapter (M9) map the game's ids to the platform's own. Google Play makes up its own ids, so its adapter needs a table.

**Tests**
- Engine (`achievements.test.ts`), on real content, with a bot playing Daily #41:
  - fast, alone and perfect earns the Daily's three, but only as `daily`;
  - a hint, a slower sun, a late finish or a wrong stamp each cost the right ones;
  - a confession found by calling out a lie and questioning it;
  - every lie called out, and one left;
  - a soul judged in the grace after dusk;
  - Endless scores, and a best score kept without strikes, which can't earn the clean run;
  - run flags, the family at Ragnarök, the story endings, and the failure endings earning nothing.
- The campaign sim notes achievements as it plays. The "every ending is reachable" test now also requires each achievement only the campaign can earn to be earned by some bot. A misspelt flag in a test fails it.
- Compiler: missing strings, duplicates, a number a moment doesn't have, an unknown ending, and unknown modes or moments. Also that achievement ids are leak tokens.
- Backups (`save-data.test.ts`): merged by id at the earlier time, unknown ids kept, junk dropped, no change when there's nothing new.
- e2e (`achievements.spec.ts`), phone and desktop:
  - A Daily played with one liar questioned. "Asked nicely" is kept the moment the liar is sent but not announced during the shift. The summary announces it with the Daily's three.
  - The gallery shows 4 of 8, with dates, and so it stays after a reload, with no second notice.
  - In the full game, a hidden achievement is unnamed. Records seeded from before achievements (an ending, an Endless best of 30) earn the ending's and the long watch after a reload, but not the clean run.

**Known limits**
- The achievements are kept in the browser's storage and can be edited there. There's no protection, and the Steam and Play builds will pass on whatever the game says.
- "Home before dark" asks for half the sun. Bots spend 26–50 s of the Daily's 360 s on the evidence itself, but how long players take to read is a guess until playtests.
- Hidden achievements are hidden in the gallery only: their strings are in the full build.
- Steam and Google Play achievements need those builds. Nothing is sent anywhere from the web.
- The text is a first draft.

## 35. After M7: accessibility pass (phase 5)

**What was measured.** Before any change, every screen was walked on the phone (412×915), the desktop (1920×1080), and a 360×740 phone with the text at 175%. axe-core ran its WCAG 2.2 A and AA rules and its best practices on each:
- **WCAG A/AA:**
  - muted text and quiet buttons in the citation and report dialogs at 1.84:1 on the paper colour;
  - unlabelled share and report text boxes;
  - two scrolling areas a keyboard couldn't reach: the phone's Rules tab, and the night's "nights ahead" table.
- **Best practice:** the shift had no main landmark or level-one heading, and headings skipped a level in the briefing's rules, the journal and the phone's Rules tab.
- **Taps:** 11 kinds of control on the phone were under 44 px:
  - the small buttons, at 36 px (back up, restore, buy, skip the lesson, report);
  - the two dropdowns, at 33 px;
  - the campaign slots' Story Mode checkbox, 23 px tall, under WCAG's own 24 px floor.
- **175% text on 360 px:**
  - The shift was unusable: Pause and Judge sat past the screen's right edge, the sun meter shrank to nothing, and the evidence got about 75 px.
  - The title, morning and journal were wider than the phone. The settings' dropdowns and the assists fieldset wouldn't shrink, and neither would the Daily card's grid column once the archive's dropdown was there.

**What changed**
- **Contrast.** Muted text and quiet buttons on paper use `--paper-muted` (#675743, 5.6:1).
- **Labels and structure:**
  - The text boxes have labels.
  - The phone's evidence panel is a proper tab panel: labelled by its tab, and it takes the focus so a keyboard can scroll it. The nights-ahead table is a focusable, labelled region.
  - The shift screen is a `main` with a hidden level-one heading, its mode's title.
  - Heading levels no longer skip: the briefing's rules card has its own heading, each journal day is a heading, and the phone's Rules tab has a hidden one.
- **Touch targets.** On a touch screen (`pointer: coarse`), small buttons and dropdowns are at least 44 px. Story Mode's label is 44 px tall everywhere. Checkboxes and radio buttons are 1.5 rem, 24 px at the default size, and grow with the text.
- **Large text:**
  - The sun bar and the action bar wrap instead of overflowing.
  - Dropdowns never outgrow their box, and grid columns and fieldsets can shrink.
  - From a text size of 1.4 up (`LARGE_TEXT`, marked on the page as `data-text="large"`), a portrait phone's shift scrolls like a page instead of fitting the screen. The sun bar stays at the top and the action bar at the bottom. The body keeps 45% of the screen and the evidence reads in full, with nothing scrolling inside anything else.
  - Each new soul starts at the top of the page.
  - At the default size nothing changes, and the shift still fits one screen.
- **What screen readers hear:**
  - **Verdicts.** They were already said, through the toast's live region. But each screen had its own toast, and a live region made along with its message isn't read out, so the last soul's verdict could be lost as the summary opened. Now one toast serves every screen, made once with the app.
  - **Citations.** The dialog is described by its text, so a screen reader reads why the stamp was wrong along with the title and button. The same goes for a questioned soul's answer.
  - **The sun.** With a minute of sun left, the toast says so, once a shift; dusk was already said. The sun meter stays hidden from screen readers, and the time beside it can be read.

**Tests** (`tests/e2e/accessibility.spec.ts`, `@axe-core/playwright` 4.13.0)
- **Every screen passes axe** (WCAG 2.2 A and AA, and best practices), on the phone and the desktop:
  - title, briefing, shift and each phone tab, pause, citation, answer, summary, report;
  - the primer, a practice lesson, Endless's briefing and end;
  - save slots, morning and its scene, journal, audit, night and its scene;
  - in the full game, the warning before an ending and the ending.
- **On the phone**, every control is at least 44 px each way. Links inside running text are exempt, and a checkbox counts its label.
- **On a 360×740 phone**, at 100% and at 175% text, the same screens pass axe and the tap check, and nothing reaches past the screen's edge.
- **At 175%**, the shift's sun, count, Pause, Judge and Compare are on screen at the top and bottom of the page, the evidence isn't cut to a scrolling sliver, and the next soul starts at the top. At 100%, the shift fits one screen.
- **Screen readers:**
  - a citation's accessible description is its reason, and an answer's is its lines;
  - there's one live region, outside every screen, and it holds the last verdict when the summary opens;
  - under a fake clock, "A minute of sun left." comes at five minutes into a six-minute Daily, and dusk after it.
- The walks run with the device's reduced motion, which the game honours by stilling every animation. Without it, main's first CI run caught an achievement notice mid-fade, at about 30% opacity, and failed it on contrast.

**Known limits**
- **What axe can't check.** Automated checks find only some problems. Nobody has played the game with a screen reader yet, and someone who uses one should. In particular:
  - whether reading the body's signs as chips is enough without seeing the body;
  - whether Compare's two-step picking makes sense by ear.
- **Landscape phones.** With large text they keep their fixed side-by-side layout. It isn't checked at 175%, and it's likely cramped.
- **Desktop large text.** The desk layout was scanned at 100% only. It wasn't checked at 175%, on a desktop or on the Steam Deck's 1280×800.
- **Sound.** There are no captions, because every sound has something visible with it (a stamp, a citation, a toast). If music or ambience carries meaning later (phase 9), it will need them.
- **Target sizes on desktop.** The 44 px rule applies to touch screens. With a mouse, the small buttons stay 36 px and the dropdowns 33 px, above WCAG 2.2's 24 px AA minimum.

## 36. After M7: controller support (phase 4)

**Why.** Steam Deck Verified needs full controller support: every screen playable with the Deck's own controls, and on-screen prompts that match them. The game had no gamepad code; §6.4 planned it for M6.

**The buttons** (the standard gamepad layout; `packages/ui/src/pad.ts` reads it, `gamepad.ts` acts on it):

| Button | Does | Key |
|---|---|---|
| D-pad, left stick | Moves the focus to the nearest control that way. Held, it repeats after 400 ms, then every 120 ms | Tab |
| A | Presses what has the focus. After a stamp, the focus goes to Send | Enter, Space |
| B | Goes back. On the desk it's Esc: stop comparing, put the stamp sheet away, else pause. In a dialog, its close button. Elsewhere, the nearest open section or back button around the focus, so a confirmation's Cancel comes before the screen's Back | Esc |
| X | Compare | C |
| Y | Turn the soul over | F |
| LT | Ask Skögul for a hint | H |
| RT | Go to the stamps, at the one chosen (on a phone, it opens the judge sheet) | 1–9 |
| LB, RB | The paper before or after. On a phone, the tabs; on the desk: the rules, the body and its signs, each of the soul's papers, the stamps, and round again | none |
| View | The rules, with the focus on them | R |
| Menu | Pause, and resume | P |
| Right stick | Scrolls what has the focus, else the phone's open tab, else the page | wheel |

- The buttons send the shift's own keys (`shift/keys.ts`), so the controller and the keyboard can't disagree.
- Question, the feather, the registry and the later tools have no button of their own. They're buttons on the desk, reached with the d-pad and pressed with A; Question sits beside the contradiction it asks about.
- §6.4 planned Y for Question. Y turns the soul over instead, since every soul from Day 2 needs turning over and only a caught liar can be questioned.
- §6.4's focus graph (`useFocusable` in groups) wasn't built. The focus moves over the page's own controls, found when a button is pressed, and papers are marked `data-panel` for LB and RB. Nothing has to register, so a new screen works with no extra code.

**How the focus moves** (`spatial.ts`):
- **What it can stop at:** what a keyboard can focus, less what's disabled, hidden, inert or in a closed section. A scrolling panel with controls in it isn't a stop, its controls are; one with nothing to press (the rules) is.
- **Which one:** from the focused control's box, the nearest box that way within 45°. Drifting sideways counts double, and the centres' offset breaks ties. The 45° limit came from play: right from the last stamp, with Send not yet ready, went to the pause button at the top of the screen. Now it stays put.
- **Scrolling boxes:**
  - A control in another scrolling box counts only as far as it shows, so the d-pad can't land on a line scrolled out of sight in another paper.
  - Moving within a scrolling box scrolls it.
  - A focused paper that scrolls (the rules) scrolls with the d-pad before the focus leaves it.
  - With nothing further that way, the d-pad scrolls what it's in.
- **Dialogs:** while a dialog or the stamp sheet is up, the focus stays in it. While a dialog is up, the desk's buttons wait; Menu still resumes a pause.
- **Nothing focused:** A or the d-pad first only shows the focus. It goes near where it last was on this screen (asking a question takes its button away), else to the screen's main button.
- **Lists and sliders:** A picks one up, and the d-pad changes it. A puts it down; B puts back what it was.

**Prompts**
- **Switching:** a button press or a stick sets `data-input="gamepad"` on the page. A real key or tap clears it (the key events the controller sends don't count).
- **What changes while it's set:**
  - The key hints hide, and each button shows its own: X on Compare, Y on Turn over, LT on Hint, RT on Judge and beside the stamps, Menu on Pause, View on the rules, LB and RB beside the tabs and the desk's papers, B on every back and close button.
  - The title's line of keys becomes the controller's.
  - The focus ring always shows. A browser shows it only after keys.
  - On a touch screen, "Hold to send" reads "Send", because A sends at once.
- **How they're drawn:** the prompts are CSS. `data-pad` or `data-back` on a button is drawn by `::after` with empty alt text, so a button's accessible name doesn't change.
- **Lettering:** the letters are Xbox's, which are also the Deck's.

**Tests**
- **Unit:** `spatial.test.ts` (6) and `pad.test.ts` (8). They cover the 45° limit, the trigger threshold, the dead zones, merging pads, one press per push, and the repeat timing.
- **End to end** (`tests/e2e/gamepad.spec.ts`). Before the page loads, its `navigator.getGamepads` is swapped for one that returns a standard pad. The test holds that pad's buttons down frame by frame. The cases:
  - **On the Deck's 1280×800:**
    - Daily #41 played start to finish with the controller alone: 8 of 8, then home with B.
    - Right from the last stamp stays put until Send is ready.
    - X and B compare; Y turns the soul over; LT gets a hint; Menu and B pause and resume; X waits while paused.
    - View goes to the rules, and the d-pad and right stick scroll them. RB and LB go round the papers.
    - The prompts show while the controller is in use, and the keys come back after a click or a key. Compare's accessible name stays "Compare".
  - **On the phone:**
    - LB and RB turn the tabs.
    - RT brings up the stamps, and the focus stays in the sheet. B puts it away.
    - A stamps and sends, and Send doesn't ask to be held.
    - The right stick scrolls the title.
  - **On both:** the text-size slider is picked up, moved, put down, and put back.
  - **In the full game:** B leaves the campaign's slots, the d-pad reaches New run, and A plays the first scene to its end.

**Known limits**
- **No real controller or Deck has been tried.** The tests fake a standard pad in the browser.
  - Established: the W3C Gamepad spec's standard mapping puts A, B, X and Y at buttons 0–3, the shoulders and triggers at 4–7, View and Menu at 8 and 9, and the d-pad at 12–15.
  - Not checked: that Chromium, under Electron on the Deck and through Steam Input, reports the Deck's controls with that mapping. That's for M6, on a Deck.
- **Sound.** A browser may not count a controller press as a gesture that lets sound start. If it doesn't, a web page with only a controller in use is silent until a key or a tap. The Steam build's window (M6) should allow sound without a gesture (Electron's `autoplayPolicy: 'no-user-gesture-required'`); the Electron shell is still a stub.
- **Gestures.** For the same reason, a link pressed with A may be blocked as a pop-up, and choosing a backup file may not open the file chooser. In the Steam build, links should open in the system browser (M6). Restoring a backup is optional, and Steam's on-screen keyboard (Steam + X) can type into the paste box.
- **Deck Verified checks more than input:** among them text size at 1280×800, the display resolution, and the on-screen keyboard for text entry. They're for M6, on a Deck.
- **Other controllers.** PlayStation pads show the Xbox letters; Steam Input can present any pad as an Xbox one. Buttons can't be remapped in the game; Steam Input can do that too.
- **Dragging.** Papers can't be dragged with a controller. They stay in place, as they do for the keyboard.
- **The primer's wording.** It says "tap the hands" and "tap their claim, then the wound"; with a controller, that's A. Wording that follows the controller is a writing change, left for sign-off.

## 37. After M7: store screenshots and trailer capture (phase 7)

**Why.** Store pages need screenshots at set sizes and short clips, and they go stale whenever the art changes. The capture replays chosen moments with the same souls every time, so a new set takes minutes.

**Running it** (`tools/store-capture`)
- `pnpm build:electron-full && pnpm store:capture` writes `dist/store`:
  - `steam/*.png`: 11 shots at 1920×1080;
  - `play-landscape/*.jpg`: the same 11 as JPEG, for tablets and landscape listings;
  - `play-phone/*.jpg`: 7 shots at 1080×1920;
  - for each of 3 clips: `clips/<id>.gif` (640 px wide, 15 fps), `clips/<id>/frames/*.png` (1920×1080 at 30 fps, for editing a trailer), and `clips/<id>.mp4` (H.264) when ffmpeg is on the PATH;
  - `index.html`, a contact sheet of everything with the checks below; `manifest.json`.
- `STORE_ART=pixel pnpm store:capture` shoots another art style.
- On GitHub: Actions, Store capture, Run workflow. The files come back as the run's artifact, with MP4s, since the runner installs ffmpeg.
- CI runs `pnpm store:check` on every push, in about 30 seconds. It plays every moment to its shot, cuts each clip to a frame per step, and checks every file.

**How it stays the same**
- **The build:** the Steam build (`electron-full`), served locally.
- **The clock and the dice:** each moment opens a fresh browser at 2027-01-10 12:00 UTC (Daily #41), with the clock stopped and `Math.random` seeded for that moment. A new run's seed comes from those two, so it's the same run each time.
- **Getting there:** the campaign moments start from `scenarioSave` saves (Days 3, 5 and 6, and a finished run), or from the vertical slice's start on Day 12. The engine works out the right stamps, as it does for the e2e tests.
- **Stills:** taken with the device's reduced motion, which the game honours, so everything is at rest. Toasts and achievement notices are waited out. Focus rings, the caret and the scenes' "draft" label are hidden.
- **Clips:** shot a frame at a time. Each frame runs the game's clock on by one frame (its timers, its animation frames, the sun), then moves every CSS and Web Animation on by hand. An animation is paused when first seen and set frame by frame; at its end it's finished, so whatever waits on it (a soul walking off) goes on. A frame takes about 170 ms to shoot, and the clip still plays at 30 fps.
- **How close two runs come:** a clip's frames matched to within a few pixels of anti-aliasing on the soul's art (about 60 of 2 million). That's the same souls and the same frames, not bit for bit. Before the clock was paused and running animations were settled, most frames differed.

**Sizes**
- **Steam:** the desk as a 1280×720 window drawn at 1.5×, which is 1920×1080. The text stays readable in Steam's thumbnails, where a 1920-wide desk would shrink it.
- **Google Play, phone:** a 432×768 phone at 2.5×, which is 1080×1920 (9:16). JPEG, since Play refuses alpha.
- **GIFs:** cropped to the action and shrunk to at most 640 px wide by area averaging. Each clip has one 256-colour palette, so what stays still doesn't flicker. 15 fps, looping.

**The stores' rules.** `finish.ts` checks every file against them, and the contact sheet shows the result. The rules below are from Steamworks' and the Play Console's own pages, as quoted in search results; this environment's network blocks the pages themselves.
- **Steam:** at least 5 screenshots, at 1280×720 or 1920×1080.
- **Google Play:**
  - JPEG or 24-bit PNG, with no alpha;
  - each side 320–3840 px, and the long side at most twice the short;
  - for a game to count for promotion, at least 3 landscape shots at 16:9 and 1920×1080 or more, or 3 portrait shots at 9:16 and 1080×1920 or more;
  - the preview video is a YouTube link, not a file.
- **GIF size:** anything over 5 MB gets a warning. That's a judgement about load times, not a store rule.

**The moments** (`catalog.ts`; `moments.ts` plays to each):
- **Daily #41 on the desk:**
  - a soul at the gate with every sign looked at;
  - a lie caught, with the Lie mark and Question;
  - the liar's confession;
  - the first soul stamped, ink on its legs;
  - a citation;
  - dusk, with 40 seconds of sun left.
- **The campaign:**
  - Day 6's registry entry, with its portrait;
  - Day 12's Loki, the stitch scars on his lips;
  - Day 3's morning scene;
  - Night 5's bills, with a sick child;
  - an ending's report of the last battle (the host at Ragnarök before §54).
- **Phone shots:** 7 of the above.
- **Clips:**
  - stamp and send: the soul walks off, the next walks up;
  - catching a lie: to the soul's answer;
  - sundown: the six-minute sun in four seconds.

**Known limits**
- **Not final.** The art is the woodcut built in code, not commissioned art, and the story is a draft. The draft label is hidden, but the text isn't final: the ending's own text ends "DRAFT.". As the brainstorm said, the tool is for the real store page once the art is final.
- **MP4s need ffmpeg.** There's none in this environment, so the MP4 step runs only on the workflow's runner.
- **Story screens on Steam.** The morning, night and ending screens are one column on the wide frame, with empty space either side.
- **Nothing checks that a picture looks good.** The dry run checks that each moment still gets there and that each file meets the rules. Looking at the contact sheet is a person's job.
- **Other store assets.** Steam's capsules and library art aren't made here; they're commissioned (docs/capsule-brief.md). The trailer is still to be edited, from these clips.
- **Fragility.** The moments follow the UI's test ids, so a UI change can break one; CI's dry run catches it. The frame-stepping relies on Playwright's clock and Chromium's animation API, so a browser update could shift frames slightly.

## 38. After M7: a playtest build for invited testers (phase 8)

**Why.** Testers could only play the demo unless they built the game from source, and the campaign's economy had only been tuned against bots. How to set up the page and invite people: [`playtest.md`](playtest.md).

**The target.** `web-playtest` is the full edition (every pack) with the itch adapter, relative paths, no service worker and no Case Lab. Two new target fields reach the build through the content manifest:
- **`playtest`:** the title screen says it's a playtest build and names it. Each readable save slot gets a Playtest report button. `dev-full` has the flag too, so the report can be tried locally.
- **`storage`:** the build's own name for what it keeps in a browser, or null to share the other builds' place.
  - Only `web-playtest` has one, `playtest`. Its localStorage keys are `cots.playtest.*` instead of `cots.*`, and its IndexedDB database is `chooser-of-the-slain.playtest`.
  - `localKey` in `store.ts` builds every key: settings, the Daily's and Endless's mirrors, the save slots, the art style. The platform's `openStore(name)` takes the database's name.
  - Every other build keeps its names, so no existing save moves.
  - Why: the demo shows a save it can't read as unreadable and offers to clear it, and itch probably serves every HTML5 game from one origin (Known limits).
- **The build label:** target · commit · content hash, e.g. `web-playtest · 3f2a9c1 · content ca5b2592`. `VITE_BUILD` sets the commit (the playtest workflow passes the short SHA). A local build says `local`.

**The engine: mistakes itemised.** The audit now files each soul sent wrong in the day's ledger, as `mistakes`. Each entry has:
- the rule that decided where the soul belonged;
- the destination expected and the one stamped;
- any procedures skipped (nails left uncut).

The field is absent on a day with none, and in saves from before this build, which keep only the count. No verdict, pay or Daily changes, and the pinned Daily checksums hold.

**The report** (`packages/ui/src/campaign/playtest.ts`, pure). It's Markdown, made from the save and the run it resumes to:
- **Header:**
  - the build, slot and seed, and whether it's Story Mode or the slice;
  - the day, phase and rings, and any nights in debt;
  - the family;
  - standing with the powers met so far, by the names they go by that day, so the stranger stays the stranger until Day 12;
  - upgrades bought, and the ending.
- **Days:** one row per finished day: souls right, wrong and unjudged; pay, bonus, fines, bills, shop, story and Draupnir; the rings after the night; and any assists. Signs are ASCII, so a script can read the table. A day whose night hasn't come has its night cells empty.
- **Mistakes:** one line per soul: the stamp, where it belonged, the rule's text as that day's rulebook words it, and any steps skipped. For an old save, the day's count.
- **Choices:** each journal entry is played again through its scene with the choices made (`playScene` with `journalEnv`), and the lines marked chosen are listed. If a scene has changed since and replay fails, the option numbers are listed instead.

**The UI** (`playtest-ui.tsx`)
- A dialog with the report, *Open the playtest form*, *Copy the report* and *Close*. Escape closes it, and so does B on a controller, as on every dialog.
- The form link fills in `.github/ISSUE_TEMPLATE/campaign-playtest.yml`: the report, and the title `Campaign playtest: Day N` (plus ", an ending" for a finished run).
- A link over 8,000 characters opens the empty form instead, with a note to paste the report.

**The deploy** (`.github/workflows/deploy-playtest.yml`)
- Run by hand only.
- Needs `BUTLER_API_KEY` and the variable `ITCH_PLAYTEST_TARGET`, and skips cleanly without them. It fails if that project is the demo's (`ITCH_TARGET`).
- Builds with the commit in `VITE_BUILD`, runs the leak check (the full build's canary must be there) and itch's limits, then pushes with butler, with the short SHA as the version.
- The build is 14 files and 828 KB.

**Tests**
- **Engine:** the audit files each soul sent wrong with the rule that decided it, and none on a day judged rightly.
- **Report (4 unit tests):**
  - a row per day with pay, bills and rings;
  - each mistake's destinations and rule;
  - an old save's count;
  - choices read back from a morning scene.
- **e2e on the real `web-playtest` build** (served on port 4176; phone and desktop):
  - the title note;
  - a slot the demo left at `cots.campaign.0` is ignored, and the build's own keys and database are used;
  - one day played with a soul sent wrong: the report's row, the mistake and its rule, both choices as the journal shows them, the form link's fields, Copy (the clipboard holds the report), Escape, and Close.
- **A negative control, run once by hand:** built with `storage: null`, the storage test fails.
- **CI** builds and leak-checks the new target with the rest.

**Known limits** (more in `playtest.md`)
- **The shared origin is unverified.** itch.io is blocked here, so that itch serves every HTML5 game from one origin comes from memory and forum reports. If it doesn't, the separate storage costs nothing.
- **A password and a secret link can be passed on,** and the public repo means anyone can build the whole game anyway.
- **Choices from rewritten scenes** show as option numbers.
- **Only the campaign has a report.** The Daily already has its share text, soul reports and opt-in telemetry.
- **The form needs a GitHub account,** and issues on a public repo are public. Copy the report is the way round both.
- **The labels don't exist yet.** The forms' labels (`playtest`, `campaign`, and the alpha forms' `alpha` and `soul-report`) aren't in the repository, and GitHub skips a label that doesn't exist.

## 39. After M7: music, ambience and sound cues (phase 9)

**Why.** There was no music or ambience, and the effects were synthesised placeholders. This builds the system and lists every file it needs. Every build stays silent (apart from the placeholder effects) until real sound arrives: placeholder loops would be worse than silence. The commissioning brief is [`sound-brief.md`](sound-brief.md).

**The content** (`content/packs/<pack>/sound.yaml`)
- **Beds:** each has an id and a line saying what it's for. Its layers are `music`, `tension` and `ambience`, each a file name, or `{ file, loop: false }` for a piece that plays once.
- **Day overrides:** a day can give some places a bed of its own (Day 20's gate is `ragnarok`).
- **Ending overrides:** an ending can have its own music.
- **Cues:** a cue can name recorded variants.
- **Where things are:**
  - core has a bed for each place, and the cue files;
  - the demo adds its lost ending's music;
  - the campaign adds Ragnarök's gate and three ending moods.
- **Files:** `assets/<pack>/sound/<name>.ogg` (Opus) and `.m4a` (AAC).

**The compiler** (`packages/content-compiler/src/sound.ts`)
- **Scope:** it reads only the target's packs, so a demo never names the campaign's music.
- **What's left out:** any layer, cue variant, day or ending bed without files, so a place falls back to its own bed, a cue to its placeholder, or silence.
- **Errors:**
  - a bed defined twice, or one a day or ending names that doesn't exist;
  - an ending that doesn't exist;
  - a pack with sound that leaves a place without a bed.
- **Output:** it writes `generated/<target>/sound.ts`, with each file as `new URL(<path>, import.meta.url)`, so Vite copies only the named files into the build, hashed. The compile line reports the count, e.g. `sound 0 of 26 files` for the demo and `0 of 32` for the full game. None exist yet.
- **Outside the content hash:** sound doesn't change the content hash, so the Daily's checks are unaffected.

**The mix** (`packages/ui/src/sound/mix.ts`, pure)
- **The bed:** the screen gives a place:
  - title, save slots and briefings → title;
  - shift → gate;
  - results, Endless's end and the audit → tally;
  - then morning, night and ending.

  The place's bed is the ending's own on the ending screen, else the day's own (campaign only), else the place's.
- **Tension:** `smoothstep((sunUsed − 0.5) / 0.5)`, from the share of sun used. It's 0 without a sun (Story Mode, untimed practice, Endless). The calm music is scaled by `1 − 0.35·tension`.
- **Ducking:** story text on screen (a scene or an ending) scales music by 0.4 and ambience by 0.55.
- **The player's volumes:** new `music` (0.7) and `ambience` (0.8) settings scale each part. The existing `sound` setting is the master volume.

**The player** (`packages/ui/src/sound/beds.ts`)
- **Changing bed:** a new bed fades in over 1.2 s while the old one fades out. Levels then ease toward the mix (0.25 s).
- **Loading:** each layer loads the first format the browser says it can play (`canPlayType`), falling back to the next if decoding fails.
- **In step:** layers are decoded whole and started on the same sample, so a stem and its music stay in step.
- **Memory:** four decoded files are kept for coming back to.
- **Recorded cues** are decoded once sound first runs, then played in turn. Until then, or without files, the recipe plays.

**The context** (`audio.ts`)
- **Suspended while:** a shift is paused, the page is hidden, or the volume is 0.
- **Leaving from the pause** lets it go. Before, a gesture happened to resume it.
- **Still starts on the first tap or key,** as browsers require. A tap before the game is listening starts nothing, and the next one does.

**The driver** (`packages/ui/src/sound/driver.ts`)
- **Inputs:** the screen, the shift's sun (read at each tick only while a shift runs), the campaign's day and ending, story text on screen, and the settings.
- **Where the campaign's details come from:** its lazily loaded screens publish its day and ending (`sound/place.ts`). `useStoryText()` marks scenes and the ending.
- **When the day counts:** only on the campaign's own screens and a campaign shift, so a Daily after Day 20 still plays the gate.
- **The volume settings** appear only in a build that has beds.

**Sketches** (dev-full only, `?sound=sketch`)
- **What:** procedural drones, a heartbeat pulse, wind and a hearth, 8-second loops fitted to whole cycles, with noise cross-faded at the seam. They let the system be heard and tested.
- **Kept out of other builds:** the module is imported behind `import.meta.env.MODE === 'dev-full'`, which other builds drop. So does the test handle `__cotsSound` (the mix, and each layer's level, target and state).

**Tests**
- **Unit:**
  - the mix: beds by place, day and ending; tension silent then rising, never falling; ducking; volumes; the lists matching the schema's names;
  - the compiler: files found by format, missing names left out, silent overrides dropped, bad references refused, the generated URLs, and campaign beds only in full targets.
- **e2e, dev-full with sketches, phone and desktop:**
  - title → gate on a practice shift, with all three layers;
  - tension up and the calm music down after five minutes of sun;
  - a pause holds sound, and leaving releases it back to the title bed;
  - the music volume setting;
  - music and ambience ducked under the morning scene, and restored after it;
  - no beds and no music setting without sketches;
  - none of it on the web demo.

  Run 4 times over, they held.

**Known limits**
- **No real sound yet.** Levels need calibrating when files land: the defaults were chosen without them.
- **Loops are decoded whole.** It keeps them gapless and in step, and costs memory (23 MB a stereo minute). Pieces that play once are decoded whole too; if endings grow long, stream them instead.
- **Stem lengths aren't checked.** The compiler can't see audio lengths. A stem of a different length from its music drifts, which the brief's acceptance test covers.
- **Offline, the PWA plays no music.** Its precache leaves audio out, so the web demo fetches each bed when first heard. Add runtime caching for sound when files exist.
- **No captions,** as §35 said, because nothing new is carried by sound: the tension follows the sun on screen, and ducking follows text on screen.

## 40. After M7: appeals (gameplay brainstorm, item 5)

**Why.** A mistake was cited, fined and forgotten. Now the soul can come back the next morning to be judged again. The brainstorm's first version was "admit or defend". That would have been an empty choice, because the citation already tells the player on the spot that a verdict was wrong. So:
- an appeal is heard by judging the soul again, at the desk;
- some appeals come from souls judged rightly, trying their luck, so an appeal is no proof of a mistake.

**Who appeals** (engine, at the audit: `chooseAppeal` in `campaign/run.ts`)
- **Days:** from `appeals.from` (Day 1) up to the day before the last, whose mistakes have no morning left.
- **Candidates:**
  - souls sent to the wrong place;
  - "chancers": souls judged rightly into Hel, Rán or the clerk's hall.

  Story souls never appeal; their stories have their own consequences.
- **The draw:** from its own stream of the run's seed (`<seed>|appeal|<day>`), so a run always brings the same appeals.
  - 70% after a day with a soul sent wrong, 25% after a day without.
  - When both kinds are there, 25% of appeals come from a chancer.
- **What's kept for the morning:** the soul as it stood (its case), the stamp, whether a Valhalla stamp made it a worthy einherjar, and what the mistake cost (its fine, the standing it moved).

**Hearing it** (UI)
- **Where:** a card on the morning screen, after the morning's scene, before the decree.
- **Hear the appeal** opens the desk for that one soul.
  - It has no sun, and uses the rules and stamps of the day it was judged.
  - A banner says the day and what the soul was stamped.
- **Leaving from the pause** keeps the appeal for later.
- **Let the verdict stand** closes it. Going to the gate unheard lets it lapse the same way.
- **The session:** it's a practice-mode shift with its own `appeal` mode. It earns no achievements, sends no telemetry, and skips the summary: its stamp becomes the run's `appeal` action.

**Outcomes** (`hearAppeal`)

| Verdict was | Stamped on appeal | Outcome | Rings | Standing | The soul |
|---|---|---|---|---|---|
| wrong | where it belongs | righted | its fine back | the mistake's undone | moves to its hall |
| right | the same | upheld | +3 | none | stays |
| either | anywhere wrong | wrong | −5 (none in Story Mode, or if that day waived fines) | as for that mistake | moves there |
| either | not heard | let stand | none | none | stays |

Moving a soul keeps the Ragnarök host true: the counts of souls sent, and the worthy and unworthy einherjar.

**Records**
- The day it's heard, the audit files it in that day's ledger (`appeal`). The audit shows its rings as a row, and its standing as its own column, so the accounts still add up.
- The playtest report lists every appeal.
- The save's log keeps the action, so replays and resumes give the same run.

**Numbers.** These are first guesses in `content/packs/demo/campaign.yaml`: `from 1, afterMistake 70, otherwise 25, chancers 25, bonus 3, fine 5`. The sim (12 runs per policy) has bots hear every appeal and judge it with their accuracy at the gate:
- experts end about 12 rings up, and competent bots about 6;
- novices are demoted about as often as before: the novice who pays every bill in 12 of 12 runs, up from 11 of 12, one run's difference at 12 seeds.

Appeals add depth and a second look; they don't fix the economy's missing middle. Bots understate them, since a person with no sun should judge better than at the gate.

**Tests**
- **Engine (6):**
  - the appeal and what it cost;
  - righting a mistake: fine, standing, the soul's hall;
  - upheld, wrong and let stand;
  - lapsing at the gate, and the ledger;
  - no appeal from story souls, after the last day, or without the settings;
  - replaying from a save.
- **Report (1):** each appeal listed.
- **Sim:** hears appeals. The bot that plays for the wolf ending (a weak host) lets them stand, because righting mistakes strengthens the host.
- **e2e on the web demo** (phone and desktop), with the clock and `Math.random` pinned to a run whose first soul appeals:
  - righted, including leaving from the pause;
  - decided wrongly, with the audit's −5 row;
  - let stand.

**Known limits**
- **The pleas are generic.** There's one line per destination stamped, and they're draft copy for your sign-off.
- **Memory is a real edge.** A player who remembers yesterday's citations knows which appeals have merit. That's part of the game. Chancers keep an appeal from being proof, but they don't make it a mystery.
- **Rewards stay small** (3 and 5 rings) until playtests say otherwise.
- **The Daily is untouched.** It has no appeals.

## 41. After M7: the line at dusk (gameplay brainstorm, item 4)

**Why.** Souls still in line when the sun set used to vanish, costing only their wage. Now the queue remembers them.

The brainstorm's version, and what changed:
- **It added yesterday's leftovers to tomorrow's queue.** A slow day would make the next one longer, a snowball that steepens the novices' cliff. Here they take the places of the day's last new souls instead, so the line is no longer. Leaving a soul costs a wage, exactly as before.
- **It didn't say whose rules judge them.** A soul made for one day often can't be judged fairly by the next: it lacks the new day's kinds of evidence. Measured over 40 seeds, only 47% of Day 1's souls could be judged by Day 2's rules; 36% of Day 4's by Day 5's; none of Day 7's by Day 8's (the nails); 57% of Day 16's by Day 17's. Here each soul is seen afresh (below), and 100% of 9,555 pass.
- **It charged Hel once per soul.** Endings need standing of 4 to 8, so any occasionally slow player would lose Hel's ending. Here only a crowded gate costs anything.
- **It let the living die into Hel's hall.** Hel's legion counts double in the host at Ragnarök, so that would be a fine-free way to grow it. Here the living lost in the night go to no hall.
- **It promised the order of the line would matter.** That needs a way to choose who comes to the desk next: a big change on both layouts, and to what the player knows before judging. It isn't built; see the limits.

**At the audit** (`waitingLine` in `campaign/run.ts`)
- **Which souls:** those still in line when the sun set.
- **When:** from `waiting.from`, only when the next day follows on. Not after the last day, and not across a vertical slice's jump.
- **Story souls never wait.** Their stories go on without them.
- **The living** (those who should go back) **die in the night.** Each costs `waiting.died` (Odin −1 in the demo), and they go to no hall.
- **Everyone else waits for the next day,** seen afresh under its rules. `dressForDay` in `gen/generate.ts` does this:
  - it keeps the soul's truth, lies and look;
  - it recomputes whether the soul counts as a liar (from Day 16) and judges it by the next day's rules;
  - it dresses it with that day's evidence (the signs its rules read, a registry entry once there's a registry), under the same F1–F8 contract as the day's own souls.

  A soul no dressing passes would be gone, as before there was a line. It has never happened.
- **A crowded gate** (`waiting.crowd` or more left, three in the demo) costs `waiting.night` (Hel −1) once for the night.

**The next morning** (`campaignQueue`)
- **Place in line:** the souls who waited come first, after the day's teaching soul, so a slow player never loses the day's lesson.
- **Room:** each takes the place of one of the day's new souls: one who shares its name if there is one, so no two in the line do, else the last.
- **Clearing:** once the gate opens, they're in the day's line and no longer in the run's `waiting`.
- **Replays:** the morning's save keeps them, so replaying the day brings them back in the same places.
- **The day they came:** a waiting soul keeps its original `day`, which is how the desk knows it waited. Nothing else reads a case's day.

**Records**
- **The audit:**
  - names what became of each soul left: it waits at the gate for tomorrow, or it was still breathing at dusk and dies in the night;
  - gives the line's standing a column of its own, "The line", so the accounts still add up.
- **The morning** lists who waited, and says they're first in line today, under today's rules.
- **The desk** marks a soul who waited: "Waited at the gate since Day 1. Today's rules decide."
- **The playtest report** lists each night's line.
- **The ledger** keeps it as `waiting`, with the souls by id and name, and the cost.

**Numbers.** The demo campaign's settings are `from 1, crowd 3, night { hel: -1 }, died { odin: -1 }`: first guesses.
- **Re-dressing** takes 1–3 ms a soul. Under the next day's rules the right destination changes for 4–19% of souls, up to 102 of 529 after Day 14 fills Hel's hall.
- **The sim** (`pnpm sim campaign --pace N`, 12 runs per policy):
  - it now gives bots a pace in seconds of sun per soul, 25 unless told;
  - each day allows about 46–63 s per soul.

| Pace | Souls left over a run | Nights with 3 or more | Living lost | Standing |
|---|---|---|---|---|
| 25 s | 0 | 0 | 0 | baseline |
| 55 s | 2–6, on Days 3, 5, 6 and 9 | 0 | 0.1–0.2 | Hel and Hel endings within noise of baseline |
| 70 s | 24–47 | 4–5 | 1.4–3.3 | Hel about 5–9 lower, no Hel endings; Odin 1.5–3 lower |

The counts are for bots that last the run. Careless bots are demoted early, so they leave fewer.

- **Bots with the speed upgrades** leave about half as many (2.3–2.9 against 5.2–6.1 at 55 s): the first time the sim shows those upgrades earning their keep.
- **Rings** move only by the wages of souls never judged, as before the line.
- **A quirk that predates the line:** novices are demoted slightly less when slow, since fewer souls judged means fewer fines. The line makes leaving souls a little costlier.

**Tests**
- **Engine (5):**
  - the souls left wait, dressed and judged by the next day's rules, after its teaching soul, in the places of its last souls, with no repeated names;
  - the living die: no hall, their own cost, and story souls don't wait;
  - a soul or two costs nothing;
  - no line without the setting, before `from`, on the last day, or when everyone is judged;
  - a saved morning brings the same line, and standing adds up across every audit column.
- **Generator:** every soul of every day can wait for the next, and passes its contract there.
- **Sim:** a slow bot's line waits, and its accounts and standing add up.
- **Report (1).**
- **e2e on the web demo** (phone and desktop): Playwright's clock runs the sun down with four souls in line. Then:
  - the audit's notes and Hel −1 in the line's column;
  - Day 2's morning note;
  - the teaching soul first, then the souls who waited, with the desk's banner.

**Known limits**
- **Nobody chooses the order.** The line is still first come, first judged, so the living's urgency is a reason to keep pace, not a choice to make. Letting the player call a soul forward is the follow-up, if playtests want it.
- **A waiting soul's words are said afresh the next day.** Its truth, lies and look are the same, but a player who read its testimony at dusk will find it put differently.
- **The costs are small on purpose,** and so are the thresholds that decide endings. The bots' pace is a guess; the playtest build will say how often real players leave souls.
- **Story Mode has no dusk,** so no line. **The Daily is untouched.**

## 42. After M7: the gods' requests (gameplay brainstorm, item 2)

**Why.** Only mistakes move standing, and the campaign's rows already let a mistake please the god who gains the soul: a warrior of Valhalla's sent to Hel is Odin −1 and Hel +1. Nothing said so, and nothing in a shift let a player court a god on purpose. Now, some mornings, a god asks openly.

The brainstorm's version, and what changed:
- **"Freyja wants two more for Fólkvangr" didn't say whose.** More for Fólkvangr has to come from another hall, and whose decides the cost: the rows charge Odin 2 for each of his warriors sent to her. So each request names both ends, souls that belong in one place sent to another, and the desk counts only those.
- **It said a favour "risks" a citation.** It's certain. Every soul sent as asked is a mistake, with no wage, a citation, and a fine once the day's warnings are used. The morning says so, and says what the rows will move.
- **It had requests that test skill,** such as "Hel: nobody fit for my hall goes elsewhere". They're dropped. The wage already pays for judging rightly, and the rows already charge Hel's favour for a soul of hers sent elsewhere, so such a request would pay for skill twice and punish a mistake twice. It offers no choice, which was the point of the item. Only favours are asked.
- **Requests that conflict** are kept, as rivals. Freyja and Hel both want Odin's warriors, so on some mornings both ask for the same souls, to be sent to different halls. When the line holds enough for both, both can be done, at twice the mistakes.

**The draw** (`drawRequests` in `campaign/run.ts`, at each audit, for the next morning)
- **When:** from `requests.from` (Day 5 since §57; Day 4 before), on `chance`% of mornings, whenever there's a next day.
- **Its own stream** of the run's seed (`<seed>|requests|<day>`), so nothing else in a run changes: a bot that ignores requests plays exactly as it did before them.
- **Which:** a request is open on a day inside its `since` and `until` when both its places are stamps that day and the next day's line holds at least `n` souls that belong where it asks from. That line includes the souls who wait from tonight (§41), so every request can be done.
- **One** open request is picked. Then, `rivals`% of the time, another god's open request for the same souls joins it.
- **Replays:** the morning's save keeps them, so replaying the day brings the same requests.

**The morning** shows each request under the scene: the god's words, then the terms.
- **The terms** say how many souls, from where, to send where, and the reward.
- **They say what each soul costs** as the mistake it is: no wage, a citation, a fine once the day's warnings are used, and the rows' standing, which `standingFx` works out for that pair of places. In Story Mode, or with the no-fines assist (which can be set on the same page), they leave the fine out.
- **Declining** costs nothing and needs nothing.

**The desk** shows each request's count under the sun: "Hel's request: 1 of 2 sent to Hel".

**The audit** (`settleRequests`)
- **Counts** the souls that belonged where the request asked from and were sent where it asked.
- **Done in full** (`n` or more): the reward, in a "Requests" column of the standing table, so the accounts still add up, with a note under the table. Each soul's own mistake moves standing in the Mistakes column, as it always did. **In part:** nothing.
- **Lists** each request, done or not: "Freyja's request: not done (0 of 2)."
- **The ledger** keeps them as `requests`. The playtest report lists them.
- **A soul given to a god whose request was done in full doesn't appeal** (§40). Righting it would keep the reward without its cost. Souls sent for a request done only in part appeal like any mistake.

**The standing table** had to change for the extra column.
- **The bug:** at 360 px, a fifth column (the appeal's or the line's) already pushed the page sideways; with the requests' column the table ran into the gutter at 412 px as well.
- **Now** it scrolls in its own box (`LedgerScroll` in `campaign/screens.tsx`), never the page, and the box takes keyboard focus.
- **The names stay put.** A column scrolled to comes to rest against them, never half under them, where a "+1" half hidden reads as "-1". The box measures the names' column, snaps to it, and leaves room after the last column so that every resting place is a column's start.
- **Smaller headers** keep the usual five columns inside a 360 px screen. With 175% text the table scrolls.

**Numbers.** The campaign pack's settings are `from 4, chance 50, rivals 25`, each reward +1: first guesses.

| God | Asks for souls that belong in | Sent to | Souls | From Day | Each soul's rows |
|---|---|---|---|---|---|
| Freyja | Valhalla | Fólkvangr | 2 | 4 | Odin −2, Freyja +1 |
| Odin | Fólkvangr | Valhalla | 1 | 4 | Freyja −2, Odin +1 |
| Hel | Valhalla | Hel | 2 | 5 | Odin −1, Hel +1 |
| The clerk | Hel | TRANSFER | 2 | 10 | Hel −1, the clerk +1 |

- **How often:** a run brings about 11 requests. On Day 5, 18 of 30 seeds had one, and 4 of those a rival.
- **The sim** (`pnpm sim campaign --serve <god>`, 12 runs per policy, plain story): bots do every request of one god they can, with souls they've judged rightly, and ignore the rest. The rows below are the payAll policy's; the other nights are close.

| Serving | Done in a run | Expert: standing at the end | Expert: endings | Competent: standing | Competent: endings |
|---|---|---|---|---|---|
| Nobody | 0 | Odin 2.8, Freyja 2.8, Hel 3.4 | Hel 6, the last stand 3, Freyja 2, Odin 1 | Odin −11.2, Freyja 1.3, Hel −3.1 | the last stand 9, Freyja 2, Hel 1 |
| Freyja | 3.3 | Freyja 12.8, Odin −10.8 | Freyja 12 | Freyja 10.3, Odin −23.4 | Freyja 11, the last stand 1 |
| Hel | 3.2 | Hel 11.3, Odin −2.1 | Hel 12 | Hel 4.4, Odin −16.5 | Hel 8, the last stand 3, Freyja 1 |
| Odin | 2.4 | Odin 7.6, Freyja −2.1 | Odin 11, the last stand 1 | Odin −6.4 | the last stand 9, one each of Hel, Freyja, Odin |
| The clerk | 1.8 | the clerk 7.0 | the last stand 12 | the clerk 5.5 | the last stand 11, Freyja 1 |

**What decides the endings.** Freyja's and Hel's endings need standing 3 and the lead; Odin's only the lead. An expert who ignores the requests ends with the three gods within a point or so of each other, so which of them the run ends with is close to a coin toss. One favour moves more than that, and the rows do most of the moving:

| Favours done (payAll, plain) | Expert: Freyja's ending, reward 0 / +1 | Expert: Hel's | Competent: Freyja's | Competent: Hel's |
|---|---|---|---|---|
| 0 | 2 / 2 of 12 | 6 / 6 | 2 / 2 | 1 / 1 |
| 1 | 9 / 10 | 10 / 12 | 6 / 7 | 2 / 2 |
| 2 | 12 / 12 | 12 / 12 | 10 / 11 | 2 / 7 |
| Every one asked (about 3) | 12 / 12 | 12 / 12 | 11 / 11 | 3 / 9 |

So at standing 3, for an expert, a single favour of Freyja's or Hel's mostly decided the ending, whatever the reward. The choice was made openly rather than by accident, but it was cheap.

**Raised to 8.** Both endings now need standing 8 and the lead. 8 is the lowest mark at which the god's story alone falls short: at 7, an expert devoted to Hel in the story still reaches her ending in 8 runs of 12 without a request. Measured over 12 runs a policy (payAll, the god's own story policy, the first N of her requests done):

| Favours done | Expert: Freyja's ending | Expert: Hel's | Competent: Freyja's | Competent: Hel's |
|---|---|---|---|---|
| None (the story alone) | 0 of 12 | 2 | 1 | 0 |
| 1 | 12 | 11 | 5 | 2 |
| 2 | 12 | 12 | 9 | 3 |
| Every one asked (about 3) | 12 | 12 | 10 | 5 |
| Every one asked, plain story | 12 | 11 | 9 | 3 |

- **For an expert,** the story and one favour now bring the ending, as do the requests alone.
- **The cost: Hel's ending is now a hard one for a competent player.** It takes 5 of 12 even with her story and every request, against 9 at standing 3. Her souls are many, and each one judged wrong costs her a point (the rows above).
- **Novices** reach neither ending at any mark from 4 up.
- The reach test's Freyja and Hel bots now do their god's requests too.

**Tests**
- **Engine (5):**
  - requests come from their first day on, only when the line holds the souls asked for, and a second one is a rival for the same souls;
  - the reward is paid when done in full, on top of what each soul's mistake moves;
  - nothing extra is paid when done in part, and nothing at all is charged when declined;
  - a saved morning brings the same requests; there are none without the setting or after the last day;
  - a soul given for a request done in full never appeals, while those of one done in part may.
- **Sim:** a slow bot's standing adds up, requests' column included.
- **Report (1).**
- **e2e on the full game** (phone and desktop): a save made in Node on Day 5's morning, with two gods asking for the same souls. It checks:
  - the morning's terms, with and without the no-fines assist;
  - the desk's counts, and the citations;
  - the audit's results, its Requests column and note;
  - the standing table on a 360 px phone: it fits; at 175% text it scrolls in its own box, never the page, and no column comes to rest half under the names.

**Known limits**
- **One favour mostly decides the ending** (above).
- **The clerk's favours alone never reach his ending,** which also needs the contract from the story (`flags.clerk_contract`). Since §57, staying in his favour keeps the contract on offer a day longer.
- **A mistake can do a request by accident.** Competent bots that ignore requests still complete 0.2–0.3 a run, with mistakes that happen to match one. The god is pleased all the same.
- **The gods' words are drafts,** like the rest of the story.
- **The Daily and Endless are untouched,** and the demo ends before Day 4.

## 43. After M7: the gods' favour (gameplay brainstorm, item 3)

**Why.** Standing did nothing until the ending. Now each god gives something while you're in their favour, so a run's allegiance shows long before Day 20.

The brainstorm's version, and what changed:
- **Kept:** Odin gives more sun, Freyja a free question a day, Hel milder sickness at home, the clerk halved fines. Like the upgrades, favours give time, information or money, never what decides a soul.
- **"Milder sickness"** is made concrete: no one at home falls sick by chance (from a night's unpaid bill), and the sick hold out a night longer without medicine. Nights in a row without firewood or food still make them sick. The chance part was added after the first measurements (below): the extra night alone changed nothing the sim could see.
- **It set no standing to reach.** The first favours come at 4, or at 3 for the two that ease hardship (sickness and fines), so they come to players who court a god, and rarely by accident (below). A second, stronger favour comes at 8.
- **Loki gets none.** The brainstorm names four gods, and the stranger isn't named until Day 12. A favour of his would be the place for the Naglfar plot to pay out during a run, if you want one. (He has one since §57: a ring a nail.)

**The rule** (`favoursFor` in `campaign/run.ts`): at the gate each morning, every god whose standing is at a favour's `at` or more grants it for the day and its night. A god's favours add up: sun and free questions are summed, and of the fine and sickness percentages the lowest holds.
- **Settled at the gate.** Standing doesn't move during a shift, so the audit files the same favours the gate granted (`favours` in the day's ledger).
- **The night keeps them.** Mistakes that cost a god standing at the audit don't take back that night's favour. The next morning decides again.

**Where each acts**
- **Odin's sun:** `shiftMods` adds it to the day's sun, as the sundial does.
- **Freyja's question:** the shift counts the free questions asked (`mods.freeQuestions`, `freeAsked`), so the day's first question costs no sun. Without the favour no count is kept, and nothing else about a shift changes.
- **The clerk's fines:** the audit charges `finePct` of each fine, rounding down, and files the rings spared (`eased` in the day's ledger). An appeal's own fine is untouched.
- **Hel's night:** `careFor` gives the night its extra nights for the sick, and scales the chance of falling sick from an unpaid bill by `sickChancePct` (0: none). The night screen's outlook (the odds it gives, and the family's "needs medicine within N nights") counts with both.

**The screens**
- **The morning** names today's favours in the day's card: those that do anything, since Story Mode has no sun and no fines, and the no-fines assist leaves nothing to halve. A guide below lists every favour, the standing it takes, the standing now, and which are yours today.
- **The desk** labels the free question "Question (free today)".
- **The audit** notes the clerk's favours under the fines. When they waive the fines, the fines row stays, at 0, so the mistake it's for isn't lost from the accounts.
- **The night** notes Hel's.
- **The playtest report** lists each day's favours, and the rings of fines they spared.

**Numbers** (the campaign pack; first guesses):

| God | First favour | Second, at 8 |
|---|---|---|
| Odin | at 4: +60 s of sun | +60 s more |
| Freyja | at 4: the day's first question free | the second too |
| Hel | at 3: no one falls sick by chance, and the sick hold out a night longer | another night |
| The clerk | at 3: fines halved | the rest waived |

These began as one favour each, all at 4 (the measurements just below). The revision after them follows.

How often each is held (bots, 12 runs, plain story, payAll; the share of mornings from Day 2 with the god at 4 or more):

| Player | Serving nobody | Serving that god |
|---|---|---|
| Expert | Odin 3%, Freyja 4%, Hel 12%, the clerk 0% | Odin 23%, Freyja 68%, Hel 49%, the clerk 23% |
| Competent | Freyja 3%, the clerk 1%, the others 0% | Freyja 58%, Hel 27%, the clerk 14%, Odin 0% |
| Novice | the clerk 11%, the others 0% | Freyja 25%, the clerk 20%, Hel 7%, Odin 0% |

At 3, experts would hold Freyja's or Hel's on about a fifth of mornings without trying (22% and 20%).

What they change (the same bots, with the favours and without them):
- **Odin's:** an expert who courts him at 70 s a soul holds it on 5 of 20 days, and leaves 31.6 souls at dusk over a run against 34.8. At 55 s: 2.7 against 2.9.
- **The clerk's:** novices hold it on under 2 of 16 days, so their fines barely move (332 against 345 rings a run for one who courts him).
- **Hel's:** never shows. Bots that skip bills lose everyone by Day 4, before anyone can reach her mark; bots that pay lose no one either way.
- **Freyja's:** bots never question, so the sim can't show it.

So the favours are small, and in the sim mostly invisible. Whether players feel them is for the playtest to show.

**Revised after these measurements:** the clerk's and Hel's marks lowered to 3, Hel's favour widened to chance sickness, and a second favour for each god at 8, the mark of Freyja's and Hel's endings (§42). Measured again (12 runs a policy, payAll unless named; "courting" is the god's own story policy and every request of theirs, the transfer policy for the clerk). The share of mornings from Day 2 at each mark:

| God (marks) | Expert, plain | Expert, courting | Competent, courting | Novice, courting |
|---|---|---|---|---|
| Odin (4, 8) | 4%, 0% | 60%, 41% | 26%, 10% | 0%, 0% |
| Freyja (4, 8) | 0%, 0% | 73%, 30% | 64%, 21% | 21%, 0% |
| Hel (3, 8) | 25%, 0% | 66%, 37% | 37%, 12% | 0%, 0% |
| The clerk (3, 8) | 0%, 0% | 43%, 19% | 40%, 12% | 21%, 3% |

- **The second favours never come by accident,** and to a courting expert on a fifth to two fifths of mornings.
- **Hel's at 3 comes to a plain expert on a quarter of mornings** (a fifth at 4). Experts pay their bills, so it's worth little to them.
- **The clerk's at 3 comes to novices who don't court him** on 13% of mornings (5% at 4). Their fines over a run fall from 294 to 285 rings: still small.
- **Hel's widened favour is the first the sim shows.** Bots on the frugal policy go without firewood every other night. With her requests done (plain story), an expert holds it on 55% of mornings and pays 61 rings for medicine over a run, against 176 without it; competent, 30% and 113. Without her requests, experts still hold it on 15% of mornings (131 rings). The extra night alone changed nothing, since bots always buy medicine.
- **The second favours are unmeasured.** Odin's matters only to a player slower than the sun (bots at 25 s a soul never are). Freyja's needs a bot that questions, Hel's second night a bot that skips medicine, and the clerk's comes to few novices (3% of a courting novice's mornings).

**Tests**
- **Engine (6):**
  - a favour is granted at its mark and not below; Odin's sun is in the day's shift and its ledger;
  - the clerk's halves each fine, rounding down;
  - Hel's holds for the night even after the audit costs her standing, and the night's outlook agrees;
  - Hel's spares the well any chance of falling sick (the outlook's odds, and 12 seeded nights), though a second night without firewood still makes them sick;
  - a god's favours add up at the second mark: a second minute, question and night, and the fines waived, with the rings spared filed;
  - Freyja's makes the first question free and the next one cost its price, and no count is kept without it.
- **Compiler (1):** favours compile; missing words and a favour named twice are refused.
- **Report (1):** the favours each day held, and the fines they spared.
- **e2e on the full game** (phone and desktop): a save on Day 5's morning with every god at its first mark, and Odin and the clerk at their second. It checks:
  - the morning's favours, the guide and the day's sun (two minutes more);
  - the free question at the desk;
  - the waived fine, its row at 0, and both of the clerk's notes at the audit;
  - Hel's favour at night, and no odds of falling sick with the firewood unpaid.

**Known limits**
- **The favours are small** (above). Odin's and Hel's are the ones the sim shows; the marks and values are content.
- **The second favours are guesses** (above): none of them is measured.
- **Loki has none** (above).
- **The words are drafts.**
- **The Daily and Endless are untouched,** and the demo has no favours.

## 44. After M7: promotion (gameplay brainstorm, item 1)

**Why.** One difficulty curve serves everyone: novices meet a cliff, and anyone who judges well cruises, with money that stops mattering. Promotion lets a strong player choose more pressure, inside the story.

The brainstorm's version, and what changed:
- **"After strong days"** is made concrete: two clean days in a row, meaning every soul judged rightly and none left at dusk.
- **"A promotion"** is two ranks: Chooser, Second Grade, and after clean days at it, Chooser, First Grade.
- **"A longer queue"** is souls added after the day's own, with the same sun.
- **"Fewer free citations, higher pay and a nightly tithe to Odin"** are kept. The first guesses at pay and tithe (+2 and +3 rings a soul; tithes of 6 and 14) made experts far richer than before, 1,753 rings at the end of a run against 764, the opposite of the aim. They're now +1 and +2 rings a soul, and tithes of 20 and 45.
- **"Declining costs nothing"** is kept, and a rank can be stepped down from at night, which the brainstorm didn't have. A player who overreaches isn't trapped into debt.

**The offer** (`promote` in `campaign/run.ts`, at each audit)
- **Counting:** clean days in a row are counted (`clean`). When they reach `cleanDays`, the next morning offers the next rank (`offer`) and the count starts again.
- **When:** from `promotion.from` (Day 6 since §57; Day 4 before), never for the last day, and never in Story Mode, which has no sun and no fines to be promoted into.
- **Answered in the morning** (`{ t: 'promotion', accept }`). An offer still unanswered when the gate opens lapses, and is filed as declined.
- **Filed:** the day's audit files the answer (`offer`) and the day's rank (`rank`) in the ledger.

**A rank's day** (`rankOf`, `economyFor`)
- **The line:** the rank's `souls` come after the day's own (`extraSouls`). Each is made as the day's souls are, at the places after them, bound for a destination drawn from the day's mix on a stream of its own. So the day's own line is the same at any rank, and the requests and the line at dusk, which count on it, are untouched. One who would share a name with a soul already in the line is passed over.
- **The economy:** the wage rises by the rank's `wage`, and the citations forgiven before the fines fall by its `warnings` (never below none). The audit and the audit screen both use this rank-adjusted economy.
- **The sun doesn't grow.** The extra souls come in the same daylight, which is where most of a rank's pressure lies for a person, if not for a bot.

**The night**
- **The tithe:** Odin's `tithe` is owed for the rank the day was worked at (`titheTonight`). The night's upkeep, its outlook, the ledger's night record (`night.tithe`) and the forecast of the nights ahead all count it.
- **Stepping down** (`{ t: 'stepDown' }`, at night) takes the rank below, or none, from the next day, and starts the clean count again. Tonight's tithe is still owed, so a rank can't be taken for a day's pay and dropped before its tithe.

**The screens**
- **The morning** shows the offer: what the rank brings, what it costs, and that declining costs nothing. The rank held follows the purse, and tonight's bills include the tithe.
- **The audit** pays the rank's wage and forgives its citations.
- **The night** lists the tithe among the bills, with a card to step down; the nights ahead note the tithe.
- **The playtest report** lists each offer and what was made of it, the days worked at each rank, and any step down.

**Numbers.** The campaign pack's first guesses: `from 4, cleanDays 2`.

| Rank | Souls more a day | Citations forgiven | Wage | Tithe a night |
|---|---|---|---|---|
| Chooser, Second Grade | 2 | 1 fewer | +1 a soul | 20 |
| Chooser, First Grade | 4 | 2 fewer (none) | +2 a soul | 45 |

The sim (`pnpm sim campaign --promote`, 12 runs per policy, plain story; bots take every offer):

| Bots, payAll | Declining | Taking promotions | Days at Second / First Grade |
|---|---|---|---|
| Expert: rings at the end | 764 | 1,039 | 3.6 / 12.5 |
| Expert: the host at Ragnarök | 330 | 398 | |
| Competent: rings at the end | 451 | 451 | 4.8 / 0.6 |

- **Frugal and upgrades-first bots** show the same shape: experts +281 to +289 rings and +66 host; competent bots within 14 rings of declining.
- **Novices and careless bots** are never offered one.
- **At 45 s a soul,** promoted experts leave 3.8–7.7 souls at dusk over a run, against none at their own rank.

So for a bot a rank is money and a stronger host for the flawless, and a wash for the competent. What a person will mostly feel is the same sun over more souls, with fewer mistakes forgiven: the pressure the brainstorm asked for, which the sim can't show.

**Tests**
- **Engine (4):**
  - the offer after clean days, again after as many more when declined, and the count restarting after a mistake;
  - a rank's longer line (the day's own souls unchanged, no repeated names), wage, fewer citations forgiven and tithe, with the night's accounts adding up;
  - stepping down, from the next day, with the tithe still owed for the day worked at the rank;
  - no offers in Story Mode, past the last rank or for the last day, and an unanswered offer lapsing at the gate as declined.
- **Compiler (1):** a rank's missing words, or a rank named twice, are refused.
- **Report (1).**
- **Sim:** accounts that add up with the tithe.
- **e2e on the full game** (phone and desktop): a save on the morning of the first offer (Day 6 since §57). It's taken, the day is worked at the rank, and the rank is stepped down from at night. The test checks:
  - the offer's terms;
  - the rank after the purse, and tonight's bills with the tithe;
  - the longer line and the rank's wage;
  - the night's tithe, the nights ahead, and stepping down.

**Known limits**
- **Bots don't feel the squeeze.** At their pace the sun never runs short, so the sim shows the money and the host, not the difficulty. The playtest will say whether a rank is worth taking.
- **The story doesn't know about ranks yet.** No scene mentions one, and no ending reads it: a place for the writing pass.
- **Rank names and words are drafts.**
- **The Daily and Endless are untouched,** and the demo never reaches Day 4.

## 45. After M7: interruptions at the desk, part 1: the noon decree (gameplay brainstorm, item 7)

**Why.** Papers, Please gets its best moments from interruptions at the booth. Item 7 brings three to the desk, authored like story souls:
- a raven with a noon decree (Day 19, this section);
- a god who stops at the desk (Day 18);
- a jarl who jumps the queue with a bribe (Day 9).

The god and the jarl follow in their own changes.

The brainstorm's version, and what changed:
- **"A raven brings a noon decree, announced with time to adapt"** is kept. Two souls before the change, a raven lands on the desk with the news. The soul at the desk and the next are still judged by the morning's rules.
- **"Noon" is a place in the line, not a time of day.** A soul's destination is settled when it's made, so that its fairness can be proved. If the change followed the sun, the same soul would belong in two places depending on how fast the player worked. So the decree holds from a fixed soul of the day's own line: the ninth, on Day 19.
- **"The fairness check tests each soul against the rule in force when it's judged"** is kept, literally. Every soul after noon is made under the decree's rules: generated, given its evidence and validated under them. It's then judged under them at the desk. Every soul before noon is handled under the morning's rules.
- **The decree draws a day param again**, never to the same choice. Params are the rules that already change each day (Freyja's whim, Odin's claim). No rule text changes: the rulebook's rules read the params.
- **Its first soul shows the change.** That soul is made from the decree's `teach` archetype, as a day's first soul teaches its new rule. On Day 19 it's one of Freyja's picks under her new whim.

**The rule** (`NoonDecree` on a day spec; `createDayContext`, `soulCtx`)
- `noon: { at, notice, redraw, text, teach? }`.
- **The afternoon:** the day's context carries a second one for after noon. It's the same day, with the `redraw` params drawn again from the run's seed, never to the morning's choice.
- **Which souls:** `generateCase` makes a soul whose place in the day's line is `at` or later under the afternoon, and marks it (`noon`). Story souls placed at `at` or later are made the same way. A rank's extra souls come after the day's own line, so after noon too.
- **The line:** every soul made under the decree comes after every soul made before it. Souls who waited through the night come first, which can push a story soul past noon's place; the decree's souls are moved last, keeping their order.
- **The desk:** `stepShift`, the rule tracker (`ruledOut`) and the evidence it can read (`inspectable`) take the soul at the desk under its own rules (`soulCtx`).
- **Appeals:** an appeal of an afternoon soul is heard under the decree, since the appeal's desk holds that soul alone.
- **The line at dusk:** a soul the sun sets on is seen afresh the next day, under that day's rules, and loses its mark.
- **Where there are none:** Endless never brings a noon decree, and the compiler refuses one on the Daily or the primer.

**The screens**
- **The desk:** from `notice` souls before noon, the raven's news sits under the sun bar: its words, and the new choice's own. From noon, a line says "Since noon: …". The spot is a live region from the start of the shift, so screen readers hear the news when it comes.
- **The rulebook** shows the whims in force for the soul at the desk.
- **The playtest report** marks a mistake made after noon.

**Day 19.** Freyja's whim is drawn again from the ninth soul, and the raven comes two souls earlier. Its words are a draft for your sign-off: "A raven thumps down on the desk with word from Fólkvangr: Freyja has changed her mind, on the last day there is. From the soul after next, she wants others."

**Measured** (40 seeds, from a fresh Day 19 morning)
- **Fairness:** 686 souls, 326 of them after noon. Every one validates under the rules it's judged by, and no soul from before noon comes after one from after it.
- **Effect:** the decree changes where some soul goes on 36 days of 40, mostly its first soul after noon. Before `teach` it was 25 of 40. On the other four days, the first soul after noon fits both whims.
- **Cost to the morning:** on 4 seeds of 12, the afternoon had no slot bound for Fólkvangr. The planner brings one forward from the morning, so one morning soul changes, but the day's mix stays as drawn.
- **The sim can't show it.** Bots judge by where a soul belongs, not by the rules, so what the decree costs a person is for the playtest to show.

**Tests**
- **Engine (4):**
  - the redraw: never the same choice, the same every time, only on days with a decree, never on the Daily;
  - 8 days of souls, each judged and valid under its own rules, in order, with the teaching soul first after noon;
  - the rule tracker reads a soul after noon by the decree (by the morning's rules it would rule out the rule that decides it), and a stamp by the morning's whim is cited and filed as after noon;
  - souls left at dusk lose the decree.
- **Endless (1):** no round brings one.
- **Generator:** the fairness property tests, the oracle comparison and the sweep's ideal bot now read each soul under its own rules. Without that they failed on Day 19, as they should.
- **Compiler (1):** a decree is refused if:
  - the raven comes before the first soul;
  - noon falls past the shortest line;
  - a param has no other choice to draw;
  - the teaching archetype isn't in the day's queue;
  - its words are missing.
- **Report (1).**
- **e2e on the full game** (phone and desktop), from a Day 19 save made in Node:
  - no raven at first;
  - the raven two souls before noon, with an accessibility scan and no sideways scroll;
  - the new whim in the rulebook from noon;
  - a stamp by the morning's whim, cited.
- **Goldens:** Day 19's summaries changed. The Dailies didn't.
- **Also fixed:** on the desk layout, a rulebook long enough to scroll (Day 19's) couldn't be reached by the keyboard. The accessibility scan found it once the raven made the paper shorter. The rules paper is now a named region the keyboard can reach.

**Known limits**
- **One decree a day, and only params.** A decree that adds or repeals a rule would need rule texts that know about noon. None is needed yet.
- **The bots don't feel it** (above).
- **The words are drafts.**

## 46. After M7: interruptions at the desk, part 2: a god at the desk (gameplay brainstorm, item 7)

**Why.** The second of item 7's interruptions (§45): someone who isn't a soul stops at the desk mid-shift, and talks.

The brainstorm's version, and what changed:
- **"A god stops at your desk"** is kept, as an authored scene placed in the day's line like a story soul. It comes once a given number of souls have been sent, if its condition holds.
- **The sun is held while they talk.** A scene is read at the player's pace, and a story beat shouldn't cost daylight. The hold is a pause the shift saves, and only the scene's end lifts it. The pause screen doesn't open, and the pause keys do nothing while the scene is up.
- **What's said lands at the audit.** Standing doesn't move during a shift, because the day's favours are the gate's (§43). So the scene's effects wait for the audit, which files them with the day's story standing.

**The rule** (`DeskVisit` in a day's queue; `deskVisit`; the `scene` action during a shift)
- `queue.visits: [{ scene, at, when? }]`: the scene comes once `at` souls have been sent, if `when` holds then. Nothing a shift does changes the flags until the audit, so `when` reads the run as the morning left it.
- `deskVisit(run, content)` says who is at the desk now. The UI and the sim both ask it.
- **During a shift, a `scene` action** marks the scene played, so it won't come again, even after a reload. It keeps the scene's effects (`pending`). The audit applies them after the story souls' own and files them in the day's story standing. Outside a shift, a scene still acts at once.
- **If the sun sets before the visit's turn, it doesn't come.** Day 18's comes after the third soul, so only a very slow day misses it.
- **The sim's bots** answer whoever comes as their story policy would, by the choices' effects.

**The screens**
- **The desk:** the scene opens over it as a dialog named "Someone at the desk", in the story's own colours. The desk goes inert and blurred, as when paused, and the sun bar stops. Its choices say whom they moved, as other scenes' do.
- **The journal** keeps it as "At the desk", and so does the playtest report.
- **The story script** (`pnpm story:script`) shows it between the day's morning and its souls: "At the desk, after 3 souls".

**Day 18** (a draft for your sign-off, `scene.d18.desk`)
- **Who and when:** Odin, in a grey hood and a wide hat, after the third soul, on the day of Loki's last offer.
- **What he knows:** the ship is nearly built, and whether any of its uncut nails came through the player's gate.
- **With a deal with Loki:** the player admits it (Odin +1, `told_odin`) or denies it (Odin −2, `lied_to_odin`).
- **Without one:** "Let him come." (Odin +1) or "Why tell me?".
- **That night,** Loki knows which: `d18.night` reads both flags.

**Tests**
- **Engine (2):**
  - the visit comes when its turn does, once, and only while its condition holds;
  - what it does waits for the audit, which files it with the story's standing, while the day's favours stay as the gate set them (a scene at night still acts at once).
- **Compiler (1):** a visit is refused if its scene doesn't exist, if it falls past the shortest line, or if its condition reads unknown run state. A scene that only the desk plays still counts as played.
- **Report (1).**
- **Story script:** it has every scene the build ships, the desk's included.
- **Sim:** the bots answer the desk, and every ending is still reached.
- **e2e on the full game** (phone and desktop), from a Day 18 save made in Node:
  - no one comes until the third soul;
  - then Odin, with an accessibility scan and no sideways scroll;
  - the sun held, and P doing nothing;
  - his words at the audit, in the story's column.
- **Also fixed** before it shipped: in the paper dialog's colours the scene's lines failed contrast. The scan found it, and the dialog now has the story's dark ground.

**Known limits**
- **Only Day 18 has a visit.** More are content: a scene and a line in a day's queue.
- **The words are drafts.**

## 47. After M7: interruptions at the desk, part 3: a jarl's bribe (gameplay brainstorm, item 7)

**Why.** The last of item 7's interruptions (§45, §46): someone who won't wait in line, and wants to pay for his stamp.

The brainstorm's version, and what changed:
- **"A jarl jumps the queue"** is kept literally. He is a story soul placed first in Day 9's line, ahead of everyone, even the souls who waited through the night (§41).
- **"With a bribe"** is kept, and it's made plain. The offer is on the desk the whole time he's there: how many rings, for which stamp, and that it's still a mistake. The design rule (§3.9, `docs/voice.md`) is that consequences come from choices, never from slips. A bribe hidden in his words would be easy to take by accident.
- **The stamp is the answer.** There's no separate choice. Stamping him Valhalla takes the rings; stamping him Hel refuses them. The fairness check proves he belongs to Hel under every whim of the day, like any story soul, so the right stamp is always there to be found.
- **A wrong stamp all the same.** Taking the rings costs what any wrong stamp costs, as a god's request does (§42):
  - no wage;
  - a citation, and a fine once the day's warnings are used up;
  - the standing a Hel soul sent to Valhalla costs (Odin −1, Hel −1);
  - an unworthy man on Odin's benches at Ragnarök;
  - a day that isn't clean, for promotion (§44).

  Nothing is added on top: a first draft had Hel −1 as well, which counted the same wrong twice.

**The rule** (`storyOffer`, `stampRings`; `DayMistake.paid`)
- **An offer is data.** It's a story soul's `onStamp` rings for a stamp other than where it belongs. `storyOffer(content, soul)` finds it, and `stampRings` says what any stamp pays.
- **The same numbers everywhere.** The desk, the audit, the report and the sim all read those two functions, so what the banner promises is what the audit pays.
- **At the audit** the rings come with the story souls' other effects. The day's mistake for that soul is filed with `paid`.
- **Story souls never appeal** (§40), so a bribe can't be taken back the next morning.

**The screens**
- **The desk:** while he's there, a banner reads "Asgaut Thorolfsson offers you 30 rings for a Valhalla stamp: paid at the audit, and a mistake all the same."
- **The citation:** stamping Valhalla is cited on the spot, like any wrong stamp.
- **The audit:** a row "Rings from Asgaut Thorolfsson, +30".
- **The playtest report:** the mistake ends "A bribe: 30 rings for the stamp."

**Day 9** (drafts for your sign-off: `case.jarl`, strings `case.jarl.*`, and three scene lines)
- **Who:** Jarl Asgaut Thorolfsson, from over the mountains. He died in his bed at 74, and his sons put his sword in his hand before he was cold.
- **What shows:** his body shows no wounds and dry lips (a straw death). His words say "I went in my sleep", and nothing he says is a lie.
- **His lines:**
  - "I don't stand in lines."
  - "My sons put the sword in my hand…"
  - "Thirty rings when that stamp says Valhalla. Odin's ring only drips eight."
- **The morning scene** now ends on him: "The first soul at the table didn't queue."
- **That night,** if you took the rings, you count them in with the rest: "They look exactly like the others. You'd hoped they wouldn't."
- **Day 13's night:** Muninn, who has forgotten what he came to say, remembers the jarl either way (`jarl_bribe`, `jarl_refused`).

**Numbers.** `pnpm sim campaign --seeds 40`, with and without `--bribes` (bots that take every offer), plain story. First guesses.

| Bots | Purse at the end | Odin's ending | Host at Ragnarök |
|---|---|---|---|
| Expert | +2 to +23 rings | 60 → 52 of 120 runs | −3 |
| Competent | +14 to +20 | 1 → 0 of 120 | −3 |
| Novice | +2 to +4 (demotions within noise) | — | within noise |

Notes on the table:
- **Why the purse gains less than 30:** the rings are 30, minus the wage he'd have earned, and minus what the standing costs later. A god below a favour's mark can mean chance sickness at home, and medicine to pay.
- **Odin's ending is where it shows.** His −1 is enough to move an expert run in eight under his mark.
- **Careless bots** are demoted before Day 9.
- **Refused,** the day is as it was before, plus the jarl's wage.

**Tests**
- **Engine (3):**
  - he's first on his day, ahead of the souls who waited;
  - `storyOffer` names the stamp and the rings, and no other soul offers anything;
  - taken, the rings reach the purse at the audit, with the wrong stamp's wage, citation, standing and unworthy einherjar, the mistake filed with `paid`, and no appeal; refused, nothing is paid and the day is clean.
- **Sim (2):**
  - only a bot that takes bribes takes it, and its accounts add up;
  - the Day 9 night and Muninn on Day 13 say what they should for each answer.
- **Report (1).**
- **e2e on the full game** (phone and desktop), from a Day 9 save made in Node:
  - he's first in line, with the offer's banner, an accessibility scan and no sideways scroll;
  - taking it is cited, and the banner goes with him;
  - the audit's row;
  - the night's line.

**Known limits**
- **An accidental Valhalla stamp takes the rings too.** The offer is on the desk the whole time, so it never comes as a surprise, but a slip pays like a choice.
- **The 30 is written into his words and two scenes** as well as his `onStamp`. Changing one means changing all four; the case file says so.
- **One bribe in the campaign.** Another is content: a story soul whose stamp pays rings.
- **The words are drafts.**

## 48. After M7: the whole game on GitHub Pages, unlisted

**Why.** The owner wants to play the whole campaign in a browser now (25 September 2026). The playtest build's itch page (§38) was never set up, and the public web demo stops at Day 3. This is the owner's call: the build plan kept the campaign off every public URL, since it's the paid game.

**What changed**
- **The Pages deploy builds two targets.** `deploy-web.yml` builds `web-demo` and `web-playtest` (`web-full` since §65), and runs the leak check on each:
  - the demo must not contain the campaign;
  - the playtest build must.

  It then publishes the demo at the site's root, as before, and the playtest build beside it at `/full/` (`PAGES_FULL` in `targets.ts`): https://rcjlabs.github.io/Chooser-of-the-Dead/full/ (`/Vikings-R-Us/full/` before the rename, §64).
- **Why that build suits the subfolder:**
  - its paths are relative, so it runs from any folder;
  - it registers no service worker;
  - its saves are its own (`cots.playtest.*`, database `chooser-of-the-slain.playtest`), so nothing it keeps touches the demo's.
- **The demo's service worker leaves `/full/` alone.** It answers every page load in its scope (the whole site) with the demo's page. A `navigateFallbackDenylist` now excludes `/full/`. The demo's own builds are unchanged: the leak check still proves they carry no campaign.
- **Unlisted, not private.**
  - Nothing links to `/full/`.
  - The playtest build asks search engines not to list it (`<meta name="robots" content="noindex, nofollow">`), on itch too.
  - Anyone with the link can play the whole game.

**A browser that played the demo before this change** has the old service worker, which answers `/full/` with the demo. After the deploy, the demo's title screen offers the update ("A new version is ready. Update now"); after that, `/full/` works. A private window works at once.

**Checked** by serving the assembled site under `/Vikings-R-Us/`, in Chromium:
- **A fresh browser:**
  - the demo at the root;
  - the whole game at `/full/`, with the demo's worker in control;
  - the `noindex` tag present;
  - a campaign starting at Day 1;
  - only `cots.playtest.*` keys written.
- **A browser with the old worker:**
  - `/full/` shows the demo;
  - the demo then offers the update;
  - after it, `/full/` shows the whole game.

**To take it down:** remove the `web-full` steps (§65) from `deploy-web.yml`, and upload `dist/web-demo` again.

## 49. After M7: mastery: a mark for each day, the day's best, and the oath (gameplay brainstorm, item 10)

**Why.** Good players had nothing left to chase. Expert bots end the campaign with 750–1,150 rings and nothing to buy. A day judged perfectly paid about the same as a day judged well enough, and replaying a day from its morning (§22) had no goal. This gives them three things: a grade for each day, each day's best kept on the device, and an optional oath for a harder run.

The brainstorm's version, and what changed:
- **"A grade for each day"** is kept: five grades, from the day's mistakes and the liars caught.
- **"A personal best, so replaying a day from its save has a goal"** is kept. The best is kept on the device, not in the run, so a replay in another slot can beat it.
- **"An optional oath at the start of a run: no hints, no replays, and fines from the first mistake"** is kept as written. It's chosen with a new campaign, and not with Story Mode.
- **Not added: a score or a board.** Each run has its own seed, so two players' Day 7s have different souls, and a board would compare unlike days. The Daily already has its share line.

**The grades** (`dayGrade`, `DayLedger.grade`)

| Grade | Takes |
|---|---|
| Flawless | every soul judged rightly, and every liar caught in a lie before the stamp |
| Sharp | every soul judged rightly |
| Steady | one soul not |
| Shaky | two or three |
| Rough | four or more |

- **A soul not judged rightly** is one the audit counts as wrong or unjudged:
  - a wrong stamp;
  - a step skipped (the clippers);
  - a soul still in line when the sun set (§41).
- **Caught** is the catch that pays the +1 ring: the lie compared with what contradicts it, before that soul's stamp.
- **A liar counts only if the evidence can expose the lie.**
  - The fairness check promises a contradiction only for lies that change a judgment (F4), so a lie that changes nothing might have none to find.
  - The grade asks the solver which lies it can expose, over the soul's evidence and the day's rules.
  - Measured: 12 seeds × 20 days, 1,635 lies, and every one could be exposed. In practice, then, Flawless means every liar.
- **Assisted** marks a grade played with a slower or faster sun, or with the rule tracker.
  - A campaign without fines doesn't mark it: fines change the purse, not the judging.
- **Story Mode has no grade.** It has no sun and no fines.
- **At the audit,** a card under the ledger gives:
  - the grade;
  - what it was made of, and what the next one up takes, for example "Every soul judged rightly. Flawless also catches every liar in a lie before the stamp: 3 of 4 today.";
  - the day's best on this device.

**The day's best** (`Settings.dayBests`, `beatsDay`, `noteDayBest`)
- **One per day, on the device,** whichever slot or run it came from. What beats what:
  1. the better grade;
  2. at the same grade, a day played without assists;
  3. then more sun to spare.
- **It's kept at the audit,** before the card is drawn, so the card can say "Your best yet for Day 4." or name the best to beat.
- **It's kept with the settings, and so in backups.** Restoring a backup keeps the better of each day's two bests, as it does for achievements (§34). Entries the game can't read are dropped.
- **The campaign screen lists them** under the endings, once there's one: each graded day, then one line for the rest ("No grade yet: Days 5–20").
- **A day is bettered by replaying it** from its morning, in its own slot or a new one (§22).

**The oath** (`NewRunOptions.oath`, `RunState.oath`)
- **Sworn with a new campaign.** It's a checkbox beside Story Mode, and the two can't both be ticked. It holds for the whole run. The slot and each morning say "Under oath".
- **No hints.** The hint button is gone and H does nothing. The engine rejects a hint action too, so a replayed log can't use one.
- **Fines from the first mistake.**
  - The day's warnings are 0 whatever the rank (`economyFor`).
  - A campaign without fines is ignored: the morning's assists don't offer it, and the audit fines anyway.
  - The audit's row reads "Fines for 2 mistakes" rather than "2 more mistakes" when nothing was forgiven. Other runs at a rank with no warnings get the same wording.
- **No replays.** `replayableDays` is empty, so the slot offers no replay and no branch.
  - The game can still start a day again itself when an update can't replay the saved one ("the Norns rewound the day", §16), as for any run.
- **What it doesn't change:**
  - the souls (a seed gives the same souls with or without it);
  - wages, bills and the sun;
  - the other assists. A slower sun and the rule tracker still work, and mark the day's grade as assisted.
- **Its achievement is Oathsworn** (`ach.oathkept`): reach Day 20 under the oath. It's the campaign's 14th, and the 22nd in all.

**Numbers.** 12 seeds, bots that pay every bill, plain story, measured with this change.

| Bots | Liars caught | Days 1–9: Flawless / Sharp / Steady / Shaky / Rough | Days 10–20 |
|---|---|---|---|
| Expert | 78% | 26 / 53 / 18 / 4 / 0% | 8 / 61 / 25 / 6 / 0% |
| Competent | 41% | 5 / 16 / 30 / 44 / 6% | 0 / 11 / 26 / 48 / 16% |
| Novice | 13% | 0 / 2 / 10 / 43 / 45% | 0 / 0 / 3 / 26 / 70% |

Under the oath, the same souls:

| Bots | Fines a day | Purse at the end | Demoted |
|---|---|---|---|
| Expert | 0.0 → 1.9 rings | 800 → 778 | 0 → 0 of 12 |
| Competent | 3.3 → 16.3 | 448 → 237 | 0 → 0 of 12 |
| Novice | 22.1 → 32.3 | (demoted either way) | 11 → 12 of 12 |

Notes on the tables:
- **Flawless is rare late.** From Day 10 more souls lie, and more lies need a tool or the body's back to show. The bots judge every soul the same careful way, so real players will spread wider.
- **The grades are the same with and without the oath:** it changes the purse, not the souls or the judging.
- **For an expert, the oath costs about 20 rings.** A competent player loses half the purse and isn't demoted. The oath is for players who already judge well.

**The bots now catch liars as a player must.** Measuring the grades showed a flaw in the sim.
- **Before:** the bots compared a lie only with what was on the papers' fronts. They never flipped the body or used a tool to find what contradicted it, so in one test they caught 3 of 7 liars.
- **Now:** `catchLie` (testkit) flips the body and uses the tools the contradiction needs, and spends the sun they cost.
- **Effect on the standard sim** (`pnpm sim campaign --seeds 40`), from the +1 ring for each catch:

  | Bots | Purse at the end |
  |---|---|
  | Expert | 762 → 808 |
  | Competent | 438 → 464 |

  - Endings and the host are unchanged.
  - Novice demotions moved within noise: 82.5% → 87.5% of runs that pay every bill, and 45% → 37.5% of frugal ones.
- **Earlier sections' numbers (§40–§47) were measured before this.**

**The playtest report**
- The Days table has a Grade column: "sharp (3/4 liars)", with ", assisted" when it was.
- The header says "under oath" when it was.

**Tests**
- **Engine (5):**
  - grades from mistakes and catches;
  - the assisted mark, and no grade in Story Mode;
  - a lie with nothing to expose it isn't asked for;
  - which best beats which;
  - the oath's rules:
    - no warnings;
    - fined even with the no-fines assist;
    - hints rejected;
    - no replays;
    - not with Story Mode.
- **Sim:** the run that reaches Odin's ending is played under the oath, and earns Oathsworn.
- **Save data (1):** a backup's bests merge day by day, and junk is dropped.
- **Report (1).**
- **e2e on the full game** (phone and desktop):
  - An oath run:
    - Story Mode can't be ticked with it;
    - the terms are on the morning;
    - there's no hint button;
    - the first mistake is fined;
    - the audit shows the grade and "your best yet";
    - the slot says "Under oath" and offers no replay;
    - the best is on the campaign screen;
    - accessibility scans pass.
  - A day's best from before is shown at the audit as the one to beat, and is kept.

**Known limits**
- **The oath is kept on trust.** Restoring a backup from before a bad day undoes the day, and nothing marks the run. Backups exist to keep saves safe, and locking them to the oath would cost that.
- **Bests are per device.** Another browser has its own, and so does the playtest build beside the demo. Backups carry them.
- **A best doesn't say which run it came from.** Runs differ between days:
  - A promoted day has more souls (§44).
  - Odin's favour adds a minute of sun (§43).

  So sun to spare is a tiebreak, not a race.
- **The words are drafts:** the grades' names and lines, the oath's lines, and Oathsworn.

## 50. After M7: family trouble money can't fix, part 1: a trip home at dawn (gameplay brainstorm, item 6)

**Why.** If you paid the bills, the family was never in danger. Sickness follows only unpaid bills, and no bot had ever lost anyone at home. Players who judge well have rings to spare by midwinter (§49), so trouble that costs rings costs them nothing. The brainstorm asked for trouble money can't fix:
- Ragna needs the healer at dawn, which means a shorter shift. That's this part.
- Ulf wants to go raiding, and a neighbour's son turns up in your queue. Those are part 2.

**The mechanic: a trip home at dawn** (`fx: sun`, `RunState.dawnS`, `DayLedger.dawnS`)
- **A scene can give or take sun** on the next shift the run begins. `# fx: sun -120` is two minutes less.
  - A night scene's lands on the next day.
  - A morning scene's lands on that day.
  - The day's audit files it with the day (`DayLedger.dawnS`) and clears it. A night scene after the audit starts the next one.
- **The shift takes it with the day's other sun** (`shiftMods`: upgrades, favours, and now this). The gate always keeps two minutes of sun (the campaign's `minSunS`, in content since §63), whatever a trip takes.
- **Story Mode has no sun,** so a trip costs nothing there.
- **The player sees it before choosing, and after:**
  - the option says "(2:00 less sun tomorrow)", or "today" in the morning;
  - the line after it says so again, like a standing note;
  - the morning says "You were home at dawn: 2:00 less sun at the gate today.", and its sun line counts it;
  - the playtest report lists each day's trip under "Home at dawn".
- **`fx: family X gone`** loses someone at home in a scene: an adult dies, a child goes to relatives, as the night's upkeep does already.
- **`# beat`**, a scene tag. The game notes what a choice did (standing, and now sun) at the end of its stretch of text. A letter written after a choice made that note land after the letter.
  - `# beat` on a new part's first line ends the stretch there.
  - Ink's pointers and visit counts couldn't tell: Continue looks past a line for glue, and ends with no pointer.
  - Day 9's jarl lines use it too, so Ulf's note comes before them.

**Ragna and the hill (the writing, drafts for your sign-off)**
- **Night 10**, if Ragna's at home: her letter.
  - The healer says there's a hill past the falls that mends any woman who climbs it, however long she's been ill: Lyfjaberg.
  - She won't climb it in the snow, and won't ask to be carried.
  - Ulf, or Asa if Ulf's away north, adds that medicine won't mend it, only the hill, and that it only gets worse.
  - The options:
    - **Fly her up at dawn:** `ragna_hill`, and Day 11 loses 2:00.
    - **Send the healer silver instead:** it comes back ("The hill doesn't come down."), and the choice stands.
    - **Let her rest until the thaw:** `ragna_waits`. There's no thaw coming, and the line knows it.
- **Night 13, if she's resting:** the last chance, in Ulf's hand or a neighbour's (Bera): "the hill at first light, or she won't see another."
  - **Fly her up:** `ragna_hill` = 2, and Day 14 loses 3:00. It's a hard day to be short: Hel's hall closes that morning.
  - **"You can't. Not now.":** `ragna_refused`, and she dies in the night (`fx: family mother gone`).
- **The mornings she's carried up** (Days 11 and 14) open with it: nine women on the hill, and one of them, Eir, takes her hands.
- **If she died,** Móðguðr says so on Night 14: she crossed the bridge that morning and asked the way to her father's bench, and Hel, who is letting nobody in, let her in.
- **If she climbed,** her letter on Night 15 says her chest is quiet.

**Lore (established):**
- In *Fjölsvinnsmál*, the hill Lyfjaberg heals every woman who climbs it, "though she have a year's sickness".
- Eir is one of the maidens who sit on it.
- Snorri names Eir the best of physicians.

The poem survives only in late paper manuscripts, not the Codex Regius. Wings for a Valkyrie's horse are the game's own.

**What it costs.** Day 11 has 12:00 of sun for 12–14 souls, 51–60 seconds each. Two minutes less leaves 43–50. Day 14's 3:00 takes 13:40 to 10:40, for 13–15 souls. Worked out, not measured:
- The bots work at 25 seconds a soul, so the sim can't feel it.
- A player who needs about 50 seconds a soul leaves one or two souls at dusk.
- An expert chasing a grade (§49) or a clean day for promotion (§44) feels it most. Rings can't buy it back.

**The bots** give the time: a trip home scores nothing to them, and losing someone at home scores −200. So every story policy flies her up on Night 10, and no ending the sims reach changes.

**Tests**
- **Story:**
  - `fx: sun` and `fx: family X gone` parse;
  - a `# beat` keeps a choice's note with its own part.
- **Engine (3):**
  - a trip lands on the next shift (the night's tomorrow, the morning's today), is filed by that day's audit, and doesn't carry on;
  - the gate keeps `minSunS`;
  - someone at home can be lost: an adult dies, a child goes to relatives.
- **Scenes and sim (4):**
  - Night 10's options, with the silver sent back;
  - the last chance on Night 13, and her death if refused, which Móðguðr tells;
  - the mornings and Night 15 remember it;
  - an expert bot's run gives Day 11 its two minutes, and loses no one.
- **Report (1).**
- **e2e on the full game** (phone and desktop), from a Night 10 save made in Node (`scenarioSave(..., 'night')`):
  - the option's note;
  - the silver sent back;
  - the note after the choice;
  - the morning's line, and its note and sun line;
  - the sun at the desk;
  - accessibility scans.

**Known limits**
- **Death is the price of refusing twice.** It's said plainly both times, and it's the design's point: trouble money can't fix. It's also the heaviest consequence any single choice has, so it's yours to keep or soften. A softer version: she goes to her sister's (`gone`, left).
- **The last chance costs more because Day 14 is hard,** not because anything in the game computes it. Both prices are guesses for playtests.
- **Bots always go,** so the sims say nothing about runs where she dies.

## 51. After M7: family trouble money can't fix, part 2: the levy, and a plea at the desk (gameplay brainstorm, item 6)

**Why.** The rest of the brainstorm's item 6: "Ulf wants to go raiding" and "a neighbour's son turns up in your queue". Part 1 (§50) made trouble cost time. This part makes it cost a stance: whether Ulf goes, and whether a boy from home gets the stamp he asks for.

The brainstorm's version, and what changed:
- **"Ulf wants to go raiding"** becomes the jarl's levy, going up to hold the pass before the snow shuts it. The raiding season is summer, and this is the last winter. It's the same wish: to stand with the men from the valley.
- **"A neighbour's son turns up in your queue"** is Kari, Solveig's boy. Solveig is the neighbour who drowned at the herring on Day 5. He goes up with the levy, dies at the pass, and comes to the gate on Day 16.
- **Both are tied together:** the levy takes him, and Ulf may stand beside him.

**Night 15: the levy** (drafts)
- **If Ulf stayed home** (`ulf_home`, from Day 9), his letter comes after the ferryman's: the jarl's calling the levy, Kari has taken his father's spear down, and Ulf wants to go with him. The options:
  - **"Go, then. Keep your shield up."** Sets `ulf_levy`, and Odin +1: a man given to the levy.
  - **Pay the jarl's steward to strike his name.** The rings come back: "Keep your rings. I'm not a debt." The choice stands.
  - **"Stay. They need you at home."** Sets `ulf_stayed`.
- **If Ulf is in the north, or gone,** the levy is news: Kari has gone up to the pass.

**Day 16: Kari at the desk** (`case.kari`, drafts)
- **Who he is:** Kari Solveigarson, 22, second in line. He died at the pass at sunrise, spear in hand, wounds in front. The fairness check proves he belongs in Valhalla under every whim of the day.
- **His lines:**
  - "Is this where they come from the herring? My mother went at the herring. Solveig, Arne's daughter."
  - "We held the pass till the sun came up. Then we didn't."
  - "I don't need Odin's benches. Send me where she is."
- **The plea** (`plea` on a story soul, `storyPlea`):
  - While he's at the desk, a banner reads "Kari Solveigarson asks for a Rán stamp, to be with his mother: a mistake all the same."
  - The stamp is the answer, as with the jarl's bribe (§47). Rán grants it (`kari_ran`); Valhalla doesn't (`kari_valhalla`).
- **Granted, it's a wrong stamp with the usual costs:**
  - no wage;
  - a citation, and a fine past the day's warnings;
  - Odin −1, for a soul of his sent elsewhere;
  - a warrior short at Ragnarök.

  The mistake is filed with `pled`, and the playtest report says "A plea granted."
- **If the player sent Solveig somewhere else on Day 5,** she isn't in Rán. Nothing says so; the plea is what he believes.

**Night 16: the levy comes home** (drafts), before Thorvald's wood:
- **If Ulf went,** he writes with the wrong hand. He was three shields down from Kari when the line went, and carried him as far as the cairn. His arm is hurt (`fx: family brother sick`), so he needs medicine, as any sickness does.
- **If Ulf stayed,** Kari's shield came home on a cart: "I should have been next to him."
- **Otherwise,** the letter says Kari didn't come down from the pass.
- **Bera, the neighbour, knows where you sent him:**
  - Rán: she dreamed of Solveig at a loom by the sea, with her boy handing her the thread.
  - Valhalla: "Solveig would have hated it, and been proud."

**What the sims do** (`pleas` in `SimOptions`):
- Bots never grant a plea unless told. One that grants it makes one mistake more, on Day 16.
- Bots devoted to another god keep Ulf home, since Odin's +1 counts against them. The rest let him go: the first option wins a tie.
- Ulf's wound costs one night's medicine. Any bot that pays its bills pays that too.

**Tests**
- **Engine (2):**
  - the plea says its stamp, and nobody else pleads;
  - granted, it's a mistake filed with `pled`, with a standing cost like any, and no appeal; refused, the day is clean.
- **Scenes and sim (3):**
  - Night 15's options, and the steward's rings sent back;
  - Night 16 in each case;
  - a bot that grants pleas makes that one mistake.
- **Report (1).**
- **e2e on the full game** (phone and desktop), from a Day 16 save:
  - the banner, with an accessibility scan;
  - granting it is cited;
  - the audit's count;
  - Bera's line that night.

**Known limits**
- **Pleas are only a story soul's.** Generated souls don't ask.
- **The levy is one fight.** Ulf comes home either way. Whether he could die there is yours to decide; it's written so he can't. (Since game phase 12 he can, if you choose him at dawn: §78.)
- **The words are drafts.**

## 52. After M7: variety from run to run, part 1: day events (gameplay brainstorm, item 9)

**Why.** Item 9 of the brainstorm: "day events drawn from the run's seed: a storm day, a plague day, a feast day". Apart from the souls, Freyja's whim and the story, every run's days were the same.

The brainstorm's version, and what changed:
- **"A plague day (Hel's hall overflows early)"** would change a rule before its day, and the rules and their teaching are fixed to their days. It's a sickness now: more who died in their beds at the gate, and a risk at home that night.
- **Events change a day's line, never its shares.** A first version raised a destination's share of the day (more Rán on a storm day). The days' minimum shares fill their lines already, so any rise left the others short of their minimums on most days (tried and measured). So instead, an event drops some of the day's own souls and adds its own among them. The generator's plan for the day is untouched.
- **"The Norns' weave"** (the same rules in a different order, after a first ending) is part 2 (§53). As written it breaks the story: each day's story is built on that day's new rule. It weaves the Order of Judgment's precedence instead of the days.

**How it works** (`campaign.events` in `campaign.yaml`, engine `campaign/events.ts`)
- **The draw.** A new run draws three events from its seed (`drawEvents`, on its own stream) and keeps them in the run (`RunState.events`).
  - Each is a different event, on a different day from 5 to 18 (4 to 18 before §57). No two fall on days running.
  - No event falls on a day with a noon decree (§45), or before its own `since` (a storm needs Rán, Day 5).
  - Runs begun before there were events have none. The demo has none, and neither has the Daily.
- **What an event can do:**
  - **`fewer`:** that many of the day's own souls don't come. They're the last in its line, never its teaching soul.
  - **`souls`:** souls it brings, placed among the day's own at places drawn on its own stream, after the teaching soul.
    - Each is made as the day's souls are: the kind named is tried first, as a teaching soul is. It's bound for the first destination in `to` that kind can reach that day.
    - `since` and `until` pick different souls for different days. A sickness brings straw braggarts to Hel before Day 14, and bedridden souls to the clerk from then on.
    - One who'd share a name with a soul already in the line is passed over.
  - **`sunPct`:** the day's sun, in percent of its own.
  - **`costsPct`:** that night's bills, in percent of the day's.
  - **`sickChance`:** a chance that each of the family who is well falls sick that night, bills paid or not. Hel's favour (§43) scales it as it scales any chance of falling sick.
- **The day's own souls are the same with the event or without it,** apart from those that don't come. `lineFor` applies the event before the souls who waited through the night (§41) take their places, so the gods' requests (§42), drawn from tomorrow's line, see the line the event makes.
- **The rules never change,** so every soul is judged as on any day of its number, and the fairness guarantees hold as they are. The souls an event brings are generated and validated like any other.
- **Where it shows in the engine:**
  - `runContext` and the new `dayContext` build a day as the run plays it, with its event's sun and bills.
  - A campaign shift now starts from that context (`startShift`'s new `ctx`). Before, it built its own, which would have missed a storm's sun; a test caught it.
  - The audit files the event in the day's ledger (`event`).

**The four events** (first guesses, drafts)

| Event | Days | The line | Sun | That night |
|---|---|---|---|---|
| A storm off the sea | 5-18 | 3 of the day's own souls replaced by 3 drowned raiders (Rán) | 90% | |
| Sickness in the valley | 5-18 | 2 replaced by 2 who died in their beds (Hel's, or the clerk's from Day 14) | | 20% chance each for the well, bills paid or not |
| A battle at the ford | 5-18 | 3 more: an honest warrior (Valhalla), a disarmed one and a coward (Hel) | 115% | |
| The jarl's feast | 5-18 | 3 fewer | | food costs nothing |

**Screens**
- **The morning:** a card with the event's name and words. Under them, what it does in numbers: the line's change, the sun's (at the player's sun speed, never in Story Mode), and tonight's bills and sickness. If Hel's favour spares the house, it says so.
- **The night:** the event's line in the family card. The bills' own warning of sickness counts only what the bills add.
- **The playtest report:** "Day events", one line for each day played that had one.

**Content checks** (compiler): names and words exist; enough events for `perRun`; each event can fall on some day. On every day an event can fall on:
- the shortest line keeps 3 souls after `fewer`;
- each of its souls is of a kind the day has, and that kind can reach one of its `to`.

**What the sims show** (`pnpm sim campaign`, 50 runs per policy, the same seeds with and without events)
- **Good players end a little richer:** experts +12 to +17 rings, competent bots up to +16 (1-2%). A battle's three souls pay more than a storm or a feast costs.
- **Novices are demoted a little more often:** 92% against 88% paying every bill, 36% against 30% when frugal.
- **Nobody lost family to a sickness:** bots that pay their bills buy the medicine the next night.
- **The endings came out about as before.**

**Tests**
- **Engine (7):**
  - every event on every day it can fall on (two seeds each): the line changes by the event's count, its souls are bound where it says, and none is a fallback;
  - the draw's rules, and the same draw for the same seed;
  - a storm's line and sun;
  - a battle's and a feast's lines, sun and supper;
  - the sickness's souls before and after Day 14, its risk at night, Hel's favour, and its falling sick on replay;
  - the ledger and the save;
  - requests for an event day drawn from the line the event makes.
- **Compiler (2).**
- **Report (1).**
- **e2e on the full game** (phone and desktop): a sickness day's morning card and its night, and a feast day's shorter line and free supper, with accessibility scans.
- A one-off probe of every event on every day it can fall on (30 seeds each): the souls it brings were of their kind every time.

**Known limits**
- **The day's best (§49) is kept by day number,** so a best made on a feast day stands against one made in a storm.
- **The bots don't feel the sun.** They take 25 seconds a soul and never run short, so a storm's lost minute and a battle's three souls only show as more pay or less. How hard a storm feels is a playtest question.
- **The events' words are drafts.**

## 53. After M7: variety from run to run, part 2: the Norns' weave (gameplay brainstorm, item 9)

**Why.** The brainstorm's "after a first ending, the Norns' weave brings the same rules in a different order". Read as the days' rules arriving in another order, it breaks the story: each day's story is built on that day's new rule (the registry and Geir, the rune-lens and Ulf's copied Ulfberhts, Loki's "don't clip", the clerk, the carver, Loki, Muninn, Hel's strike). So the weave keeps the days and changes the order the rules are *read* in, in the Order of Judgment: the same rules, and where two both hold, the other one decides.

**How it works** (`weaving` in `campaign.yaml`, engine `campaign/weave.ts`)
- **Opening it.** Once a run on the device has reached one of `weaving.after`'s endings, a new run can be begun woven. That list is any Day 20 ending and the early story ending; being demoted, an empty house, and the demo's and slice's ends don't count. Before then, the new-run option is disabled and says what opens it.
- **The draw.** A run begun woven (`newRun({ woven })`) draws one weave from its seed and keeps it (`RunState.weave`).
- **What a weave is.** It gives some rules new places in the Order (`order`); the rest keep theirs.
  - The run's contexts read the rules in that order (`wovenContent`, through `dayContext`): the desk, the rulebook, appeals, the line at dusk, and the requests.
  - It changes a day once two rules in force that day come in another order (`weaveDay`). The morning of that day names the weave and says what it does.
  - A woven run says "Woven" on its mornings and its slot. The rulebook marks the rule it moved: "(the Norns' weave)".
- **The day's own souls are made exactly as in an unwoven run,** then seen under the weave's order (`underWeave`). Each keeps its truth, lies and look, and is judged and dressed with evidence the way the line at dusk dresses a soul for a new day (`dressForDay`, §41).
  - So the generator's figures are the unwoven ones, and every soul still meets the fairness contract under the rules as read.
  - A soul no dressing fits would give its place to one made under the weave. None has been seen.
  - Tried first: making the souls under the woven order directly. Souls of a kind two rules claim were then made for halls their sampler rarely reaches, and the acceptance gate failed (15-28% for baptized souls under the clerk's weave).
- **Its own souls.** On its own, a weave decides few souls: measured, 2% and 3% of them from its first day. So each woven day from its first also brings two souls that both reordered rules claim, in place of two of the day's own (a swap, as a storm's are). They're made under the weave, of their kind if the generator can, and none on a day with a noon decree.

**The two weaves** (drafts)

| Weave | What moves | First day | Its two souls a day |
|---|---|---|---|
| Rán's thread first | Rán's rule is read before the registry's and the clerk's: the drowned are hers, even outlaws, even the baptized | 6 | From Day 10: baptized souls who drowned (Rán's, not the clerk's) |
| The clerk's thread last | The clerk's rule is read after every hall's but Hel's: the baptized are his only when no other rule claims them | 10 | A baptized warrior who fell well (Odin's or Freyja's), and a baptized soul who drowned (Rán's) |

- **Dropped on the way:**
  - The clerk's thread first (baptized outlaws): the generator can't find them often enough to bring any.
  - Freyja's thread first (borrowed blades before her whim): whether a borrowed blade is hers depends on the day's whim, and on some whims none can be.
- **The story souls are checked under each weave by the compiler.** None of them changes hall.

**Measured** (a probe of 20 seeds a day, and `pnpm sim sweep --weave`)
- **How much it decides:** with its own souls, a weave decides 11-12% of souls from its first day.
- **Its own souls are contested nearly always:** 100% of Rán's, and about 83% of the clerk's. The rest are souls of another kind, when the generator can't make a baptized warrior for the day.
- **Every soul dressed:** no failures in about 11,000.
- **The bots:** the careful bot judges everything rightly. The one that trusts testimony gets 55-63%.

**What the sims show** (`pnpm sim campaign --weave`, 50 runs per policy, against the same seeds unwoven)
- **Rán's thread first makes Ragnarök harder.** The drowned count for nothing in the host, and its souls take the places of souls that counted.
  - Hosts are about 23 weaker.
  - "The wolf wins" comes for competent bots in 1-3 runs of 50, where it never did.
  - Novices are demoted a little more often.
- **The clerk's thread last leaves the host about as it was.** A baptized warrior sent to Valhalla counts twice, and one sent to Rán counts for nothing, as with the clerk.
- **Rings barely move.** The bots judge by the rules as read, so a weave costs them nothing to learn. For a player it's a new order to learn; that's the point of it, and a playtest question.

**Checks**
- **Compiler:**
  - the endings that open it exist, and so do the rules it moves;
  - every weave changes some day, and Hel's catch-all is still read last on every day;
  - it can bring its souls on every day, under every choice of the day's params;
  - the story souls are made under each weave.
  - The event souls' check (§52) now uses every param choice too.
- **The sweep's `--weave`:** each day is made as usual and its souls dressed for the weave.
  - The bots and the destinations use the woven souls; the generator's figures and the day's mix count the souls as made.
  - Souls no dressing fits are held to the fallbacks' rate.
  - Per push: 30 seeds per weave, checking every soul dressed, the careful bot at 100%, and the trusting bot at 65% or less.
  - Nightly: 2,000 seeds per weave, with every gate.

**Tests**
- **Engine (5):**
  - the draw, and what opens it;
  - the order from its first day, and the moved rule marked;
  - the day's own souls the same people judged in its order, with its two in place of two, and those contested;
  - every soul fair under its order;
  - the save.
- **Compiler (2), the woven sweep (1).**
- **e2e on the full game** (phone and desktop):
  - the option before and after an ending;
  - a woven run's marks;
  - a woven Day 10's note and rulebook order, with accessibility scans.

**Known limits**
- **Two weaves only,** and a woven run shows which one on the first day it changes.
- **The weave's souls take the places of the last souls in the line as the day's event left it.** On an event day, one of those can be a soul the event brought (a storm's drowned raider, say).
- **The words are drafts.**

## 54. After M7: a Ragnarök you fight (gameplay brainstorm, item 8)

**Why.** The brainstorm: twenty days of judging fed a single number; instead, after Day 20 the hosts the run filled go to the fronts, their strength coming from who was sent where. Two things were wrong with the number as it stood:
- **It barely mattered.** In the nightly sims, competent bots' hosts came to about 290 and experts' to about 328, well past the endings' 260 and 240. Only novices came near.
- **It barely told skill apart.** A host counted every soul sent to its hall, right or wrong, so a novice's Freyja's host (29) was bigger than an expert's (25). Only the unworthy einherjar and the nails left long said anything about judging.

**How it works** (`ragnarok` in `campaign.yaml`, engine `campaign/battle.ts`)
- **When.** After the last night comes the horn: a new phase, `ragnarok`, where the hosts wait for their fronts. An ending checked before any that reads the battle still ends the run first: demoted, an empty house, Naglfar sailing early. The demo, the vertical slice and builds without `ragnarok` end as before.
- **The hosts** are the souls sent to each hall: Odin's einherjar (Valhalla), Freyja's host (Fólkvangr), Hel's legion (Hel) and Rán's drowned (Rán).
  - A soul sent there rightly fights. One sent there by mistake breaks and runs; for Valhalla that's an unworthy soul, as before.
  - The audit now counts those per hall (`RunState.misfits`). A soul given to a god who asked for it, with the request done in full, is the god's and doesn't count. An appeal that rights a soul takes it out.
- **The fronts**, each a host's own:

  | Front | Foe | Host |
  |---|---|---|
  | the wolf | Fenrir, 100 (120 since §58) | Odin's einherjar |
  | the fire | Surtr, 70 (84 since §58) | Freyja's host |
  | Hel's gate | Garm, 130 (156 since §58) | Hel's legion |
  | the shore | Naglfar, 35 (42 since §58), and 2 more for each soul sent on with its nails long | Rán's drowned |

- **Strength.** At its own front each soul sent rightly counts 2 and each who runs costs 1. At any other front a soul counts 1. The drowned fight only at sea.
- **The order.** The player sets the order the fronts are held in.
  - Each in turn is held if the hosts can hold it along with those before it: its own host first, then what the other hosts can spare, 1 a soul. The check is exact (`fight`); where there's a choice, spare souls come from the host with most to spare.
  - A front that can't be held falls, and its host's souls go where they're needed.
  - The screen shows, as the order changes, which fronts will hold. Then the horn: how each front went, then the ending. The ending's achievements wait for the ending, so none names it over the battle.
- **The endings read it**, through `fronts` (how many held) and `front.<id>`:
  - **The green earth:** the fire held, and three fronts in all. It was a host of 260.
  - **The wolf wins:** one front held or none. It was a host of 240 or less.
  - **Freyja's own, Chooser eternal and Hel's steward** now each need their god's front held (the fire, the wolf, her gate), as their words say.
  - The rest are unchanged. Before the battle, `endingFor` checks only the endings ordered before the first that reads it.
- **The ending's report** shows the battle front by front, and what the endings ask of it (`battleMarks`), naming unfound endings as before. The host's number is no longer shown, since no ending reads it.

**Tuning** (the foes searched against the hosts of 60 sim runs per policy)
- **The first foes had one right answer.** Hel's legion is three times any other host, so the best order was always to give up Hel's gate and send her legion everywhere else.
- **Counting who runs made the hosts tell skill apart.** Effective hosts for expert, competent and novice bots:

  | Host | Expert | Competent | Novice |
  |---|---|---|---|
  | Einherjar | 54 | 47 | 33 |
  | Freyja's | 23 | 17 | 10 |
  | Hel's | 86 | 73 | 53 |
  | The drowned | 28 | 23 | 13 |

- **The foes above:**
  - Experts hold all four in about half their runs, and otherwise can give up any of the wolf, the fire or the gate.
  - Competent runs hold three, most with two or three fronts they could lose.
  - Novices hold one.

**Measured** (`pnpm sim campaign`-style runs, 60 per policy, frugal nights; endings before this in brackets)

| Bots | Fronts held | Endings |
|---|---|---|
| Expert, plain | 4 in 60% | last stand 35, Odin 25 (Odin 48%) |
| Competent, plain | 3 in 97% | last stand 59, Odin 1 (the same) |
| Novice, plain (39 of 60 reach Ragnarök) | 1 in 64% | the wolf 25, last stand 14 (the wolf 78%) |
| Competent, Odin's story | 3 in 95% | Odin 28 (50%) |
| Competent, the green earth's | 3 in 97% | the green earth 58 (98%) |
| Expert, Freyja's, serving her | 4 in 73% | Freyja's own 60 |
| Expert, Hel's, serving her | 4 in 48% | Hel's steward 57 |
| Competent, leaving nails long | 2 in 95% | last stand 60 (the wolf 55%) |

**Checks**
- **Compiler:**
  - the words exist;
  - front ids are `front.<name>`, for endings to read;
  - each host's own front exists, and no two hosts share a front or a hall;
  - an ending reads the battle only in a build that has one, and only its fronts.
- **Sims:**
  - Bots take, of every order, one that holds the most fronts, with their story's god's front among them (`botOrder`).
  - The campaign table's host column is now fronts held.
  - Every ending is still reached, and so is the new achievement, Every front held.

**Tests**
- **Engine:**
  - the battle (8, one a 300-run property test: every front said to hold does, and every front that fell couldn't have held after those before it);
  - the run (5): the horn, an early ending first, the endings that read it, the save, no battle in the demo or the slice;
  - souls sent to the wrong hall (1), with appeals and requests checked too.
- **Compiler:** 2.
- **e2e on the full game** (phone and desktop, axe scans):
  - the last night to the horn, and the hosts;
  - a front moved to the top, with focus kept on its other button, and the fronts that hold changing with it;
  - the battle, then the ending with the battle in its report;
  - the ending's achievements held back until the ending.

**Known limits**
- **The foes are tuned on bots.** A bot's mistakes fall at random; a player's don't (a misread whim, say), so which hosts come up short will differ. That's a playtest question.
- **Leaving nails long now costs the shore, not the war.** The sims' "wolf" story policy leaves two long a day, and now ends on the last stand instead of the wolf. Weak judging brings the wolf, as the reach test shows.
- **Runs begun before this counted no misfits on their earlier days,** so their hosts come out stronger.
- **The words are drafts.** Some ending texts read oddly after a battle: the clerk's transfer "when the horn blows".

### Part 2: the souls it names

**Why.** A count of souls who run says the judging mattered; a name says which judgment it was. The battle now names the souls the player sent wrong who run from a host, and the story's own souls who stand in one, so a misjudged soul from Day 6 turns up at Hel's gate on the last night.

**How it works**
- **The record.** `RunState.named` lists, for each host's hall, the souls the battle names (`NamedSoul`: name and patronym, the day, the hall, whether it runs).
  - **Who runs:** the same souls the counts already call misfits. To Valhalla, an unworthy soul. Anywhere else, a soul sent there by mistake that wasn't given to a god who asked for it.
  - **Who stands:** a story soul sent into a host that won't run from it. That includes one given to a god (to Valhalla, if it's worthy), and a worthy story soul sent to Valhalla by mistake.
  - Nobody else is named. Halls without a host (RETURN, TRANSFER, DETAIN) name nobody, and neither do builds without the battle.
- **When it's kept.** The audit adds each day's names beside the misfit counts. An appeal moves the soul's name with the soul: out of the host it was in, and into the one it's sent to if it runs there. When two souls share a name and a day, only one leaves.
- **The screens** show three names at most, earliest first ("Geir Hallsson (Day 6)"), then how many more, counted from the host's misfits rather than the names:
  - **The horn:** under each host, "Among those who'll stand: …" and "Who will run: …".
  - **The battle:** under each front, who ran from its own host, and the story's souls who "fought here" when their host stood there.
  - **The ending's report:** who ran, front by front.
  - **The playtest report:** every name under each front, the runners and the story's souls.

**Measured.** The list is short, and every morning in the save carries it. In bot runs (one each) it named 12 by the horn at 97% accuracy and 31 at 85%. Across a run's mornings that adds 7–16 KB to a save of about 250–280 KB.

**Tests**
- **Engine** (4):
  - each host's names, runners apart from the story's, in the order of their days (`namedIn`);
  - in the full game, each host's named runners are as many as its misfits (to Valhalla, as many as the unworthy), and every name is in a host's hall;
  - a perfect run names only the story's souls, none of them running;
  - an appeal takes a righted soul's name out, and one upheld in another wrong hall runs from that hall instead.
  - The demo names nobody.
- **Playtest report:** the names under each front.
- **e2e:** a Day 20 save with five souls who'll run from Hel's legion, four of them named. It checks the names and "and 2 more" on the horn, the battle and the report, on phone and desktop, with axe scans.

**Known limits**
- **Runs begun before this name nobody from their earlier days.** Their counts are still shown, with "N more" making up the difference, and a host whose runners have no names shows only the count.
- **Which souls stand where is told, not modelled.** The battle moves numbers, not souls. A story soul is said to fight at its own host's front whenever that host stood there, even when some of its host went elsewhere.
- **A name alone can repeat.** Generated souls avoid the story's names, but two generated souls can share a name on different days; the day tells them apart.
- **The words are drafts** (six strings, core `ui.ragnarok.soul`, `.more`, `.stand`, `.willRun`, `.fled`, `.foughtHere`).

## 55. After M7: what became of them (the endings and an epilogue)

**Why.** The rundown after item 8 found the endings the thinnest part of the game: 19 to 44 words each, for twenty days of play, where the plan budgeted about 700. Meanwhile the run knows far more than the endings used: where the family was when the horn blew, who went up the hill and who went to the pass, how each power was treated, and where each of the story's own souls was sent.

**How it works**
- **Fuller endings.** Each of the nine campaign endings is now a short scene of three or four paragraphs, about 125 words, drawing on what the run was (the nails, the questions asked, the ferry's fare, the contract, who said the quiet dead count). The failures (demoted, an empty house) and the demo's and the slice's ends are as they were. The ending screen and the gallery show an ending's paragraphs.
- **The epilogue** (`epilogue` in `campaign.yaml`, engine `campaign/epilogue.ts`). After the ending's own words, a card: "What became of them", in three parts (at home, the powers, the dead you judged).
  - **Slots.** Each slot says the first of its lines whose condition holds; a line without one always does, so it goes last. A slot none of whose lines holds says nothing.
  - **Conditions** read the finished run the way the endings do, plus two new paths: `member.<id>.<how>` (well, sick, gone, died or left), and `ending.<id>`, which only the epilogue may read (while a run goes on it has no ending).
  - **When.** Not after a failure, or the demo's or the slice's end (`epilogue.when`). Naglfar can sail on Day 18 or 19, before the horn, so lines that tell of the horn or the battle ask for Day 20.
  - **Nothing twice.** A god's own ending already says what became of them and you, so that god's slot is silent at it; the ship's, the ferry's and the wood's endings say where the family went, so the slot that says it is silent there.
  - **The story's souls.** Four now record where they were sent: Halla (`halla_judged`, `halla_transfer`), Thrand (`thrand_judged`, `thrand_valhalla`), Solveig (`solveig_ran`, `solveig_elsewhere`) and Old Hrolf (`hrolf_hel`). Kari's line reads whether his mother is in the hall he asked for; a run begun before these were kept knows neither, and its line only says he went to be with her.
  - **Numbers.** Its words may use `{rings}`, `{day}`, `{fronts}` (held) and `{ran}` (who ran at the battle); none does yet.

  | Part | Slots (lines) |
  |---|---|
  | At home | where the family was (7), Ragna (5), Ulf (6), Asa (5) |
  | The powers | Skögul (4), Odin (4), Loki (6), the clerk (4), Hel (2), Freyja (2) |
  | The dead you judged | Thorvald (5), Geir (4), Old Hrolf (2), the jarl (3), Kari (6), Thrand (3), Halla (2) |

- **For review.** The story script (`pnpm story:script`) shows the epilogue with each line's condition in words, and counts its flags as read. The playtest report lists what the epilogue said, by part and slot.

**Measured** (56 bot runs: 14 policies, 4 seeds each). The bots' epilogues said 36 of the 70 lines. Their story policies choose narrowly: they always fly Ragna up the hill, send Ulf north, leave the roof and never lie to Odin. So most family lines past the first, and the lines for choices no policy makes, are for players.

**Checks**
- **Compiler:**
  - the words exist;
  - conditions read run state there is;
  - `member.*` names someone in the family, and `ending.*` an ending;
  - only the epilogue reads the ending;
  - no line follows one that always holds;
  - slot ids are unique.
- **Engine** (7):
  - each slot's first line that holds, in order;
  - the member and ending paths;
  - the epilogue's own `when`, and its numbers;
  - every shipped line can be said: a search over the values its slot's conditions name, each tried in a run built to have it and read back through `epilogueFor`;
  - a whole run says something in every part, and nothing after a failure.
- **Compiler tests** (2).
- **Playtest report:** the epilogue by part and slot.
- **e2e** (phone and desktop, with axe scans): the ending's paragraphs, then the epilogue, slot by slot in the parts' order, as the engine says.

**Known limits**
- **"Can be said" is logic, not story.** The search takes flags as independent, and the story ties some together (a Thorvald sent home on Day 16 was judged that day too). So a line can pass the check and still never come up. Skögul's last line needs an ending at Day 20 without the battle, which the campaign doesn't have; it stays as a fallback.
- **Bots show about half the lines,** so the rest rest on the search and on players.
- **Some refuges are left open.** When the wood's or the ship's ending doesn't come, where they leave the family stays open: the wood's line says the song doesn't say, and the ship's has only Loki's word.
- **The words are drafts:** about 3,000 of them (the nine endings, 70 lines), for sign-off like the rest.

## 56. After M7: rings with a late job, and a softer bottom

**Why.** The rundown after item 8 found both ends of the economy broken.
- **Nothing to buy late.** Expert bots bought all 13 upgrades (390 rings in all) and still ended the run with about 800 rings they had no use for.
- **A cliff for novices.** Novices who paid every bill went into debt as winter bills rose from about Day 9, and 29 of 30 were demoted.

**How it works**
- **Arms for the last battle** (`arms` in the campaign's `campaign.yaml`; the demo has none).
  - From Night 13 the night screen has a quartermaster's card. It sells one lot of arms a night, for the front the player chooses.
  - Each lot is dearer than the last: 40, 60, 80, 100, 120, 140 and 160 rings, 700 in all. The lots run out after seven.
  - Each lot adds 6 strength at its front when the horn blows. It counts after the front's runners: strength = max(0, souls' strength − runners + arms), so arms can't hide a rout.
  - Each front on the card says whether it would hold if the horn blew tonight, and at what strength against what foe. That's the battle as the horn's screen first shows it, fronts held in the order listed, with tonight's hosts. Before this there was no view of the fronts until Day 20, so a purchase would have been a guess.
  - Arms aren't sold in the vertical slice. The state path `arms` counts the lots bought, for content to read; nothing reads it yet.
- **Upgrades sell back** (`sellBack`, a percentage; 50 in the demo pack, so both builds have it).
  - At night, each owned upgrade has a button to sell it for half its price, rounded down.
  - Once sold, it's back in the market at full price.
- **Skögul's reprieve** (`reprieve`, in the demo pack, so both builds have it).
  - The first night a debt would demote you, Skögul pays it: the purse is set to 0, the count of nights in debt starts over, and the run gets the flag `skogul_paid`.
  - It happens once a run, and never under the oath.
  - The night's outlook says so before you sleep, and shows the purse the morning will have. The night doesn't warn about demotion that night.
  - The morning's news says who paid. On Night 19, Skögul mentions it.
  - Another ending that holds that night still ends the run. For example, if no one is left at home.
- **The accounts.**
  - Each night files the rings spent on arms (`arms`), the rings from anything sold back (`sold`) and what the reprieve paid (`reprieve`). The day's sums still come to the purse.
  - The run keeps the arms at each front (`armed`), the lots bought (`armsBought`) and the night of the last one (`armedOn`). `trade`, tonight's arms and sales, is cleared when the night ends.
  - Every new field is optional, so older saves load unchanged.

**Tuning.** The same 60 seeds per policy were run with and without the changes, with story policies playing the scenes.

| Policy | Rings at the end (before → after) | Fronts held, before | Fronts held, after | Demoted (before → after) |
|---|---|---|---|---|
| Expert, pays every bill | 833 → 133 | 4 in 38 runs, 3 in 22 | 4 in all 60 | 0 → 0 |
| Competent, pays every bill | 455 → 112 | 3 in 59, 2 in 1 | 4 in 6, 3 in 54 | 0 → 0 |
| Competent, frugal | 871 → 176 | 3 in 59, 2 in 1 | 4 in 20, 3 in 40 | 0 → 0 |
| Novice, frugal | 46 → −5 | 1 in 25, 2 in 19 | 1 in 25, 2 in 27, 3 in 1 | 16 → 7 (16 reprieved) |
| Novice, pays every bill | −85 → −57 | 1 in 2, 2 in 5 | 1 in 19, 2 in 16 | 53 → 25 (42 reprieved) |

- **Endings.** The endings of runs that reach the battle don't change: expert Odin endings are 31 of 60 either way, and Odin's policy gets 32 either way.
- **Strength per lot.** Lot strengths of 4, 5, 6 and 8 were tried. Every one gives experts all four fronts in every run, because their shortfall at the fourth front is small. At 6, competent players who save hold a fourth front in a third of runs, and those who pay every bill in a tenth.
- **All accounts add up.** The sim's ledger check covers arms, sales and the reprieve.
- **`pnpm sim campaign`** (200 runs per policy, no story choices):
  - Experts buy all seven lots and hold all four fronts.
  - Competent players buy 4.5 to 6.9 lots and hold 3.1 to 3.3 fronts on average.
  - Novices who pay every bill are demoted in 36% of runs, 70% having been reprieved first. Careless players are still demoted in every run.

**The bots.**
- **Arms.** A bot buys a lot when the rings left would still cover tonight's bills and the next three nights', plus the fare on the ferry's path, with 10 to spare. It arms its policy's front if the battle would lose it, otherwise the lost front with the smallest shortfall.
- **Selling.** A bot in debt sells its dearest upgrades when the night would leave it below the debt floor.
- The sim reports arms bought and runs reprieved.

**Checks**
- **Compiler:**
  - `sellBack` is 0–100;
  - the reprieve's words exist and its ending is one;
  - arms need a battle;
  - arms fronts are the battle's, each listed once, with their words;
  - arms go on sale before the last night.
- **Engine:**
  - arms: the sale window, one lot a night, dearer each time, a front not in the battle, a thin purse, running out, the night's accounts, and a front held by arms;
  - sell-back: the refund, not twice, not what the run hasn't got, not by day;
  - the reprieve: the outlook and the night agree, it pays once, never under the oath, and on the last night the horn still blows;
  - the debt's older tests now spend the reprieve first;
  - the battle's property test adds arms. That test found a bug: runners' cost was dropped at a front with arms.
- **Playtest report:**
  - an Arms column (in builds that sell arms);
  - the Shop column net of anything sold;
  - the reprieve beside the rings;
  - arms by front and the reprieve's night in the summary.
- **e2e** (phone and desktop, with axe scans):
  - buying a lot and what the card then says;
  - the horn counting arms;
  - selling back;
  - the reprieve's note and the next morning's news.

**Known limits**
- **Experts can't lose a front any more,** at any lot strength worth buying. The battle's order still matters for everyone else.
- **Tonight's view understates the early nights,** since the hosts grow until Day 20. It also uses the listed order, which the player may change at the horn.
- **The debt banner still says the next night in debt means demotion,** even while the reprieve is unspent. It's the rule; the reprieve shows itself as the exception, on the night it applies.
- **Novices who pay every bill are still demoted** in 25 of 60 runs (frugal ones in 7). The reprieve covers one night, and a second debt still ends the run.
- **A run demoted before this build can reopen.** A save replays its last day's actions with the engine it's loaded by, and the night that demoted it is one of them. If the reprieve wasn't spent, it now pays that debt, and the slot goes on to the next morning. The ending stays found in the gallery. Bumping the engine's version would avoid it, but would rewind every day in progress instead.
- **The words are drafts:** about 250 of them, for sign-off like the rest.

## 57. After M7: a lighter Day 4, Loki's favour, and the clerk's contract kept

**Why.** Items 4 and 6 of the rundown.
- **Day 4 piled up.** Freyja's stamp and her daily demand, the first promotion offer, the first gods' requests and the first possible day event all began that day. Of 60 expert runs, the offer came on Day 4 in 34, a request in 24 and an event in 14.
- **Loki had no favour.** §43 left it as the place for the Naglfar plot to pay out during a run.
- **The clerk's contract was offered once,** on Day 18. "Not yet" was final, though he says it will keep, so courting him only mattered for the standing his ending needs.

**How it works**
- **Day 4 teaches Freyja's stamp alone.**
  - Requests start on Day 5: `requests.from`, and Freyja's and Odin's `since`.
  - Day events fall on Days 5–18: `events.from`, and each event's `since`.
  - The first promotion offer comes from Day 6 (`promotion.from`). Clean days before it still count towards it.
  - Runs already under way keep the events they drew when they began, and the offers and requests already made.
- **Loki's favour** (`fav.loki` at standing 4, `fav.loki.more` at 8; the new effect `nailRings`).
  - At the audit he pays a ring a nail: 10 rings for each soul sent on with its nails uncut, and 20 at the second mark.
  - Each is still a mistake, with its citation, its fine past the day's warnings, no wage, and the standing its hall's god loses. At the first mark the pay about makes up the wage (8 to 10 rings from Day 7).
  - The day's accounts file it (`nails`), and the purse comes to them.
  - The audit shows it as its own row, under the name he goes by that day: the stranger, before Day 12.
  - The playtest report has a Nails column, in builds with such a favour, and notes the rings among the day's favours.
- **The favour guide** on the morning screen now lists only the powers met so far, as the standing strip does. It no longer names the stranger, or the clerk, before the story does.
- **The clerk's contract, kept.**
  - "Not yet" on Day 18 now sets `clerk_later`.
  - On Day 19's morning, if the contract isn't signed and his standing is at his favour's mark (3), he offers it once more, for the same ten rings. "No" closes it.
  - "My place is at this gate" closes it on Day 18.
  - His ending still needs the contract. That's its premise: he wouldn't transfer anyone without the paperwork.

**Measured** (60 runs per policy on the same seeds, story policies playing the scenes)

| | Before | After |
|---|---|---|
| Experts offered promotion on Day 4 / 5 / 6 | 34 / 8 / 24 | 0 / 0 / 27 |
| Experts asked a request on Day 4 / 5 | 24 / 31 | 0 / 30 |
| Runs with a day event on Day 4 / 5 | 14 / 12 | 0 / 9 |
| Freyja's ending, expert / competent courting her | 58 / 49 | 56 / 45 |
| Hel's ending, expert / competent courting her | 57 / 19 | 56 / 20 |
| The clerk's ending, expert / competent courting him | 58 / 48 | 60 / 50 |
| Promoted experts' rings at the end | 430 | 397 |

- **Loki's favour, with and without** (payAll):
  - Bots that take his deal are paid 114 rings (expert) and 197 (competent) over about 7 days. Their runs end on Day 18 with the ship, as before.
  - The policy that takes his deal and breaks it on Day 18 is paid 82.
  - Novices, whose missed disguises raise his standing by accident, are paid 34. They're demoted a little less (19 of 60 against 22).
  - Endings are the same either way, and every day's accounts add up.
- **`pnpm sim campaign`** (200 runs per policy, no story choices):
  - Novices who pay every bill are now demoted in 29.5% of runs (36% before), and those who buy upgrades first in 59.5% (63%).
  - Experts and competent players end as before.

**Checks**
- **Engine:**
  - Loki's pays a ring a nail for each soul sent uncut, twice that at the second mark, and nothing below the mark or when every nail is cut; the purse comes to the day's accounts;
  - day events are drawn on Days 5–18.
- **Scenes:**
  - the contract is offered on Day 19 only after "Not yet" and at the clerk's favour mark (a test ties the scene's number to the content's);
  - signing costs ten rings and gives the contract and his +2;
  - the offer is locked when too poor;
  - it isn't offered after the refusal, below the mark, or once signed.
- **Report:** the Nails column, only where a favour pays for nails, and the note among the favours.
- **e2e** (phone and desktop):
  - Loki's favour on Day 9, under the stranger's name, paid at the audit for each soul sent uncut;
  - promotion on Day 6;
  - the Day 5 favour test courting the four gods, with the guide listing only the powers met.

**Known limits**
- **Loki pays for mistakes, on purpose.** At the second mark, 20 rings a soul beats the wage, fines aside, so leaving nails long pays. For bots that take his deal the ship sails on Day 18 anyway. A player could still reach 8 by letting his disguises go without the deal, at 2 of Odin's standing each.
- **The guide hides the powers not yet met,** so no one can plan for the clerk's favour before Day 10.
- **The clerk's second offer is on Day 19 only,** and his ending still needs the contract. A run that never said "Not yet" doesn't see it.
- **The words are drafts:** about 150 of them (Loki's two favours, the audit's row, the clerk's Day 19 beat).

## 58. After M7: where you ride, and a harder last battle

**Why.** Item 7 of the rundown. The order of the fronts was the battle's only choice, and arms (§56) made it no choice at all for the best players: expert bots held all four fronts in every run, with about 28 strength to spare. Without arms they were on a knife-edge (about 2 to spare).

**What was tried first.** Foes that come at a strength drawn at the horn (±10% to ±25% of their own, shown as a range), with the ride fixing one front at its own. Experts still held all four in 96–97% of runs, and everyone else's battle only got more random. Dropped.

**How it works**
- **The foes are a fifth stronger:** the wolf 120, the fire 84, Hel's gate 156, the shore 42, and 2 more on the shore for each nail left long, as before.
- **Where you ride.** At the horn the player picks one front to ride to (`ride` in `ragnarok`, `strength: 15`), and is worth 15 there.
  - The ride counts the way arms do: after the front's runners, never through them.
  - The horn waits until it's chosen. Each front says, as the ride and the order are set, whether it will hold.
  - The battle keeps where the player rode (`battle.ride`), and the front ridden to shows "you 15" wherever the battle is told: at the horn, front by front, in the ending's report, and in the playtest report.
  - The engine takes a horn without a ride (older callers, and a build whose battle has none), and refuses a front there isn't.
- **The bots** choose the ride with the order: of every front to ride to, the one whose best order holds the most fronts, their god's among them. The arms they buy count on that ride.

**Measured** (60 runs per policy, the same seeds as §56's tuning, story policies playing the scenes)

| Policy | Fronts held, before | Fronts held, after | Endings, after |
|---|---|---|---|
| Expert, plain | 4 in all 60 | 4 in 39, 3 in 21 | Odin 32, the last stand 28 (as before) |
| Competent, pays every bill | 4 in 6, 3 in 54 | 3 in 56, 2 in 4 | as before |
| Competent, frugal | 4 in 20, 3 in 40 | 3 in all 60 | as before |
| Novice, pays every bill | 1 or 2 | 1 in 28, 2 in 17 | the wolf 28 (19 before) |
| Experts courting Odin, Freyja, Hel; the rebirth | 4 in all | 4 in 32–53 | 60, 57, 56, 60 of 60 (as before, within one or two) |

- **The best players** now lose a front in about a third of runs, and choose which. Their god's front, the one their ending needs, holds every time.
- **The ride decides a front for everyone.** It isn't a formality: in the e2e run, the order alone holds the wolf or Hel's gate, and riding to the wolf holds both.
- **Novices lose more fronts,** so more of their runs end with the wolf.
- **The full campaign sim** (`pnpm sim campaign`, 200 runs per policy, plain story) agrees. Mean fronts held, before → after:
  - experts 4.0 → 3.6–3.7;
  - competent players 3.1–3.4 → 3.0;
  - novices 1.5–1.6 → 1.3–1.4, with the wolf ending 35–96 → 47–119 runs of 200.

  Demotions, reprieves and rings are unchanged, since the battle comes after the last audit.

**Checks**
- **Engine:**
  - the ride adds its strength at its front only, can hold a front that would fall, is ignored for a front there isn't or in a battle without the ride, and is recorded in the battle;
  - the battle's property test now rides too: every front it says held has the strength, and the chooser is at one front at most;
  - the horn refuses a ride to a front there isn't.
- **Report:** where the chooser rode, and what it was worth.
- **e2e** (phone and desktop, with axe scans): the horn waits for the ride; the order alone holds the wolf or the gate, and riding to the wolf holds both; the battle and the ending follow the ride.

**Known limits**
- **Harder for everyone,** not only the best: novices' runs end with the wolf more often, and competent players keep their third front but rarely reach a fourth.
- **The ride is the same for every player:** 15, not scaled to how well the run went. Scaling it by skill would have given the best players their surplus back.
- **The words are drafts:** about 50 of them (the ride's heading, lead, labels and hint).

## 59. After the rundown: the one-off systems, used more often

**Why.** Item 2 of the rundown. Each of the systems that interrupt a day had been used once: one god at the desk (Day 18), one bribe (Day 9), one noon decree (Day 19), and pleas from one story soul (Day 16). There were two weaves and four day events. The code behind each was general; the content wasn't.

**What's new**

| System | Before | Added |
|---|---|---|
| A god at the desk (§46) | Odin, Day 18 | Freyja (Day 11), Loki as the old woman Þökk (Day 15), Hel (Day 17) |
| A bribe (§47) | Jarl Asgaut, Day 9: 30 rings for Valhalla | Hrapp Oddsson, a miser (Day 13): 40 rings for a Return stamp |
| A noon decree (§45) | Freyja's whim, Day 19 | Odin's claim, Day 18 |
| A plea (§51) | Kari, Day 16 | ordinary souls, on half the days from Day 7 |
| Day events (§52) | storm, sickness, battle, feast | a hard frost (from Day 10), the jarl's hunt (from Day 6) |
| The Norns' weave (§53) | Rán's thread first, the clerk's thread last | Freyja's thread first |

**Gods at the desk** (drafts: `scene.d11.desk`, `scene.d15.desk`, `scene.d17.desk`)
- **Freyja, Day 11, after 4 souls.** She's looking for her husband, Óðr, who went travelling and hasn't come back, and weeps red gold for him (Gylfaginning).
  - "I'll watch for him" sets `watch_odr`; she asks about it on Day 15's morning.
  - Her tear: send it home to Asa (`tear_asa`, which the epilogue remembers) or give it back (Freyja +1).
  - The tear isn't rings: a desk scene's effects land at the audit, which has no row for rings a scene gives.
- **Loki as Þökk, Day 15, after 4.** Þökk is the old woman who wouldn't weep for Baldr (Gylfaginning); Móðguðr said on Day 14 that he waits in Hel's hall. Her lips carry the stitch scars, the Day 12 tell. See through her (`saw_thokk`, Loki +1) or not (`missed_thokk`); on Night 18, Loki says which.
- **Hel, Day 17, after 3.** It's the day of the spear mark, Odin's loophole for deaths in bed, and she comes to watch it work.
  - "It's the rule" is Odin +1, Hel −1; "It's a cheat" is Hel +1, Odin −1; or say nothing.
  - If you sided with her on Night 14, she says so.
- Nothing new in the engine: each is a scene and a line in the day's queue.

**A miser's bribe** (`case.hrapp`, Day 13, after 4 souls)
- **Who:** Hrapp Oddsson died in his bed at 71 and was buried with his silver. The fairness check proves he belongs in Hel under every whim of the day.
- **The offer:** 40 rings for a Return stamp, the one that sends the living home.
  - Taken (`hrapp_draugr`), it's a mistake with its rings at the audit, as the jarl's is.
  - Refused (`hrapp_refused`), he goes to Hel.
- **A different shape from the jarl's.** He doesn't want a better hall; he wants none. A dead man sent home walks as a draugr. Muninn remembers it that night; on Night 16 Bera's letter says he sat on his own doorstep till dawn; the epilogue says where he sits now.
- **His name** is for the draugr of Laxdæla saga. No generated soul has it, so no other soul's name changed (reserving a generated name, such as Ketil, renamed souls on every day).

**Odin's noon decree** (Day 18)
- **The decree:** `noon: { at: 8, notice: 2, redraw: [odinClaim], teach: arch.contested }`. From the ninth soul, Odin's claim is drawn again, never to the morning's. The raven comes two souls earlier. Its first soul is one both he and Freyja want under the new claim.
- **Odin's day:** his visit after the third soul, his decree at noon.
- **Day 18 was an event day.** Events never fall on a day with a decree, so new runs don't draw one there. A run that drew one before this change loses it: `eventOn` gives none on a decree day.
- **Fairness:** the Day 18 sweep (200 seeds) meets every threshold.
  - The generator's adversarial test read every soul under the morning's rules. It failed on Day 18, as it should, and now reads each soul under its own, as the other fairness tests have since §45.
  - The decree tests that hold for any decree run on both days.

**Pleas from ordinary souls** (`campaign.pleas`, engine `campaign/pleas.ts`)
- **When:** on half the days from Day 7, one of the day's own souls asks for another hall.
  - It's drawn on a stream of its own, so the line is the same with it or without it.
  - Never the day's or the decree's teaching soul, one who waited through the night, or a story soul, and never on a day someone in the line already pleads (a story soul: Kari, and since §60 Jofrid and Thorolf) or kin have come (§60).
- **The six pleas,** by the soul's hall (drafts):

  | Hall | Asks for | Why |
  |---|---|---|
  | Hel | Valhalla | to drink with their brothers on Odin's benches |
  | Hel | Rán | to be with a husband or wife who went down with the herring boats |
  | Valhalla | Hel | to sit with their mother, who died in her bed |
  | Valhalla | Fólkvangr | to be with their sister in Freyja's hall |
  | Rán | Valhalla | to sit with the crew they rowed with, who fell at the ford |
  | Transfer (from Day 10) | Hel | to be with a mother and father who were never baptized |

- **The banner** is Kari's (§51), with one line more: "Granted, he'll stand with that hall's host at the last battle, not run from it."
- **Granted, it's a mistake like any:** no wage, a citation, a fine past the day's warnings, and the standing any such mistake moves. It's filed `pled`.
- **What's new is what happens at Ragnarök.** The soul stands in the host of the hall it asked for, as a soul given to a god who asked does (§42).
  - It isn't a misfit, so it doesn't run.
  - The host names it among those who'll stand.
  - In Valhalla it counts with the worthy.
- **It doesn't appeal:** it got what it asked for.
- **Kari now stands too.** Before, granting his plea made him a misfit in Rán's host, who would run.
- **Measured** (40 seeds, Days 4–20): a plea comes on 36% of days, about six a run. The six kinds are spread fairly evenly: 30–60 each over 242.

**Events and the weave** (drafts)
- **A hard frost** (from Day 10): 85% of the day's sun, and the hearth costs half again that night.
- **The jarl's hunt** (from Day 6): three outlaws in the line, in place of three of the day's own.
- **Freyja's thread first:** her rule is read before Odin's claim (585 against 590). So from Day 15, when both want the same worthy soul, hers wins. Its two souls a day are contested souls bound for Fólkvangr.
- **The compiler checks them as it checks the others:**
  - the events' souls can be made on every day they can fall on;
  - the weave changes some day, keeps Hel's catch-all last, can bring its souls under every choice of the day's params, and moves no story soul.

**Numbers** (`pnpm sim campaign`, 200 runs per policy, plain story, against §58's run)
- **Rings and demotions barely move:**
  - experts end 1–10 rings poorer;
  - novices are demoted in 27% of runs paying every bill (29.5% before), 5.5% frugal (9.0%) and 59% buying upgrades first (59.5%). That's within noise or close to it.
  - Nobody lost family.
- **The battle is as it was:** experts hold 3.7 fronts, competent bots 3.0, novices 1.3–1.4.
- **Experts reach Odin's ending more often:** 133–145 runs of 200, against 87–109.
  - The cause is established by elimination. These bots take the first answer when nothing else decides, and the first answer to Hel ("It's the rule") is Odin +1. Nothing else new moves Odin's standing for bots that take no bribes and grant no pleas.
  - A player chooses; the bots' tie-break doesn't.
- **What the sim can't show:** the bots judge by where a soul belongs, never grant an ordinary plea unless told, and take no bribes unless told. So the new pleas and the miser cost them nothing, and Day 18's decree costs them no time.

**Checks**
- **Engine:**
  - ordinary pleas come only where they should, one a day at most, and are the same every time, with the line otherwise as a build without pleas makes it;
  - granted, a plea is a mistake like any, but the soul stands (in Valhalla, with the worthy) and never appeals; Kari stands too;
  - the miser's offer, taken and refused;
  - no event on a decree day;
  - the decree tests on both decree days.
- **Sim:** a bot that takes bribes takes both, and its accounts add up.
- **e2e** (phone and desktop):
  - an ordinary soul's plea, with an accessibility scan, cited when granted;
  - Hel at the desk, with her words at the audit;
  - the miser's banner, citation, audit row and Muninn's line;
  - Odin's visit and his raven on Day 18;
  - Kari's banner with its new line.
- **Goldens:** Day 18's summaries changed (its decree). Days 1–5 and the Dailies didn't.

**Known limits**
- **More to take in, not less.** Some days now carry two interruptions: Day 17 (Hel after 3 souls, Thrand at 5) and Day 18 (Odin after 3, the raven after 6). That adds to a risk nobody has tested yet: the first playtests may well say "too much" before "too little".
- **Six reasons to plead.** A long run hears some of them twice.
- **The bots never grant an ordinary plea unless told,** so what a person does with them, and whether standing at Ragnarök is reason enough, is a playtest question.
- **The words are drafts:** about 1,340 of them. The three desk scenes are about 720, their callbacks in other scenes about 200, and the miser, the pleas, the decree, the events and the weave about 420.

## 60. After the rundown: souls who come back

**Why.** Item 5 of the rundown. A soul, once judged, was gone: only a few scene lines ever brought a stamp back. The story had 17 story cases (13 people) of the about 30 the plan budgets (§2).

**What's new**
- **Kin of the misjudged:** the husband, wife or cousin of a soul sent where it didn't belong comes to the desk later, and says so.
- **Five story souls in eight cases,** each there because of how an earlier soul was stamped. That makes 25 story cases (18 people).

**Kin of the misjudged** (`campaign.kin`, engine `campaign/pleas.ts`)
- **When:** on 40% of days from Day 8, when the run has sent a soul where it didn't belong at least two days before, one of the day's own souls is its kin.
  - "Where it didn't belong" means a misfit who'd run at Ragnarök (§54): a soul that pleaded, or was given to a god who asked, stands, and brings nobody.
  - It's drawn on a stream of its own, as pleas are, so the line is otherwise the same.
  - Kin come once for each such soul. The audit keeps the soul's name once its kin are judged (`RunState.kin`).
  - Never for a story soul: the story has its own kin (Jofrid, Thorolf). Never to a story soul, a soul that teaches the day's rule or its noon decree, or one who waited through the night.
  - One new soul a day at most asks for another hall. On a day kin come, no ordinary soul pleads (§59), and kin don't come on a day someone in the line already pleads: a story soul (Kari, Jofrid, Thorolf), or a soul who waited through the night.
- **Who they are:** a wife or husband when the two differ in sex, a cousin otherwise, read from the patronym (a daughter's ends -dottir).
- **Never a soul whose name already makes it closer kin.** Fathers' names come from a pool of 24, so a generated soul shares the wronged soul's father about one time in 24, and is named as its child or parent about as often. "Thora Ketilsdottir is Bjorn Ketilsson's wife" would read as a sister. Such a soul isn't made kin; another of the day's own is.
- **The desk says so,** in a banner above the plea's: "Thora Grimsdottir is Bjorn Ketilsson's wife. You sent him to Hel's hall on Day 6, where he didn't belong." The citation said so the day the mistake was made, so the banner tells the player nothing they couldn't know. It makes the mistake matter again.
- **They ask to join it** where it went, when that isn't where they belong: a plea (§59), "…asks for a Hel stamp, to be with him: a mistake all the same." Granted, it's a mistake like any, and the soul stands in that host at Ragnarök. Where they belong anyway, the banner is all there is.

**The story's souls** (drafts; `content/packs/campaign/cases/`)

| Soul | Day | Comes if | Belongs | What follows |
|---|---|---|---|---|
| Svanhild Hallvardsdottir, carried from the ford still breathing | 7 | always | home (Return) | Sent home (`svanhild_home`), she comes back on Day 15. |
| Svanhild again, killed at the same ford | 15 | `svanhild_home` | Valhalla | She married in the eight days between, and says so. |
| Jofrid Arnorsdottir, Geir's widow | 14 | Geir sent to Hel (`geir_hel`) or to Valhalla (`geir_spared`) on Day 6 | the clerk (Hel's hall is full) | She asks for Geir's hall. Granted (`jofrid_with_geir`), she stands there; in Hel's, Móðguðr says that night that Hel let her in. |
| Kolskegg Thorkelsson, the miser's nephew | 14 | the miser walks (`hrapp_draugr`) | Hel (he fought his uncle with a spade) | Bera's letter on Night 16 says nobody goes past the ford since. |
| Thorolf Asgautsson, the jarl's son | 17 | `jarl_bribe` or `jarl_refused` on Day 9 | Valhalla | If his father's rings were taken, he asks nothing of the stamp, only to sit at the far end from him. If not, he asks for Hel's hall, to sit with his father among strangers (`thorolf_with_father`). |
| Gudrid Arnkelsdottir, Thorvald's mother | 20 | `thorvald_met` | the clerk (Hel's hall is full) | Nothing: "If he comes again, send him home." |

- **Each has an epilogue line** (`epi.svanhild`, `epi.jofrid`, `epi.kolskegg`, `epi.thorolf`, `epi.gudrid`), by what became of them.
- **Fair as every story soul is:** the compiler makes each for every day that places it, under every choice of the day's params and every weave, and fails if one can't be made or would go elsewhere (§21).
  - The first draft of Svanhild was pulled from under the ice alive. The world's rule that the living come from battle (`world.aliveFromBattle`) rejected her, so she's a shieldmaiden carried from the ford.
  - Their names are reserved, and none is in the generated pools, so no generated soul's name changed.
- **Each is one more soul in its day's line, under the same sun.** Day 14 can have two more: up to 17 souls before a rank adds its own (§44), in 820 seconds, so at worst 48 seconds a soul against 55 before. Day 20 has one more: up to 25 in 1,100 seconds, at worst 44 a soul against 46.

**The pleas and kin since §59**
- **Pleas and kin are now given after the story's souls are in the line,** so "never on a day someone pleads already" reads the line itself. Before, it read the day's placements, so a story soul who might not come (Jofrid, Thorolf) would have kept the day free of pleas either way, and a soul who waited through the night with a plea didn't count.
- **The day's teaching soul is the first that isn't a story soul,** wherever story souls stand before it, as the jarl does at the gate on Day 9. A test with a story soul at the gate checks that neither kin nor a plea come to it.

**How often** (40 seeds, Days 8–20, fresh lines with Geir sent to Hel and the jarl refused, as most runs have them)
- **With no soul sent where it didn't belong,** 62% of days bring a soul who asks for another hall: an ordinary plea on 39%, a story soul's on 23% (Days 14, 16, 17).
- **After one such mistake,** 79%: kin on 36%, an ordinary plea on 20%, a story soul's on 23%.
- **No day brought two souls who ask.**
- **In bot runs** (40 each, plain story, paying every bill), kin came 2.3 times a run for the expert bot (97% accurate; in 38 runs of 40) and 5.8 times for the competent bot (85%; in every run), which is nearly every day the draw allows.
- **The new souls, met** (same runs): Svanhild on Day 7 in every run, and again on Day 15 in 39 of 40 for the expert and 33 for the competent bot (as often as they sent her home rightly); Jofrid in 38 and 35; Thorolf in 38 and 35; Gudrid in every run; Kolskegg only when the miser was sent home, in no expert run unless it took bribes (then all 40), and in 4 competent runs by a slip.

**Numbers** (`pnpm sim campaign`, 200 runs per policy, plain story, against §59's run on the same seeds)
- **More souls, more wages.** The five souls add a soul to Days 7, 15, 17 and 20, and one or two to Day 14.
  - Experts end 33–38 rings richer (paying every bill, 160 against 125).
  - Competent bots end 7–15 richer paying bills or frugal, and about the same buying upgrades first.
- **Novices end 2–4.5 rings poorer.** They're demoted in 28% of runs paying every bill (27% before), 9.0% frugal (5.5%) and 57.5% buying upgrades first (59%).
  - The frugal rise is 7 runs of 200. At this size that can't be told from the scatter any change brings to the same seeds, but it's the one number that moved the wrong way.
  - A likely reason, not established: a novice past its day's warnings is fined for about one soul in three, so an extra soul pays it about nothing on average.
- **The battle is a little stronger at the top.** Experts hold 3.8–3.9 fronts (3.7), with Svanhild and Thorolf in Valhalla's host. Competent bots hold 3.0 and novices 1.3–1.4, as before; the wolf wins 98, 111 and 49 of the novices' runs (105, 119 and 52).
- **The endings are otherwise as they were:** experts reach Odin's in 128–147 runs of 200 (133–145), and competent bots the last stand in 198–199.
- **Nobody lost family.**
- **What the sim can't show:** bots never grant a plea unless told, so kin cost them nothing but reading the banner.

**Checks**
- **Engine:**
  - kin come only for a soul sent where it didn't belong, from their first day and two days after the mistake, once, never for a story soul or one who stands, and never on a day a story soul pleads (Kari's, Day 16);
  - they ask to join it unless they belong there, and nobody else pleads that day;
  - neither kin nor a plea come to the soul that teaches the day's rule when a story soul stands before it in the line, and kin never come to a soul whose name makes it closer kin (each with a control: the same day brings them to another soul);
  - wife, husband or cousin by the names; the audit keeps the name, and the next day brings no second kin for it;
  - the ordinary plea tests (§59) read the line's story pleas (Kari, Jofrid, Thorolf).
- **Content:** the compiler proves the eight cases fair; `pnpm story:script` finds no flag that's set and never read (86 flags).
- **e2e** (phone and desktop):
  - kin at the desk: the banner's words, the plea's, an accessibility scan, and the citation when granted;
  - Geir's widow: her banner with the line about the last battle, the citation, and Móðguðr's line that night.
  - The last battle's test built its battle from a run judged rightly to the end, and Svanhild and Thorolf now add two to Valhalla's host, so both the wolf and Hel's gate held in any order. It now cuts that host as far as it takes (two) for the order to decide between them, as it was written to show.
- **Goldens and the Dailies** didn't change: the goldens are the days' generated souls, without the story's, and the Daily has no story.

**Known limits**
- **Most days now bring someone who asks,** 62% of days from Day 8 with no mistakes and 79% after one that stands (measured above). Whether that stays a choice each time or turns into noise is a playtest question; the playtest report counts them (§61). `kin.chance` (40) and `pleas.chance` (50) are one-line changes.
- **The bots never grant a plea unless told,** so kin cost them nothing, and what people do with them is untested.
- **"The ford"** is now in many lines (Svanhild, Thorolf, Bera's letter, the Rán plea, a day event). One ford in one valley may be what the story wants; if not, some should be another place.
- **Kin are only ever a husband, wife or cousin,** and say nothing of the soul's life; the story's own kin (Jofrid, Thorolf) carry that.
- **The words are drafts:** about 600. The five souls' lines and pleas are about 320, their epilogue lines about 225, the kin's words about 30, and the scene lines about 25.

## 61. Before the playtests: pleas counted, and the crowded desk on a phone

**Why.** Outside playtests come next; so far only bots have played. Two things would have spoiled what they tell us: the report couldn't show a plea refused, and on a phone the busiest souls shrank the body the game is judged by.

**Pleas and kin in the playtest report**
- **The audit files them** (`DayLedger.pleas`): every judged soul that asked for another hall, and every soul's kin who came, with where it belonged, what it asked, whose kin it was, whether it's a story soul, and whether it was granted.
  - The list is kept, empty on a day nobody asked, in a build whose campaign has pleas or kin. Saves from before it have none.
  - A soul left in line at dusk is filed on the day it's judged.
- **The report** sums them up ("Pleas: 3, granted: 1. Kin who came: 2."), then lists each by day, and names the days played on a build from before they were kept.
- **Why it matters:** §60's open question is whether pleas and kin come too often. A refused plea is a right stamp, so nothing else in the report showed it.

**The crowded desk on a phone**
- **Measured** on a 360×740 phone, the smallest the game supports, on the soul with the most over it on each of Days 14 and 16–19 (the worst of 60 seeds a day):
  - With nothing over it, the body is 232 px tall.
  - Two requests and a plea shrank it to 159–168 px. On Day 19, two requests, the noon line, kin and a plea shrank it to 106 px.
  - Below about 150 px the stage's third tool, the clippers, was cut off, and the words panel under the tabs was nearly gone.
  - The cause: the body's height was 34% of whatever the notes above it left, with no floor.
- **The changes:**
  - What a soul says of itself (an offer, whose kin it is, a plea) is one box of notes: regular weight, smaller, left-aligned. It was one bold headline each. On Day 19's busiest soul the body now starts 84 px higher.
  - The body never gets smaller than its tools (10rem, 160 px), and the words panel keeps a few lines (7rem, 112 px).
  - When the notes and those floors don't fit, the shift scrolls rather than cutting anything off. The action bar stays on the screen, and each soul starts at the top.
  - The landscape layout keeps its own sizes.
- **After:**
  - Souls with nothing over them are as they were.
  - The busiest souls of Days 14–17 keep a body of 172–182 px and a words panel of 118–136 px, without scrolling.
  - The busiest of Days 18–19 have both at their floors, and the shift scrolls 64–93 px with Judge on the screen.
  - On a 360×640 phone, smaller than the game supports, everything can be reached by scrolling (54–193 px).
- **A test** (`tests/e2e/crowded.spec.ts`, phone): Day 19's most crowded soul keeps its body, every tool on it, its words and Judge on the screen. It fails on the old layout (a 106 px body against a 159 px floor).

**Known limits**
- **The busiest souls still scroll** on the smallest phone, by up to about 90 px. The alternative was a body too small to judge by.
- **The body's floor is a size in the CSS, not a readability check.** The art was judged at a 232 px body on this phone (§17). At the 160 px floor its subtler signs are smaller than that, and nobody has checked them there. The old layout went down to 106 px.
- **The measurements are of the worst souls** of 60 seeds a day. A real run rarely meets them.

## 62. The Steam shell (Electron), as built

**Why.** Steam is the first store (§12, M6), and its shell was a stub. This is the shell the Steam builds will ship. It runs and is tested without Steam, so only the Steamworks side waits for the app IDs.

**What it is** (`apps/electron`)
- **One window** shows the game from its own files at `app://game/`: the `electron-full` or `electron-demo` build, from `resources/game` in a package, or from `dist/electron-full` in the repo.
  - Every response carries the content security policy: the game's own files only, and no inline or evaluated scripts. The network is also blocked underneath the page.
  - The page has no Node. Context isolation and the renderer sandbox are on, and a preload hands it `window.cotsShell`: a store and an achievement call.
  - It can't navigate away or open windows. Links to the game's GitHub (issue forms, privacy note, source) and its Steam store page open in the system's browser. Anything else is refused and logged.
  - The page may copy its share text and go full screen, and nothing else.
  - One copy runs at a time. F11 and Alt+Enter toggle full screen, and a pinch on the Deck's screen doesn't zoom.
  - A computer going to sleep or locking pauses the shift, as losing focus does.
  - A page that crashes reloads, twice at most.
- **Saves are files** (`saves.ts`): one JSON file a key (`settings.json`, `campaign.0.json`, …), in the folders §8.1 gives for Auto-Cloud.
  - The main process writes them atomically (a temporary file, flushed, then renamed over) and synchronously. The page's store call waits for the file, so a save is on disk before the call returns.
  - Cost: a Day 19 campaign save (145 KB) takes about 2 ms to write and 1.4 ms to copy across, measured here.
  - The main process checks every name: lowercase letters, digits, dots, dashes and underscores, never `..`.
  - A file that isn't JSON comes back as its text, so the game shows that slot as unreadable and keeps it (§28).
  - Only the game's own page in the game's window gets answers.
- **The page's own storage is in memory.** The game still keeps its synchronous copies in localStorage while it runs (§7), but they go when the app quits.
  - A copy kept on disk would outrank a newer save that Steam Cloud brought from another computer. The game trusts its synchronous copy of the settings over the store, because in a browser that copy is never the older one.
  - So the files are the only saves.
- **Steam** (`steam.ts`) is called only from the main process, through a small port over steamworks-ffi-node 0.11.3.
  - It stays off, and the log says why, when: the build has no app ID; Steamworks' library isn't beside the app; the library won't load; or Steam won't start (no client running). The game plays the same either way.
  - A store build started outside Steam asks Steam to start it (`RestartAppIfNecessary`), then quits. A build tested with an app ID from the environment (`COTS_STEAM_APP_ID=480`) doesn't.
  - **Achievements:**
    - The game already sends every earned achievement at each start (§34). The shell maps `ach.everyFront` to `ACH_EVERY_FRONT`.
    - It asks Steam first whether it has one, so an achievement already earned costs a lookup, not a write.
    - One Steam can't take yet (its stats for the player haven't arrived) is tried again every 5 s for a minute, then logged.
    - `pnpm steam:achievements` prints the table to set up in Steamworks.
  - On a Steam Deck (Steam's check, or `SteamDeck=1`), the window starts full screen.
  - Callbacks run every 100 ms. Steam shuts down before the app quits.
- **A log** (`profile/shell.log`, fresh each run) for bug reports: whether Steam is on and, if not, why; the page's warnings and errors; and refused links.
- **The platform adapter** (`packages/platform/src/adapters/electron.ts`) uses the shell's store and achievements. Opened in a browser, with no shell, the Steam build keeps its saves in IndexedDB like the web builds.
- **Folders:**
  - Saves are in `…/ChooserOfTheSlain/saves`. Chromium's profile sits beside them in `…/profile`, which isn't synced.
  - `COTS_SAVE_DIR`, `COTS_PROFILE_DIR` and `COTS_GAME_DIR` move them for tests. A package ignores `COTS_GAME_DIR`.
- **Linux:** Chromium's process sandbox is off (`no-sandbox`); the page's own sandbox stays on.
  - Why: the sandbox helper loses its setuid bit in a Steam depot, and Steam's container refuses nested namespaces.
  - Started as root, Chromium checks for the flag before the app's code runs. So the Linux launch option passes `--no-sandbox` too ([`docs/steam.md`](steam.md)).

**Build and package**
- `pnpm build:steam` builds `electron-full` and bundles the shell with esbuild (`main.js` and `preload.js`). `STEAM_APP_ID` bakes the app ID in; without it, the build has none.
- `pnpm package:steam` runs electron-builder:
  - It makes `dist/steam/full/linux-unpacked`, or `win-unpacked` on Windows. These are folders, not installers, since Steam ships a folder.
  - The native parts (koffi, steamworks-ffi-node) are unpacked from the app's archive.
  - Steamworks' library goes in only if it's in `apps/electron/steamworks_sdk/`. That folder is gitignored, because Valve's terms keep the SDK out of a public repo.
  - `STEAM_EDITION=demo` packages the demo, from `dist/electron-demo`.
  - The Linux package is 288 MB unpacked, mostly Electron.

**Tests**
- **29 unit tests:**
  - folders;
  - the file store: round trips, atomic writes, unreadable files, refused names;
  - the protocol: paths out of the game's folder, other hosts, the policy;
  - links;
  - the Steam port against a fake SDK: why it's off, relaunching, unlocks, retries, giving up, shutting down, and a unique Steam name for every achievement;
  - the adapter.
- **`tests/electron/shell.spec.ts`** runs the real app under Electron (Playwright). It checks that:
  - the game loads from app://game;
  - saves are files, and a fresh profile reads them back;
  - a save from Steam Cloud beats this computer's old copies;
  - a file that isn't a save is shown as unreadable and left alone;
  - nothing reaches the network, opens a window or navigates away;
  - sleep pauses the shift.

  `COTS_SHELL_BINARY` runs the same tests against a packaged build.
- **Controls:**
  - With a profile kept on disk, the cloud-save test fails, as it should: the old copy's 125% text beat the cloud's 150%.
  - Unlocking without asking Steam first fails its test.
  - Removing the protocol's check that a path stays inside the game's folder fails nothing: the URL parser and `normalize()` already stop every escape tried. So that check is a backstop.
- **CI:**
  - A Linux job runs the smoke test from the repo, then packaged.
  - A Windows job packages the build on Windows and runs the smoke test against the `.exe`.

**Differences from §8.1's sketch**
- **One Linux switch (`no-sandbox`), not four.**
  - `in-process-gpu` serves the Steam overlay, which isn't wired (§8.1 already says not to depend on it).
  - `disable-dev-shm-usage` is for containers.
  - `no-zygote` waits for a test on a Deck.
- **The game's key-value store as files (`<key>.json`)** instead of `save:list/read/write`. The game already keeps everything that way (§7). So Auto-Cloud's pattern is `*.json`, not `*.sav;*.json`.
- **Not built yet:** rich presence, the overlay, and the SteamPipe upload in CI (it needs the app and depot IDs and `STEAM_CONFIG_VDF`).
- **No `steam_appid.txt`:** steamworks-ffi-node sets `SteamAppId` for the process.

**Known limits**
- **Nothing has run against a real Steam client.** Starting Steam, achievements, relaunching through Steam and the Deck check are tested against a fake. The first real run needs the Steamworks SDK's files and the Steam client ([`docs/steam.md`](steam.md)), with app 480 (Spacewar) until the game has its own ID.
- **Steam's Linux runtime and the Deck are untested.** That includes whether the shell's own `no-sandbox` is enough there without the launch option.
- **Windows has run only in CI:** a packaged build's smoke test on a runner, not on a player's machine. Code signing isn't set up; Steam doesn't require it.
- **Saving blocks the page while the file is written:** about 3–4 ms for the largest save here. On Windows, an antivirus that scans every write could make it longer; that's unmeasured.
- **Steam Cloud itself is untested.** The tests stand in for it by swapping the saves folder.
- **Anything the game keeps only in localStorage is forgotten at quit.** Today that's only the art style chosen with `?art=`, which the Steam build has no way to set.
- **macOS isn't built** (§8.1).
- **The demo's progress doesn't carry over to the full game** (§8.1's nice-to-have).

## 63. The foundation: crash safety, playtest reports read by script, and a tuning workbench

**Why.** From the foundation brainstorm ([`roadmap.md`](roadmap.md)), items 7, 1 and 2.
- **Crash safety:** an error while drawing a screen went uncaught, so the screen likely froze. The saves were safe, but nothing told the player so.
- **Reading playtest reports:** the report's table was written so a script could read it, and nothing did.
- **A tuning workbench:** some tuning numbers still lived in TypeScript. Nothing measured what a change to a number does across many runs.

**When something breaks** (`packages/ui/src/crash.ts`, `crash-ui.tsx`)
- **An error while drawing a screen** is caught by `CrashGuard`, around the whole app (Preact's `useErrorBoundary`).
  - A running shift is paused first (`pauseIfPlaying`), and the pause is saved, so the sun stops.
  - The crash screen:
    - says what happened and that nothing saved is lost, since the game saves after every move;
    - has **Reload**, focused. After it, resuming picks the shift up, paused, at the soul the player was on (tested for the Daily);
    - has **Report the problem**, which opens the GitHub form *Problem report* with the report filled in;
    - shows the report as text, with a Copy button.
- **Any other error the game didn't catch** (`error` and `unhandledrejection`) gets a notice at the foot of the screen, with **Report it** and **Dismiss**. The game goes on.
  - Only the game's own errors count: from its own scripts, or with them in the stack. Known-harmless ones are skipped: the ResizeObserver loop, an aborted request, a refused permission.
  - Each message is shown once a session, and never over the crash screen.
- **The report holds:**
  - the build line;
  - the time;
  - the error: its message, at most 300 characters, and the stack's first 12 lines;
  - where the player was, for example `shift · Daily #41 · day 5 · soul 2 of 8`;
  - up to five earlier problems this session;
  - the device: browser, window size, pixel ratio and language.

  Nothing from the saves goes in. Past 7,000 characters, the link keeps four stack lines and drops the earlier problems; the text to copy keeps everything.
- **The form** is `.github/ISSUE_TEMPLATE/problem-report.yml`. It has the report, then what the player was doing.
- **A lab hook** tests both paths, in the `dev-full` build only; other builds drop it at build time, as they drop the labs. `cotsCrash('render')` breaks a screen; `cotsCrash('handler')` throws from outside a render.
  - The second throws from a microtask. Playwright's clock catches errors thrown by timers, so a timer never reached the page's handler.

**Playtest reports, read by script** (`tools/playtest`)
- **`pnpm playtest:read`** sums up reports: issue bodies saved as files (`gh issue view N --json body -q .body > N.md`), reports pasted on their own, a folder of either, or stdin.
  - `parse.ts` reads the report as `playtest.ts` writes it: the header, the Days table by its column names, the Mistakes list, and the pleas.
  - A file can hold several reports. The form's answer to "What did you play on?" is kept.
  - Columns a build didn't have read as missing.
- **The report gains a column:** the sun left when the last soul was sent (`grade.spareMs`). The bots' sun left means nothing, since they spend a fixed 25 s a soul, so this only comes from testers.
- **The summary** is Markdown, to paste into an issue or a note:
  - the runs side by side: build, slot, day, rings, ending, device, assists;
  - the rings after each night, beside the bots' median and middle half. Bots: expert, competent and novice, 20 runs each by default, on the same target. The table says how many bot runs were still going on each day;
  - where each run's last night sits among the bots;
  - each day's judging: right, wrong, left at dusk, the share judged rightly, grades of sharp or flawless, the median sun left, and assisted days;
  - wrong stamps by the rule they broke, with skipped steps, bribes, pleas granted and noon decrees counted apart;
  - pleas and kin.
- **`pnpm playtest:keep backup.json --name tester`** keeps each campaign slot of a tester's backup as `tests/fixtures/playtests/<tester>-slot<N>.json`.
  - `kept.test.ts` opens every kept save with the current build (`resumeSave`), writes its report and reads it back.
  - A change that would break a tester's run fails there before it ships.
  - A save holds its seed, the actions taken, the souls' generated names and the choices made; nothing about the tester. The file name is whatever `--name` says, and the repository is public.
  - One bot-made save is kept, so the test has something to open before any tester sends a backup.

**A tuning workbench**
- **The numbers moved to content, unchanged:**
  - What the sun costs besides the tools: a wrong compare 10 s, a question 20 s, a hint 15 s, and 60 s of grace at dusk. They were `PENALTY` and `DUSK_GRACE_MS` in `shift.ts`; now they're `content/packs/core/sun.yaml`, read through `sunCosts(content)`.
  - The least sun a campaign shift has: 120 s. It was `MIN_SUN_S`; now it's `minSunS` in `content/packs/demo/campaign.yaml`.
  - Exactly one pack must define `sun.yaml`, and the compiler says so otherwise.
  - The sun's costs apply to the Daily as well. Its checksum guard (§15) covers the souls, not the costs, so a change to them changes how the live Daily plays without tripping the guard. `sun.yaml` says so.
  - The Question and Hint buttons and the rulebook read the costs from content.
  - The Daily's checksums and the golden days didn't change.
- **`pnpm sim compare --set 'path=value' …`** runs the same bots on the same seeds twice: once with the content as built, and once with the changes.
  - The seeds are those `pnpm sim campaign` uses (`c0`, `c1`, …). Each pair of runs shares one seed, so both meet the same souls and dice until the change sends them apart.
  - **Paths** name a place in the compiled content: `campaign.minSunS`, `sun.question`, `days[4].economy.wage`, `campaign.shop[up.meadHorn].price`, `days[*].sunS`.
    - A bracket picks list items by id, by day, by index, or all of them with `*`.
    - `=` sets, `+=` and `-=` add and take away, and `*=` scales, rounded to whole numbers.
    - A value must keep its kind: a number stays a number, a list a list. A misspelt path fails and names what is there.
  - **Options:** `--seeds` (30), `--judging` (expert, competent, novice), `--strategy` (payAll), `--story` (plain), `--pace` and `--nights` (3, 9, 15, 19).
  - **For each kind of bot, it prints:**
    - how many pairs changed at all;
    - for each measure, the two means, the mean change and its 95% interval (±1.96 standard errors of the paired differences). "noise" means the interval holds no change; "same" means every pair came out equal.
      The measures: rings at the end, lowest rings, demoted, lost family, days played, upgrades, fronts held, the rings after the chosen nights, and souls left at dusk (only when a run has any).
    - which endings moved.
  - A measure a run doesn't reach, such as a night after a demotion, compares only the pairs where both runs have it, and says how many.
  - With no pair changed, it says the bots never met what changed.
  - **Speed:** about 1 s a run on `dev-full` here. 20 seeds for two kinds of bot took 80 s.
  - **An example, measured here:** a ring more in wages every day (`days[*].economy.wage+=1`), 20 seeds.
    - Competent bots had 127 rings more after Night 15, but 0.9 more after Night 19, and 13.5 fewer at the end (both noise).
    - Novices' demotions fell from 45% to 10% (−35 points, interval −56 to −14). Wolf endings went from 9 to 16.
    - Where the competent bots' extra went wasn't measured. Arms from Night 13 are the likely sink.
- **Tests:**
  - overriding the content's sun costs changes the penalties;
  - an overridden `minSunS` changes the gate;
  - the compiler's rule of one `sun.yaml`;
  - paths: by id, by day, by index and all; errors for missing places, wrong kinds and fractions;
  - the paired interval, checked against a hand calculation;
  - a compare where nothing changes;
  - a compare that moves rings;
  - a variant that breaks a run, named with the run.

**Known limits**
- **The bots never compare wrongly, question or ask for a hint,** and they only run out of sun with `--pace`. So `sim compare` can't tune the sun's costs yet. That waits on bots that behave like players (the roadmap's queued item 3), or on the playtests' sun left.
- **A variant skips the compiler's lints and checks.** A run that throws is named. A variant that is merely odd isn't caught, such as a mix that no longer adds up. To keep a change, edit the YAML and run the tests.
- **Paths are for the compiled content, not the YAML files.** A day's economy lives in its day file, for example.
- **The interval is a normal approximation.** It's rough for shares near 0% or 100% with few runs.
  - Each profile shows about a dozen measures, so one "significant" change in twenty can be luck.
  - Later nights compare only runs that got there.
- **Stacks in a report are minified.** Public builds ship no source maps (§3). The build line says which commit to rebuild with source maps to read them.
- **The crash screen can't catch an error in itself,** or errors in code that catches its own.
- **The report's format is the reader's contract.** The round-trip test writes a report and reads it back, so a change to one that the other doesn't follow fails.
- **Kept saves follow the players' saves.** If a change breaks old saves on purpose (a new `ENGINE_MAJOR`), the kept ones go or get migrated with them.

## 64. The repository renamed: the Pages site follows it

**What happened.** The repository was renamed from `Vikings-R-Us` to `Chooser-of-the-Dead` in September 2026.
- GitHub moved the Pages site with it, to https://rcjlabs.github.io/Chooser-of-the-Dead/. It redirects the old repository's URLs, but not its Pages.
- The demo's paths are absolute, and it was built for `/Vikings-R-Us/`. So the page at the new address asked for its scripts at the old one: four 404s and a white screen.
- `/full/` still loaded: its paths are relative.

**The fix**
- `PAGES_BASE` is `/Chooser-of-the-Dead/`. The game's GitHub links (`links.ts`) and the Steam shell's allowed links (§62) name the new repository.
- The Pages workflow no longer relies on `PAGES_BASE`. `configure-pages` runs first, and the demo is built with the path it reports (`COTS_BASE`). A rename, or a custom domain, then moves the build with the site.
- After each deploy, the workflow fetches each page and the first script it loads, and fails if either doesn't load.
  - The pages are the demo and `/full/`, each fetched past the cache.
  - A white screen now turns the deploy red.

**Checked** by serving the assembled site under `/Chooser-of-the-Dead/` in Chromium, before and after.
- Before: the demo loaded nothing (the four 404s), and the workflow's check failed.
- After: the title screen, no failed requests, and the check passed. The same for `/full/`.

**Known limits**
- **The old address is gone.** Links to `…/Vikings-R-Us/` that were already shared now 404; the Daily's share text carries the site's address.
  - GitHub doesn't redirect Pages after a rename.
  - A repository created under the old name could serve redirects, but it would also end GitHub's redirects for the old repository's links.
- **A browser that installed the demo from the old address probably keeps its old copy there.** Its service worker serves the cached game and can't fetch an update.
  - Saves are kept per origin, not per path, so the same saves show up at the new address.
- **The check fetches one script per page, not every file.** It catches a wrong path, not a chunk missing further in.
- **Local builds and the tests use `PAGES_BASE`.** After another rename, the deploy follows by itself. `PAGES_BASE` has to be changed by hand, or the tests describe a site that isn't there.

## 65. The whole game installs from Pages

**Why.** The whole game at `/full/` couldn't be installed. The Pages copy was the itch build (`web-playtest`), so it had no manifest and no service worker. The demo beside it installed.

**What changed**
- **The Pages copy has its own target, `web-full`.** It's `web-playtest` with the web adapter and a PWA.
  - It has the same packs, playtest note and report.
  - It has the same storage: `cots.playtest.*` keys and the `chooser-of-the-slain.playtest` database. A tester who played `/full/` before keeps their saves.
  - Its manifest ("Chooser of the Slain (Playtest)", with "Chooser Full" under the icon) and service worker use relative paths. They're scoped to `/full/`, so it installs as its own app beside the demo, whatever the repository is called.
  - Its shares carry no link, as before, since the address is unlisted.
  - Updates wait for **Update now** on the title and night screens, as the demo's do.
- **`web-playtest` is unchanged.** The itch page still gets no service worker.
- **The Pages workflow builds `web-full`** for `/full/`, instead of `web-playtest`.
- **Both service workers now also cache the rune font,** so runes and inscriptions read offline.
- **Each app's name comes from its target** (`app` in `targets.ts`). The demo's is unchanged.

**Checked**
- **The assembled site under `/Chooser-of-the-Dead/`, in Chromium:**
  - both pages are installable, with no installability errors;
  - each page is controlled by its own worker; the whole game's is `/full/sw.js`;
  - with the network off, `/full/` reloads with its title and playtest note.
- **e2e on the real `web-full` build** (port 4177, phone and desktop) covers:
  - the manifest;
  - its own worker;
  - a campaign saved under the playtest build's keys and database;
  - a reload with the network off.

  Control: the same offline steps on `web-playtest`, which has no worker, fail.
- **A unit test** pins `web-full`'s storage to `web-playtest`'s, and keeps the two apps' short names apart.

**Known limits**
- **An installed copy runs the build it has** until the tester taps Update now. Its reports name that build, so a stale one shows.
- **iPhone and iPad keep a Home Screen app's storage apart from Safari's.** Saves made in Safari don't appear in the installed app; a backup (Settings) moves them.
- **The demo's worker covers `/full/` too, by scope.** It doesn't answer those pages, because its fallback skips `/full/`, and once the whole game's worker is installed, the narrower scope wins.
- **Installing doesn't make the game private.** It stays unlisted, not protected.

## 66. Pressing a soul on what it said (game phase 1)

**Why.** Game phase 1 in [`roadmap.md`](roadmap.md). Question only followed Compare: a lie had to be shown false before the soul could be asked about it. There was no way to lean on a soul, and nothing to read in how it took it.

**What it does** (`packages/engine/src/narrative/press.ts`, the `press` action in `shift.ts`)
- **Press** questions a soul about one of its claims before anything shows the claim false. A claim is a testimony line that states a fact, and the player must have heard it. It costs 10 s of sun.
- **Pressed on a lie, a soul may give way.** The odds depend on how it talks, out of 100: confused 70, coward 60, honest 50, veteran 25, braggart 15.
  - Giving way plays the answer planned for the lie when the case was made, as if it had been caught and questioned. A confession reveals the truth.
  - The lie counts as caught, for the bonus ring and the day's grade.
  - Loki, who deflects, never gives way.
- **Otherwise the soul holds.** Its words are chosen by the claim and how it talks, never by whether the claim is true, so holding says nothing by itself. The lines avoid the last 20 used, as questions' do.
- **Holding, it may add something about another fact it hasn't spoken of.** These are `press.yaml`'s details, the first that can be said:
  - a claimed battle death adds "one wound, in the chest", else "a weapon in hand";
  - a claimed weapon in hand adds "died fighting";
  - "never fled" adds "one wound, in the chest".
  - **If what it adds is true,** it's said only where nothing on the soul could seem to show it false. So never on a soul with a forged tally, which is believed until refuted (§3.4).
  - **If it's false (a slip),** it comes only from a soul holding to a lie, and only where the body or the ravens show it false. So Compare catches it. Questioned on the slip, the soul gives way on the claim it was holding to.
  - What it adds is heard as a claim of its own (`said.<field>`). It's listed under the claim it came from, marked "Said when pressed", and can be compared like any other.
- **Patience:** each soul takes two presses. A claim is pressed once, and not after it's been caught or questioned.
- **Where:**
  - practice, Endless and the campaign, from Day 3 (the demo's last day);
  - **never in the Daily or the primer**, which play as they always have.
- **Deterministic:** a claim's outcome comes from the soul's seed, whatever order claims are pressed in. Replays and Endless of the day come out the same for everyone.
- **The rule tracker** now takes a confession as the truth whether or not anything seen contradicts the claim (`retracted` in the solver). Until now a confession could only follow a caught lie, so it made no difference.
- **At the desk:**
  - a Press button beside each claim that can be pressed;
  - the soul's patience under its words;
  - badges: "Held to it" is quiet, and "Gave way" is marked like a caught lie;
  - the answer dialog, with anything added and a note that it can be checked;
  - a one-time tip with the soul's words, the first time a soul can be pressed and no lesson is being taught. Once put away it's kept in the settings (`tips`) and in backups.
- **The playtest report** counts claims pressed and lies that gave way each day (the Pressed column), and the summary adds them up by day.

**Measured** over Days 3–20, 10 practice seeds each: 2,356 souls, 6,135 claims. `press.test.ts` checks the same sweep with 4 seeds.
- 1,127 claims are lies. Pressed, 263 give way (23%): braggarts 16%, veterans 25%, cowards 46%, the confused 40%. Loki's lies never give way, and he plays every voice.
- Of the 864 lies that hold, 259 let something slip (30%).
- Of the 1,606 things added, 16% are slips. Checking what a soul adds pays some of the time, not always.

**Fairness, checked over every claim of every soul on Days 3–20** (`press.test.ts`)
- Only a lie gives way, and only with the answer planned for it.
- The same claim from a soul that isn't lying about it holds in the same words.
- Something true that a soul adds is never shown false by anything the player can see.
- A slip is always shown false by the body or the ravens, with the tally left out.
- The Daily's checksums and the golden days are unchanged.

**Tests**
- **The engine:**
  - pressing is taught from Day 3 and never in the Daily or the primer;
  - its cost, patience, and the claims that can be pressed;
  - a lie that gives way is caught, and the tracker keeps its confession;
  - a slip is caught with Compare, and questioned gives way on the claim it held to, counted once;
  - something true that a soul adds finds nothing when compared;
  - traces count presses;
  - random presses, compares and questions keep the soul consistent.
- **The compiler's lints:** odds for every voice, details' facts and values, a line for each detail, a fallback hold line, and one pack for `press.yaml`.
- **The playtest report:** the Pressed column's round trip, and the summary's sums.
- **e2e** (`press.spec.ts`, phone and desktop): the tip, a hold with a slip caught against the chest and questioned, a lie that gives way, patience, and no pressing in the Daily.

**Known limits**
- **The numbers are guesses.** The odds, the cost and the patience were set by reckoning, not play. The bots never press, so `sim compare` can't weigh them. The report's Pressed column is how testers' runs will tell.
- **Most claims have no slip to let.** Oaths, weapons' owners, Ulfberhts, faith and Loki's guise have no detail the body or ravens could show false. Pressed, those souls only give way or hold.
  - A cross at the neck doesn't say "no Thor's hammer" under any law, so "I wear Thor's hammer" couldn't be caught, and isn't offered.
- **Whether a soul adds anything isn't independent of the truth.** The words are the same either way. But a true addition needs its fact to be true, and a slip needs a liar, so how often each comes differs from soul to soul. Pressing says a little by what's added, never by how the soul holds.
- **A press that finds nothing still costs its sun,** and a true claim can only hold. Pressing an honest soul is a waste by design.
- **No key for Press.** P pauses, and a press needs a claim. Keyboard and controller players reach the Press buttons through the focus order.

## 67. Showing the mistake (game phase 2)

**Why.** Game phase 2 in [`roadmap.md`](roadmap.md). A citation named the missed signs as text, then the soul was gone. There was no seeing it again, and no trying it again.

**Look again** (`ReviewDialog` in `packages/ui/src/shift/Shift.tsx`) opens a soul stamped wrong. It shows:
- what it was stamped and where it belonged, or the step it needed;
- the rule that decided it;
- its front and back, drawn with every tool's reading. The signs that decided it are outlined, and those never looked at are ringed in dashed red;
- "What decided it": the soul's minimal proof, each sign marked "You didn't look" if it wasn't seen;
- "Where they lied".

**Where it opens**
- **From the citation,** while souls still wait: the sun is held with a `pause`, saved like any other. The review covers the desk, so the next soul can't be studied for free. Back or Escape gives the sun back.
- **From the summary** (the Daily and practice) and **the campaign's audit,** beside each wrong verdict.

**Try this soul again** (`tryAgain`, a session of kind `again`), once the shift is over:
- the same soul, under the same rules and upgrades, on its own, with no sun;
- it earns nothing and counts for nothing: no achievements, no telemetry, no change to the run or the Daily's result;
- a toast says how it went ("Right this time: Valhalla."), then it's back to the screen it came from;
- not under the oath (§49), which allows no replays, nor in the primer, nor for an appeal.

**Tests** (e2e, `review.spec.ts`, phone and desktop)
- In practice:
  - the summary opens a wrong soul with its rule, its missed signs and their marks on the body;
  - trying it again shows the banner, and a right stamp returns to an unchanged summary.
- Mid-shift, the citation's Look again holds the sun and offers no try again. Escape gives the sun back, and the next soul is at the desk.
- The campaign's audit opens Day 1's mistake, and trying it again leaves the purse and the verdict as they were.

**Known limits**
- **It shows the case as it was made,** not what the player did with it: their looks, questions and presses on that soul aren't replayed.
- **It shows the minimal proof,** not every way to settle the soul.
- **Endless moves on to its next round at once,** so a soul from an earlier round can be looked at again only from its citation.
- **Trying again changes nothing on the record.** A Daily's result, a day's grade and the day's best stay as they were, by design.

## 68. Endless as a run (game phase 4)

**Why.** Game phase 4 in [`roadmap.md`](roadmap.md). Endless had one pressure, three wrong stamps, and nothing to decide between rounds. Now each break offers a choice, and a curse trades safety for score.

**Only in the full game.** The boons and curses are content in the campaign pack (`content/packs/campaign/boons.yaml`), so only the full builds have them. The demo's Endless plays and shares exactly as before: no offer, its score is the souls judged rightly, and it ends at "Three strikes".

**Between rounds** (before every round but the first):
- Three boons, and the curse on offer. The player takes one, and Begin waits until they do.
  - The choice sits on the round's briefing, above the round's decree, twist and rules, so the player knows what's coming.
  - Boons are shown in the pack's order, so each sits in the same place whenever it comes.
- **The offer is drawn from the run's seed and the round** (`endlessOffer` in `packages/engine/src/shift/boons.ts`), from what the run could take:
  - the round's day has come for it (`since`);
  - the run hasn't taken it as often as it may (`max`);
  - the run has what it needs (`needs: sun`, `needs: strike`);
  - it wouldn't end the run on the spot, or do nothing.
- So Endless of the day offers everyone the same, as long as they have chosen the same.
- A reload keeps the choice: it's saved with the run as its round began.

**The score.**
- Each soul judged rightly scores its **worth**: 1, plus 1 for each curse taken.
- The best is now the best score. The souls judged rightly are still counted and shown beside it.
- Achievements that count souls still count souls.

**The boons**

| Boon | What it does | Limit | Offered |
|---|---|---|---|
| Skögul's shield | One more wrong stamp before the run ends | once | any round |
| Eir's mending | The same | twice | after a strike |
| Skögul's eye | Three of Skögul's hints, for any round (Endless has none otherwise) | none | any round |
| Odin's bounty | A soul whose lie was caught before the stamp scores 1 more | twice | any round |
| Loose tongues | Each soul can be pressed once more | twice | from Day 3's rules |
| Sól lingers | A minute more sun each round | twice | under the sun |
| Quick hands | Turning a body over, and the tools, cost half the sun | once | under the sun, from Day 2's rules |
| Bragi's ear | The first two questions each round cost no sun | once | under the sun |

**The curses** (each can be taken once)

| Curse | What it does | Offered |
|---|---|---|
| The sun rises | Every round has a sun from now on, at its day's own pace for five souls: the day's sun over its average line, 4:10 to 5:25. Souls still in line at dusk score nothing. | any round |
| Hel's impatience | One wrong stamp fewer before the run ends | only when it can't end the run |
| Týr's oath | A Compare that finds nothing is a strike | any round |
| Sköll at her heels | A quarter of each round's sun is gone | under the sun |
| Heavy hands | Turning a body over, and the tools, cost double the sun | under the sun, from Day 2's rules |

**Fairness**
- **No boon or curse touches a soul.**
  - A round's souls come from the run's seed and the round alone (`endlessRound`, as before), whatever was chosen.
  - So a day's run has the same souls for everyone.
- **What they can change is a closed list in the schema** (`EndlessBoonSchema`): strikes, score, hints, presses, the sun, what things cost in it, and the oath.
  - Nothing a pack can write hides evidence or changes a rule.
  - So every soul stays as solvable as the validator made it (F1–F8 unchanged).
- **Hints and presses only point at, or add, evidence the solver checks** (§26, §66).
- **Týr's oath hides nothing.** Every lie that matters shows up in a contradiction the player can find (F4), and a Compare that finds one costs nothing.
- **The compiler lints each boon and curse:**
  - its strings;
  - a day it can come on;
  - a boon helps and a curse hinders;
  - sun effects need the sun, and a curse that brings it;
  - presses and tools only from the day they're taught;
  - a first break with three boons and a curse.

**In the engine**
- `runRules(content, picks)`: what the picks add up to (strikes, worth, bounty, sun, costs, hints, presses).
- `endlessConfig(ctx, seed, round, rules, hintsLeft)`: the shift a round plays.
  - Untimed, unless the run has the sun. Then it gets `config.sunS`, new: a shift's own sun instead of its day's.
  - Its `mods`: `sunS`, `toolCostS`, `freeQuestions`, and two new ones, `patience` (presses more per soul) and `hints` (the most Skögul gives; the shift counts them in `hintsAsked`, and `hintsLeft(state)` reads them).
  - A build without boons gets exactly the config it had.
  - None of these is set outside a run, so the Daily and the campaign play as before: their golden checksums are unchanged.
- `tallyEvent(rules, event)`: what one event does to the run (a soul judged, a strike under the oath, a hint used). The UI scores with it as the run is played, and again when a saved round is replayed.

**In the UI** (`packages/ui/src/store.ts`, `screens.tsx`)
- **The briefing** shows the offer.
  - Begin is disabled until a pick (`chooseEndless`); then it takes the focus from the offer.
  - "On this run" lists what's been taken, and what a soul scores now.
- **The desk** shows:
  - the score beside the strikes;
  - the hints left, on the Hint button;
  - under the oath, the oath in the compare bar in place of its hint.
- **A round ended by dusk** says how many souls the sun set on.
- **The end screen** reads "Out of strikes", with the score, how far the run got, and what it took.
- **The share text** reads, for example, `Score 41 · 23 souls judged rightly · round 9, Day 9's rules · 2 curses`.
  - It names a sun speed if a round under the sun was played at one ("sun ×0.5"), and the rule tracker as before.
  - It never says which boons, or where anyone went.
- **Saves.**
  - A run keeps its picks, score and hints used.
  - Its save is the run as its round began (`roundStart`), plus the round's actions.
  - A run saved before this reads as having taken nothing, with a score equal to its souls.
  - Backups check the new fields.
- **A run that ends mid-round under the sun stops its sun,** so no dusk comes to the screen that says it's over.
- **An achievement,** Thrice cursed: 100 points in one run with three curses on it. Endless's tests can read `points` and `curses` now.

**Also fixed.** A dialog taller than the screen couldn't be scrolled, so its buttons were out of reach by touch. One example: a long citation at 175% text on a 360 px phone, which §67's Look again made longer. Overlays scroll now.

**Tests**
- **Engine** (`boons.test.ts`):
  - the rules the picks add up to;
  - the first offer, drawn the same from the same seed and picks, in the pack's order;
  - what each boon needs before it's offered, and limits kept;
  - never a curse that ends the run;
  - boons still offered once every curse is taken;
  - a 12-run, 40-round walk: every pick legal, the run never ended by one, the offer never empty;
  - each round's sun, costs, hints and presses, and never less than two minutes of sun;
  - the souls the same whatever was taken;
  - the score, the oath's strikes, and the share text.
- **Compiler:** each boon lint.
- **Saves:** a backup's run keeps its picks, score and hints; malformed picks are refused.
- **e2e** (`endless-run.spec.ts`, full game, phone and desktop):
  - Endless #91's first break: the three boons and the sun, as the engine draws them, with Begin waiting.
  - The sun taken: a round with 4:40 of sun, and a soul worth 2. It survives a reload, and shows on the end screen, in the share text and on the title card.
  - Endless #96: Skögul's eye (three hints, one used, the rest carried to the next round), then Týr's oath (two true claims compared: a strike).
  - A run that ends under the sun says nothing about the sun afterwards.
  - The demo's Endless shows no offer (`endless.spec.ts`).
  - The accessibility walk covers the offer, a round under the sun and the end, on both layouts and at 175% on a 360 px phone.

**Known limits**
- **The numbers are guesses:** a soul's worth, the round's sun, the boons' limits and the size of the offer. Nothing measures them yet: Endless sends no telemetry and isn't in the playtest report.
- **The best score changed meaning in the full game.** A best set before this counted souls judged rightly. Points grow at least as fast, so an old best is easy to beat.
- **A day's run offers everyone the same only while they choose the same.** Their souls stay the same regardless.
- **The desk's compare bar can cover signs.** On a 1920×1080 desk, the floating bar sits over part of the row of body signs under the body. That was so before; the oath's note is kept to the bar's old width.
- **The rulebook's costs line still speaks of sun in rounds without one,** as it does in untimed practice.

## 69. Linked souls (game phase 3)

**Why.** Game phase 3 in [`roadmap.md`](roadmap.md). Until now each soul at the desk was judged on its own evidence alone. Now souls from one fight or one ship's crew come to the desk together and speak of each other, and what one says of another is checked against the other's body. The phase's second half, a jarl's retinue judged as a group, is §70.

**Only in the full game, from Day 9.**
- Parties are content in the campaign pack: `parties.yaml`, `templates/party.yaml`, question lines for lies about a companion, and `queue.parties` on Days 9–20.
- The Daily, the primer and the demo's days have none. Their lines, and the Daily's checksums, are unchanged.
- The campaign, practice and Endless rounds on those days' rules get them.

**A party** (`linkParties` in `packages/engine/src/gen/party.ts`):
- **Formed last, from a day's finished line:** its own souls, those who waited, an event's, a rank's, the story souls, kin and pleas.
  - It runs on a stream of its own (`…|parties`), so the rest of the line is the same with or without parties.
- **1–2 a day** (the day's `parties.n`), each of 2 or 3 souls of a kind that already stand next to each other in the line.
  - So the line keeps its order, and story souls and desk visits keep their places.
  - Never at the head of the line (a day's first soul teaches its rule), never across a noon decree, never a story soul, and never two souls with the same name.
- **Two kinds:**

  | Kind | Its souls | The desk calls it | What they speak of |
  |---|---|---|---|
  | A fight | all fell in battle | "Fell together at the black ford" | who ran; who kept hold of their weapon |
  | A crew | drowned, or fell in battle | "The crew of the Long Serpent" | how each died; who kept hold of their weapon |

- **One fight, one story.** A party's lines share its place, foe and ship: every member tells of the same fight.
- **Each member says one thing of the next** (the last of the first). It's about a fact the companion's own body or the ravens settle. At 40% it's a lie, and then always one that evidence shows false.

**Fairness**
- **What a soul says of a companion is a field of its own kind** (`Field.about`), never `says`. So nothing that reads what a soul says of itself reads it: the solver's own-soul logic, the trusting bot, pressing, the oracles.
- **It's checked only against what can't be wrong in the companion's own evidence:**
  - body signs read through taught laws, the ravens, confessions (`companionShows`, the solver's `certainOnly`);
  - never a presumption, and never a saga tally.

  So a true word is never shown false, even when the companion's tally is forged and its tell not yet seen.
- **The validator (F1–F8) takes the soul's companions:**
  - F1: a true word fits the companion's truth.
  - F2: a true word is never shown false.
  - F4: every lie about a companion is shown false by the companion's evidence, whether or not it changes anything. So it can always be caught.
  - The proof can need a companion's fields (`meta.crossProof`). Citations and Look again name them with the companion's name.
- **A lie about a companion is a lie like any other.**
  - Caught, it earns its ring and counts for the day's grade.
  - From Day 16 it makes the soul a liar (`fromLies`), so it can send an honoured soul to Hel. The solver takes what companions show as `crossCaught`.
- **Nothing a soul says of a companion changes the companion,** or how it's judged: its own evidence decides it, as before.
- **A lie never moves a soul out of a hall the morning's requests ask for souls from,** so a request can still be done.
- **Checked by:**
  - unit tests (`party.test.ts`);
  - a party sweep (`partySweep` in the testkit), in CI at 30 seeds × Days 9–20 and nightly at 1,000 (`pnpm sim sweep --parties`). Every member passes F1–F8 with its companions, every word about a companion is fair, and a careful bot at the desk judges every soul rightly and catches every lie about a companion.

  On 40 seeds × 12 days: 733 parties of 1,810 souls, and 707 lies about companions. For 140 souls, the hall turned on catching one. Forming a day's parties takes 4 ms on average, 11 ms at the 99th percentile.

**At the desk** (`ShiftState.party` in the engine; the UI)
- **The party stands at the desk together.**
  - A strip above the desk names it and each member.
  - The player turns between them by name, or with `[` and `]`. On a controller, the d-pad reaches the names.
  - Each member keeps its own state: what's been looked at, turned over, caught and stamped.
- **Compare across them.** Pick what one says of another, turn to the other, and pick what shows it false.
  - A Compare pick is named with the member it's on (`@1:body.front.grip`), so it survives turning.
  - A caught lie is marked on the soul who told it, who can be questioned on it. Owning up reveals nothing about itself.
  - A Compare that finds nothing costs its sun, as any does (under Týr's oath, a strike).
- **Stamp each, and send it on.**
  - Send on a stamped member goes on to the next without a stamp ("Next: Hrafn").
  - The last one sends them all ("Send all 3"), and they walk off together.
  - Each gets its own verdict, and a citation if it was wrong. The citations come once the last one is sent, one after another. As for any soul, none shows after the day's last: those are read at the audit.
- **A one-time tip** the first time a party comes.
- **Hints and presses:** Skögul points only at the soul turned to, and pressing isn't offered on what a soul says of a companion.
- **Around it:**
  - A soul who came with a party never appeals.
  - Souls left in line at dusk come back the next day alone; their words about companions stay with the party.
  - A desk visit whose place falls inside a party comes after the party.
  - Try again plays the whole party again.
  - The rule tracker reads a caught lie about a companion as a caught lie.
  - The playtest report counts each day's parties, and the lies about companions caught.

**Tests**
- **Engine** (`party.test.ts`):
  - no parties on days without them, nor on the Daily;
  - parties of 2–3 souls of a kind standing together, never first in line, never across noon, with distinct names;
  - every word about a companion true or shown false, and every member valid with its companions;
  - from Day 16, a lie about a companion deciding a hall;
  - requests' halls kept;
  - turning, Compare across members, questioning, sending on and sending together, traces, dusk.
- **Campaign tests** now check party members with their companions, and a desk visit inside a party comes after it.
- **Compiler** (`compile.test.ts`): the parties lint. It catches a missing string or pool, and an unknown fact. It catches a value of a claim no line can say, a missing answer for a lie about a companion, and a day that forms parties with no `parties.yaml`.
- **Testkit:** the party sweep; the campaign bots turn to each member and catch lies about companions too.
- **e2e** (`party.spec.ts`, full game, phone and desktop): a Day 9 save with two souls who fell together right behind the jarl.
  - The strip, the tip and the keys.
  - One's lie about the other's weapon caught against the other's hands, and questioned.
  - Next, then Send all.
  - An accessibility scan, and no sideways scroll.
- **Older e2e specs** that walk a Day 9 or Day 14 line (`favours.spec.ts`, `return.spec.ts`) now wait for a party's citations until its last member is sent.

**Known limits**
- **The retinue came later,** as the phase's second step (§70).
- **Parties come only from souls already next to each other,** so a day with few souls of a kind may have none.
- **A party's shared words are written into its members' lines after they're made.** A member's own lines and its party's agree, but a party can't give a member a line it never had.
- **The numbers are guesses:** the lie rate (40%), 1–2 parties a day, sizes 2–3. The playtest report counts them now.
- **Time at the desk is booked to a party's first member** in traces and reports, since they're sent together.

## 70. A jarl's retinue (game phase 3, second step)

**Why.** The second half of game phase 3 in [`roadmap.md`](roadmap.md): a jarl's retinue judged as a group. §69 let souls speak of each other, but each was still judged on its own evidence. Now a rule reads across souls: a hearth-man's hall is his jarl's.

**The rule, from Day 9** (`rule.retinue`, campaign pack): *A hearth-man who stood by his jarl to the end, and never fled, goes where his jarl goes.*
- **Where it sits in the Order of Judgment:** order 400. That's after the living, Loki, the registry and the clerk, so an outlawed or baptized hearth-man is still theirs. It comes before everything else, so the man's own grip, blade, whim or lies no longer decide him.
- **A man who fled broke his oath.** A wound in the back, as for Valhalla's rule, and he's judged on his own.
- **The jarl's hall is his true one,** decided by his own evidence. Judge the jarl wrongly and you'll likely stamp his men wrongly too. That's the stake of "judged as a group".
- **Day 9 announces it.** Its decree slot was empty ("No new decree"), and the day's first party is a retinue wherever its souls allow (`parties.lead`).

**How the engine reads a hall across souls**
- **A rule's hall can be named by a fact** (`RuleDef.then: { fact }`). The judge and solver send the soul where the fact says, once it's known.
- **`lordHall` is that fact, and only a party sets it** (`FactDef.fromParty`).
  - Never sampled, so no soul's draw changes for it. The campaign snapshots moved only in difficulty, which counts how deep the applying rule sits (+5 below the new rule).
  - Every other soul is certainly sworn to no one: the solver pins it to `none` at trust 4.
- **The retinue settles it for each man** (`Given`, the solver's `given`). It's the hall his jarl's own evidence decides, with what was caught against the jarl and what he owned up to.
  - Until the jarl is decided, the man is sworn to a hall not yet known, and his judgment waits on it.
  - At the desk it's worked out from what the player has seen of the jarl (`givenAtDesk`); in the validator, from all of it (`givenAt`).
- **The validator takes it too.** A man's proof includes his jarl's proof (`meta.crossProof`), so a citation and Look again name the jarl's evidence. `lordHall` is never a decisive fact of the man's own.
- **The oracles hold `fromParty` facts at their inert value**, as for a soul judged on its own.

**A retinue** (`party.retinue` in `parties.yaml`, formed by `linkParties` like any party, §69)
- **2–3 souls who fell in one fight, standing together:** the first is the jarl, bound for Valhalla, Fólkvangr or Hel; the others are his sworn men. Tagged with the jarl's place and the fact (`PartyTag.lord`), so saves keep it whatever content says later.
- **Formed in order:**
  1. The men are sworn to the jarl's hall and checked (F1–F8, with companions and what the retinue settles).
  2. The jarl says something of his first man (whether he stood fast decides the man's hall).
  3. If that changed the jarl's own hall, the men are sworn again. From Day 16 a lie caught makes him a liar, and Hel's.
  4. Each man says something of his jarl.
- **Lines** (`templates/party.yaml`): `of: lord` for what the men say of their jarl, `of: sworn` for what he says of them.
- **Never moves a man out of a hall the morning's requests count on,** as with any lie (§69). Where the drawn window can't be sworn, the next window in the line is tried.
- **Sweep, 20 seeds × Days 9–20:**
  - 364 parties, 126 of them retinues, with 185 sworn men.
  - 122 men went where their jarl went; 90 of them to a hall their own evidence wouldn't have sent them to.
  - A careful bot at the desk, working only from what it has seen of each jarl, judged all 3,483 souls rightly and caught all 342 lies about companions.

**At the desk**
- **The strip names the retinue** ("Jarl Hallgerd and her hearth-men") and marks the jarl.
- **A one-time tip** the first time a retinue comes, after the party tip: judge the jarl, then turn each man over.
- **Everything else is a party's (§69):** turn between them, Compare across them, and send them together. A man stamped wrong is cited with this rule, and with the jarl's evidence he never looked at.

**Around it**
- **Ragnarök:** a hearth-man rightly sent after his jarl to Valhalla stands with the worthy. He stood by him to the end.
- **Waiting overnight:** a man who waits for tomorrow comes alone, sworn to no one, and is judged on his own.
- **The playtest report** counts, each day, the hearth-men who went where their jarl went, and how many were judged rightly.
- **Endless rounds** on Day 9's rules or later get retinues too. The Daily, the primer and the demo never do.

**Tests**
- **Engine** (`party.test.ts`):
  - retinues on Day 9, the jarl first and his men sworn to his hall;
  - every other soul sworn to no one;
  - at the desk, a man undecided until his jarl is, then going where he goes, and cited with this rule when stamped otherwise;
  - a man who waits comes alone;
  - from Day 16, a jarl caught lying about one of his men goes to Hel, and his men with him.
- **Existing tests** that solve party members now pass what the retinue settles: the rule tracker, the noon and weave campaign tests, and the fairness checks.
- **Compiler** (`compile.test.ts`): the retinue lints. A rule's hall named by a fact only a party sets, with hall values; a kind's `lord` that such a fact names and a rule reads; a day's `lead` kind; lines said of a jarl or his men only in a kind that has them.
- **Testkit:** the party sweep checks every member with what its retinue settles, and fails a build with no retinues.
- **e2e** (`retinue.spec.ts`, full game, phone and desktop): Day 9's new rule in the morning; the jarl marked; both tips; an accessibility scan; the man stamped where his own evidence would send him, and cited with the rule. `party.spec.ts` moved to Day 11, since Day 9 now leads with a retinue.

**Known limits**
- **It's harsh on purpose,** and not yet played by people. One mistake on a jarl can cost two or three citations, and from Day 16 his lie about one man turns the whole retinue.
- **Day 9 now brings two new things,** parties and this rule. Moving the rule is its `since`, the kind's `since` and the day's `lead`.
- **Nothing on the body says a man is sworn;** the retinue at the desk does. No new art was needed, and none shows an oath-ring.
- **Jarls are ordinary souls** chosen from the line, with no look of their own.
- **Skögul's hints point only at the soul turned to.** Turned to a man, she won't point at his jarl's evidence.
- **The numbers are guesses:** how often retinues come (a weight of 2 beside the fight's 3 and the crew's 2), their size, and the day they start.

## 71. The forger's trail (game phase 5)

**Why.** Game phase 5 in [`roadmap.md`](roadmap.md): an investigation that runs across days, on top of judging one soul at a time. The Day 11 letter already had a carver selling families better tallies; now he's someone to find.

**The trail** (`trail` in the campaign pack's `campaign.yaml`, `campaign/trail.ts`)
- **Three carvers**, each with a face (so a story soul can wear it), words for the board, and **two of the three habits** a forged tally can show: an old rune (ᛗ), a rune cut backwards, "reist mik" for "reist rúnar". No two share both, so the two seen together name one man.
- **One of them, drawn for the run from its seed** (`culpritOf`, its own stream), cuts every forged tally from Day 11.
- **Where his habits show** (a day's context carries them, `DayCtx.trail`, and so does a noon decree's):
  - **A forged tally's tell** is one of his two habits, not any of the three. What a tell is never decides a soul: any tell shows the tally forged, as before.
  - **Loki's borrowed faces carry papers** (`papers: forged` on `arch.loki`): a forged tally of the face's true deeds, with a tell. They prove nothing either way, but they're a mark. Endless rounds on Day 12's rules or later get them too.
  - **A gap in Muninn's memory** on a soul whose saga was cut again (a forged tally): he can't find the soul, but he remembers the knife, and names the habit its tally doesn't show (`Field.hand`, `rv.muninn.carved.*`). It says nothing about the soul, so no rule, solver or validator reads it.
- **A day with two marks or more shows both habits** (`markTrail`, after the line is formed). Where they'd all show the same one, the last forged tally shows the other instead. It changes only which tell a forgery shows.
- **The Daily never changes:** its content has no trail, so no tell, paper or gap is drawn differently. The day goldens record nothing a tell's kind changes, and held.

**Marks** (`Verdict.marks`, `RunState.trail`)
- **Seen, a mark is pinned:** a tally's tell once it's under the lens, and Muninn's memory of the knife once it's read. Each verdict carries what was seen of the soul, and so does the soul still at the desk when the sun sets. The audit pins each habit seen on a soul once, with the day and the soul's name.
- **From Day 11 to the last of the trail's nights,** until someone is named. Day 11's marks are pinned before the hunt opens, so the board has them when it does.
- **Who the marks leave** (`suspectsLeft`): every carver whose knife shows every habit pinned. The carver is always among them.

**The hunt**
- **It opens when the Night 11 letter asks for his name** (`when: flags.hunt_carver`). That option used to report him outright; now the raven brings three names, and Skögul pins them above the desk. The other answers never open it.
- **On Nights 12 and 14** the board offers a name, once a run (`RunAction` `accuse`), and only for a carver the marks leave. The player is asked twice.
  - **The right man:** `reported_carver`, Odin +1, 15 rings.
  - **Another:** `carver_wrong`, Odin −1.
  - **Either way the jarl's men drown him,** and he comes to the desk: the day after Night 12, or on Day 15 after Night 14. The carver wears the run's carver's face (`lookOf: culprit`); the wrong man, his own (`lookOf: named`), with an honest tally.
  - **A carver never named dies of a winter fever,** and comes to the desk on Day 15 with his forged tally, Hel's hall being full, as before. So does the carver when the wrong man was named.
- **State:** `trail.night` (the night he was named, 0 until then) and `trail.right`, for story souls' `when`, threads, the epilogue and achievements.

**Around it**
- **At night, the carvers' board:** each carver, his habits and whether the marks leave him; the marks, a line for each habit, with the souls and days; when he can be named; and, the night he is, what came of it. Ruled-out carvers stay on the board, greyed, with no button.
- **The audit** says how many marks the day pinned, once the hunt is on.
- **The journal** keeps the hunt in play until someone is named or the last night passes. **The epilogue** says what came of it, and naming the right man is an achievement (hidden).
- **The playtest report** names the carver, whether the hunt opened, the marks each day and who was named, and whether he was the one.
- **The bots** name a carver only when the marks leave one man. One that catches a forger out also puts the tally under the lens and reads Muninn's gap. That adds no random draws, so the sims' other numbers are comparable.
- **The story page** gets a section for the trail and reads its flags.
- **Saves:** a run from before the trail picks it up from its next day. Its Night 11 report still drowns the carver on Day 13, now in the drawn carver's face.

**Numbers** (upper bounds, since they assume every mark is seen)
- **30 seeds, Days 11–14,** with every forged tally under the lens and every gap read:
  - 67, 80, 56 and 68 marks on Days 11, 12, 13 and 14, about 2–3 a day.
  - Every mark matched the carver's habits.
  - Both habits showed on every day with two marks or more; 8 of the 30 Day 11s had fewer than two.
  - The marks named the carver by Night 12 in all 30 runs.
- **The sims,** 6 seeds per policy: the one story policy that asks for the name on Night 11 (Odin's) named the right man in 12 of 12 runs, expert and competent. The endings each policy reached didn't change.

**Tests**
- **Engine** (`trail.test.ts`):
  - the carvers can be told apart, and each is drawn for some runs;
  - the trail runs from Day 11, in the campaign only, and on a noon decree's souls;
  - only the carver's habits show, both on any day with two marks or more, Muninn's naming the other;
  - Loki's papers are true;
  - the day pass;
  - what's pinned is exactly what was seen, and what was seen when the sun set;
  - the board opens with the letter;
  - naming once, on a trail night, with each outcome;
  - nothing pinned after;
  - each story soul on its day, in the right face.
- **Compiler** (`campaign-lint.test.ts`): carvers with one habit twice or the same two as another, a name no reserved pool keeps, missing words, a night outside the campaign, a condition on an unknown path, and a carver's face with no trail. Each story soul with a carver's face is made in each carver's.
- **Report** (`playtest.test.ts`), and **e2e** (`trail.spec.ts`, full game, phone and desktop):
  - Night 11's letter opens the board with Day 11's marks.
  - On Night 12 the marks leave one carver, named after "not yet", with 15 rings and the achievement announced.
  - On Day 13 he's at the desk, drowned, in his own face.

**Known limits**
- **Careful play solves it by Night 12.** With every forged tally under the lens, the marks named the carver by then in every run measured. The challenge is the lens's sun and remembering to look; players who skip it will be guessing, which Night 14 lets them avoid. Nobody has played it yet.
- **The board works out who's left for the player.** The deduction is in finding the marks, not in reading them.
- **It opens only if the letter asks.** A player who answers the letter another way never sees it.
- **The story around it is draft,** like the rest: the letter's new lines, the carvers, the drowned man's words, the epilogue lines.
- **Numbers are guesses:** 15 rings and Odin's ±1, three carvers, Nights 12 and 14.

## 72. Valkyrie origins (game phase 6)

**Why.** Game phase 6 in [`roadmap.md`](roadmap.md): who the chooser was in life, picked for a new run of the full game, for a reason to play it again as someone else. Each origin has a speed or money perk, someone more at home, and scenes of its own.

**Origins** (`origins` in the campaign pack's `campaign.yaml`, `campaign/origin.ts`)
- **Four, one perk each, only speed or money** (the roadmap's rule for perks):
  - **The shieldmaiden:** turning a soul over costs no sun, the feather 4 s.
  - **The seeress:** the first two questions each day cost no sun.
  - **The trader's daughter:** 30 rings more to start, and upgrades cost 15% less. Sold back, an upgrade fetches half of what she paid.
  - **The freed thrall:** every shift has 45 s more sun.
  - A perk is applied where upgrades and favours are (`shiftMods`, `shopFor`, `sellPrice`): a tool's cost is the least of its own, an upgrade's and the perk's. The shop doesn't offer an upgrade that her perk already beats (the oiled bier and the swan feather, for the shieldmaiden).
- **Someone at home**, beside the family every run has: Thurid, her shield-sister; Heid, the old seeress; Gisli, her father's steersman; Kormak, freed the same day. Each is an adult, so each can die.
  - **They keep themselves while well** (`ownKeep` on a family member): off the food bill, and never hungry for want of it. Sick, they're fed and need medicine like anyone. So an origin costs nothing while its member is well; it adds someone to keep warm and to nurse.
  - They count at home for everything else: the family list, `family.home` (the empty house needs them gone too), `member.<id>.*`, and scenes' `home()` and `sick()`.
- **Three scenes each** (`scenes`: day, morning or night, scene id), each played after the day's own (`scenesFor`):
  - Night 1, their first letter.
  - A choice on a night of its own: Thurid's sword for 12 rings (Night 7); a ring a question from a frightened valley, or the truth for nothing (Night 14); a herring share bought on Night 1 for 20 that pays 35 (Night 12); fifteen rings for a third witness to Kormak's freedom, or the RETURN stamp on it (Odin −1) (Night 4).
  - The last night, Night 20.
  - They touch no flag an ending reads, so an origin changes which endings a run can reach only through the rings and Odin's −1 above.
- **The epilogue** has a line for whoever came home with her (`epi.thurid` and the rest), read from how they are and the night's choice.
- **State:** `RunState.origin`, `origin.<id>` for conditions.

**Where it shows**
- **A new run's slot** asks "Who were you?": nobody in particular, the household as it always was (the default), or one of the four, each with its blurb, what it gives and who it brings home. Not for the vertical slice, and not in the demo, whose content has no origins.
- **The run says so** on its slot and its mornings, beside Story Mode, the oath and the weave. The family list says who's off the food bill, and the food bill and the nights ahead count only those the purse feeds.
- **The playtest report** says who she was in its run line; the family line lists the member.
- **The story page** has an Origins section: each origin, what it gives, who it brings, and its scenes, read into the flag index.
- **The sims** take `--origin`, and play the origin's scenes with the story policies.
- **Saves:** a run from before origins has none and plays as before. `isRunSave` needs nothing new.

**Numbers** (`pnpm sim campaign --seeds 40 --origin …`, plain story; demoted, by night strategy payAll / frugal / upgradesFirst)

| Bot | No origin | Shieldmaiden | Seeress | Trader | Thrall |
|---|---|---|---|---|---|
| Novice | 32.5 / 17.5 / 57.5% | 27.5 / 20 / 47.5% | 30 / 27.5 / 55% | 30 / 20 / 32.5% | 32.5 / 22.5 / 57.5% |

- Expert and competent bots were never demoted with any origin. Experts' mean rings (payAll): 169 with none; 206, 172, 255 and 167 as the shieldmaiden, seeress, trader and thrall. The shieldmaiden skips two upgrades; the trader pays less for all of them.
- At 40 seeds a rate is good to about ±12 points. Frugal nights (the hearth every other night) are where the member shows: they can fall sick, and medicine costs.
- **The first design fed them from the purse:** about 150 rings a run, most of it on the late nights. With 20 rings to start (40 and a fifth off for the trader), novices were demoted about twice as often (about 62 / 40 / 85% with the three speed perks), so an origin was a tax. Hence `ownKeep`.

**Tests**
- **Engine** (`origin.test.ts`):
  - four origins in the full game and none in the demo;
  - a run begun as each, with its member, rings and state;
  - no unknown origin, and none with the slice;
  - perks at the desk, the trader's prices and sell-back, and the shop without the upgrades a perk beats;
  - `ownKeep` tonight and in the nights ahead, and hunger;
  - a member's death;
  - scenes in order;
  - saves.
- **Compiler** (`campaign-lint.test.ts`): missing words, an origin twice, one with no perk, a member who's family already or whom two origins bring, a missing scene, two scenes in one slot. The scene walks cover each origin's scenes with its member at home.
- **Sims** (`campaign-sim.test.ts`): every ending can still be reached in a run begun with an origin.
- **Report** (`playtest.test.ts`), and **e2e** (`origins.spec.ts`, full game, phone and desktop):
  - the picker, its words and tap sizes;
  - none for the slice, none in the demo;
  - a run begun as the shieldmaiden says so on its morning and slot;
  - on Night 1, Thurid's note after Ulf's letter, her place in the family list, and the food bill.

**Known limits**
- **The bots can't weigh speed.** They never question and only run short of sun with `--pace` (§63), so the sims show the trader's money and nothing of the other three perks. Whether 45 s of sun, two free questions and a quick bier and feather are worth about the same to a player, and whether any of them is worth 30 rings and 15% off, is a playtest question.
- **"A different household" is one more person,** not a different family: Ragna, Ulf and Asa are in every run, because the whole story is written around them.
- **The words are draft,** like the rest: twelve scenes, four blurbs, the members' names and their epilogue lines. The freed thrall's story wants the same sensitivity read as the clerk's.
- **Numbers are guesses:** the perks, 12, 10, 20→35 and 15 rings in the scenes, and Odin's −1.

## 73. Mercy has memory (game phase 7)

**Why.** Game phase 7 in [`roadmap.md`](roadmap.md): word spreads among the dead. How strict or merciful the chooser has been changes how often souls plead, bribe or lie, and some souls let through turn out later to have lied.

**The word** (`word` in the campaign pack's `campaign.yaml`, `campaign/word.ts`)
- **A number from −3 to 3, 0 to start** (`RunState.word`). The audit moves it for each soul that asked:
  - a step softer for each ask granted: a plea (the kin's included) or rings offered for a stamp (the story's included);
  - a step sterner for each ask refused, meaning the soul was sent where it belongs;
  - neither way for a third hall.
- **Three levels** (`levels`, in order, each holding up to a word):
  - **Stern, −2 and below:** one of the day's own souls asks on 25% of days, and souls lie at 85% of the day's lie rate.
  - **Even-handed, −1 to 1:** 50% (the pleas' own chance) and 100%, the campaign as it was.
  - **Soft, 2 and above:** 75% and 115%, and half of those who ask bring rings instead of a plea.
- **From the next day on.** The day's context scales its lie rate (`withWord` in `dayContext`, a noon decree's day too), and the pleas' draw takes the level's chance instead of its own (`withPlea`). Nothing else about a soul changes.
- **The Daily never changes.** Its content has no campaign, and so no word. The day goldens are made with `createDayContext`, which no run's word reaches, and they held.

**Offers** (`offers`)
- **On a soft day, an asking soul may offer rings instead** (`CaseSpec.offer`, drawn on a stream of its own), for a hall the offers let souls of its hall pay for:
  - 15 rings for Valhalla, from Hel's or Rán's;
  - 12 for Fólkvangr, from Hel's;
  - 12 for Valhalla, from the clerk's (from Day 10).
- **Taken, it's paid at the audit with the story's rings,** as a story soul's offer is (§47). `stampEffects` covers it, so the desk's banner, the audit's row, the mistake's `paid` and the bots' bribes all do too. It's a mistake all the same, with its usual costs.
- **It runs at the last battle:** it bought the hall; it didn't want it. It doesn't appeal.

**Who asks, and false asks**
- **Only a soul whose lies can all be caught at the desk asks** (`liesCatchable`): it tells no lie, or another of its own fields shows each one false, with no question needed. So a player who checks a soul that asks can always tell whether it lied. A lie about a companion (§69) is only ever told where the companion shows it false.
- **An ordinary soul, not kin, that asks and lies is asking falsely.** Granted:
  - it doesn't stand where it asked to go. It's a misfit, named at the last battle as one who'll run, and never among the worthy;
  - it doesn't appeal either;
  - two mornings later the dead find it out (`RunState.found`, `found.after`), the morning says so, and the word goes a step softer: they say you can be fooled. A slice's jump tells what it jumped over on the morning after.
- **Story souls and kin ask as before.** What a story soul asks is written; kin ask for someone else.

**Where it shows**
- **At the desk:**
  - an ordinary soul's plea says it stands there "if he told you the truth";
  - once a lie of its own is caught, the plea or offer adds "He has lied to you already";
  - an offer's banner is the one a story soul's has.
- **The audit:** how far the day's asks moved the word and the level it's at, on a day someone asked; the rings an offer paid, as a story soul's are.
- **The morning:** from the pleas' first day, the word's level and what the line says of the chooser; and, as news, the souls found out that morning.
- **The playtest report** counts offers and the souls found out lying beside the pleas, marks each, and says where the word stood after each audit that moved it. `pnpm playtest` reads the new counts.
- **State:** `word`, for conditions. Nothing reads it yet.
- **Saves:** a run from before the word has none, which is 0: even-handed, the campaign as it was.

**Numbers** (`pnpm sim campaign`, plain story; demoted, by night strategy payAll / frugal / upgradesFirst)
- **The bots refuse every plea unless told otherwise, so their word ends stern:** −3 for experts and competent bots, −2.6 to −2.9 for novices. Beside the same sims on main before the word (30 seeds):
  - experts and competent bots are never demoted either way. Their rings are 3–23 lower: fewer liars means fewer caught-lie bonuses. The endings each reaches are the same within a few runs.
  - novices are demoted in 28 / 9 / 67% of runs, against 28 / 13 / 63% before, over 100 seeds each: the same, within about ±9 points. (At 30 seeds, 40 / 10 / 70 against 33 / 17 / 57: noise. Fewer liars also moves the bots' random draws, so the two runs of a seed aren't paired.)
- **Bots that grant pleas (`--pleas`), except to a soul they caught lying,** end even-handed or soft (1.1 to 2.7). They grant 6–9 of 10–13 asks a run and let 0.5–2 liars through. Novices who grant them are demoted in 67 / 23 / 83% of runs (30 seeds): each granted plea is a mistake, with its fine, and a soft word brings more of them.
- **Taking the offers too (`--bribes --pleas`) pays.** Experts end with 180 / 623 / 194 rings, against 115 / 585 / 128 granting pleas alone, and novices are demoted in 53 / 23 / 73% of runs.
- **The forger's trail** (§71) gets fewer marks when the word is stern, since forged tallies are lies. Over 30 seeds of careful play (every forged tally under the lens), Days 11–14 pinned 72, 70, 61 and 55 marks, against 85, 80, 64 and 56 before. The marks left only the carver by Night 12 in 28 of the 30 runs, against 29.
- **The bots can't show what fewer or more liars do to judging:** their accuracy is fixed, whatever a soul tells them. Whether a stern word makes the desk easier for players, and a soft one harder, is a playtest question.

**Tests**
- **Engine** (`word.test.ts`):
  - the levels and their bounds, and 0 even-handed as before;
  - none in the demo;
  - the lie rate a level gives a day, a noon decree's too;
  - fewer liars on a stern word's days than on a soft one's;
  - the ask chance, and only souls whose lies can be caught asking;
  - a caught lie told from one that can't be caught;
  - offers and what they pay;
  - a step for each ask answered, and none past the bounds;
  - a false ask granted: it runs, doesn't appeal, and is found out two mornings later;
  - a slice's jump.
- **Also updated:** `run.test.ts`. A granted plea that stands is an honest soul's; where a test forces the pleas' chance, it leaves the word out; and the jarl's offer is filed with the pleas.
- **Compiler** (`campaign-lint.test.ts`): levels out of order, past the bounds or twice; missing words; a level that brings offers with none to bring; an offer for the soul's own hall, for RETURN, or from a hall whose souls never plead; a word with no pleas.
- **Report** (`playtest.test.ts`, `tools/playtest`), and **e2e** (`word.spec.ts`, `plea.spec.ts`, full game, phone and desktop):
  - a liar's plea "if he told you the truth", and its lie caught;
  - granted, the audit's row;
  - two mornings later, the news and the soft word;
  - nothing before the pleas' first day.
- **Fixed on the way:** the desk's caught-lie badge was white on #d86a52, 3.4:1. It's now on #a8432f, 6:1. No scan before had a lie caught on the desk layout.
- **`trail.spec.ts`** now picks its seed by what its day pins, as the other scenario tests do: a strict player's Day 11 on the old seed pinned one mark.

**Known limits**
- **Two refusals make the word stern,** so a strict player is stern by about Day 9 and stays there. The design's bet is that a strict desk should be quieter.
- **Mercy costs more than it did** on a soft word (more asks, each a mistake to grant), and only the offers taken pay some of it back.
- **The morning shows the level, not the chance or the lie rate behind it.**
- **The words are draft,** like the rest: the levels, the found-out news, the desk's lines.
- **Numbers are guesses:** the bounds, the levels' shares, the offers' rings, two mornings.

## 74. The household as people (game phase 8)

**Why.** Game phase 8 in [`roadmap.md`](roadmap.md): the family asks favours at the desk (find Ulf's friend among the dead), and their letters react to how you judge.

**Letters from home** (`letters` in the campaign pack's `campaign.yaml`, `scenesFor` in `campaign/origin.ts`)
- **A letter is a scene played after the day's own and the origin's,** on the morning or night of its day, on runs where its `when` holds. The game reads the list afresh after each scene, so a letter's `when` sees what the scenes before it did; the sims do the same.
- **Five, all at night:**
  - **Night 6,** while your mother is at home: her friend Oddny Grimsdottir died of the coughing sickness, and she asks you to send her to Freyja's meadow (`errand_oddny`; a promise sets `oddny_promised`).
  - **Night 7,** once Oddny was judged (`oddny_judged`): her answer, by where you sent her.
  - **Night 8,** while Ulf is at home: his friend Steinar Kolsson died at the ford, and he asks you to look at Steinar's back. The jarl's cousin says Steinar died facing them (`errand_steinar`; `steinar_promised`).
  - **Night 10,** if Ulf asked and is still at home: what you can tell him.
    - You looked at the back (`steinar_back`): the truth (`told_ulf_truth`) or a kind lie (`told_ulf_kind`).
    - You never looked: that you didn't (`steinar_unknown`), or the kind lie anyway.
    - The sun set before Steinar reached the desk: nobody knows.
  - **Night 14,** every run: what they say of you at home, in a letter from whoever is there (your mother, Ulf, or your aunt). It reads the word among the dead (§73): stern at −2 and below, soft at 2 and above. It also reads the souls you've sent wrong so far: 15 or more, or 3 or fewer.
- **Scenes can read two more numbers:** `word()` (§73) and `wrong()` (the souls sent wrong over every audit so far, `wrongSoFar`). The journal keeps both with each entry, so a scene read back plays as it did. An entry from before has neither, which is 0.

**Errands at the desk** (`errand` and `onSeen` on a story soul)
- **Two story souls come only if someone at home asked** (`when: flags.errand_*`):
  - **Oddny Grimsdottir, Day 7.** Honest and dead of sickness, so she belongs in Hel's. She asks for Fólkvangr herself (a story plea, §51). Granted (`oddny_meadow`), it's a mistake with its usual costs, and like any ask granted it moves the word a step softer. Refused (`oddny_hel`), a step sterner.
  - **Steinar Kolsson, Day 10.** He fled the ford with a wound in his back, says he didn't, and belongs in Hel's (`steinar_valhalla` if he's sent there anyway). His lie is shown false by the back, like any.
- **The desk says who asked** (`errand: { from, text }`, `errandOf`), under the soul's own notes, with the name used inside a sentence: "Ulf, your brother, asked you to look at Steinar Kolsson's back: did he run at the ford?"
- **What looking at a soul does** (`onSeen: [{ obs, effects }]`):
  - A verdict on a story soul carries the observations the player looked at (`Verdict.looked`), and the audit applies the effects of each one seen (`seenEffects`), whatever the stamp. Looking at Steinar's back wound (`woundsBack`) sets `steinar_back`.
  - What was looked at on the soul at the desk when the sun set counts too. A soul never reached counts nothing, and a story soul isn't carried to the next day (§41).
  - Ordinary souls carry no `looked`.
- **The journal** lists each errand while it's open (`thread.oddny`, `thread.steinar`). **The epilogue** has a line for each (`epi.oddny`, `epi.steinar`).
- **Nothing here changes what can be solved.** Both souls are judged by the day's rules like anyone, and the lint proves each can be made under every whim and weave (§53).

**Where it shows**
- **At the desk,** the errand's note (`errand-banner`), beside the offer, kin and plea notes.
- **At night,** the letters after the night's own scene.
- **In the journal's threads and the epilogue.**
- **The playtest report** labels a letter in its Choices ("night, a letter from home") instead of printing its scene id.
- **The story page** shows each day's letters after its night scene, with the condition that sends each. It also shows an errand soul's errand and what looking at it does. Letters, errands and what looking does all feed the flag index. Every flag set is read somewhere, and every flag read is set.
- **The lint:**
  - a letter after the last day, sent twice, reading run state that doesn't exist, or playing a missing scene;
  - an errand from outside the family, or its words missing;
  - an observation the desk doesn't have, or effects on family that doesn't exist.

**Numbers** (`pnpm sim campaign --seeds 30`, plain story; against the same sims for phase 7, §73)
- **The bots meet both souls in almost every run.** Your mother and Ulf are home on Nights 6 and 8 unless something took them, and the letters set the errands whichever way you answer. Experts look at everything, so they see Steinar's back and tell Ulf the truth; novices never turn him over.
- **Experts earn about 20 rings more a run** (172 / 626 / 180 against 151 / 603 / 160, payAll / frugal / upgradesFirst). That is two more souls judged rightly, and Steinar's lie caught.
- **Novices are demoted in 30 / 7 / 70% of runs,** against 40 / 10 / 70%. At 30 seeds that's within about ±12 points, and two more souls a run shift the bots' random draws, so the runs aren't paired.
- **The endings each bot reaches are the same within a few runs,** and the test that bots reach every ending passed, with and without an origin.

**Tests**
- **Engine** (`household.test.ts`):
  - letters: the full game only; after the night's own scene, on the runs their `when` holds for; after an origin's; never in the morning;
  - the journal keeps the word and the souls sent wrong;
  - errands: the soul only if asked, and who asked;
  - Oddny's plea granted and refused;
  - Steinar: what was looked at, stamped rightly or not, and at dusk;
  - `seenEffects` only on story souls that say what looking does.
  - Also updated: `origin.test.ts` leaves letters out when it checks the origins' scenes.
- **Story** (`index.test.ts`): `word()` and `wrong()`, and a journal entry from before them.
- **Compiler** (`campaign-lint.test.ts`, `story.test.ts`): the lints above.
- **Story page** (`script.test.ts`): letters, their conditions, the errand, what looking does, and the flags.
- **e2e** (`household.spec.ts`, full game, phone and desktop):
  - Night 6's letter and the journal's thread;
  - Oddny at the desk with the errand note and her plea; granted, cited, and your mother's answer that night;
  - Steinar's errand note; his back looked at, the truth told;
  - never looked at, the other branch;
  - Night 14's letter on a stern word.
- **Fixed on the way:** `run.test.ts`'s check that a story soul's words hold found Oddny's weapon word turned to "sword". A Day 7 blade could come up a copied Ulfberht, so her blade is pinned plain, as Svanhild's is.

**Known limits**
- **Two errands,** both from the family every run has. Someone an origin brings asks none, and the lint only knows the family.
- **Only the Night 14 letter reads the word and the souls sent wrong.** Others could, once the story is signed off.
- **Looking is what counts,** not catching the lie. A player who turns Steinar over and looks at the wound knows, whether or not they call out his lie.
- **Busy nights.** Night 14 as the seeress now plays three scenes.
- **The words are draft,** like the rest: five scenes, two souls' lines, the notes, the threads and four epilogue lines.
- **Numbers are guesses:** the Night 14 thresholds (the word at ±2, 15 and 3 souls sent wrong).

## 75. Vows at the cup (game phase 9)

**Why.** Game phase 9 in [`roadmap.md`](roadmap.md): each night, swear a vow for tomorrow, as saga heroes did over the cup (heitstrenging). It gives a day a goal the player picked, between the day's own grade (§49) and the oath, which holds for the whole run.

**Changed from the pitch.** The roadmap said a kept vow pays rings and standing. It pays rings only. Standing for each vow kept, up to 17 a run, would carry runs to endings and favours the judging didn't earn. A broken vow costs Odin's standing, as pitched.

**The vows** (`vows` in the campaign pack's `campaign.yaml`; `campaign/vows.ts`)
- **Three a night, from Night 3**, for the next day. They're drawn for the run and that day (`<seed>|vows|<day>`), the same however the night goes, and shown in the campaign's order. None in Story Mode, outside the night, or on the last night.
- **Six kinds**, each settled by the day it's sworn for:

  | Vow | Sworn | Kept when | Rings |
  |---|---|---|---|
  | `clean` | "I'll judge every soul rightly, and leave none in line at dusk." | no soul wrong or left at dusk (the grade's mistakes are 0) | 8 |
  | `liars` | "No liar reaches my stamp uncaught." | every liar the evidence exposes caught before the stamp (the grade's) | 8 |
  | `proven` | "I'll stamp no soul on a guess." | no stamp, right or wrong, a guess (§76) | 6 |
  | `sun` | "I'll be done with the line while a quarter of the sun is still up." | the last soul sent with `spare` (25) percent of the day's sun left | 4 |
  | `silent` | "I'll question no soul, and press none." | no question, free or not, and no press | 3 |
  | `alone` | "I'll judge without Skögul's help." | no hint; never offered under the oath, which gives none | 2 |

- **Sworn at night** with `{ t: 'vow', id }`, from tonight's offer only; `id: null` takes it back. It's `RunState.vow`, so the next morning's snapshot keeps it, and a day replayed from its morning has the same vow.
- **Settled at the day's audit** (`settleVow`, `DayLedger.vow`). Kept, its rings go in the purse beside the day's pay. Broken, the campaign's `broken` (Odin −1) goes in standing. Either way the run's vow is done with.
- **What the shift counts for them:** questions asked, free or not (`ShiftState.questions`), presses (`presses`), and every hint. `hintsAsked` counted only under an Endless limit before; it counts always now.
- **Mid-shift,** `vowBroken` says whether nothing can keep the vow any more: a soul sent wrong, a liar stamped uncaught, a stamp on a guess, a question or a press, a hint, or less sun left than was sworn to spare. A soul left in line at dusk breaks the vow of judging every soul, but only the audit can say so.

**Where it shows**
- **At night,** a card, "At the cup", before the bills: the offer as a choice of one, each with its rings, and "Swear nothing tonight". It says what a broken vow costs.
- **In the morning,** "Last night you swore at the cup: “…” Kept, it pays 8 rings."
- **At the desk,** the vow in short words beside the gods' requests ("Your vow: no help from Skögul"), and "Broken." once nothing can keep it. The short words (`vow.*.short`) keep it to a line on a phone.
- **At the audit,** a ledger row for a kept vow's rings, a card saying it was kept and what it paid or broken and what it cost, and a Vow column in the standing table on a day one was broken.
- **The playtest report** has a Vow column (`vow.clean kept (+8)`, `vow.alone broken`), and `pnpm playtest:read` reads it.
- **The lint:** a vow's words; a vow for a day after the last; the sun's share given for the vow of sun and for no other; a vow of proof only where stamps are asked for it; at least two vows on the first night; a broken vow that costs something.

**Numbers.** `pnpm sim campaign --vows`, 30 seeds, plain story, bots that pay every bill. A sworn bot plays to its vow where it can: sworn to prove, it proves every soul it judges right; sworn to catch liars, it catches every liar it judges right; sworn to silence, it proves without questions. It can't judge more rightly, or faster, than it does. `--vows` has each bot swear the dearest vow on offer that it expects to keep (`vowSafe`): any bot keeps the vows of no help, silence and sun at its pace, and only the expert expects to keep the three a mistake breaks. `--vows dearest` swears the dearest whatever it is.

| Bots | Vows | Kept | Rings a run from vows | Purse at the end | Odin | Odin's ending |
|---|---|---|---|---|---|---|
| Expert | none | – | – | 173 | 4.1 | 18 of 30 |
| Expert | dearest it expects to keep (every kind) | 71% | 92 | 272 | −0.8 | 6 of 30 |
| Competent | none | – | – | 113 | −9.3 | 0 |
| Competent | dearest it expects to keep (no help, silence, sun) | 100% | 54 | 109 | −9.3 | 0 |
| Competent | dearest | 23% | 28 | 117 | −22.4 | 0 |
| Novice | none | – | – | −36 | −35.6 | 0; demoted 9 of 30 |
| Novice | dearest it expects to keep | 100% | 51 | −24 | −36.2 | 0; demoted 7 of 30 |
| Novice | dearest | 6% | 5 | −36 | −51.1 | 0; demoted 9 of 30 |

- **An expert's keep rate by kind:** liars 83%, proven 65%, clean 64%, sun 100%.
- **Broken vows can cost an ending.** An expert who swears the hard vows breaks about five a run, and reaches Odin's ending in 6 runs of 30 instead of 18. The card says what breaking costs. Whether that's the right weight is a playtest question. A broken vow that cost rings instead would leave the endings alone, but the engine has no ring forfeit for it yet.
- **The cheap vows cost bots nothing.** They never ask for hints, question only to prove a soul, and work at 25 s a soul. Real players who need Skögul, or are slow, won't keep them as surely, which is why they pay 2 to 4 rings.
- **Rings:** about 100 more a run for experts, and about 50 for the others, mostly spent on upgrades and arms (the competent bot's purse is no bigger). Novice demotions fall from 9 to 7 in 30, within this sample's noise.

**Tests**
- **Engine** (`vows.test.ts`):
  - three a night from Night 3, drawn for the run and the day, in the campaign's order, and every vow comes up over a run;
  - none in Story Mode, outside the night, on the last night or in the demo, and under the oath never the vow of no help;
  - sworn from the offer only, taken back, kept into the morning, rejected by day;
  - kept, its rings and no standing; broken, nothing and Odin −1; done with either way; the standing columns add up;
  - each kind kept, and broken by what breaks it;
  - `vowBroken` at once for a hint, and for the sun once less than its share is left.
- **Sim:** the slow bot's accounts add up with vows sworn and broken, and standing is every audit's columns, the vow's among them.
- **Compiler:** the lint above (through the campaign lint test's content).
- **Report:** the Vow column, read back by `pnpm playtest:read`.
- **e2e** (`vows.spec.ts`, full game, phone and desktop):
  - Night 5: the card, a vow sworn and kept through a reload, the morning's line, the desk's line, and the audit paying it;
  - Day 6 sworn to judge without help: a hint marks it broken at the desk, and the audit says so, what it cost, and shows the Vow column.

**Known limits**
- **Kept on trust,** as the oath is: a day replayed from its morning lets a player try a broken vow again.
- **Assists:** the sun's share is of the sun the day had, so a slower sun makes that vow easier. A vow kept with assists pays all the same, as the wage does.
- **The words are drafts.** The numbers are guesses: the rings, Odin's −1, and the quarter of the sun.

## 76. Proven, not lucky (game phase 10)

**Why.** Game phase 10 in [`roadmap.md`](roadmap.md). A grade (§49) rewarded a right stamp however it was reached, and most souls go to Hel's, so stamping on a hunch often comes out right. The engine already knew the smallest evidence that decides each soul (its minimal proof), and citations used it for mistakes; right stamps ignored it.

**What the player had of a soul** (`perceivedOf` in `shift/shift.ts`)
- **Everything looked at:** body signs tapped, papers read (opening a paper or its tab reads it), tool readings, and what a soul added when pressed.
- **Every sign the body showed.** The art draws a body's signs whether or not they're tapped, so the front's always count, the back's once the body was turned over, and a tool's readings once the tool was used.
- **What it owned up to,** questioned or pressed: a confession is the truth (trust 4), and a lie given up is caught.
- **At a party** (§69), a claim about a companion is caught when what the player had of the companion shows it false, as a soul's own lie is with what contradicts it; and so is every lie flagged across the party.
- **For a jarl's sworn man** (§70), his jarl's hall, as far as what the player had of the jarl settles it.

**Proven** (`unprovenAt`)
- **The solver runs on what the player had,** with those confessions and catches. If that settles the soul's judgment, its hall and what must be done first, the stamp is proven, and `Verdict.unproven` is absent.
- **Otherwise `unproven` names what decided it** that the player never had: the proof's fields, `q:<field>` for a confession it needs that was never asked for, and `@<member>:<field>` for a companion's.
- **A right stamp with `unproven` is lucky.** A wrong one was a guess, not a slip; the vow of proof (§75) counts both.

**Where it's asked** (`proofAsked`): in a build whose campaign has `proven` (the full game), in the campaign, practice, a soul tried again (§67) and Endless. Never in the Daily or the primer, and never in the demo. The Daily plays as it always has: none of its stamps is marked, and nothing it shares, saves or checks changes. Telemetry doesn't send it.

**What it changes**
- **The grade:** Flawless also needs every right stamp proven (`DayGrade.lucky` counts the rest). Sharp says what kept the day from Flawless: the liars, the guesses, or both.
- **Endless:** a lucky stamp is still right, so it's no strike, but it scores `luckyPoints` (0) instead of its worth and bounty. The demo's Endless scores as before.
- **At the desk:** "Sent to Hel. Right, but what you'd seen didn't prove it." Tried again: "Right this time: Hel. But what you'd seen didn't prove it."
- **At the audit:** the row says "(right, but a guess)", and Look again opens it: "Hel was right, but what you'd seen didn't prove it", with what decided it marked on the body and in the list.
- **The playtest report:** the grade cell adds the lucky stamps (`sharp (3/4 liars, 2 lucky)`).
- **Not the purse:** a lucky stamp pays the wage like any right one.

**Numbers**
- **1,472 souls,** six seeds of Days 1–20, each soul's proof looked at by the testkit's `proveSoul`: every one proven, and no action rejected.
  - Stamped without a look, 61% of right stamps are lucky. The rest are settled by the body's front alone: a weapon in hand is a weapon in hand.
  - Proven without a single question, all 1,472 still are. In this sample no proof needs a confession that other evidence can't stand in for, so the vow of silence never forces a guess.
- **Campaign sims** (30 seeds, plain story, bots that pay every bill).
  - Bots now prove a share of the souls they judge right (expert 95%, competent 75%, novice 40%), and pay the sun it costs.
  - The purse, demotions, souls left at dusk and endings are unchanged against bots that never prove (experts 172 → 173 rings).
  - Lucky stamps a run: expert 8, competent 32, novice 56, against 128, 124 and 94 for bots that never prove.
  - An expert's Flawless days a run: 2.9, and 0.4 never proving.

**Tests**
- **Engine** (`proven.test.ts`):
  - asked in the full game's campaign and practice, never in the Daily, the primer or the demo, and a Daily played without a look marks nothing;
  - every soul whose proof was looked at is proven, parties and retinues included (two seeds, Days 1–20);
  - stamped without a look, lucky souls name only what their proof rests on, and some souls are proven by the front alone;
  - a soul decided by its back is proven by turning it over, without a touch;
  - a sworn man is lucky while his jarl was a guess, and proven once the jarl's proof was had.
- **Grades** (`run.test.ts`): Flawless with every proof looked at; Sharp with a guess, whether or not every liar was caught.
- **Endless** (`boons.test.ts`): a lucky stamp scores the campaign's points; in the demo, its worth.
- **Report:** the lucky stamps in the grade, read back.
- **e2e** (`vows.spec.ts`): a soul the body's front doesn't settle, stamped rightly without a look: the toast, the audit's row, the grade's line and Look again.

**Known limits**
- **Every drawn sign counts as had.** A sign drawn small on a phone counts whether or not the player noticed it; the engine can't tell noticing from guessing, and the other way would call good judging lucky.
- **A day's best from before** may be a Flawless the new rule wouldn't give.
- **Endless scores are lower** in the full game for players who stamp without looking. Scores kept from before stand.
- **The words are drafts,** and `luckyPoints` is a guess.

## 77. Kennings in the tallies (game phase 11)

**Why.** Game phase 11 in [`roadmap.md`](roadmap.md). A saga tally (Day 11) said what a soul did in plain words. A skald would say it in kennings, naming a thing by another name ("Odin's storm" for a battle). That makes the tally a reading puzzle with no new art, and a forger who doesn't know the craft gives himself away.

**Changed from the pitch**
- **From Day 18, not from "later days" in general.** Day 18 brought no new rule, and it's Odin's day: the god who won the mead of poetry sets his skalds to carving. The roadmap's risk (obscure kennings frustrate players) also argues for late. The cost is exposure: three campaign days (18–20), practice of those days, and Endless's rounds on their rules.
- **"He fed the ravens" and "a straw death" aren't carved.** Feeding the ravens is what a warrior does to his enemies, not how he died. A straw death is dying in bed, of sickness or of old age, and a tally line has to say which. "Odin's storm" and "Hild's game" stand for battle instead; Loki's daughter and Elli for the two deaths in bed.

**Established, and the game's own**
- **Attested:** battle as Odin's weather and as Hild's game (Snorri's *Skáldskaparmál*); Rán's net, which catches the drowned (Snorri); the waves as Ægir's daughters (Snorri); Hel as Loki's daughter, who takes kings who died in their beds (*Ynglingatal*); Elli, Old Age, who brought Thor to one knee (*Gylfaginning*); "fled not" on rune stones (the Hällestad stone: he fled not at Uppsala); *vargr í véum*, the wolf in the sanctuary, an outlaw.
- **The game's own:** each line's wording ("Elli threw him at last"), "No wolf in the sanctuary" as praise, and the forgers' botches ("Rán's storm", "Hel's game"), which are meant to be wrong.

**How it works**
- **A skald's tally** (`cutBy` in `gen/render.ts`). On a day with `kennings` (60 on Days 18–20), that share of saga tallies is cut by a skald. Honest and forged ones are cut at the same rate, so the carving proves nothing. A skald's line is a kenning or a saying where the deed has one (`skald: true` in `templates/tallies.yaml`), and plain where it hasn't: a weapon in hand, its owner. What a tally carves and says is as before; only the words change. Its own random stream, so souls, lies and every other line are as before, and a day without kennings is unchanged.
- **The page.** `kennings.yaml`: each kenning or saying, as carved, and what it means. Every skald's line names the one it carves (`kenning`). The rulebook shows them as "Kennings and sayings" on a day with kennings, under the rule: a skald never gets one wrong, so a kenning that isn't on the page was cut by a forger, and the tally is forged.
- **A forger's botch.** On a forged tally a skald's hand was faked on, at the day's `botch` rate (50), the forger botches the first kenning he can: two from the page mixed up ("Rán's storm took him at Svolder"). Only the battle kennings have botches (`botched`), since the forgers' commonest lie is a battle that wasn't; the coward's "fled not" is a saying and can't be botched. Read, a botched line (`Field.botched`) is a forgery sign like a tell under the lens (`showsForgery`): the tally counts for nothing, and from Day 16 the soul is a caught liar. The lens still shows the carver's habit, for the forger's trail (§71).
- **Never on the Daily.** The Daily has no tallies, and the lint refuses kennings on it. The demo has neither. The Daily's checksums held.

**Teaching**
- **Day 18's decree** says so. Its first soul (`arch.skald_saga`) is a drowned raider whose saga a skald cut. The coach: read the tally (Next), then the rulebook's kennings (Next), then judge.
- **The first botch read** gets a one-time tip with the tally (`coach.botch`), on a device that hasn't put it away.
- **Look again** lists the soul's skald lines under "What the kennings meant", each glossed from the page ("Ægir's daughters: the waves…"), and a botched one marked "No such kenning: a forger cut it".

**Elsewhere**
- **Endless:** Day 18's round now teaches (its first soul is the skald's), so it takes no twist; later rounds carry kennings as their days do.
- **Playtest report:** a mistake on a soul with a skald's tally says so ("Its tally was in kennings." / "…had a botched kenning."), and `pnpm playtest:read` counts them. It's how playtests can show whether kennings are too obscure: the bots don't read words.
- **The lint:** a skald's line names a kenning on the page and carves its words; no botch carves a kenning on the page; every kenning on the page is carved by some skald; kennings only on days that bring tallies, a botch only where there are kennings, never on the Daily; a skald's teaching soul only on a day with kennings.

**Numbers**
- **Generation** (40 seeds of Days 17–20): no fallbacks. About 62% of tallies are a skald's from Day 18 (176 of 282 on Day 18), honest and forged alike. Of the forged ones a skald's hand was faked on, 26 of 59 had a botched kenning on Day 18; the rest had none the forger could botch, or the draw spared it. Day 17 is unchanged.
- **The day goldens:** only Day 18's first soul changed (now the skald's teaching soul). A botch changes no proof: a proof never needs to read a tally it can leave unread.
- **Campaign sims** (`pnpm sim campaign --story plain`, 100 seeds, against main): the economy is unchanged within noise, as it should be, since the bots read no words. Experts' purse 176 → 176 rings and Odin's ending 63 of 100 both times (payAll); competent bots 118 → 116 (payAll) and 212 → 216 (frugal); novices demoted 30 → 32 of 100. At 30 seeds the competent bots' purse fell 113 → 93, and frugal rose: the one soul Day 18's lesson changes moves everything after it in a run, and 30 runs don't average that out.

**Tests**
- **Engine** (`kennings.test.ts`): none before Day 18 and no page; Day 18's first soul brings a skald's honest tally, every line on the page; honest and forged tallies are cut by skalds at the day's rate alike, and only forged ones are botched, each in a skald's kenning; read, a botched line shows the tally forged without the lens (not believed; from Day 16 a liar), and the oracle agrees with the solver.
- **Lint** (`campaign-lint.test.ts`): each rule above.
- **Coach and Endless:** Day 18 has a lesson that can be followed to the stamp; its Endless round takes no twist.
- **Report:** the mistake lines, written and read back.
- **e2e** (`kennings.spec.ts`): practice Day 18's lesson and the rulebook's page; on Day 19, a botched kenning read, its tip, and Look again's list.

**Known limits**
- **Three campaign days.** Starting earlier (Day 14, Hel's day, has the straw deaths) would give the page more use, at the cost of piling onto days that already bring a rule each.
- **A botch can fall on a true line.** On the coward's tally the lie ("fled not") can't be botched, so the forger botches its true battle line instead. The whole tally counts for nothing either way.
- **The bots don't read,** so the sims can't say whether the kennings are too obscure. The playtest report counts the mistakes made on skald's tallies for that.
- **The words are drafts,** and the rates (60 and 50) are guesses.

## 78. Choose the slain (game phase 12)

**Why.** Game phase 12 in [`roadmap.md`](roadmap.md). The game is named for what a valkyrie does, but until now the player only judged the dead that someone else had chosen. Now, once, they choose: at dawn on Day 16 Skögul takes them over the levy's fight at the pass (§51) to choose who falls, and whoever they choose comes to the desk that day, judged like anyone else.

**Changed from the pitch**
- **One falls, not several.** Two from a roster of three would be no choice at all when Ulf isn't there (two from two). One from three or four makes every option cost someone, which is the pitch's "Odin wants the bravest; the valley wants them home".
- **A third man: Aslak, Bera's husband (new).** Without Ulf, the pitch's roster is Kari alone. Bera has written the valley's news since Night 13, so her husband gives the valley's side a face, and choosing him sends Kari home.
- **Choosing no one is an option.** Skögul takes the bravest, Kari, and Odin minds being refused. The drafts' fixed death is now what happens when you choose Kari, when you won't choose, and in a save from before this change.
- **Ulf can die at the pass, but only if you choose him.** §51 left that to you and wrote it so he couldn't. The pitch put him on the roster, so he can.

**Established, and the game's own**
- **Attested:** in *Hákonarmál* (Eyvindr skáldaspillir, about 961) Odin sends Göndul and Skögul to choose which king of Yngvi's line should come to Valhalla. They find Hákon at his last battle, at Fitjar; he asks Skögul why she decided the battle so, and she answers that they brought it about that he held the field and his enemies fled. The valkyries ride. Odin takes kin given to him: in *Ynglinga saga* King Aun gives him his sons, one at a time, for long life.
- **The game's own:** that the game's Skögul is the poem's ("I did this for a king once. Hákon, at Fitjar."); the line holding "because one of them goes"; the roster; Aslak; Odin's standing for each choice; Ulf's metronymic, Rögnuson (the household's father is never named, and Kari goes by his mother's name too).

**How it works**
- **Night 15** ends with Skögul at the door, whatever Ulf did: they ride before light, and Odin wants one of the levy.
- **Day 16's morning** (`scene.d16.morning`): over the pass at first light, Skögul names the men, then one choice. Odin wants the best of them: giving him Kari is what he expects, your own brother is more than he asked, and anyone else is less. Its effects reach the run when the scene ends, before the gate opens and the line is made.

  | Choice | Shown | Flag | Odin | Also |
  |---|---|---|---|---|
  | Kari, at the front | always | `chose_kari` | 0: the one he'd have taken | |
  | Ulf, three shields down | if he went with the levy (`ulf_levy`) and is home | `chose_ulf` | +2 | `family brother gone`: he died |
  | Aslak, at the back | always | `chose_aslak` | −1 | |
  | I won't choose. | always | `chose_none` | −1 | Skögul takes Kari |

  Then the decree, as before; its own choice is gone, so the morning has one.
- **The line.** Day 16 places `case.kari`, `case.ulf16` and `case.aslak` all at Kari's place (third). Their `when`s let one in: Kari unless `chose_ulf` or `chose_aslak`, so a save from before the change has him as before. Each died at sunrise, weapon in hand, wound in front, and belongs in Valhalla under every whim of the day (the compiler proves it, as for any story soul). Only Kari pleads (Rán, §51). The stamp is remembered: `ulf_valhalla`; `aslak_judged`, `aslak_valhalla`. In Valhalla, either is named in its host at Ragnarök like any story soul (§54). With Kari gone from the line, the day can bring an ordinary plea or kin (§59, §60), as any day without a story soul who pleads can.
- **Night 16** (`scene.d16.night`), by who fell:
  - **Kari:** the letters as before (§51).
  - **Ulf:** your mother writes, or your aunt if she's gone: Kari carried him as far as the cairn, and Asa has been told it was the snow.
  - **Aslak:** Ulf's letter (his arm hurt if he went, `fx: family brother sick`, as before) or the house's says Kari came home. Bera writes of her man, on Odin's benches if you sent him there.
  - **At supper Skögul says one thing of the morning:** Odin's horn of mead, for the boy (Kari); a second cup by your elbow, and nothing (Ulf); Odin asked after the old man (Aslak); "You'll have to point yourself one day" (no one). A save from before the change hears nothing.
- **Night 17:** the day after Ulf, your mother's letter is about everything but him.
- **The epilogue:** Ulf fell at the pass, because you pointed (rode with the einherjar, on the benches, or elsewhere); Kari came home (carrying Ulf, or Aslak, and what he did after); Aslak (rode, the benches, or where you sent him).
- **The journal:** the thread that Ulf still owes his share of the smith's fine ends once he's gone, as it should have when a fever took him.
- **Scene notes:** a line whose effects change someone at home says so under it, in the household list's words ("Ulf, your brother: died."), as Odin's "will remember that" does (§20). The morning has no household list, so without it Ulf's death would show only that night.

**The bots** score a scene's paths by their effects (§18). The plain bots and every policy that doesn't weigh Odin choose Kari, the first option, on a tie; Odin's choose him because every other choice but Ulf costs Odin. Hel's and Freyja's choose Aslak: Odin's −1 counts for them, and Aslak comes before "I won't choose". None chooses Ulf, since losing someone at home costs every policy 200.

**Kari earns Odin nothing.** A first version gave Odin +1 for him. Every plain bot chooses him, so that raised the experts' Odin ending from 63 to 76–79 runs of 100: a balance change for anyone who chose as the story had always gone. Now he's simply what Odin expected, and Aslak or no one costs Odin 1, which keeps the valley's choice one step dearer, not two.

**Numbers** (`pnpm sim campaign --story plain,hel`, 100 seeds a policy, against main):
- **The plain bots**, who choose Kari, play exactly as before: every row is the same, and the experts reach Odin's ending in 63–65 runs of 100.
- **Hel's bots**, who choose Aslak, reach her ending as often as before (29, 23 and 28 runs of 100 for the experts). Without Kari's plea they're asked a little less over a run (9.2 souls, from 9.9). The rest moved within noise: novices paying every bill were demoted in 41 runs, from 39, and competent bots ended within a ring of where they did.

**Tests**
- **Engine** (`run.test.ts`): the one who fell stands where Kari stood, in a line of the same length, Kari unless another was chosen; Ulf and Aslak belong in Valhalla and ask for nothing, a wrong stamp is a mistake, and the story keeps where each went; Ulf in Valhalla is named in its host.
- **Scenes and bots** (`campaign-sim.test.ts`): Night 15's warning in every branch; the roster with and without Ulf; each choice's effects; Night 16's news for each, with Skögul's line, and a save from before; Night 17; the plain bots choose Kari and Hel's choose Aslak, and nobody at home is lost.
- **e2e** (`slain.spec.ts`, phone and desktop): from a Day 16 save whose Ulf went with the levy, the roster and an accessibility scan; Ulf chosen, with Odin's note and the household's; Ulf at the desk where Kari would stand, and no Kari; that night your mother's letter, and the household list says he died.

**Known limits**
- **All three belong in Valhalla.** The choice changes who you judge, not how hard the day is: it's a story choice with standing at stake.
- **No bot ever chooses Ulf,** so the sims never play his branch. The tests and the e2e do.
- **New to the story:** Aslak, Ulf's metronymic, and Skögul being the poem's Skögul.
- **A run that played Day 16's morning before this change** shows the new scene in its journal, with whichever option now stands where the old one did ("Kari." for the old first). The journal keeps choices by place, not by words; nothing else about such a run changes.
- **The words are drafts.**

## Sources
- Play: [target API level requirements](https://support.google.com/googleplay/android-developer/answer/11926878?hl=en) · [testing requirements for new personal accounts](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en)
- Steam Next Fest: [June 2027](https://partner.steamgames.com/doc/marketing/upcoming_events/nextfest/june_2027) · [February 2027](https://partner.steamgames.com/doc/marketing/upcoming_events/nextfest/feb_2027) · [overview](https://partner.steamgames.com/doc/marketing/upcoming_events/nextfest)
- Steam: [release process](https://partner.steamgames.com/doc/store/releasing) · [Steam Cloud](https://partner.steamgames.com/doc/features/cloud?language=english) · [Deck Verified](https://www.steamdeck.com/en/verified) · [Deck compatibility review](https://partner.steamgames.com/doc/steamhardware/compat)
- Steamworks libraries: [steamworks.js](https://github.com/ceifa/steamworks.js/) · [steamworks-ffi-node](https://github.com/ArtyProf/steamworks-ffi-node) · [steam-electron-build (Deck switches)](https://github.com/alexanderthurn/steam-electron-build)
- Capacitor: [Announcing Capacitor 8](https://ionic.io/blog/announcing-capacitor-8) · [8.4 SystemBars](https://capawesome.io/blog/whats-new-in-capacitor-8-4-0/)
- [itch.io HTML5 file limits](https://itch.io/t/893409/zipped-html5-game-number-of-files-limit)
- itch.io access (for §38): [access control](https://itch.io/docs/creators/access-control) · [limited releases](https://itch.io/docs/creators/limited-releases) · [download keys](https://itch.io/docs/creators/download-keys) · [restricted links to an HTML5 game](https://itch.io/t/471212/how-to-distribute-restricted-links-to-an-html5-game) · [download keys and restricted HTML games](https://itch.io/t/4199266/do-download-keys-not-work-for-restricted-html-games)
- Sound (for §39): [ASWG-R001 loudness](http://gameaudiopodcast.com/ASWG-R001.pdf) · [Opus recommended settings](https://wiki.xiph.org/Opus_Recommended_Settings) · [Safari and Ogg Opus](https://bugs.webkit.org/show_bug.cgi?id=238546) · [gaps in AAC loops](https://github.com/Selftend/selftend/issues/2437) · [streamer-safe game music](https://www.dl-sounds.com/streamer-safe-game-music/)
