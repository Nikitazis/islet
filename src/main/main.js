'use strict';

const { app, BrowserWindow, Menu, Tray, dialog, globalShortcut, ipcMain, nativeImage, screen } = require('electron');
const path = require('node:path');
const { Store } = require('./store');
const { MediaBridge } = require('./media');
const { ClipboardHistory } = require('./clipboard');
const { Bookmarks } = require('./bookmarks');
const win32 = require('./win32');

const IS_DEV = process.argv.includes('--dev');
// The first free one wins: Ctrl+Alt+Space is often taken (e.g. by the Claude app).
const OPEN_SHORTCUTS = ['Control+Alt+Space', 'Alt+Shift+Space', 'Control+Alt+C'];
const PASTE_SHORTCUT = 'Control+Shift+V';
const WATCH_MS = 500;
// The window is a fixed transparent canvas; the island inside it changes shape.
// It is click-through everywhere except the island itself.
const WINDOW_SIZE = { width: 760, height: 460 };
// A point under the collapsed pill (DIP from the screen's top centre), where a browser's tabs would be.
const PILL_PROBE_Y = 26;

const OPEN_MODES = [
  { id: 'hover', label: 'При наведении' },
  { id: 'dwell', label: 'Если задержать мышь' },
  { id: 'edge', label: 'У верхнего края экрана' },
  { id: 'click', label: 'Только по щелчку' },
];

const DEFAULT_SETTINGS = {
  accent: 'violet',
  openOn: 'dwell',
  notifications: true,
  hideInFullscreen: true,
  yieldToWindows: true,
  quickPaste: true,
  launchAtLogin: false,
  clipboardLimit: 60,
};

const SETTINGS_RULES = {
  accent: (v) => ['violet', 'orange'].includes(v),
  openOn: (v) => OPEN_MODES.some((m) => m.id === v),
  notifications: (v) => typeof v === 'boolean',
  hideInFullscreen: (v) => typeof v === 'boolean',
  yieldToWindows: (v) => typeof v === 'boolean',
  quickPaste: (v) => typeof v === 'boolean',
  launchAtLogin: (v) => typeof v === 'boolean',
  clipboardLimit: (v) => [30, 60, 100].includes(v),
};

let win = null;
let winHandle = 0;
let tray = null;
let store;
let media;
let clips;
let bookmarks;
let quitting = false;

let shownOverFullscreen = false; // opened by a shortcut while a fullscreen app is in front
let windowBeneath = false;       // a program window reaches up under the pill: show the "ear"
let pasteTarget = 0;             // window that had focus when quick paste was called
let shortcuts = { open: null, paste: false }; // registered open accelerator, paste registered?

const send = (channel, payload) => {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** What the renderer needs from a clipboard entry; long texts are cut for transport. */
const clipView = (item) => ({
  id: item.id,
  type: item.type,
  kind: item.kind,
  text: item.type === 'text' ? item.text.slice(0, 2000) : undefined,
  length: item.type === 'text' ? item.text.length : undefined,
  thumb: item.thumb,
  width: item.width,
  height: item.height,
  createdAt: item.createdAt,
  pinned: item.pinned,
});

// ───────────── Window ─────────────

function islandBounds() {
  const { bounds } = screen.getPrimaryDisplay();
  return {
    x: Math.round(bounds.x + (bounds.width - WINDOW_SIZE.width) / 2),
    y: bounds.y,
    ...WINDOW_SIZE,
  };
}

function createWindow() {
  win = new BrowserWindow({
    ...islandBounds(),
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    thickFrame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    title: 'Cstorka',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });
  winHandle = win32.handleOf(win);
  // Clicks on the island must not steal focus from the app you work in.
  win32.setNoActivate(winHandle, true);

  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.showInactive());

  win.on('close', (event) => {
    if (!quitting) event.preventDefault();
  });
  win.on('blur', () => send('island:blur'));

  // Nothing should ever navigate the island away (e.g. a link dropped onto it).
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  if (IS_DEV) win.webContents.openDevTools({ mode: 'detach' });
}

function repositionWindow() {
  if (win && !win.isDestroyed()) win.setBounds(islandBounds());
}

function takeFocus() {
  win32.setNoActivate(winHandle, false);
  win.focus();
}

function releaseFocus() {
  // blur() activates "the next window", so only call it while we really are in front.
  // isFocused() lags behind right after quick paste has handed focus back.
  if (win32.foregroundWindow() === winHandle) win.blur();
  win32.setNoActivate(winHandle, true);
}

/** Shows the island (even over a fullscreen app) and gives it keyboard focus. */
function bringIslandForward() {
  if (!win.isVisible()) {
    shownOverFullscreen = true;
    win.showInactive();
  }
  // A global shortcut lets us take the foreground; do it now, before that right expires.
  takeFocus();
}

/** Hides the island while a fullscreen game, video or presentation is in front. */
function syncFullscreen() {
  let hide = false;
  if (store.get('settings').hideInFullscreen && !shownOverFullscreen) {
    try {
      hide = win32.isForegroundFullscreen(winHandle);
    } catch (err) {
      console.warn('[fullscreen]', err.message);
    }
  }
  if (hide && win.isVisible()) {
    send('island:collapse');
    win.hide();
  } else if (!hide && !win.isVisible()) {
    win.showInactive();
  }
}

