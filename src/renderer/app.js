import { springEasing } from './lib/spring.js';
import { $, h, iconEl } from './lib/dom.js';
import { clockDate, clockTime, duration, minutesLabel } from './lib/format.js';
import { setLanguage, t } from './lib/i18n.js';
import { createTimer } from './lib/timer.js';
import { chime } from './lib/chime.js';
import { createMediaView } from './views/media.js';
import { createClipboardView } from './views/clipboard.js';
import { createBookmarksView } from './views/bookmarks.js';
import { createTimerView } from './views/timer.js';
import { createCalendarView } from './views/calendar.js';
import { createSystemView } from './views/system.js';
import { createNotesView } from './views/notes.js';
import { createSettingsView, prettyShortcut } from './views/settings.js';

// Opened in a plain browser (no Electron preload): run on demo data.
if (!window.islet) await import('./dev/mock.js');
const api = window.islet;

const SIZES = {
  // A program window is under the pill: just a slim handle at the screen edge.
  ear: { w: 104, h: 6, r: 3 },
  peek: { w: 420, h: 64, r: 32 },
  expanded: { w: 680, h: 330, r: 40 },
  settings: { w: 680, h: 384, r: 40 },
};
const DEPTH = { compact: 0, peek: 1, expanded: 2 };
const TABS = [
  { id: 'media', icon: 'music' },
  { id: 'clipboard', icon: 'clipboard' },
  { id: 'bookmarks', icon: 'bookmark' },
  { id: 'timer', icon: 'timer' },
  { id: 'calendar', icon: 'calendar' },
  { id: 'system', icon: 'gauge' },
  { id: 'notes', icon: 'note' },
];
const PANES = [...TABS.map((tab) => tab.id), 'settings'];
// Tabs show only their icon until selected; the selected one also shows its name.
const TAB_ICON_WIDTH = 36;
const TAB_LABEL_EXTRA = 11 + 16 + 7 + 13;
// How long the pointer has to rest on the pill before it opens, per "open on" mode.
const HOVER_DELAY = { hover: 120, dwell: 450 };
// "Edge" mode: the pointer pushed against the top screen edge above the pill.
const EDGE_ROWS = 2;
const EDGE_DWELL = 110;
// Over a browser people throw the pointer up to click tabs, so the ear wants a longer push.
const EAR_DWELL = 400;
const LEAVE_DELAY = 380;
const PEEK_TIME = 2800;
const VOLUME_STEP = 0.02;

const root = document.documentElement;
const island = $('#island');
const tabsEl = $('.tabs');
const indicator = $('.tabs-indicator');
const settingsBtn = $('#settings-btn');
const dndBtn = $('#dnd-btn');
const miniArt = $('#mini-art');
const panes = [...document.querySelectorAll('.pane')];
const pane = (id) => panes.find((p) => p.dataset.pane === id);

const ui = {
  state: 'compact',
  tab: 'media',
  settingsOpen: false,
  pinned: false,
  hovering: false,
  playing: false,
  ear: false,
  live: null, // the running timer, shown in the pill
};
let settings = {};
let volume = { supported: false, level: 0, muted: false };
let hoverTimer = null;
let leaveTimer = null;
let edgeTimer = null;
const views = {};

// ───────────── Motion ─────────────

function setupMotion() {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const curves = reduced
    ? { open: { easing: 'ease', duration: 160 }, close: { easing: 'ease', duration: 160 }, soft: { easing: 'ease', duration: 160 } }
    : {
      // A little overshoot when opening, a firm settle when closing.
      open: springEasing({ stiffness: 240, damping: 21 }),
      close: springEasing({ stiffness: 320, damping: 30 }),
      soft: springEasing({ stiffness: 380, damping: 34 }),
    };
  for (const [name, curve] of Object.entries(curves)) {
    root.style.setProperty(`--${name}-ease`, curve.easing);
    root.style.setProperty(`--${name}-dur`, `${curve.duration}ms`);
  }
}

// ───────────── Island state ─────────────

/** The pill grows with what it shows: album art, the moon, a timer or the equalizer. */
function compactWidth() {
  let w = 216;
  if (ui.playing) w += 30;
  if (settings.dnd) w += 20;
  if (ui.live) w += 84;
  else if (ui.playing) w += 54;
  return w;
}

