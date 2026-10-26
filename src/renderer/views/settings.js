import { h } from '../lib/dom.js';

const ACCENTS = [
  { id: 'violet', label: 'Фиолетовый', color: '#bf5af2' },
  { id: 'orange', label: 'Оранжевый', color: '#ff9f0a' },
];
const LIMITS = [30, 60, 100];

export function createSettingsView(root, api, { shortcut, version, onChange }) {
  let settings = {};
  // Controls are built once and only their state attributes change, so switches can animate.
  const bindings = [];

  const save = async (patch) => {
    settings = await api.settings.set(patch);
    onChange(settings);
    sync();
  };

  const row = (title, hint, control) =>
    h('div', { class: 'row' }, h('div', { class: 'row-label' }, h('strong', {}, title), hint && h('span', {}, hint)), control);

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

  root.append(h('div', { class: 'settings' },
    row('Акцентный цвет', null, h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Акцентный цвет' }, swatches)),
    row('Раскрывать при наведении', 'Иначе — по щелчку', toggle('hoverExpand', 'Раскрывать при наведении')),
    row('Уведомления', 'Скопированное и новый трек', toggle('notifications', 'Уведомления')),
    row('Запуск с Windows', 'Шторка появится после входа', toggle('launchAtLogin', 'Запуск с Windows')),
    row('История буфера', 'Закреплённые не считаются',
      h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Сколько записей хранить' },
        LIMITS.map((n) => radio('clipboardLimit', n, {}, String(n))))),
    h('div', { class: 'settings-foot' },
      h('span', {}, 'Открыть с клавиатуры: ', h('kbd', {}, shortcut.replace('Control', 'Ctrl').replaceAll('+', ' + '))),
      h('span', {}, `Cstorka ${version}`)),
  ));

  function sync() {
    bindings.forEach((bind) => bind());
  }

  api.settings.onChange((next) => {
    settings = next;
    onChange(settings);
    sync();
  });

  return {
    update(next) {
      settings = next;
      sync();
    },
  };
}
