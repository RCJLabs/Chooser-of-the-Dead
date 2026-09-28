# Roadmap

What's queued, what's blocked, and what waits on whom. The original plan and its milestones are in [`build-plan.md`](build-plan.md) §12; what's been built is in [`tech-spec.md`](tech-spec.md) §13–65.

## Done lately

From the foundation brainstorm (numbers are its items), in one pull request ([`tech-spec.md`](tech-spec.md) §63):

- **7. Crash safety.** A screen that breaks pauses the sun, says nothing saved is lost, and offers Reload and a problem report with the error attached. Other errors get a notice the player can dismiss.
- **1. Playtest reports read by script.** `pnpm playtest:read` sums up the reports beside the bots' range: rings by night, how each day was judged and the sun left, mistakes by rule, pleas and kin. `pnpm playtest:keep` keeps a tester's saves as tests that every change must open.
- **The whole game installs.** `/full/` on Pages is its own app now, beside the demo, and plays offline; testers keep their saves ([`tech-spec.md`](tech-spec.md) §65).
- **The repository's new name.** The Pages site moved with the rename, and the demo went blank. It's now built for the path Pages reports, and each deploy checks that the live pages load ([`tech-spec.md`](tech-spec.md) §64).
- **2. A tuning workbench.** The sun's costs and the minimum sun are content now, with their values unchanged. `pnpm sim compare` runs the same seeds on the content as built and on a variant, and prints what moved with 95% intervals.

## Game phases: gameplay and depth

From the gameplay brainstorm, in the order agreed.
- **In progress:** 1 and 2, together.
- **Next:** 4, then 3.
- **Held:** 5–8. They're heavy on writing, so they wait for your story sign-off and go into the rewrite rather than being redone after it.

1. **Interrogation with teeth** (in progress).
   - Today Question is never needed to judge a soul. Every lie that changes the verdict already shows as a contradiction you can find by comparing, and Question only works after you've found it: a 20-second confirmation.
   - The change: question a soul before catching anything. Its answers become testimony you can check, with slips a sharp player catches, and each soul's patience runs out.
   - It becomes a faster, riskier route, never a required one.
2. **Show the mistake** (in progress). The citation and the audit reopen the soul, with the sign you missed and the rule that decided it, and you can replay that soul.
3. **Linked souls.**
   - Souls from one battle or shipwreck arrive in the same shift, and their stories must agree ("I died beside my brother Ketil", while Ketil says he fell alone).
   - A jarl's retinue is judged as a group.
   - It's the cross-checking between souls the desk doesn't have yet, and the biggest engine job here.
4. **Endless as a run.** Between rounds, pick one of three boons, or take a curse for a higher score.
5. **The forger's trail.** The Day 11 forger, Loki's disguised agents and Muninn's gaps leave marks at the desk. Pin them to a board across days, and accuse on set nights.
6. **Valkyrie origins.** Choose who you were in life (shieldmaiden, seeress, trader's daughter, freed thrall). Each has a speed or money perk, a different household and a few scenes of its own.
7. **Mercy has memory.** Word spreads among the dead: how strict or merciful you've been changes how often souls plead, bribe or lie, and some souls you let through turn out later to have lied.
8. **The household as people.** Your family asks favours at the desk (find Ulf's friend among the dead), and their letters react to how you judge.

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
- **Story:** sign off or rewrite the story drafts ([`story-drafts.md`](story-drafts.md)).
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