function sizeFor(state) {
  if (state === 'compact') return ui.ear ? SIZES.ear : { w: compactWidth(), h: 36, r: 18 };
  if (state === 'expanded' && ui.settingsOpen) return SIZES.settings;
  return SIZES[state];
}

function applySize() {
  const size = sizeFor(ui.state);
  island.style.setProperty('--w', `${size.w}px`);
  island.style.setProperty('--h', `${size.h}px`);
  island.style.setProperty('--r', `${size.r}px`);
  island.style.setProperty('--cw', `${compactWidth()}px`);
  island.style.setProperty('--eh', `${(ui.settingsOpen ? SIZES.settings : SIZES.expanded).h}px`);
  island.classList.toggle('is-ear', ui.ear);
  island.classList.toggle('is-live', Boolean(ui.live));
  island.classList.toggle('is-dnd', Boolean(settings.dnd));
}

/** Growing shapes overshoot a little, shrinking ones settle firmly. */
function setEase(growing) {
  island.style.setProperty('--ease', growing ? 'var(--open-ease)' : 'var(--close-ease)');
  island.style.setProperty('--dur', growing ? 'var(--open-dur)' : 'var(--close-dur)');
}

function setState(next) {
  if (next !== ui.state) {
    setEase(DEPTH[next] > DEPTH[ui.state]);
    ui.state = next;
    island.dataset.state = next;
    api.island.reportState(next);
  }
  if (next !== 'expanded') {
    if (ui.pinned) api.island.setFocus(false);
    ui.pinned = false;
    ui.settingsOpen = false;
  }
  applySize();
  renderTabs();
}

function expand({ pin = false } = {}) {
  cancelPeek();
  clearTimeout(leaveTimer);
  setState('expanded');
  if (pin) pinOpen();
  // Opening the island acknowledges a finished timer.
  if (ui.live?.status === 'done') timer.dismiss();
}

function collapse() {
  clearTimeout(hoverTimer);
  clearTimeout(leaveTimer);
  clearTimeout(edgeTimer);
  edgeTimer = null;
  setState('compact');
}

/** Keeps the island open after the pointer leaves and lets it take keyboard focus. */
function pinOpen() {
  if (ui.pinned) return;
  ui.pinned = true;
  api.island.setFocus(true);
}

// ───────────── Pointer ─────────────

island.addEventListener('pointerenter', (event) => {
  ui.hovering = true;
  clearTimeout(leaveTimer);
  // Over a program window the ear and the notifications stay click-through:
  // clicks go to the tabs underneath, and only the edge push opens the island.
  if (ui.ear && ui.state !== 'expanded') return;
  api.island.setInteractive(true);
  const delay = HOVER_DELAY[settings.openOn];
  // A held button means a tab or a selection is being dragged past: don't pop open.
  if (ui.state !== 'expanded' && delay !== undefined && event.buttons === 0) {
    hoverTimer = setTimeout(() => expand(), delay);
  }
});

// "Edge" mode and the ear watch the very top rows of the screen. The window
// forwards pointer moves even where it is click-through, so this sees them.
document.addEventListener('mousemove', (event) => {
  if ((!ui.ear && settings.openOn !== 'edge') || ui.state === 'expanded') return;
  const pill = island.getBoundingClientRect();
  const margin = ui.ear ? 16 : 8;
  const atEdge = event.clientY < EDGE_ROWS && event.buttons === 0
    && event.clientX >= pill.left - margin && event.clientX <= pill.right + margin;
  if (!atEdge) {
    clearTimeout(edgeTimer);
    edgeTimer = null;
  } else if (!edgeTimer) {
    edgeTimer = setTimeout(() => {
      edgeTimer = null;
      expand();
      // The pointer is above the island, not on it: close unless it comes down.
      leaveTimer = setTimeout(() => { if (!ui.hovering && !ui.pinned) collapse(); }, 1200);
    }, ui.ear ? EAR_DWELL : EDGE_DWELL);
  }
});

island.addEventListener('pointerleave', () => {
  ui.hovering = false;
  // Outside the island the window is click-through again right away.
  api.island.setInteractive(false);
  clearTimeout(hoverTimer);
  if (ui.state === 'expanded' && !ui.pinned) {
    leaveTimer = setTimeout(collapse, LEAVE_DELAY);
  }
});

