import type { ElectronBridge } from '@cots/platform';
import { contextBridge, ipcRenderer } from 'electron';

/*
 * All the game's page gets from the app (docs/tech-spec.md §62), as `window.cotsShell`: its store, kept as files by
 * the main process, and Steam's achievements. A store call waits for its answer, so a save is on disk before the
 * call returns and a window closed a moment later can't lose it.
 */

type Reply = { readonly value?: unknown; readonly error?: string };

function call(channel: string, ...args: unknown[]): unknown {
  const reply = ipcRenderer.sendSync(channel, ...args) as Reply | undefined;
  if (!reply || reply.error !== undefined) throw new Error(reply?.error ?? `No answer to ${channel}`);
  return reply.value;
}

const bridge: ElectronBridge = {
  store: {
    get: (store, key) => call('cots:store-get', store, key),
    set: (store, key, value) => {
      call('cots:store-set', store, key, value);
    },
    remove: (store, key) => {
      call('cots:store-remove', store, key);
    },
  },
  unlockAchievement: (id) => ipcRenderer.send('cots:unlock', id),
};

contextBridge.exposeInMainWorld('cotsShell', bridge);

// The main process says when the computer sleeps or locks; the game pauses as it does when its window loses focus.
ipcRenderer.on('cots:pause', () => window.dispatchEvent(new Event('blur')));
