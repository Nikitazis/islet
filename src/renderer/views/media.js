import { h, iconEl } from '../lib/dom.js';
import { duration } from '../lib/format.js';

const sessionId = (s) => `${s.app}#${s.index}`;
const trackKey = (s) => `${s.app}|${s.title}|${s.artist}`;

/** Loads a thumbnail once to learn its shape: wide frames are treated as video. */
function inspectImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ url, ratio: img.naturalWidth / Math.max(1, img.naturalHeight) });
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

export function createMediaView(root, api, hooks) {
  let state = { current: -1, sessions: [] };
  let selected = null;
  let visible = false;
  let lastTrack = null;
  let ready = false;
  let frame = 0;
  const thumbs = new Map();

  // ── DOM ──
  const art = h('img', { class: 'art', alt: '' });
  const glow = h('img', { class: 'art-glow', alt: '' });
  const artWrap = h('div', { class: 'art-wrap' }, glow, art, h('div', { class: 'art-placeholder', icon: 'music' }));
  const sources = h('div', { class: 'sources' });
  const title = h('h2', { class: 'title' });
  const artist = h('div', { class: 'artist' });
  const fill = h('div', { class: 'track-fill' });
  const track = h('div', { class: 'track', onClick: seek }, h('div', { class: 'track-rail' }, fill));
  const elapsed = h('span');
  const remaining = h('span');
  const progress = h('div', { class: 'progress' }, track, h('div', { class: 'times' }, elapsed, remaining));
  const prevBtn = h('button', { class: 'ctrl', type: 'button', 'aria-label': 'Предыдущий трек', icon: 'prev', onClick: () => send('prev') });
  const toggleBtn = h('button', { class: 'ctrl is-main', type: 'button', onClick: toggle });
  const nextBtn = h('button', { class: 'ctrl', type: 'button', 'aria-label': 'Следующий трек', icon: 'next', onClick: () => send('next') });
  const player = h('div', { class: 'media' },
    artWrap,
    h('div', { class: 'meta' }, sources, title, artist, progress, h('div', { class: 'controls' }, prevBtn, toggleBtn, nextBtn)),
  );
  const empty = h('div', { class: 'empty' },
    h('div', { class: 'empty-icon', icon: 'music' }),
    h('strong', {}, 'Сейчас ничего не играет'),
    h('p', {}, 'Включите музыку или видео в любом плеере или браузере — здесь появятся обложка и управление.'),
  );
  root.append(player, empty);

  // ── Data ──
  function shown() {
    const list = state.sessions;
    if (!list.length) return null;
    return list.find((s) => sessionId(s) === selected)
      ?? list[state.current]
      ?? list.find((s) => s.status === 'Playing')
      ?? list[0];
  }

  async function loadThumb(key) {
    if (!key || thumbs.has(key)) return;
    thumbs.set(key, null);
    const url = await api.media.thumb(key);
    const info = url ? await inspectImage(url) : null;
    if (info) thumbs.set(key, info);
    else thumbs.delete(key);
    render();
  }

  function positionOf(s) {
    if (!s.duration) return 0;
    const drift = s.status === 'Playing' ? Date.now() - s.updatedAt : 0;
    return Math.min(s.duration, Math.max(0, s.position + drift));
  }

  // ── Actions ──
  function send(cmd, extra = {}) {
    const s = shown();
    if (s) api.media.command({ cmd, app: s.app, index: s.index, ...extra });
  }

  function toggle() {
    const s = shown();
    if (!s) return;
    // Flip the icon right away; the bridge confirms a moment later.
    s.position = positionOf(s);
    s.updatedAt = Date.now();
    s.status = s.status === 'Playing' ? 'Paused' : 'Playing';
    send('toggle');
    render();
  }

  function seek(event) {
    const s = shown();
    if (!s || !s.canSeek || !s.duration) return;
    const rect = track.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    s.position = ratio * s.duration;
    s.updatedAt = Date.now();
    send('seek', { position: s.position });
    renderProgress();
  }

  // ── Render ──
  function renderSources(list, current) {
    sources.replaceChildren(...list.map((s) => {
      const thumb = thumbs.get(s.thumbKey);
      const isVideo = s.kind === 'Video' || (thumb && thumb.ratio > 1.25);
      return h('button', {
        class: 'source',
        type: 'button',
        'aria-pressed': String(s === current),
        title: s.appName,
        onClick: () => { selected = sessionId(s); render(); },
      }, iconEl(isVideo ? 'video' : 'music'), h('span', {}, s.appName));
    }));
    sources.classList.toggle('is-single', list.length < 2);
  }

  function renderProgress() {
    const s = shown();
    if (!s || !s.duration) return;
    const pos = positionOf(s);
    fill.style.setProperty('--p', String(pos / s.duration));
    elapsed.textContent = duration(pos);
    remaining.textContent = `−${duration(s.duration - pos)}`;
  }

  function loop() {
    renderProgress();
    frame = requestAnimationFrame(loop);
  }

  function syncLoop() {
    const s = shown();
    const shouldRun = visible && s && s.status === 'Playing' && s.duration > 0;
    if (shouldRun && !frame) frame = requestAnimationFrame(loop);
    if (!shouldRun && frame) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
  }

  function render() {
    const s = shown();
    root.classList.toggle('is-empty', !s);
    if (!s) {
      hooks.onNowPlaying(null);
      syncLoop();
      return;
    }

    // Every session's thumbnail decides its chip icon (wide = video), not just the shown one.
    state.sessions.forEach((x) => loadThumb(x.thumbKey));
    const thumb = thumbs.get(s.thumbKey);
    const isVideo = s.kind === 'Video' || Boolean(thumb && thumb.ratio > 1.25);
    const playing = s.status === 'Playing';

    player.classList.toggle('is-video', isVideo);
    player.classList.toggle('has-art', Boolean(thumb));
    if (thumb && art.src !== thumb.url) {
      art.src = thumb.url;
      glow.src = thumb.url;
    }
    artWrap.classList.toggle('is-paused', !playing);

    renderSources(state.sessions, s);
    title.textContent = s.title || 'Без названия';
    artist.textContent = s.artist || s.album || s.appName;

    toggleBtn.replaceChildren(iconEl(playing ? 'pause' : 'play'));
    toggleBtn.setAttribute('aria-label', playing ? 'Пауза' : 'Играть');
    toggleBtn.disabled = !s.canToggle;
    prevBtn.disabled = !s.canPrev;
    nextBtn.disabled = !s.canNext;

    progress.classList.toggle('is-hidden', !s.duration);
    track.classList.toggle('can-seek', s.canSeek);
    renderProgress();
    syncLoop();

    hooks.onNowPlaying({ session: s, art: thumb?.url ?? null, playing });

    const key = trackKey(s);
    if (ready && key !== lastTrack && playing && s.title) {
      // Give the artwork a moment to arrive before announcing the track.
      setTimeout(() => {
        const now = shown();
        if (now && trackKey(now) === key) hooks.onTrackChange({ session: now, art: thumbs.get(now.thumbKey)?.url ?? null });
      }, 700);
    }
    lastTrack = key;
    ready = true;
  }

  api.media.onState((next) => {
    state = next;
    if (selected && !state.sessions.some((s) => sessionId(s) === selected)) selected = null;
    render();
  });
  api.media.onThumb((key) => {
    if (state.sessions.some((s) => s.thumbKey === key)) render();
  });

  return {
    update(next) {
      state = next;
      render();
    },
    setVisible(value) {
      visible = value;
      syncLoop();
      if (value) renderProgress();
    },
    toggle,
  };
}
