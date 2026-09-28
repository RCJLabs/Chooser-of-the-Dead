import { describe, expect, it } from 'vitest';
import { TARGET_IDS, TARGETS } from './targets';

describe('build targets', () => {
  it('names the app every PWA installs as', () => {
    for (const id of TARGET_IDS) {
      const t = TARGETS[id];
      if (t.pwa) expect('app' in t && t.app.name && t.app.shortName, id).toBeTruthy();
    }
  });

  it('puts the whole game on Pages as its own app, keeping what the playtest build keeps (docs/tech-spec.md §65)', () => {
    const pages = TARGETS['web-full'];
    const itch = TARGETS['web-playtest'];
    // A tester who played /full/ before it could be installed keeps their saves: the same keys, on the same origin.
    expect(pages.storage).toBe(itch.storage);
    expect(pages).toMatchObject({ edition: 'full', playtest: true, pwa: true, platform: 'web', lab: false });
    expect(pages.packs).toEqual(itch.packs);
    // Relative paths: it sits at /full/ under whatever the repository is called.
    expect(pages.base).toBe('relative');
    // itch.io gets no service worker.
    expect(itch.pwa).toBe(false);
    // Installed side by side, the two apps must be told apart.
    expect(pages.app.shortName).not.toBe(TARGETS['web-demo'].app.shortName);
  });
});
