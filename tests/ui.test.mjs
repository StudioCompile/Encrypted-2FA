// UI smoke test: the real app.html in jsdom against `wrangler dev`, with a fake Google and a fake passkey authenticator.
import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { webcrypto, createHmac, randomBytes } from 'node:crypto';
import { JSDOM, VirtualConsole } from 'jsdom';
import { startJwks, mintToken } from './helpers.mjs';
const BASE = process.env.BASE || 'http://localhost:8788';
const jwks = await startJwks();
const jar = new Map();
const authenticator = { secret: randomBytes(32), creds: new Map(), prompts: 0 };   // fake hardware passkey

async function boot(path = '/app.html', { passkeys = true } = {}) {
  const vc = new VirtualConsole(), errors = [];
  vc.on('jsdomError', e => errors.push(e.message)); vc.on('error', e => errors.push(String(e)));
  const dom = await JSDOM.fromURL(BASE + path, {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      for (const [k, v] of Object.entries({ crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, DataView, Blob, indexedDB, structuredClone })) Object.defineProperty(w, k, { value: v, configurable: true, writable: true });
      w.scrollTo = () => {}; w.URL.createObjectURL = () => 'blob:x'; w.URL.revokeObjectURL = () => {};
      Object.defineProperty(w.navigator, 'clipboard', { value: { writeText: async t => { w.__clip = t; } } });
      w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
      w.HTMLDialogElement.prototype.close = function () { if (!this.open) return; this.removeAttribute('open'); this.dispatchEvent(new w.Event('close')); };
      // fake Google Identity Services
      w.google = { accounts: { id: { initialize(cfg) { w.__gis = cfg; }, renderButton(el) { el.innerHTML = '<button id="fake-g">Continue with Google</button>'; }, disableAutoSelect() {} } } };
      // fake WebAuthn authenticator with the PRF extension (user verification is simulated)
      if (passkeys) {
        w.PublicKeyCredential = function () {};
        const prf = salt => new Uint8Array(createHmac('sha256', authenticator.secret).update(Buffer.from(salt)).digest());
        Object.defineProperty(w.navigator, 'credentials', { value: {
          async create(o) { authenticator.prompts++; const id = randomBytes(32); authenticator.creds.set(id.toString('hex'), 1); const salt = o.publicKey.extensions.prf.eval.first;
            return { rawId: id.buffer.slice(id.byteOffset, id.byteOffset + 32), getClientExtensionResults: () => ({ prf: { enabled: true, results: { first: prf(salt).buffer } } }) }; },
          async get(o) { authenticator.prompts++; const id = Buffer.from(o.publicKey.allowCredentials[0].id).toString('hex');
            if (!authenticator.creds.has(id)) { const e = new Error('no'); e.name = 'NotAllowedError'; throw e; }
            return { getClientExtensionResults: () => ({ prf: { results: { first: prf(o.publicKey.extensions.prf.eval.first).buffer } } }) }; }
        } });
      }
      w.fetch = async (u, o = {}) => {
        const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
        const res = await fetch(new URL(u, BASE), { ...o, headers: { ...(o.headers || {}), ...(cookie ? { Cookie: cookie } : {}) } });
        for (const sc of res.headers.getSetCookie()) { const kv = sc.split(';')[0], i = kv.indexOf('='), k = kv.slice(0, i), v = kv.slice(i + 1); if (v === '' || /Max-Age=0/i.test(sc)) jar.delete(k); else jar.set(k, v); }
        return res;
      };
    }
  });
  dom.errors = errors; return dom;
}
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, label, ms = 20000) { const t = Date.now(); for (;;) { try { const v = fn(); if (v) return v; } catch {} if (Date.now() - t > ms) throw new Error('Timed out: ' + label); await wait(50); } }
let n = 0; const ok = s => console.log('  ✓', ++n, s);

