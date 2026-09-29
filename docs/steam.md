# Steam: running the shell, testing it with Steam, and setting up Steamworks

The Steam build is the game in an Electron shell (`apps/electron`, [tech-spec §62](tech-spec.md)). It runs without Steam. Steam stays off until three things are in place: the Steamworks SDK's files, a Steam app ID, and the Steam client. The shell's log says which one is missing.

## Run it without Steam

```sh
pnpm build:steam                                      # the full game (electron-full) and the shell
node apps/electron/node_modules/electron/install.js   # once: Electron's own binary (a plain install leaves it out)
pnpm steam                                            # the game in its window, Steam off
```

- **Where things go:**

  | System | Saves (what Steam Cloud syncs) |
  |---|---|
  | Windows | `%APPDATA%\ChooserOfTheSlain\saves` |
  | Linux | `~/.config/ChooserOfTheSlain/saves` |

  Chromium's own files sit beside the saves in `profile/`, which Steam Cloud doesn't sync. That includes `shell.log`, which says whether Steam is on and why not.
- **Start clean:** delete the `saves` folder. The game keeps nothing anywhere else between runs.
- **The demo:** run `pnpm build:electron-demo`, then `COTS_GAME_DIR=dist/electron-demo pnpm steam`.
- **As root** (a container), Chromium needs its flag on the command line: `pnpm steam --no-sandbox`.
- **The smoke test:** `xvfb-run -a pnpm e2e:steam` on Linux, or `pnpm e2e:steam` on Windows. It runs the real app with its own folders, so it doesn't touch your saves.

## Test it with Steam (app 480)

App 480 is Spacewar, Valve's test app. Every Steam account can use it.

1. **Get Steam's library.** Download the Steamworks SDK (partner.steamgames.com, Downloads). Copy its `sdk/redistributable_bin` folder to `apps/electron/steamworks_sdk/redistributable_bin`. The folder is gitignored: never commit it, because Valve's terms keep the SDK out of a public repo.
2. **Start the Steam client** and log in.
3. **Run** `COTS_STEAM_APP_ID=480 pnpm steam` (PowerShell: `$env:COTS_STEAM_APP_ID=480; pnpm steam`).
4. **Check:**
   - `shell.log` says `Steam is on: app 480`, and Steam shows you playing Spacewar.
   - Achievements you've earned in this save are sent to Steam. Spacewar doesn't have the game's achievements, so a minute later the log says `Steam would not take ACH_…` for each one. That's expected: it shows the path works as far as Steam. The real test needs the game's own app ID, with its achievements set up.
5. **Test the Deck's full screen** without a Deck: `SteamDeck=1 pnpm steam`.

## Package it

- **Full game:** `pnpm package:steam` writes `dist/steam/full/linux-unpacked` on Linux, or `dist/steam/full/win-unpacked` on Windows. Run it on each system: the Windows package needs Windows's copies of the native parts.
- **With the real app ID:** `STEAM_APP_ID=<id> pnpm package:steam`.
  - A package with an app ID baked in asks Steam to start it when it's started any other way, then quits.
  - To run it outside Steam anyway, set `COTS_STEAM_APP_ID` to the same ID (or 480).
- **The demo:** run `pnpm build:electron-demo`, then `STEAM_EDITION=demo STEAM_APP_ID=<demo id> pnpm --filter @cots/electron package`.
- **Steam's library:** a package made with `apps/electron/steamworks_sdk/` in place carries the library for its system. Without it, Steam stays off in that package.
- **Test a package:** `COTS_SHELL_BINARY=dist/steam/full/linux-unpacked/chooser-of-the-slain xvfb-run -a pnpm e2e:steam`.

## Set up Steamworks (once the apps exist)

- **Apps:** one for the full game and one for the demo, each with its own app ID. Bake each in with `STEAM_APP_ID` when packaging.
- **Depots:** one for Windows (`win-unpacked`) and one for Linux (`linux-unpacked`).
- **Launch options:**
  - Windows: `chooser-of-the-slain.exe`.
  - Linux: `chooser-of-the-slain`, with arguments `--no-sandbox`. The shell also sets that flag itself, but under Steam's runtime nobody has checked yet that doing it from the code is enough (tech-spec §62).
  - Steam Deck: the Linux build. Test the Windows build under Proton as well.
- **Steam Cloud, as Auto-Cloud:**
  - Root `WinAppDataRoaming`, subdirectory `ChooserOfTheSlain/saves`, pattern `*.json`, all systems.
  - Root override for Linux: `LinuxHome` with `.config/ChooserOfTheSlain/saves`. For macOS later: `MacAppSupport`.
  - A quota of a few MB and about 50 files is plenty. Three campaign slots late in the game come to under 1 MB.
- **Achievements:**
  - `pnpm steam:achievements` prints each achievement's API name, name, description and whether it's hidden. There are 25 in the full game; `--demo` prints the demo's 8.
  - Enter them as printed. The API names must match exactly: the shell unlocks by them.
  - Each needs icons, locked and unlocked. None are drawn yet.
- **Uploading builds** (not set up): SteamPipe, with `steamcmd` by hand, or `game-ci/steam-deploy` in CI with the `STEAM_CONFIG_VDF` secret. Upload to a beta branch first.

## Not tested yet

Nothing has run against a real Steam client, on Steam's Linux runtime, or on a Deck. Windows has only run in CI. The full list is in tech-spec §62, Known limits.
