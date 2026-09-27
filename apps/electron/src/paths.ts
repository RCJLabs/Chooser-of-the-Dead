import { join, resolve } from 'node:path';

/*
 * Where the Steam build keeps things (docs/tech-spec.md §8.1). Saves go where Steam's Auto-Cloud looks for them:
 * `%APPDATA%/ChooserOfTheSlain/saves` on Windows, `~/Library/Application Support/...` on macOS, and `~/.config/...` on
 * Linux, written out rather than read from $XDG_CONFIG_HOME, since Auto-Cloud's Linux root is the home folder. The
 * browser's own files (its cache, and the game's localStorage copies) sit beside them in `profile`, which the cloud
 * leaves alone.
 */

/** The folder everything goes in, for a platform, its environment and the user's home folder. */
export function appRoot(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, home: string): string {
  if (platform === 'win32') return join(env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'ChooserOfTheSlain');
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'ChooserOfTheSlain');
  return join(home, '.config', 'ChooserOfTheSlain');
}

export interface Paths {
  /** The saves, as files: what Steam Cloud syncs. */
  readonly saves: string;
  /** Electron's profile: caches, and the game's synchronous localStorage copies. */
  readonly profile: string;
}

/** The app's folders; `COTS_SAVE_DIR` and `COTS_PROFILE_DIR` move them, for tests. */
export function appPaths(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, home: string): Paths {
  const root = appRoot(platform, env, home);
  return {
    saves: env.COTS_SAVE_DIR ? resolve(env.COTS_SAVE_DIR) : join(root, 'saves'),
    profile: env.COTS_PROFILE_DIR ? resolve(env.COTS_PROFILE_DIR) : join(root, 'profile'),
  };
}

/**
 * The built game the window loads: beside the app in a package (`resources/game`, never moved), or the web build in
 * the repo while developing (`dist/electron-full`, or `COTS_GAME_DIR`).
 */
export function gameDir(packaged: boolean, resourcesPath: string, env: NodeJS.ProcessEnv, here: string): string {
  if (packaged) return join(resourcesPath, 'game');
  if (env.COTS_GAME_DIR) return resolve(env.COTS_GAME_DIR);
  return resolve(here, '..', '..', '..', 'dist', 'electron-full');
}

/**
 * The Steamworks SDK's redistributable files (`redistributable_bin`), which Valve's terms keep out of the public repo:
 * beside the app in a package (`resources/steamworks_sdk`), or `apps/electron/steamworks_sdk` while developing.
 */
export function sdkDir(packaged: boolean, resourcesPath: string, here: string): string {
  return packaged ? join(resourcesPath, 'steamworks_sdk') : resolve(here, '..', 'steamworks_sdk');
}
