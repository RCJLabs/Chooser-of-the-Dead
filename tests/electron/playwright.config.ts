import { defineConfig } from '@playwright/test';

// The Steam build's shell under Electron (docs/tech-spec.md §62). Run `pnpm build:steam` first; see shell.spec.ts.
export default defineConfig({
  testDir: '.',
  outputDir: './results',
  reporter: 'list',
  workers: 1,
  timeout: 60_000,
});
