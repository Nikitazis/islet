'use strict';

const { app, net, shell } = require('electron');
const { EventEmitter } = require('node:events');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const MAX_HTML = 400_000;
const MAX_ICON = 300_000;

const newId = () => crypto.randomBytes(6).toString('hex');

/** Turns whatever the user typed or dropped into a URL or an existing local path. */
function normalizeTarget(raw) {
  const value = String(raw ?? '').trim().replace(/^"(.*)"$/, '$1');
  if (!value) return null;

  if (/^[a-z]:[\\/]/i.test(value) || value.startsWith('\\\\')) {
    if (!fs.existsSync(value)) return null;
    const isDir = fs.statSync(value).isDirectory();
    return { type: isDir ? 'folder' : 'file', target: path.normalize(value) };
  }

  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
  // Local dev servers rarely speak HTTPS.
  const candidate = hasScheme ? value : `${/^localhost(:|\/|$)/i.test(value) ? 'http' : 'https'}://${value}`;
  try {
    const url = new URL(candidate);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    if (!url.hostname.includes('.') && url.hostname !== 'localhost') return null;
    return { type: 'url', target: url.href };
  } catch {
    return null;
  }
}

async function fetchWithTimeout(url, ms = 6000) {
  return net.fetch(url, { signal: AbortSignal.timeout(ms), redirect: 'follow' });
}

function pickIconHref(html) {
  const links = html.match(/<link\b[^>]*>/gi) ?? [];
  const icons = links
    .map((tag) => ({
      rel: (tag.match(/\brel=["']?([^"'>]+)/i)?.[1] ?? '').toLowerCase(),
      href: tag.match(/\bhref=["']?([^"'\s>]+)/i)?.[1],
      sizes: parseInt(tag.match(/\bsizes=["']?(\d+)/i)?.[1] ?? '0', 10),
    }))
    .filter((l) => l.href && /(^|\s)(icon|apple-touch-icon)(\s|$)/.test(l.rel));
  // Prefer the crisp apple-touch-icon, then the largest declared size.
  icons.sort((a, b) => {
    const touch = Number(b.rel.includes('apple')) - Number(a.rel.includes('apple'));
    return touch || b.sizes - a.sizes;
  });
  return icons[0]?.href;
}

/** A short site name: og:site_name, then application-name, then the shortest part of <title>. */
function pickSiteName(html) {
  const metas = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const key of ['og:site_name', 'application-name']) {
    const tag = metas.find((m) => new RegExp(`(property|name)=["']?${key}["'\\s>]`, 'i').test(m));
    const content = tag?.match(/\bcontent=["']([^"']+)/i)?.[1];
    if (content?.trim()) return decodeEntities(content.trim());
  }
  const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1];
  if (!title) return null;
  const parts = decodeEntities(title).replace(/\s+/g, ' ').trim().split(/\s+[|·•—–-]\s+/).filter(Boolean);
  return parts.reduce((a, b) => (b.length < a.length ? b : a), parts[0] ?? '') || null;
}

function decodeEntities(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

/** Reads the page itself for its title and icon; nothing is sent to third-party icon services. */
async function inspectSite(pageUrl) {
  const result = { title: null, icon: null };
  let iconUrl = new URL('/favicon.ico', pageUrl).href;
  try {
    const res = await fetchWithTimeout(pageUrl);
    if (res.ok && (res.headers.get('content-type') ?? '').includes('html')) {
      const html = (await res.text()).slice(0, MAX_HTML);
      result.title = pickSiteName(html)?.slice(0, 80) ?? null;
      const href = pickIconHref(html);
      if (href) iconUrl = new URL(decodeEntities(href), res.url || pageUrl).href;
    }
  } catch {
    // Offline or blocked: fall back to /favicon.ico and the hostname.
  }
  try {
    if (iconUrl.startsWith('data:image/')) {
      result.icon = iconUrl.length < MAX_ICON * 1.4 ? iconUrl : null;
    } else {
      const res = await fetchWithTimeout(iconUrl);
      const type = (res.headers.get('content-type') ?? '').split(';')[0];
      if (res.ok && type.startsWith('image/')) {
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > 0 && buf.length < MAX_ICON) result.icon = `data:${type};base64,${buf.toString('base64')}`;
      }
    }
  } catch {
    // Keep the monogram tile.
  }
  return result;
}

class Bookmarks extends EventEmitter {
  constructor(store) {
    super();
    this.store = store;
  }

  get items() {
    return this.store.get('bookmarks');
  }

  set items(items) {
    this.store.set('bookmarks', items);
    this.emit('change', items);
  }

  async add({ target, title }) {
    const normalized = normalizeTarget(target);
    if (!normalized) return { ok: false, error: 'invalid' };
    if (this.items.some((b) => b.target === normalized.target)) return { ok: false, error: 'duplicate' };

    const customTitle = String(title ?? '').trim().slice(0, 80);
    const bookmark = {
      id: newId(),
      ...normalized,
      title: customTitle || this.defaultTitle(normalized),
      icon: null,
      createdAt: Date.now(),
    };
    this.items = [...this.items, bookmark];

    // Fill in the icon (and the page title) in the background.
    if (normalized.type === 'url') {
      inspectSite(normalized.target).then(({ title: pageTitle, icon }) => {
        this.patch(bookmark.id, {
          icon,
          ...(customTitle || !pageTitle ? {} : { title: pageTitle }),
        });
      });
    } else {
      app.getFileIcon(normalized.target, { size: 'large' })
        .then((image) => this.patch(bookmark.id, { icon: image.toDataURL() }))
        .catch(() => {});
    }
    return { ok: true, bookmark };
  }

  defaultTitle({ type, target }) {
    if (type === 'url') return new URL(target).hostname.replace(/^www\./, '');
    return path.basename(target) || target;
  }

  patch(id, changes) {
    if (!this.items.some((b) => b.id === id)) return;
    this.items = this.items.map((b) => (b.id === id ? { ...b, ...changes } : b));
  }

  rename(id, title) {
    const clean = String(title ?? '').trim().slice(0, 80);
    if (clean) this.patch(id, { title: clean });
  }

  remove(id) {
    this.items = this.items.filter((b) => b.id !== id);
  }

  move(id, toIndex) {
    const items = [...this.items];
    const from = items.findIndex((b) => b.id === id);
    if (from < 0) return;
    const [item] = items.splice(from, 1);
    items.splice(Math.max(0, Math.min(items.length, toIndex)), 0, item);
    this.items = items;
  }

  async open(id) {
    const bookmark = this.items.find((b) => b.id === id);
    if (!bookmark) return false;
    if (bookmark.type === 'url') {
      // The store is a plain JSON file, so re-check the scheme before handing it to the shell.
      if (!/^https?:\/\//i.test(bookmark.target)) return false;
      await shell.openExternal(bookmark.target);
      return true;
    }
    const error = await shell.openPath(bookmark.target);
    return !error;
  }
}

module.exports = { Bookmarks, normalizeTarget, pickSiteName, inspectSite };
