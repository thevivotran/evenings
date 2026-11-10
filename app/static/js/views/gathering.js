// Gathering detail sheet (view, reply, live beer log) and the new / edit request form.
import { h, icon, ring, plural, haptic } from '../dom.js';
import { get, post, patch, del } from '../api.js';
import { ymd, parse, hhmm, longDay, relDay } from '../dates.js';
import { state, isHost, statusOf, refresh } from '../store.js';
import { act, btn, pill, field, input, stepper, chips, toast, openSheet, refreshSheet, closeSheet, confirmSheet } from '../ui.js';

const ts = (s) => parse(s.replace(' ', 'T'));

// ---------- detail ----------
export function openGathering(id) {
  // Survives live refreshes, so a half-written reply is never wiped by the 30s poll.
  const ui = { replying: false, draft: null };
  return openSheet(async () => detail(await get(`/api/gatherings/${id}`), ui), { live: true });
}

function facts(g) {
  const d = parse(g.start);
  const when = `${relDay(d) === longDay(d) ? longDay(d) : `${relDay(d)}, ${longDay(d)}`} · ${hhmm(d)}${g.end ? `–${hhmm(parse(g.end))}` : ''}`;
  const rows = [
    ['clock', 'When', when],
    g.group_name && ['groups', 'Group', h('span', {}, h('span', { class: 'swatch sm', style: { background: g.group_color } }), g.group_name)],
    g.location && ['pin', 'Where', g.location],
    g.attendees && ['people', 'With', g.attendees],
    g.ride && ['car', 'Ride home', g.ride],
    g.note && ['note', 'Note', g.note],
  ].filter(Boolean);
  return h('dl', { class: 'facts' }, rows.map(([ic, k, v]) => h('div', { class: 'fact' },
    h('dt', {}, icon(ic, 18), h('span', { class: 'sr' }, k)), h('dd', {}, h('small', {}, k), h('span', {}, v)))));
}

function agreement(g) {
  if (g.status !== 'approved' || (g.drink_limit == null && !g.conditions)) return null;
  return h('div', { class: 'agree' },
    h('div', { class: 'agree-ico' }, icon('shield', 18)),
    h('div', {}, h('b', {}, 'Agreed'),
      h('p', {}, [g.drink_limit != null && `Up to ${plural(g.drink_limit, 'beer')}`, g.conditions].filter(Boolean).join(' · '))));
}

function detail(g, ui) {
  const started = !!g.started_at, ended = !!g.ended_at, live = started && !ended;
  const host = isHost();
  const answered = g.status === 'approved' || g.status === 'declined';
  const showReply = !host && !started && (!answered || ui.replying);
  const note = g.wife_comment && h('blockquote', { class: 'quote' }, h('small', {}, host ? 'Her note' : 'Your note'), h('p', {}, g.wife_comment));
  // Once it has started, the beer counter is what both people open the sheet for, so it leads.
  const body = started ? [...beerPanel(g, live), agreement(g), note, h('div', { class: 'gap' }), facts(g)] : [facts(g), agreement(g), note];

  let footer = [];
  if (showReply) {
    const r = replyForm(g, ui);
    body.push(r.el);
    footer = r.footer;
  } else if (!host && !started) {
    footer = [btn('Change reply', { block: true, icon: 'edit', onclick: () => { ui.replying = true; refreshSheet(); } })];
  }

  if (host) {
    if (g.status === 'approved' && !started) footer.push(btn('Start gathering', { kind: 'primary', icon: 'play', block: true, onclick: act(async () => { await post(`/api/gatherings/${g.id}/start`); haptic(); await refresh(); toast('Have a good one'); }) }));
    if (live) footer.push(btn('Heading home', { kind: 'primary', icon: 'home', block: true, onclick: act(async () => { await post(`/api/gatherings/${g.id}/end`); haptic(); await refresh(); toast('She knows you\'re heading home'); }) }));
    if (!started) footer.unshift(btn('Edit', { icon: 'edit', onclick: () => openForm(g) }));
    body.push(h('div', { class: 'danger-zone' }, btn('Delete gathering', { kind: 'ghost', size: 'sm', icon: 'trash', onclick: act(async () => {
      if (!await confirmSheet({ title: 'Delete this gathering?', message: 'Its beer log goes with it. This can\'t be undone.', confirm: 'Delete', danger: true })) return;
      await del(`/api/gatherings/${g.id}`); closeSheet(); await refresh(); toast('Deleted');
    }) })));
  }
  return { title: g.title, sub: pill(statusOf(g)), body, footer };
}

