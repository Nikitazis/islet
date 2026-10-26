'use strict';

const { clipboard, nativeImage, ClipboardItem } = require('electron');
const { EventEmitter } = require('node:events');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const POLL_MS = 600;
const IMAGE_BACKOFF_MAX = 5000;
const MAX_TEXT = 100_000;
const THUMB_HEIGHT = 120;

const osFormat = (name) => `electron application/osclipboard;format="${name}"`;
// Password managers mark secrets with these formats so that clipboard
// history tools skip them (the same convention Windows' own Win+V follows).
const PRIVATE_FORMATS = [osFormat('ExcludeClipboardContentFromMonitorProcessing'), osFormat('Clipboard Viewer Ignore')];
const HISTORY_FLAG = osFormat('CanIncludeInClipboardHistory');

const newId = () => crypto.randomBytes(6).toString('hex');
const hash = (buf) => crypto.createHash('sha1').update(buf).digest('hex');

async function isPrivate(entry) {
  if (PRIVATE_FORMATS.some((f) => entry.types.includes(f))) return true;
  if (!entry.types.includes(HISTORY_FLAG)) return false;
  try {
    const flag = Buffer.from(await (await entry.getType(HISTORY_FLAG)).arrayBuffer());
    return flag.length >= 4 && flag.readUInt32LE(0) === 0;
  } catch {
    return false;
  }
}

class ClipboardHistory extends EventEmitter {
  constructor(store, imagesDir) {
    super();
    this.store = store;
    this.imagesDir = imagesDir;
    this.lastText = '';
    this.lastImage = '';
    this.lastTypes = '';
    this.imageBackoff = POLL_MS;
    this.nextImageCheck = 0;
    this.adoptImageUntil = 0;
    this.busy = false;
    this.timer = null;
  }

  get items() {
    return this.store.get('clipboard');
  }

  set items(items) {
    this.store.set('clipboard', items);
    this.emit('change', items);
  }

  async start() {
    fs.mkdirSync(this.imagesDir, { recursive: true });
    // Whatever is on the clipboard at launch is old news: remember it without recording.
    await this.check({ record: false }).catch(() => {});
    this.timer = setInterval(() => this.poll(), POLL_MS);
  }

  stop() {
    clearInterval(this.timer);
  }

  async poll() {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.check({ record: true });
    } catch (err) {
      console.warn('[clipboard]', err.message);
    } finally {
      this.busy = false;
    }
  }

  async check({ record }) {
    const [entry] = await clipboard.read();
    if (!entry) return;
    const typesKey = entry.types.join('|');
    const typesChanged = typesKey !== this.lastTypes;
    this.lastTypes = typesKey;

    if (entry.types.includes('text/plain')) {
      const text = await clipboard.readText();
      if (text === this.lastText) return;
      this.lastText = text;
      this.lastImage = '';
      if (!record || !text.trim() || text.length > MAX_TEXT || await isPrivate(entry)) return;
      this.addText(text);
      return;
    }

    if (!entry.types.includes('image/png')) return;
    // Reading an image means re-encoding it, so an image that sits unchanged
    // on the clipboard is checked less and less often.
    if (!typesChanged && Date.now() < this.nextImageCheck) return;
    const png = Buffer.from(await (await entry.getType('image/png')).arrayBuffer());
    const signature = hash(png);
    const unchanged = signature === this.lastImage;
    this.imageBackoff = unchanged ? Math.min(IMAGE_BACKOFF_MAX, this.imageBackoff * 1.6) : POLL_MS;
    this.nextImageCheck = Date.now() + this.imageBackoff;
    if (unchanged) return;
    this.lastImage = signature;
    this.lastText = '';
    // Our own write comes back re-encoded with different bytes; don't record it twice.
    if (Date.now() < this.adoptImageUntil) return;
    if (!record || await isPrivate(entry)) return;
    this.addImage(png, signature);
  }

  addText(text) {
    const existing = this.items.find((item) => item.type === 'text' && item.text === text);
    if (existing) {
      this.bump(existing.id);
      return;
    }
    const kind = /^(https?:\/\/|www\.)\S+$/i.test(text.trim()) ? 'link' : 'text';
    this.insert({ id: newId(), type: 'text', kind, text, createdAt: Date.now(), pinned: false });
  }

  addImage(png, signature) {
    const existing = this.items.find((item) => item.type === 'image' && item.signature === signature);
    if (existing) {
      this.bump(existing.id);
      return;
    }
    const image = nativeImage.createFromBuffer(png);
    if (image.isEmpty()) return;
    const id = newId();
    const file = path.join(this.imagesDir, `${id}.png`);
    try {
      fs.writeFileSync(file, png);
    } catch (err) {
      console.warn('[clipboard] could not save image', err.message);
      return;
    }
    const { width, height } = image.getSize();
    const thumb = image.resize({ height: Math.min(THUMB_HEIGHT, height), quality: 'good' }).toDataURL();
    this.insert({ id, type: 'image', file, thumb, width, height, signature, createdAt: Date.now(), pinned: false });
  }

  insert(item) {
    this.items = this.trim([item, ...this.items]);
    this.emit('added', item);
  }

  /** Keeps pinned entries forever and the newest unpinned ones up to the limit. */
  trim(items) {
    const limit = this.store.get('settings').clipboardLimit;
    let unpinned = 0;
    return items.filter((item) => {
      if (item.pinned) return true;
      unpinned += 1;
      if (unpinned <= limit) return true;
      this.removeFile(item);
      return false;
    });
  }

  bump(id) {
    const item = this.items.find((i) => i.id === id);
    if (!item) return;
    this.items = [{ ...item, createdAt: Date.now() }, ...this.items.filter((i) => i.id !== id)];
  }

  async copy(id) {
    const item = this.items.find((i) => i.id === id);
    if (!item) return false;
    if (item.type === 'text') {
      this.lastText = item.text;
      await clipboard.writeText(item.text);
    } else {
      let png;
      try {
        png = fs.readFileSync(item.file);
      } catch {
        return false;
      }
      this.lastText = '';
      this.adoptImageUntil = Date.now() + 2000;
      this.nextImageCheck = 0;
      await clipboard.write([new ClipboardItem({ 'image/png': new Blob([png], { type: 'image/png' }) })]);
    }
    this.bump(id);
    return true;
  }

  togglePin(id) {
    this.items = this.items.map((i) => (i.id === id ? { ...i, pinned: !i.pinned } : i));
  }

  remove(id) {
    const item = this.items.find((i) => i.id === id);
    if (item) this.removeFile(item);
    this.items = this.items.filter((i) => i.id !== id);
  }

  clearUnpinned() {
    for (const item of this.items) if (!item.pinned) this.removeFile(item);
    this.items = this.items.filter((i) => i.pinned);
  }

  applyLimit() {
    this.items = this.trim(this.items);
  }

  removeFile(item) {
    if (item.type !== 'image' || !item.file) return;
    fs.rm(item.file, { force: true }, () => {});
  }
}

module.exports = { ClipboardHistory };
