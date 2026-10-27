'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

const on = (channel, callback) => {
  const handler = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('islet', {
  init: () => ipcRenderer.invoke('app:init'),
  onboarded: () => ipcRenderer.send('app:onboarded'),
  ready: () => ipcRenderer.send('app:ready'),

  island: {
    setInteractive: (interactive) => ipcRenderer.send('island:interactive', Boolean(interactive)),
    setFocus: (focus) => ipcRenderer.send('island:focus', Boolean(focus)),
    reportState: (state) => ipcRenderer.send('island:state', String(state)),
    onToggle: (callback) => on('island:toggle', callback),
    onCollapse: (callback) => on('island:collapse', callback),
    onQuickPaste: (callback) => on('island:quick-paste', callback),
    onEar: (callback) => on('island:ear', callback),
    onBlur: (callback) => on('island:blur', callback),
  },

  shortcuts: {
    suspend: (suspended) => ipcRenderer.send('shortcuts:suspend', Boolean(suspended)),
    onChange: (callback) => on('shortcuts:status', callback),
  },

  displays: {
    onChange: (callback) => on('displays:changed', callback),
  },

  media: {
    command: (command) => ipcRenderer.send('media:command', command),
    thumb: (key) => ipcRenderer.invoke('media:thumb', key),
    onState: (callback) => on('media:state', callback),
    onThumb: (callback) => on('media:thumb', callback),
  },

  volume: {
    set: (change) => ipcRenderer.send('volume:set', change),
    mute: (muted) => ipcRenderer.send('volume:mute', muted),
    onChange: (callback) => on('volume:changed', callback),
  },

  clipboard: {
    copy: (id) => ipcRenderer.invoke('clip:copy', id),
    paste: (id) => ipcRenderer.invoke('clip:paste', id),
    cancelPaste: () => ipcRenderer.send('clip:paste-cancel'),
    togglePin: (id) => ipcRenderer.send('clip:pin', id),
    remove: (id) => ipcRenderer.send('clip:remove', id),
    clear: () => ipcRenderer.send('clip:clear'),
    onChange: (callback) => on('clip:changed', callback),
    onAdded: (callback) => on('clip:added', callback),
  },

  bookmarks: {
    add: (bookmark) => ipcRenderer.invoke('bm:add', bookmark),
    open: (id) => ipcRenderer.invoke('bm:open', id),
    remove: (id) => ipcRenderer.send('bm:remove', id),
    rename: (id, title) => ipcRenderer.send('bm:rename', id, title),
    move: (id, index) => ipcRenderer.send('bm:move', id, index),
    pick: (kind) => ipcRenderer.invoke('bm:pick', kind),
    pathForFile: (file) => webUtils.getPathForFile(file),
    onChange: (callback) => on('bm:changed', callback),
  },

  calendar: {
    range: (from, to) => ipcRenderer.invoke('cal:range', from, to),
    add: (event) => ipcRenderer.invoke('cal:add', event),
    remove: (id) => ipcRenderer.send('cal:remove', id),
    onChange: (callback) => on('cal:changed', callback),
    onReminder: (callback) => on('cal:reminder', callback),
  },

  notes: {
    save: (note) => ipcRenderer.send('notes:save', note),
    remove: (id) => ipcRenderer.send('notes:remove', id),
  },

  system: {
    watch: (enabled) => ipcRenderer.send('system:watch', Boolean(enabled)),
    onSample: (callback) => on('system:sample', callback),
  },

  updates: {
    check: () => ipcRenderer.invoke('update:check'),
    install: () => ipcRenderer.send('update:install'),
    onStatus: (callback) => on('update:status', callback),
  },

  settings: {
    set: (patch) => ipcRenderer.invoke('settings:set', patch),
    onChange: (callback) => on('settings:changed', callback),
  },
});
