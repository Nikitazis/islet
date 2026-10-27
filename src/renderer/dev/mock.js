// Stand-in for the Electron preload when index.html is opened in a plain browser.
// Lets you work on the UI and take screenshots without running the app.

document.documentElement.classList.add('demo');

const listeners = new Map();
const on = (channel, callback) => {
  if (!listeners.has(channel)) listeners.set(channel, new Set());
  listeners.get(channel).add(callback);
  return () => listeners.get(channel).delete(callback);
};
const emit = (channel, payload) => listeners.get(channel)?.forEach((cb) => cb(payload));
const clone = (value) => structuredClone(value);
const id = () => Math.random().toString(16).slice(2, 14);

function paint(width, height, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext('2d'), width, height);
  return canvas.toDataURL('image/png');
}

const covers = {
  dusk: paint(320, 320, (g, w, h) => {
    const sky = g.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#1b0b3a');
    sky.addColorStop(0.55, '#8a2be2');
    sky.addColorStop(1, '#ff7a59');
    g.fillStyle = sky;
    g.fillRect(0, 0, w, h);
    const sun = g.createLinearGradient(0, h * 0.3, 0, h * 0.75);
    sun.addColorStop(0, '#ffd36e');
    sun.addColorStop(1, '#ff4f8b');
    g.fillStyle = sun;
    g.beginPath();
    g.arc(w / 2, h * 0.58, w * 0.26, Math.PI, 0);
    g.fill();
    g.fillStyle = '#1b0b3a';
    for (let i = 0; i < 6; i++) g.fillRect(0, h * 0.6 + i * i * 3.2, w, 2 + i);
  }),
  aurora: paint(320, 320, (g, w, h) => {
    g.fillStyle = '#05140f';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 5; i++) {
      const band = g.createLinearGradient(0, 0, w, h);
      band.addColorStop(0, 'rgba(40,255,170,0)');
      band.addColorStop(0.5, `rgba(${60 + i * 30},255,${180 - i * 20},0.35)`);
      band.addColorStop(1, 'rgba(120,80,255,0)');
      g.fillStyle = band;
      g.beginPath();
      g.ellipse(w * (0.3 + i * 0.1), h * (0.35 + i * 0.04), w * 0.5, h * 0.08, -0.5, 0, Math.PI * 2);
      g.fill();
    }
  }),
  video: paint(320, 180, (g, w, h) => {
    const bg = g.createLinearGradient(0, 0, w, h);
    bg.addColorStop(0, '#0f2027');
    bg.addColorStop(1, '#2c5364');
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#000';
    g.beginPath();
    g.roundRect(w * 0.3, h * 0.38, w * 0.4, h * 0.16, h * 0.08);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.font = '600 20px Segoe UI, sans-serif';
    g.fillText('UI', 16, h - 18);
  }),
  shot: paint(240, 150, (g, w, h) => {
    g.fillStyle = '#f2f2f7';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#d1d1d6';
    for (let i = 0; i < 5; i++) g.fillRect(20, 24 + i * 22, 120 + (i % 3) * 30, 10);
    g.fillStyle = '#bf5af2';
    g.fillRect(170, 24, 50, 50);
  }),
};

const tracks = [
  { title: 'Неоновый закат', artist: 'Полярная ночь', album: 'Северное сияние', duration: 214000, thumbKey: 'dusk' },
  { title: 'Тихий океан', artist: 'Сонные спутники', album: 'Орбита', duration: 187000, thumbKey: 'aurora' },
];
let trackIndex = 0;

