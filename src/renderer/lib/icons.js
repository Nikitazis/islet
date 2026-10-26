// Hand-drawn icons in the spirit of SF Symbols. Strings are static markup only.

const stroke = (body) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const fill = (body) => `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${body}</svg>`;

const ICONS = {
  play: fill('<path d="M7.5 4.9v14.2a1.1 1.1 0 0 0 1.67.94l11.4-7.1a1.1 1.1 0 0 0 0-1.88L9.17 3.96A1.1 1.1 0 0 0 7.5 4.9z"/>'),
  pause: fill('<rect x="5.5" y="4" width="4.6" height="16" rx="1.4"/><rect x="13.9" y="4" width="4.6" height="16" rx="1.4"/>'),
  next: fill('<path d="M2.5 6.6v10.8a1 1 0 0 0 1.56.83l7.44-5V17.4a1 1 0 0 0 1.56.83l8.1-5.4a1 1 0 0 0 0-1.66l-8.1-5.4a1 1 0 0 0-1.56.83v4.16l-7.44-5a1 1 0 0 0-1.56.83z"/>'),
  prev: fill('<path d="M21.5 6.6v10.8a1 1 0 0 1-1.56.83l-7.44-5V17.4a1 1 0 0 1-1.56.83l-8.1-5.4a1 1 0 0 1 0-1.66l8.1-5.4a1 1 0 0 1 1.56.83v4.16l7.44-5a1 1 0 0 1 1.56.83z"/>'),
  music: stroke('<path d="M9 18V5.5l11-2V16"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>'),
  video: stroke('<rect x="2.8" y="5" width="18.4" height="14" rx="3.6"/><path d="M10 9.3v5.4l4.6-2.7z" fill="currentColor"/>'),
  clipboard: stroke('<rect x="5" y="4.2" width="14" height="16.8" rx="3"/><path d="M9 4.6v-.8c0-.7.6-1.3 1.3-1.3h3.4c.7 0 1.3.6 1.3 1.3v.8"/><path d="M9 10.5h6M9 14.5h4"/>'),
  bookmark: stroke('<path d="M7 3.5h10A1.5 1.5 0 0 1 18.5 5v15.1a.6.6 0 0 1-.95.49L12 16.8l-5.55 3.79a.6.6 0 0 1-.95-.49V5A1.5 1.5 0 0 1 7 3.5z"/>'),
  sliders: stroke('<path d="M4 7h9.5M18.5 7H20M4 17h3.5M12.5 17H20"/><circle cx="16" cy="7" r="2.3"/><circle cx="10" cy="17" r="2.3"/>'),
  search: stroke('<circle cx="10.8" cy="10.8" r="6.3"/><path d="M15.6 15.6 20 20"/>'),
  pin: stroke('<path d="M9.2 3.5h5.6l-.9 5.6 2.9 3.2H7.2l2.9-3.2z"/><path d="M12 12.3v8.2"/>'),
  trash: stroke('<path d="M4.5 6.5h15M9.5 6.5V4.8c0-.7.6-1.3 1.3-1.3h2.4c.7 0 1.3.6 1.3 1.3v1.7M6.5 6.5l.8 12.2c.1 1 .9 1.8 1.9 1.8h5.6c1 0 1.8-.8 1.9-1.8l.8-12.2"/>'),
  plus: stroke('<path d="M12 5v14M5 12h14"/>'),
  close: stroke('<path d="M7 7l10 10M17 7 7 17"/>'),
  check: stroke('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
  link: stroke('<path d="M10 14a4 4 0 0 0 5.66 0l3-3A4 4 0 0 0 13 5.34l-1 1"/><path d="M14 10a4 4 0 0 0-5.66 0l-3 3A4 4 0 0 0 11 18.66l1-1"/>'),
  text: stroke('<path d="M5 6.5h14M5 10.5h14M5 14.5h9M5 18.5h6"/>'),
  photo: stroke('<rect x="3" y="5" width="18" height="14" rx="3.2"/><circle cx="9" cy="10" r="1.6"/><path d="m20.5 15.5-4.8-4.3L8 18.6"/>'),
  folder: stroke('<path d="M3.5 7.5a2 2 0 0 1 2-2h3.6l2 2h7.4a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>'),
  file: stroke('<path d="M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M14 3v5h5"/>'),
};

export function icon(name) {
  return ICONS[name] ?? '';
}
