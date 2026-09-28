# Roadmap

What's queued, what's blocked, and what waits on whom. The original plan and its milestones are in [`build-plan.md`](build-plan.md) §12; what's been built is in [`tech-spec.md`](tech-spec.md) §13–62.

## Queued: doable in a cloud session

In this order, as one pull request:

1. **One saves folder for each edition.** This is a fix to the Steam shell (tech-spec §62).
   - Today the demo and the full game both keep their saves in `ChooserOfTheSlain/saves`. As two Steam apps, both would sync those same files through Steam Cloud.
   - From reading the code: a player who owns both would see their full-game campaigns in the demo's slots, shown as unreadable.
   - The fix: give the demo its own folder. On its first run, the full game copies over the demo's Daily results, settings and campaigns. That's the demo-progress import tech-spec §8.1 lists as a nice-to-have, and §8.1 already assumed the demo had a save folder of its own.
   - Run the demo edition in the shell's smoke test too.
   - It has to land before a Steam demo app exists.
2. **The shell's test gaps.**
   - Test backup export and restore inside Electron: the download, and the file input.
   - Have CI keep the packaged Windows and Linux folders as downloads, so the first real Steam test can run on your PC without a local build.
3. **The body at its 160 px floor.** On a 360 px phone the crowded desk shrinks the body down to 160 px. Check that the subtler signs are still readable at that size (tech-spec §61, Known limits), with the readability capture (§17).
4. **Rich presence** (optional, after the first real Steam test): "Day 7 – judging the fallen".
   - It can only be tested here against a fake Steam.
   - It needs a localization file uploaded in Steamworks.

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