function api(dom) {
  const d = dom.window.document, W = dom.window, $ = s => d.querySelector(s);
  return { d, W, $,
    vis: s => { const e = $(s); return !!e && !e.hidden && !e.closest('[hidden]'); },
    type: (s, v) => { const e = $(s); e.value = v; e.dispatchEvent(new W.Event('input', { bubbles: true })); },
    click: async s => { $(s).click(); await wait(40); },
    submit: s => $(s).dispatchEvent(new W.Event('submit', { bubbles: true, cancelable: true })),
    google: async (sub, email) => { const t = mintToken({ sub, email, nonce: W.__gis.nonce }); await W.__gis.callback({ credential: t }); },
    check: (s, on = true) => { const e = $(s); e.checked = on; e.dispatchEvent(new W.Event('input', { bubbles: true })); }
  };
}
const sub = 'ui-' + Date.now(), email = `ui${Date.now()}@gmail.com`, PC = 'a long secure passcode 77', PC2 = 'my second long passcode 88', PC3 = 'recovered passcode 99';
let rk;

// ================= cloud (Google account) =================
{
  const dom = await boot(); const { $, vis, type, click, submit, d, W, google, check } = api(dom);
  await until(() => vis('[data-view=welcome]'), 'welcome'); await until(() => $('#fake-g'), 'google button');
  assert.ok(vis('#btn-use-local')); ok('welcome offers Google sign-in or no account');
  await google(sub, email); await until(() => vis('[data-view=setup]'), 'setup'); ok('Google sign-in leads to creating a passcode (no password to type for Google)');
  type('#sp-pc', 'short'); type('#sp-pc2', 'short'); submit('[data-form=setup]');
  await until(() => /at least 10/.test($('[data-view=setup] .form-error').textContent), 'short'); ok('short passcode rejected');
  type('#sp-pc', PC); type('#sp-pc2', 'nope'); submit('[data-form=setup]'); await until(() => /don.t match/.test($('[data-view=setup] .form-error').textContent), 'mismatch'); ok('mismatched passcodes rejected');
  type('#sp-pc2', PC); submit('[data-form=setup]'); await until(() => vis('[data-view=recovery-key]'), 'recovery key');
  rk = $('#rk-code').textContent; assert.match(rk, /^([A-Z2-7]{4}-){7}[A-Z2-7]{4}$/); assert.ok($('#rk-continue').disabled);
  check('#rk-saved'); await click('#rk-continue'); await until(() => vis('[data-view=passkey-offer]'), 'passkey offer'); ok('recovery key shown, then a passkey is offered');
  await click('#btn-pk-now'); await until(() => vis('#app'), 'app after passkey'); assert.ok(authenticator.prompts >= 1); ok('passkey created (PRF secret read from the authenticator) and vault opens');
  assert.equal($('#acct-name').textContent, email);

  await click('[data-act=add-code]'); type('#code-issuer', 'GitHub'); type('#code-name', 'me@x.com'); type('#code-secret', 'JBSW Y3DP EHPK 3PXP'); submit('[data-form=code]');
  await until(() => $('#code-list .code-row'), 'code row'); await until(() => /^\d{3} \d{3}$/.test($('#code-list .digits').textContent), 'digits'); ok('code added with live digits');
  await click('[data-act=nav][data-page=files]'); await click('[data-act=new-note]'); type('#note-title', 'Backup codes'); type('#note-body', 'abc-123'); submit('[data-form=note]');
  await until(() => /Backup codes/.test($('#file-list').textContent), 'note'); ok('note saved');
  assert.ok(dom.window.localStorage.length === 0 || ![...Array(dom.window.localStorage.length).keys()].some(i => /pass|key|secret/i.test(dom.window.localStorage.key(i) + dom.window.localStorage.getItem(dom.window.localStorage.key(i)))) , 'nothing secret in localStorage'); ok('nothing secret is written to localStorage');

  // lock, wrong passcode, passcode, passkey
  await click('[data-act=lock]'); await until(() => vis('[data-view=unlock]'), 'unlock'); assert.ok(!vis('#app')); assert.equal($('#code-list').innerHTML, '');
  assert.ok(vis('#btn-unlock-passkey')); ok('lock clears everything and asks again (passkey button offered)');
  type('#uk-pc', 'wrong passcode here'); submit('[data-form=unlock]'); await until(() => /Incorrect passcode/.test($('[data-view=unlock] .form-error').textContent), 'wrong'); ok('wrong passcode refused');
  type('#uk-pc', PC); submit('[data-form=unlock]'); await until(() => vis('#app'), 'unlock pc'); ok('unlock with passcode');
  await click('[data-act=nav][data-page=codes]'); await until(() => d.querySelectorAll('#code-list .code-row').length === 1, 'items'); 
  await click('[data-act=lock]'); await until(() => vis('[data-view=unlock]'), 'locked again'); await click('#btn-unlock-passkey'); await until(() => vis('#app'), 'unlock passkey'); ok('unlock with passkey (no passcode typed)');
  assert.equal(d.querySelectorAll('#code-list .code-row').length, 1); ok('data is intact after passkey unlock');
  dom.window.close();
}

