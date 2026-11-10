// App state + data loading. Views read `state` and call `refresh()`; the shell re-renders on 'change'.
import { get } from './api.js';
import { ymd, nowStr } from './dates.js';

export const state = {
  role: null,
  tab: 'calendar',
  month: (() => { const d = new Date(); d.setDate(1); return d; })(),
  selected: ymd(new Date()),
  gatherings: [], groups: [], beerTypes: [], stats: null,
  loaded: false,
};

export const isHost = () => state.role === 'host';

const listeners = new Set();
export const onChange = (fn) => listeners.add(fn);
export const emit = () => listeners.forEach((fn) => fn());

export async function loadAll() {
  const [g, groups, bt] = await Promise.all([get('/api/gatherings'), get('/api/groups'), get('/api/beer-types')]);
  Object.assign(state, { gatherings: g, groups, beerTypes: bt, loaded: true });
}

export async function refresh({ groups = false, beerTypes = false } = {}) {
  const jobs = [get('/api/gatherings').then((g) => { state.gatherings = g; })];
  if (groups) jobs.push(get('/api/groups').then((x) => { state.groups = x; }));
  if (beerTypes) jobs.push(get('/api/beer-types').then((x) => { state.beerTypes = x; }));
  if (state.tab === 'groups' || state.stats) jobs.push(get('/api/stats').then((s) => { state.stats = s; }).catch(() => {}));
  await Promise.all(jobs);
  emit();
}

// ---- derived data (one place, so every view agrees) ----
export const isLive = (g) => !!g.started_at && !g.ended_at;

export function statusOf(g) {
  if (isLive(g)) return { key: 'live', label: 'Under way' };
  if (g.ended_at) return { key: 'done', label: 'Completed' };
  switch (g.status) {
    case 'pending': return { key: 'pending', label: isHost() ? 'Awaiting reply' : 'Needs reply' };
    case 'approved': return { key: 'approved', label: 'Approved' };
    case 'declined': return { key: 'declined', label: 'Declined' };
    default: return { key: 'expired', label: 'No reply' };
  }
}

export const pending = () => state.gatherings.filter((g) => g.status === 'pending');
export const live = () => state.gatherings.filter(isLive);
export const upcoming = (n = 4) => {
  const now = nowStr();
  return state.gatherings.filter((g) => g.status === 'approved' && !g.started_at && g.start >= now).slice(0, n);
};
export function byDay() {
  const out = {};
  for (const g of state.gatherings) (out[g.start.slice(0, 10)] ||= []).push(g);
  return out;
}

// Number shown on the Calendar tab and the Home Screen icon: things waiting on *this* person.
export const actionCount = () => (isHost() ? 0 : pending().length);