island.addEventListener('click', (event) => {
  if (ui.state !== 'expanded') {
    clearTimeout(hoverTimer);
    expand({ pin: true });
    return;
  }
  if (!event.target.closest('button, input, textarea, a, .clip, .bm, .track')) pinOpen();
});

// Typing needs focus, which the island only takes when pinned.
island.addEventListener('pointerdown', (event) => {
  const field = event.target.closest('input:not([type="range"]), textarea');
  if (field && !ui.pinned) {
    pinOpen();
    setTimeout(() => field.focus(), 60);
  }
});

// The wheel over the pill changes the system volume.
island.addEventListener('wheel', (event) => {
  if (ui.state === 'expanded' || !volume.supported || !event.deltaY) return;
  event.preventDefault();
  // Scrolling here means "volume", not "open": stop a pending hover opening.
  clearTimeout(hoverTimer);
  const step = event.deltaY < 0 ? VOLUME_STEP : -VOLUME_STEP;
  volume = { ...volume, level: Math.min(1, Math.max(0, volume.level + step)), muted: step < 0 ? volume.muted : false };
  api.volume.set({ delta: step });
  views.media?.setVolume(volume);
  showVolume();
}, { passive: false });

// Dragging a link or file over the island opens bookmarks.
island.addEventListener('dragenter', (event) => {
  const types = [...(event.dataTransfer?.types ?? [])];
  if (!types.includes('Files') && !types.includes('text/uri-list')) return;
  if (ui.state !== 'expanded' || ui.tab !== 'bookmarks' || ui.settingsOpen) {
    expand({ pin: true });
    selectTab('bookmarks');
  }
});

// Nothing dropped outside the bookmarks pane should do anything.
window.addEventListener('dragover', (event) => {
  if (!event.target.closest?.('[data-pane="bookmarks"]')) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'none';
  }
});
window.addEventListener('drop', (event) => event.preventDefault());

// ───────────── Tabs ─────────────

let tabButtons = [];
const tabWidths = new Map();

function buildTabs() {
  tabButtons = TABS.map((tab) => h('button', {
    class: 'tab',
    type: 'button',
    role: 'tab',
    title: t(`tabs.${tab.id}`),
    'aria-label': t(`tabs.${tab.id}`),
    dataset: { tab: tab.id },
    onClick: () => selectTab(tab.id),
  }, iconEl(tab.icon), h('span', { class: 'tab-label' }, t(`tabs.${tab.id}`))));
  tabsEl.append(...tabButtons);
  // Measure every name once so widths can be set explicitly and animate.
  tabsEl.classList.add('is-measuring');
  for (const button of tabButtons) tabWidths.set(button.dataset.tab, button.querySelector('.tab-label').scrollWidth);
  tabsEl.classList.remove('is-measuring');
}

/** Settings need a taller island; the shape springs to the new height. */
function setSettingsOpen(open) {
  if (open === ui.settingsOpen) return;
  ui.settingsOpen = open;
  setEase(open);
  applySize();
  renderTabs();
}

function selectTab(id) {
  ui.tab = id;
  if (ui.settingsOpen) setSettingsOpen(false);
  else renderTabs();
}

function renderTabs() {
  const active = ui.settingsOpen ? 'settings' : ui.tab;
  const activeIndex = PANES.indexOf(active);
  for (const p of panes) {
    const index = PANES.indexOf(p.dataset.pane);
    p.classList.toggle('is-active', index === activeIndex);
    p.classList.toggle('is-before', index < activeIndex);
    p.inert = index !== activeIndex;
  }
  let offset = 3;
  for (const button of tabButtons) {
    const selected = !ui.settingsOpen && button.dataset.tab === ui.tab;
    const isCurrent = button.dataset.tab === ui.tab;
    const width = isCurrent ? TAB_LABEL_EXTRA + tabWidths.get(button.dataset.tab) : TAB_ICON_WIDTH;
    button.style.width = `${width}px`;
    button.setAttribute('aria-selected', String(selected));
    button.classList.toggle('is-current', isCurrent);
    if (isCurrent) {
      indicator.style.setProperty('--ix', `${offset}px`);
      indicator.style.setProperty('--iw', `${width}px`);
    }
    offset += width;
  }
  tabsEl.classList.toggle('is-idle', ui.settingsOpen);
  settingsBtn.setAttribute('aria-pressed', String(ui.settingsOpen));

  const open = ui.state === 'expanded';
  for (const id of PANES) views[id]?.setVisible?.(open && active === id);
}

