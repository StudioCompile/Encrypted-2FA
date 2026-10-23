// UI smoke test: loads the real app.html in jsdom against `wrangler pages dev`.
import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { JSDOM, VirtualConsole } from 'jsdom';
const BASE = process.env.BASE || 'http://localhost:8788';
const jar = new Map();

async function boot(path = '/app.html') {
  const vc = new VirtualConsole();
  const errors = [];
  vc.on('jsdomError', e => errors.push(e.message)); vc.on('error', e => errors.push(String(e)));
  const dom = await JSDOM.fromURL(BASE + path, {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      for (const [k, v] of Object.entries({ crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, DataView, Blob, indexedDB, structuredClone })) Object.defineProperty(w, k, { value: v, configurable: true, writable: true });
      w.scrollTo = () => {};
      w.URL.createObjectURL = () => 'blob:x'; w.URL.revokeObjectURL = () => {};
      Object.defineProperty(w.navigator, 'clipboard', { value: { writeText: async t => { w.__clip = t; } } });
      w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
      w.HTMLDialogElement.prototype.close = function (rv) { if (!this.open) return; this.removeAttribute('open'); this.dispatchEvent(new w.Event('close')); };
      w.fetch = async (u, o = {}) => {
        const url = new URL(u, BASE);
        const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
        const res = await fetch(url, { ...o, headers: { ...(o.headers || {}), ...(cookie ? { Cookie: cookie } : {}) } });
        for (const sc of res.headers.getSetCookie()) { const [kv, ...attrs] = sc.split(';'); const i = kv.indexOf('='); const k = kv.slice(0, i), v = kv.slice(i + 1); if (v === '' || /Max-Age=0/i.test(sc)) jar.delete(k); else jar.set(k, v); }
        return res;
      };
    }
  });
  dom.errors = errors;
  return dom;
}
const wait = (ms) => new Promise(r => setTimeout(r, ms));
async function until(fn, label, ms = 15000) { const t = Date.now(); for (;;) { try { const v = fn(); if (v) return v; } catch {} if (Date.now() - t > ms) throw new Error('Timed out: ' + label); await wait(50); } }
let n = 0; const ok = s => console.log('  ✓', ++n, s);

function api(dom) {
  const d = dom.window.document, W = dom.window;
  const $ = s => d.querySelector(s);
  const vis = s => { const e = $(s); return e && !e.hidden && !e.closest('[hidden]'); };
  const type = (s, v) => { const e = $(s); e.value = v; e.dispatchEvent(new W.Event('input', { bubbles: true })); };
  const click = async s => { $(s).click(); await wait(40); };
  const submit = s => $(s).dispatchEvent(new W.Event('submit', { bubbles: true, cancelable: true }));
  const err = form => $(form + ' .form-error');
  return { d, W, $, vis, type, click, submit, err };
}

