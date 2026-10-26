import { locale, t } from './i18n.js';

const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const fmt = (options) => new Intl.DateTimeFormat(locale(), options);

export const clockTime = (date) => fmt({ hour: '2-digit', minute: '2-digit' }).format(date);
export const clockDate = (date) => capitalize(fmt({ weekday: 'short', day: 'numeric', month: 'short' }).format(date));
export const dayMonth = (date) => fmt({ day: 'numeric', month: 'long' }).format(date);
export const monthYear = (date) => capitalize(fmt({ month: 'long', year: 'numeric' }).format(date));
export const formatNumber = (n) => new Intl.NumberFormat(locale()).format(n);

/** Short weekday names starting from Monday. */
export function weekdayNames() {
  const monday = new Date(2024, 0, 1);
  return Array.from({ length: 7 }, (_, i) =>
    capitalize(fmt({ weekday: 'short' }).format(new Date(monday.getTime() + i * 86_400_000))));
}

export function timeAgo(timestamp, now = Date.now()) {
  const seconds = (now - timestamp) / 1000;
  if (seconds < 45) return t('time.justNow');
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return t('time.minutesAgo', { count: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t('time.hoursAgo', { count: hours });
  const date = new Date(timestamp);
  const yesterday = new Date(now - 86_400_000);
  if (date.toDateString() === yesterday.toDateString()) return t('time.yesterday');
  return fmt({ day: 'numeric', month: 'short' }).format(date);
}

/** 3:07, 1:02:45 */
export function duration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** "5 мин", "1 ч 30 мин" */
export function minutesLabel(totalMinutes) {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return [h && t('timer.hours', { count: h }), (m || !h) && t('timer.minutes', { count: m })].filter(Boolean).join(' ');
}

/** 1.4 ГБ, 512 КБ */
export function bytes(value) {
  const units = t('sys.units');
  let n = Math.max(0, value);
  let unit = 0;
  while (n >= 1024 && unit < units.length - 1) {
    n /= 1024;
    unit += 1;
  }
  const digits = n >= 100 || unit === 0 ? 0 : 1;
  return `${new Intl.NumberFormat(locale(), { maximumFractionDigits: digits }).format(n)} ${units[unit]}`;
}
