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
  timer: stroke('<circle cx="12" cy="13.5" r="7.5"/><path d="M12 13.5V9.5M9.8 2.8h4.4M18.4 6.6l1.3-1.3"/>'),
  calendar: stroke('<rect x="3.5" y="5" width="17" height="15.5" rx="3.2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'),
  gauge: stroke('<path d="M4.3 17.5a8.5 8.5 0 1 1 15.4 0"/><path d="m12 14.6 3.8-4.3"/><circle cx="12" cy="15" r="1.3" fill="currentColor"/>'),
  note: stroke('<path d="M11.5 4.5h-5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-5"/><path d="M17.6 3.6a1.9 1.9 0 0 1 2.7 2.7L12.5 14l-3.6.9.9-3.6z"/>'),
  moon: fill('<path d="M20.2 14.6A8.3 8.3 0 0 1 9.4 3.8a.6.6 0 0 0-.8-.7 9 9 0 1 0 12.3 12.3.6.6 0 0 0-.7-.8z"/>'),
  speaker: stroke('<path d="M4 9.5h3.4l4.6-4v13l-4.6-4H4z"/><path d="M15.6 9.2a4 4 0 0 1 0 5.6M18.2 6.6a7.6 7.6 0 0 1 0 10.8"/>'),
  speakerOff: stroke('<path d="M4 9.5h3.4l4.6-4v13l-4.6-4H4z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/>'),
  chevronLeft: stroke('<path d="M14.5 5.5 8 12l6.5 6.5"/>'),
  chevronRight: stroke('<path d="m9.5 5.5 6.5 6.5-6.5 6.5"/>'),
  cpu: stroke('<rect x="6" y="6" width="12" height="12" rx="2.2"/><rect x="9.5" y="9.5" width="5" height="5" rx="1"/><path d="M9.5 3v3M14.5 3v3M9.5 18v3M14.5 18v3M3 9.5h3M3 14.5h3M18 9.5h3M18 14.5h3"/>'),
  memory: stroke('<rect x="3" y="7" width="18" height="9.5" rx="2"/><path d="M7.5 10.5v2.5M12 10.5v2.5M16.5 10.5v2.5M6 16.5V19M18 16.5V19"/>'),
  disk: stroke('<rect x="3.5" y="12.5" width="17" height="7" rx="2.2"/><path d="m5 12.5 2.2-6.1A2 2 0 0 1 9.1 5h5.8a2 2 0 0 1 1.9 1.4l2.2 6.1"/><circle cx="16.5" cy="16" r="1" fill="currentColor"/>'),
  network: stroke('<path d="M8 4.5V19M4.6 15.6 8 19l3.4-3.4M16 19.5V5M12.6 8.4 16 5l3.4 3.4"/>'),
  battery: stroke('<rect x="2.5" y="7" width="17" height="10" rx="2.6"/><path d="M22 10.5v3"/>'),
  bolt: fill('<path d="M13.4 2.6 5.6 13.4a.5.5 0 0 0 .4.8h4.8l-1.3 7a.4.4 0 0 0 .7.3l7.8-10.8a.5.5 0 0 0-.4-.8h-4.8l1.3-7a.4.4 0 0 0-.7-.3z"/>'),
  clock: stroke('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
  pointer: stroke('<path d="M6 3.8v14.6l4-3.9 2.9 6 2.5-1.2-2.9-5.9H18z"/>'),
  skip: fill('<path d="M5 6.2v11.6a1 1 0 0 0 1.6.8l8.1-5.8a1 1 0 0 0 0-1.6L6.6 5.4A1 1 0 0 0 5 6.2z"/><rect x="16.6" y="5.5" width="2.8" height="13" rx="1.2"/>'),
  reset: stroke('<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 4v4.5H9"/>'),
};

export function icon(name) {
  return ICONS[name] ?? '';
}
