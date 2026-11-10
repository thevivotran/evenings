import { h, add, icon } from '../dom.js';
import { get, post, del } from '../api.js';
import { state, isHost, refresh } from '../store.js';
import { act, btn, iconBtn, field, input, list, section, toast, confirmSheet } from '../ui.js';

function b64ToBytes(s) {
  const raw = atob((s + '='.repeat((4 - (s.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

const standalone = () => window.navigator.standalone || matchMedia('(display-mode: standalone)').matches;
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && typeof Notification !== 'undefined';

// 'on' | 'off' | 'blocked' | 'unsupported'
async function pushState() {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  try {
    const reg = await navigator.serviceWorker.ready;
    return (await reg.pushManager.getSubscription()) && Notification.permission === 'granted' ? 'on' : 'off';
  } catch (_) { return 'off'; }
}

async function enablePush() {
  if (!pushSupported()) throw new Error(standalone() ? 'Notifications aren\'t supported on this device' : 'On iPhone: Share, then Add to Home Screen, and open it from there.');
  const reg = await navigator.serviceWorker.ready;
  if ((await Notification.requestPermission()) !== 'granted') throw new Error('Notifications are blocked in system settings');
  const { key } = await get('/api/push/key');
  const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) });
  await post('/api/push/subscribe', { subscription: sub.toJSON() });
  toast('Notifications are on');
}

const PUSH_TEXT = { on: 'On', off: 'Off', blocked: 'Blocked', unsupported: 'Not available' };

function notificationsSection() {
  const value = h('span', { class: 'list-value' }, '…');
  const hint = h('p', { class: 'hint' });
  const slot = h('div', { class: 'btn-row' });
  const paint = async () => {
    const s = await pushState();
    value.textContent = PUSH_TEXT[s];
    value.dataset.state = s;
    hint.textContent = s === 'blocked' ? 'Allow notifications for this app in your phone\'s settings, then come back.'
      : s === 'on' ? 'You\'ll get a nudge for new requests, replies and check-ins.'
        : standalone() ? 'Get a nudge for new requests, replies and check-ins.'
          : 'On iPhone, first use Share → Add to Home Screen, then open the app from there.';
    slot.replaceChildren();
    add(slot,
      (s === 'off' || s === 'unsupported') && btn('Turn on', { kind: 'primary', icon: 'bell', onclick: act(async () => { await enablePush(); await paint(); }) }),
      s === 'on' && btn('Send a test', { icon: 'bell', onclick: act(async () => { await post('/api/push/test'); toast('Test sent'); }) }));
  };
  paint();
  return section('Notifications',
    h('div', { class: 'card' },
      list([{ icon: 'bell', label: 'This device', trailing: value }]),
      hint,
      slot));
}

function feedSection() {
  const url = input({ readonly: true, value: 'Loading…', 'aria-label': 'Calendar feed link', class: 'mono' });
  get('/api/ics-url').then((r) => { url.value = location.origin + r.path; }).catch(() => { url.value = 'Unavailable'; });
  return section('Calendar feed',
    h('div', { class: 'card' },
      h('p', { class: 'hint first' }, 'Subscribe in Apple or Google Calendar to see approved evenings beside everything else.'),
      h('div', { class: 'input-action' }, url,
        iconBtn('copy', 'Copy link', act(async () => { await navigator.clipboard.writeText(url.value); toast('Link copied'); })))));
}

function beerSection() {
  const name = input({ placeholder: 'e.g. Tiger', maxlength: '60', enterkeyhint: 'done' });
  const abv = input({ type: 'number', step: '0.1', min: '0', max: '20', placeholder: 'ABV %', inputmode: 'decimal', 'aria-label': 'ABV %' });
  const size = input({ type: 'number', min: '1', max: '2000', placeholder: 'ml', inputmode: 'numeric', 'aria-label': 'Size in ml' });
  const addBeer = act(async () => {
    if (!name.value.trim()) { name.focus(); throw new Error('Name the beer'); }
    await post('/api/beer-types', { name: name.value.trim(), abv: abv.value ? Number(abv.value) : null, size_ml: size.value ? Number(size.value) : null });
    toast(`${name.value.trim()} added`);
    await refresh({ beerTypes: true });
  });
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') addBeer({}); });
  return section('Beer list',
    h('div', { class: 'card' },
      state.beerTypes.length
        ? list(state.beerTypes.map((t) => ({
          icon: 'glass', label: t.name,
          sub: [t.abv != null && `${t.abv}%`, t.size_ml && `${t.size_ml} ml`].filter(Boolean).join(' · ') || null,
          trailing: iconBtn('close', `Remove ${t.name}`, act(async () => { await del(`/api/beer-types/${t.id}`); toast(`${t.name} removed`); await refresh({ beerTypes: true }); })),
        })))
        : h('p', { class: 'hint first' }, 'Add the beers you usually drink for one-tap logging.'),
      h('div', { class: 'add-beer' },
        field('Add a beer', name),
        h('div', { class: 'two' }, abv, size),
        btn('Add', { icon: 'plus', block: true, onclick: addBeer }))));
}

export const settingsView = {
  noPoll: true, // the page has inputs; don't re-render under the user's fingers

  render() {
    const who = isHost() ? 'Host' : 'Wife';
    return h('div', { class: 'page' },
      h('header', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Settings'))),
      h('div', { class: 'card account' },
        h('span', { class: 'avatar' }, who[0]),
        h('span', { class: 'list-main' }, h('span', { class: 'list-label' }, `Signed in as ${who.toLowerCase()}`), h('span', { class: 'list-sub' }, isHost() ? 'You plan evenings and log the night.' : 'You reply to requests.'))),
      notificationsSection(),
      feedSection(),
      isHost() && beerSection(),
      h('div', { class: 'signout' }, btn('Sign out', { kind: 'ghost', icon: 'logout', onclick: act(async () => {
        if (!await confirmSheet({ title: 'Sign out?', message: 'You\'ll need your PIN to get back in.', confirm: 'Sign out' })) return;
        await post('/api/logout');
        location.reload();
      }) })),
      h('p', { class: 'colophon' }, icon('glass', 14), 'Evenings'));
  },
};
