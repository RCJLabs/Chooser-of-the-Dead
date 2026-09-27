# Playtest builds: the whole game for invited testers

The public builds stop at Day 3, and the campaign's economy has only been tuned against bots. The `web-playtest` build is the whole game, on its own restricted itch.io page, for the people you invite. It's also on GitHub Pages, unlisted, beside the demo (below). Each save slot turns its run into a report for the playtest form. The technical side is in [`tech-spec.md`](tech-spec.md) §38 and §48.

## On GitHub Pages, unlisted

Since 25 September 2026, the Pages deploy carries the same build at `/full/`: **https://rcjlabs.github.io/Vikings-R-Us/full/**.
- **Nothing links to it.** The demo doesn't mention it, and the page asks search engines not to list it (`noindex`). It isn't private, though: anyone with the link can play the whole campaign.
- **It follows `main`.** Every merge redeploys it with the demo, and its title screen names the commit.
- **Its saves are its own,** as on itch: nothing it keeps touches the demo's.
- **A browser that has played the demo needs the demo's update once.** Until then the demo's offline copy answers `/full/` and shows the demo. Open the demo, tap **Update now** on its title screen, then open `/full/`. A private window works straight away.
- **To take it down,** remove the three `web-playtest` steps from `.github/workflows/deploy-web.yml` and upload `dist/web-demo` again, as before.

## What testers get

- **The whole campaign,** Days 1–20 with every ending, plus the Daily and Endless. There's no Case Lab.
- **A note on the title screen** saying it's a playtest build and which one. For example, `web-playtest · 3f2a9c1 · content ca5b2592` gives the target, the commit and the content.
- **A Playtest report button on each save slot.** It opens the report, which covers:
  - the run so far: the day, the rings, the family, standing with the powers met, whether it's under oath, and its weave if it's woven; the arms bought for the last battle, by front, and the night Skögul's reprieve paid the debt, if it did;
  - one row per day: the day's grade and the liars caught, the souls judged rightly and wrongly, pay, bonus, fines, bills, shop (net of anything sold back), arms (in the full game), story, Draupnir, and the rings after the night, with what the reprieve paid beside them;
  - every soul sent wrong: the stamp, where it belonged, the rule that decided it, whether it came after a noon decree, and whether it was a bribe taken or a plea granted;
  - every soul that asked for another hall, and every soul's kin who came, granted or refused: how many in all, and each by day with where it belonged and what it asked (a refused plea is a right stamp, so nothing else shows it). Days played on a build from before these were kept are named as not counted;
  - every appeal heard, and how it went;
  - each night the sun set on the line: who waited for the next day, who died in the night, and what it cost;
  - each god's request: what was asked, how many souls were sent as asked, and whether it was done;
  - the gods' favours each day held, and the fines they spared;
  - each day's trip home at dawn, and the sun it cost;
  - the day events the days played brought (a storm, a sickness, a battle, a feast);
  - each promotion offered and what was made of it, the days worked at each rank, and any step down;
  - every choice made in a scene;
  - the last battle, once fought: the order the fronts were set in, and each front's foe, who stood there, who ran, and whether it held; under each front, by name and day, the souls who ran from its own host and the story's own souls in that host;
  - the epilogue, once the run has ended: each line it said, by part and slot.
- **Open the playtest form** opens the GitHub form *Campaign playtest report* with the report already filled in. A long run doesn't fit in a link (over 8,000 characters), so the form opens empty, and the game says to copy the report and paste it in.
- **Copy the report,** for testers who'd rather send it another way.
- **Saves kept apart from the public demo's.** See Known limits for why.

## Setting up the page (once)

1. **On itch.io, create a second project,** separate from the demo's.
   - Kind: HTML.
   - Embed options as for the demo ([`alpha-launch.md`](alpha-launch.md) §2): viewport 1280 × 800, "Mobile friendly", fullscreen button on.
2. **Set its visibility to Restricted, with a password.** Alternatively, leave it as a Draft and share its secret URL.
   - Don't use download keys. For a browser game they lead to a download page with nothing on it (from itch's community forum; see Sources).
3. **In the repository, add the variable `ITCH_PLAYTEST_TARGET`,** for example `rcjlabs/chooser-of-the-slain-playtest:html5`.
   - It uses the same `BUTLER_API_KEY` secret as the demo.
   - The workflow refuses to push to the demo's project (the one in `ITCH_TARGET`).
