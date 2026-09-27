import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { loadContent } from '@cots/testkit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_TRIES,
  RETRY_TICKS,
  type SteamOptions,
  type SteamSdk,
  startSteam,
  steamLibrary,
  steamName,
  TICK_MS,
} from './steam';

/** A Steam that remembers what it was asked; `ready` says whether it has the player's stats yet. */
function fakeSdk(o: { init?: boolean; restart?: boolean; deck?: boolean; ready?: () => boolean } = {}) {
  const unlocked = new Set<string>();
  const calls: string[] = [];
  const sdk: SteamSdk = {
    setSdkPath: (p) => calls.push(`sdk ${p}`),
    restartAppIfNecessary: (id) => {
      calls.push(`restart ${id}`);
      return o.restart ?? false;
    },
    init: ({ appId }) => {
      calls.push(`init ${appId}`);
      return o.init ?? true;
    },
    runCallbacks: () => {},
    shutdown: () => calls.push('shutdown'),
    achievements: {
      isAchievementUnlocked: async (name) => unlocked.has(name),
      unlockAchievement: async (name) => {
        calls.push(`unlock ${name}`);
        if (!(o.ready?.() ?? true)) return false;
        unlocked.add(name);
        return true;
      },
    },
    utils: { isSteamRunningOnSteamDeck: () => o.deck ?? false },
  };
  return { sdk, calls, unlocked };
}

/** A folder with Steam's Linux library where the SDK keeps it. */
function sdkFolder(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cots-sdk-'));
  const lib = join(dir, steamLibrary('linux', 'x64') ?? '');
  mkdirSync(dirname(lib), { recursive: true });
  writeFileSync(lib, '');
  return dir;
}

const options = (sdk: SteamSdk, over: Partial<SteamOptions> = {}): SteamOptions & { lines: string[] } => {
  const lines: string[] = [];
  return {
    appId: 480,
    sdkDir: sdkFolder(),
    relaunch: false,
    platform: 'linux',
    arch: 'x64',
    load: () => sdk,
    log: (m) => lines.push(m),
    lines,
    ...over,
  };
};

const on = (o: SteamOptions) => {
  const s = startSteam(o);
  if (s.relaunching) throw new Error('relaunching');
  return s.port;
};

describe("Steam's names for the game's achievements", () => {
  it('maps every achievement to its own Steam name, set up the same in Steamworks', () => {
    const ids = (loadContent('electron-full').achievements ?? []).map((a) => a.id);
    expect(ids.length).toBeGreaterThan(20);
    const names = ids.map(steamName);
    for (const name of names) expect(name).toMatch(/^ACH_[A-Z0-9]+(_[A-Z0-9]+)*$/);
    expect(new Set(names).size).toBe(ids.length);
    expect(steamName('ach.everyFront')).toBe('ACH_EVERY_FRONT');
    expect(steamName('ach.notAScratch')).toBe('ACH_NOT_A_SCRATCH');
    expect(steamName('ach.odin')).toBe('ACH_ODIN');
  });

  it('names nothing that isn’t an achievement', () => {
    for (const id of ['odin', 'ach.', 'ach.Odin', 'ach.odin.x', 'ach.o-din', '']) expect(steamName(id)).toBeNull();
  });
});

