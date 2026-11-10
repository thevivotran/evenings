// DOM is built with createElement only (no innerHTML anywhere).
export const $ = (s, r = document) => r.querySelector(s);
const SVGNS = 'http://www.w3.org/2000/svg';

export function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  let value;
  for (const [k, v] of Object.entries(props || {})) {
    if (v === false || v == null) continue;
    if (k === 'class') e.className = v;
    else if (k === 'value') value = v;
    else if (k === 'checked' || k === 'selected' || k === 'disabled') e[k] = !!v;
    else if (k === 'style' && typeof v === 'object') { for (const [p, x] of Object.entries(v)) e.style.setProperty(p.startsWith('--') ? p : p.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`), x); }
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  add(e, ...kids);
  if (value !== undefined) e.value = value;
  return e;
}

// Append children, skipping null/false and flattening arrays (so `cond && node` is safe).
export function add(root, ...kids) {
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    root.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  return root;
}

// 24px line icons, 1.6 stroke. Add a path here to use a new icon anywhere.
const ICONS = {
  calendar: 'M7 3v3M17 3v3M4.5 9.5h15M5.5 5h13a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z',
  groups: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3.5 19c0-2.8 2.5-4.5 5.5-4.5s5.5 1.7 5.5 4.5M16 5.6a3 3 0 0 1 0 5.4M18 14.6c1.7.6 2.8 2 2.8 4.4',
  settings: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 4.5v5M9 14.5v5',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  left: 'M14.5 5l-7 7 7 7',
  right: 'M9.5 5l7 7-7 7',
  chevron: 'M10 6.5l5.5 5.5-5.5 5.5',
  close: 'M6.5 6.5l11 11M17.5 6.5l-11 11',
  undo: 'M9 14L4.5 9.5 9 5M4.5 9.5H14a5.5 5.5 0 0 1 0 11h-3',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7.5V12l3 2',
  pin: 'M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  people: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3.5 19c0-2.8 2.5-4.5 5.5-4.5s5.5 1.7 5.5 4.5M16 5.6a3 3 0 0 1 0 5.4M18 14.6c1.7.6 2.8 2 2.8 4.4',
  car: 'M5 16.5h14M6.5 16.5V19M17.5 16.5V19M4.5 16.5v-4l2-5h11l2 5v4M4.5 12.5h15M8 14.5h.01M16 14.5h.01',
  note: 'M6 3.5h8l4 4v13H6zM14 3.5v4h4M9 12h6M9 15.5h4',
  glass: 'M7 4h10l-1.2 15a1 1 0 0 1-1 .9H9.2a1 1 0 0 1-1-.9zM7.5 9h9',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  shield: 'M12 3.5l7 2.5v5.5c0 4.5-3 7.8-7 9-4-1.2-7-4.5-7-9V6z',
  tag: 'M3.5 12.5V4.5h8l9 9-8 8zM8 8.5h.01',
  bell: 'M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  copy: 'M9 9h10v11H9zM5 15V4h10',
  logout: 'M14 4.5h4.5v15H14M10 8l-4 4 4 4M6 12h9.5',
  trash: 'M4.5 6.5h15M9.5 6.5V4.5h5v2M6.5 6.5l1 13h9l1-13M10 10.5v6M14 10.5v6',
  home: 'M4.5 11L12 4.5l7.5 6.5M6.5 9.5V19.5h11V9.5',
  edit: 'M14.5 5.5l4 4L8 20H4v-4zM12.5 7.5l4 4',
  play: 'M8 5.5v13l10.5-6.5z',
};

export function icon(name, size = 22) {
  const s = document.createElementNS(SVGNS, 'svg');
  const attrs = { viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', class: 'ico' };
  for (const [k, v] of Object.entries(attrs)) s.setAttribute(k, v);
  const p = document.createElementNS(SVGNS, 'path');
  p.setAttribute('d', ICONS[name] || '');
  s.append(p);
  return s;
}

// Circular progress ring (0..1). Used for the beer counter; reusable for any "x of y" meter.
export function ring(fraction, cls = '') {
  const r = 52, c = 2 * Math.PI * r;
  const s = document.createElementNS(SVGNS, 'svg');
  for (const [k, v] of Object.entries({ viewBox: '0 0 120 120', class: `ring ${cls}`, 'aria-hidden': 'true' })) s.setAttribute(k, v);
  const track = document.createElementNS(SVGNS, 'circle');
  const bar = document.createElementNS(SVGNS, 'circle');
  for (const el of [track, bar]) { el.setAttribute('cx', 60); el.setAttribute('cy', 60); el.setAttribute('r', r); }
  track.setAttribute('class', 'ring-track');
  bar.setAttribute('class', 'ring-bar');
  bar.setAttribute('stroke-dasharray', `${c} ${c}`);
  bar.setAttribute('stroke-dashoffset', String(c * (1 - Math.max(0, Math.min(1, fraction)))));
  s.append(track, bar);
  return s;
}

export const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
export const haptic = (ms = 8) => { try { navigator.vibrate && navigator.vibrate(ms); } catch (_) { /* unsupported */ } };