// ───────────── Peek notifications ─────────────

const peekIcon = $('#peek-icon');
const peekTitle = $('#peek-title');
const peekSub = $('#peek-sub');
const peekBar = $('#peek-bar');
const peekQueue = [];
let peekTimer = null;
let peekShowing = null;

/**
 * Shows a short notification in the pill. `force` ignores the notification
 * settings (the timer, volume, onboarding); a peek with the same `key` as the
 * one on screen updates it in place (volume while scrolling).
 */
function peek(item) {
  if (ui.state === 'expanded') return;
  if (!item.force && (!settings.notifications || settings.dnd)) return;
  if (item.key && peekShowing?.key === item.key) {
    renderPeek(item);
    clearTimeout(peekTimer);
    peekTimer = setTimeout(showNextPeek, item.duration ?? PEEK_TIME);
    return;
  }
  peekQueue.push(item);
  if (peekQueue.length > 3) peekQueue.shift();
  if (!peekTimer) showNextPeek();
}

function renderPeek(item) {
  peekShowing = item;
  peekIcon.replaceChildren(item.art ? h('img', { src: item.art, alt: '' }) : iconEl(item.icon));
  peekTitle.textContent = item.title;
  peekSub.textContent = item.sub ?? '';
  peekSub.hidden = item.bar !== undefined;
  peekBar.hidden = item.bar === undefined;
  peekBar.style.setProperty('--b', String(item.bar ?? 0));
}

function showNextPeek() {
  const item = peekQueue.shift();
  if (!item || ui.state === 'expanded') {
    cancelPeek();
    if (ui.state === 'peek') setState('compact');
    return;
  }
  renderPeek(item);
  setState('peek');
  peekTimer = setTimeout(showNextPeek, item.duration ?? PEEK_TIME);
}

function cancelPeek() {
  clearTimeout(peekTimer);
  peekTimer = null;
  peekShowing = null;
  peekQueue.length = 0;
}

function showVolume() {
  const level = Math.round(volume.level * 100);
  const muted = volume.muted || level === 0;
  peek({
    key: 'volume',
    force: true,
    icon: muted ? 'speakerOff' : 'speaker',
    title: muted ? t('peek.muted') : t('peek.volume', { value: level }),
    bar: muted ? 0 : volume.level,
    duration: 1400,
  });
}

// ───────────── Clock ─────────────

function tick() {
  const now = new Date();
  const time = clockTime(now);
  const date = clockDate(now);
  $('#clock').textContent = time;
  $('#date').textContent = date;
  $('#bar-time').textContent = time;
  $('#bar-date').textContent = date;
  setTimeout(tick, 60_000 - (now.getSeconds() * 1000 + now.getMilliseconds()) + 20);
}

// ───────────── Timer: the live activity ─────────────

const liveProgress = $('#live-progress');
const liveTime = $('#live-time');
const LIVE_RING = 2 * Math.PI * 7.5;
liveProgress.setAttribute('stroke-dasharray', String(LIVE_RING));

function renderLive(s) {
  const active = s.status !== 'idle';
  const changed = Boolean(ui.live) !== active;
  ui.live = active ? s : null;
  views.timer?.update(s);
  if (!active) {
    if (changed) applySize();
    return;
  }
  liveTime.textContent = duration(s.remaining + 999);
  liveProgress.style.strokeDashoffset = String(LIVE_RING * Math.min(1, s.progress));
  island.style.setProperty('--live-p', String(Math.min(1, s.progress)));
  island.dataset.live = s.status;
  if (changed) {
    setEase(true);
    applySize();
  }
}

