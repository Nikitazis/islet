'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// The timer lives in the renderer and keeps its state in localStorage.
globalThis.localStorage = {
  data: new Map(),
  getItem(key) { return this.data.get(key) ?? null; },
  setItem(key, value) { this.data.set(key, String(value)); },
};

async function freshTimer(events = []) {
  localStorage.data.clear();
  const { createTimer } = await import('../src/renderer/lib/timer.js');
  const timer = createTimer({ onChange: () => {}, onFinish: (e) => events.push(e) });
  return timer;
}

test('countdown: start, pause, add a minute, reset', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setInterval'] });
  const timer = await freshTimer();
  timer.start(5 * 60_000);
  t.mock.timers.tick(60_000);
  assert.equal(Math.round(timer.snapshot().remaining / 1000), 240);
  timer.pause();
  t.mock.timers.tick(30_000);
  assert.equal(Math.round(timer.snapshot().remaining / 1000), 240, 'paused time does not run');
  timer.addMinute();
  assert.equal(Math.round(timer.snapshot().remaining / 1000), 300);
  timer.resume();
  timer.reset();
  assert.equal(timer.snapshot().status, 'idle');
});

test('countdown finishes once', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setInterval'] });
  const events = [];
  const timer = await freshTimer(events);
  timer.start(60_000);
  t.mock.timers.tick(61_000);
  assert.equal(timer.snapshot().status, 'done');
  assert.equal(events.length, 1);
  assert.equal(events[0].mode, 'timer');
});

test('pomodoro goes focus → break → focus and a long break after four rounds', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setInterval'] });
  const events = [];
  const timer = await freshTimer(events);
  timer.setMode('pomodoro');
  timer.start();
  const phases = [];
  for (let i = 0; i < 8; i++) {
    timer.skip();
    phases.push(`${timer.snapshot().phase}${timer.snapshot().round}`);
  }
  assert.deepEqual(phases, ['short1', 'focus2', 'short2', 'focus3', 'short3', 'focus4', 'long4', 'focus1']);
  assert.equal(events.at(-1).phase, 'focus');
});
