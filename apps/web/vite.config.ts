import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import preact from '@preact/preset-vite';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import {
  isTargetId,
  PAGES_BASE,
  PAGES_FULL,
  TARGET_IDS,
  TARGETS,
  type TargetDef,
} from '../../packages/content-schema/src/targets.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = resolve(here, '../..');

/** Resolves `virtual:content` to this target's compiled content and nothing else. */
function contentPlugin(targetId: string): Plugin {
  const entry = resolve(repoRoot, 'generated', targetId, 'index.ts');
  return {
    name: 'cots-content',
    enforce: 'pre',
    resolveId(source) {
      if (source !== 'virtual:content') return null;
      if (!existsSync(entry)) {
        this.error(`No compiled content for "${targetId}". Run: pnpm content:compile --target ${targetId}`);
      }
      return entry;
    },
  };
}

/** Builds without the PWA still import the registration module; give them a no-op. */
function noPwaPlugin(): Plugin {
  const id = '\0virtual:pwa-register';
  return {
    name: 'cots-no-pwa',
    resolveId: (source) => (source === 'virtual:pwa-register' ? id : null),
    load: (source) => (source === id ? 'export const registerSW = () => async () => {};' : null),
  };
}

/**
 * The playtest builds are for invited players, and on Pages the whole game sits unlisted at /full/ (docs/tech-spec.md
 * §48): search engines are asked not to list it.
 */
function noIndexPlugin(): Plugin {
  return {
    name: 'cots-noindex',
    transformIndexHtml: () => [
      { tag: 'meta', attrs: { name: 'robots', content: 'noindex, nofollow' }, injectTo: 'head' },
    ],
  };
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// One config, six build targets: `vite build --mode <target>` (docs/build-plan.md §3).
export default defineConfig(({ mode }) => {
  if (!isTargetId(mode)) {
    throw new Error(`Unknown build target "${mode}". Use --mode <${TARGET_IDS.join('|')}>.`);
  }
  const target: TargetDef = TARGETS[mode];
  if (target.pwa && !target.app) throw new Error(`Target "${mode}" is a PWA, so it needs an app name (targets.ts).`);
  const base =
    target.base === 'pages' ? (process.env.COTS_BASE ?? PAGES_BASE) : target.base === 'relative' ? './' : '/';

  return {
    root: here,
    base,
    plugins: [
      contentPlugin(mode),
      preact(),
      !target.pwa && noPwaPlugin(),
      target.playtest && noIndexPlugin(),
      target.pwa &&
        VitePWA({
          // Updates wait for the player: the web adapter registers the worker and the
          // title screen offers the update (never mid-shift).
          registerType: 'prompt',
          injectRegister: false,
          // Each installs as its own app: the demo, and the whole game at /full/ (docs/tech-spec.md §65).
          manifest: {
            name: target.app?.name,
            short_name: target.app?.shortName,
            description: target.app?.description,
            theme_color: '#15110d',
            background_color: '#15110d',
            display: 'standalone',
            start_url: base,
            scope: base,
            icons: [
              { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
              { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
              { src: 'icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
            ],
          },
          workbox: {
            // The rune font too: offline, runes and inscriptions would otherwise fall back to boxes.
            globPatterns: ['**/*.{js,css,html,svg,png,webmanifest,woff2}'],
            // The whole game sits beside the demo on Pages (docs/tech-spec.md §48): its pages aren't the demo's.
            ...(target.base === 'pages'
              ? { navigateFallbackDenylist: [new RegExp(`^${escapeRegExp(base)}${PAGES_FULL}`)] }
              : {}),
          },
        }),
    ],
    resolve: {
      alias: {
        '@platform': resolve(repoRoot, `packages/platform/src/adapters/${target.platform}.ts`),
      },
    },
    build: {
      outDir: resolve(repoRoot, 'dist', mode),
      emptyOutDir: true,
      // Public builds never ship source maps (they would expose unbundled source).
      sourcemap: target.lab,
      target: 'es2022',
    },
    server: { port: 5173 },
    preview: { port: 4173 },
  };
});