const now = Date.now();
const state = {
  media: {
    current: 0,
    sessions: [
      {
        index: 0, app: 'Spotify.exe', appName: 'Spotify', ...tracks[0], kind: 'Music',
        status: 'Playing', position: 67000, updatedAt: now,
        canToggle: true, canNext: true, canPrev: true, canSeek: true,
      },
      {
        index: 1, app: 'Chrome', appName: 'Google Chrome', title: 'Как устроен Dynamic Island: разбор анимаций',
        artist: 'Дизайн за 10 минут', album: '', kind: 'Music', status: 'Paused', duration: 742000,
        position: 125000, updatedAt: now, canToggle: true, canNext: false, canPrev: false, canSeek: true, thumbKey: 'video',
      },
    ],
  },
  clipboard: [
    { id: id(), type: 'text', kind: 'link', text: 'https://github.com/username/islet', length: 35, createdAt: now - 40_000, pinned: false },
    { id: id(), type: 'text', kind: 'text', text: 'Созвон перенесли на четверг, 15:30. Ссылку пришлю в чат за полчаса.', length: 68, createdAt: now - 6 * 60_000, pinned: false },
    { id: id(), type: 'image', thumb: covers.shot, width: 1920, height: 1200, createdAt: now - 25 * 60_000, pinned: false },
    { id: id(), type: 'files', names: ['Отчёт за октябрь.pdf', 'Графики.xlsx'], icon: null, createdAt: now - 2 * 3_600_000, pinned: false },
    { id: id(), type: 'text', kind: 'text', text: 'npm run dist', length: 12, createdAt: now - 3 * 3_600_000, pinned: false },
    { id: id(), type: 'text', kind: 'text', text: 'Москва, ул. Тверская, д. 7, подъезд 2, код домофона 214', length: 55, createdAt: now - 26 * 3_600_000, pinned: true },
  ],
  bookmarks: [
    { id: id(), type: 'url', target: 'https://github.com/', title: 'GitHub', icon: null },
    { id: id(), type: 'url', target: 'https://www.youtube.com/', title: 'YouTube', icon: null },
    { id: id(), type: 'url', target: 'https://music.yandex.ru/', title: 'Музыка', icon: null },
    { id: id(), type: 'url', target: 'https://figma.com/', title: 'Figma', icon: null },
    { id: id(), type: 'folder', target: 'C:\\Users\\me\\Downloads', title: 'Загрузки', icon: null },
    { id: id(), type: 'file', target: 'C:\\Users\\me\\Documents\\План.docx', title: 'План.docx', icon: null },
  ],
  notes: [
    { id: id(), text: 'Купить к выходным\nмолоко, кофе, батарейки AA', updatedAt: now - 20 * 60_000 },
    { id: id(), text: 'Идеи для шторки\n— погода в пилюле\n— быстрые ответы в Telegram', updatedAt: now - 26 * 3_600_000 },
  ],
  events: [],
  settings: {
    accent: 'violet', language: 'auto', openOn: 'dwell', notifications: true, dnd: false,
    hideInFullscreen: true, yieldToWindows: true, display: 'primary',
    openShortcut: '', pasteShortcut: 'Control+Shift+V', launchAtLogin: false, clipboardLimit: 60, calendarUrl: '',
  },
};

// A few events around today, as if they came from the user's calendar.
const today = new Date();
const at = (dayOffset, h, m = 0) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + dayOffset, h, m).getTime();
state.events = [
  { id: id(), title: 'Созвон с командой', start: at(0, 10, 30), end: at(0, 11), allDay: false, source: 'feed' },
  { id: id(), title: 'Обед с Аней', start: at(0, 13), end: at(0, 14), allDay: false, source: 'local' },
  { id: id(), title: 'Ревью дизайна шторки', start: at(0, 16, 30), end: at(0, 17, 30), allDay: false, source: 'feed' },
  { id: id(), title: 'День рождения Димы', start: at(2, 0), end: at(3, 0), allDay: true, source: 'feed' },
  { id: id(), title: 'Сдать отчёт', start: at(5, 12), end: at(5, 12), allDay: false, source: 'local' },
];

const pushMedia = () => emit('media', clone(state.media));
const pushClips = () => emit('clips', clone(state.clipboard));
const pushBookmarks = () => emit('bookmarks', clone(state.bookmarks));

let volume = { supported: true, level: 0.62, muted: false };
let systemTimer = null;
let tickN = 0;

