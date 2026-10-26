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
    { id: id(), type: 'text', kind: 'link', text: 'https://github.com/username/cstorka', length: 35, createdAt: now - 40_000, pinned: false },
    { id: id(), type: 'text', kind: 'text', text: 'Созвон перенесли на четверг, 15:30. Ссылку пришлю в чат за полчаса.', length: 68, createdAt: now - 6 * 60_000, pinned: false },
    { id: id(), type: 'image', thumb: covers.shot, width: 1920, height: 1200, createdAt: now - 25 * 60_000, pinned: false },
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
  settings: { accent: 'violet', hoverExpand: true, notifications: true, launchAtLogin: false, clipboardLimit: 60 },
};

const pushMedia = () => emit('media', clone(state.media));
const pushClips = () => emit('clips', clone(state.clipboard));
const pushBookmarks = () => emit('bookmarks', clone(state.bookmarks));

function addClip(text) {
  const item = { id: id(), type: 'text', kind: /^https?:/.test(text) ? 'link' : 'text', text, length: text.length, createdAt: Date.now(), pinned: false };
  state.clipboard.unshift(item);
  pushClips();
  emit('added', clone(item));
}

window.cstorka = {
  demo: true,
  init: async () => ({ ...clone(state), shortcut: 'Control+Alt+Space', version: '0.1.0' }),

  island: {
    setInteractive() {},
    setFocus() {},
    onToggle: (cb) => on('toggle', cb),
    onBlur: (cb) => on('blur', cb),
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
      state.settings = { ...state.settings, ...patch };
      return clone(state.settings);
    },
    onChange: (cb) => on('settings', cb),
  },

  demoPeek: () => addClip('Встреча в 18:00 у главного входа'),
};

// Handy in the console: cstorkaDemo.copy('текст'), cstorkaDemo.next()
window.cstorkaDemo = {
  copy: addClip,
  next: () => window.cstorka.media.command({ cmd: 'next', app: 'Spotify.exe' }),
  toggle: () => emit('toggle', {}),
};
