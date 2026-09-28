# M7 design: Days 7–20, endings and the full campaign

Draft for review. It covers the mechanics M7 builds; the story text comes after, as drafts for you to edit. Decisions marked **(choice)** are mine and cheap to change: they are content (YAML), not engine code.

## What exists

- **Mechanics through Day 12:** registry (6), rune-lens and borrowed blades (7), nails and clippers (8), TRANSFER and pendants (10), forged tallies (11), Loki and DETAIN (12). Day 9 has no spec yet.
- **Story for Days 1–6 and Day 12.** The plain campaign ends after Day 6.
- **Endings:** demoted, alone, and the placeholders for the demo, the slice and the unwritten rest.
- **The oracle is fast (M7.1).** Days 13–20 can add facts without the fairness tests slowing down.

## Design constraints kept

- Every soul's destination follows from its own facts through the rulebook, so every case can still be checked by the solver, the oracle and F1–F8.
- Ravens never lie. Muninn may leave blanks.
- Testimony can lie. Every lie that changes the outcome can be caught.
- Upgrades change speed only.

## Days

| Day | New rule | How it plays |
|---|---|---|
| 9 | none | Day 8's rules, a longer queue. Draupnir pays at night. The first big family choice. |
| 13 | Muninn remembers lives | Muninn now reports one fact about a soul's life (oath broken or kept, faith, whose weapon it was). Huginn keeps reporting how they died, and sometimes adds a true fact that isn't decisive. The ravens can "disagree": both are true, but one points to Valhalla and the other to Hel, and the Order of Judgment decides. Muninn forgets more often as Ragnarök nears. |
| 14 | Hel's hall is full | Straw deaths (sickness, old age) that no earlier rule claims go to the clerk: TRANSFER **(choice: the alternatives are Rán or holding them at the gate)**. The cause now matters for unworthy souls, not only worthy ones. |
| 15 | Odin's claim | A second daily whim. Odin claims the worthy with a visible trait (two or more front wounds, or a true Ulfberht) for Valhalla, ahead of Freyja's whim. A worthy soul both gods claim goes to Valhalla. Stamping it for Freyja is wrong but wins her favour: the faction choice. |
| 16 | Liars forfeit the halls | A soul that would enter Valhalla (or, from Day 17, is spear-marked) but lies goes to Hel. A soul is a liar exactly when it tells a lie, in speech or on a forged tally. Souls are presumed honest until a lie is caught. |
| 17 | The spear-mark loophole | A new body sign: a spear mark cut before death (Ynglinga saga). A straw death with the mark goes to Valhalla, ahead of Hel's overflow. Liars still forfeit it. |
| 18 | none | Draupnir pays. Naglfar is nearly built; Loki's last offer. |
| 19 | none | Every rule, the hardest queue. The last night. |
| 20 | none | Ragnarök: a surge queue (about 20 souls), then the endings. |

Rules accumulate: every rule stays in force to Day 20.

### Rule order (Day 20)

| Order | Rule | Destination |
|---|---|---|
| 90 | Loki in disguise | DETAIN |
| 100 | still breathing | RETURN |
| 200 | outlaw | HEL |
| 300 | baptized | TRANSFER |
| 500 | drowned | RÁN |
| 550 | borrowed weapon | HEL |
| 580 | liar who would enter a hall | HEL |
| 590 | worthy, Odin's claim | VALHALLA |
| 600 | worthy, Freyja's whim | FÓLKVANGR |
| 640 | spear-marked straw death | VALHALLA |
| 700 | worthy | VALHALLA |
| 950 | straw death (Hel is full) | TRANSFER |
| 999 | everyone else | HEL |

Liars lose Fólkvangr too **(choice)**. It keeps the rule to one line: "a liar forfeits the halls of the worthy".

## Engine changes

1. **Muninn's reports (Day 13).** Muninn gets lines that assert life facts (`outlaw`, `faith`, `weaponOwner`). The raven planner gains two knobs:
   - `muninnRecall`: how often Muninn reports a decisive life fact instead of only naming the soul.
   - `huginnAside`: how often Huginn adds a true fact that isn't decisive.

   Both keep F1: every raven line is true.
