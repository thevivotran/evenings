// Shared UI kit. Every screen is composed from these, so a new feature gets the same look for free.
import { $, h, add, icon } from './dom.js';

const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- toast ----------
let toastTimer;
export function toast(msg, kind = '') {
  const t = $('#toast');
  t.className = kind;
  t.textContent = msg;
  requestAnimationFrame(() => t.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
}

// Run an async action, toast errors, and never leave a button stuck busy.
export function act(fn) {
  return async (ev) => {
    const btn = ev && ev.currentTarget instanceof HTMLButtonElement ? ev.currentTarget : null;
    if (btn) { if (btn.disabled) return; btn.disabled = true; btn.classList.add('busy'); }
    try { await fn(ev); } catch (e) { toast(e.message, 'error'); } finally {
      if (btn && btn.isConnected) { btn.disabled = false; btn.classList.remove('busy'); }
    }
  };
}

// ---------- primitives ----------
// kind: primary | secondary | ghost | danger | approve | decline
export function btn(label, { kind = 'secondary', icon: ic, onclick, block, size, attrs = {} } = {}) {
  return h('button', { type: 'button', class: ['btn', kind, block && 'block', size].filter(Boolean).join(' '), onclick, ...attrs },
    ic && icon(ic, size === 'sm' ? 16 : 18), label && h('span', {}, label));
}

export const iconBtn = (name, label, onclick, cls = '') =>
  h('button', { type: 'button', class: `icon-btn ${cls}`, 'aria-label': label, title: label, onclick }, icon(name, 20));

export const pill = ({ key, label }) => h('span', { class: `pill ${key}` }, h('i'), label);

let uid = 0;
export function field(label, control, { hint } = {}) {
  const id = control.id || (control.id = `f${++uid}`);
  return h('div', { class: 'field' }, h('label', { for: id }, label), control, hint && h('p', { class: 'hint' }, hint));
}

export const input = (props = {}) => h('input', { autocomplete: 'off', ...props });

export const section = (title, ...kids) => h('section', { class: 'section' }, title && h('h2', { class: 'eyebrow' }, title), kids);

export const empty = (ic, title, text, action) =>
  h('div', { class: 'empty' }, h('div', { class: 'empty-ico' }, icon(ic, 26)), h('p', { class: 'empty-title' }, title), text && h('p', { class: 'empty-text' }, text), action);

// Grouped list (iOS style). Rows: { icon, label, sub, value, trailing, onclick, danger, color }
export function list(rows) {
  return h('div', { class: 'list' }, rows.filter(Boolean).map((r) => {
    const tag = r.onclick ? 'button' : 'div';
    return h(tag, { class: `list-row${r.onclick ? ' tap' : ''}${r.danger ? ' danger' : ''}`, type: r.onclick ? 'button' : null, onclick: r.onclick },
      r.color ? h('span', { class: 'swatch', style: { background: r.color } }) : r.icon && h('span', { class: 'list-ico' }, icon(r.icon, 20)),
      h('span', { class: 'list-main' }, h('span', { class: 'list-label' }, r.label), r.sub && h('span', { class: 'list-sub' }, r.sub)),
      r.value != null && h('span', { class: 'list-value' }, r.value),
      r.trailing,
      r.onclick && !r.trailing && !r.danger && h('span', { class: 'list-chev' }, icon('chevron', 18)));
  }));
}

// − n + control. `null` shows `emptyLabel` (e.g. "No limit").
export function stepper({ value = null, min = 0, max = 99, emptyLabel = 'None', label = 'Value' } = {}) {
  let v = value;
  const out = h('output', { class: 'stepper-val', 'aria-live': 'polite' });
  const minus = h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Decrease ${label}` }, icon('minus', 18));
  const plus = h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Increase ${label}` }, icon('plus', 18));
  const paint = () => { out.textContent = v == null ? emptyLabel : String(v); out.classList.toggle('none', v == null); minus.disabled = v == null; };
  minus.onclick = () => { v = v == null || v <= min ? null : v - 1; paint(); };
  plus.onclick = () => { v = v == null ? min : Math.min(max, v + 1); paint(); };
  paint();
  return { el: h('div', { class: 'stepper', role: 'group', 'aria-label': label }, minus, out, plus), get value() { return v; } };
}