function replyForm(g, ui) {
  const d = ui.draft || (ui.draft = { comment: g.wife_comment || '', conditions: g.conditions || '', limit: g.drink_limit ?? null });
  const comment = h('textarea', { rows: 2, placeholder: 'Optional', value: d.comment, oninput: (e) => { d.comment = e.target.value; } });
  const cond = input({ placeholder: 'e.g. Home by 11', value: d.conditions, enterkeyhint: 'done', oninput: (e) => { d.conditions = e.target.value; } });
  const presets = ['Home by 11', 'Home by midnight', 'Text me when you leave'];
  const limit = stepper({ value: d.limit, min: 0, max: 30, emptyLabel: 'No limit', label: 'beer limit' });
  limit.el.addEventListener('click', () => { d.limit = limit.value; });
  const send = (decision) => act(async () => {
    await post(`/api/gatherings/${g.id}/respond`, { decision, comment: d.comment, conditions: d.conditions, drink_limit: d.limit });
    ui.replying = false; ui.draft = null;
    haptic();
    toast(decision === 'approved' ? 'Approved' : 'Declined');
    await refresh();
  });
  const el = h('div', { class: 'reply' },
    h('h3', {}, g.status === 'pending' ? 'Your reply' : 'Change your reply'),
    field('Message', comment),
    field('Conditions', cond),
    h('div', { class: 'chips scroll' }, presets.map((p) => h('button', { type: 'button', class: 'chip', onclick: () => { cond.value = d.conditions = d.conditions ? `${d.conditions}, ${p.toLowerCase()}` : p; } }, `+ ${p}`))),
    h('div', { class: 'field inline' }, h('span', { class: 'label' }, 'Beer limit'), limit.el),
    g.status === 'pending' && h('p', { class: 'hint' }, 'No reply is fine too. It shows as "No reply" once the evening has passed.'));
  return { el, footer: [
    btn('Decline', { kind: 'decline', onclick: send('declined') }),
    btn('Approve', { kind: 'approve', icon: 'check', onclick: send('approved') }),
  ] };
}

