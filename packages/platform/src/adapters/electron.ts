import type { ElectronBridge, Platform } from '../index';
import { noAchievements, noUpdates, shareWithFallback } from '../share';
import { type KeyValueStore, openStore } from '../storage';

/**
 * Steam build (docs/tech-spec.md §62). In the Electron shell, the saves are files the app writes (Steam Cloud syncs
 * them) and achievements go to Steam; links open in the system's browser. The same build opened in a browser, to
 * test it, has no shell: then it keeps its saves in IndexedDB like the web builds, and achievements only in the game.
 */
const shell = (globalThis as { cotsShell?: ElectronBridge }).cotsShell;

/** A store kept as files by the shell; each call is done, on disk, when it returns. */
function fileStore(bridge: ElectronBridge, name: string | undefined): KeyValueStore {
  return {
    persistent: true,
    get: async <T>(key: string) => bridge.store.get(name, key) as T | undefined,
    set: async <T>(key: string, value: T) => bridge.store.set(name, key, value),
    remove: async (key: string) => bridge.store.remove(name, key),
  };
}

export const platform: Platform = {
  kind: 'electron',
  share: shareWithFallback,
  shareUrl: () => undefined,
  openStore: async (name) => (shell ? fileStore(shell, name) : openStore(name)),
  watchForUpdate: noUpdates,
  unlockAchievement: shell ? (id) => shell.unlockAchievement(id) : noAchievements,
};