// Single-choice chips. options: [{ value, label, color? }]
export function chips(options, value, { onchange, label = 'Choose' } = {}) {
  let v = value;
  const els = options.map((o) => h('button', {
    type: 'button', class: 'chip', role: 'radio', 'aria-checked': String(o.value === v),
    onclick: () => { v = o.value; for (const [i, e] of els.entries()) e.setAttribute('aria-checked', String(options[i].value === v)); onchange && onchange(v); },
  }, o.color && h('span', { class: 'swatch sm', style: { background: o.color } }), o.label));
  return { el: h('div', { class: 'chips', role: 'radiogroup', 'aria-label': label }, els), get value() { return v; }, set(x) { v = x; els.forEach((e, i) => e.setAttribute('aria-checked', String(options[i].value === v))); } };
}

// Multi-name picker: typed names become removable tokens; known names are offered as one-tap suggestions.
// `value` also includes a half-typed name, so nothing is lost if Save is tapped mid-word.
export function peopleInput({ value = [], known = [], placeholder = 'Add a name', label = 'People' } = {}) {
  let names = [...value];
  const has = (n) => names.some((x) => x.toLowerCase() === n.toLowerCase());
  const text = h('input', { autocomplete: 'off', placeholder, maxlength: '60', enterkeyhint: 'done', 'aria-label': label, class: 'people-text' });
  const chosen = h('span', { class: 'token-list' });
  const tokens = h('div', { class: 'people-tokens' }, chosen, text); // the text box never moves, so it keeps focus
  const sugg = h('div', { class: 'chips people-sugg', 'aria-label': 'Suggestions' });
  const paint = () => {
    chosen.replaceChildren(...names.map((n) => h('span', { class: 'token' }, h('span', {}, n),
      h('button', { type: 'button', class: 'token-x', 'aria-label': `Remove ${n}`, onclick: () => { names = names.filter((x) => x !== n); paint(); } }, icon('close', 14)))));
    const q = text.value.trim().toLowerCase();
    const opts = known.filter((n) => !has(n) && (!q || n.toLowerCase().includes(q))).slice(0, 8);
    sugg.replaceChildren(...opts.map((n) => h('button', {
      type: 'button', class: 'chip', onmousedown: (e) => e.preventDefault(), // keep focus, so blur doesn't commit "Tu" before "Tuan"
      onclick: () => { push(n); text.value = ''; paint(); text.focus(); },
    }, `+ ${n}`)));
    sugg.hidden = !opts.length;
  };
  const push = (n) => { n = n.replace(/\s+/g, ' ').trim(); if (n && !has(n)) names.push(n); };
  const commit = () => { for (const part of text.value.split(',')) push(part); text.value = ''; paint(); };
  text.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit(); text.focus(); }
    else if (e.key === 'Backspace' && !text.value && names.length) { names.pop(); paint(); text.focus(); }
  });
  text.addEventListener('input', () => { if (text.value.includes(',')) { commit(); text.focus(); } else paint(); });
  text.addEventListener('blur', () => { if (text.value.trim()) commit(); });
  tokens.addEventListener('click', (e) => { if (e.target === tokens || e.target === chosen) text.focus(); });
  paint();
  return {
    el: h('div', { class: 'people-input' }, tokens, sugg),
    input: text,
    get value() { const typed = text.value.trim(); return typed && !has(typed) ? [...names, typed] : [...names]; },
    add(list) { for (const n of list) push(n); paint(); },
    get empty() { return !names.length && !text.value.trim(); },
  };
}

export function segmented(options, value, onchange) {
  const els = options.map(([k, label]) => h('button', { type: 'button', 'aria-pressed': String(k === value), onclick: () => {
    els.forEach((e, i) => e.setAttribute('aria-pressed', String(options[i][0] === k))); onchange(k);
  } }, label));
  return h('div', { class: 'seg' }, els);
}

// ---------- sheet ----------
// openSheet(build, { live }) where build() -> { title, sub?, body: [...], footer: [...] } (may be async).
// Live sheets are rebuilt by refreshSheet() when data changes; form sheets are not, so typing is never lost.
const sheet = $('#sheet');
let current = null;

sheet.addEventListener('cancel', (e) => { e.preventDefault(); closeSheet(); });
sheet.addEventListener('click', (e) => { if (e.target === sheet && outside(e, sheet)) closeSheet(); });
sheet.addEventListener('close', () => { current = null; sheet.classList.remove('closing'); });

