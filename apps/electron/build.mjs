// Bundles the Steam shell (docs/tech-spec.md §62): the main process and the page's preload, one CommonJS file each.
// STEAM_APP_ID bakes the game's Steam app ID in; without it the build has none, and Steam stays off.
import { build } from 'esbuild';

const raw = process.env.STEAM_APP_ID?.trim();
const appId = raw ? Number(raw) : null;
if (appId !== null && !(Number.isInteger(appId) && appId > 0)) {
  throw new Error(`STEAM_APP_ID must be a whole number, not "${raw}"`);
}

await build({
  entryPoints: { main: 'src/main.ts', preload: 'src/preload.ts' },
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  // Electron is the runtime; the Steam library loads its native parts, so it stays a package beside the bundle.
  external: ['electron', 'steamworks-ffi-node'],
  define: { __STEAM_APP_ID__: JSON.stringify(appId) },
  legalComments: 'none',
  logLevel: 'warning',
});
console.log(`Steam shell built${appId === null ? ' (no Steam app ID)' : ` for Steam app ${appId}`}`);