// ================= reload: session persists, but nothing opens without the passcode =================
{
  const dom = await boot(); const { $, vis, type, click, submit, d } = api(dom);
  await until(() => vis('[data-view=unlock]'), 'unlock after reload'); assert.ok(!vis('#app')); assert.equal(d.querySelectorAll('.code-row').length, 0);
  assert.equal($('#unlock-sub').textContent, email); ok('after a reload you are still signed in but the vault is locked and empty');
  type('#uk-pc', PC); submit('[data-form=unlock]'); await until(() => vis('#app'), 'unlock reload');

  // change passcode
  await click('[data-act=nav][data-page=settings]'); assert.ok(vis('#row-passkey')); assert.match($('#passkey-status').textContent, /Set up/);
  await click('[data-act=change-passcode]'); type('#pw-current', PC); type('#pw-new', PC2); type('#pw-confirm', PC2); submit('[data-form=passcode]');
  await until(() => !$('#dlg-passcode').open, 'changed'); ok('passcode changed');
  await click('[data-act=lock]'); await until(() => vis('[data-view=unlock]'), 'lock'); type('#uk-pc', PC); submit('[data-form=unlock]');
  await until(() => /Incorrect passcode/.test($('[data-view=unlock] .form-error').textContent), 'old'); ok('old passcode no longer works');
  await click('#btn-unlock-passkey'); await until(() => vis('#app'), 'passkey after change'); ok('passkey still works after changing the passcode');

  // remove passkey
  await click('[data-act=nav][data-page=settings]'); await click('#btn-passkey'); assert.ok($('#dlg-confirm').open); await click('#confirm-ok');
  await until(() => $('#dlg-prompt').open, 'prompt'); type('#prompt-input', PC2); submit('[data-form=prompt]');
  await until(() => /Not set up/.test($('#passkey-status').textContent), 'removed'); ok('passkey removed (needs the passcode)');
  await click('[data-act=lock]'); await until(() => vis('[data-view=unlock]'), 'lock2'); assert.ok(!vis('#btn-unlock-passkey')); ok('no passkey button once it is removed');

  // forgot passcode -> recovery key
  await click('[data-act=forgot]'); await until(() => vis('[data-view=recover]'), 'recover view');
  type('#rc-key', 'AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA'); type('#rc-pc', PC3); type('#rc-pc2', PC3); submit('[data-form=recover]');
  await until(() => /incorrect/.test($('[data-view=recover] .form-error').textContent), 'bad rk'); ok('wrong recovery key refused');
  type('#rc-key', rk.toLowerCase().replace(/-/g, ' ')); submit('[data-form=recover]'); await until(() => vis('[data-view=recovery-key]'), 'new rk');
  const rk2 = $('#rk-code').textContent; assert.notEqual(rk2, rk); api(dom).check('#rk-saved'); await click('#rk-continue');
  await until(() => vis('#app') && d.querySelectorAll('#code-list .code-row').length === 1, 'after recovery'); ok('recovery key resets the passcode, keeps the data and issues a new key');

  // sign out, sign back in with Google, same vault
  await click('#btn-signout'); await until(() => vis('[data-view=welcome]'), 'signed out'); await until(() => $('#fake-g'), 'g btn');
  await api(dom).google(sub, email); await until(() => vis('[data-view=unlock]'), 'back'); type('#uk-pc', PC3); submit('[data-form=unlock]');
  await until(() => vis('#app') && d.querySelectorAll('#code-list .code-row').length === 1, 'same vault'); ok('signing in with the same Google account reopens the same vault');

  // delete account
  await click('[data-act=nav][data-page=settings]'); await click('[data-act=delete-account]'); type('#prompt-input', PC3); submit('[data-form=prompt]');
  await until(() => vis('[data-view=welcome]'), 'deleted'); ok('account deleted');
  assert.deepEqual(dom.errors, [], dom.errors.join('\n')); ok('no script errors (cloud)');
  dom.window.close();
}

