'use strict';

// Events for the "Calendar" section: the user's own quick events plus an
// optional iCal feed (the "secret address" Google Calendar and Outlook give out).
// Reminders fire five minutes before timed events.

const { net } = require('electron');
const { EventEmitter } = require('node:events');
const crypto = require('node:crypto');

const FEED_REFRESH_MS = 30 * 60_000;
const REMINDER_CHECK_MS = 30_000;
const REMIND_BEFORE_MS = 5 * 60_000;
const MAX_FEED_BYTES = 5_000_000;
const MAX_ITERATIONS = 3000;
const DAY = 86_400_000;
const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

const newId = () => crypto.randomBytes(6).toString('hex');

// ───────────── iCal parsing ─────────────

function unfold(text) {
  return text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
}

function unescapeText(value) {
  return value.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
}

/** Offset in ms of a time zone at a UTC instant, via Intl (IANA names only). */
function zoneOffset(utcMs, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) - utcMs;
}

/** 20261026, 20261026T100000, 20261026T100000Z → { time, allDay } */
function parseDate(value, params = {}) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m.map((part, i) => (i > 0 && part && part !== 'Z' ? Number(part) : part));
  if (h === undefined) return { time: new Date(y, mo - 1, d).getTime(), allDay: true };
  if (z) return { time: Date.UTC(y, mo - 1, d, h, mi, s), allDay: false };
  if (params.TZID) {
    try {
      const guess = Date.UTC(y, mo - 1, d, h, mi, s);
      const first = guess - zoneOffset(guess, params.TZID);
      return { time: guess - zoneOffset(first, params.TZID), allDay: false };
    } catch {
      // Windows zone names (Outlook) aren't IANA: fall back to local time.
    }
  }
  return { time: new Date(y, mo - 1, d, h, mi, s).getTime(), allDay: false };
}

function parseDuration(value) {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value.trim());
  if (!m) return null;
  const [, sign, w, d, h, mi, s] = m;
  const ms = ((+w || 0) * 7 * DAY) + ((+d || 0) * DAY) + ((+h || 0) * 3_600_000) + ((+mi || 0) * 60_000) + ((+s || 0) * 1000);
  return sign === '-' ? -ms : ms;
}

