'use strict';

// ---------- tiny helpers (DOM is built with createElement only) ----------
const $ = (s, r = document) => r.querySelector(s);
const SVGNS = 'http://www.w3.org/2000/svg';

function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  let value;
  for (const [k, v] of Object.entries(props || {})) {
    if (v === false || v == null) continue;
    if (k === 'class') e.className = v;
    else if (k === 'value') value = v;
    else if (k === 'checked' || k === 'selected' || k === 'disabled') e[k] = !!v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  add(e, ...kids);
  if (value !== undefined) e.value = value;
  return e;
}

// Append children, skipping null/false and flattening arrays (so `cond && node` is safe).
function add(root, ...kids) {
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    root.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}

const ICONS = {
  calendar: 'M7 3v3M17 3v3M4.5 9.5h15M5.5 5h13a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z',
  groups: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3.5 19c0-2.8 2.5-4.5 5.5-4.5s5.5 1.7 5.5 4.5M16 5.6a3 3 0 0 1 0 5.4M18 14.6c1.7.6 2.8 2 2.8 4.4',
  settings: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 4.5v5M9 14.5v5',
  plus: 'M12 5v14M5 12h14',
  left: 'M14.5 5l-7 7 7 7',
  right: 'M9.5 5l7 7-7 7',
  close: 'M6.5 6.5l11 11M17.5 6.5l-11 11',
  undo: 'M9 14L4.5 9.5 9 5M4.5 9.5H14a5.5 5.5 0 0 1 0 11h-3',
};
function icon(name, size = 22) {
  const s = document.createElementNS(SVGNS, 'svg');
  for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) s.setAttribute(k, v);
  const p = document.createElementNS(SVGNS, 'path');
  p.setAttribute('d', ICONS[name]);
  s.append(p);
  return s;
}

async function api(method, url, body) {
  const r = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = await r.json().catch(() => ({}));
  if (r.status === 401 && url !== '/api/login') {
    state.role = null;
    renderLogin();
    throw new Error('Please sign in');
  }
  if (!r.ok) {
    const d = data.detail;
    throw new Error(typeof d === 'string' ? d : (d && d[0] && d[0].msg) || 'Something went wrong');
  }
  return data;
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

// Run an async action, toast errors, and never leave a button stuck disabled.
function act(fn) {
  return async (ev) => {
    const btn = ev && ev.currentTarget;
    if (btn) btn.disabled = true;
    try { await fn(ev); } catch (e) { toast(e.message); } finally { if (btn && btn.isConnected) btn.disabled = false; }
  };
}

// ---------- dates ----------
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s) => new Date(s);
const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const longDay = (d) => `${WD[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`;
const whenText = (s) => { const d = parse(s); return `${longDay(d)} · ${hhmm(d)}`; };

// ---------- state ----------
const state = {
  role: null, tab: 'calendar', month: new Date(), selected: ymd(new Date()),
  gatherings: [], groups: [], beerTypes: [], stats: null, openId: null,
};
state.month.setDate(1);

const isHost = () => state.role === 'host';

function statusInfo(g) {
  if (g.started_at && !g.ended_at) return ['live', 'Under way'];
  if (g.ended_at) return ['approved', 'Completed'];
  switch (g.status) {
    case 'pending': return ['pending', isHost() ? 'Awaiting reply' : 'Needs your reply'];
    case 'approved': return ['approved', 'Approved'];
    case 'declined': return ['declined', 'Declined'];
    default: return ['expired', 'No reply'];
  }
}
const status = (g) => { const [c, t] = statusInfo(g); return h('span', { class: `status ${c}` }, h('i'), t); };

// ---------- boot / login ----------
async function boot() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  const me = await fetch('/api/me').then((r) => r.json()).catch(() => ({ role: null }));
  state.role = me.role;
  if (!state.role) return renderLogin();
  await loadAll();
  render();
}

