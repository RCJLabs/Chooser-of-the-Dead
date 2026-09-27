import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { appPaths, appRoot, gameDir, sdkDir } from './paths';

describe('where the Steam build keeps things', () => {
  it('puts the saves where Steam Auto-Cloud looks, on each system', () => {
    expect(appRoot('win32', { APPDATA: 'C:\\Users\\a\\AppData\\Roaming' }, 'C:\\Users\\a')).toBe(
      join('C:\\Users\\a\\AppData\\Roaming', 'ChooserOfTheSlain'),
    );
    expect(appRoot('win32', {}, '/h')).toBe(join('/h', 'AppData', 'Roaming', 'ChooserOfTheSlain'));
    expect(appRoot('darwin', {}, '/Users/a')).toBe(
      join('/Users/a', 'Library', 'Application Support', 'ChooserOfTheSlain'),
    );
    // Written out on Linux, whatever XDG_CONFIG_HOME says: Auto-Cloud's Linux root is the home folder.
    expect(appRoot('linux', { XDG_CONFIG_HOME: '/elsewhere' }, '/home/a')).toBe(
      join('/home/a', '.config', 'ChooserOfTheSlain'),
    );
  });

  it('keeps the saves apart from the browser profile, and lets the tests move both', () => {
    expect(appPaths('linux', {}, '/home/a')).toEqual({
      saves: join('/home/a', '.config', 'ChooserOfTheSlain', 'saves'),
      profile: join('/home/a', '.config', 'ChooserOfTheSlain', 'profile'),
    });
    expect(appPaths('linux', { COTS_SAVE_DIR: 'x/s', COTS_PROFILE_DIR: 'x/p' }, '/home/a')).toEqual({
      saves: resolve('x/s'),
      profile: resolve('x/p'),
    });
  });

  it('loads the game beside the app when packaged, whatever the environment says', () => {
    expect(gameDir(true, '/opt/game/resources', { COTS_GAME_DIR: '/tmp/other' }, '/any')).toBe(
      join('/opt/game/resources', 'game'),
    );
    expect(gameDir(false, '/r', { COTS_GAME_DIR: '/tmp/other' }, '/any')).toBe(resolve('/tmp/other'));
    expect(gameDir(false, '/r', {}, '/repo/apps/electron/dist')).toBe(resolve('/repo/dist/electron-full'));
  });

  it('finds the Steamworks files beside the app, or in the shell folder while developing', () => {
    expect(sdkDir(true, '/opt/game/resources', '/any')).toBe(join('/opt/game/resources', 'steamworks_sdk'));
    expect(sdkDir(false, '/r', '/repo/apps/electron/dist')).toBe(resolve('/repo/apps/electron/steamworks_sdk'));
  });
});
