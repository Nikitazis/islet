'use strict';

const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const readline = require('node:readline');
const fs = require('node:fs');

const MAX_THUMBS = 24;

/**
 * Talks to media-bridge.ps1, which reads the Windows media sessions
 * (Spotify, browsers, players - everything that shows up in the volume flyout).
 *
 * The script text is passed with -Command instead of -File: PowerShell's
 * execution policy applies to script files, so this works on a default
 * Windows install without asking the user to change any policy.
 */
class MediaBridge extends EventEmitter {
  constructor(scriptPath) {
    super();
    this.scriptPath = scriptPath;
    this.state = { current: -1, sessions: [] };
    this.thumbs = new Map();
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
    proc.stderr.on('data', (chunk) => console.warn('[media]', chunk.trim()));
    proc.stdin.on('error', () => {});

    proc.on('exit', (code) => {
      this.proc = null;
      if (this.stopped) return;
      this.setState({ current: -1, sessions: [] });
      // Back off if the bridge keeps dying right after start.
      this.failures = Date.now() - startedAt < 10_000 ? this.failures + 1 : 0;
      const delay = Math.min(30_000, 1000 * 2 ** this.failures);
      console.warn(`[media] bridge exited (${code}), restarting in ${delay} ms`);
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
    if (msg.type === 'state') {
      this.setState({ current: msg.current, sessions: [].concat(msg.sessions || []) });
    } else if (msg.type === 'thumb') {
      this.thumbs.delete(msg.key);
      this.thumbs.set(msg.key, msg.data);
      if (this.thumbs.size > MAX_THUMBS) this.thumbs.delete(this.thumbs.keys().next().value);
      this.emit('thumb', msg.key);
    } else if (msg.type === 'error') {
      console.warn('[media]', msg.message);
    }
  }

  setState(state) {
    this.state = state;
    this.emit('state', state);
  }

  getThumb(key) {
    return this.thumbs.get(key) ?? null;
  }

  command(cmd) {
    const allowed = ['toggle', 'play', 'pause', 'next', 'prev', 'seek'];
    if (!this.proc || !cmd || !allowed.includes(cmd.cmd)) return;
    const payload = {
      cmd: cmd.cmd,
      app: String(cmd.app ?? ''),
      index: Number.isInteger(cmd.index) ? cmd.index : -1,
      position: Math.max(0, Number(cmd.position) || 0),
    };
    this.proc.stdin.write(JSON.stringify(payload) + '\n');
  }
}

module.exports = { MediaBridge };