function parseRule(value) {
  const rule = {};
  for (const pair of value.split(';')) {
    const [key, val] = pair.split('=');
    rule[key.toUpperCase()] = val;
  }
  return {
    freq: rule.FREQ,
    interval: Math.max(1, Number(rule.INTERVAL) || 1),
    count: rule.COUNT ? Number(rule.COUNT) : null,
    until: rule.UNTIL ? parseDate(rule.UNTIL)?.time ?? null : null,
    byDay: rule.BYDAY
      ? rule.BYDAY.split(',').map((token) => {
        const dm = /^([+-]?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/.exec(token.trim());
        return dm ? { nth: dm[1] ? Number(dm[1]) : null, day: WEEKDAYS.indexOf(dm[2]) } : null;
      }).filter(Boolean)
      : null,
    byMonthDay: rule.BYMONTHDAY ? rule.BYMONTHDAY.split(',').map(Number) : null,
  };
}

function parseIcs(text) {
  const events = [];
  let current = null;
  for (const line of unfold(text)) {
    if (line === 'BEGIN:VEVENT') {
      current = { exdates: new Set() };
      continue;
    }
    if (line === 'END:VEVENT') {
      if (current?.start && current.status !== 'CANCELLED') events.push(current);
      current = null;
      continue;
    }
    if (!current) continue;
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const [name, ...paramParts] = line.slice(0, colon).split(';');
    const value = line.slice(colon + 1);
    const params = Object.fromEntries(paramParts.map((p) => p.split('=')).map(([k, v]) => [k.toUpperCase(), v?.replace(/^"|"$/g, '')]));
    switch (name.toUpperCase()) {
      case 'UID': current.uid = value; break;
      case 'SUMMARY': current.title = unescapeText(value); break;
      case 'STATUS': current.status = value.toUpperCase(); break;
      case 'DTSTART': current.start = parseDate(value, params); break;
      case 'DTEND': current.end = parseDate(value, params); break;
      case 'DURATION': current.duration = parseDuration(value); break;
      case 'RRULE': current.rule = parseRule(value); break;
      case 'EXDATE':
        for (const v of value.split(',')) {
          const date = parseDate(v, params);
          if (date) current.exdates.add(date.time);
        }
        break;
      case 'RECURRENCE-ID': current.recurrenceId = parseDate(value, params)?.time; break;
    }
  }

  // A changed instance of a series replaces that one occurrence of the series.
  const masters = new Map(events.filter((e) => e.rule && e.uid).map((e) => [e.uid, e]));
  for (const e of events) {
    if (e.recurrenceId !== undefined) masters.get(e.uid)?.exdates.add(e.recurrenceId);
  }

  return events.map((e) => {
    const start = e.start.time;
    let length = e.end ? e.end.time - start : (e.duration ?? (e.start.allDay ? DAY : 0));
    if (length < 0) length = 0;
    return { uid: e.uid ?? newId(), title: e.title || '', start, length, allDay: e.start.allDay, rule: e.rule ?? null, exdates: e.exdates };
  });
}

// ───────────── Recurrence ─────────────

const atTime = (base, y, m, d) => new Date(y, m, d, base.getHours(), base.getMinutes(), base.getSeconds()).getTime();

/** nth (1..5, or -1 for last) given weekday of a month. */
function nthWeekday(y, m, weekday, nth) {
  if (nth > 0) {
    const first = new Date(y, m, 1).getDay();
    const day = 1 + ((weekday - first + 7) % 7) + (nth - 1) * 7;
    return day <= new Date(y, m + 1, 0).getDate() ? day : null;
  }
  const lastDate = new Date(y, m + 1, 0).getDate();
  const last = new Date(y, m, lastDate).getDay();
  const day = lastDate - ((last - weekday + 7) % 7) + (nth + 1) * 7;
  return day >= 1 ? day : null;
}

/** Start times of the i-th period of a rule, in order. */
function periodStarts(base, rule, i) {
  const y = base.getFullYear();
  const m = base.getMonth();
  const d = base.getDate();
  switch (rule.freq) {
    case 'DAILY':
      return [atTime(base, y, m, d + i * rule.interval)];
    case 'WEEKLY': {
      const monday = d - ((base.getDay() + 6) % 7) + i * rule.interval * 7;
      const days = rule.byDay?.length ? rule.byDay.map((b) => b.day) : [base.getDay()];
      return days.map((wd) => atTime(base, y, m, monday + ((wd + 6) % 7))).sort((a, b) => a - b);
    }
    case 'MONTHLY': {
      const month = m + i * rule.interval;
      const yy = y + Math.floor(month / 12);
      const mm = ((month % 12) + 12) % 12;
      if (rule.byDay?.length) {
        return rule.byDay
          .map((b) => nthWeekday(yy, mm, b.day, b.nth ?? 1))
          .filter(Boolean)
          .map((day) => atTime(base, yy, mm, day))
          .sort((a, b) => a - b);
      }
      const days = rule.byMonthDay ?? [d];
      const length = new Date(yy, mm + 1, 0).getDate();
      return days.map((day) => (day < 0 ? length + day + 1 : day)).filter((day) => day >= 1 && day <= length)
        .map((day) => atTime(base, yy, mm, day)).sort((a, b) => a - b);
    }
    case 'YEARLY': {
      const yy = y + i * rule.interval;
      return new Date(yy, m + 1, 0).getDate() >= d ? [atTime(base, yy, m, d)] : [];
    }
    default:
      return [];
  }
}

/** Occurrence start times of an event that overlap [from, to). */
function occurrences(event, from, to) {
  if (!event.rule) return event.start < to && event.start + Math.max(event.length, 1) > from ? [event.start] : [];
  const result = [];
  const base = new Date(event.start);
  let produced = 0;
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    for (const start of periodStarts(base, event.rule, i)) {
      if (start < event.start) continue;
      if (event.rule.until !== null && start > event.rule.until) return result;
      produced += 1;
      if (event.rule.count !== null && produced > event.rule.count) return result;
      if (start >= to) return result;
      if (start + Math.max(event.length, 1) > from && !event.exdates.has(start)) result.push(start);
    }
  }
  return result;
}

