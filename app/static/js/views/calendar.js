import { h, icon, plural } from '../dom.js';
import { ymd, parse, hhmm, WD, MON, MONTHS, longDay, relDay } from '../dates.js';
import { state, isHost, emit, statusOf, isLive, pending, live, upcoming, byDay } from '../store.js';
import { pill, btn, empty } from '../ui.js';
import { openGathering, openForm } from './gathering.js';

const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

function go(month, selected) {
  if (month) state.month = month;
  if (selected) state.selected = selected;
  state.resetAgendaScroll = true;
  emit();
}

function shiftMonth(delta) {
  const m = new Date(state.month.getFullYear(), state.month.getMonth() + delta, 1);
  state.slide = delta > 0 ? 'next' : 'prev';
  go(m);
}

// ---------- agenda row ----------
export function eventRow(g, { showDate = false } = {}) {
  const d = parse(g.start);
  const beers = g.beers.total;
  const meta = [
    showDate && hhmm(d),
    g.group_name,
    g.location,
    beers > 0 && plural(beers, 'beer'),
  ].filter(Boolean).join(' · ');
  return h('button', { type: 'button', class: 'ev', style: { '--c': g.group_color || 'var(--faint)' }, onclick: () => openGathering(g.id) },
    h('span', { class: 'ev-when' }, showDate ? [h('b', {}, String(d.getDate())), h('small', {}, `${WD[d.getDay()]}`)] : h('b', { class: 'time' }, hhmm(d))),
    h('span', { class: 'ev-main' },
      h('span', { class: 'ev-title' }, g.title),
      h('span', { class: 'ev-meta' }, pill(statusOf(g)), meta && h('span', { class: 'ev-sub' }, meta))),
    h('span', { class: 'ev-chev' }, icon('chevron', 18)));
}

// ---------- "under way" hero ----------
function nowCard(g) {
  const total = g.beers.total, limit = g.drink_limit;
  const frac = limit ? Math.min(1, total / Math.max(1, limit)) : 0;
  const tone = limit != null && total > limit ? 'over' : limit != null && total === limit ? 'warn' : '';
  return h('button', { type: 'button', class: `now ${tone}`, onclick: () => openGathering(g.id) },
    h('span', { class: 'now-top' }, h('span', { class: 'live-dot' }), 'Under way', h('span', { class: 'now-since' }, `since ${hhmm(parse(g.started_at.replace(' ', 'T')))}`)),
    h('span', { class: 'now-title' }, g.title),
    h('span', { class: 'now-count' }, h('b', {}, String(total)), limit != null ? ` of ${limit} beers` : ` ${total === 1 ? 'beer' : 'beers'}`),
    limit != null && h('span', { class: 'meter' }, h('i', { style: { width: `${frac * 100}%` } })),
    g.conditions && h('span', { class: 'now-cond' }, icon('shield', 14), g.conditions));
}

// ---------- month grid ----------
function grid(days) {
  const y = state.month.getFullYear(), m = state.month.getMonth();
  const first = new Date(y, m, 1);
  const offset = (first.getDay() + 6) % 7; // Monday first
  const today = ymd(new Date());
  const cells = DOW.map((d, i) => h('div', { class: `dow${i > 4 ? ' we' : ''}`, 'aria-hidden': 'true' }, d));
  // Always six weeks, so the card never changes height between months.
  for (let i = 0; i < 42; i++) {
    const d = new Date(y, m, 1 - offset + i);
    const key = ymd(d);
    const list = days[key] || [];
    const out = d.getMonth() !== m;
    const cls = ['day', out && 'out', key === today && 'today', key === state.selected && 'sel', key < today && 'past', i % 7 > 4 && 'we'].filter(Boolean).join(' ');
    cells.push(h('button', {
      type: 'button', class: cls, 'aria-pressed': String(key === state.selected),
      'aria-label': `${WD[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}${list.length ? `, ${plural(list.length, 'gathering')}` : ''}${key === today ? ', today' : ''}`,
      onclick: () => go(out ? new Date(d.getFullYear(), d.getMonth(), 1) : null, key),
    }, h('span', { class: 'n' }, String(d.getDate())),
    h('span', { class: 'dots' }, list.slice(0, 3).map((g) => h('i', { class: `dot ${statusOf(g).key}` })))));
  }
  const el = h('div', { class: `grid${state.slide ? ` slide-${state.slide}` : ''}` }, cells);
  state.slide = null;
  swipe(el);
  return el;
}