function renderLogin() {
  let role = 'host';
  const pin = h('input', { class: 'pin', type: 'password', inputmode: 'numeric', autocomplete: 'current-password', 'aria-label': 'PIN', placeholder: '••••' });
  const picks = { host: h('button', { class: 'on' }, 'Me'), wife: h('button', {}, 'Wife') };
  const choose = (r) => { role = r; for (const k in picks) picks[k].classList.toggle('on', k === r); pin.focus(); };
  picks.host.onclick = () => choose('host');
  picks.wife.onclick = () => choose('wife');
  const go = act(async () => {
    await api('POST', '/api/login', { role, pin: pin.value });
    state.role = role;
    await loadAll();
    render();
  });
  pin.addEventListener('keydown', (e) => { if (e.key === 'Enter') go({ currentTarget: null }); });
  $('#app').replaceChildren(h('div', { class: 'login' },
    h('h1', {}, 'Evenings'),
    h('p', {}, 'Who is looking?'),
    h('div', { class: 'seg' }, picks.host, picks.wife),
    pin,
    h('button', { class: 'btn primary', onclick: go }, 'Continue')));
}

async function loadAll() {
  const [g, groups, bt] = await Promise.all([api('GET', '/api/gatherings'), api('GET', '/api/groups'), api('GET', '/api/beer-types')]);
  state.gatherings = g; state.groups = groups; state.beerTypes = bt;
}

async function reload() {
  state.gatherings = await api('GET', '/api/gatherings');
  if (state.tab === 'groups') state.stats = await api('GET', '/api/stats');
  render();
  if (state.openId && $('#sheet').open) await refreshSheet();
}

// ---------- shell ----------
function render() {
  const prevPanel = $('.cal-panel');
  const keepScroll = prevPanel && state.tab === 'calendar' ? prevPanel.scrollTop : 0;
  $('#app').classList.toggle('cal', state.tab === 'calendar');
  const tabs = [['calendar', 'calendar', 'Calendar'], ['groups', 'groups', 'Groups'], ['settings', 'settings', 'Settings']];
  const main = h('main', {});
  if (state.tab === 'calendar') renderCalendar(main);
  else if (state.tab === 'groups') renderGroups(main);
  else renderSettings(main);

  $('#app').replaceChildren(h('div', {},
    main,
    isHost() && state.tab === 'calendar' && h('button', { class: 'fab', 'aria-label': 'New request', onclick: () => openForm() }, icon('plus', 24)),
    h('nav', { class: 'tabs' }, tabs.map(([k, ic, label]) => h('button', {
      class: state.tab === k ? 'on' : '', 'aria-label': label, onclick: async () => {
        state.tab = k;
        if (k === 'groups') state.stats = await api('GET', '/api/stats').catch(() => null);
        render();
      },
    }, icon(ic, 23), label)))));
  const panel = $('.cal-panel');
  if (panel && keepScroll && state.keepAgendaScroll !== false) panel.scrollTop = keepScroll;
  state.keepAgendaScroll = true;
}

// ---------- calendar ----------
function row(g, showDate) {
  const d = parse(g.start);
  const beers = g.beers.total;
  return h('button', { class: 'row', onclick: () => openSheet(g.id) },
    h('div', { class: `when${showDate ? '' : ' time'}` }, showDate ? [String(d.getDate()), h('small', {}, WD[d.getDay()])] : hhmm(d)),
    h('div', { class: 'title' }, g.title),
    status(g),
    h('div', { class: 'meta' },
      showDate && `${hhmm(d)} · `,
      g.group_name && [h('span', { class: 'gdot', style: `background:${g.group_color}` }), g.group_name],
      g.group_name && g.location && ' · ', g.location,
      beers > 0 && ` · ${beers} beer${beers === 1 ? '' : 's'}`));
}

