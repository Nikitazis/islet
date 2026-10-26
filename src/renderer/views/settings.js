import { h } from '../lib/dom.js';
import { t } from '../lib/i18n.js';

const ACCENTS = [
  { id: 'violet', color: '#bf5af2' },
  { id: 'orange', color: '#ff9f0a' },
];
const LANGUAGES = [
  { id: 'auto', label: () => t('set.language.auto') },
  { id: 'ru', label: () => 'Русский' },
  { id: 'en', label: () => 'English' },
];
const OPEN_MODES = ['hover', 'dwell', 'edge', 'click'];
const LIMITS = [30, 60, 100];

const KEY_NAMES = {
  Space: 'Space', Tab: 'Tab', Insert: 'Insert', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\',
  Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
};

export const prettyShortcut = (accelerator) =>
  accelerator.replace('Control', 'Ctrl').replace('Super', 'Win').split('+').join(' + ');

/** Electron accelerator from a key press, or null while only modifiers are held. */
function toAccelerator(event) {
  const { code } = event;
  let key = null;
  if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
  else if (/^Digit\d$/.test(code)) key = code.slice(5);
  else if (/^F([1-9]|1\d|2[0-4])$/.test(code)) key = code;
  else key = KEY_NAMES[code] ?? null;
  if (!key) return null;
  const mods = [event.ctrlKey && 'Control', event.altKey && 'Alt', event.shiftKey && 'Shift', event.metaKey && 'Super'].filter(Boolean);
  // A global shortcut without Ctrl, Alt or Win would swallow ordinary typing.
  if (!key.startsWith('F') && !mods.some((m) => m !== 'Shift')) return null;
  return [...mods, key].join('+');
}

