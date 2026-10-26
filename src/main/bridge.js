'use strict';

const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const readline = require('node:readline');
const fs = require('node:fs');

const MAX_THUMBS = 24;
const ACK_TIMEOUT_MS = 3000;
const MEDIA_COMMANDS = ['toggle', 'play', 'pause', 'next', 'prev', 'seek'];

/**
 * Talks to win-bridge.ps1: media sessions (Spotify, browsers, players — everything
 * in the Windows volume flyout), master volume, and file lists for the clipboard.
 *
 * The script text is passed with -Command instead of -File: PowerShell's
 * execution policy applies to script files, so this works on a default
 * Windows install without asking the user to change any policy.
 */
class WinBridge extends EventEmitter {
  constructor(scriptPath) {
    super();
    this.scriptPath = scriptPath;
    this.state = { current: -1, sessions: [] };
    this.volume = { supported: false, level: 0, muted: false };
    this.thumbs = new Map();
    this.pending = new Map();
    this.nextId = 1;
    this.proc = null;
    this.stopped = false;
    this.failures = 0;
  }

  start() {
    if (process.platform !== 'win32' || this.proc) return;
    this.stopped = false;
    const script = fs.readFileSync(this.scriptPath, 'utf8');
    const proc = spawn(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }
    );
    this.proc = proc;
    const startedAt = Date.now();

    readline.createInterface({ input: proc.stdout }).on('line', (line) => this.handleLine(line));
    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', (chunk) => console.warn('[bridge]', chunk.trim()));
    proc.stdin.on('error', () => {});

    proc.on('exit', (code) => {
      this.proc = null;
      for (const resolve of this.pending.values()) resolve(false);
      this.pending.clear();
      if (this.stopped) return;
      this.setState({ current: -1, sessions: [] });
      // Back off if the bridge keeps dying right after start.
      this.failures = Date.now() - startedAt < 10_000 ? this.failures + 1 : 0;
      const delay = Math.min(30_000, 1000 * 2 ** this.failures);
      console.warn(`[bridge] exited (${code}), restarting in ${delay} ms`);
      this.restartTimer = setTimeout(() => this.start(), delay);
    });
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.restartTimer);
    if (this.proc) {
      this.proc.stdin.end();
      const proc = this.proc;
      setTimeout(() => proc.exitCode === null && proc.kill(), 1500);
      this.proc = null;
    }
  }

  handleLine(line) {
    let msg;
    try {
      msg = JSON.parse(line.replace(/^﻿/, ''));
    } catch {
      return;
    }
    switch (msg.type) {
      case 'state':
        this.setState({ current: msg.current, sessions: [].concat(msg.sessions || []) });
        break;
      case 'thumb':
        this.thumbs.delete(msg.key);
        this.thumbs.set(msg.key, msg.data);
        if (this.thumbs.size > MAX_THUMBS) this.thumbs.delete(this.thumbs.keys().next().value);
        this.emit('thumb', msg.key);
        break;
      case 'volume':
        this.volume = { supported: Boolean(msg.supported), level: Number(msg.level) || 0, muted: Boolean(msg.muted) };
        this.emit('volume', this.volume);
        break;
      case 'ack':
        this.pending.get(msg.id)?.(Boolean(msg.ok));
        this.pending.delete(msg.id);
        break;
      case 'error':
        console.warn('[bridge]', msg.message);
        break;
    }
  }

  setState(state) {
    this.state = state;
    this.emit('state', state);
  }

  getThumb(key) {
    return this.thumbs.get(key) ?? null;
  }

  write(payload) {
    if (!this.proc) return false;
    this.proc.stdin.write(JSON.stringify(payload) + '\n');
    return true;
  }

  /** Sends a command and resolves when the bridge has carried it out. */
  request(payload) {
    const id = this.nextId++;
    return new Promise((resolve) => {
      if (!this.write({ ...payload, id })) return resolve(false);
      this.pending.set(id, resolve);
      setTimeout(() => {
        if (this.pending.delete(id)) resolve(false);
      }, ACK_TIMEOUT_MS);
    });
  }

  media(cmd) {
    if (!cmd || !MEDIA_COMMANDS.includes(cmd.cmd)) return;
    this.write({
      cmd: cmd.cmd,
      app: String(cmd.app ?? ''),
      index: Number.isInteger(cmd.index) ? cmd.index : -1,
      position: Math.max(0, Number(cmd.position) || 0),
    });
  }

  setVolume({ value, delta }) {
    if (Number.isFinite(delta)) this.write({ cmd: 'volume', delta: Math.max(-1, Math.min(1, delta)) });
    else if (Number.isFinite(value)) this.write({ cmd: 'volume', value: Math.max(0, Math.min(1, value)) });
  }

  setMuted(muted) {
    this.write({ cmd: 'mute', muted: typeof muted === 'boolean' ? muted : null });
  }

  copyFiles(paths) {
    return this.request({ cmd: 'copyFiles', paths: paths.map(String) });
  }
}

module.exports = { WinBridge };