/**
 * Checks where a click under the pill would land. If it's a program window
 * (a browser's tabs, an editor's title bar), the island shrinks to the "ear".
 */
function syncWindowBeneath() {
  let beneath = false;
  if (store.get('settings').yieldToWindows) {
    const { bounds } = screen.getPrimaryDisplay();
    const point = screen.dipToScreenPoint({ x: bounds.x + bounds.width / 2, y: bounds.y + PILL_PROBE_Y });
    const hwnd = win32.windowAt(point.x, point.y);
    // The island itself answers only while it is being used: keep the current look.
    if (hwnd === winHandle) return;
    beneath = win32.isAppWindow(hwnd);
  }
  if (beneath !== windowBeneath) {
    windowBeneath = beneath;
    send('island:ear', beneath);
  }
}

function watchWindows() {
  if (!win || win.isDestroyed()) return;
  syncFullscreen();
  if (!win.isVisible()) return;
  try {
    syncWindowBeneath();
  } catch (err) {
    console.warn('[ear]', err.message);
  }
}

// ───────────── Shortcuts ─────────────

function openFromShortcut() {
  bringIslandForward();
  send('island:toggle');
}

function startQuickPaste() {
  // Pressed again while the island has focus: keep the window we came from.
  const front = win32.foregroundWindow();
  if (front && front !== winHandle) pasteTarget = front;
  bringIslandForward();
  send('island:quick-paste');
}

function registerShortcuts() {
  globalShortcut.unregisterAll();
  const open = OPEN_SHORTCUTS.find((accelerator) => globalShortcut.register(accelerator, openFromShortcut)) ?? null;
  const wantsPaste = store.get('settings').quickPaste;
  const paste = wantsPaste && globalShortcut.register(PASTE_SHORTCUT, startQuickPaste);
  if (!open) console.warn(`[app] all open shortcuts are taken: ${OPEN_SHORTCUTS.join(', ')}`);
  if (wantsPaste && !paste) console.warn(`[app] ${PASTE_SHORTCUT} is taken by another program`);
  shortcuts = { open, paste };
  send('shortcuts:status', shortcuts);
  buildTrayMenu();
}

// ───────────── Settings ─────────────

function setLaunchAtLogin(enabled) {
  const options = { openAtLogin: enabled };
  if (!app.isPackaged) {
    // In development Windows has to start electron.exe with the project folder.
    options.path = process.execPath;
    options.args = [path.resolve(app.getAppPath())];
  }
  app.setLoginItemSettings(options);
}

/** Settings saved by 0.1.0 had a single hover switch. */
function migrateSettings() {
  const settings = { ...store.get('settings') };
  if (!('hoverExpand' in settings)) return;
  if (settings.hoverExpand === false) settings.openOn = 'click';
  delete settings.hoverExpand;
  store.set('settings', settings);
}

function updateSettings(patch) {
  const current = store.get('settings');
  const next = { ...current };
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (SETTINGS_RULES[key]?.(value)) next[key] = value;
  }
  store.set('settings', next);
  if (next.launchAtLogin !== current.launchAtLogin) setLaunchAtLogin(next.launchAtLogin);
  if (next.clipboardLimit !== current.clipboardLimit) clips.applyLimit();
  if (next.quickPaste !== current.quickPaste) registerShortcuts();
  if (next.hideInFullscreen !== current.hideInFullscreen || next.yieldToWindows !== current.yieldToWindows) watchWindows();
  send('settings:changed', next);
  buildTrayMenu();
  return next;
}

// ───────────── Tray ─────────────

function trayImage() {
  const image = nativeImage.createFromPath(path.join(__dirname, '..', '..', 'assets', 'tray.png'));
  return image.isEmpty() ? nativeImage.createEmpty() : image;
}

function buildTrayMenu() {
  if (!tray) return;
  const settings = store.get('settings');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Открыть шторку', accelerator: shortcuts.open ?? undefined, click: openFromShortcut },
    { type: 'separator' },
    {
      label: 'Как открывать',
      submenu: OPEN_MODES.map((mode) => ({
        label: mode.label,
        type: 'radio',
        checked: settings.openOn === mode.id,
        click: () => updateSettings({ openOn: mode.id }),
      })),
    },
    {
      label: 'Прятать в полноэкранном режиме',
      type: 'checkbox',
      checked: settings.hideInFullscreen,
      click: (item) => updateSettings({ hideInFullscreen: item.checked }),
    },
    {
      label: 'Уступать место окнам',
      type: 'checkbox',
      checked: settings.yieldToWindows,
      click: (item) => updateSettings({ yieldToWindows: item.checked }),
    },
    {
      label: 'Быстрая вставка (Ctrl+Shift+V)',
      type: 'checkbox',
      checked: settings.quickPaste,
      click: (item) => updateSettings({ quickPaste: item.checked }),
    },
    {
      label: 'Запускать вместе с Windows',
      type: 'checkbox',
      checked: settings.launchAtLogin,
      click: (item) => updateSettings({ launchAtLogin: item.checked }),
    },
    { type: 'separator' },
    { label: 'Выйти', click: () => app.quit() },
  ]));
}

