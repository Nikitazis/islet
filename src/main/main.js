'use strict';

const { app, BrowserWindow, Menu, Tray, dialog, globalShortcut, ipcMain, nativeImage, screen } = require('electron');
const path = require('node:path');
const { Store } = require('./store');
const { MediaBridge } = require('./media');
const { ClipboardHistory } = require('./clipboard');
const { Bookmarks } = require('./bookmarks');

const IS_DEV = process.argv.includes('--dev');
const SHORTCUT = 'Control+Alt+Space';
// The window is a fixed transparent canvas; the island inside it changes shape.
// It is click-through everywhere except the island itself.
const WINDOW_SIZE = { width: 760, height: 420 };

const DEFAULT_SETTINGS = {
  accent: 'violet',
  hoverExpand: true,
  notifications: true,
  launchAtLogin: false,
  clipboardLimit: 60,
};

const SETTINGS_RULES = {
  accent: (v) => ['violet', 'orange'].includes(v),
  hoverExpand: (v) => typeof v === 'boolean',
  notifications: (v) => typeof v === 'boolean',
  launchAtLogin: (v) => typeof v === 'boolean',
  clipboardLimit: (v) => [30, 60, 100].includes(v),
};

let win = null;
let tray = null;
let store;
let media;
let clips;
let bookmarks;
let quitting = false;

const send = (channel, payload) => {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
};

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
    focusable: false,
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

function setLaunchAtLogin(enabled) {
  const options = { openAtLogin: enabled };
  if (!app.isPackaged) {
    // In development Windows has to start electron.exe with the project folder.
    options.path = process.execPath;
    options.args = [path.resolve(app.getAppPath())];
  }
  app.setLoginItemSettings(options);
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
  send('settings:changed', next);
  buildTrayMenu();
  return next;
}

function trayImage() {
  const image = nativeImage.createFromPath(path.join(__dirname, '..', '..', 'assets', 'tray.png'));
  return image.isEmpty() ? nativeImage.createEmpty() : image;
}

function buildTrayMenu() {
  if (!tray) return;
  const settings = store.get('settings');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Открыть шторку', accelerator: SHORTCUT, click: () => send('island:toggle', { pin: true }) },
    { type: 'separator' },
    {
      label: 'Раскрывать при наведении',
      type: 'checkbox',
      checked: settings.hoverExpand,
      click: (item) => updateSettings({ hoverExpand: item.checked }),
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
  tray.on('click', () => send('island:toggle', { pin: true }));
  buildTrayMenu();
}

function registerIpc() {
  ipcMain.handle('app:init', () => ({
    settings: store.get('settings'),
    clipboard: clips.items.map(clipView),
    bookmarks: bookmarks.items,
    media: media.state,
    shortcut: SHORTCUT,
    version: app.getVersion(),
  }));

  // Island window behaviour
  ipcMain.on('island:interactive', (_e, interactive) => {
    if (!win) return;
    win.setIgnoreMouseEvents(!interactive, { forward: true });
  });
  ipcMain.on('island:focus', (_e, focus) => {
    if (!win) return;
    if (focus) {
      win.setFocusable(true);
      win.focus();
    } else {
      win.blur();
      win.setFocusable(false);
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

function bootstrap() {
  app.setAppUserModelId('com.cstorka.app');

  app.whenReady().then(() => {
    const dataDir = app.getPath('userData');
    store = new Store(path.join(dataDir, 'cstorka.json'), {
      settings: DEFAULT_SETTINGS,
      clipboard: [],
      bookmarks: [],
    });

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

    media.start();
    clips.start().catch((err) => console.warn('[clipboard] could not start:', err.message));

    if (!globalShortcut.register(SHORTCUT, () => send('island:toggle', { pin: true }))) {
      console.warn(`[app] shortcut ${SHORTCUT} is taken by another program`);
    }

    screen.on('display-metrics-changed', repositionWindow);
    screen.on('display-added', repositionWindow);
    screen.on('display-removed', repositionWindow);
  });

  app.on('second-instance', () => send('island:toggle', { pin: true }));

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
