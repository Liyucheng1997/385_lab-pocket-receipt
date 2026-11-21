// 登录 / 注册（账号模式下未登录时显示）
import { h, mount, seg, toast } from '../ui.js';
import { icon } from '../icons.js';
import { t } from '../i18n.js';
import { cloudInfo, signIn } from '../cloud.js';

export function renderAuth(root) {
  const st = { mode: 'login', name: '', password: '', again: '', invite: '', busy: false };

  function field(iconName, props) {
    return h('label', { class: 'auth-field' }, icon(iconName, 18), h('input', { class: 'auth-input', ...props }));
  }

  async function submit(e) {
    e.preventDefault();
    if (st.busy) return;
    const name = st.name.trim();
    if (!/^[\p{L}\p{N}_.-]{2,20}$/u.test(name)) return toast(t('auth.err.bad_name'), 'error');
    if (st.password.length < 6) return toast(t('auth.err.bad_password'), 'error');
    if (st.mode === 'register' && st.password !== st.again) return toast(t('auth.err.mismatch'), 'error');
    st.busy = true;
    draw();
    try {
      await signIn(st.mode, { name, password: st.password, invite: st.invite.trim() });
    } catch (err) {
      st.busy = false;
      draw();
      toast(t(`auth.err.${err.message}`), 'error');
    }
    return null;
  }

  function draw() {
    const reg = st.mode === 'register';
    mount(root,
      h('div', { class: 'auth' },
        h('div', { class: 'auth-brand' },
          h('div', { class: 'logo-mark auth-logo' }, icon('receipt', 30, 2)),
          h('h1', null, t('app.name')),
          h('p', null, t('auth.slogan'))),
        h('div', { class: 'card auth-card' },
          seg([{ value: 'login', label: t('auth.login') }, { value: 'register', label: t('auth.register') }], st.mode, (v) => { st.mode = v; draw(); }),
          h('form', { class: 'auth-form', onsubmit: submit },
          field('user', { name: 'username', autocomplete: 'username', autocapitalize: 'none', spellcheck: false, maxLength: 20, placeholder: t('auth.name'), value: st.name, oninput: (e) => (st.name = e.target.value) }),
          field('key', { name: 'password', type: 'password', autocomplete: reg ? 'new-password' : 'current-password', maxLength: 200, placeholder: t('auth.password'), value: st.password, oninput: (e) => (st.password = e.target.value) }),
          reg && field('key', { type: 'password', autocomplete: 'new-password', maxLength: 200, placeholder: t('auth.again'), value: st.again, oninput: (e) => (st.again = e.target.value) }),
          reg && cloudInfo().invite && field('sparkles', { autocomplete: 'off', maxLength: 80, placeholder: t('auth.invite'), value: st.invite, oninput: (e) => (st.invite = e.target.value) }),
          h('button', { class: 'btn btn-primary btn-lg auth-submit', type: 'submit', disabled: st.busy }, t(st.busy ? 'auth.wait' : reg ? 'auth.register' : 'auth.login')),
          h('p', { class: 'auth-note' }, t(reg ? 'auth.regNote' : 'auth.loginNote'))))));
  }
  draw();
}
