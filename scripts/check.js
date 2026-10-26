'use strict';

// Quick sanity check for CI: every script parses, and both languages have
// the same keys. Usage: npm run check

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
let failed = false;

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

const scripts = [...walk(path.join(ROOT, 'src')), ...walk(path.join(ROOT, 'scripts'))].filter((f) => f.endsWith('.js'));
for (const file of scripts) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (err) {
    failed = true;
    console.error(`✗ ${path.relative(ROOT, file)}\n${err.stderr}`);
  }
}
console.log(`${scripts.length} scripts parsed`);

const locales = Object.fromEntries(['ru', 'en'].map((lang) => [
  lang,
  JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'locales', `${lang}.json`), 'utf8')),
]));
for (const [lang, other] of [['ru', 'en'], ['en', 'ru']]) {
  const missing = Object.keys(locales[lang]).filter((key) => !(key in locales[other]));
  if (missing.length) {
    failed = true;
    console.error(`✗ ${other}.json is missing: ${missing.join(', ')}`);
  }
}

// Every literal translation key used in src must exist.
const used = new Set();
for (const file of scripts.filter((f) => f.startsWith(path.join(ROOT, 'src')))) {
  for (const match of fs.readFileSync(file, 'utf8').matchAll(/\bt\('([a-z][\w.]+)'/g)) used.add(match[1]);
}
const unknown = [...used].filter((key) => !(key in locales.ru));
if (unknown.length) {
  failed = true;
  console.error(`✗ unknown translation keys: ${unknown.join(', ')}`);
}
console.log(`${Object.keys(locales.ru).length} translation keys, ${used.size} used directly`);

process.exit(failed ? 1 : 0);