function renderCalendar(root) {
  const y = state.month.getFullYear(), m = state.month.getMonth();
  const byDay = {};
  for (const g of state.gatherings) (byDay[ymd(parse(g.start))] ||= []).push(g);

  const offset = (new Date(y, m, 1).getDay() + 6) % 7; // Monday first
  const daysIn = new Date(y, m + 1, 0).getDate();
  const cells = ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d) => h('div', { class: 'dow' }, d));
  for (let i = 0; i < offset; i++) cells.push(h('div'));
  const today = ymd(new Date());
  for (let d = 1; d <= daysIn; d++) {
    const key = `${y}-${pad(m + 1)}-${pad(d)}`;
    const list = byDay[key] || [];
    cells.push(h('button', {
      class: `day${key === today ? ' today' : ''}${key === state.selected ? ' sel' : ''}`,
      'aria-label': `${d} ${MON[m]}${list.length ? `, ${list.length} gathering${list.length > 1 ? 's' : ''}` : ''}`,
      onclick: () => { state.selected = key; state.keepAgendaScroll = false; render(); },
    }, h('span', { class: 'n' }, String(d)),
    h('span', { class: 'dots' }, list.slice(0, 3).map((g) => h('i', { class: `dot ${g.started_at ? 'live' : g.status}` })))));
  }

  while (cells.length < 7 + 42) cells.push(h('div', { class: 'day', 'aria-hidden': 'true' })); // always six weeks: the box never changes height

  const now = new Date();
  const nowStr = `${ymd(now)}T${hhmm(now)}`;
  const sel = byDay[state.selected] || [];
  const selDate = new Date(`${state.selected}T00:00`);
  const waiting = state.gatherings.filter((g) => g.status === 'pending');
  const upcoming = state.gatherings.filter((g) => g.status === 'approved' && !g.ended_at && g.start >= nowStr && !sel.includes(g)).slice(0, 4);

  const box = h('div', { class: 'cal-box' },
    h('div', { class: 'cal-head' },
      h('h1', {}, MONTHS[m], h('span', {}, String(y))),
      h('div', { class: 'nav' },
        h('button', { class: 'today', onclick: () => { state.month = new Date(now.getFullYear(), now.getMonth(), 1); state.selected = ymd(now); state.keepAgendaScroll = false; render(); } }, 'Today'),
        h('button', { 'aria-label': 'Previous month', onclick: () => { state.month = new Date(y, m - 1, 1); state.keepAgendaScroll = false; render(); } }, icon('left', 20)),
        h('button', { 'aria-label': 'Next month', onclick: () => { state.month = new Date(y, m + 1, 1); state.keepAgendaScroll = false; render(); } }, icon('right', 20)))),
    h('div', { class: 'grid' }, cells));

  const panel = h('div', { class: 'cal-panel' },
    h('section', { class: 'section first' }, h('h2', {}, longDay(selDate)),
      sel.length ? sel.map((g) => row(g, false))
        : h('div', { class: 'empty' }, isHost() ? 'Nothing planned. Tap + to send a request.' : 'Nothing planned for this day.')),
    waiting.length > 0 && h('section', { class: 'section' }, h('h2', {}, isHost() ? 'Awaiting her reply' : 'Needs your reply'), waiting.map((g) => row(g, true))),
    upcoming.length > 0 && h('section', { class: 'section' }, h('h2', {}, 'Coming up'), upcoming.map((g) => row(g, true))));

  add(root, h('div', { class: 'cal-layout' }, box, panel));
}

// ---------- bottom sheet ----------
const sheet = $('#sheet');
sheet.addEventListener('click', (e) => { if (e.target === sheet) closeSheet(); });
sheet.addEventListener('close', () => { state.openId = null; });
function closeSheet() { state.openId = null; if (sheet.open) sheet.close(); }

function showSheet(...kids) {
  const keep = sheet.open ? sheet.scrollTop : 0; // refreshes must not jump the scroll
  sheet.replaceChildren(h('div', { class: 'sheet-in' }, kids));
  if (!sheet.open) sheet.showModal();
  sheet.scrollTop = keep;
}

const sheetHead = (title) => h('div', { class: 'sheet-head' }, h('h3', {}, title),
  h('button', { class: 'x', 'aria-label': 'Close', onclick: closeSheet }, icon('close', 20)));

async function openSheet(id) { state.openId = id; await refreshSheet(); }

async function refreshSheet() {
  const id = state.openId;
  try {
    const g = await api('GET', `/api/gatherings/${id}`);
    if (state.openId !== id) return;
    showSheet(...detailView(g));
  } catch (e) { toast(e.message); closeSheet(); }
}

