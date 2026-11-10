// App shell: tab registry, render loop, polling. To add a screen, write a view ({ render, enter?, fab?, noPoll? })
// in js/views/ and add one entry to TABS.
import { $, h, add, icon } from './dom.js';
import { get, setUnauthorizedHandler } from './api.js';
import { state, onChange, loadAll, refresh, actionCount } from './store.js';
import { refreshSheet } from './ui.js';
import { calendarView } from './views/calendar.js';
import { groupsView } from './views/groups.js';
import { settingsView } from './views/settings.js';
import { loginView } from './views/login.js';

const TABS = [
  { id: 'calendar', label: 'Calendar', icon: 'calendar', view: calendarView, badge: actionCount },
  { id: 'groups', label: 'Groups', icon: 'groups', view: groupsView },
  { id: 'settings', label: 'Settings', icon: 'settings', view: settingsView },
];
const tab = () => TABS.find((t) => t.id === state.tab) || TABS[0];
const app = $('#app');

function tabbar() {
  return h('nav', { class: 'tabbar', 'aria-label': 'Sections' }, TABS.map((t) => {
    const n = t.badge ? t.badge() : 0;
    return h('button', {
      type: 'button', class: 'tab', 'aria-current': t.id === state.tab ? 'page' : null,
      'aria-label': n ? `${t.label}, ${n} waiting` : t.label, onclick: () => switchTab(t.id),
    }, h('span', { class: 'tab-ico' }, icon(t.icon, 22), n > 0 && h('span', { class: 'badge' }, String(n))), h('span', { class: 'tab-label' }, t.label));
  }));
}

function render() {
  if (!state.role) return;
  const t = tab();
  const panel = $('.cal-panel');
  const keep = { win: window.scrollY, panel: panel ? panel.scrollTop : 0, tab: app.dataset.tab };
  app.dataset.tab = t.id;
  app.replaceChildren();
  add(app, h('main', { class: `view view-${t.id}` }, t.view.render()), t.view.fab && t.view.fab(), tabbar());
  if (keep.tab === t.id) {
    window.scrollTo(0, keep.win);
    const p = $('.cal-panel');
    if (p && !state.resetAgendaScroll) p.scrollTop = keep.panel;
  }
  state.resetAgendaScroll = false;
  badgeApp();
}

async function switchTab(id) {
  if (id === state.tab) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
  state.tab = id;
  const t = tab();
  render();
  window.scrollTo(0, 0);
  if (t.view.enter) { await t.view.enter(); if (state.tab === id) render(); }
}

// Home Screen icon badge (installed PWA, where supported).
function badgeApp() {
  const n = actionCount();
  try { if (n) navigator.setAppBadge && navigator.setAppBadge(n); else navigator.clearAppBadge && navigator.clearAppBadge(); } catch (_) { /* unsupported */ }
}

function showLogin() {
  state.role = null;
  delete app.dataset.tab;
  app.replaceChildren(loginView(async (role) => {
    state.role = role;
    await start();
  }));
}

async function start() {
  app.replaceChildren(h('div', { class: 'boot' }, h('div', { class: 'skeleton tall' }), h('div', { class: 'skeleton' }), h('div', { class: 'skeleton' })));
  await loadAll();
  render();
}

onChange(() => { render(); refreshSheet(); });
setUnauthorizedHandler(showLogin);

async function boot() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  const me = await get('/api/me').catch(() => ({ role: null }));
  if (!me.role) return showLogin();
  state.role = me.role;
  await start();
}

// Live refresh, so she sees beers tick up. Skipped while typing or on screens with inputs.
function typing() {
  const a = document.activeElement;
  return !!a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.type !== 'button';
}
setInterval(() => {
  if (!state.role || document.hidden || typing() || tab().view.noPoll) return;
  refresh().catch(() => {});
}, 30000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && state.role) refresh().catch(() => {}); });

boot().catch(() => showLogin());