function addClip(text) {
  const item = { id: id(), type: 'text', kind: /^https?:/.test(text) ? 'link' : 'text', text, length: text.length, createdAt: Date.now(), pinned: false };
  state.clipboard.unshift(item);
  pushClips();
  emit('added', clone(item));
}

const params = new URLSearchParams(location.search);

window.islet = {
  demo: true,
  init: async () => ({
    ...clone(state),
    language: params.get('lang') ?? 'ru',
    volume: clone(volume),
    shortcuts: { open: 'Control+Alt+Space', paste: 'Control+Shift+V', suspended: false },
    displays: [{ id: 'id:1', n: 1, primary: true, size: '1920×1080' }],
    update: { state: 'latest' },
    onboarded: !params.get('onboarding'),
    ear: false,
    version: '0.3.0',
  }),
  onboarded() {},
  ready() {},

  island: {
    setInteractive() {},
    setFocus() {},
    reportState() {},
    onToggle: (cb) => on('toggle', cb),
    onCollapse: (cb) => on('collapse', cb),
    onQuickPaste: (cb) => on('quick-paste', cb),
    onEar: (cb) => on('ear', cb),
    onBlur: (cb) => on('blur', cb),
  },

  shortcuts: {
    suspend() {},
    onChange: (cb) => on('shortcuts', cb),
  },

  displays: { onChange: (cb) => on('displays', cb) },

  volume: {
    set({ value, delta }) {
      const level = Number.isFinite(delta) ? volume.level + delta : value;
      volume = { ...volume, level: Math.min(1, Math.max(0, level)), muted: false };
      emit('volume', clone(volume));
    },
    mute(muted) {
      volume = { ...volume, muted: Boolean(muted) };
      emit('volume', clone(volume));
    },
    onChange: (cb) => on('volume', cb),
  },

  calendar: {
    async range(from, to) {
      return { items: state.events.filter((e) => e.start < to && Math.max(e.end, e.start + 1) > from), feed: { ok: true, connected: true } };
    },
    async add({ title, date, time }) {
      if (!title?.trim()) return null;
      const [y, m, d] = date.split('-').map(Number);
      const [hh, mm] = (time || '0:0').split(':').map(Number);
      const start = new Date(y, m - 1, d, hh, mm).getTime();
      const event = { id: id(), title: title.trim(), start, end: start, allDay: !time, source: 'local' };
      state.events.push(event);
      state.events.sort((a, b) => a.start - b.start);
      emit('cal');
      return event;
    },
    remove(eventId) {
      state.events = state.events.filter((e) => e.id !== eventId);
      emit('cal');
    },
    onChange: (cb) => on('cal', cb),
    onReminder: (cb) => on('reminder', cb),
  },

  notes: { save() {}, remove() {} },

  system: {
    watch(enabled) {
      clearInterval(systemTimer);
      if (!enabled) return;
      const sample = () => {
        tickN += 1;
        emit('system', {
          cpu: 0.18 + 0.12 * Math.sin(tickN / 2) + Math.random() * 0.08,
          memory: { used: 11.9 * 2 ** 30, total: 15.7 * 2 ** 30 },
          disk: { drive: 'C:', free: 112 * 2 ** 30, total: 476 * 2 ** 30 },
          network: { down: (1.2 + Math.sin(tickN / 3)) * 2 ** 20, up: 96 * 2 ** 10 },
          battery: { percent: 84, plugged: false, charging: false, secondsLeft: 3 * 3600 + 20 * 60 },
          uptime: 2 * 86_400 + 5 * 3600,
        });
      };
      for (let i = 0; i < 30; i++) sample();
      systemTimer = setInterval(sample, 1500);
    },
    onSample: (cb) => on('system', cb),
  },

  updates: {
    check: async () => ({ state: 'latest' }),
    install() {},
    onStatus: (cb) => on('update', cb),
  },

  media: {
    command({ cmd, app, position }) {
      const s = state.media.sessions.find((x) => x.app === app);
      if (!s) return;
      const pos = s.status === 'Playing' ? s.position + Date.now() - s.updatedAt : s.position;
      if (cmd === 'toggle') Object.assign(s, { status: s.status === 'Playing' ? 'Paused' : 'Playing', position: pos, updatedAt: Date.now() });
      if (cmd === 'seek') Object.assign(s, { position, updatedAt: Date.now() });
      if (cmd === 'next' || cmd === 'prev') {
        trackIndex = (trackIndex + 1) % tracks.length;
        Object.assign(s, tracks[trackIndex], { position: 0, updatedAt: Date.now(), status: 'Playing' });
      }
      setTimeout(pushMedia, 120);
    },
    thumb: async (key) => covers[key] ?? null,
    onState: (cb) => on('media', cb),
    onThumb: (cb) => on('thumb', cb),
  },

  clipboard: {
    copy: async (clipId) => {
      const item = state.clipboard.find((c) => c.id === clipId);
      if (!item) return false;
      item.createdAt = Date.now();
      state.clipboard = [item, ...state.clipboard.filter((c) => c !== item)];
      setTimeout(pushClips, 900);
      return true;
    },
    async paste(clipId) {
      const ok = await window.islet.clipboard.copy(clipId);
      console.log('[demo] paste', clipId);
      return { ok, pasted: ok };
    },
    cancelPaste() {},
    togglePin(clipId) {
      const item = state.clipboard.find((c) => c.id === clipId);
      if (item) item.pinned = !item.pinned;
      pushClips();
    },
    remove(clipId) {
      state.clipboard = state.clipboard.filter((c) => c.id !== clipId);
      pushClips();
    },
    clear() {
      state.clipboard = state.clipboard.filter((c) => c.pinned);
      pushClips();
    },
    onChange: (cb) => on('clips', cb),
    onAdded: (cb) => on('added', cb),
  },

  bookmarks: {
    async add({ target, title }) {
      const value = String(target ?? '').trim();
      if (!/^[\w-]+(\.[\w-]+)+/.test(value.replace(/^https?:\/\//, ''))) return { ok: false, error: 'invalid' };
      const url = /^https?:/.test(value) ? value : `https://${value}`;
      const bookmark = { id: id(), type: 'url', target: url, title: title || new URL(url).hostname.replace(/^www\./, ''), icon: null };
      state.bookmarks.push(bookmark);
      pushBookmarks();
      return { ok: true, bookmark };
    },
    open: async () => true,
    remove(bmId) {
      state.bookmarks = state.bookmarks.filter((b) => b.id !== bmId);
      pushBookmarks();
    },
    rename() {},
    move(bmId, index) {
      const item = state.bookmarks.find((b) => b.id === bmId);
      state.bookmarks = state.bookmarks.filter((b) => b !== item);
      state.bookmarks.splice(index, 0, item);
      pushBookmarks();
    },
    pick: async () => null,
    pathForFile: (file) => file.name,
    onChange: (cb) => on('bookmarks', cb),
  },

  settings: {
    async set(patch) {
      const languageChanged = patch.language && patch.language !== state.settings.language;
      state.settings = { ...state.settings, ...patch };
      if (languageChanged) {
        const url = new URL(location.href);
        url.searchParams.set('lang', patch.language === 'en' ? 'en' : 'ru');
        location.href = url.href;
      }
      return clone(state.settings);
    },
    onChange: (cb) => on('settings', cb),
  },

  demoPeek: () => addClip('Встреча в 18:00 у главного входа'),
  demoQuickPaste: () => emit('quick-paste'),
};

// Handy in the console: isletDemo.copy('текст'), isletDemo.next()
window.isletDemo = {
  copy: addClip,
  next: () => window.islet.media.command({ cmd: 'next', app: 'Spotify.exe' }),
  toggle: () => emit('toggle', {}),
  quickPaste: () => emit('quick-paste'),
  ear: (on = true) => emit('ear', on),
};