function detailView(g) {
  const started = !!g.started_at, ended = !!g.ended_at, live = started && !ended;
  const d = parse(g.start);
  const out = [
    sheetHead(g.title),
    h('div', { style: 'margin-top:10px' }, status(g)),
    h('dl', { class: 'facts' },
      h('dt', {}, 'When'), h('dd', {}, `${longDay(d)}, ${hhmm(d)}${g.end ? ' – ' + hhmm(parse(g.end)) : ''}`),
      g.group_name && [h('dt', {}, 'Group'), h('dd', {}, h('span', { class: 'gdot', style: `background:${g.group_color}` }), g.group_name)],
      g.location && [h('dt', {}, 'Where'), h('dd', {}, g.location)],
      g.attendees && [h('dt', {}, 'With'), h('dd', {}, g.attendees)],
      g.ride && [h('dt', {}, 'Ride home'), h('dd', {}, g.ride)],
      g.note && [h('dt', {}, 'Note'), h('dd', {}, g.note)],
      g.drink_limit != null && [h('dt', {}, 'Agreed'), h('dd', {}, `Up to ${g.drink_limit} beer${g.drink_limit === 1 ? '' : 's'}`)],
      g.conditions && [h('dt', {}, 'Conditions'), h('dd', {}, g.conditions)]),
  ];
  if (g.wife_comment) out.push(h('div', { class: 'note' }, h('b', {}, isHost() ? 'Her note' : 'Your note'), h('p', {}, g.wife_comment)));

  if (started) out.push(...beerPanel(g, live));
  if (!isHost() && !started) {
    const answered = g.status === 'approved' || g.status === 'declined';
    if (!answered) out.push(respondForm(g));
    else {
      const slot = h('div', { class: 'btns' }, h('button', { class: 'btn', onclick: () => slot.replaceWith(respondForm(g)) }, 'Change reply'));
      out.push(slot);
    }
  }

  if (isHost()) {
    const btns = [];
    if (g.status === 'approved' && !started) btns.push(h('button', { class: 'btn primary', onclick: act(async () => { await api('POST', `/api/gatherings/${g.id}/start`); await reload(); }) }, 'Start gathering'));
    if (live) btns.push(h('button', { class: 'btn primary', onclick: act(async () => { await api('POST', `/api/gatherings/${g.id}/end`); await reload(); toast('Marked as heading home'); }) }, 'Heading home'));
    if (!started) btns.push(h('button', { class: 'btn', onclick: () => openForm(g) }, 'Edit'));
    btns.push(h('button', { class: 'btn text', onclick: act(async () => {
      if (!confirm('Delete this gathering and its beer log?')) return;
      await api('DELETE', `/api/gatherings/${g.id}`); closeSheet(); await reload();
    }) }, 'Delete'));
    out.push(h('div', { class: 'btns' }, btns));
  }
  return out;
}

function respondForm(g) {
  const answered = g.status === 'approved' || g.status === 'declined';
  const comment = h('textarea', { placeholder: 'Optional message', value: g.wife_comment || '' });
  const cond = h('input', { placeholder: 'e.g. Home by 11', value: g.conditions || '' });
  const limit = h('input', { type: 'number', min: '0', max: '100', inputmode: 'numeric', placeholder: 'None', value: g.drink_limit ?? '' });
  const send = (decision) => act(async () => {
    await api('POST', `/api/gatherings/${g.id}/respond`, {
      decision, comment: comment.value, conditions: cond.value, drink_limit: limit.value === '' ? null : Number(limit.value),
    });
    toast(decision === 'approved' ? 'Approved' : 'Declined');
    await reload();
  });
  return h('div', { class: 'reply' },
    h('h4', {}, 'Your reply'),
    h('label', {}, 'Message'), comment,
    h('div', { class: 'two' }, h('div', {}, h('label', {}, 'Conditions'), cond), h('div', {}, h('label', {}, 'Beer limit'), limit)),
    h('div', { class: 'btns' },
      h('button', { class: 'btn approve', onclick: send('approved') }, 'Approve'),
      h('button', { class: 'btn decline', onclick: send('declined') }, 'Decline')),
    h('p', { class: 'muted small', style: 'margin:12px 0 0' }, 'No reply is fine too. It simply shows as "No reply" once the date has passed.'));
}

