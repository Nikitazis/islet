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
  { name: 'media-orange', query: { state: 'expanded', accent: 'orange' }, height: 400 },
  { name: 'settings', query: { settings: '1' }, height: 450 },
  { name: 'compact', query: {}, height: 90 },
  { name: 'peek', query: { state: 'peek' }, height: 110 },
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
  for (const shot of SHOTS) {
    win.setContentSize(820, shot.height);
    await win.loadFile(PAGE, { query: shot.query }).catch(() => win.loadFile(PAGE, { query: shot.query }));
    await wait(shot.name === 'peek' ? 900 : 1600);
    const image = await win.webContents.capturePage();
    fs.writeFileSync(path.join(OUT, `${shot.name}.png`), image.toPNG());
    console.log('saved', shot.name, image.getSize());
  }
  app.quit();
});
