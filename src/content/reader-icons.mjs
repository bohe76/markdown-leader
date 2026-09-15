const paths = {
  type: '<path d="m3 14 4-10 4 10M4.6 10h4.8M13 11h8l-8 9h8"/>',
  panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
  recent: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z"/>',
  note: '<path d="M4 4h16v12H9l-5 4V4Z"/><path d="M8 8h8M8 12h5"/>',

  folder: '<path d="M3 6h6l2 2h10l-3 11H3V6Zm0 2V4h6l2 2h8v2"/>',
  file: '<path d="M6 3h8l4 4v14H6V3Zm8 0v5h4M9 12h6m-6 4h6"/>',
  files: '<path d="M8 3h9v14H8zM5 7H3v14h10v-2"/>',
  toc: '<path d="M8 5h13M8 12h13M8 19h13M3 5h1M3 12h1M3 19h1"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  settings: '<path d="m10 3-.6 2.2-2 .9-2-.7-2 3.4 1.7 1.5v2.4L3.4 14l2 3.4 2-.7 2 .9L10 20h4l.6-2.4 2-.9 2 .7 2-3.4-1.7-1.3v-2.4l1.7-1.5-2-3.4-2 .7-2-.9L14 3Z"/><circle cx="12" cy="11.5" r="3"/>',
}

export function readerIcon(name) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || ''}</svg>`
}