function beerPanel(g, live) {
  const total = g.beers.total, limit = g.drink_limit;
  const cls = limit != null ? (total > limit ? 'over' : total === limit ? 'warn' : '') : '';
  const sub = limit == null ? (total === 1 ? 'beer' : 'beers')
    : total > limit ? `${total - limit} over the agreed ${limit}` : `of ${limit} agreed`;
  const els = [h('div', { class: 'count' }, h('span', { class: `num ${cls}` }, String(total)), h('span', { class: 'unit' }, sub))];
  if (live && isHost()) {
    const addBeer = (typeId) => act(async () => { await api('POST', `/api/gatherings/${g.id}/beers`, { beer_type_id: typeId, qty: 1 }); await reload(); });
    els.push(h('div', { class: 'beer-grid' },
      state.beerTypes.map((t) => h('button', { class: 'btn', onclick: addBeer(t.id) }, `+ ${t.name}`)),
      h('button', { class: 'btn text', onclick: addBeer(null) }, '+ Other')));
  } else if (g.beers.by_type.length) {
    els.push(h('div', { class: 'muted small', style: 'text-align:center;margin-top:8px' }, g.beers.by_type.map((b) => `${b.name} × ${b.qty}`).join('  ·  ')));
  }
  if (g.log && g.log.length) {
    els.push(h('div', { class: 'log' }, g.log.map((l) => h('div', { class: 'log-row' },
      h('span', {}, `${l.qty > 1 ? l.qty + ' × ' : ''}${l.name}`, h('span', { class: 'muted' }, `   ${l.ts.slice(11, 16)}`)),
      live && isHost() && h('button', { class: 'undo', 'aria-label': 'Undo', onclick: act(async () => { await api('DELETE', `/api/beers/${l.id}`); await reload(); }) }, icon('undo', 18))))));
  }
  return els;
}

// ---------- new / edit request ----------
function openForm(g) {
  const base = g ? parse(g.start) : (() => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(19, 0, 0, 0); return d; })();
  const endBase = g && g.end ? parse(g.end) : null;
  const f = {
    title: h('input', { value: g ? g.title : '', placeholder: 'Beers with the boys', maxlength: '120' }),
    group: h('select', {}, h('option', { value: '' }, 'No group'), state.groups.map((x) => h('option', { value: x.id, selected: g && g.group_id === x.id }, x.name))),
    date: h('input', { type: 'date', value: ymd(base) }),
    start: h('input', { type: 'time', value: hhmm(base) }),
    end: h('input', { type: 'time', value: endBase ? hhmm(endBase) : '' }),
    loc: h('input', { value: g ? g.location : '', placeholder: 'Where' }),
    who: h('input', { value: g ? g.attendees : '', placeholder: 'Optional' }),
    ride: h('input', { value: g ? g.ride : '', placeholder: 'Driver, taxi, Grab…' }),
    note: h('textarea', { value: g ? g.note : '', placeholder: 'Anything she should know' }),
  };
  const save = act(async () => {
    if (!f.title.value.trim()) throw new Error('Give it a title');
    if (!f.date.value || !f.start.value) throw new Error('Pick a date and start time');
    const start = `${f.date.value}T${f.start.value}`;
    let end = null;
    if (f.end.value) { // an end earlier than the start means "after midnight"
      const d = new Date(`${f.date.value}T00:00`);
      if (f.end.value <= f.start.value) d.setDate(d.getDate() + 1);
      end = `${ymd(d)}T${f.end.value}`;
    }
    const body = {
      title: f.title.value.trim(), group_id: f.group.value ? Number(f.group.value) : null, start, end,
      location: f.loc.value, attendees: f.who.value, ride: f.ride.value, note: f.note.value,
    };
    if (g) await api('PATCH', `/api/gatherings/${g.id}`, body); else await api('POST', '/api/gatherings', body);
    closeSheet();
    state.selected = f.date.value;
    state.month = new Date(parse(start).getFullYear(), parse(start).getMonth(), 1);
    toast(g ? 'Updated' : 'Request sent');
    await reload();
  });
  showSheet(
    sheetHead(g ? 'Edit request' : 'New request'),
    h('label', {}, 'What'), f.title,
    h('label', {}, 'Group'), f.group,
    h('div', { class: 'three' }, h('div', {}, h('label', {}, 'Date'), f.date), h('div', {}, h('label', {}, 'From'), f.start), h('div', {}, h('label', {}, 'Until'), f.end)),
    h('label', {}, 'Where'), f.loc,
    h('label', {}, 'With'), f.who,
    h('label', {}, 'Ride home'), f.ride,
    h('label', {}, 'Note'), f.note,
    g && g.status !== 'pending' && h('p', { class: 'muted small', style: 'margin:14px 0 0' }, 'Changing the time sends it back for a fresh reply.'),
    h('div', { class: 'btns' }, h('button', { class: 'btn primary', onclick: save }, g ? 'Save changes' : 'Send request')));
}