describe('starting Steam', () => {
  it('stays off without an app ID, a library for this system, the library file, or a running Steam', () => {
    const { sdk, calls } = fakeSdk();
    expect(on(options(sdk, { appId: null })).off).toMatch(/no Steam app ID/);
    expect(on(options(sdk, { platform: 'linux', arch: 'arm64' })).off).toMatch(/no library for linux-arm64/);
    expect(on(options(sdk, { sdkDir: mkdtempSync(join(tmpdir(), 'cots-nosdk-')) })).off).toMatch(
      /no Steamworks library/,
    );
    expect(calls).toEqual([]);
    expect(on(options(fakeSdk({ init: false }).sdk)).off).toMatch(/is the Steam client running/);
    const broken = options(sdk, {
      load: () => {
        throw new Error('koffi would not load');
      },
    });
    expect(on(broken).off).toMatch(/failed to load: koffi would not load/);
    expect(broken.lines).toEqual(['Steam is off: Steamworks failed to load: koffi would not load']);
  });

  it('an off Steam takes achievements and quits quietly', () => {
    const port = on(options(fakeSdk().sdk, { appId: null }));
    expect(port.onDeck).toBe(false);
    port.unlock('ach.odin');
    port.shutdown();
  });

  it('starts from the SDK folder, and says so', () => {
    const { sdk, calls } = fakeSdk({ deck: true });
    const o = options(sdk);
    const port = on(o);
    expect(port.off).toBeNull();
    expect(port.onDeck).toBe(true);
    expect(calls).toEqual([`sdk ${o.sdkDir}`, 'init 480']);
    expect(o.lines).toEqual(['Steam is on: app 480, on a Steam Deck']);
    port.shutdown();
  });

  it('has Steam start the game when a store build wasn’t started from Steam, and only then', () => {
    expect(startSteam(options(fakeSdk({ restart: true }).sdk, { relaunch: true }))).toEqual({ relaunching: true });
    const started = fakeSdk({ restart: false });
    const port = on(options(started.sdk, { relaunch: true }));
    expect(started.calls).toContain('restart 480');
    port.shutdown();
    const testing = fakeSdk({ restart: true });
    on(options(testing.sdk, { relaunch: false })).shutdown();
    expect(testing.calls.some((c) => c.startsWith('restart'))).toBe(false);
  });
});

describe('achievements on Steam', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('unlocks by Steam’s name, and asks Steam nothing for one it already has', async () => {
    const { sdk, calls, unlocked } = fakeSdk();
    const port = on(options(sdk));
    port.unlock('ach.everyFront');
    await vi.advanceTimersByTimeAsync(0);
    expect(unlocked.has('ACH_EVERY_FRONT')).toBe(true);
    unlocked.add('ACH_ODIN');
    port.unlock('ach.odin');
    port.unlock('ach.everyFront');
    port.unlock('not an achievement');
    await vi.advanceTimersByTimeAsync(RETRY_TICKS * TICK_MS * 3);
    expect(calls.filter((c) => c.startsWith('unlock'))).toEqual(['unlock ACH_EVERY_FRONT']);
    port.shutdown();
  });

  it('tries again until Steam has the player’s stats', async () => {
    let ready = false;
    const { sdk, unlocked } = fakeSdk({ ready: () => ready });
    const port = on(options(sdk));
    port.unlock('ach.wolf');
    await vi.advanceTimersByTimeAsync(RETRY_TICKS * TICK_MS * 2);
    expect(unlocked.has('ACH_WOLF')).toBe(false);
    ready = true;
    await vi.advanceTimersByTimeAsync(RETRY_TICKS * TICK_MS);
    expect(unlocked.has('ACH_WOLF')).toBe(true);
    port.shutdown();
  });

  it('gives up on one Steam never takes, after a minute, and says which', async () => {
    const { sdk, calls } = fakeSdk({ ready: () => false });
    const o = options(sdk);
    const port = on(o);
    port.unlock('ach.hel');
    await vi.advanceTimersByTimeAsync(RETRY_TICKS * TICK_MS * (MAX_TRIES + 5));
    expect(calls.filter((c) => c === 'unlock ACH_HEL')).toHaveLength(MAX_TRIES);
    expect(o.lines.at(-1)).toBe('Steam would not take ACH_HEL (is it set up in Steamworks?)');
    port.shutdown();
  });

  it('shuts Steam down once, and takes nothing after', async () => {
    const { sdk, calls } = fakeSdk();
    const port = on(options(sdk));
    port.shutdown();
    port.shutdown();
    port.unlock('ach.odin');
    await vi.advanceTimersByTimeAsync(RETRY_TICKS * TICK_MS * 2);
    expect(calls.filter((c) => c === 'shutdown')).toHaveLength(1);
    expect(calls.some((c) => c.startsWith('unlock'))).toBe(false);
  });
});