// ───────────── Calendar ─────────────

class Calendar extends EventEmitter {
  constructor(store) {
    super();
    this.store = store;
    this.feed = [];
    this.feedStatus = { ok: true, updatedAt: null };
    this.reminded = new Set();
    this.refreshTimer = null;
    this.reminderTimer = null;
  }

  start() {
    this.refreshFeed();
    this.refreshTimer = setInterval(() => this.refreshFeed(), FEED_REFRESH_MS);
    this.reminderTimer = setInterval(() => this.checkReminders(), REMINDER_CHECK_MS);
  }

  stop() {
    clearInterval(this.refreshTimer);
    clearInterval(this.reminderTimer);
  }

  get localEvents() {
    return this.store.get('events');
  }

  async refreshFeed() {
    const url = this.store.get('settings').calendarUrl.replace(/^webcal:/i, 'https:');
    if (!url) {
      this.feed = [];
      this.feedStatus = { ok: true, updatedAt: null, connected: false };
      this.emit('change');
      return;
    }
    try {
      const res = await net.fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (text.length > MAX_FEED_BYTES || !text.includes('BEGIN:VCALENDAR')) throw new Error('not an iCal feed');
      this.feed = parseIcs(text);
      this.feedStatus = { ok: true, updatedAt: Date.now(), connected: true };
    } catch (err) {
      console.warn('[calendar]', err.message);
      this.feedStatus = { ok: false, updatedAt: this.feedStatus.updatedAt, connected: true };
    }
    this.emit('change');
  }

  /** Every occurrence overlapping [from, to), sorted, with all-day events first in a day. */
  range(from, to) {
    const items = [];
    for (const e of this.localEvents) {
      if (e.start < to && e.start + (e.allDay ? DAY : 1) > from) {
        items.push({ id: e.id, title: e.title, start: e.start, end: e.start + (e.allDay ? DAY : 0), allDay: e.allDay, source: 'local' });
      }
    }
    for (const e of this.feed) {
      for (const start of occurrences(e, from, to)) {
        items.push({ id: `${e.uid}@${start}`, title: e.title, start, end: start + e.length, allDay: e.allDay, source: 'feed' });
      }
    }
    items.sort((a, b) => a.start - b.start || Number(b.allDay) - Number(a.allDay));
    return { items, feed: this.feedStatus };
  }

  add({ title, date, time }) {
    const clean = String(title ?? '').trim().slice(0, 120);
    const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date ?? ''));
    if (!clean || !dm) return null;
    const tm = /^(\d{1,2}):(\d{2})$/.exec(String(time ?? ''));
    const start = new Date(+dm[1], +dm[2] - 1, +dm[3], tm ? +tm[1] : 0, tm ? +tm[2] : 0).getTime();
    const event = { id: newId(), title: clean, start, allDay: !tm };
    this.store.set('events', [...this.localEvents, event].sort((a, b) => a.start - b.start));
    this.emit('change');
    return event;
  }

  remove(id) {
    this.store.set('events', this.localEvents.filter((e) => e.id !== id));
    this.emit('change');
  }

  /** Drops the user's own events that ended more than a month ago. */
  prune() {
    const cutoff = Date.now() - 31 * DAY;
    const kept = this.localEvents.filter((e) => e.start >= cutoff);
    if (kept.length !== this.localEvents.length) this.store.set('events', kept);
  }

  checkReminders() {
    const now = Date.now();
    const { items } = this.range(now, now + REMIND_BEFORE_MS + REMINDER_CHECK_MS);
    for (const item of items) {
      if (item.allDay || item.start < now || item.start - now > REMIND_BEFORE_MS) continue;
      const key = `${item.id}@${item.start}`;
      if (this.reminded.has(key)) continue;
      this.reminded.add(key);
      this.emit('reminder', { title: item.title, start: item.start, minutes: Math.max(0, Math.round((item.start - now) / 60_000)) });
    }
  }
}

module.exports = { Calendar, parseIcs, occurrences };
