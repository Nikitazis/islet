import { h, iconEl } from '../lib/dom.js';
import { clockTime, dayMonth, monthYear, weekdayNames } from '../lib/format.js';
import { locale, t } from '../lib/i18n.js';

const DAY = 86_400_000;

const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const dayKey = (date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
const isoDate = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/** Monday-first 6×7 grid of dates around a month. */
function monthGrid(month) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, i) => new Date(first.getFullYear(), first.getMonth(), 1 - offset + i));
}

export function createCalendarView(root, api, hooks) {
  let month = startOfDay(new Date());
  month.setDate(1);
  let selected = startOfDay(new Date());
  let byDay = new Map();
  let feed = { ok: true, connected: false };
  let visible = false;
  let adding = false;

  // ── Month ──
  const title = h('strong', { class: 'cal-title' });
  const prev = h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('cal.prevMonth'), onClick: () => shiftMonth(-1) }, iconEl('chevronLeft'));
  const next = h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('cal.nextMonth'), onClick: () => shiftMonth(1) }, iconEl('chevronRight'));
  const grid = h('div', { class: 'cal-grid', role: 'grid' });
  const monthBox = h('div', { class: 'cal-month' },
    h('div', { class: 'cal-head' }, title, h('span', { class: 'spacer' }), prev, next),
    h('div', { class: 'cal-weekdays', 'aria-hidden': 'true' }, weekdayNames().map((d) => h('span', {}, d))),
    grid);

  // ── Day ──
  const dayTitle = h('strong', { class: 'agenda-title' });
  const list = h('div', { class: 'agenda-list scroll' });
  const hint = h('p', { class: 'agenda-hint' });
  const titleInput = h('input', { class: 'input', placeholder: t('cal.eventTitle'), maxLength: 120 });
  const timeInput = h('input', { class: 'input agenda-time', type: 'time', 'aria-label': t('cal.eventTime') });
  const form = h('form', { class: 'agenda-form', onSubmit: submit },
    titleInput, timeInput,
    h('button', { class: 'btn btn-ghost', type: 'button', onClick: () => setAdding(false) }, t('cal.cancel')),
    h('button', { class: 'btn btn-primary', type: 'submit' }, t('cal.save')));
  const addBtn = h('button', { class: 'btn btn-plain agenda-add', type: 'button', onClick: () => setAdding(true) },
    iconEl('plus'), t('cal.addEvent'));
  const agenda = h('div', { class: 'cal-agenda' }, h('div', { class: 'agenda-head' }, dayTitle), list, hint, addBtn, form);

  root.append(h('div', { class: 'calendar' }, monthBox, agenda));

  // ── Data ──
  async function load() {
    const days = monthGrid(month);
    const from = days[0].getTime();
    const to = days[41].getTime() + DAY;
    const result = await api.calendar.range(from, to);
    feed = result.feed;
    byDay = new Map();
    for (const item of result.items) {
      // Multi-day events appear on each day they cover.
      for (let d = startOfDay(new Date(Math.max(item.start, from))); d.getTime() < Math.min(Math.max(item.end, item.start + 1), to); d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
        const key = dayKey(d);
        if (!byDay.has(key)) byDay.set(key, []);
        byDay.get(key).push(item);
      }
    }
    render();
  }

  function shiftMonth(delta) {
    month = new Date(month.getFullYear(), month.getMonth() + delta, 1);
    load();
  }

  function select(date) {
    selected = startOfDay(date);
    if (date.getMonth() !== month.getMonth()) {
      month = new Date(date.getFullYear(), date.getMonth(), 1);
      load();
    } else {
      render();
    }
  }

  function setAdding(value) {
    adding = value;
    form.hidden = !adding;
    addBtn.hidden = adding;
    if (adding) {
      form.reset();
      hooks.pin();
      setTimeout(() => titleInput.focus(), 60);
    }
  }

  async function submit(event) {
    event.preventDefault();
    const created = await api.calendar.add({ title: titleInput.value, date: isoDate(selected), time: timeInput.value });
    if (created) setAdding(false);
    else titleInput.focus();
  }

  // ── Render ──
  function dayLabel(date) {
    const today = startOfDay(new Date());
    const diff = Math.round((date - today) / DAY);
    const base = dayMonth(date);
    if (diff === 0) return `${t('cal.today')}, ${base}`;
    if (diff === 1) return `${t('cal.tomorrow')}, ${base}`;
    const weekday = new Intl.DateTimeFormat(locale(), { weekday: 'long' }).format(date);
    return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)}, ${base}`;
  }

  function render() {
    title.textContent = monthYear(month);
    const todayKey = dayKey(new Date());
    const selectedKey = dayKey(selected);
    grid.replaceChildren(...monthGrid(month).map((date) => {
      const key = dayKey(date);
      return h('button', {
        class: [
          'cal-day',
          date.getMonth() !== month.getMonth() && 'is-other',
          key === todayKey && 'is-today',
          key === selectedKey && 'is-selected',
          byDay.has(key) && 'has-events',
        ].filter(Boolean).join(' '),
        type: 'button',
        'aria-label': dayMonth(date),
        onClick: () => select(date),
      }, String(date.getDate()));
    }));

    dayTitle.textContent = dayLabel(selected);
    const items = byDay.get(selectedKey) ?? [];
    list.replaceChildren(...items.map((item) => h('div', { class: `agenda-item is-${item.source}` },
      h('span', { class: 'agenda-when' }, item.allDay ? t('cal.allDay') : clockTime(new Date(item.start))),
      h('span', { class: 'agenda-what' }, item.title),
      item.source === 'local' && h('button', {
        class: 'icon-btn agenda-remove', type: 'button', 'aria-label': t('cal.delete'), title: t('cal.delete'),
        onClick: () => api.calendar.remove(item.id),
      }, iconEl('close')))));
    if (!items.length) list.replaceChildren(h('p', { class: 'agenda-empty' }, t('cal.noEvents')));

    if (!feed.ok) hint.textContent = t('cal.feedError');
    else if (!feed.connected && !items.length) hint.textContent = t('cal.connectHint');
    else hint.textContent = '';
    hint.hidden = !hint.textContent;
  }

  api.calendar.onChange(() => { if (visible) load(); });
  setAdding(false);

  return {
    setVisible(value) {
      visible = value;
      if (value) load();
      else if (adding) setAdding(false);
    },
    isEditing: () => adding,
    cancelEdit: () => setAdding(false),
  };
}