2. **Liars (Day 16).** A fact can be marked `fromLies`. It is never sampled: it is true exactly when the soul tells a lie. The generator plans lies before judging, so `liar` is part of the truth the rulebook reads.
   - **Solver:** a caught lie (a contradiction, or a forged tally's tell) makes `liar` true at trust 4. Otherwise it is presumed false.
   - **Oracle:** in each world, `liar` must equal "some line is false in this world", and it is presumed false.
   - **Checks:** F6 already requires a decisive `liar` that breaks its presumption to be proven, so a worthy liar's lie must be catchable. No new check is needed.
3. **Spear mark (Day 17).** A fact, an observation (front, salience 2), a world constraint (only straw deaths carry it) and drawings in all three art styles.
4. **Endings state.** The run counts souls sent to each hall and nails left uncut (Naglfar). Endings can read three new paths:
   - `sent.<DEST>`
   - `naglfar`
   - derived: `ragnarok` (the host's strength) and `lead.<faction>` (one faction's standing minus the highest other).

   All are integer math. The fields are optional, so old saves load unchanged.

## Endings

Checked each night in this order. The first that holds ends the run. Faction endings wait for Day 20's night.

| Order | Ending | When |
|---|---|---|
| 10 | Demoted | two nights in a row below −30 rings (exists) |
| 20 | Alone | the whole family gone (exists) |
| 100 | Naglfar Sails Early | from Day 18: a deal with Loki, and 10+ souls sent on with nails uncut |
| 200 | Rebirth (true ending) | Day 20: the truth learned (`truth` 3+), the family hidden in Hoddmímir's wood, a strong host (260+), someone at home |
| 300 | Smuggled Home | Day 20: a place on the ferry (story), 100+ rings for the fare, someone left to smuggle |
| 400 | The Transfer | Day 20: the clerk's contract signed, clerk standing 4+ |
| 500 | Hel's Steward | Day 20: Hel leads the factions, standing 8+ |
| 510 | Freyja's Own | Day 20: Freyja leads, standing 8+ |
| 520 | Chooser Eternal | Day 20: Odin leads |
| 990 | The Wolf Wins | Day 20: the host is too weak (240 or less) |
| 1000 | The Last Stand | Day 20, otherwise |

- **Host strength** = 2 × worthy einherjar − unworthy + 2 × Fólkvangr + 2 × Hel − 2 × uncut nails. This is the plan's formula scaled by two, so it stays integer. It grows with every soul sent to a hall, so its thresholds are absolute numbers for this campaign's queue sizes: bots end near 320 (expert), 290 (competent), 240 (competent, leaving two nails a day) and 210 (novice). The reach test below catches drift if queue sizes change.
- **Bots reach every ending** (M7.7). The campaign sim plays each day's scenes with a story policy: it weighs every path through a scene by the effects the path has (flags, standing, rings), never by its words, so rewriting a scene keeps the bots working. Policies: plain (no deals, family home), naglfar, rebirth, ferry, transfer, hel, freyja, odin and wolf. `packages/testkit/src/campaign-sim.test.ts` names a bot for each ending and fails if none of six seeds reaches it; a negative control (an unaffordable fare) fails it.

| Ending | Reached by (12 seeds each) |
|---|---|
| Naglfar, Rebirth, Smuggled Home | 12 of 12, expert or competent |
| Hel's Steward, Freyja's Own | 12 of 12 expert who also does her requests (2 and 0 who don't); competent 5 and 10 of 12 (tech-spec §42) |
| Chooser Eternal | 12 of 12 expert; 3 of 12 competent |
| The Transfer | 11 of 12 expert; 3 of 12 competent |
| The Wolf Wins | novices who survive; 4 of 12 competent saboteurs |
| The Last Stand | most plain players |
| Demoted, An Empty House | careless judging; bills never paid |

Mistakes cost standing (a wrong stamp angers the god who lost the soul), so a competent player's Odin ends near −16 however they side, and the faction endings mostly go to careful players.

## Story (M7.6, first draft)

The scenes carry five threads toward the endings. Each step is an explicit choice; mistakes never advance a plot. Details and flags are in `docs/story-drafts.md`.

- **Ulf and the ship (Naglfar):** Ulf carves copied Ulfberhts for a smith (Day 7), is offered shipyard work in the north by a man with very clean hands (Day 9), and builds Loki's ship if he goes. Loki offers the family a place aboard for uncut nails (Day 8, and a last time on Day 18).
- **The truth (Rebirth):** Muninn says Odin knows how it ends (Day 13, the midpoint twist). Hel's bridge-keeper says Baldr will walk out afterwards (Day 14). Thorvald has slept in Hoddmímir's wood, where two people survive the fire (Day 16). Skögul sings the rest on the last night (Day 19).
- **The ferry (Smuggled Home):** a nameless ferryman at the fjord's mouth, 20 rings for a place (Day 15) and 60 on the day.
- **The clerk (The Transfer):** comedy between departments (Days 10 and 14), then a contract for a post in a department that isn't in the song (Day 18).
- **Standing (faction endings):** Hel's strike (Day 14), Freyja against Odin's claim (Day 15), and who you ride with on the last night (Day 19).

**Day 17 decides where the family is** when the horn blows: the ship, the ferry, the wood or home. Each choice drops the other plans, so the ending matches it. Taking Loki's deal on Day 18 replaces that plan with the ship.

## Economy

The problem: by Day 6 a competent player has about 126 rings and nothing to buy.

- **Winter bills.** The hearth goes from 8 rings to 14 by Day 18, and medicine from 12 to 18.
- **New upgrades (speed only).** Each new tool gets one, and so do the ravens and questioning. They cost 20–40 rings.
- **Story costs.** Choices in the story cost rings: the healer, a brother's debt, the clerk's fee, the ferryman. The ferryman (Smuggled Home) is the big goal to save for.
- **Tuning.** `pnpm sim campaign` sets the numbers; the target is a careful player ending Day 20 with savings, only if they skipped the ferryman.

**As tuned (M7.7).** A competent player who paid every bill and bought every upgrade used to finish on about 576 rings, with nothing to buy after Day 15. Cutting wages or raising bills enough to fix that also demotes most novices (fines, not bills, are what sink them), so the late winter got optional sinks instead: four more speed-only upgrades from Day 13 (175 rings in all), bills 10% higher from Day 13, and a ferry fare of 100. With the story played (plain policy, 12 seeds): competent players end on about 368 rings (305 at worst), experts on about 691, and frugal novices survive 6 times in 8. Careless players are still always demoted, and pay-everything novices mostly. This misses the target: a competent player can still afford the ferry without giving anything up. Squeezing harder costs the novices; that trade-off wants playtests, not bots.

## Endless (built in M7.7)

Walk the days' rules in order, five souls per day's rules, three strikes, no sun. The score is the souls judged rightly. It reuses the day specs, so it needs no new content.

As built: round *r* plays the first five souls of day *r*'s own queue (so each day's teaching soul, its new rule, comes first), then the last day's rules for as long as the player lasts. A wrong stamp, or unclipped nails, is a strike, and the third ends the run where it stands. The best score is kept on the device. The demo walks Days 1–3; the full game Days 1–20. `packages/engine/src/shift/endless.ts`; the UI keeps the run as a session mode (`packages/ui/src/store.ts`). Since then (audit item 9, [`tech-spec.md`](tech-spec.md) §27): a run of the day that's the same for everyone, share text, a run kept through a reload, and twists on rounds that bring nothing new. And in the full game (§68): a boon or a curse chosen between rounds, and a score in which each curse makes a soul worth more.

## Order of work

- M7.2: this document.
- M7.3: Days 9, 13–15 (Muninn's reports, Hel's overflow, Odin's claim).
- M7.4: Day 16 (liars) and Day 17 (spear mark, art).
- M7.5: Days 18–20, the 20-day campaign, endings state and conditions, economy.
- M7.6: story drafts for Days 7–11 and 13–20.
- M7.7: bots reach every ending; every day meets the generation gates; Endless.

## Open questions for you

1. Hel's overflow goes to the clerk (TRANSFER). Would you rather use Rán, or hold them at the gate (DETAIN)?
2. Liars lose Fólkvangr as well as Valhalla. Or only Valhalla?
3. Spear-marked souls count as worthy einherjar at Ragnarök. Keep that?
