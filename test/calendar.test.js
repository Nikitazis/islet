'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseIcs, occurrences } = require('../src/main/calendar.js');

const ics = [
  'BEGIN:VCALENDAR',
  'BEGIN:VEVENT',
  'UID:weekly',
  'SUMMARY:Планёрка\\, команда',
  'DTSTART;TZID=Europe/Moscow:20261005T100000',
  'DTEND;TZID=Europe/Moscow:20261005T103000',
  'RRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261031T000000Z',
  'EXDATE;TZID=Europe/Moscow:20261014T100000',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:weekly',
  'RECURRENCE-ID;TZID=Europe/Moscow:20261019T100000',
  'SUMMARY:Планёрка (перенос)',
  'DTSTART;TZID=Europe/Moscow:20261019T120000',
  'DTEND;TZID=Europe/Moscow:20261019T123000',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:lastfri',
  'SUMMARY:Отчёт',
  'DTSTART:20260130T150000Z',
  'DURATION:PT1H',
  'RRULE:FREQ=MONTHLY;BYDAY=-1FR',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:allday',
  'SUMMARY:День рождения',
  'DTSTART;VALUE=DATE:20261026',
  'DTEND;VALUE=DATE:20261027',
  'RRULE:FREQ=YEARLY',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:count',
  'SUMMARY:Курс',
  'DTSTART:20261001T090000Z',
  'RRULE:FREQ=DAILY;INTERVAL=2;COUNT=3',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:cancelled',
  'STATUS:CANCELLED',
  'SUMMARY:Отменено',
  'DTSTART:20261002T090000Z',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

const events = parseIcs(ics);
const byUid = (uid) => events.filter((e) => e.uid === uid);
const iso = (time) => new Date(time).toISOString();
const OCTOBER = [Date.UTC(2026, 9, 1), Date.UTC(2026, 11, 1)];

test('weekly series: time zone, excluded and moved instances', () => {
  const series = byUid('weekly').find((e) => e.rule);
  assert.equal(series.title, 'Планёрка, команда');
  const starts = occurrences(series, ...OCTOBER).map(iso);
  assert.equal(starts[0], '2026-10-05T07:00:00.000Z', '10:00 in Moscow is 07:00 UTC');
  assert.ok(!starts.includes('2026-10-14T07:00:00.000Z'), 'EXDATE is skipped');
  assert.ok(!starts.includes('2026-10-19T07:00:00.000Z'), 'the moved instance leaves the series');
  assert.equal(starts.length, 6);
  const moved = byUid('weekly').find((e) => !e.rule);
  assert.equal(iso(moved.start), '2026-10-19T09:00:00.000Z');
});

test('monthly on the last Friday', () => {
  const days = occurrences(byUid('lastfri')[0], ...OCTOBER).map((t) => iso(t).slice(0, 10));
  assert.deepEqual(days, ['2026-10-30', '2026-11-27']);
});

test('yearly all-day event', () => {
  const [start] = occurrences(byUid('allday')[0], Date.UTC(2027, 9, 1), Date.UTC(2027, 10, 1));
  assert.equal(new Date(start).getDate(), 26);
  assert.equal(byUid('allday')[0].allDay, true);
});

test('COUNT with INTERVAL', () => {
  const starts = occurrences(byUid('count')[0], ...OCTOBER).map(iso);
  assert.deepEqual(starts, ['2026-10-01T09:00:00.000Z', '2026-10-03T09:00:00.000Z', '2026-10-05T09:00:00.000Z']);
});

test('cancelled events are dropped', () => {
  assert.equal(byUid('cancelled').length, 0);
});