// ---------- groups ----------
function renderGroups(root) {
  const s = state.stats;
  if (!s) { add(root, h('div', { class: 'empty' }, 'Loading…')); return; }
  add(root,
    h('h1', { class: 'page-title' }, 'Groups'),
    h('p', { class: 'page-sub' }, 'How often each crew gets together.'),
    h('div', { class: 'stats' },
      h('div', { class: 'stat' }, h('b', {}, String(s.month.gatherings)), h('span', {}, 'this month')),
      h('div', { class: 'stat' }, h('b', {}, String(s.month.beers)), h('span', {}, 'beers this month')),
      h('div', { class: 'stat' }, h('b', {}, s.approval_rate == null ? '–' : `${s.approval_rate}%`), h('span', {}, 'approved'))),
    h('section', { class: 'section', style: 'margin-top:18px' }, s.groups.length ? s.groups.map(groupRow) : h('div', { class: 'empty' }, 'No groups yet.')),
    isHost() && h('div', { class: 'btns' }, h('button', { class: 'btn', onclick: () => groupForm() }, 'Add a group')));
}

function groupRow(g) {
  const pct = g.target_days && g.days_since != null ? Math.min(100, Math.round((g.days_since / g.target_days) * 100)) : 0;
  const last = g.days_since == null ? 'Not met yet' : g.days_since === 0 ? 'Met today' : `Last met ${g.days_since} day${g.days_since === 1 ? '' : 's'} ago`;
  return h('div', { class: 'group' },
    h('div', { class: 'top' },
      h('h3', {}, h('span', { class: 'gdot', style: `background:${g.color}` }), g.name),
      g.overdue ? h('span', { class: 'status declined' }, h('i'), 'Overdue') : g.meetings ? h('span', { class: 'status approved' }, h('i'), 'On track') : null),
    h('div', { class: 'muted small', style: 'margin-top:4px' }, last, g.target_days ? ` · goal every ${g.target_days} days` : ''),
    g.target_days && h('div', { class: 'bar' }, h('i', { class: pct >= 100 ? 'late' : '', style: `width:${pct}%` })),
    h('div', { class: 'muted small' }, [`${g.meetings} meeting${g.meetings === 1 ? '' : 's'}`, `${g.last_90d} in 90 days`, g.avg_gap_days != null && `average gap ${g.avg_gap_days} days`, `${g.beers} beer${g.beers === 1 ? '' : 's'}`].filter(Boolean).join(' · ')),
    isHost() && h('button', { class: 'link', onclick: () => groupForm(g) }, 'Edit'));
}

function groupForm(g) {
  const name = h('input', { value: g ? g.name : '', placeholder: 'University friends', maxlength: '60' });
  const color = h('input', { type: 'color', value: g ? g.color : '#4b7a5f', style: 'height:46px;padding:4px' });
  const target = h('input', { type: 'number', min: '1', max: '365', inputmode: 'numeric', value: g && g.target_days ? g.target_days : '', placeholder: 'e.g. 30' });
  const body = () => ({ name: name.value.trim(), color: color.value, target_days: target.value ? Number(target.value) : null });
  showSheet(
    sheetHead(g ? 'Edit group' : 'New group'),
    h('label', {}, 'Name'), name,
    h('div', { class: 'two' }, h('div', {}, h('label', {}, 'Colour'), color), h('div', {}, h('label', {}, 'Meet every (days)'), target)),
    h('div', { class: 'btns' },
      h('button', { class: 'btn primary', onclick: act(async () => {
        if (!name.value.trim()) throw new Error('Name it first');
        if (g) await api('PATCH', `/api/groups/${g.id}`, body()); else await api('POST', '/api/groups', body());
        state.groups = await api('GET', '/api/groups'); closeSheet(); await reload();
      }) }, 'Save'),
      g && h('button', { class: 'btn decline', onclick: act(async () => {
        if (!confirm(`Delete "${g.name}"? Past gatherings stay, just ungrouped.`)) return;
        await api('DELETE', `/api/groups/${g.id}`); state.groups = await api('GET', '/api/groups'); closeSheet(); await reload();
      }) }, 'Delete')));
}