function onTimerFinish(event) {
  chime({ repeat: event.mode === 'timer' ? 2 : 1 });
  if (event.mode === 'timer') {
    peek({ force: true, icon: 'timer', title: t('peek.timerDone'), sub: t('timer.for', { duration: minutesLabel(Math.round(event.duration / 60_000)) }), duration: 6000 });
  } else if (event.phase === 'focus') {
    peek({ force: true, icon: 'timer', title: t('peek.focus'), sub: t('peek.focusSub', { round: event.round, total: 4, minutes: event.minutes }), duration: 5000 });
  } else {
    peek({ force: true, icon: 'timer', title: t('peek.break'), sub: t('peek.breakSub', { minutes: event.minutes }), duration: 5000 });
  }
}

// ───────────── Keyboard ─────────────

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    const editing = ['bookmarks', 'calendar'].find((id) => views[id].isEditing());
    if (editing) {
      views[editing].cancelEdit();
    } else if (ui.settingsOpen) {
      selectTab(ui.tab);
    } else {
      // Quick paste was called from another window: hand the focus back to it.
      if (views.clipboard.isQuickPaste()) api.clipboard.cancelPaste();
      collapse();
    }
    return;
  }
  if (ui.state !== 'expanded' || event.target.closest('input, textarea')) return;
  const number = Number(event.key);
  if (number >= 1 && number <= TABS.length) {
    selectTab(TABS[number - 1].id);
  } else if (event.key === ' ' && !ui.settingsOpen && (ui.tab === 'media' || ui.tab === 'timer')) {
    event.preventDefault();
    if (ui.tab === 'media') views.media.toggle();
    else timer.toggle();
  } else if (event.key === '/' || (event.ctrlKey && event.code === 'KeyF')) {
    event.preventDefault();
    selectTab('clipboard');
    views.clipboard.focusSearch();
  }
});

// ───────────── Wiring ─────────────

function applySettings(next) {
  const dndChanged = Boolean(next.dnd) !== Boolean(settings.dnd);
  settings = next;
  root.dataset.accent = next.accent;
  dndBtn.setAttribute('aria-pressed', String(Boolean(next.dnd)));
  if (dndChanged && ui.state === 'compact') setEase(Boolean(next.dnd));
  applySize();
}

const data = await api.init();
setLanguage(data.language);
setupMotion();

island.querySelector('.layer-compact').setAttribute('aria-label', t('island.time'));
tabsEl.setAttribute('aria-label', t('island.sections'));
settingsBtn.append(iconEl('sliders'));
settingsBtn.setAttribute('aria-label', t('header.settings'));
settingsBtn.title = t('header.settings');
settingsBtn.addEventListener('click', () => setSettingsOpen(!ui.settingsOpen));
dndBtn.append(iconEl('moon'));
dndBtn.setAttribute('aria-label', t('header.dnd'));
dndBtn.title = t('header.dnd');
dndBtn.addEventListener('click', async () => applySettings(await api.settings.set({ dnd: !settings.dnd })));
$('#dnd-mark').append(iconEl('moon'));
buildTabs();
applySettings(data.settings);

const timer = createTimer({ onChange: renderLive, onFinish: onTimerFinish });

views.media = createMediaView(pane('media'), api, {
  onNowPlaying(info) {
    const playing = Boolean(info?.playing);
    if (info?.art) {
      if (miniArt.src !== info.art) miniArt.src = info.art;
    } else {
      miniArt.removeAttribute('src');
    }
    if (playing !== ui.playing) {
      ui.playing = playing;
      island.classList.toggle('is-playing', playing);
      setEase(playing);
      applySize();
    }
  },
  onTrackChange({ session, art }) {
    peek({ art, icon: 'music', title: session.title, sub: session.artist || session.appName });
  },
});
views.clipboard = createClipboardView(pane('clipboard'), api, { pin: pinOpen, collapse, notify: peek });
views.bookmarks = createBookmarksView(pane('bookmarks'), api, { pin: pinOpen, collapse });
views.timer = createTimerView(pane('timer'), timer);
views.calendar = createCalendarView(pane('calendar'), api, { pin: pinOpen });
views.system = createSystemView(pane('system'), api);
views.notes = createNotesView(pane('notes'), api, { pin: pinOpen });
views.settings = createSettingsView(pane('settings'), api, {
  version: data.version,
  displays: data.displays,
  shortcuts: data.shortcuts,
  update: data.update,
  onChange: applySettings,
  pin: pinOpen,
});

