const timeFormat = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' });
const dateFormat = new Intl.DateTimeFormat('ru-RU', { weekday: 'short', day: 'numeric', month: 'short' });
const dayFormat = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' });
const numberFormat = new Intl.NumberFormat('ru-RU');

const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export const clockTime = (date) => timeFormat.format(date);
export const clockDate = (date) => capitalize(dateFormat.format(date));
export const formatNumber = (n) => numberFormat.format(n);

export function plural(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export function timeAgo(timestamp, now = Date.now()) {
  const seconds = (now - timestamp) / 1000;
  if (seconds < 45) return 'только что';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ч назад`;
  const date = new Date(timestamp);
  const yesterday = new Date(now - 86_400_000);
  if (date.toDateString() === yesterday.toDateString()) return 'вчера';
  return dayFormat.format(date);
}

export function duration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}
