import { h, iconEl } from '../lib/dom.js';
import { formatNumber, plural, timeAgo } from '../lib/format.js';

const KIND_ICON = { text: 'text', link: 'link' };

export function createClipboardView(root, api, hooks) {
  let items = [];
  let query = '';
  let confirmTimer = null;

  // ── DOM ──
  const search = h('input', {
    class: 'input',
    type: 'search',
    placeholder: 'Поиск по истории',
    spellcheck: false,
    onInput: (e) => { query = e.target.value.trim().toLowerCase(); render(); },
    onKeydown: (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); list.querySelector('.clip')?.focus(); }
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

  async function copy(item, row) {
    const ok = await api.clipboard.copy(item.id);
    if (!ok) return;
    row.classList.add('is-copied');
    setTimeout(() => row.classList.remove('is-copied'), 1100);
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
      title: 'Нажмите, чтобы скопировать',
      dataset: { kind: item.type === 'image' ? 'image' : item.kind },
      onClick: () => copy(item, el),
      onKeydown: (e) => {
        if (e.key === 'Enter') copy(item, el);
        else if (e.key === 'ArrowDown') { e.preventDefault(); el.nextElementSibling?.focus?.(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); (el.previousElementSibling?.classList.contains('clip') ? el.previousElementSibling : search).focus(); }
        else if (e.key === 'Delete') api.clipboard.remove(item.id);
      },
    },
    kind,
    h('div', { class: 'clip-body' }, text, h('div', { class: 'clip-meta' }, describe(item))),
    h('div', { class: 'clip-actions' }, pinBtn, removeBtn),
    h('div', { class: 'clip-done', 'aria-hidden': 'true' }, iconEl('check'), 'Скопировано'));
    return el;
  }

  function matches(item) {
    if (!query) return true;
    if (item.type === 'image') return 'изображение картинка скриншот'.includes(query);
    return item.text.toLowerCase().includes(query);
  }

  function render() {
    const visible = items.filter(matches);
    const pinned = visible.filter((i) => i.pinned);
    const recent = visible.filter((i) => !i.pinned);
    const scroll = list.scrollTop;

    list.replaceChildren(
      ...pinned.map(row),
      ...(pinned.length && recent.length ? [h('div', { class: 'clip-section' }, 'Недавние')] : []),
      ...recent.map(row),
    );
    list.scrollTop = scroll;

    count.textContent = items.length
      ? `${items.length} ${plural(items.length, 'запись', 'записи', 'записей')}`
      : '';
    clearBtn.hidden = !recent.length || Boolean(query);

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
      if (value) render();
      else resetClear();
    },
    focusSearch() {
      hooks.pin();
      setTimeout(() => search.focus(), 60);
    },
  };
}