views.media.update(data.media);
views.media.setVolume(data.volume);
volume = data.volume;
views.clipboard.update(data.clipboard);
views.bookmarks.update(data.bookmarks);
views.notes.update(data.notes);
views.settings.update(data.settings);
renderLive(timer.snapshot());

api.volume.onChange((next) => {
  volume = next;
  views.media.setVolume(next);
});

api.clipboard.onAdded((item) => {
  if (item.type === 'image') peek({ art: item.thumb, title: t('peek.copiedImage'), sub: t('clip.imageMeta', { width: item.width, height: item.height }) });
  else if (item.type === 'files') peek({ art: item.icon, icon: 'file', title: t('peek.copiedFiles', { count: item.names.length }), sub: item.names.join(', ') });
  else peek({ icon: item.kind === 'link' ? 'link' : 'clipboard', title: t('peek.copied'), sub: item.text.replace(/\s+/g, ' ').trim() });
});

api.calendar.onReminder((reminder) => {
  peek({
    icon: 'calendar',
    title: reminder.title,
    sub: reminder.minutes > 0 ? t('peek.reminderSub', { minutes: reminder.minutes, time: clockTime(new Date(reminder.start)) }) : t('peek.reminderNow'),
    duration: 6000,
  });
});

api.updates.onStatus((status) => {
  if (status.state === 'ready') peek({ icon: 'reset', title: t('peek.updateReady', { version: status.version }), sub: t('peek.updateReadySub'), duration: 6000 });
});

api.island.onToggle(() => {
  if (ui.state === 'expanded') collapse();
  else expand({ pin: true });
});

// Ctrl+Shift+V: history with the search focused; Enter pastes into the window you came from.
api.island.onQuickPaste(() => {
  expand({ pin: true });
  selectTab('clipboard');
  views.clipboard.startQuickPaste();
});

// The main process hides the island under fullscreen apps.
api.island.onCollapse(collapse);

// A program window under the pill (a browser's tabs): shrink to the ear, or grow back.
function setEar(ear) {
  if (ear === ui.ear) return;
  ui.ear = ear;
  if (ui.state !== 'expanded') {
    setEase(!ear);
    clearTimeout(hoverTimer);
    // The ear never takes clicks, even if the pointer happened to rest on the pill.
    if (ear) api.island.setInteractive(false);
  }
  applySize();
}
api.island.onEar(setEar);

// A click anywhere outside the island takes focus away: close, or at least stop holding focus.
api.island.onBlur(() => {
  if (ui.state === 'expanded' && !ui.hovering) {
    collapse();
  } else if (ui.pinned) {
    ui.pinned = false;
    api.island.setFocus(false);
  }
});

/** First launch: say how to open the island and how quick paste works. */
function onboard() {
  const open = data.shortcuts.open;
  const paste = data.shortcuts.paste;
  peek({
    force: true,
    icon: 'pointer',
    title: t('onboarding.title'),
    sub: open ? t('onboarding.open', { shortcut: prettyShortcut(open) }) : t('onboarding.openNoKey'),
    duration: 6000,
  });
  if (paste) {
    peek({ force: true, icon: 'clipboard', title: t('onboarding.paste', { shortcut: prettyShortcut(paste) }), sub: t('onboarding.pasteSub'), duration: 5000 });
  }
  api.onboarded();
}

ui.ear = Boolean(data.ear);
tick();
applySize();
renderTabs();
api.ready();
if (!data.onboarded) setTimeout(onboard, 1500);

// Demo page: ?state=expanded&tab=clipboard, ?state=peek, ?settings=1, ?accent=orange, ?ear=1, ?lang=en
if (api.demo) {
  const params = new URLSearchParams(location.search);
  if (params.get('accent')) applySettings({ ...settings, accent: params.get('accent') });
  if (params.get('tab')) ui.tab = params.get('tab');
  if (params.get('ear')) setEar(true);
  if (params.get('state') === 'expanded') expand();
  if (params.get('settings')) { expand(); setSettingsOpen(true); }
  if (params.get('state') === 'peek') api.demoPeek?.();
  if (params.get('state') === 'paste') api.demoQuickPaste?.();
  if (params.get('timer')) timer.start(Number(params.get('timer')) * 60_000);
  window.isletUi = { expand, collapse, peek, selectTab, setEar, timer };
}
