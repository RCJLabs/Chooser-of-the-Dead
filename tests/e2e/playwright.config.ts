import { defineConfig } from '@playwright/test';
import { BASE, FULL, FULL_APP, PLAYTEST } from './urls';

// Tests against the real builds (run `pnpm build:web-demo`, `pnpm build:dev-full`, `pnpm build:web-playtest` and
// `pnpm build:web-full` first).
export default defineConfig({
  testDir: '.',
  outputDir: './results',
  reporter: process.env.CI ? [['list'], ['html', { outputFolder: './report', open: 'never' }]] : 'list',
  use: { baseURL: BASE },
  webServer: [
    {
      command: 'pnpm preview:web-demo',
      url: BASE,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: 'pnpm preview:dev-full',
      url: FULL,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: 'pnpm preview:web-playtest',
      url: PLAYTEST,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: 'pnpm preview:web-full',
      url: FULL_APP,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
  projects: [
    {
      name: 'phone',
      use: { viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
    },
    { name: 'desktop', use: { viewport: { width: 1920, height: 1080 } } },
  ],
});
