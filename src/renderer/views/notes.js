import { h, iconEl } from '../lib/dom.js';
import { timeAgo } from '../lib/format.js';
import { t } from '../lib/i18n.js';

const SAVE_DELAY = 400;
const newId = () => Math.random().toString(16).slice(2, 14);

export function createNotesView(root, api, hooks) {
  let notes = [];
  let selectedId = null;
  let saveTimer = null;
  let confirmTimer = null;

  // ── DOM ──
  const list = h('div', { class: 'notes-list scroll', role: 'listbox', 'aria-label': t('tabs.notes') });
  const addBtn = h('button', { class: 'btn btn-plain notes-new', type: 'button', onClick: create }, iconEl('plus'), t('notes.new'));
  const editor = h('textarea', {
    class: 'notes-editor scroll',
    placeholder: t('notes.placeholder'),
    spellcheck: true,
    onInput: () => {
      const note = current();
      if (!note) return;
      note.text = editor.value;
      note.updatedAt = Date.now();
      scheduleSave(note);
      renderList();
    },
  });
  const updated = h('span', { class: 'notes-updated' });
  const deleteBtn = h('button', { class: 'btn btn-ghost', type: 'button', onClick: removeCurrent }, t('notes.delete'));
  const editorBox = h('div', { class: 'notes-edit' }, editor, h('div', { class: 'notes-foot' }, updated, deleteBtn));
  const empty = h('div', { class: 'empty notes-empty' },
    h('div', { class: 'empty-icon', icon: 'note' }),
    h('strong', {}, t('notes.empty.title')),
    h('p', {}, t('notes.empty.text')));

  root.append(h('div', { class: 'notes' }, h('div', { class: 'notes-side' }, addBtn, list), editorBox, empty));

  const current = () => notes.find((n) => n.id === selectedId) ?? null;

  // ── Actions ──
  function scheduleSave(note) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => api.notes.save({ id: note.id, text: note.text }), SAVE_DELAY);
  }

  function flush() {
    clearTimeout(saveTimer);
    const note = current();
    if (note) api.notes.save({ id: note.id, text: note.text });
  }

  /** Empty notes don't need to be kept around once you move on. */
  function dropIfEmpty(note) {
    if (!note || note.text.trim()) return;
    notes = notes.filter((n) => n.id !== note.id);
    api.notes.remove(note.id);
  }

  function select(id) {
    if (id === selectedId) return;
    flush();
    dropIfEmpty(current());
    selectedId = id;
    resetDelete();
    render();
  }

  function create() {
    flush();
    dropIfEmpty(current());
    const note = { id: newId(), text: '', updatedAt: Date.now() };
    notes = [note, ...notes];
    selectedId = note.id;
    render();
    hooks.pin();
    setTimeout(() => editor.focus(), 60);
  }

  function removeCurrent() {
    const note = current();
    if (!note) return;
    if (!deleteBtn.classList.contains('is-danger') && note.text.trim()) {
      deleteBtn.classList.add('is-danger');
      deleteBtn.textContent = t('notes.deleteConfirm');
      confirmTimer = setTimeout(resetDelete, 3000);
      return;
    }
    resetDelete();
    clearTimeout(saveTimer);
    const index = notes.indexOf(note);
    notes = notes.filter((n) => n !== note);
    api.notes.remove(note.id);
    selectedId = notes[Math.min(index, notes.length - 1)]?.id ?? null;
    render();
  }

  function resetDelete() {
    clearTimeout(confirmTimer);
    deleteBtn.classList.remove('is-danger');
    deleteBtn.textContent = t('notes.delete');
  }

  // ── Render ──
  function renderList() {
    list.replaceChildren(...notes.map((note) => {
      const lines = note.text.trim().split('\n').map((l) => l.trim()).filter(Boolean);
      return h('button', {
        class: 'note-item',
        type: 'button',
        role: 'option',
        'aria-selected': String(note.id === selectedId),
        onClick: () => select(note.id),
      },
      h('strong', {}, lines[0] || t('notes.untitled')),
      h('span', {}, lines[1] ?? timeAgo(note.updatedAt)));
    }));
    const note = current();
    updated.textContent = note ? timeAgo(note.updatedAt) : '';
  }

  function render() {
    const note = current();
    root.classList.toggle('is-empty', !notes.length);
    editorBox.hidden = !note;
    if (note && editor.value !== note.text) editor.value = note.text;
    renderList();
  }

  return {
    update(next) {
      notes = [...next].sort((a, b) => b.updatedAt - a.updatedAt);
      selectedId = notes[0]?.id ?? null;
      render();
    },
    setVisible(value) {
      if (value) {
        if (!current()) selectedId = notes[0]?.id ?? null;
        render();
      } else {
        flush();
        dropIfEmpty(current());
        resetDelete();
      }
    },
  };
}