// ---------- settings ----------
function b64ToBytes(s) {
  const raw = atob((s + '='.repeat((4 - (s.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function enablePush() {
  const standalone = window.navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || typeof Notification === 'undefined') {
    throw new Error(standalone ? 'Notifications aren\'t supported on this device' : 'On iPhone: Share, then Add to Home Screen, and open it from there.');
  }
  const reg = await navigator.serviceWorker.ready;
  if ((await Notification.requestPermission()) !== 'granted') throw new Error('Notifications are blocked in system settings');
  const { key } = await api('GET', '/api/push/key');
  const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) });
  await api('POST', '/api/push/subscribe', { subscription: sub.toJSON() });
  toast('Notifications are on');
}

function renderSettings(root) {
  const icsInput = h('input', { readonly: true, value: 'Loading…', 'aria-label': 'Calendar feed link' });
  api('GET', '/api/ics-url').then((r) => { icsInput.value = location.origin + r.path; }).catch(() => {});
  const name = h('input', { placeholder: 'Beer name' });
  const abv = h('input', { type: 'number', step: '0.1', placeholder: 'ABV %', inputmode: 'decimal' });
  const size = h('input', { type: 'number', placeholder: 'ml', inputmode: 'numeric' });

  add(root,
    h('h1', { class: 'page-title' }, 'Settings'),
    h('p', { class: 'page-sub' }, `Signed in as ${isHost() ? 'host' : 'wife'}.`),
    h('section', { class: 'section', style: 'margin-top:14px' }, h('h2', {}, 'Notifications'),
      h('div', { class: 'card' },
        h('p', { class: 'muted small' }, 'On iPhone, first use Share, then Add to Home Screen, and open the app from there.'),
        h('div', { class: 'btns', style: 'margin-top:4px' },
          h('button', { class: 'btn primary', onclick: act(enablePush) }, 'Turn on'),
          h('button', { class: 'btn', onclick: act(async () => { await api('POST', '/api/push/test'); toast('Test sent'); }) }, 'Send a test')))),
    h('section', { class: 'section' }, h('h2', {}, 'Calendar feed'),
      h('div', { class: 'card' },
        h('p', { class: 'muted small' }, 'Subscribe in Apple or Google Calendar to see approved gatherings beside everything else.'),
        icsInput,
        h('div', { class: 'btns' }, h('button', { class: 'btn', onclick: act(async () => { await navigator.clipboard.writeText(icsInput.value); toast('Link copied'); }) }, 'Copy link')))),
    isHost() && h('section', { class: 'section' }, h('h2', {}, 'Beer list'),
      h('div', { class: 'card' },
        state.beerTypes.map((t) => h('div', { class: 'item' },
          h('span', {}, t.name, h('span', { class: 'muted small' }, `${t.abv != null ? '   ' + t.abv + '%' : ''}${t.size_ml ? '  ' + t.size_ml + ' ml' : ''}`)),
          h('button', { class: 'x', style: 'margin:0', 'aria-label': `Remove ${t.name}`, onclick: act(async () => { await api('DELETE', `/api/beer-types/${t.id}`); state.beerTypes = await api('GET', '/api/beer-types'); render(); }) }, icon('close', 18)))),
        h('label', {}, 'Add a beer'), name,
        h('div', { class: 'two', style: 'margin-top:10px' }, abv, size),
        h('div', { class: 'btns' }, h('button', { class: 'btn', onclick: act(async () => {
          if (!name.value.trim()) throw new Error('Name the beer');
          await api('POST', '/api/beer-types', { name: name.value.trim(), abv: abv.value ? Number(abv.value) : null, size_ml: size.value ? Number(size.value) : null });
          state.beerTypes = await api('GET', '/api/beer-types'); render();
        }) }, 'Add')))),
    h('div', { class: 'btns', style: 'margin-top:28px' },
      h('button', { class: 'btn text', onclick: act(async () => { await api('POST', '/api/logout'); state.role = null; renderLogin(); }) }, 'Sign out')));
}

// ---------- live refresh (so she sees beers tick up) ----------
setInterval(() => {
  if (!state.role || document.hidden) return;
  const typing = sheet.open && /^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || '');
  if (typing || state.tab === 'settings') return;
  reload().catch(() => {});
}, 30000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && state.role) reload().catch(() => {}); });

boot();
