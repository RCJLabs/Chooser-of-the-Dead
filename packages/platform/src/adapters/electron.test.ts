import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ElectronBridge } from '../index';

/** The shell's bridge, faked: a map for the files, and the achievements sent. */
function fakeShell() {
  const files = new Map<string, unknown>();
  const sent: string[] = [];
  const at = (store: string | undefined, key: string) => `${store ?? '-'}/${key}`;
  const shell: ElectronBridge = {
    store: {
      get: (store, key) => files.get(at(store, key)),
      set: (store, key, value) => {
        if (key.includes('/')) throw new Error(`Bad key: ${key}`);
        files.set(at(store, key), value);
      },
      remove: (store, key) => {
        files.delete(at(store, key));
      },
    },
    unlockAchievement: (id) => sent.push(id),
  };
  return { shell, files, sent };
}

async function adapter(shell?: ElectronBridge) {
  vi.resetModules();
  (globalThis as { cotsShell?: ElectronBridge }).cotsShell = shell;
  return (await import('./electron')).platform;
}

afterEach(() => {
  delete (globalThis as { cotsShell?: ElectronBridge }).cotsShell;
});

describe('the Steam build’s platform', () => {
  it('keeps the store as the shell’s files, written by the time the call is done', async () => {
    const { shell, files } = fakeShell();
    const platform = await adapter(shell);
    const store = await platform.openStore();
    expect(store.persistent).toBe(true);
    const write = store.set('settings', { v: 1 });
    // Written before the promise is even awaited: a window closing now loses nothing.
    expect(files.get('-/settings')).toEqual({ v: 1 });
    await write;
    expect(await store.get('settings')).toEqual({ v: 1 });
    await store.remove('settings');
    expect(await store.get('settings')).toBeUndefined();
    const own = await platform.openStore('chooser-of-the-slain.playtest');
    await own.set('daily', { v: 1 });
    expect(files.get('chooser-of-the-slain.playtest/daily')).toEqual({ v: 1 });
  });

  it('turns a refused write into a failed promise, not a thrown call', async () => {
    const store = await (await adapter(fakeShell().shell)).openStore();
    const write = store.set('a/b', 1);
    await expect(write).rejects.toThrow('Bad key: a/b');
  });

  it('sends achievements to the shell', async () => {
    const { shell, sent } = fakeShell();
    (await adapter(shell)).unlockAchievement('ach.odin');
    expect(sent).toEqual(['ach.odin']);
  });

  it('opened in a browser, without the shell, keeps its saves as the web builds do', async () => {
    const platform = await adapter(undefined);
    expect(platform.kind).toBe('electron');
    // No IndexedDB in the tests: the web store falls back to memory, as it would in a private window.
    const store = await platform.openStore();
    expect(store.persistent).toBe(false);
    platform.unlockAchievement('ach.odin');
  });
});