function beerPanel(g, live) {
  const total = g.beers.total, limit = g.drink_limit;
  const tone = limit != null ? (total > limit ? 'over' : total === limit ? 'warn' : 'ok') : 'ok';
  const sub = limit == null ? (total === 1 ? 'beer' : 'beers')
    : total > limit ? `${total - limit} over the ${limit} agreed` : `of ${limit} agreed`;
  const counts = Object.fromEntries(g.beers.by_type.map((b) => [b.name, b.qty]));
  const els = [h('div', { class: `meter-ring ${tone}` },
    ring(limit ? total / Math.max(1, limit) : total > 0 ? 1 : 0, tone),
    h('div', { class: 'meter-center' }, h('b', {}, String(total)), h('span', {}, sub)))];

  if (live && isHost()) {
    const addBeer = (typeId) => act(async () => { await post(`/api/gatherings/${g.id}/beers`, { beer_type_id: typeId, qty: 1 }); haptic(12); await refresh(); });
    els.push(h('div', { class: 'beer-grid' },
      [...state.beerTypes.map((t) => [t.id, t.name]), [null, 'Other']].map(([id, name]) =>
        h('button', { type: 'button', class: 'beer', onclick: addBeer(id), 'aria-label': `Add ${name}` },
          h('span', { class: 'beer-plus' }, icon('plus', 16)), h('span', { class: 'beer-name' }, name),
          counts[name] ? h('span', { class: 'beer-n' }, String(counts[name])) : null))));
  } else if (g.beers.by_type.length) {
    els.push(h('p', { class: 'by-type' }, g.beers.by_type.map((b) => `${b.name} × ${b.qty}`).join('  ·  ')));
  }
  if (g.log && g.log.length) {
    els.push(h('div', { class: 'log' }, h('h3', { class: 'eyebrow' }, 'Log'), g.log.map((l) => h('div', { class: 'log-row' },
      h('span', { class: 'log-time' }, l.ts.slice(11, 16)),
      h('span', { class: 'log-name' }, `${l.qty > 1 ? `${l.qty} × ` : ''}${l.name}`),
      live && isHost() && h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Undo ${l.name}`, onclick: act(async () => { await del(`/api/beers/${l.id}`); await refresh(); }) }, icon('undo', 18))))));
  }
  if (g.ended_at) els.push(h('p', { class: 'hint center' }, `Headed home at ${hhmm(ts(g.ended_at))}`));
  return els;
}

// ---------- new / edit request ----------
export function openForm(g, { date } = {}) {
  const base = g ? parse(g.start) : (() => {
    const d = date ? new Date(`${date}T19:00`) : new Date();
    if (!date) { d.setDate(d.getDate() + 1); d.setHours(19, 0, 0, 0); }
    return d;
  })();
  const endBase = g && g.end ? parse(g.end) : null;
  const f = {
    title: input({ value: g ? g.title : '', placeholder: 'Beers with the boys', maxlength: '120', enterkeyhint: 'next', class: 'big' }),
    group: chips([{ value: null, label: 'None' }, ...state.groups.map((x) => ({ value: x.id, label: x.name, color: x.color }))], g ? g.group_id : null, { label: 'Group' }),
    date: input({ type: 'date', value: ymd(base) }),
    start: input({ type: 'time', value: hhmm(base) }),
    end: input({ type: 'time', value: endBase ? hhmm(endBase) : '' }),
    loc: input({ value: g ? g.location : '', placeholder: 'Bar, someone\'s place…', maxlength: '200' }),
    who: input({ value: g ? g.attendees : '', placeholder: 'Optional', maxlength: '300' }),
    ride: input({ value: g ? g.ride : '', placeholder: 'Driver, taxi, Grab…', maxlength: '200' }),
    note: h('textarea', { rows: 3, value: g ? g.note : '', placeholder: 'Anything she should know', maxlength: '1000' }),
  };
  const save = act(async () => {
    if (!f.title.value.trim()) { f.title.focus(); throw new Error('Give it a title'); }
    if (!f.date.value || !f.start.value) throw new Error('Pick a date and start time');
    const start = `${f.date.value}T${f.start.value}`;
    let end = null;
    if (f.end.value) { // an end earlier than the start means "after midnight"
      const d = new Date(`${f.date.value}T00:00`);
      if (f.end.value <= f.start.value) d.setDate(d.getDate() + 1);
      end = `${ymd(d)}T${f.end.value}`;
    }
    const body = {
      title: f.title.value.trim(), group_id: f.group.value, start, end,
      location: f.loc.value.trim(), attendees: f.who.value.trim(), ride: f.ride.value.trim(), note: f.note.value.trim(),
    };
    if (g) await patch(`/api/gatherings/${g.id}`, body); else await post('/api/gatherings', body);
    closeSheet();
    state.selected = f.date.value;
    state.month = new Date(parse(start).getFullYear(), parse(start).getMonth(), 1);
    toast(g ? 'Updated' : 'Request sent');
    await refresh();
  });
  return openSheet(() => ({
    title: g ? 'Edit request' : 'New request',
    body: [
      field('What', f.title),
      state.groups.length > 0 && h('div', { class: 'field' }, h('span', { class: 'label' }, 'Group'), f.group.el),
      field('Date', f.date),
      h('div', { class: 'two' }, field('From', f.start), field('Until (optional)', f.end)),
      field('Where', f.loc),
      field('With', f.who),
      field('Ride home', f.ride),
      field('Note', f.note),
      g && g.status !== 'pending' && h('p', { class: 'hint' }, 'Changing the time sends it back for a fresh reply.'),
    ],
    footer: [btn(g ? 'Save changes' : 'Send request', { kind: 'primary', block: true, onclick: save })],
  }));
}
