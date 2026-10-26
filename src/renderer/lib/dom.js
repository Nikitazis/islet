import { icon } from './icons.js';

/**
 * Tiny element factory. User content always goes in as text nodes;
 * `icon` is the only way markup gets in, and it comes from our own icon set.
 */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'icon') el.innerHTML = icon(value);
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key.startsWith('aria-') || key.startsWith('data-') || key === 'role') el.setAttribute(key, value);
    else if (key in el) el[key] = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

export const $ = (selector, root = document) => root.querySelector(selector);

/** A standalone <svg> element from the icon set. */
export function iconEl(name) {
  const template = document.createElement('template');
  template.innerHTML = icon(name);
  return template.content.firstElementChild;
}
