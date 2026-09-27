import {
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

/*
 * The game's key-value store as files (docs/tech-spec.md §8.1): one JSON file a key, in the saves folder Steam Cloud
 * syncs. Written in the main process, synchronously and atomically (a temporary file, flushed, then renamed over the
 * old one), so a write the game has sent is on disk before the window can close, and a crash mid-write leaves the old
 * file whole. Names are checked here, whatever the page sends: no path can leave the folder.
 */

/** The game's default store (the web build's IndexedDB database of the same name): files straight in the folder. */
export const DEFAULT_STORE = 'chooser-of-the-slain';

const KEY = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const STORE = /^[a-z0-9][a-z0-9.-]{0,63}$/;

/** Whether a key may name a file: lowercase letters, digits, dots, dashes and underscores, no `..`. */
export const validKey = (key: unknown): key is string =>
  typeof key === 'string' && KEY.test(key) && !key.includes('..');

/** Whether a store's name may name a folder, as keys do (no underscores). */
export const validStore = (name: unknown): name is string =>
  typeof name === 'string' && STORE.test(name) && !name.includes('..');

export class FileStore {
  constructor(private readonly root: string) {}

  /** The file for `key` in store `name` (the default store's straight in the folder, any other's in its own). */
  file(name: string | undefined, key: string): string {
    const store = name ?? DEFAULT_STORE;
    if (!validStore(store)) throw new Error(`Bad store name: ${String(name)}`);
    if (!validKey(key)) throw new Error(`Bad key: ${String(key)}`);
    return store === DEFAULT_STORE ? join(this.root, `${key}.json`) : join(this.root, store, `${key}.json`);
  }

  /**
   * The value kept for `key`, or undefined if there's none. A file that isn't JSON comes back as its text: the game
   * shows such a slot as unreadable and keeps it, where undefined would let it be written over.
   */
  get(name: string | undefined, key: string): unknown {
    const file = this.file(name, key);
    if (!existsSync(file)) return undefined;
    const text = readFileSync(file, 'utf8');
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }

  set(name: string | undefined, key: string, value: unknown): void {
    const file = this.file(name, key);
    if (value === undefined) {
      this.remove(name, key);
      return;
    }
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    const fd = openSync(tmp, 'w');
    try {
      writeSync(fd, JSON.stringify(value));
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    try {
      renameSync(tmp, file);
    } catch {
      // Windows can refuse to rename over a file something else has open (a virus scanner): copy it over instead.
      copyFileSync(tmp, file);
      unlinkSync(tmp);
    }
  }

  remove(name: string | undefined, key: string): void {
    const file = this.file(name, key);
    if (existsSync(file)) unlinkSync(file);
  }
}
