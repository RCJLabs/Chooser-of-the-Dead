# Daily Shift alpha: launch checklist

M3 builds everything the public Daily alpha needs. This page lists what only the
repository owner can do. Steps 1 and 5 are required; the rest can wait.

## 1. Put the web demo online (required)

1. Merge `claude/vikings-game-concepts-69zso3` into `main`.
2. **Settings → Pages → Source: GitHub Actions.** The *Deploy web demo* workflow
   then publishes every push to `main` at <https://rcjlabs.github.io/Chooser-of-the-Dead/>.
3. **Settings → Branches:** protect `main` and require the *CI* check.

The Pages build is a PWA. Players get an "Update now" prompt on the title
screen (never mid-shift) when a new version is deployed.

## 2. itch.io

1. Create the project on itch.io (kind: HTML). Suggested embed options:
   viewport 1280 × 800, "Mobile friendly", fullscreen button on.
2. Create an API key (itch.io → Settings → API keys) and add it as the
   repository secret `BUTLER_API_KEY`.
3. Add the repository variable `ITCH_TARGET`, e.g. `rcjlabs/chooser-of-the-slain:html5`.
4. Push to `main` (or run *Deploy itch.io* by hand). After the first upload,
   tick "This file will be played in the browser" on the itch edit page.

Without the secret and variable the itch workflow skips itself.

The whole game, for invited playtesters, goes on a second, restricted itch.io page: see [`playtest.md`](playtest.md).

## 3. Telemetry (optional; strongly recommended for tuning)

It's opt-in and anonymous; `docs/privacy.md` says exactly what is sent. Setup
is in `apps/telemetry/README.md`: a free Cloudflare account, one D1 database, two
secrets, then the repository variable `TELEMETRY_URL`. Until that variable is
set, the game shows no telemetry option at all.

Not legal advice: the privacy note is written to be accurate for what the code
does. Check whether your situation needs more (for example a contact address).

## 4. Links (optional)

Repository variables, picked up by the Pages and itch builds:

| Variable | Shows |
|---|---|
| `COMMUNITY_URL` | A "Community" link (Discord invite, forum, …) |
| `STEAM_URL` | "Wishlist on Steam" in demo builds (after the store page exists, M6) |
| `TELEMETRY_URL` | The opt-in telemetry question and setting |

Feedback and "Report this soul" open GitHub issue forms (`.github/ISSUE_TEMPLATE`).
Issues are already enabled. Create the labels `alpha`, `playtest` and
`soul-report` so the forms can apply them. Players need a GitHub account to
submit; the report text can also be copied and pasted anywhere, such as the
community channel.

## 5. Decide before launch (required)

- **Daily #1's date.** `DAILY_EPOCH` in `packages/engine/src/calendar.ts` is still
  the placeholder 2026-12-01. Until that date the game offers an unnumbered
  "Daily preview". Set it to the day the public alpha starts. Changing it later
  renumbers every Daily in people's share texts.
- **Steam Direct fee** ($100 per app). Paying during M3 starts Valve's 30-day
  wait before a release is possible.
- **A community channel**, if you want one, and its link (`COMMUNITY_URL`).

## 6. Testers

M2's exit criterion still stands: five outside testers finish a Daily, on a
phone and on a desktop. Suggest they take the primer first, then the Daily,
and use "Send feedback" and "Report this soul".
