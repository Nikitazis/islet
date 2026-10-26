import { h, iconEl } from '../lib/dom.js';
import { timeAgo } from '../lib/format.js';
import { t } from '../lib/i18n.js';

const KIND_ICON = { text: 'text', link: 'link' };

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
    placeholder: t('clip.search'),
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
  const clearBtn = h('button', { class: 'btn btn-ghost', type: 'button', onClick: clear }, t('clip.clear'));
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
      clearBtn.textContent = t('clip.clearConfirm');
      confirmTimer = setTimeout(resetClear, 3000);
      return;
    }
    resetClear();
    api.clipboard.clear();
  }

  function resetClear() {
    clearTimeout(confirmTimer);
    clearBtn.classList.remove('is-danger');
    clearBtn.textContent = t('clip.clear');
  }

  function activate(item, row) {
    if (quickPaste) paste(item);
    else copy(item, row);
  }

  async function copy(item, row) {
    const ok = await api.clipboard.copy(item.id);
    if (!ok) {
      if (item.type === 'files') hooks.notify({ icon: 'file', title: t('clip.filesMissing'), sub: item.names[0] });
      return;
    }
    row.classList.add('is-copied');
    setTimeout(() => row.classList.remove('is-copied'), 1100);
  }

  async function paste(item) {
    endQuickPaste();
    const result = await api.clipboard.paste(item.id);
    hooks.collapse();
    // The target refused synthetic keys (e.g. it runs as administrator): the entry is still copied.
    if (result.ok && !result.pasted) {
      hooks.notify({ icon: 'clipboard', title: t('peek.copied'), sub: t('peek.pasteFallback') });
    }
  }

  function endQuickPaste() {
    quickPaste = false;
    list.classList.remove('is-quick');
    search.placeholder = t('clip.search');
  }

  // ── Render ──
  function describe(item) {
    if (item.type === 'image') return t('clip.imageMeta', { width: item.width, height: item.height });
    const when = timeAgo(item.createdAt);
    if (item.type === 'files') return `${t('clip.files', { count: item.names.length })}, ${when}`;
    if (item.length > 300) return `${when}, ${t('clip.chars', { count: item.length })}`;
    return when;
  }

  function preview(item) {
    if (item.type === 'image') return t('clip.image');
    if (item.type === 'files') {
      const [first, second] = item.names;
      return item.names.length > 2 ? `${first}, ${second}…` : item.names.join(', ');
    }
    return item.text.replace(/\s+/g, ' ').trim();
  }

  function kindIcon(item) {
    if (item.type === 'image') return h('div', { class: 'clip-kind is-thumb' }, h('img', { src: item.thumb, alt: '' }));
    if (item.type === 'files' && item.icon) return h('div', { class: 'clip-kind is-file' }, h('img', { src: item.icon, alt: '' }));
    return h('div', { class: 'clip-kind' }, iconEl(item.type === 'files' ? 'file' : KIND_ICON[item.kind] ?? 'text'));
  }

  function row(item) {
    const pinBtn = h('button', {
      class: 'icon-btn pin-btn',
      type: 'button',
      'aria-label': item.pinned ? t('clip.unpin') : t('clip.pin'),
      title: item.pinned ? t('clip.unpin') : t('clip.pin'),
      onClick: (e) => { e.stopPropagation(); api.clipboard.togglePin(item.id); },
    }, iconEl('pin'));
    const removeBtn = h('button', {
      class: 'icon-btn',
      type: 'button',
      'aria-label': t('clip.remove'),
      title: t('clip.remove'),
      onClick: (e) => { e.stopPropagation(); api.clipboard.remove(item.id); },
    }, iconEl('trash'));

    const el = h('div', {
      class: `clip${item.pinned ? ' is-pinned' : ''}`,
      role: 'listitem',
      tabIndex: 0,
      dataset: { kind: item.type === 'text' ? item.kind : item.type },
      onClick: () => activate(item, el),
      onKeydown: (e) => {
        if (e.key === 'Enter') activate(item, el);
        else if (e.key === 'ArrowDown') { e.preventDefault(); nextRow(el, 'nextElementSibling')?.focus(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); (nextRow(el, 'previousElementSibling') ?? search).focus(); }
        else if (e.key === 'Delete') api.clipboard.remove(item.id);
      },
    },
    kindIcon(item),
    h('div', { class: 'clip-body' }, h('div', { class: 'clip-text' }, preview(item)), h('div', { class: 'clip-meta' }, describe(item))),
    h('div', { class: 'clip-actions' }, pinBtn, removeBtn),
    h('div', { class: 'clip-done', 'aria-hidden': 'true' }, iconEl('check'), t('peek.copied')),
    h('div', { class: 'clip-enter', 'aria-hidden': 'true' }, h('kbd', {}, 'Enter'), t('clip.paste')));
    return el;
  }

  /** Neighbouring entry, skipping the "Recent" header. */
  function nextRow(el, direction) {
    let next = el[direction];
    while (next && !next.classList.contains('clip')) next = next[direction];
    return next;
  }

  function matches(item) {
    if (!query) return true;
    if (item.type === 'image') return t('clip.searchWords.image').includes(query);
    if (item.type === 'files') {
      return t('clip.searchWords.files').includes(query) || item.names.some((n) => n.toLowerCase().includes(query));
    }
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
      ...(pinned.length && recent.length ? [h('div', { class: 'clip-section' }, t('clip.recent'))] : []),
      ...recent.map(row),
    );
    list.querySelector('.clip')?.classList.add('is-target');
    list.scrollTop = scroll;

    count.textContent = items.length ? t('clip.count', { count: items.length }) : '';
    clearBtn.hidden = !recent.length || Boolean(query) || quickPaste;

    list.hidden = !visible.length;
    empty.hidden = Boolean(visible.length);
    if (!visible.length) {
      empty.replaceChildren(...(query
        ? [h('strong', {}, t('clip.nothingFound')), h('p', {}, t('clip.nothingFoundText', { query }))]
        : [
          h('div', { class: 'empty-icon', icon: 'clipboard' }),
          h('strong', {}, t('clip.empty.title')),
          h('p', {}, t('clip.empty.text')),
        ]));
    }
  }

  api.clipboard.onChange((next) => {
    items = next;
    render();
  });

  // Keep "5 min ago" honest while the list is on screen.
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
      search.placeholder = t('clip.pasteHint');
      list.classList.add('is-quick');
      list.scrollTop = 0;
      render();
      setTimeout(() => search.focus(), 60);
    },
    isQuickPaste: () => quickPaste,
  };
}
