/**
 * The build-target matrix (docs/build-plan.md §3). Plain data with no
 * dependencies, so the Vite config can import it directly.
 */
export const PACK_IDS = ['core', 'daily', 'demo', 'campaign'] as const;
export type PackId = (typeof PACK_IDS)[number];

/**
 * Which packs each pack may depend on. Enforced by the content compiler, so a
 * demo pack can never pull in campaign content by editing its own manifest.
 */
export const ALLOWED_PACK_DEPS: Readonly<Record<PackId, readonly PackId[]>> = {
  core: [],
  daily: ['core'],
  demo: ['core'],
  campaign: ['core', 'demo'],
};

export type PlatformKind = 'web' | 'itch' | 'electron' | 'android';

export interface TargetDef {
  /** `demo` builds must not contain campaign content; `full` builds must. */
  edition: 'demo' | 'full';
  packs: readonly PackId[];
  platform: PlatformKind;
  pwa: boolean;
  /** `pages` = GitHub Pages path, `relative` = './', `root` = '/'. */
  base: 'pages' | 'relative' | 'root';
  /** Includes the Case Lab debug tools. */
  lab: boolean;
  /** A build for invited playtesters (docs/playtest.md): it says so, and each save slot offers a playtest report. */
  playtest: boolean;
  /**
   * Its own name for what it keeps in a browser (its localStorage keys and IndexedDB database), or null to keep
   * things where the other builds do. itch.io may serve every HTML5 game from one origin, so the playtest build
   * keeps apart from the public demo, which would find a playtester's saves unreadable and offer to clear them.
   */
  storage: string | null;
}

const DEMO_PACKS = ['core', 'daily', 'demo'] as const satisfies readonly PackId[];
const ALL_PACKS = PACK_IDS;

export const TARGETS = {
  'web-demo': {
    edition: 'demo',
    packs: DEMO_PACKS,
    platform: 'web',
    pwa: true,
    base: 'pages',
    lab: false,
    playtest: false,
    storage: null,
  },
  'web-itch': {
    edition: 'demo',
    packs: DEMO_PACKS,
    platform: 'itch',
    pwa: false,
    base: 'relative',
    lab: false,
    playtest: false,
    storage: null,
  },
  // The whole game for invited playtesters, on its own restricted itch.io page (docs/playtest.md).
  'web-playtest': {
    edition: 'full',
    packs: ALL_PACKS,
    platform: 'itch',
    pwa: false,
    base: 'relative',
    lab: false,
    playtest: true,
    storage: 'playtest',
  },
  'electron-demo': {
    edition: 'demo',
    packs: DEMO_PACKS,
    platform: 'electron',
    pwa: false,
    base: 'relative',
    lab: false,
    playtest: false,
    storage: null,
  },
  'electron-full': {
    edition: 'full',
    packs: ALL_PACKS,
    platform: 'electron',
    pwa: false,
    base: 'relative',
    lab: false,
    playtest: false,
    storage: null,
  },
  'android-full': {
    edition: 'full',
    packs: ALL_PACKS,
    platform: 'android',
    pwa: false,
    base: 'relative',
    lab: false,
    playtest: false,
    storage: null,
  },
  'dev-full': {
    edition: 'full',
    packs: ALL_PACKS,
    platform: 'web',
    pwa: false,
    base: 'root',
    lab: true,
    playtest: true,
    storage: null,
  },
} as const satisfies Record<string, TargetDef>;

export type TargetId = keyof typeof TARGETS;
export const TARGET_IDS = Object.keys(TARGETS) as TargetId[];

export function isTargetId(value: string): value is TargetId {
  return Object.hasOwn(TARGETS, value);
}

/**
 * GitHub Pages path for this repo, for local builds and the tests: the repository's name (RCJLabs/Chooser-of-the-Dead),
 * so a rename moves the site. The Pages workflow builds with the path Pages reports instead (COTS_BASE), so a rename or
 * a custom domain can't leave the deployed demo loading its scripts from the old path (docs/tech-spec.md §64).
 */
export const PAGES_BASE = '/Chooser-of-the-Dead/';

/**
 * Where the Pages site carries the whole game (the playtest build), unlisted, beside the demo (docs/tech-spec.md
 * §48). The Pages workflow copies it there; the demo's service worker leaves it alone.
 */
export const PAGES_FULL = 'full/';
