# Roadmap

What's queued, what's blocked, and what waits on whom. The original plan and its milestones are in [`build-plan.md`](build-plan.md) §12; what's been built is in [`tech-spec.md`](tech-spec.md) §13–76.

From now on the work is on the full game. The demo keeps what it has, and new features go into the full builds.

## Done lately

Game phases 9 and 10 (below), in one pull request, in the full game only:

- **9. Vows at the cup** ([`tech-spec.md`](tech-spec.md) §75). From Night 3, each night offers three vows for the next day: judge every soul rightly, catch every liar, stamp nothing on a guess, finish with a quarter of the sun to spare, ask no questions, or judge without Skögul's help. Swear one or none. Kept, it pays 2 to 8 rings by how hard it is; broken, it costs Odin 1. The desk keeps the vow in sight and says the moment it's broken.
  - **Changed from the pitch:** a kept vow pays rings only, not standing. Standing for every vow kept would carry runs to endings the judging didn't earn.
  - **Your call, after playtests:** broken vows can cost an ending. Expert bots that swear the hard vows break about five a run, and reach Odin's ending in 6 runs of 30 instead of 18. Bots that swear the easy ones keep them all, for about 50 rings a run.
- **10. Proven, not lucky** ([`tech-spec.md`](tech-spec.md) §76). A right stamp is proven when what you had of the soul settled it: what you looked at, every sign its body showed you, what it owned up to. Otherwise it's lucky, and the desk, the audit and Look again say so. Flawless needs every stamp proven, and in Endless a lucky stamp scores nothing. Never in the Daily, the primer or the demo.
  - Stamped without a look, 61% of right stamps are lucky; the rest are settled by the body's front. Proving costs the bots nothing measurable: their purse, demotions and endings are unchanged.

Game phase 8 (below), in the full game only:

- **8. The household as people** ([`tech-spec.md`](tech-spec.md) §74). Letters from home are scenes of their own now, played after the night's scene on the runs their conditions hold for.
  - **Your mother's errand.** On Night 6 she asks you to send her friend Oddny, dead of the coughing sickness, to Freyja's meadow. Oddny comes to the desk on Day 7 and asks for it herself. Granted, it's a mistake with its usual costs; either way your mother writes that night.
  - **Ulf's errand.** On Night 8 he asks you to look at his friend Steinar's back. On Day 10 the desk says so while Steinar is there, and turning him over to look is what lets you answer Ulf on Night 10, with the truth or a kind lie.
  - **Night 14.** Home writes what the well says of you, from the word among the dead and the souls you've sent wrong.
  - The bots meet both souls in almost every run. Experts earn about 20 rings more for two more souls; novices are demoted about as often as before. The scenes are drafts.

Game phase 7 (below), in the full game only:

- **7. Mercy has memory** ([`tech-spec.md`](tech-spec.md) §73). The dead talk about you. Each ask you grant (a plea, or rings offered for a stamp) moves the word among them a step softer, and each you refuse a step sterner. Stern, fewer souls ask and fewer lie; soft, more ask, more lie, and some bring rings instead of pleading. Only a soul whose lies you could catch at the desk asks; one that lied and was granted is found out two mornings later, runs at the last battle, and softens the word again. Bots that refuse every plea end stern and play about as before; merciful bots end soft and pay for it in mistakes, unless they take the rings. Whether a stern word makes the desk easier for players is a playtest question: the bots' accuracy doesn't depend on lies.

Game phase 6 (below), in the full game only:

- **6. Valkyrie origins** ([`tech-spec.md`](tech-spec.md) §72). A new run asks who she was: the shieldmaiden (turning a soul over is free, the feather quick), the seeress (two free questions a day), the trader's daughter (30 rings more, upgrades 15% off) or the freed thrall (45 s more sun a day), or nobody in particular, as before. Each brings someone to live with the family who keeps themselves while well, so an origin costs nothing until they fall sick, and each has three draft scenes: a first letter, a choice, the last night. The sims can't weigh speed, so whether the four are worth about the same is a playtest question.

Game phase 5 (below), in the full game only:

- **5. The forger's trail** ([`tech-spec.md`](tech-spec.md) §71). One of three carvers, drawn for the run, cuts the forged tallies, and what the desk sees of his knife is pinned to a board. Once the Night 11 letter asks for his name, name him on Night 12 or 14, once.

Game phase 3's second step (below), in the full game only:

- **3b. A jarl's retinue** ([`tech-spec.md`](tech-spec.md) §70). From Day 9, a new rule: a hearth-man who stood by his jarl to the end, and never fled, goes where his jarl goes. A retinue comes to the desk as a party, the jarl marked, and each man's hall is whatever the jarl's own evidence decides. Judge the jarl wrongly and his men go wrong with him; from Day 16, a jarl caught lying about one of his men is Hel's, and so are they. Nothing about any other soul changed, and the Daily is untouched. It's harsh on purpose, and the numbers are guesses until playtest reports count them.

Game phase 3's first step (below), in the full game only:

- **3a. Linked souls** ([`tech-spec.md`](tech-spec.md) §69). From Day 9, one or two parties a day come to the desk together: two or three souls who fell in one fight, or a ship's crew. The player turns between them, and each says something of another: who ran, who kept hold of their weapon, how each died. What one says is checked against the other's own body, never a guess or a tally, so a lie about a companion can always be caught. Caught, it's a lie like any other, and from Day 16 it makes the soul a liar. Stamp each, and the last one sends them all. The numbers are guesses until playtest reports count them.

Game phase 4 (below), in the full game only:

- **4. Endless as a run** ([`tech-spec.md`](tech-spec.md) §68). Before each round after the first, pick one of three boons, or take the curse on offer: every soul judged rightly after it scores one more. Boons add strikes to spare, Skögul's hints, a bounty for liars caught, more presses, and, once there's a sun, more of it or cheaper tools and questions. Curses bring the sun, take a strike, make a wrong Compare a strike, shorten the sun or double the tools' cost. None changes a soul: a day's run has the same souls for everyone. The numbers are guesses until players have run it.

Game phases 1 and 2 (below), in one pull request:

- **1. Interrogation with teeth** ([`tech-spec.md`](tech-spec.md) §66). Press a soul on a claim before anything shows it false, for 10 s of sun. A liar may give way, at odds set by how it talks. The rest hold in the same words whether the claim is true or not, and may add something you can check: true, or a slip the body shows false. Each soul takes two presses. From Day 3, never in the Daily or the primer.
- **2. Show the mistake** ([`tech-spec.md`](tech-spec.md) §67). Look again at a soul stamped wrong: the rule, what decided it, what you never looked at (marked on the body) and where it lied. From its citation (the sun waits), the summary or the audit. Try it again on its own, for nothing, once the shift is over.

From the foundation brainstorm (numbers are its items), in one pull request ([`tech-spec.md`](tech-spec.md) §63):

- **7. Crash safety.** A screen that breaks pauses the sun, says nothing saved is lost, and offers Reload and a problem report with the error attached. Other errors get a notice the player can dismiss.
- **1. Playtest reports read by script.** `pnpm playtest:read` sums up the reports beside the bots' range: rings by night, how each day was judged and the sun left, mistakes by rule, pleas and kin. `pnpm playtest:keep` keeps a tester's saves as tests that every change must open.
- **The whole game installs.** `/full/` on Pages is its own app now, beside the demo, and plays offline; testers keep their saves ([`tech-spec.md`](tech-spec.md) §65).
- **The repository's new name.** The Pages site moved with the rename, and the demo went blank. It's now built for the path Pages reports, and each deploy checks that the live pages load ([`tech-spec.md`](tech-spec.md) §64).
- **2. A tuning workbench.** The sun's costs and the minimum sun are content now, with their values unchanged. `pnpm sim compare` runs the same seeds on the content as built and on a variant, and prints what moved with 95% intervals.

## Game phases: gameplay and depth

From the gameplay brainstorm, in the order agreed.
- **Done:** 1–10 (above). 7 and 8 were held for your story sign-off, since they're heavy on writing; you said to treat the story as good and go on. Their scenes are still drafts, marked `# draft` like the rest.
- **Next:** 12 from the second brainstorm (below), the first big one.

1. **Interrogation with teeth** (done, [`tech-spec.md`](tech-spec.md) §66). Its odds, cost and patience are guesses until playtest reports count presses.
2. **Show the mistake** (done, [`tech-spec.md`](tech-spec.md) §67).
3. **Linked souls.**
   - Souls from one battle or shipwreck arrive in the same shift, and their stories must agree ("I died beside my brother Ketil", while Ketil says he fell alone). Done ([`tech-spec.md`](tech-spec.md) §69).
   - A jarl's retinue is judged as a group: the hearth-men share their jarl's fate, a rule that reads across souls. Done ([`tech-spec.md`](tech-spec.md) §70).
