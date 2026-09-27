import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileStore, validKey, validStore } from './saves';

const fresh = () => mkdtempSync(join(tmpdir(), 'cots-saves-'));

describe('the saves as files', () => {
  it('keeps each key as a JSON file, the game’s own store in the folder and others in their own', () => {
    const root = fresh();
    const files = new FileStore(root);
    files.set(undefined, 'settings', { v: 1, textScale: 1.25 });
    files.set(undefined, 'campaign.0', { v: 1, rev: 3 });
    files.set('chooser-of-the-slain.playtest', 'settings', { v: 1 });
    expect(JSON.parse(readFileSync(join(root, 'settings.json'), 'utf8'))).toEqual({ v: 1, textScale: 1.25 });
    expect(files.get(undefined, 'campaign.0')).toEqual({ v: 1, rev: 3 });
    expect(files.get('chooser-of-the-slain.playtest', 'settings')).toEqual({ v: 1 });
    expect(existsSync(join(root, 'chooser-of-the-slain.playtest', 'settings.json'))).toBe(true);
    // The game's own store by its name is the same folder.
    expect(files.get('chooser-of-the-slain', 'settings')).toEqual({ v: 1, textScale: 1.25 });
  });

  it('says there is nothing for a key never saved, and forgets a removed one', () => {
    const files = new FileStore(fresh());
    expect(files.get(undefined, 'daily')).toBeUndefined();
    files.set(undefined, 'daily', { v: 1, results: {} });
    files.remove(undefined, 'daily');
    expect(files.get(undefined, 'daily')).toBeUndefined();
    files.remove(undefined, 'daily');
    files.set(undefined, 'endless-progress', { v: 1 });
    files.set(undefined, 'endless-progress', undefined);
    expect(files.get(undefined, 'endless-progress')).toBeUndefined();
  });

  it('writes over the old file whole, and leaves no temporary file behind', () => {
    const root = fresh();
    const files = new FileStore(root);
    files.set(undefined, 'daily-progress', { v: 1, actions: [1, 2] });
    files.set(undefined, 'daily-progress', { v: 1, actions: [1, 2, 3] });
    expect(files.get(undefined, 'daily-progress')).toEqual({ v: 1, actions: [1, 2, 3] });
    expect(readdirSync(root)).toEqual(['daily-progress.json']);
  });

  it('hands back a file that isn’t JSON as its text, so the game keeps it as unreadable', () => {
    const root = fresh();
    writeFileSync(join(root, 'campaign.1.json'), 'not a save {');
    expect(new FileStore(root).get(undefined, 'campaign.1')).toBe('not a save {');
  });

  it('refuses any name that could leave the folder or isn’t the game’s', () => {
    const files = new FileStore(fresh());
    for (const key of ['../escape', 'a/b', 'a\\b', '..', 'x..y', '.hidden', '', 'Settings', 'a'.repeat(65), 'a b']) {
      expect(validKey(key)).toBe(false);
      expect(() => files.set(undefined, key, 1)).toThrow(/Bad key/);
      expect(() => files.get(undefined, key)).toThrow(/Bad key/);
    }
    for (const name of ['../x', 'a/b', 'a_b', '..', 'x..y', '', 'Store']) {
      expect(validStore(name)).toBe(false);
      expect(() => files.get(name, 'settings')).toThrow(/Bad store/);
    }
    expect(validKey('settings.unread')).toBe(true);
    expect(validKey(7)).toBe(false);
  });
});
