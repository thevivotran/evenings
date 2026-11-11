import { h, icon, plural } from '../dom.js';
import { get, post, put, patch, del } from '../api.js';
import { state, isHost, refresh } from '../store.js';
import { act, btn, pill, field, input, chips, peopleInput, list, empty, toast, openSheet, closeSheet, confirmSheet } from '../ui.js';

const PALETTE = ['#4b7a5f', '#2f6f8f', '#5470a8', '#7a5ea8', '#a8577a', '#b0503d', '#b0832f', '#6b7a3a'];
const RHYTHMS = [[7, 'Weekly'], [14, 'Fortnightly'], [30, 'Monthly'], [90, 'Quarterly']];

function groupCard(g) {
  const met = g.days_since != null;
  const pct = g.target_days && met ? Math.min(100, Math.round((g.days_since / g.target_days) * 100)) : 0;
  const last = !met ? 'No meetups yet' : g.days_since === 0 ? 'Met today' : `Last met ${plural(g.days_since, 'day')} ago`;
  const state_ = !met ? { key: 'expired', label: 'New' } : g.overdue ? { key: 'declined', label: 'Overdue' } : { key: 'approved', label: 'On track' };
  // The host edits everything; she can set how often each crew should meet.
  return h('button', { type: 'button', class: 'group tap', style: { '--c': g.color }, onclick: () => (isHost() ? groupForm(g) : rhythmForm(g)) },
    h('span', { class: 'group-top' },
      h('span', { class: 'group-name' }, h('span', { class: 'swatch' }), g.name),
      g.target_days ? pill(state_) : null),
    h('span', { class: 'group-last' }, last, g.target_days ? ` · every ${plural(g.target_days, 'day')}` : ''),
    g.members.length > 0 && h('span', { class: 'group-members' }, icon('people', 15), g.members.join(', ')),
    g.target_days && met && h('span', { class: `meter${g.overdue ? ' late' : ''}`, role: 'img', 'aria-label': `${pct}% of the way to the goal` }, h('i', { style: { width: `${Math.max(4, pct)}%` } })),
    h('span', { class: 'group-stats' },
      [[g.meetings, 'met'], [g.last_90d, 'in 90 days'], [g.avg_gap_days != null ? `${g.avg_gap_days}d` : '–', 'avg gap'], [g.beers, 'beers']]
        .map(([n, l]) => h('span', {}, h('b', {}, String(n)), l))),
    h('span', { class: 'group-chev' }, icon('chevron', 18)));
}

// Weekly / Monthly / … chips plus a custom number of days, kept in sync.
function rhythmPicker(current) {
  const days = input({ type: 'number', min: '1', max: '365', inputmode: 'numeric', value: current || '', placeholder: 'Days' });
  const rhythm = chips([{ value: null, label: 'No goal' }, ...RHYTHMS.map(([v, l]) => ({ value: v, label: l }))],
    RHYTHMS.some(([v]) => v === current) ? current : current ? 'custom' : null,
    { label: 'Meet every', onchange: (v) => { days.value = v || ''; } });
  days.addEventListener('input', () => rhythm.set(RHYTHMS.some(([v]) => v === Number(days.value)) ? Number(days.value) : days.value ? 'custom' : null));
  return {
    el: h('div', { class: 'field' }, h('span', { class: 'label' }, 'Meet every'), rhythm.el, h('div', { class: 'inline-input' }, days, h('span', { class: 'hint' }, 'days'))),
    get value() { return days.value ? Number(days.value) : null; },
  };
}

function rhythmForm(g) {
  const r = rhythmPicker(g.target_days);
  return openSheet(() => ({
    title: g.name,
    body: [
      h('p', { class: 'hint first' }, 'How often should this group get together? It shows as overdue once it has been longer.'),
      r.el,
      g.members.length > 0 && h('p', { class: 'hint' }, `Usually: ${g.members.join(', ')}`),
    ],
    footer: [btn('Save', { kind: 'primary', block: true, onclick: act(async () => {
      const v = r.value;
      if (v != null && (!Number.isInteger(v) || v < 1 || v > 365)) throw new Error('Pick between 1 and 365 days');
      await put(`/api/groups/${g.id}/rhythm`, { target_days: v });
      closeSheet(); await refresh({ groups: true }); toast('Saved');
    }) })],
  }));
}