// ================= local (no account) =================
{
  jar.clear();
  let dom = await boot('/app.html#local'); let { $, vis, type, click, submit, d, check } = api(dom);
  await until(() => vis('[data-view=setup]'), 'local setup'); assert.match($('#setup-warn').textContent, /no recovery option/); ok('no-account mode starts at creating a passcode');
  type('#sp-pc', 'local passcode 123'); type('#sp-pc2', 'local passcode 123'); submit('[data-form=setup]'); await until(() => vis('[data-view=passkey-offer]'), 'offer');
  await click('[data-act=pk-skip]'); await until(() => vis('#app'), 'local app'); assert.equal($('#acct-name').textContent, 'This device'); ok('local vault created, passkey skipped');
  await click('[data-act=add-code]'); type('#code-issuer', 'Local'); type('#code-secret', 'JBSWY3DPEHPK3PXP'); submit('[data-form=code]'); await until(() => $('#code-list .code-row'), 'row');
  await click('[data-act=nav][data-page=settings]'); assert.ok($('[data-only=cloud]').hidden); await click('#btn-passkey');
  await until(() => $('#dlg-prompt').open, 'prompt'); type('#prompt-input', 'local passcode 123'); submit('[data-form=prompt]');
  await until(() => /Set up/.test($('#passkey-status').textContent), 'pk added'); ok('passkey added from Settings (local)');
  dom.window.close();

  // fresh page load: IndexedDB persists, vault is locked
  dom = await boot('/app.html#local'); ({ $, vis, type, click, submit, d } = api(dom));
  await until(() => vis('[data-view=unlock]'), 'local unlock'); assert.equal(d.querySelectorAll('.code-row').length, 0); assert.ok(vis('#btn-unlock-passkey')); ok('after a reload the saved vault is locked and needs the passcode or passkey');
  type('#uk-pc', 'nope nope nope'); submit('[data-form=unlock]'); await until(() => /Incorrect/.test($('[data-view=unlock] .form-error').textContent), 'bad'); ok('wrong passcode refused');
  await click('#btn-unlock-passkey'); await until(() => vis('#app') && $('#code-list .code-row'), 'pk unlock'); ok('unlock with passkey');
  await click('[data-act=lock]'); await until(() => vis('[data-view=unlock]'), 'l2'); type('#uk-pc', 'local passcode 123'); submit('[data-form=unlock]'); await until(() => vis('#app'), 'pc unlock'); ok('unlock with passcode');
  // the stored profile contains no passcode / key material in the clear
  const prof = await new Promise(res => { const r = indexedDB.open('vault-local'); r.onsuccess = () => { const g = r.result.transaction('meta').objectStore('meta').get('profile'); g.onsuccess = () => res(g.result); }; });
  assert.ok(!JSON.stringify(prof).includes('local passcode')); assert.ok(prof.wrappedDek && prof.passkey.wrappedDek); ok('stored profile holds only salts and wrapped keys');
  await click('[data-act=nav][data-page=settings]'); await click('[data-act=delete-local]'); await click('#confirm-ok'); await until(() => vis('[data-view=welcome]'), 'wiped'); ok('local data can be deleted');
  assert.deepEqual(dom.errors, [], dom.errors.join('\n')); ok('no script errors (local)');
  dom.window.close();
}
console.log(`\nUI smoke test passed (${n} checks).`); jwks.close(); process.exit(0);
