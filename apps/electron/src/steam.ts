import { existsSync } from 'node:fs';
import { join } from 'node:path';

/*
 * Steam, spoken to only from the main process and only through this port (docs/tech-spec.md §8.1, §62). The game runs
 * the same without it: a build with no app ID, no Steamworks files beside the app, or no Steam client running each
 * leave Steam off, and the log says which.
 */

/** The shell's view of Steam. */
export interface SteamPort {
  /** Why Steam is off, or null when it's on. */
  readonly off: string | null;
  /** Whether Steam says the game is running on a Steam Deck. */
  readonly onDeck: boolean;
  /**
   * Marks an achievement earned on Steam, by the game's id (`ach.everyFront`). The game sends every earned one again
   * at each start, so one Steam already has costs a lookup, not a write; one Steam can't take yet (it hasn't loaded
   * the player's stats) is tried again every few seconds, for a minute.
   */
  unlock(id: string): void;
  /** Stops the callbacks and closes Steam's API, before the app quits. */
  shutdown(): void;
}

/** The part of steamworks-ffi-node's SDK the shell calls, so the tests can hand it a fake. */
export interface SteamSdk {
  setSdkPath(path: string): void;
  restartAppIfNecessary(appId: number): boolean;
  init(options: { appId: number }): boolean;
  runCallbacks(): void;
  shutdown(): void;
  readonly achievements: {
    isAchievementUnlocked(name: string): Promise<boolean>;
    unlockAchievement(name: string): Promise<boolean>;
  };
  readonly utils: { isSteamRunningOnSteamDeck(): boolean };
}

/**
 * Steam's name for a game achievement, set up the same in Steamworks: `ach.everyFront` is `ACH_EVERY_FRONT`, and
 * `ach.notAScratch` is `ACH_NOT_A_SCRATCH`. Null for anything that isn't an achievement's id.
 */
export function steamName(id: string): string | null {
  const m = /^ach\.([a-z][a-zA-Z0-9]*)$/.exec(id);
  if (!m?.[1]) return null;
  const words = m[1].replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/([A-Z])([A-Z][a-z])/g, '$1_$2');
  return `ACH_${words.toUpperCase()}`;
}

/** Where Steam's library sits in the Steamworks SDK's `redistributable_bin`, for this platform, if it ships one. */
export function steamLibrary(platform: NodeJS.Platform, arch: string): string | null {
  if (platform === 'win32' && arch === 'x64') return join('redistributable_bin', 'win64', 'steam_api64.dll');
  if (platform === 'linux' && arch === 'x64') return join('redistributable_bin', 'linux64', 'libsteam_api.so');
  if (platform === 'darwin') return join('redistributable_bin', 'osx', 'libsteam_api.dylib');
  return null;
}

export interface SteamOptions {
  /** The game's Steam app ID, or null for a build that has none. */
  readonly appId: number | null;
  /** The folder holding the Steamworks SDK's `redistributable_bin`. */
  readonly sdkDir: string;
  /** Whether to have Steam start the game again when it wasn't started from Steam (store builds only). */
  readonly relaunch: boolean;
  readonly platform: NodeJS.Platform;
  readonly arch: string;
  /** Loads the SDK; throws when its native parts can't load. */
  readonly load: () => SteamSdk;
  readonly log: (message: string) => void;
}

export type SteamStart = { readonly relaunching: true } | { readonly relaunching: false; readonly port: SteamPort };

/** How often Steam's callbacks run, and how many of those between tries of the achievements Steam hasn't taken. */
export const TICK_MS = 100;
export const RETRY_TICKS = 50;
export const MAX_TRIES = 12;

const offPort = (off: string): SteamPort => ({ off, onDeck: false, unlock: () => {}, shutdown: () => {} });

/**
 * Starts Steam if this build and this machine can. When Steam asks to start the game itself (it wasn't started from
 * Steam), says so: the caller quits at once and Steam starts it again.
 */
export function startSteam(o: SteamOptions): SteamStart {
  const off = (why: string): SteamStart => {
    o.log(`Steam is off: ${why}`);
    return { relaunching: false, port: offPort(why) };
  };
  if (o.appId === null) return off('this build has no Steam app ID');
  const lib = steamLibrary(o.platform, o.arch);
  if (!lib) return off(`Steamworks has no library for ${o.platform}-${o.arch}`);
  if (!existsSync(join(o.sdkDir, lib))) return off(`no Steamworks library at ${join(o.sdkDir, lib)}`);
  let sdk: SteamSdk;
  try {
    sdk = o.load();
    sdk.setSdkPath(o.sdkDir);
    if (o.relaunch && sdk.restartAppIfNecessary(o.appId)) return { relaunching: true };
    if (!sdk.init({ appId: o.appId })) return off('Steam did not start (is the Steam client running?)');
  } catch (e) {
    return off(`Steamworks failed to load: ${e instanceof Error ? e.message : String(e)}`);
  }
  let onDeck = false;
  try {
    onDeck = sdk.utils.isSteamRunningOnSteamDeck();
  } catch {
    onDeck = false;
  }
  o.log(`Steam is on: app ${o.appId}${onDeck ? ', on a Steam Deck' : ''}`);
  return { relaunching: false, port: steamPort(sdk, onDeck, o.log) };
}

function steamPort(sdk: SteamSdk, onDeck: boolean, log: (message: string) => void): SteamPort {
  /** Achievements Steam has, and those it hasn't taken yet with the tries each has had. */
  const done = new Set<string>();
  const pending = new Map<string, number>();
  const busy = new Set<string>();
  let closed = false;

  const attempt = async (name: string): Promise<void> => {
    if (closed || busy.has(name) || done.has(name)) return;
    busy.add(name);
    let ok = false;
    try {
      ok = (await sdk.achievements.isAchievementUnlocked(name)) || (await sdk.achievements.unlockAchievement(name));
    } catch {
      ok = false;
    }
    busy.delete(name);
    if (ok) {
      done.add(name);
      pending.delete(name);
      return;
    }
    const tries = (pending.get(name) ?? 0) + 1;
    if (tries < MAX_TRIES) pending.set(name, tries);
    else {
      pending.delete(name);
      log(`Steam would not take ${name} (is it set up in Steamworks?)`);
    }
  };

  let ticks = 0;
  const timer = setInterval(() => {
    try {
      sdk.runCallbacks();
    } catch {
      // A failed callback run is tried again on the next tick.
    }
    if (++ticks % RETRY_TICKS === 0) for (const name of [...pending.keys()]) void attempt(name);
  }, TICK_MS);

  return {
    off: null,
    onDeck,
    unlock(id) {
      const name = steamName(id);
      if (!name || closed || done.has(name)) return;
      if (!pending.has(name)) pending.set(name, 0);
      void attempt(name);
    },
    shutdown() {
      if (closed) return;
      closed = true;
      clearInterval(timer);
      try {
        sdk.shutdown();
      } catch {
        // Quitting anyway.
      }
    },
  };
}
