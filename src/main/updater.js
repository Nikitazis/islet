'use strict';

// Updates from GitHub Releases. Only the installed (NSIS) build can update itself;
// the portable .exe and development runs report "unsupported".

const { app } = require('electron');
const { EventEmitter } = require('node:events');

const FIRST_CHECK_MS = 15_000;
const CHECK_EVERY_MS = 6 * 3_600_000;

class Updater extends EventEmitter {
  constructor() {
    super();
    this.status = { state: 'idle' };
    this.supported = app.isPackaged && !process.env.PORTABLE_EXECUTABLE_DIR;
    if (!this.supported) {
      this.status = { state: 'unsupported' };
      return;
    }
    const { autoUpdater } = require('electron-updater');
    this.autoUpdater = autoUpdater;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.logger = null;
    autoUpdater.on('checking-for-update', () => this.set({ state: 'checking' }));
    autoUpdater.on('update-not-available', () => this.set({ state: 'latest' }));
    autoUpdater.on('update-available', (info) => this.set({ state: 'downloading', version: info.version, percent: 0 }));
    autoUpdater.on('download-progress', (p) => this.set({ ...this.status, state: 'downloading', percent: Math.round(p.percent) }));
    autoUpdater.on('update-downloaded', (info) => this.set({ state: 'ready', version: info.version }));
    autoUpdater.on('error', (err) => {
      console.warn('[updater]', err.message);
      this.set({ state: 'error' });
    });
  }

  start() {
    if (!this.supported) return;
    setTimeout(() => this.check(), FIRST_CHECK_MS);
    setInterval(() => this.check(), CHECK_EVERY_MS);
  }

  set(status) {
    this.status = status;
    this.emit('status', status);
  }

  async check() {
    if (!this.supported || this.status.state === 'downloading' || this.status.state === 'ready') return this.status;
    try {
      await this.autoUpdater.checkForUpdates();
    } catch {
      // Reported through the 'error' event.
    }
    return this.status;
  }

  install() {
    if (this.status.state === 'ready') this.autoUpdater.quitAndInstall();
  }
}

module.exports = { Updater };
