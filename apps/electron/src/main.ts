import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app, BrowserWindow, type IpcMainEvent, ipcMain, Menu, powerMonitor, protocol, session, shell } from 'electron';
import type SteamworksSDK from 'steamworks-ffi-node';
import { isAllowedExternal } from './links';
import { appPaths, gameDir, sdkDir } from './paths';
import { CSP, contentType, ORIGIN, resolveAsset, SCHEME } from './protocol';
import { FileStore } from './saves';
import { startSteam } from './steam';

/*
 * The Steam build's main process (docs/tech-spec.md §8.1, §62): one window showing the game from the app's own files,
 * the saves written here as files, and Steam spoken to only from here. The page gets no Node; its preload hands it a
 * store and an achievement call, and nothing the page sends is trusted.
 */

/** The Steam app ID the build baked in (null: none yet); `COTS_STEAM_APP_ID` overrides it (480 to test). */
declare const __STEAM_APP_ID__: number | null;

/**
 * The page's own storage lives in memory and goes when the app quits: the saves are the files, and only the files.
 * The game still keeps its synchronous copies in localStorage while it runs, but one left from an earlier run can't
 * outrank a newer save that Steam Cloud brought from another computer.
 */
const PARTITION = 'cots-game';

const packaged = app.isPackaged;
const paths = appPaths(process.platform, process.env, app.getPath('home'));

/** The shell's log, started fresh each run, beside the profile (and on stdout): it says why Steam is on or off. */
const logFile = join(paths.profile, 'shell.log');
function log(message: string): void {
  const line = `${new Date().toISOString()} ${message}\n`;
  process.stdout.write(line);
  try {
    appendFileSync(logFile, line);
  } catch {
    // No log file; stdout still has it.
  }
}