function outside(e, el) {
  const r = el.getBoundingClientRect();
  return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
}

export async function openSheet(build, { live = false } = {}) {
  current = { build, live };
  await paintSheet(true);
}

export async function refreshSheet() {
  if (current && current.live && sheet.open) await paintSheet(false);
}

export const sheetOpen = () => sheet.open;

async function paintSheet(first) {
  const mine = current;
  let spec;
  try { spec = await mine.build(); } catch (e) { toast(e.message, 'error'); if (first) closeSheet(); return; }
  if (current !== mine || !spec) return;
  const body = $('.sheet-body', sheet);
  const keep = body && !first ? body.scrollTop : 0;
  const foot = (spec.footer || []).flat(Infinity).filter(Boolean);
  sheet.replaceChildren();
  add(sheet,
    h('div', { class: 'grabber', 'aria-hidden': 'true' }),
    h('header', { class: 'sheet-head' },
      h('div', { class: 'sheet-titles' }, spec.sub, h('h2', { tabindex: '-1', autofocus: true }, spec.title)),
      iconBtn('close', 'Close', closeSheet, 'sheet-x')),
    h('div', { class: 'sheet-body' }, spec.body),
    foot.length > 0 && h('footer', { class: 'sheet-foot' }, foot));
  $('.sheet-body', sheet).scrollTop = keep;
  sheet.classList.remove('closing'); // re-opened mid close animation: cancel the pending close
  if (!sheet.open) { sheet.showModal(); $('h2', sheet).focus({ preventScroll: true }); }
  enableDrag();
}

export function closeSheet() {
  current = null;
  if (!sheet.open) return;
  if (reduceMotion()) return sheet.close();
  sheet.classList.add('closing');
  sheet.addEventListener('animationend', () => { if (sheet.classList.contains('closing')) sheet.close(); }, { once: true });
}

// Drag the grabber/header down to dismiss (mobile bottom sheet only).
function enableDrag() {
  const handle = [$('.grabber', sheet), $('.sheet-head', sheet)];
  let y0 = null, t0 = 0, dy = 0;
  const move = (e) => {
    if (y0 == null) return;
    dy = Math.max(0, e.clientY - y0);
    sheet.style.transform = `translateY(${dy}px)`;
  };
  const up = () => {
    if (y0 == null) return;
    const fast = dy / Math.max(1, performance.now() - t0) > 0.6;
    sheet.style.transition = 'transform .2s var(--ease)';
    if (dy > 110 || (fast && dy > 30)) { sheet.style.transform = 'translateY(100%)'; setTimeout(() => { sheet.close(); sheet.style.transform = ''; sheet.style.transition = ''; }, 190); } else { sheet.style.transform = ''; setTimeout(() => { sheet.style.transition = ''; }, 200); }
    y0 = null; dy = 0;
    window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
  };
  for (const el of handle) {
    el.addEventListener('pointerdown', (e) => {
      if (!matchMedia('(max-width: 639px)').matches || e.target.closest('button')) return;
      y0 = e.clientY; t0 = performance.now(); sheet.style.transition = 'none';
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
    });
  }
}

// Styled replacement for window.confirm(). Resolves true/false.
export function confirmSheet({ title, message, confirm = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    const d = h('dialog', { class: 'sheet confirm' });
    const done = (v) => {
      resolve(v);
      if (reduceMotion()) { d.close(); d.remove(); return; }
      d.classList.add('closing');
      d.addEventListener('animationend', () => { d.close(); d.remove(); }, { once: true });
    };
    d.addEventListener('cancel', (e) => { e.preventDefault(); done(false); });
    d.addEventListener('click', (e) => { if (e.target === d && outside(e, d)) done(false); });
    add(d,
      h('div', { class: 'confirm-body' }, h('h2', { tabindex: '-1' }, title), message && h('p', {}, message)),
      h('footer', { class: 'sheet-foot' },
        btn('Cancel', { onclick: () => done(false) }),
        btn(confirm, { kind: danger ? 'danger' : 'primary', onclick: () => done(true) })));
    document.body.append(d);
    d.showModal();
    $('h2', d).focus({ preventScroll: true });
  });
}
