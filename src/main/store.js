'use strict';

const fs = require('node:fs');
const path = require('node:path');

/** Small JSON store: synchronous reads, debounced atomic writes. */
class Store {
  constructor(file, defaults) {
    this.file = file;
    this.defaults = defaults;
    this.data = structuredClone(defaults);
    this.saveTimer = null;

    try {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const key of Object.keys(defaults)) {
        if (saved[key] === undefined) continue;
        const isObject = defaults[key] && typeof defaults[key] === 'object' && !Array.isArray(defaults[key]);
        this.data[key] = isObject ? { ...defaults[key], ...saved[key] } : saved[key];
      }
    } catch (err) {
      if (err.code !== 'ENOENT') console.warn('[store] could not read', file, err.message);
    }
  }

  get(key) {
    return this.data[key];
  }

  set(key, value) {
    this.data[key] = value;
    this.scheduleSave();
  }

  scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), 400);
  }

  flush() {
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
      fs.renameSync(tmp, this.file);
    } catch (err) {
      console.warn('[store] could not save', err.message);
    }
  }
}

module.exports = { Store };
