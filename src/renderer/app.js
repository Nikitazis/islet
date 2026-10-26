import { springEasing } from './lib/spring.js';
import { $, h, iconEl } from './lib/dom.js';
import { clockDate, clockTime } from './lib/format.js';
import { createMediaView } from './views/media.js';
import { createClipboardView } from './views/clipboard.js';
import { createBookmarksView } from './views/bookmarks.js';
import { createSettingsView } from './views/settings.js';

// Opened in a plain browser (no Electron preload): run on demo data.
if (!window.cstorka) await import('./dev/mock.js');
const api = window.cstorka;

const SIZES = {
  idle: { w: 216, h: 36, r: 18 },
  playing: { w: 300, h: 36, r: 18 },
  // A program window is under the pill: just a slim handle at the screen edge.
  ear: { w: 104, h: 6, r: 3 },
  peek: { w: 420, h: 64, r: 32 },
  expanded: { w: 680, h: 330, r: 40 },
  settings: { w: 680, h: 384, r: 40 },
};
const DEPTH = { compact: 0, peek: 1, expanded: 2 };
const TABS = [
  { id: 'media', label: 'Медиа', icon: 'music' },
  { id: 'clipboard', label: 'Буфер', icon: 'clipboard' },
  { id: 'bookmarks', label: 'Закладки', icon: 'bookmark' },
];
const PANES = ['media', 'clipboard', 'bookmarks', 'settings'];
// How long the pointer has to rest on the pill before it opens, per "open on" mode.
const HOVER_DELAY = { hover: 120, dwell: 450 };
// "Edge" mode: the pointer pushed against the top screen edge above the pill.
const EDGE_ROWS = 2;
const EDGE_DWELL = 110;
// Over a browser people throw the pointer up to click tabs, so the ear wants a longer push.
const EAR_DWELL = 400;
const LEAVE_DELAY = 380;
const PEEK_TIME = 2800;

const root = document.documentElement;
const island = $('#island');
const tabsEl = $('.tabs');
const indicator = $('.tabs-indicator');
const settingsBtn = $('#settings-btn');
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
};
let settings = {};
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

function sizeFor(state) {
  if (state === 'compact') return ui.ear ? SIZES.ear : SIZES[ui.playing ? 'playing' : 'idle'];
  if (state === 'expanded' && ui.settingsOpen) return SIZES.settings;
  return SIZES[state];
}

function applySize() {
  const size = sizeFor(ui.state);
  island.style.setProperty('--w', `${size.w}px`);
  island.style.setProperty('--h', `${size.h}px`);
  island.style.setProperty('--r', `${size.r}px`);
  island.style.setProperty('--cw', `${SIZES[ui.playing ? 'playing' : 'idle'].w}px`);
  island.style.setProperty('--eh', `${(ui.settingsOpen ? SIZES.settings : SIZES.expanded).h}px`);
  island.classList.toggle('is-ear', ui.ear);
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
  if (!event.target.closest('button, input, a, .clip, .bm, .track')) pinOpen();
});

// Typing needs focus, which the island only takes when pinned.
island.addEventListener('pointerdown', (event) => {
  const input = event.target.closest('input');
  if (input && !ui.pinned) {
    pinOpen();
    setTimeout(() => input.focus(), 60);
  }
});

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

const tabButtons = TABS.map((tab) => h('button', {
  class: 'tab',
  type: 'button',
  role: 'tab',
  dataset: { tab: tab.id },
  onClick: () => selectTab(tab.id),
}, iconEl(tab.icon), tab.label));
tabsEl.append(...tabButtons);

settingsBtn.append(iconEl('sliders'));
settingsBtn.addEventListener('click', () => setSettingsOpen(!ui.settingsOpen));

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
  for (const button of tabButtons) {
    button.setAttribute('aria-selected', String(!ui.settingsOpen && button.dataset.tab === ui.tab));
  }
  const current = tabButtons.find((b) => b.dataset.tab === ui.tab);
  indicator.style.setProperty('--ix', `${current.offsetLeft}px`);
  indicator.style.setProperty('--iw', `${current.offsetWidth}px`);
  tabsEl.classList.toggle('is-idle', ui.settingsOpen);
  settingsBtn.setAttribute('aria-pressed', String(ui.settingsOpen));

  const open = ui.state === 'expanded';
  views.media?.setVisible(open && active === 'media');
  views.clipboard?.setVisible(open && active === 'clipboard');
  views.bookmarks?.setVisible(open && active === 'bookmarks');
}

