import { h, iconEl } from '../lib/dom.js';
import { duration, minutesLabel } from '../lib/format.js';
import { t } from '../lib/i18n.js';
import { POMODORO } from '../lib/timer.js';

const PRESETS = [1, 3, 5, 10, 15, 25, 45, 60];
const RADIUS = 74;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const SVG_NS = 'http://www.w3.org/2000/svg';

function svg(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

/** The label under the digits: what is being timed. */
export function timerCaption(s) {
  if (s.status === 'done') return t('timer.done');
  if (s.mode === 'pomodoro') {
    const phase = { focus: t('timer.focus'), short: t('timer.shortBreak'), long: t('timer.longBreak') }[s.phase];
    return s.status === 'paused' ? t('timer.paused') : `${phase}, ${t('timer.round', { round: s.round, total: POMODORO.rounds })}`;
  }
  return s.status === 'paused' ? t('timer.paused') : t('timer.for', { duration: minutesLabel(Math.round(s.duration / 60_000)) });
}

export function createTimerView(root, timer) {
  // ── Ring ──
  const progress = svg('circle', { class: 'ring-progress', cx: 90, cy: 90, r: RADIUS, 'stroke-dasharray': CIRCUMFERENCE });
  const ring = svg('svg', { class: 'ring', viewBox: '0 0 180 180', 'aria-hidden': 'true' });
  ring.append(svg('circle', { class: 'ring-track', cx: 90, cy: 90, r: RADIUS }), progress);
  const digits = h('div', { class: 'timer-digits' });
  const caption = h('div', { class: 'timer-caption' });
  const face = h('div', { class: 'timer-face' }, ring, h('div', { class: 'timer-readout' }, digits, caption));

  // ── Controls ──
  const modeButtons = ['timer', 'pomodoro'].map((mode) => h('button', {
    type: 'button',
    role: 'radio',
    onClick: () => timer.setMode(mode),
  }, t(`timer.mode.${mode}`)));
  const modes = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': t('tabs.timer') }, modeButtons);

  const presets = h('div', { class: 'timer-presets' }, PRESETS.map((min) => h('button', {
    class: 'chip',
    type: 'button',
    onClick: () => timer.start(min * 60_000),
  }, t('timer.minutes', { count: min }))));

  const dots = h('div', { class: 'pomo-dots', 'aria-hidden': 'true' },
    Array.from({ length: POMODORO.rounds }, () => h('i')));
  const pomodoro = h('div', { class: 'timer-pomodoro' }, dots, h('p', {}, t('timer.pomodoroHint')));

  const mainBtn = h('button', { class: 'btn btn-primary timer-main', type: 'button', onClick: () => timer.toggle() });
  const addBtn = h('button', { class: 'btn btn-plain', type: 'button', onClick: () => timer.addMinute() }, t('timer.addMinute'));
  const skipBtn = h('button', {
    class: 'icon-btn', type: 'button', title: t('timer.skip'), 'aria-label': t('timer.skip'), onClick: () => timer.skip(),
  }, iconEl('skip'));
  const resetBtn = h('button', {
    class: 'icon-btn', type: 'button', title: t('timer.reset'), 'aria-label': t('timer.reset'), onClick: () => timer.reset(),
  }, iconEl('reset'));

  root.append(h('div', { class: 'timer' },
    face,
    h('div', { class: 'timer-side' }, modes, presets, pomodoro,
      h('div', { class: 'timer-actions' }, mainBtn, addBtn, h('span', { class: 'spacer' }), skipBtn, resetBtn)),
  ));

  function update(s) {
    root.dataset.status = s.status;
    root.dataset.mode = s.mode;
    digits.textContent = duration(s.status === 'idle' ? s.duration : s.remaining + 999);
    caption.textContent = timerCaption(s);
    progress.style.strokeDashoffset = String(CIRCUMFERENCE * (s.status === 'idle' ? 0 : Math.min(1, s.progress)));

    modeButtons.forEach((b, i) => b.setAttribute('aria-checked', String(['timer', 'pomodoro'][i] === s.mode)));
    presets.hidden = s.mode !== 'timer';
    pomodoro.hidden = s.mode !== 'pomodoro';
    [...dots.children].forEach((dot, i) => {
      dot.classList.toggle('is-done', i < s.round - 1 || (i === s.round - 1 && s.phase !== 'focus'));
      dot.classList.toggle('is-current', i === s.round - 1 && s.phase === 'focus' && s.status !== 'idle');
    });

    const label = s.status === 'running' ? t('timer.pause') : s.status === 'paused' ? t('timer.resume') : t('timer.start');
    mainBtn.replaceChildren(iconEl(s.status === 'running' ? 'pause' : 'play'), label);
    addBtn.disabled = s.status === 'idle' || s.status === 'done';
    skipBtn.hidden = s.mode !== 'pomodoro';
    skipBtn.disabled = s.status === 'idle';
    resetBtn.disabled = s.status === 'idle';
  }

  return { update };
}
