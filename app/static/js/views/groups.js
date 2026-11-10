import { h, icon, plural } from '../dom.js';
import { get, post, patch, del } from '../api.js';
import { state, isHost, refresh } from '../store.js';
import { act, btn, pill, field, input, chips, empty, toast, openSheet, closeSheet, confirmSheet } from '../ui.js';

const PALETTE = ['#4b7a5f', '#2f6f8f', '#5470a8', '#7a5ea8', '#a8577a', '#b0503d', '#b0832f', '#6b7a3a'];
const RHYTHMS = [[7, 'Weekly'], [14, 'Fortnightly'], [30, 'Monthly'], [90, 'Quarterly']];

function groupCard(g) {
  const met = g.days_since != null;
  const pct = g.target_days && met ? Math.min(100, Math.round((g.days_since / g.target_days) * 100)) : 0;
  const last = !met ? 'No meetups yet' : g.days_since === 0 ? 'Met today' : `Last met ${plural(g.days_since, 'day')} ago`;
  const state_ = !met ? { key: 'expired', label: 'New' } : g.overdue ? { key: 'declined', label: 'Overdue' } : { key: 'approved', label: 'On track' };
  const tag = isHost() ? 'button' : 'div';
  return h(tag, { type: isHost() ? 'button' : null, class: `group${isHost() ? ' tap' : ''}`, style: { '--c': g.color }, onclick: isHost() ? () => groupForm(g) : null },
    h('span', { class: 'group-top' },
      h('span', { class: 'group-name' }, h('span', { class: 'swatch' }), g.name),
      g.target_days ? pill(state_) : null),
    h('span', { class: 'group-last' }, last, g.target_days ? ` · every ${plural(g.target_days, 'day')}` : ''),
    g.target_days && met && h('span', { class: `meter${g.overdue ? ' late' : ''}`, role: 'img', 'aria-label': `${pct}% of the way to the goal` }, h('i', { style: { width: `${Math.max(4, pct)}%` } })),
    h('span', { class: 'group-stats' },
      [[g.meetings, 'met'], [g.last_90d, 'in 90 days'], [g.avg_gap_days != null ? `${g.avg_gap_days}d` : '–', 'avg gap'], [g.beers, 'beers']]
        .map(([n, l]) => h('span', {}, h('b', {}, String(n)), l))),
    isHost() && h('span', { class: 'group-chev' }, icon('chevron', 18)));
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

  const days = input({ type: 'number', min: '1', max: '365', inputmode: 'numeric', value: g && g.target_days ? g.target_days : '', placeholder: 'Days' });
  const rhythm = chips([{ value: null, label: 'No goal' }, ...RHYTHMS.map(([v, l]) => ({ value: v, label: l }))],
    g && RHYTHMS.some(([v]) => v === g.target_days) ? g.target_days : g && g.target_days ? 'custom' : null,
    { label: 'Meet every', onchange: (v) => { days.value = v || ''; } });
  days.addEventListener('input', () => rhythm.set(RHYTHMS.some(([v]) => v === Number(days.value)) ? Number(days.value) : days.value ? 'custom' : null));

  const body = () => ({ name: name.value.trim(), color, target_days: days.value ? Number(days.value) : null });
  return openSheet(() => ({
    title: g ? 'Edit group' : 'New group',
    body: [
      field('Name', name),
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Colour'), swatches),
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Meet every'), rhythm.el, h('div', { class: 'inline-input' }, days, h('span', { class: 'hint' }, 'days'))),
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
            isHost() && btn('Add a group', { kind: 'secondary', size: 'sm', icon: 'plus', onclick: () => groupForm() }))));
  },
};
