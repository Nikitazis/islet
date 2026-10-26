import { h, iconEl } from '../lib/dom.js';

const DRAG_TYPE = 'application/x-cstorka-bookmark';

const ERRORS = {
  invalid: 'Введите адрес сайта (например, github.com) или путь к существующему файлу.',
  duplicate: 'Такая закладка уже есть.',
};

export function createBookmarksView(root, api, hooks) {
  let items = [];
  let mode = 'grid';
  let dragId = null;

  // ── DOM ──
  const grid = h('div', { class: 'bm-grid scroll' });
  const targetInput = h('input', { class: 'input', placeholder: 'github.com или C:\\Users\\…\\Документы', spellcheck: false });
  const titleInput = h('input', { class: 'input', placeholder: 'Подставится автоматически', spellcheck: false });
  const error = h('div', { class: 'form-error', role: 'alert' });
  const submitBtn = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Добавить');
  const form = h('form', { class: 'bm-form', onSubmit: submit },
    h('h2', {}, 'Новая закладка'),
    h('label', { class: 'field' }, h('span', {}, 'Адрес сайта, файл или папка'), targetInput),
    h('label', { class: 'field' }, h('span', {}, 'Название'), titleInput),
    error,
    h('div', { class: 'form-row' },
      h('button', { class: 'btn btn-plain', type: 'button', onClick: () => pick('file') }, 'Файл…'),
      h('button', { class: 'btn btn-plain', type: 'button', onClick: () => pick('folder') }, 'Папка…'),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn btn-ghost', type: 'button', onClick: () => setMode('grid') }, 'Отмена'),
      submitBtn,
    ),
  );
  root.append(grid, form);

  // ── Form ──
  function setMode(next) {
    mode = next;
    grid.hidden = mode !== 'grid';
    form.hidden = mode !== 'form';
    if (mode === 'form') {
      form.reset();
      error.textContent = '';
      hooks.pin();
      setTimeout(() => targetInput.focus(), 60);
    }
  }

  async function submit(event) {
    event.preventDefault();
    submitBtn.disabled = true;
    const result = await api.bookmarks.add({ target: targetInput.value, title: titleInput.value });
    submitBtn.disabled = false;
    if (result.ok) setMode('grid');
    else error.textContent = ERRORS[result.error] ?? ERRORS.invalid;
  }

  async function pick(kind) {
    const path = await api.bookmarks.pick(kind);
    if (!path) return;
    targetInput.value = path;
    titleInput.focus();
  }

  // ── Tiles ──
  function tileIcon(b) {
    const box = h('div', { class: 'bm-icon' });
    const monogram = () => {
      if (b.type === 'url') {
        box.classList.add('is-mono');
        box.replaceChildren((b.title.trim()[0] ?? '•').toUpperCase());
      } else {
        box.replaceChildren(iconEl(b.type === 'folder' ? 'folder' : 'file'));
      }
    };
    if (b.icon) {
      const img = h('img', { src: b.icon, alt: '', draggable: false });
      img.onload = () => box.classList.toggle('is-full', b.type === 'url' && img.naturalWidth >= 96);
      img.onerror = monogram;
      box.append(img);
    } else {
      monogram();
    }
    return box;
  }

  function tile(b, index) {
    const el = h('div', {
      class: 'bm',
      draggable: true,
      dataset: { id: b.id },
      onDragstart: (e) => {
        dragId = b.id;
        e.dataTransfer.setData(DRAG_TYPE, b.id);
        e.dataTransfer.effectAllowed = 'move';
        el.classList.add('is-dragging');
      },
      onDragend: () => {
        dragId = null;
        el.classList.remove('is-dragging');
        grid.querySelectorAll('.is-target').forEach((t) => t.classList.remove('is-target'));
      },
      onDragover: (e) => {
        if (!dragId || dragId === b.id) return;
        e.preventDefault();
        el.classList.add('is-target');
      },
      onDragleave: () => el.classList.remove('is-target'),
      onDrop: (e) => {
        if (!dragId) return;
        e.preventDefault();
        e.stopPropagation();
        api.bookmarks.move(dragId, index);
      },
    },
    h('button', {
      class: 'bm-open',
      type: 'button',
      title: b.target,
      onClick: async () => {
        if (await api.bookmarks.open(b.id)) hooks.collapse();
      },
    }, tileIcon(b), h('span', { class: 'bm-label' }, b.title)),
    h('button', {
      class: 'bm-remove',
      type: 'button',
      'aria-label': `Удалить «${b.title}»`,
      onClick: () => api.bookmarks.remove(b.id),
    }, iconEl('close')));
    return el;
  }

  function addTile() {
    return h('div', { class: 'bm bm-add' },
      h('button', { class: 'bm-open', type: 'button', onClick: () => setMode('form') },
        h('div', { class: 'bm-icon' }, iconEl('plus')),
        h('span', { class: 'bm-label' }, 'Добавить')));
  }

  function render() {
    grid.replaceChildren(...items.map(tile), addTile());
  }

  // ── Dropping links and files from outside ──
  root.addEventListener('dragover', (e) => {
    if (dragId) return;
    const types = [...e.dataTransfer.types];
    if (!types.includes('Files') && !types.includes('text/uri-list') && !types.includes('text/plain')) return;
    e.preventDefault();
    root.classList.add('is-dropping');
  });
  root.addEventListener('dragleave', (e) => {
    if (!root.contains(e.relatedTarget)) root.classList.remove('is-dropping');
  });
  root.addEventListener('drop', async (e) => {
    root.classList.remove('is-dropping');
    if (dragId) return;
    e.preventDefault();
    const files = [...e.dataTransfer.files];
    if (files.length) {
      for (const file of files) await api.bookmarks.add({ target: api.bookmarks.pathForFile(file) });
      return;
    }
    const url = (e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain')).split('\n')[0];
    if (url) await api.bookmarks.add({ target: url.trim() });
  });

  api.bookmarks.onChange((next) => {
    items = next;
    render();
  });

  setMode('grid');

  return {
    update(next) {
      items = next;
      render();
    },
    setVisible(value) {
      if (!value && mode === 'form') setMode('grid');
    },
    isEditing: () => mode === 'form',
    cancelEdit: () => setMode('grid'),
  };
}