// ───────────── Peek notifications ─────────────

const peekIcon = $('#peek-icon');
const peekTitle = $('#peek-title');
const peekSub = $('#peek-sub');
const peekQueue = [];
let peekTimer = null;

function peek(item) {
  if (!settings.notifications || ui.state === 'expanded') return;
  peekQueue.push(item);
  if (peekQueue.length > 2) peekQueue.shift();
  if (!peekTimer) showNextPeek();
}

function showNextPeek() {
  const item = peekQueue.shift();
  if (!item || ui.state === 'expanded') {
    cancelPeek();
    if (ui.state === 'peek') setState('compact');
    return;
  }
  peekIcon.replaceChildren(item.art ? h('img', { src: item.art, alt: '' }) : iconEl(item.icon));
  peekTitle.textContent = item.title;
  peekSub.textContent = item.sub ?? '';
  setState('peek');
  peekTimer = setTimeout(showNextPeek, PEEK_TIME);
}

function cancelPeek() {
  clearTimeout(peekTimer);
  peekTimer = null;
  peekQueue.length = 0;
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

// ───────────── Keyboard ─────────────

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (views.bookmarks.isEditing()) {
      views.bookmarks.cancelEdit();
    } else if (ui.settingsOpen) {
      selectTab(ui.tab);
    } else {
      // Quick paste was called from another window: hand the focus back to it.
      if (views.clipboard.isQuickPaste()) api.clipboard.cancelPaste();
      collapse();
    }
    return;
  }
  if (ui.state !== 'expanded' || event.target.closest('input')) return;
  const number = Number(event.key);
  if (number >= 1 && number <= TABS.length) selectTab(TABS[number - 1].id);
  else if (event.key === ' ' && ui.tab === 'media' && !ui.settingsOpen) {
    event.preventDefault();
    views.media.toggle();
  } else if (event.key === '/' || (event.ctrlKey && event.code === 'KeyF')) {
    event.preventDefault();
    selectTab('clipboard');
    views.clipboard.focusSearch();
  }
});

// ───────────── Wiring ─────────────

function applySettings(next) {
  settings = next;
  root.dataset.accent = next.accent;
}

const data = await api.init();
applySettings(data.settings);
setupMotion();

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
      applySize();
    }
  },
  onTrackChange({ session, art }) {
    peek({ art, icon: 'music', title: session.title, sub: session.artist || session.appName });
  },
});
views.clipboard = createClipboardView(pane('clipboard'), api, { pin: pinOpen, collapse, notify: peek });
views.bookmarks = createBookmarksView(pane('bookmarks'), api, { pin: pinOpen, collapse });
views.settings = createSettingsView(pane('settings'), api, {
  shortcuts: data.shortcuts,
  version: data.version,
  onChange: applySettings,
});

views.media.update(data.media);
views.clipboard.update(data.clipboard);
views.bookmarks.update(data.bookmarks);
views.settings.update(data.settings);

api.clipboard.onAdded((item) => {
  peek(item.type === 'image'
    ? { art: item.thumb, title: 'Скопирована картинка', sub: `${item.width} × ${item.height}` }
    : { icon: item.kind === 'link' ? 'link' : 'clipboard', title: 'Скопировано', sub: item.text.replace(/\s+/g, ' ').trim() });
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

ui.ear = Boolean(data.ear);
tick();
applySize();
renderTabs();

// Demo page: ?state=expanded&tab=clipboard, ?state=peek, ?settings=1, ?accent=orange, ?ear=1
if (api.demo) {
  const params = new URLSearchParams(location.search);
  if (params.get('accent')) applySettings({ ...settings, accent: params.get('accent') });
  if (params.get('tab')) ui.tab = params.get('tab');
  if (params.get('ear')) setEar(true);
  if (params.get('state') === 'expanded') expand();
  if (params.get('settings')) { expand(); setSettingsOpen(true); }
  if (params.get('state') === 'peek') api.demoPeek?.();
  if (params.get('state') === 'paste') api.demoQuickPaste?.();
  window.cstorkaUi = { expand, collapse, peek, selectTab, setEar };
}