// Horizontal swipe on the grid changes month.
function swipe(el) {
  let x0 = null, y0 = 0;
  el.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') { x0 = e.clientX; y0 = e.clientY; } });
  el.addEventListener('pointerup', (e) => {
    if (x0 == null) return;
    const dx = e.clientX - x0, dy = e.clientY - y0;
    x0 = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) shiftMonth(dx < 0 ? 1 : -1);
  });
  el.addEventListener('pointercancel', () => { x0 = null; });
}

function defaultFormDate() {
  return state.selected >= ymd(new Date()) ? state.selected : null;
}

export const calendarView = {
  fab: () => isHost() && h('button', { type: 'button', class: 'fab', 'aria-label': 'New request', onclick: () => openForm(null, { date: defaultFormDate() }) }, icon('plus', 26)),

  render() {
    const y = state.month.getFullYear(), m = state.month.getMonth();
    const days = byDay();
    const now = new Date();
    const isThisMonth = now.getFullYear() === y && now.getMonth() === m && state.selected === ymd(now);

    const card = h('section', { class: 'cal-card' },
      h('header', { class: 'cal-head' },
        h('h1', { 'aria-live': 'polite' }, MONTHS[m], h('span', {}, String(y))),
        h('div', { class: 'cal-nav' },
          !isThisMonth && h('button', { type: 'button', class: 'today-btn', onclick: () => go(new Date(now.getFullYear(), now.getMonth(), 1), ymd(now)) }, 'Today'),
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Previous month', onclick: () => shiftMonth(-1) }, icon('left', 20)),
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Next month', onclick: () => shiftMonth(1) }, icon('right', 20)))),
      grid(days));

    const sel = days[state.selected] || [];
    const selDate = new Date(`${state.selected}T00:00`);
    const lives = live();
    const waiting = pending().filter((g) => !sel.includes(g));
    const next = upcoming().filter((g) => !sel.includes(g));
    const canPlan = isHost() && state.selected >= ymd(now);

    // A live gathering shows as the hero card: inside its own day if that day is selected, else pinned on top.
    const panel = h('div', { class: 'cal-panel' },
      lives.filter((g) => !sel.includes(g)).map(nowCard),
      h('section', { class: 'section' },
        h('h2', { class: 'eyebrow' }, dayHeading(selDate)),
        sel.length
          ? [sel.filter(isLive).map(nowCard), sel.some((g) => !isLive(g)) && h('div', { class: 'card-list' }, sel.filter((g) => !isLive(g)).map((g) => eventRow(g)))]
          : empty('calendar', 'A free evening', canPlan ? 'Nothing planned yet.' : 'Nothing planned for this day.',
            canPlan && btn('Plan something', { kind: 'secondary', size: 'sm', icon: 'plus', onclick: () => openForm(null, { date: state.selected }) }))),
      waiting.length > 0 && h('section', { class: 'section' },
        h('h2', { class: 'eyebrow' }, isHost() ? 'Awaiting her reply' : 'Needs your reply', h('span', { class: 'count-badge' }, String(waiting.length))),
        h('div', { class: 'card-list' }, waiting.map((g) => eventRow(g, { showDate: true })))),
      next.length > 0 && h('section', { class: 'section' },
        h('h2', { class: 'eyebrow' }, 'Coming up'),
        h('div', { class: 'card-list' }, next.map((g) => eventRow(g, { showDate: true })))));

    return h('div', { class: 'cal-layout' }, card, panel);
  },
};

// "Today · Wed 11 Nov", or just "Sat 14 Nov".
function dayHeading(d) {
  const rel = relDay(d), long = longDay(d);
  return rel === long ? long : `${rel} · ${long}`;
}
