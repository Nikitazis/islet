import { h, iconEl } from '../lib/dom.js';
import { formatNumber, plural, timeAgo } from '../lib/format.js';

const KIND_ICON = { text: 'text', link: 'link' };
const SEARCH_HINT = 'Поиск по истории';
const PASTE_HINT = 'Найдите запись и нажмите Enter, чтобы вставить';

export function createClipboardView(root, api, hooks) {
  let items = [];
  let query = '';
  let confirmTimer = null;
  // Quick paste (Ctrl+Shift+V): Enter or a click pastes into the window the user came from.
  let quickPaste = false;

  // ── DOM ──
  const search = h('input', {
    class: 'input',
    type: 'search',
    placeholder: SEARCH_HINT,
    spellcheck: false,
    onInput: (e) => { query = e.target.value.trim().toLowerCase(); render(); },
    onKeydown: (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        list.querySelector('.clip')?.focus();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const first = visibleItems()[0];
        if (first) activate(first, list.querySelector('.clip'));
      }
    },
  });
  const count = h('span', { class: 'clip-count' });
  const clearBtn = h('button', { class: 'btn btn-ghost', type: 'button', onClick: clear }, 'Очистить');
  const list = h('div', { class: 'clip-list scroll', role: 'list' });
  const empty = h('div', { class: 'empty' });

  root.append(
    h('div', { class: 'clip-tools' }, h('label', { class: 'search' }, iconEl('search'), search), count, clearBtn),
    list,
    empty,
  );

  // ── Actions ──
  function clear() {
    if (!clearBtn.classList.contains('is-danger')) {
      clearBtn.classList.add('is-danger');
      clearBtn.textContent = 'Очистить всё?';
      confirmTimer = setTimeout(resetClear, 3000);
      return;
    }
    resetClear();
    api.clipboard.clear();
  }

  function resetClear() {
    clearTimeout(confirmTimer);
    clearBtn.classList.remove('is-danger');
    clearBtn.textContent = 'Очистить';
  }

  function activate(item, row) {
    if (quickPaste) paste(item);
    else copy(item, row);
  }

  async function copy(item, row) {
    const ok = await api.clipboard.copy(item.id);
    if (!ok) return;
    row.classList.add('is-copied');
    setTimeout(() => row.classList.remove('is-copied'), 1100);
  }

  async function paste(item) {
    endQuickPaste();
    const result = await api.clipboard.paste(item.id);
    hooks.collapse();
    // The target refused synthetic keys (e.g. it runs as administrator): the entry is still copied.
    if (result.ok && !result.pasted) {
      hooks.notify({ icon: 'clipboard', title: 'Скопировано', sub: 'Вставьте сочетанием Ctrl + V' });
    }
  }

  function endQuickPaste() {
    quickPaste = false;
    list.classList.remove('is-quick');
    search.placeholder = SEARCH_HINT;
  }

  // ── Render ──
  function describe(item) {
    if (item.type === 'image') return `Изображение ${item.width} × ${item.height}`;
    const when = timeAgo(item.createdAt);
    if (item.length > 300) return `${when}, ${formatNumber(item.length)} ${plural(item.length, 'символ', 'символа', 'символов')}`;
    return when;
  }

  function row(item) {
    const kind = item.type === 'image'
      ? h('div', { class: 'clip-kind is-thumb' }, h('img', { src: item.thumb, alt: '' }))
      : h('div', { class: 'clip-kind' }, iconEl(KIND_ICON[item.kind] ?? 'text'));

    const text = item.type === 'image'
      ? h('div', { class: 'clip-text' }, 'Картинка')
      : h('div', { class: 'clip-text' }, item.text.replace(/\s+/g, ' ').trim());

    const pinBtn = h('button', {
      class: 'icon-btn pin-btn',
      type: 'button',
      'aria-label': item.pinned ? 'Открепить' : 'Закрепить',
      title: item.pinned ? 'Открепить' : 'Закрепить',
      onClick: (e) => { e.stopPropagation(); api.clipboard.togglePin(item.id); },
    }, iconEl('pin'));
    const removeBtn = h('button', {
      class: 'icon-btn',
      type: 'button',
      'aria-label': 'Удалить',
      title: 'Удалить',
      onClick: (e) => { e.stopPropagation(); api.clipboard.remove(item.id); },
    }, iconEl('trash'));

    const el = h('div', {
      class: `clip${item.pinned ? ' is-pinned' : ''}`,
      role: 'listitem',
      tabIndex: 0,
      dataset: { kind: item.type === 'image' ? 'image' : item.kind },
      onClick: () => activate(item, el),
      onKeydown: (e) => {
        if (e.key === 'Enter') activate(item, el);
        else if (e.key === 'ArrowDown') { e.preventDefault(); nextRow(el, 'nextElementSibling')?.focus(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); (nextRow(el, 'previousElementSibling') ?? search).focus(); }
        else if (e.key === 'Delete') api.clipboard.remove(item.id);
      },
    },
    kind,
    h('div', { class: 'clip-body' }, text, h('div', { class: 'clip-meta' }, describe(item))),
    h('div', { class: 'clip-actions' }, pinBtn, removeBtn),
    h('div', { class: 'clip-done', 'aria-hidden': 'true' }, iconEl('check'), 'Скопировано'),
    h('div', { class: 'clip-enter', 'aria-hidden': 'true' }, h('kbd', {}, 'Enter'), 'вставить'));
    return el;
  }

  /** Neighbouring entry, skipping the "Недавние" header. */
  function nextRow(el, direction) {
    let next = el[direction];
    while (next && !next.classList.contains('clip')) next = next[direction];
    return next;
  }

  function matches(item) {
    if (!query) return true;
    if (item.type === 'image') return 'изображение картинка скриншот'.includes(query);
    return item.text.toLowerCase().includes(query);
  }

  /** Entries in display order: pinned first, then the most recent. */
  function visibleItems() {
    const visible = items.filter(matches);
    return [...visible.filter((i) => i.pinned), ...visible.filter((i) => !i.pinned)];
  }

  function render() {
    const visible = visibleItems();
    const pinned = visible.filter((i) => i.pinned);
    const recent = visible.filter((i) => !i.pinned);
    const scroll = list.scrollTop;

    list.replaceChildren(
      ...pinned.map(row),
      ...(pinned.length && recent.length ? [h('div', { class: 'clip-section' }, 'Недавние')] : []),
      ...recent.map(row),
    );
    list.querySelector('.clip')?.classList.add('is-target');
    list.scrollTop = scroll;

    count.textContent = items.length
      ? `${items.length} ${plural(items.length, 'запись', 'записи', 'записей')}`
      : '';
    clearBtn.hidden = !recent.length || Boolean(query) || quickPaste;

    list.hidden = !visible.length;
    empty.hidden = Boolean(visible.length);
    if (!visible.length) {
      empty.replaceChildren(...(query
        ? [h('strong', {}, 'Ничего не нашлось'), h('p', {}, `В истории нет записей с «${query}».`)]
        : [
          h('div', { class: 'empty-icon', icon: 'clipboard' }),
          h('strong', {}, 'История пока пуста'),
          h('p', {}, 'Скопируйте текст, ссылку или картинку в любой программе — запись появится здесь.'),
        ]));
    }
  }

  api.clipboard.onChange((next) => {
    items = next;
    render();
  });

  // Keep "5 мин назад" honest while the list is on screen.
  setInterval(() => { if (root.classList.contains('is-active')) render(); }, 30_000);

  return {
    update(next) {
      items = next;
      render();
    },
    setVisible(value) {
      if (value) return render();
      resetClear();
      endQuickPaste();
    },
    focusSearch() {
      hooks.pin();
      setTimeout(() => search.focus(), 60);
    },
    startQuickPaste() {
      quickPaste = true;
      query = '';
      search.value = '';
      search.placeholder = PASTE_HINT;
      list.classList.add('is-quick');
      list.scrollTop = 0;
      render();
      setTimeout(() => search.focus(), 60);
    },
    isQuickPaste: () => quickPaste,
  };
}