function main(): void {
  // Chromium's profile (and the lock that keeps one copy running) goes beside the saves, not in Electron's default.
  app.setPath('userData', paths.profile);
  if (!app.requestSingleInstanceLock()) {
    // Another copy is running, with the same saves: it takes the focus instead.
    app.exit(0);
    return;
  }
  try {
    mkdirSync(paths.profile, { recursive: true });
    writeFileSync(logFile, '');
  } catch {
    // Logged to stdout only.
  }

  // Linux, and Steam's runtime on it and on the Deck: Chromium's process sandbox can't start there (its helper loses
  // its setuid bit in a Steam depot, and Steam's container refuses nested namespaces). The page is only ever the
  // game's own files, behind the content security policy, and the page's own sandbox (no Node) stays on.
  if (process.platform === 'linux') app.commandLine.appendSwitch('no-sandbox');
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true },
    },
  ]);

  const envAppId = Number(process.env.COTS_STEAM_APP_ID);
  const fromEnv = Number.isInteger(envAppId) && envAppId > 0;
  const appId = fromEnv ? envAppId : __STEAM_APP_ID__;
  const started = startSteam({
    appId,
    sdkDir: sdkDir(packaged, process.resourcesPath, __dirname),
    // Only a store build, with its own app ID, has Steam start it; testing with an ID from the environment doesn't.
    relaunch: packaged && !fromEnv,
    platform: process.platform,
    arch: process.arch,
    load: () => (require('steamworks-ffi-node') as { default: typeof SteamworksSDK }).default.getInstance(),
    log,
  });
  if (started.relaunching) {
    log('Not started from Steam: Steam starts the game again');
    app.exit(0);
    return;
  }
  const steam = started.port;
  const files = new FileStore(paths.saves);
  const root = gameDir(packaged, process.resourcesPath, process.env, __dirname);
  let win: BrowserWindow | null = null;

  /** Whether an IPC message came from the game's page in our window, and not from anything else. */
  const fromGame = (e: IpcMainEvent): boolean =>
    win !== null &&
    e.sender === win.webContents &&
    e.senderFrame !== null &&
    e.senderFrame === e.sender.mainFrame &&
    e.senderFrame.url.startsWith(`${ORIGIN}/`);

  /** A synchronous call from the page: it always gets a reply, the value or the error. */
  const answer = (channel: string, run: (...args: unknown[]) => unknown): void => {
    ipcMain.on(channel, (e, ...args: unknown[]) => {
      if (!fromGame(e)) {
        e.returnValue = { error: 'Refused' };
        return;
      }
      try {
        e.returnValue = { value: run(...args) };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log(`${channel} failed: ${message}`);
        e.returnValue = { error: message };
      }
    });
  };
  const nameOf = (x: unknown): string | undefined => (typeof x === 'string' ? x : undefined);
  const keyOf = (x: unknown): string => (typeof x === 'string' ? x : '');
  answer('cots:store-get', (name, key) => files.get(nameOf(name), keyOf(key)));
  answer('cots:store-set', (name, key, value) => files.set(nameOf(name), keyOf(key), value));
  answer('cots:store-remove', (name, key) => files.remove(nameOf(name), keyOf(key)));
  ipcMain.on('cots:unlock', (e, id: unknown) => {
    if (fromGame(e) && typeof id === 'string') steam.unlock(id);
  });

  const serveGame = (): void => {
    const ses = session.fromPartition(PARTITION);
    ses.protocol.handle(SCHEME, async (request) => {
      const file = resolveAsset(root, request.url);
      if (!file) return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });
      return new Response(await readFile(file), {
        headers: {
          'content-type': contentType(file),
          'content-security-policy': CSP,
          'x-content-type-options': 'nosniff',
        },
      });
    });
    // Nothing goes to the network: the policy stops it in the page, and this stops it underneath.
    ses.webRequest.onBeforeRequest((details, callback) =>
      callback({ cancel: /^(https?|wss?|ftp):/i.test(details.url) }),
    );
    // The page may copy its share text and go full screen; it asks for nothing else.
    const allowed = new Set(['clipboard-sanitized-write', 'fullscreen']);
    ses.setPermissionRequestHandler((_wc, permission, callback) => callback(allowed.has(permission)));
    ses.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));
  };

  const createWindow = (): void => {
    const w = new BrowserWindow({
      width: 1280,
      height: 800,
      minWidth: 480,
      minHeight: 480,
      show: false,
      backgroundColor: '#15110d',
      title: 'Chooser of the Slain',
      icon: join(root, 'icons', 'icon-512.png'),
      autoHideMenuBar: true,
      // Steam's Game Mode on the Deck wants the whole screen.
      fullscreen: steam.onDeck || process.env.SteamDeck === '1',
      webPreferences: {
        preload: join(__dirname, 'preload.js'),
        partition: PARTITION,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webviewTag: false,
        spellcheck: false,
        devTools: !packaged,
        autoplayPolicy: 'no-user-gesture-required',
      },
    });
    win = w;
    w.once('ready-to-show', () => w.show());
    w.on('closed', () => {
      win = null;
    });
    const wc = w.webContents;
    // A pinch on the Deck's screen doesn't zoom the page; the game has its own text size.
    void wc.setVisualZoomLevelLimits(1, 1);
    // Links leave for the system's browser, if they're the game's own; nothing opens in a window of ours.
    wc.setWindowOpenHandler(({ url }) => {
      if (isAllowedExternal(url)) void shell.openExternal(url);
      else log(`Blocked a link: ${url}`);
      return { action: 'deny' };
    });
    wc.on('will-navigate', (e, url) => {
      if (url.startsWith(`${ORIGIN}/`)) return;
      e.preventDefault();
      if (isAllowedExternal(url)) void shell.openExternal(url);
      else log(`Blocked a navigation: ${url}`);
    });
    wc.on('will-attach-webview', (e) => e.preventDefault());
    // F11 and Alt+Enter: full screen, as in other games on the desktop.
    wc.on('before-input-event', (e, input) => {
      if (input.type !== 'keyDown') return;
      if (input.key === 'F11' || (input.key === 'Enter' && input.alt)) {
        e.preventDefault();
        w.setFullScreen(!w.isFullScreen());
      }
    });
    // The page's warnings and errors go in the log, for bug reports.
    wc.on('console-message', (e) => {
      if (e.level === 'warning' || e.level === 'error')
        log(`page ${e.level}: ${e.message} (${e.sourceId}:${e.lineNumber})`);
    });
    let reloads = 0;
    wc.on('render-process-gone', (_e, details) => {
      log(`The page stopped: ${details.reason}`);
      if (details.reason !== 'clean-exit' && reloads++ < 2 && !w.isDestroyed()) w.reload();
    });
    void w.loadURL(`${ORIGIN}/index.html`);
  };

  // The game pauses when its window loses focus; a computer going to sleep or locking tells it too.
  const pause = () => win?.webContents.send('cots:pause');

  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => steam.shutdown());

  void app.whenReady().then(() => {
    log(`Chooser of the Slain: game ${root}, saves ${paths.saves}, Steam ${steam.off === null ? 'on' : 'off'}`);
    Menu.setApplicationMenu(null);
    serveGame();
    powerMonitor.on('suspend', pause);
    powerMonitor.on('lock-screen', pause);
    createWindow();
  });
}

main();