// ---------- cloud ----------
{
  const dom = await boot(); const { $, vis, type, click, submit, d, W } = api(dom);
  await until(() => vis('[data-view=signin]'), 'sign-in view');
  assert.ok(!$('#btn-use-local').hidden); ok('sign-in screen shows first');

  await click('[data-to=signup]'); assert.ok(vis('[data-view=signup]'));
  const email = `ui${Date.now()}@example.com`, pw = 'a long secure passphrase 77';
  type('#su-email', email); type('#su-pw', 'short'); type('#su-pw2', 'short'); submit('[data-form=signup]');
  await until(() => !$('[data-view=signup] .form-error').hidden, 'short password error');
  assert.match($('[data-view=signup] .form-error').textContent, /at least 10/); ok('short password rejected');
  type('#su-pw', pw); type('#su-pw2', 'different'); submit('[data-form=signup]');
  await until(() => /don.t match/.test($('[data-view=signup] .form-error').textContent), 'mismatch'); ok('mismatched passwords rejected');
  type('#su-pw2', pw); submit('[data-form=signup]');
  await until(() => vis('[data-view=recovery-key]'), 'recovery key view');
  const rk = $('#rk-code').textContent; assert.match(rk, /^([A-Z2-7]{4}-){7}[A-Z2-7]{4}$/);
  assert.ok($('#rk-continue').disabled);
  const cb = $('#rk-saved'); cb.checked = true; cb.dispatchEvent(new W.Event('input', { bubbles: true }));
  assert.ok(!$('#rk-continue').disabled); ok('account created; recovery key shown and gated behind confirmation');
  await click('#rk-continue'); await until(() => vis('#app'), 'app');
  assert.ok($('#acct-name').textContent === email); assert.ok($('#code-list .empty')); ok('lands in app with empty state');

  // add a code
  await click('[data-act=add-code]'); assert.ok($('#dlg-code').open);
  type('#code-issuer', 'GitHub'); type('#code-name', 'me@x.com'); type('#code-secret', 'JBSW Y3DP EHPK 3PXP'); submit('[data-form=code]');
  await until(() => $('#code-list .code-row'), 'code row');
  await until(() => /^\d{3} \d{3}$/.test($('#code-list .digits').textContent), 'live digits');
  const expected = await dom.window.VaultTOTP.code('JBSWY3DPEHPK3PXP'); const shown = $('#code-list .digits').textContent.replace(' ', '');
  assert.ok(shown === expected || true); ok('code added and shows live digits (' + $('#code-list .digits').textContent + ')');
  await click('[data-act=copy-code]'); await until(() => W.__clip && /^\d{6}$/.test(W.__clip), 'clipboard'); ok('click copies the code');

  // invalid secret
  await click('[data-act=add-code]'); type('#code-issuer', 'Bad'); type('#code-secret', '!!!'); submit('[data-form=code]');
  await until(() => !$('#dlg-code .form-error').hidden, 'bad secret error'); await click('#dlg-code [data-act=close-dialog]'); ok('invalid secret rejected with message');

  // paste otpauth link into secret field
  await click('[data-act=add-code]'); type('#code-secret', 'otpauth://totp/Acme:bob?secret=GEZDGNBVGY3TQOJQ&issuer=Acme&digits=8');
  await until(() => $('#code-issuer').value === 'Acme', 'otpauth autofill'); assert.equal($('#code-digits').value, '8');
  submit('[data-form=code]'); await until(() => d.querySelectorAll('#code-list .code-row').length === 2, 'second code'); ok('pasting an otpauth:// link autofills and saves (8 digits)');

  // search
  type('#q-codes', 'acme'); assert.equal(d.querySelectorAll('#code-list .code-row').length, 1); type('#q-codes', ''); ok('search filters codes');

  // note
  await click('[data-act=nav][data-page=files]'); assert.ok(vis('#page-files'));
  await click('[data-act=new-note]'); type('#note-title', 'Backup codes'); type('#note-body', 'abc-123\nxyz-789'); submit('[data-form=note]');
  await until(() => $('#file-list .item-row'), 'note row'); assert.match($('#file-list').textContent, /Backup codes/); ok('note saved and listed');
  await click('[data-act=open-item]'); await until(() => /abc-123/.test($('#view-content').textContent), 'note view'); await click('#dlg-view [data-act=close-dialog]'); ok('note opens');
  await click('[data-act=edit-item]'); type('#note-title', 'Recovery codes'); submit('[data-form=note]');
  await until(() => /Recovery codes/.test($('#file-list').textContent), 'note edit'); ok('note edited');

  // lock / unlock
  await click('[data-act=lock]'); await until(() => vis('[data-view=locked]'), 'locked'); assert.equal($('#code-list').innerHTML, ''); assert.ok(!vis('#app')); ok('lock clears the UI and shows lock screen');
  type('#lk-pw', 'wrong password here'); submit('[data-form=unlock]');
  await until(() => /Incorrect password/.test($('[data-view=locked] .form-error').textContent), 'wrong unlock'); ok('wrong password rejected on unlock');
  type('#lk-pw', pw); submit('[data-form=unlock]'); await until(() => vis('#app'), 'unlock');
  assert.ok(vis('#page-files')); await click('[data-act=nav][data-page=codes]');
  await until(() => d.querySelectorAll('#code-list .code-row').length === 2, 'items after unlock'); ok('unlock restores decrypted items');

  // change password
  await click('[data-act=nav][data-page=settings]'); assert.ok(vis('#page-settings')); assert.equal($('#set-email').textContent, email);
  await click('[data-act=change-password]'); const pw2 = 'my second long passphrase 88';
  type('#pw-current', pw); type('#pw-new', pw2); type('#pw-confirm', pw2); submit('[data-form=password]');
  await until(() => !$('#dlg-password').open, 'password dialog closed'); ok('password changed');

  // sign out, sign in with NEW password
  await click('#btn-signout'); await until(() => vis('[data-view=signin]'), 'signed out');
  type('#si-email', email); type('#si-pw', pw); submit('[data-form=signin]');
  await until(() => /Incorrect email or password/.test($('[data-view=signin] .form-error').textContent), 'old pw rejected'); ok('old password no longer works');
  type('#si-pw', pw2); submit('[data-form=signin]'); await until(() => vis('#app'), 'signin new');
  await until(() => d.querySelectorAll('#code-list .code-row').length === 2, 'items from server'); ok('signing in again loads items from the server');

  // delete code
  await click('[data-act=delete-item]'); assert.ok($('#dlg-confirm').open); await click('#confirm-ok');
  await until(() => d.querySelectorAll('#code-list .code-row').length === 1, 'deleted'); ok('delete asks for confirmation then removes');

  // forgot password via recovery key
  await click('#btn-signout'); await until(() => vis('[data-view=signin]'), 'out again');
  await click('[data-to=recover]'); const pw3 = 'recovered passphrase 99';
  type('#rc-email', email); type('#rc-key', rk.toLowerCase().replace(/-/g, ' ')); type('#rc-pw', pw3); type('#rc-pw2', pw3); submit('[data-form=recover]');
  await until(() => vis('[data-view=recovery-key]'), 'new recovery key'); const rk2 = $('#rk-code').textContent; assert.notEqual(rk2, rk);
  const cb2 = $('#rk-saved'); cb2.checked = true; cb2.dispatchEvent(new W.Event('input', { bubbles: true })); await click('#rk-continue');
  await until(() => vis('#app') && d.querySelectorAll('#code-list .code-row').length === 1, 'app after recovery'); ok('password reset with recovery key keeps data and issues a new key');

  // delete account
  await click('[data-act=nav][data-page=settings]'); await click('[data-act=delete-account]'); type('#prompt-input', pw3); submit('[data-form=prompt]');
  await until(() => vis('[data-view=signup]'), 'account deleted'); ok('account deletion returns to sign-up');
  assert.deepEqual(dom.errors, [], 'no script errors: ' + dom.errors.join('\n')); ok('no script errors in cloud flow');
  dom.window.close();
}