4. **Create the labels `playtest` and `campaign`** in the repository's Issues. GitHub skips any label a form names that doesn't exist, and none of the forms' labels do yet: `alpha` and `soul-report` are missing too.
5. **Upload the build.** Go to Actions, then *Deploy playtest build*, then *Run workflow*, and pick the branch to build (normally `main`).
   - The workflow builds, runs the leak check and itch's size limits, then pushes with butler.
   - It never runs by itself, so testers only get a new build when you choose.
6. **After the first upload,** tick "This file will be played in the browser" on the itch edit page.
7. **Check it:** open the page in a private window.
   - It should ask for the password.
   - The title screen should show the playtest note, with the commit you built.

I couldn't open itch.io from here, so check steps 1, 2 and 6 against the dashboard itself.

## Inviting testers

- **Send the link and the password privately,** one tester at a time.
- **Tell them three things:**
  - Play in one browser, and don't clear its site data. The run lives in the browser, and the report is made from it.
  - Settings, on the title screen, can back up their saves.
  - When they're done, or at any point along the way, they press Playtest report on their slot and send it.
- **Filing the form needs a GitHub account,** and the issue is public: anyone can read it, along with the tester's GitHub name. Testers who'd rather not can use Copy the report and send it privately.

## Reading reports

- **Reports arrive as issues** titled *Campaign playtest: Day N* (with ", an ending" for a finished run), labelled `playtest` and `campaign` once the labels exist.
- **The Days table is plain Markdown with ASCII signs,** so a script can read it as easily as a person.
- **The Grade column** reads, for example, "sharp (3/4 liars)": every soul judged rightly, and three of the day's four liars caught in a lie before the stamp (§49 of the tech spec). ", assisted" means a slower or faster sun, or the rule tracker.
- **The Mistakes list shows the rule and what each wrong soul was stamped,** not what the soul looked like.
  - To see the souls themselves, ask for a backup (Settings, on the title screen). Restored in `pnpm dev`, the tester's slots can be continued, or replayed from any day with the same seed. That gives the same souls, unless the generator has changed since their build.
- **Choices are read back by replaying each scene with the choices made.** A scene rewritten since the tester played it shows "(the scene has changed since; options 1, 2)" instead of the words.
- **The build line says which commit and content the tester had,** so a report can be matched to the code.

## Known limits

- **A link and a password can be passed on.** itch's restriction keeps out passers-by, not a tester who shares it. And the repository is public, so anyone can build the whole game from source anyway.
- **The Pages copy has no password at all.** It's unlisted, which only works while nobody posts the link.
- **Saves live in the tester's browser.** Any of these can lose a run, and its report with it:
  - a private window;
  - cleared site data;
  - Safari, which clears a site's storage after seven days without a visit.

  Backups are the answer, and on Safari they're worth making after every session.
- **Why saves are kept apart (partly speculative).**
  - Established: the demo shows a save it can't read as unreadable and offers to clear it. A playtest save from the whole game is one it can't read.
  - Not verified from here: whether itch serves every HTML5 game from one origin, so the two pages would share one browser storage. I believe it does (`html-classic.itch.zone`), and browsers that partition storage by site would still put both pages of one creator together.
  - So the playtest build keeps its own keys (`cots.playtest.*`) and its own database (`chooser-of-the-slain.playtest`). If itch doesn't share an origin, this costs nothing.
- **Nothing carries over from the demo.** Settings, Daily streaks and achievements start fresh in the playtest build.
- **Choices are only as readable as the scenes that are still in the game,** as above.
- **The report says what happened, not why.** The form's questions ask for that: how the money felt, what seemed unfair, the story, bugs.

## Sources

From search results; itch.io itself is blocked from this environment.

- [itch.io: access control](https://itch.io/docs/creators/access-control) · [limited releases](https://itch.io/docs/creators/limited-releases) · [download keys](https://itch.io/docs/creators/download-keys)
- [Distributing restricted links to an HTML5 game](https://itch.io/t/471212/how-to-distribute-restricted-links-to-an-html5-game) · [Download keys and restricted HTML games](https://itch.io/t/4199266/do-download-keys-not-work-for-restricted-html-games)
