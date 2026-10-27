// Countdown timer and Pomodoro. Keeps working across restarts: the end time
// is stored, not the remaining seconds.

const STORAGE_KEY = 'islet.timer';
export const POMODORO = { focus: 25, short: 5, long: 15, rounds: 4 };
const DEFAULT_MS = 5 * 60_000;
const MINUTE = 60_000;

const phaseMs = (phase) => POMODORO[phase] * MINUTE;

function load() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

export function createTimer({ onChange, onFinish }) {
  let state = load() ?? {
    mode: 'timer',
    status: 'idle', // idle | running | paused | done
    duration: DEFAULT_MS,
    remaining: DEFAULT_MS,
    endsAt: 0,
    phase: 'focus',
    round: 1,
  };
  let interval = null;

  const remaining = () => (state.status === 'running' ? Math.max(0, state.endsAt - Date.now()) : state.remaining);

  function snapshot() {
    const left = remaining();
    return { ...state, remaining: left, progress: state.duration ? 1 - left / state.duration : 0 };
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Storage can be unavailable; the timer still runs for this session.
    }
  }

  function commit() {
    save();
    clearInterval(interval);
    interval = state.status === 'running' ? setInterval(tick, 250) : null;
    onChange(snapshot());
  }

  function tick() {
    if (state.status === 'running' && remaining() <= 0) finish();
    else onChange(snapshot());
  }

  function finish(skipped = false) {
    if (state.mode === 'timer') {
      state = { ...state, status: 'done', remaining: 0 };
      commit();
      onFinish({ mode: 'timer', duration: state.duration });
      return;
    }
    const finished = state.phase;
    const phase = finished === 'focus' ? (state.round >= POMODORO.rounds ? 'long' : 'short') : 'focus';
    const round = finished === 'focus' ? state.round : finished === 'long' ? 1 : state.round + 1;
    const duration = phaseMs(phase);
    state = { ...state, phase, round, duration, remaining: duration, endsAt: Date.now() + duration, status: 'running' };
    commit();
    onFinish({ mode: 'pomodoro', phase, round, minutes: POMODORO[phase], skipped });
  }

  const api = {
    snapshot,
    start(durationMs) {
      if (durationMs) state = { ...state, duration: durationMs, remaining: durationMs };
      const left = state.status === 'paused' && !durationMs ? state.remaining : state.duration;
      state = { ...state, status: 'running', endsAt: Date.now() + left };
      commit();
    },
    pause() {
      if (state.status !== 'running') return;
      state = { ...state, status: 'paused', remaining: remaining() };
      commit();
    },
    resume() {
      if (state.status !== 'paused') return;
      state = { ...state, status: 'running', endsAt: Date.now() + state.remaining };
      commit();
    },
    toggle() {
      if (state.status === 'running') api.pause();
      else if (state.status === 'paused') api.resume();
      else api.start();
    },
    addMinute() {
      if (state.status === 'running') state = { ...state, endsAt: state.endsAt + MINUTE, duration: state.duration + MINUTE };
      else if (state.status === 'paused') state = { ...state, remaining: state.remaining + MINUTE, duration: state.duration + MINUTE };
      else return;
      commit();
    },
    reset() {
      const duration = state.mode === 'pomodoro' ? phaseMs('focus') : state.duration;
      state = { ...state, status: 'idle', duration, remaining: duration, endsAt: 0, phase: 'focus', round: 1 };
      commit();
    },
    dismiss() {
      if (state.status === 'done') api.reset();
    },
    skip() {
      if (state.mode === 'pomodoro' && state.status !== 'idle') finish(true);
    },
    setMode(mode) {
      if (mode === state.mode) return;
      const duration = mode === 'pomodoro' ? phaseMs('focus') : DEFAULT_MS;
      state = { mode, status: 'idle', duration, remaining: duration, endsAt: 0, phase: 'focus', round: 1 };
      commit();
    },
    isActive: () => state.status !== 'idle',
  };

  // Ran out while the app was closed: a timer just shows that it's done,
  // a Pomodoro session starts over.
  if (state.status === 'running' && state.endsAt <= Date.now()) {
    if (state.mode === 'timer') state = { ...state, status: 'done', remaining: 0 };
    else state = { ...state, status: 'idle', duration: phaseMs('focus'), remaining: phaseMs('focus'), phase: 'focus', round: 1 };
  }
  commit();
  return api;
}
