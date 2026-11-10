import { h } from '../dom.js';
import { post } from '../api.js';
import { act, btn, segmented } from '../ui.js';

export function loginView(onSuccess) {
  let role = 'host';
  const pin = h('input', { class: 'pin', type: 'password', inputmode: 'numeric', autocomplete: 'current-password', 'aria-label': 'PIN', placeholder: '••••', enterkeyhint: 'go' });
  const go = btn('Continue', { kind: 'primary', block: true, attrs: { disabled: true } });
  const card = h('form', { class: 'login', onsubmit: (e) => { e.preventDefault(); go.click(); } },
    h('img', { src: '/static/icon-192.png', alt: '', class: 'login-mark', width: '72', height: '72' }),
    h('h1', {}, 'Evenings'),
    h('p', {}, 'Who’s checking in?'),
    segmented([['host', 'Me'], ['wife', 'Wife']], role, (r) => { role = r; pin.focus(); }),
    pin, go);
  pin.addEventListener('input', () => { go.disabled = pin.value.length < 4; });
  go.addEventListener('click', act(async () => {
    try { await post('/api/login', { role, pin: pin.value }); } catch (e) {
      card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake');
      pin.select();
      throw e;
    }
    await onSuccess(role);
  }));
  setTimeout(() => pin.focus(), 50);
  return card;
}