export function createSettingsView(root, api, { version, displays: initialDisplays, shortcuts: initialShortcuts, update: initialUpdate, onChange, pin }) {
  let settings = {};
  let shortcuts = initialShortcuts;
  let displays = initialDisplays;
  let update = initialUpdate;
  let recording = null;
  // Controls are built once and only their state changes, so switches can animate.
  const bindings = [];

  const save = async (patch) => {
    settings = await api.settings.set(patch);
    onChange(settings);
    sync();
  };

  const row = (title, hint, control, wide = false) =>
    h('div', { class: `row${wide ? ' is-wide' : ''}` },
      h('div', { class: 'row-label' }, h('strong', {}, title), hint),
      control);

  const hintEl = (text = '') => h('span', {}, text);
  const group = (title) => h('div', { class: 'settings-group' }, title);

  const toggle = (key, label) => {
    const el = h('button', {
      class: 'switch',
      type: 'button',
      role: 'switch',
      'aria-label': label,
      onClick: () => save({ [key]: !settings[key] }),
    });
    bindings.push(() => el.setAttribute('aria-checked', String(Boolean(settings[key]))));
    return el;
  };

  const radio = (key, value, props, ...children) => {
    const el = h('button', { type: 'button', role: 'radio', onClick: () => save({ [key]: value }), ...props }, ...children);
    bindings.push(() => el.setAttribute('aria-checked', String(settings[key] === value)));
    return el;
  };

  const seg = (key, label, options) =>
    h('div', { class: 'seg', role: 'radiogroup', 'aria-label': label }, options.map(([value, text]) => radio(key, value, {}, text)));

  // ── Look ──
  const swatches = ACCENTS.map((a) => {
    const el = radio('accent', a.id, { class: 'swatch', title: t(`set.accent.${a.id}`), 'aria-label': t(`set.accent.${a.id}`) });
    el.style.setProperty('--swatch', a.color);
    return el;
  });

  // ── Behavior ──
  const openHint = hintEl();
  bindings.push(() => { openHint.textContent = t(`set.openOn.${settings.openOn}.hint`); });

  const displaySeg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': t('set.display') });
  function renderDisplays() {
    const options = [['primary', t('set.display.primary')], ['cursor', t('set.display.cursor')]];
    if (displays.length > 1) displays.forEach((d) => options.push([d.id, t('set.display.n', { n: d.n })]));
    displaySeg.replaceChildren(...options.map(([value, text]) => {
      const el = h('button', { type: 'button', role: 'radio', title: displays.find((d) => d.id === value)?.size ?? '', onClick: () => save({ display: value }) }, text);
      el.setAttribute('aria-checked', String(settings.display === value));
      return el;
    }));
  }
  bindings.push(renderDisplays);

  // ── Keyboard ──
  function keyRow(key, title) {
    const button = h('button', { class: 'key-btn', type: 'button', onClick: () => startRecording(key, button, hint) });
    const hint = hintEl();
    bindings.push(() => {
      if (recording?.key === key) return;
      const active = key === 'openShortcut' ? shortcuts.open : shortcuts.paste;
      const wanted = settings[key];
      button.classList.remove('is-recording');
      if (key === 'openShortcut' && !wanted) {
        button.textContent = active ? `${t('set.key.auto')}: ${prettyShortcut(active)}` : t('set.key.auto');
      } else {
        button.textContent = wanted ? prettyShortcut(wanted) : t('set.key.off');
      }
      const taken = Boolean(wanted || key === 'openShortcut') && !active && !shortcuts.suspended;
      hint.textContent = taken ? t('set.key.taken') : t('set.key.hint');
      hint.classList.toggle('is-warning', taken);
    });
    return row(title, hint, button, true);
  }

  function startRecording(key, button, hint) {
    if (recording) stopRecording();
    pin();
    recording = { key, button };
    api.shortcuts.suspend(true);
    button.classList.add('is-recording');
    button.textContent = t('set.key.record');
    hint.textContent = t('set.key.recordHint');
    hint.classList.remove('is-warning');
    window.addEventListener('keydown', onRecordKey, true);
    button.focus();
  }

  function stopRecording() {
    window.removeEventListener('keydown', onRecordKey, true);
    recording = null;
    api.shortcuts.suspend(false);
    sync();
  }

  function onRecordKey(event) {
    event.preventDefault();
    event.stopPropagation();
    const { key } = recording;
    if (event.key === 'Escape') {
      stopRecording();
    } else if (event.key === 'Backspace' || event.key === 'Delete') {
      stopRecording();
      save({ [key]: '' });
    } else {
      const accelerator = toAccelerator(event);
      if (!accelerator) return;
      stopRecording();
      save({ [key]: accelerator });
    }
  }

  // ── Data ──
  const calendarInput = h('input', {
    class: 'input',
    type: 'url',
    placeholder: t('set.calendar.placeholder'),
    spellcheck: false,
    onChange: (e) => {
      const value = e.target.value.trim();
      if (value === settings.calendarUrl) return;
      e.target.classList.toggle('is-invalid', Boolean(value) && !/^(https?|webcal):\/\/\S+$/i.test(value));
      if (!e.target.classList.contains('is-invalid')) save({ calendarUrl: value });
    },
    onKeydown: (e) => { if (e.key === 'Enter') e.target.blur(); },
  });
  bindings.push(() => {
    if (document.activeElement !== calendarInput) calendarInput.value = settings.calendarUrl ?? '';
  });

  // ── App ──
  const updateText = hintEl();
  const updateBtn = h('button', { class: 'btn btn-plain', type: 'button', onClick: onUpdateClick });
  function renderUpdate() {
    const s = update.state;
    const texts = {
      unsupported: t('set.update.unsupported'),
      checking: t('set.update.checking'),
      latest: t('set.update.latest'),
      downloading: t('set.update.downloading', { percent: update.percent ?? 0 }),
      ready: t('set.update.ready', { version: update.version }),
      error: t('set.update.error'),
      idle: t('set.version', { version }),
    };
    updateText.textContent = texts[s] ?? texts.idle;
    updateText.classList.toggle('is-warning', s === 'error');
    updateBtn.hidden = s === 'unsupported' || s === 'checking' || s === 'downloading';
    updateBtn.textContent = s === 'ready' ? t('set.update.restart') : t('set.update.check');
    updateBtn.classList.toggle('btn-primary', s === 'ready');
  }
  function onUpdateClick() {
    if (update.state === 'ready') api.updates.install();
    else api.updates.check();
  }
  bindings.push(renderUpdate);

  root.append(h('div', { class: 'settings scroll' },
    group(t('set.group.look')),
    row(t('set.accent'), null, h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': t('set.accent') }, swatches)),
    row(t('set.language'), null, seg('language', t('set.language'), LANGUAGES.map((l) => [l.id, l.label()]))),

    group(t('set.group.behavior')),
    row(t('set.openOn'), openHint, seg('openOn', t('set.openOn'), OPEN_MODES.map((m) => [m, t(`set.openOn.${m}`)])), true),
    row(t('set.yield'), hintEl(t('set.yield.hint')), toggle('yieldToWindows', t('set.yield'))),
    row(t('set.fullscreen'), hintEl(t('set.fullscreen.hint')), toggle('hideInFullscreen', t('set.fullscreen'))),
    row(t('set.notifications'), hintEl(t('set.notifications.hint')), toggle('notifications', t('set.notifications'))),
    row(t('set.dnd'), hintEl(t('set.dnd.hint')), toggle('dnd', t('set.dnd'))),
    row(t('set.display'), null, displaySeg, true),

    group(t('set.group.keys')),
    keyRow('openShortcut', t('set.openKey')),
    keyRow('pasteShortcut', t('set.pasteKey')),

    group(t('set.group.data')),
    row(t('set.history'), hintEl(t('set.history.hint')),
      seg('clipboardLimit', t('set.history'), LIMITS.map((n) => [n, String(n)]))),
    row(t('set.launch'), hintEl(t('set.launch.hint')), toggle('launchAtLogin', t('set.launch'))),
    row(t('set.calendar'), hintEl(t('set.calendar.hint')), calendarInput, true),

    group(t('set.group.app')),
    row(t('set.updates'), updateText, updateBtn, true),
  ));

  function sync() {
    bindings.forEach((bind) => bind());
  }

  api.settings.onChange((next) => {
    settings = next;
    onChange(settings);
    sync();
  });
  api.shortcuts.onChange((status) => {
    shortcuts = status;
    sync();
  });
  api.displays.onChange((list) => {
    displays = list;
    sync();
  });
  api.updates.onStatus((status) => {
    update = status;
    sync();
  });

  return {
    update(next) {
      settings = next;
      sync();
    },
    setVisible(value) {
      if (!value && recording) stopRecording();
    },
    isEditing: () => Boolean(recording),
  };
}
