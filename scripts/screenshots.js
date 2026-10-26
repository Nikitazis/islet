'use strict';

// Renders the island on demo data and saves README screenshots to docs/screenshots.
// Usage: npm run screenshots

const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const OUT = path.join(__dirname, '..', 'docs', 'screenshots');
const PAGE = path.join(__dirname, '..', 'src', 'renderer', 'index.html');
const SHOTS = [
  { name: 'media', query: { state: 'expanded' }, height: 400 },
  { name: 'clipboard', query: { state: 'expanded', tab: 'clipboard' }, height: 400 },
  { name: 'quick-paste', query: { state: 'paste' }, height: 400 },
  { name: 'bookmarks', query: { state: 'expanded', tab: 'bookmarks' }, height: 400 },
  { name: 'timer', query: { state: 'expanded', tab: 'timer', timer: '25' }, height: 400, wait: 2600 },
  { name: 'calendar', query: { state: 'expanded', tab: 'calendar' }, height: 400 },
  { name: 'system', query: { state: 'expanded', tab: 'system' }, height: 400, wait: 2600 },
  { name: 'notes', query: { state: 'expanded', tab: 'notes' }, height: 400 },
  { name: 'media-orange', query: { state: 'expanded', accent: 'orange' }, height: 400 },
  { name: 'settings', query: { settings: '1' }, height: 450 },
  { name: 'english', query: { state: 'expanded', tab: 'timer', timer: '25', lang: 'en' }, height: 400, wait: 2600 },
  { name: 'compact', query: {}, height: 90 },
  { name: 'compact-timer', query: { timer: '25' }, height: 90, wait: 2200 },
  { name: 'peek', query: { state: 'peek' }, height: 110, wait: 900 },
];

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const win = new BrowserWindow({
    width: 820,
    height: 400,
    show: false,
    frame: false,
    // Offscreen rendering keeps transitions running in a window nobody sees.
    webPreferences: { contextIsolation: true, sandbox: true, offscreen: true, backgroundThrottling: false },
  });
  win.webContents.setFrameRate(60);
  for (const shot of SHOTS.filter((s) => !process.argv[2] || s.name === process.argv[2])) {
    win.setContentSize(820, shot.height);
    await win.loadFile(PAGE, { query: shot.query }).catch(() => win.loadFile(PAGE, { query: shot.query }));
    await wait(shot.wait ?? 1600);
    const image = await win.webContents.capturePage();
    fs.writeFileSync(path.join(OUT, `${shot.name}.png`), image.toPNG());
    console.log('saved', shot.name, image.getSize());
  }
  app.quit();
});