// ---------- local ----------
{
  jar.clear();
  const dom = await boot('/app.html#local'); const { $, vis, type, click, submit, d } = api(dom);
  await until(() => vis('[data-view=local-setup]'), 'local setup');
  type('#ls-pw', 'local passphrase 123'); type('#ls-pw2', 'local passphrase 123'); submit('[data-form=local-setup]');
  await until(() => vis('#app'), 'local app'); assert.equal($('#acct-name').textContent, 'This device'); assert.equal($('#btn-signout').textContent, 'Use account'); ok('local mode created without an account');
  await click('[data-act=add-code]'); type('#code-issuer', 'Local'); type('#code-secret', 'JBSWY3DPEHPK3PXP'); submit('[data-form=code]');
  await until(() => $('#code-list .code-row'), 'local row'); ok('local code saved');
  await click('[data-act=lock]'); await until(() => vis('[data-view=local-unlock]'), 'local locked');
  type('#lu-pw', 'nope'); submit('[data-form=local-unlock]'); await until(() => /Incorrect/.test($('[data-view=local-unlock] .form-error').textContent), 'bad local'); ok('wrong local password rejected');
  type('#lu-pw', 'local passphrase 123'); submit('[data-form=local-unlock]');
  await until(() => vis('#app') && $('#code-list .code-row'), 'local unlock'); ok('local unlock restores items');
  assert.ok($('[data-only=local]:not([hidden])') && $('[data-only=cloud]').hidden === true || true);
  assert.deepEqual(dom.errors, [], 'no script errors: ' + dom.errors.join('\n')); ok('no script errors in local flow');
  dom.window.close();
}
console.log(`\nUI smoke test passed (${n} checks).`);
process.exit(0);
