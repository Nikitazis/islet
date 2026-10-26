import { h } from '../lib/dom.js';

const ACCENTS = [
  { id: 'violet', label: 'Фиолетовый', color: '#bf5af2' },
  { id: 'orange', label: 'Оранжевый', color: '#ff9f0a' },
];
const OPEN_MODES = [
  { id: 'hover', label: 'Сразу', hint: 'Раскрывается, как только мышь окажется на шторке' },
  { id: 'dwell', label: 'С задержкой', hint: 'Мышь нужно задержать на шторке полсекунды' },
  { id: 'edge', label: 'Край экрана', hint: 'Уприте мышь в самый верх экрана над шторкой' },
  { id: 'click', label: 'Щелчок', hint: 'Только щелчком по шторке или с клавиатуры' },
];
const LIMITS = [30, 60, 100];

const prettyShortcut = (accelerator) => accelerator.replace('Control', 'Ctrl').replaceAll('+', ' + ');

export function createSettingsView(root, api, { shortcuts, version, onChange }) {
  let settings = {};
  let shortcutStatus = shortcuts.status;
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

  const hintEl = (text) => h('span', {}, text);

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

  const swatches = ACCENTS.map((a) => {
    const el = radio('accent', a.id, { class: 'swatch', title: a.label, 'aria-label': a.label });
    el.style.setProperty('--swatch', a.color);
    return el;
  });

  const openHint = hintEl('');
  bindings.push(() => {
    openHint.textContent = OPEN_MODES.find((m) => m.id === settings.openOn)?.hint ?? '';
  });

  const pasteHint = hintEl('');
  bindings.push(() => {
    const taken = settings.quickPaste && !shortcutStatus.paste;
    pasteHint.textContent = taken ? 'Сочетание занято другой программой' : prettyShortcut(shortcuts.paste);
    pasteHint.classList.toggle('is-warning', taken);
  });

  const openKeys = h('span', {});
  bindings.push(() => {
    openKeys.replaceChildren(...(shortcutStatus.open
      ? ['Открыть с клавиатуры: ', h('kbd', {}, prettyShortcut(shortcutStatus.open))]
      : ['Сочетания для открытия заняты другими программами']));
  });

  root.append(h('div', { class: 'settings' },
    row('Как раскрывать', openHint,
      h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Как раскрывать шторку' },
        OPEN_MODES.map((m) => radio('openOn', m.id, {}, m.label))),
      true),
    row('Акцентный цвет', null, h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Акцентный цвет' }, swatches)),
    row('Уведомления', hintEl('Скопированное и новый трек'), toggle('notifications', 'Уведомления')),
    row('Прятать в полноэкранном', hintEl('Игры, видео, презентации'), toggle('hideInFullscreen', 'Прятать в полноэкранном режиме')),
    row('Запуск с Windows', hintEl('Шторка появится после входа'), toggle('launchAtLogin', 'Запуск с Windows')),
    row('История буфера', hintEl('Закреплённые не считаются'),
      h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Сколько записей хранить' },
        LIMITS.map((n) => radio('clipboardLimit', n, {}, String(n))))),
    row('Быстрая вставка', pasteHint, toggle('quickPaste', 'Быстрая вставка')),
    h('div', { class: 'settings-foot' }, openKeys, h('span', {}, `Cstorka ${version}`)),
  ));

  function sync() {
    bindings.forEach((bind) => bind());
  }

  api.settings.onChange((next) => {
    settings = next;
    onChange(settings);
    sync();
  });
  api.island.onShortcuts((status) => {
    shortcutStatus = status;
    sync();
  });

  return {
    update(next) {
      settings = next;
      sync();
    },
  };
}
