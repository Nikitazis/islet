'use strict';

const { app, BrowserWindow, Menu, Tray, dialog, globalShortcut, ipcMain, nativeImage, screen } = require('electron');
const path = require('node:path');
const { Store } = require('./store');
const { WinBridge } = require('./bridge');
const { ClipboardHistory } = require('./clipboard');
const { Bookmarks } = require('./bookmarks');
const { Calendar } = require('./calendar');
const { SystemMonitor } = require('./system');
const { Updater } = require('./updater');
const i18n = require('./i18n');
const win32 = require('./win32');

const { t } = i18n;
const IS_DEV = process.argv.includes('--dev');
// With no shortcut chosen, the first free one wins: Ctrl+Alt+Space is often taken (e.g. by the Claude app).
const OPEN_SHORTCUTS = ['Control+Alt+Space', 'Alt+Shift+Space', 'Control+Alt+C'];
const WATCH_MS = 500;
// The window is a fixed transparent canvas; the island inside it changes shape.
// It is click-through everywhere except the island itself.
const WINDOW_SIZE = { width: 760, height: 460 };
// A point under the collapsed pill (DIP from the screen's top centre), where a browser's tabs would be.
const PILL_PROBE_Y = 26;

const OPEN_MODES = ['hover', 'dwell', 'edge', 'click'];
const ACCELERATOR = /^(?:(?:Control|Alt|Shift|Super)\+){0,3}(?:[A-Z0-9]|F(?:[1-9]|1\d|2[0-4])|Space|Tab|Backspace|Delete|Insert|Home|End|PageUp|PageDown|Up|Down|Left|Right|Plus|[`\-=[\]\\;',./])$/;

const DEFAULT_SETTINGS = {
  accent: 'violet',
  language: 'auto',
  openOn: 'dwell',
  notifications: true,
  dnd: false,
  hideInFullscreen: true,
  yieldToWindows: true,
  display: 'primary',
  openShortcut: '',
  pasteShortcut: 'Control+Shift+V',
  launchAtLogin: false,
  clipboardLimit: 60,
  calendarUrl: '',
};

const bool = (v) => typeof v === 'boolean';
const SETTINGS_RULES = {
  accent: (v) => ['violet', 'orange'].includes(v),
  language: (v) => ['auto', 'ru', 'en'].includes(v),
  openOn: (v) => OPEN_MODES.includes(v),
  notifications: bool,
  dnd: bool,
  hideInFullscreen: bool,
  yieldToWindows: bool,
  display: (v) => v === 'primary' || v === 'cursor' || /^id:\d+$/.test(v),
  openShortcut: (v) => v === '' || ACCELERATOR.test(v),
  pasteShortcut: (v) => v === '' || ACCELERATOR.test(v),
  launchAtLogin: bool,
  clipboardLimit: (v) => [30, 60, 100].includes(v),
  calendarUrl: (v) => v === '' || (/^(https?|webcal):\/\/\S+$/i.test(v) && v.length < 2000),
};

let win = null;
let winHandle = 0;
let tray = null;
let store;
let bridge;
let clips;
let bookmarks;
let calendar;
let system;
let updater;
let quitting = false;

let language = 'ru';
let islandState = 'compact';
let displayId = null;
let shownOverFullscreen = false; // opened by a shortcut while a fullscreen app is in front
let windowBeneath = false;       // a program window reaches up under the pill: show the "ear"
let pasteTarget = 0;             // window that had focus when quick paste was called
let shortcutsSuspended = false;  // while the settings record a new shortcut
let shortcuts = { open: null, paste: null };

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
  names: item.type === 'files' ? item.paths.map((p) => path.basename(p) || p) : undefined,
  icon: item.icon,
  createdAt: item.createdAt,
  pinned: item.pinned,
});

// ───────────── Displays ─────────────

function displayList() {
  const primary = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((d, i) => ({
    id: `id:${d.id}`,
    n: i + 1,
    primary: d.id === primary,
    size: `${d.size.width}×${d.size.height}`,
  }));
}

/** The display the island belongs on, by the user's choice. */
function targetDisplay() {
  const choice = store.get('settings').display;
  if (choice === 'cursor') return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  if (choice.startsWith('id:')) {
    const chosen = screen.getAllDisplays().find((d) => `id:${d.id}` === choice);
    if (chosen) return chosen;
  }
  return screen.getPrimaryDisplay();
}

function islandBounds(display) {
  const { bounds } = display;
  return {
    x: Math.round(bounds.x + (bounds.width - WINDOW_SIZE.width) / 2),
    y: bounds.y,
    ...WINDOW_SIZE,
  };
}

/** Moves the island to its display; never while it is open under the pointer. */
function syncDisplay(force = false) {
  if (!win || win.isDestroyed()) return;
  if (!force && islandState !== 'compact') return;
  const display = targetDisplay();
  if (!force && display.id === displayId) return;
  displayId = display.id;
  win.setBounds(islandBounds(display));
}

function onDisplaysChanged() {
  syncDisplay(true);
  send('displays:changed', displayList());
}

// ───────────── Window ─────────────

function createWindow() {
  const display = targetDisplay();
  displayId = display.id;
  win = new BrowserWindow({
    ...islandBounds(display),
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
    title: 'Islet',
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

  // After a reload (e.g. a language change) the page starts collapsed: drop focus and clicks.
  win.webContents.on('did-finish-load', () => {
    islandState = 'compact';
    win.setIgnoreMouseEvents(true, { forward: true });
    releaseFocus();
  });

  win.on('close', (event) => {
    if (!quitting) event.preventDefault();
  });
  win.on('blur', () => send('island:blur'));

  // Nothing should ever navigate the island away (e.g. a link dropped onto it).
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  if (IS_DEV) win.webContents.openDevTools({ mode: 'detach' });
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
    const { bounds } = screen.getAllDisplays().find((d) => d.id === displayId) ?? screen.getPrimaryDisplay();
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
  syncDisplay();
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

function tryRegister(accelerator, handler) {
  try {
    return globalShortcut.register(accelerator, handler);
  } catch {
    return false;
  }
}

function registerShortcuts() {
  globalShortcut.unregisterAll();
  const settings = store.get('settings');
  if (shortcutsSuspended) {
    shortcuts = { open: null, paste: null };
  } else {
    const candidates = settings.openShortcut ? [settings.openShortcut] : OPEN_SHORTCUTS;
    const open = candidates.find((accelerator) => tryRegister(accelerator, openFromShortcut)) ?? null;
    const paste = settings.pasteShortcut && tryRegister(settings.pasteShortcut, startQuickPaste) ? settings.pasteShortcut : null;
    if (!open) console.warn(`[app] open shortcut is taken: ${candidates.join(', ')}`);
    if (settings.pasteShortcut && !paste) console.warn(`[app] ${settings.pasteShortcut} is taken by another program`);
    shortcuts = { open, paste };
  }
  send('shortcuts:status', shortcutStatus());
  buildTrayMenu();
}

const shortcutStatus = () => ({ ...shortcuts, suspended: shortcutsSuspended });

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

/** Older versions saved a hover switch (0.1) and a quick paste switch (0.2). */
function migrateSettings() {
  const settings = { ...store.get('settings') };
  let changed = false;
  if ('hoverExpand' in settings) {
    if (settings.hoverExpand === false) settings.openOn = 'click';
    delete settings.hoverExpand;
    changed = true;
  }
  if ('quickPaste' in settings) {
    if (settings.quickPaste === false) settings.pasteShortcut = '';
    delete settings.quickPaste;
    changed = true;
  }
  if (changed) store.set('settings', settings);
}

function updateSettings(patch) {
  const current = store.get('settings');
  const next = { ...current };
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (SETTINGS_RULES[key]?.(value)) next[key] = value;
  }
  store.set('settings', next);
  const changed = (key) => next[key] !== current[key];

  if (changed('launchAtLogin')) setLaunchAtLogin(next.launchAtLogin);
  if (changed('clipboardLimit')) clips.applyLimit();
  if (changed('openShortcut') || changed('pasteShortcut')) registerShortcuts();
  if (changed('hideInFullscreen') || changed('yieldToWindows')) watchWindows();
  if (changed('display')) syncDisplay(true);
  if (changed('calendarUrl')) calendar.refreshFeed();
  send('settings:changed', next);
  if (changed('language')) {
    language = i18n.setLanguage(next.language);
    // Every view is built with its text, so the simplest correct switch is a fresh page.
    win.webContents.reload();
  }
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
  const check = (label, key) => ({
    label,
    type: 'checkbox',
    checked: settings[key],
    click: (item) => updateSettings({ [key]: item.checked }),
  });
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: t('tray.open'), accelerator: shortcuts.open ?? undefined, click: openFromShortcut },
    { type: 'separator' },
    {
      label: t('tray.openOn'),
      submenu: OPEN_MODES.map((mode) => ({
        label: t(`tray.openOn.${mode}`),
        type: 'radio',
        checked: settings.openOn === mode,
        click: () => updateSettings({ openOn: mode }),
      })),
    },
    check(t('tray.dnd'), 'dnd'),
    check(t('tray.fullscreen'), 'hideInFullscreen'),
    check(t('tray.yield'), 'yieldToWindows'),
    check(t('tray.launch'), 'launchAtLogin'),
    { type: 'separator' },
    { label: t('tray.quit'), click: () => app.quit() },
  ]));
}

function createTray() {
  tray = new Tray(trayImage());
  tray.setToolTip('Islet');
  tray.on('click', openFromShortcut);
  buildTrayMenu();
}

// ───────────── IPC ─────────────

function registerIpc() {
  ipcMain.handle('app:init', () => ({
    settings: store.get('settings'),
    language,
    clipboard: clips.items.map(clipView),
    bookmarks: bookmarks.items,
    notes: store.get('notes'),
    media: bridge.state,
    volume: bridge.volume,
    shortcuts: shortcutStatus(),
    displays: displayList(),
    update: updater.status,
    onboarded: store.get('meta').onboarded,
    ear: windowBeneath,
    version: app.getVersion(),
  }));
  ipcMain.on('app:onboarded', () => store.set('meta', { ...store.get('meta'), onboarded: true }));
  // The page subscribes after app:init; anything that changed in between is sent again.
  ipcMain.on('app:ready', () => {
    send('island:ear', windowBeneath);
    send('volume:changed', bridge.volume);
    send('media:state', bridge.state);
  });

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
    islandState = String(state);
    if (islandState !== 'compact') return;
    pasteTarget = 0;
    if (shownOverFullscreen) {
      shownOverFullscreen = false;
      watchWindows();
    }
  });

  // Media and volume
  ipcMain.on('media:command', (_e, command) => bridge.media(command));
  ipcMain.handle('media:thumb', (_e, key) => bridge.getThumb(String(key)));
  ipcMain.on('volume:set', (_e, change) => bridge.setVolume(change ?? {}));
  ipcMain.on('volume:mute', (_e, muted) => bridge.setMuted(muted));

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
      title: kind === 'folder' ? t('dialog.pickFolder') : t('dialog.pickFile'),
      properties: [kind === 'folder' ? 'openDirectory' : 'openFile'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  // Calendar
  ipcMain.handle('cal:range', (_e, from, to) => calendar.range(Number(from), Number(to)));
  ipcMain.handle('cal:add', (_e, event) => calendar.add(event ?? {}));
  ipcMain.on('cal:remove', (_e, id) => calendar.remove(String(id)));

  // Notes: the renderer owns the editing, the store keeps them.
  ipcMain.on('notes:save', (_e, note) => {
    if (!note || typeof note.id !== 'string') return;
    const text = String(note.text ?? '').slice(0, 100_000);
    const notes = store.get('notes').filter((n) => n.id !== note.id);
    store.set('notes', [{ id: note.id, text, updatedAt: Date.now() }, ...notes]);
  });
  ipcMain.on('notes:remove', (_e, id) => store.set('notes', store.get('notes').filter((n) => n.id !== id)));

  // System
  ipcMain.on('system:watch', (_e, enabled) => system.watch(Boolean(enabled)));

  // Shortcuts: recording a new one must not trigger the current ones.
  ipcMain.on('shortcuts:suspend', (_e, suspended) => {
    shortcutsSuspended = Boolean(suspended);
    registerShortcuts();
  });

  // Updates
  ipcMain.handle('update:check', () => updater.check());
  ipcMain.on('update:install', () => updater.install());

  // Settings
  ipcMain.handle('settings:set', (_e, patch) => updateSettings(patch));
}

// ───────────── App ─────────────

function bootstrap() {
  app.setAppUserModelId('com.islet.app');

  app.whenReady().then(() => {
    const dataDir = app.getPath('userData');
    store = new Store(path.join(dataDir, 'islet.json'), {
      settings: DEFAULT_SETTINGS,
      meta: { onboarded: false },
      clipboard: [],
      bookmarks: [],
      events: [],
      notes: [],
    });
    migrateSettings();
    // Re-registered on every start so the entry follows the app if it moves or is renamed.
    if (store.get('settings').launchAtLogin) setLaunchAtLogin(true);
    language = i18n.setLanguage(store.get('settings').language);

    bridge = new WinBridge(path.join(__dirname, 'win-bridge.ps1'));
    clips = new ClipboardHistory(store, path.join(dataDir, 'clipboard-images'), bridge);
    bookmarks = new Bookmarks(store);
    calendar = new Calendar(store);
    system = new SystemMonitor();
    updater = new Updater();

    bridge.on('state', (state) => send('media:state', state));
    bridge.on('thumb', (key) => send('media:thumb', key));
    bridge.on('volume', (volume) => send('volume:changed', volume));
    clips.on('change', (items) => send('clip:changed', items.map(clipView)));
    clips.on('added', (item) => send('clip:added', clipView(item)));
    bookmarks.on('change', (items) => send('bm:changed', items));
    calendar.on('change', () => send('cal:changed'));
    calendar.on('reminder', (reminder) => send('cal:reminder', reminder));
    system.on('sample', (sample) => send('system:sample', sample));
    updater.on('status', (status) => send('update:status', status));

    registerIpc();
    createWindow();
    createTray();
    registerShortcuts();

    bridge.start();
    clips.start().catch((err) => console.warn('[clipboard] could not start:', err.message));
    calendar.prune();
    calendar.start();
    updater.start();
    setInterval(watchWindows, WATCH_MS);

    screen.on('display-metrics-changed', onDisplaysChanged);
    screen.on('display-added', onDisplaysChanged);
    screen.on('display-removed', onDisplaysChanged);
  });

  app.on('second-instance', openFromShortcut);

  app.on('before-quit', () => {
    quitting = true;
    globalShortcut.unregisterAll();
    bridge?.stop();
    clips?.stop();
    calendar?.stop();
    system?.watch(false);
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
