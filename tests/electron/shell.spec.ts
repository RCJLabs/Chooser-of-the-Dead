import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { type ElectronApplication, _electron as electron, expect, type Page, test } from '@playwright/test';

/*
 * The Steam build's shell, run for real (docs/tech-spec.md §62): the game from its own files at app://game, the saves
 * as files that a fresh profile (another computer, through Steam Cloud) reads back, a file that isn't a save kept as
 * it was, the page walled off from the network and from other windows, and the pause the shell sends. Steam itself
 * is off here (no app ID); its port has unit tests with a fake.
 *
 * Needs `pnpm build:steam` and Electron's binary (`node apps/electron/node_modules/electron/install.js`), or a
 * packaged build named by COTS_SHELL_BINARY; on Linux, a display (`xvfb-run -a`).
 */

const repo = resolve(import.meta.dirname, '..', '..');
const shellDir = join(repo, 'apps', 'electron');
/** A packaged build to test instead (`COTS_SHELL_BINARY=dist/steam/full/linux-unpacked/chooser-of-the-slain`). */
const packaged = process.env.COTS_SHELL_BINARY ? resolve(repo, process.env.COTS_SHELL_BINARY) : null;
const executablePath = packaged ?? (createRequire(join(shellDir, 'package.json'))('electron') as unknown as string);

interface Run {
  readonly app: ElectronApplication;
  readonly page: Page;
}

/** A folder for this test's saves or profile. */
const folder = (name: string) => mkdtempSync(join(tmpdir(), `cots-shell-${name}-`));

async function launch(saves: string, profile: string): Promise<Run> {
  const app = await electron.launch({
    executablePath,
    // Chromium's sandbox won't run as root (CI containers); the shell turns it off on Linux itself as well.
    args: [...(process.platform === 'linux' ? ['--no-sandbox'] : []), ...(packaged ? [] : [shellDir])],
    env: { ...process.env, COTS_SAVE_DIR: saves, COTS_PROFILE_DIR: profile, COTS_STEAM_APP_ID: '' },
  });
  const page = await app.firstWindow();
  await expect(page).toHaveTitle('Chooser of the Slain');
  return { app, page };
}

/** Starts a campaign in the first slot from the campaign screen, and leaves it at its first morning. */
async function startInFirstSlot(page: Page) {
  await page.getByTestId('new-0').click();
  await expect(page.getByTestId('morning-title')).toHaveText('Day 1');
  await page.getByTestId('campaign-quit').click();
  await page.getByTestId('campaign-back').click();
}

test('the game opens from its own files, and its saves are files a fresh profile reads back', async () => {
  const saves = folder('saves');
  const first = await launch(saves, folder('profile'));
  const errors: string[] = [];
  first.page.on('pageerror', (e) => errors.push(e.message));
  expect(first.page.url()).toBe('app://game/index.html');
  await expect(first.page.getByTestId('target')).toHaveText('electron-full');
  expect(await first.page.evaluate('typeof window.cotsShell')).toBe('object');

  await first.page.getByTestId('play-campaign').click();
  await startInFirstSlot(first.page);
  await first.app.close();
  const file = join(saves, 'campaign.0.json');
  expect(existsSync(file)).toBe(true);
  const kept = JSON.parse(readFileSync(file, 'utf8')) as { v: number; save: { seed: string } };
  expect(kept.v).toBe(1);
  expect(errors).toEqual([]);

  // Another computer: Steam Cloud brought the saves folder, and nothing else.
  const second = await launch(saves, folder('profile'));
  await second.page.getByTestId('play-campaign').click();
  await expect(second.page.getByTestId('continue-0')).toBeVisible();
  const slot = (await second.page.evaluate(`window.cotsShell.store.get(undefined, 'campaign.0')`)) as typeof kept;
  expect(slot.save.seed).toBe(kept.save.seed);
  await second.app.close();
});

test('a save Steam Cloud brought from another computer wins over what this one kept from before', async () => {
  const saves = folder('saves');
  const profile = folder('profile');
  // This computer, earlier: the game saved its settings, to the file and to its synchronous copy, as it does.
  const before = await launch(saves, profile);
  await before.page.evaluate(`(() => {
    const s = { v: 1, textScale: 1.25 };
    localStorage.setItem('cots.settings', JSON.stringify(s));
    window.cotsShell.store.set(undefined, 'settings', s);
  })()`);
  await before.app.close();
  // Then another computer played, and Steam Cloud brought its settings back here.
  writeFileSync(join(saves, 'settings.json'), JSON.stringify({ v: 1, textScale: 1.5 }));
  const after = await launch(saves, profile);
  expect(await after.page.evaluate('document.documentElement.style.fontSize')).toBe('150%');
  await after.app.close();
});

test("a save file the game can't read is shown as unreadable and kept as it was", async () => {
  const saves = folder('saves');
  mkdirSync(saves, { recursive: true });
  const file = join(saves, 'campaign.1.json');
  writeFileSync(file, 'not a save {');
  const { app, page } = await launch(saves, folder('profile'));
  await page.getByTestId('play-campaign').click();
  await expect(page.getByTestId('unreadable-1')).toContainText("This save can't be read");
  // Saving in another slot leaves it alone.
  await startInFirstSlot(page);
  await app.close();
  expect(existsSync(join(saves, 'campaign.0.json'))).toBe(true);
  expect(readFileSync(file, 'utf8')).toBe('not a save {');
});

test('nothing leaves the window: no network, no other windows, no navigating away, no stray files', async () => {
  const profile = folder('profile');
  const { app, page } = await launch(folder('saves'), profile);
  expect(await page.evaluate(`fetch('https://example.com/').then(() => 'fetched', () => 'blocked')`)).toBe('blocked');
  expect(await page.evaluate(`window.open('https://example.com/') === null`)).toBe(true);
  expect(app.windows()).toHaveLength(1);
  await page.evaluate(`location.href = 'https://example.com/'`);
  await page.waitForTimeout(500);
  expect(page.url()).toBe('app://game/index.html');
  // The store takes the game's own names only.
  expect(
    await page.evaluate(`(() => {
      try { window.cotsShell.store.set(undefined, '../../escape', 1); return 'written'; } catch { return 'refused'; }
    })()`),
  ).toBe('refused');
  await app.close();
  const log = readFileSync(join(profile, 'shell.log'), 'utf8');
  expect(log).toContain('Steam is off: this build has no Steam app ID');
  expect(log).toContain('Blocked a link: https://example.com/');
  expect(log).toContain('Blocked a navigation: https://example.com/');
});

test('a computer going to sleep pauses the shift', async () => {
  const { app, page } = await launch(folder('saves'), folder('profile'));
  await page.getByTestId('practice-1').click();
  await page.getByTestId('begin').click();
  await expect(page.getByTestId('soul-count')).toBeVisible();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.webContents.send('cots:pause'));
  await expect(page.getByTestId('resume')).toBeVisible();
  await app.close();
});