4. **Endless as a run** (done, [`tech-spec.md`](tech-spec.md) §68). Between rounds, pick one of three boons, or take a curse for a higher score. Its numbers are guesses until players have run it.
5. **The forger's trail** (done, [`tech-spec.md`](tech-spec.md) §71). One of three carvers, drawn for the run, cuts the forged tallies. His knife's habits show on each forged tally, on the papers Loki's borrowed faces carry, and in Muninn's gaps, and what the desk sees is pinned to a board. Once the Night 11 letter asks for his name, name him on Night 12 or 14, once; the right man and the wrong one each come to the desk.
6. **Valkyrie origins** (done, [`tech-spec.md`](tech-spec.md) §72). Choose who you were in life (shieldmaiden, seeress, trader's daughter, freed thrall). Each has a speed or money perk, someone more at home who keeps themselves while well, and three scenes of its own.
7. **Mercy has memory** (done, [`tech-spec.md`](tech-spec.md) §73). Word spreads among the dead: how strict or merciful you've been changes how often souls plead, bribe or lie, and some souls you let through turn out later to have lied.
8. **The household as people** (done, [`tech-spec.md`](tech-spec.md) §74). Your family asks favours at the desk (find Ulf's friend among the dead), and their letters react to how you judge.

From the second gameplay brainstorm, all in the full game only. 9 and 10 came first; 12 is the first big one. No outside player has tried phases 1–8 yet, so their numbers are still guesses; adding all ten before a playtest would make that worse.

9. **Vows at the cup** (done, [`tech-spec.md`](tech-spec.md) §75). Each night, swear one of three vows for tomorrow, as saga heroes did over the cup (heitstrenging): no questions, no citation, a quarter of the sun to spare, every liar caught before the stamp. Kept, it pays rings; broken, it costs standing. Its numbers are guesses until playtest reports count vows.
10. **Proven, not lucky** (done, [`tech-spec.md`](tech-spec.md) §76). A right stamp counts as proven only if what you'd seen was enough to decide it. Flawless needs every stamp proven, and Endless scores only proven souls. Grades reward judging, not guessing that most souls go to Hel.
11. **Kennings in the tallies** (medium). On later days, skalds write tallies in kennings and sayings ("he fed the ravens", "he went to Rán", "a straw death"), with a kennings page in the rulebook beside the Futhark, and forgers misuse them. A reading puzzle with no new art. Risk: obscure kennings frustrate players.
12. **Choose the slain** (medium to large, mostly writing). At dawn on Day 16, Skögul takes you over the levy's fight at the pass to choose who falls, as she and Göndul chose King Hákon in *Hákonarmál*. Kari is on the roster, and Ulf if you let him go; whoever you choose is in that day's line, judged like anyone else. Odin wants the bravest; the valley wants them home. Risk: it rewrites Kari's fixed death and Nights 15–16.
13. **Seal tomorrow's decree** (medium). Three nights a run, Odin's clerks send two drafts of tomorrow's decree. Sealing one pleases one god and annoys another, and steers the days towards rules you judge well or the ending you want. Risk: every draft adds to what the fairness checks and sims must cover.
14. **Loki learns** (medium, needs art). Each time you catch him, his next disguise hides that tell and shows another from his myths (salmon, mare, fly, seal, Þökk), each taught before it's used; missed, he keeps what worked. Risk: each tell needs new woodcut art and a fair visual hint.
15. **The trainee** (medium to large). From the second rank, a trainee Valkyrie (Hrist, from *Grímnismál*) stamps some of your souls first. Countersign for less sun, or overturn by pointing at what she missed, and she stops making that mistake. Risk: another flow on the crowded phone layout.
16. **Call a soul forward** (medium). See the next few souls in line, one sign each, and pay sun to call one forward, for example to save the living before dusk. [`tech-spec.md`](tech-spec.md) §41 names it as the follow-up if playtests want it, so it fits best after people have played. Risk: tangles with noon decrees and parties.
17. **The Thing** (medium). Every few nights, a lawspeaker reviews three past verdicts, and one may be wrong. Stand by each by pointing at the evidence that decided it, or concede; standing by a wrong one costs the most. Risk: overlaps appeals and "show the mistake".
18. **After the fire** (large). After an ending, a short second campaign after Ragnarök, in the halls *Völuspá* and Snorri describe: Gimlé for the worthy, Náströnd for oath-breakers and murderers, and Baldr back from Hel. A new rulebook to replay with. By far the biggest; it should wait for playtest data on the main campaign.

15 and 17 both need 10's check (whether what was seen proves a stamp), so it's written once, with 10.

**Two rules for all of them:**
- **The live Daily doesn't change.** Anything that changes how souls are generated (1 and 3) starts in the campaign and Endless, or waits for a planned change to how Dailies are generated.
- **Perks never change what can be solved,** only speed or money, as with upgrades.

## Queued: build and platform work

In this order:

1. **One saves folder for each edition.** This is a fix to the Steam shell (tech-spec §62).
   - Today the demo and the full game both keep their saves in `ChooserOfTheSlain/saves`. As two Steam apps, both would sync those same files through Steam Cloud.
   - From reading the code: a player who owns both would see their full-game campaigns in the demo's slots, shown as unreadable.
   - The fix: give the demo its own folder. On its first run, the full game copies over the demo's Daily results, settings and campaigns. That's the demo-progress import tech-spec §8.1 lists as a nice-to-have, and §8.1 already assumed the demo had a save folder of its own.
   - Run the demo edition in the shell's smoke test too.
   - It has to land before a Steam demo app exists.
2. **The shell's test gaps.**
   - Test backup export and restore inside Electron: the download, and the file input.
   - Have CI keep the packaged Windows and Linux folders as downloads, so the first real Steam test can run on your PC without a local build.
3. **Bots that behave like players** (brainstorm 3).
   - They miss signs according to how subtle they are. The spec defines miss rates by subtlety; they were never built.
   - They take time per action from the observations' own costs, and can run out of sun.
   - They question souls and grant pleas.
   - Their settings get fitted to the playtest reports.
   - Then `sim compare` can tune the sun's costs too. Today's bots never meet them.
4. **An automated check that signs are big enough on screen** (brainstorm 4).
   - Render every sign at the smallest body each layout allows, and fail CI below a minimum for each level of subtlety.
   - This replaces the one-off check of the 160 px floor (tech-spec §61, Known limits). Today nothing checks on-screen sign sizes; it's done by eye on the art sheet (`pnpm art:sheet`, §17).
   - The commissioned woodcut will have to pass it.
5. **WebKit and Firefox in CI** (brainstorm 8). Run the Daily checksum test and a quick smoke test in both, since iPhone browsers run WebKit.
6. **Rich presence** (optional, after the first real Steam test): "Day 7 – judging the fallen".
   - It can only be tested here against a fake Steam.
   - It needs a localization file uploaded in Steamworks.
7. **GitHub Actions on their Node 24 versions.** Every deploy log warns that the actions in use are built for Node 20, which GitHub is retiring, and forces them onto Node 24. Check which versions to move to, then bump them.

## Held

- **A budget for cheap phones** (brainstorm 9): bundle sizes enforced, and a busy morning timed with the CPU slowed 6×. Do it before Android.
- **A story-facts check** (brainstorm 11): family relationships, deaths and names checked across scenes. Do it when the story rewrite starts.
- **Not picked:** finishing the Case Lab with a blind review (brainstorm 6), a welcome-back recap (10), and deploying telemetry, which needs your Cloudflare account.

## Blocked in the cloud environment

- **Android, M9.** Java 21, Gradle and Google's Maven repository are all there. What's missing:
  - The environment's network policy refuses the Android SDK's host, `dl.google.com`.
  - There's no KVM, so no emulator.

  To unblock the SDK, allow `dl.google.com` in the environment's Network access settings. The emulator would still have to run in CI. The plan has M9 in Aug 2027.

## Waiting on you

- **Steam:** the first real Steam test ([`steam.md`](steam.md)). Then the app IDs, the Steamworks setup (achievements, Steam Cloud, launch options), and a Steam Deck.
- **Playtests:** outside playthroughs of `/full/` ([`playtest.md`](playtest.md)). Tuning the economy waits on their reports.
- **Story:** sign off or rewrite the story drafts ([`story-drafts.md`](story-drafts.md)). For now they're treated as good, on your word, so game phases 5–8 go ahead; what they add is draft too.
- **Art and sound:** commission the woodcut art ([`art-brief.md`](art-brief.md)) and the sound ([`sound-brief.md`](sound-brief.md)).
- **Store and events:** the Steam store page, and the Next Fest decision ([`next-fest.md`](next-fest.md)).
- **The Daily alpha:** its public launch ([`alpha-launch.md`](alpha-launch.md)).

## Milestones (build-plan §12)

| Milestone | Where it stands |
|---|---|
| M0–M3: foundations, fairness engine, core loop, Daily alpha | Built. The alpha's public launch waits on you. |
| M4–M5: campaign systems, vertical slice | Built. Art and sound wait on commissions. |
| M6: Steam page and Electron | The shell is built (tech-spec §62). The store page, the Steam builds, cloud saves and achievements wait on the Steam apps. |
| M7: content | Engineering done. The story waits on sign-off, and tuning on playtests. |
| M8: Steam demo and Next Fest | Not started. Needs the demo app, and queued item 1 first. |
| M9: Android and Play | Not started. Blocked here (above). |
| M10–M11: beta, launch | Later. |