function groupForm(g) {
  const name = input({ value: g ? g.name : '', placeholder: 'University friends', maxlength: '60', class: 'big' });
  let color = g ? g.color : PALETTE[0];
  const swatches = h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Colour' });
  const custom = h('input', { type: 'color', value: color, 'aria-label': 'Custom colour', class: 'swatch-custom' });
  const paint = () => {
    for (const s of swatches.querySelectorAll('.sw')) s.setAttribute('aria-checked', String(s.dataset.c === color));
    custom.parentElement && custom.parentElement.classList.toggle('on', !PALETTE.includes(color));
  };
  for (const c of PALETTE) swatches.append(h('button', { type: 'button', class: 'sw', role: 'radio', 'data-c': c, 'aria-label': c, style: { background: c }, onclick: () => { color = c; paint(); } }));
  custom.addEventListener('input', () => { color = custom.value; paint(); });
  swatches.append(h('label', { class: 'sw custom', title: 'Custom' }, custom, icon('plus', 16)));
  paint();

  const rhythm = rhythmPicker(g ? g.target_days : null);
  const members = peopleInput({ value: g ? g.members : [], known: state.people, label: 'Members' });

  const body = () => ({ name: name.value.trim(), color, target_days: rhythm.value, members: members.value });
  return openSheet(() => ({
    title: g ? 'Edit group' : 'New group',
    body: [
      field('Name', name),
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Colour'), swatches),
      rhythm.el,
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Members'), members.el,
        h('p', { class: 'hint' }, 'Filled in automatically when you plan an evening with this group.')),
      g && h('div', { class: 'danger-zone' }, btn('Delete group', { kind: 'ghost', size: 'sm', icon: 'trash', onclick: act(async () => {
        if (!await confirmSheet({ title: `Delete “${g.name}”?`, message: 'Past gatherings stay, just without a group.', confirm: 'Delete', danger: true })) return;
        await del(`/api/groups/${g.id}`); closeSheet(); await refresh({ groups: true }); toast('Group deleted');
      }) })),
    ],
    footer: [btn('Save', { kind: 'primary', block: true, onclick: act(async () => {
      if (!name.value.trim()) { name.focus(); throw new Error('Name it first'); }
      if (g) await patch(`/api/groups/${g.id}`, body()); else await post('/api/groups', body());
      closeSheet(); await refresh({ groups: true }); toast(g ? 'Saved' : 'Group added');
    }) })],
  }));
}

export const groupsView = {
  async enter() { state.stats = await get('/api/stats').catch(() => state.stats); },

  render() {
    const s = state.stats;
    const head = h('header', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Groups'), h('p', {}, 'How often each crew gets together.')),
      isHost() && btn('New', { kind: 'secondary', size: 'sm', icon: 'plus', onclick: () => groupForm() }));
    if (!s) return h('div', { class: 'page' }, head, h('div', { class: 'skeleton tall' }), h('div', { class: 'skeleton' }), h('div', { class: 'skeleton' }));
    return h('div', { class: 'page' }, head,
      h('div', { class: 'tiles' },
        [[s.month.gatherings, 'evenings this month'], [s.month.beers, 'beers this month'], [s.approval_rate == null ? '–' : `${s.approval_rate}%`, 'approved']]
          .map(([n, l]) => h('div', { class: 'tile' }, h('b', {}, String(n)), h('span', {}, l)))),
      h('section', { class: 'section' },
        s.groups.length ? h('div', { class: 'groups' }, s.groups.map(groupCard))
          : empty('groups', 'No groups yet', 'Groups track how often each crew meets.',
            isHost() && btn('Add a group', { kind: 'secondary', size: 'sm', icon: 'plus', onclick: () => groupForm() }))),
      s.people && s.people.length > 0 && h('section', { class: 'section' },
        h('h2', { class: 'eyebrow' }, 'People'),
        h('div', { class: 'card' }, list(s.people.map((p) => ({
          icon: 'people', label: p.name,
          sub: `${p.days_since === 0 ? 'Seen today' : `Last seen ${plural(p.days_since, 'day')} ago`} · ${p.last_90d} in 90 days`,
          value: plural(p.meetings, 'evening'),
        }))))));
  },
};
