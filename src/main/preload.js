'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

const on = (channel, callback) => {
  const handler = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('cstorka', {
  init: () => ipcRenderer.invoke('app:init'),

  island: {
    setInteractive: (interactive) => ipcRenderer.send('island:interactive', Boolean(interactive)),
    setFocus: (focus) => ipcRenderer.send('island:focus', Boolean(focus)),
    onToggle: (callback) => on('island:toggle', callback),
    onBlur: (callback) => on('island:blur', callback),
  },

  media: {
    command: (command) => ipcRenderer.send('media:command', command),
    thumb: (key) => ipcRenderer.invoke('media:thumb', key),
    onState: (callback) => on('media:state', callback),
    onThumb: (callback) => on('media:thumb', callback),
  },

  clipboard: {
    copy: (id) => ipcRenderer.invoke('clip:copy', id),
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

  settings: {
    set: (patch) => ipcRenderer.invoke('settings:set', patch),
    onChange: (callback) => on('settings:changed', callback),
  },
});
