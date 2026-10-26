'use strict';

// Serves the renderer on http://localhost:5173 with demo data, so the UI can be
// worked on in any browser without Electron. Usage: npm run preview

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', 'src', 'renderer');
const PORT = Number(process.env.PORT) || 5173;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const file = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)));
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end();
    return;
  }
  fs.readFile(file, (err, body) => {
    if (err) {
      res.writeHead(404).end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  });
}).listen(PORT, '127.0.0.1', () => console.log(`Preview: http://localhost:${PORT}`));