function createTray() {
  tray = new Tray(trayImage());
  tray.setToolTip('Cstorka');
  tray.on('click', openFromShortcut);
  buildTrayMenu();
}

// ───────────── IPC ─────────────

function registerIpc() {
  ipcMain.handle('app:init', () => ({
    settings: store.get('settings'),
    clipboard: clips.items.map(clipView),
    bookmarks: bookmarks.items,
    media: media.state,
    shortcuts: { paste: PASTE_SHORTCUT, status: shortcuts },
    ear: windowBeneath,
    version: app.getVersion(),
  }));

  // Island window behaviour
  ipcMain.on('island:interactive', (_e, interactive) => {
    if (!win) return;
    win.setIgnoreMouseEvents(!interactive, { forward: true });
  });
  ipcMain.on('island:focus', (_e, focus) => {
    if (!win) return;
    if (focus) takeFocus();
    else releaseFocus();
  });
  ipcMain.on('island:state', (_e, state) => {
    if (state !== 'compact') return;
    pasteTarget = 0;
    if (shownOverFullscreen) {
      shownOverFullscreen = false;
      watchWindows();
    }
  });

  // Media
  ipcMain.on('media:command', (_e, command) => media.command(command));
  ipcMain.handle('media:thumb', (_e, key) => media.getThumb(String(key)));

  // Clipboard
  ipcMain.handle('clip:copy', (_e, id) => clips.copy(String(id)));
  ipcMain.on('clip:pin', (_e, id) => clips.togglePin(String(id)));
  ipcMain.on('clip:remove', (_e, id) => clips.remove(String(id)));
  ipcMain.on('clip:clear', () => clips.clearUnpinned());
  ipcMain.handle('clip:paste', async (_e, id) => {
    if (!(await clips.copy(String(id)))) return { ok: false };
    const target = pasteTarget;
    pasteTarget = 0;
    if (!target || !win32.focusWindow(target)) return { ok: true, pasted: false };
    // Let the target window settle, and never type into anything else.
    await wait(60);
    if (win32.foregroundWindow() !== target) return { ok: true, pasted: false };
    win32.sendPaste();
    return { ok: true, pasted: true };
  });
  ipcMain.on('clip:paste-cancel', () => {
    const target = pasteTarget;
    pasteTarget = 0;
    if (target) win32.focusWindow(target);
  });

  // Bookmarks
  ipcMain.handle('bm:add', (_e, payload) => bookmarks.add(payload ?? {}));
  ipcMain.handle('bm:open', (_e, id) => bookmarks.open(String(id)));
  ipcMain.on('bm:remove', (_e, id) => bookmarks.remove(String(id)));
  ipcMain.on('bm:rename', (_e, id, title) => bookmarks.rename(String(id), title));
  ipcMain.on('bm:move', (_e, id, index) => bookmarks.move(String(id), Number(index)));
  ipcMain.handle('bm:pick', async (_e, kind) => {
    const result = await dialog.showOpenDialog(win, {
      title: kind === 'folder' ? 'Выберите папку' : 'Выберите файл',
      properties: [kind === 'folder' ? 'openDirectory' : 'openFile'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  // Settings
  ipcMain.handle('settings:set', (_e, patch) => updateSettings(patch));
}

// ───────────── App ─────────────

function bootstrap() {
  app.setAppUserModelId('com.cstorka.app');

  app.whenReady().then(() => {
    const dataDir = app.getPath('userData');
    store = new Store(path.join(dataDir, 'cstorka.json'), {
      settings: DEFAULT_SETTINGS,
      clipboard: [],
      bookmarks: [],
    });
    migrateSettings();

    media = new MediaBridge(path.join(__dirname, 'media-bridge.ps1'));
    clips = new ClipboardHistory(store, path.join(dataDir, 'clipboard-images'));
    bookmarks = new Bookmarks(store);

    media.on('state', (state) => send('media:state', state));
    media.on('thumb', (key) => send('media:thumb', key));
    clips.on('change', (items) => send('clip:changed', items.map(clipView)));
    clips.on('added', (item) => send('clip:added', clipView(item)));
    bookmarks.on('change', (items) => send('bm:changed', items));

    registerIpc();
    createWindow();
    createTray();
    registerShortcuts();

    media.start();
    clips.start().catch((err) => console.warn('[clipboard] could not start:', err.message));
    setInterval(watchWindows, WATCH_MS);

    screen.on('display-metrics-changed', repositionWindow);
    screen.on('display-added', repositionWindow);
    screen.on('display-removed', repositionWindow);
  });

  app.on('second-instance', openFromShortcut);

  app.on('before-quit', () => {
    quitting = true;
    globalShortcut.unregisterAll();
    media?.stop();
    clips?.stop();
    store?.flush();
  });

  // The island lives in the tray; closing windows never quits the app.
  app.on('window-all-closed', () => {});
}

if (app.requestSingleInstanceLock()) {
  bootstrap();
} else {
  app.quit();
}
