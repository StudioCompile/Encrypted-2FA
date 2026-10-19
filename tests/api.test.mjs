// Integration test against `wrangler pages dev` (default http://localhost:8788).
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import '../public/js/crypto.js';
import '../public/js/totp.js';
const C = globalThis.VaultCrypto, T = globalThis.VaultTOTP;
const BASE = process.env.BASE || 'http://localhost:8788';

let cookie = '';
async function call(method, path, body, { keepCookie = true, headers = {} } = {}) {
  const res = await fetch(BASE + '/api' + path, {
    method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined
  });
  const sc = res.headers.get('set-cookie');
  if (sc && keepCookie) cookie = sc.split(';')[0].endsWith('=') ? '' : sc.split(';')[0];
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}
const email = `t${Date.now()}@example.com`, pw = 'correct horse battery staple';
let ok = 0; const step = n => { ok++; console.log('  ✓', n); };

// --- crypto unit checks
const tv = await T.code('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', { time: 59000, digits: 8 });
assert.equal(tv, '94287082'); step('RFC 6238 SHA1 vector');
assert.equal(await T.code('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', { time: 1111111109000, digits: 8 }), '07081804'); step('RFC 6238 vector 2');
const s256 = C.base32Encode(new TextEncoder().encode('12345678901234567890123456789012'));
assert.equal(await T.code(s256, { time: 59000, digits: 8, algorithm: 'SHA256' }), '46119246'); step('RFC 6238 SHA256 vector');
const parsed = T.parseOtpAuth('otpauth://totp/GitHub:me@x.com?secret=jbsw y3dp ehpk3pxp&issuer=GitHub&digits=8&algorithm=SHA256&period=60');
assert.deepEqual(parsed, { issuer: 'GitHub', name: 'me@x.com', secret: 'JBSWY3DPEHPK3PXP', period: 60, digits: 8, algorithm: 'SHA256' }); step('otpauth parse');
// Google Authenticator export: one entry, hand-built protobuf
{
  const te = new TextEncoder(), secret = new Uint8Array([1,2,3,4,5,6,7,8,9,10]);
  const field = (f, v) => v instanceof Uint8Array ? [f<<3|2, v.length, ...v] : [f<<3, v];
  const entry = new Uint8Array([...field(1, secret), ...field(2, te.encode('me@x.com')), ...field(3, te.encode('Acme')), ...field(4, 2), ...field(5, 2), ...field(6, 2)]);
  const payload = new Uint8Array([...field(1, entry), ...field(2, 1)]);
  const [m] = T.parseMigration('otpauth-migration://offline?data=' + encodeURIComponent(C.b64.enc(payload)));
  assert.equal(m.issuer, 'Acme'); assert.equal(m.digits, 8); assert.equal(m.algorithm, 'SHA256'); assert.equal(C.base32Decode(m.secret).join(), secret.join());
  step('Google Authenticator export parse');
}
const rcode = C.generateRecoveryCode(); assert.match(rcode, /^([A-Z2-7]{4}-){7}[A-Z2-7]{4}$/); step('recovery code format');

// --- signup
const pwc = await C.passwordCredentials(email, pw);
const rcc = await C.recoveryCredentials(email, rcode);
const dek = await C.newDEK();
const wrapped = await C.wrapDEK(dek, pwc.kek), rcWrapped = await C.wrapDEK(dek, rcc.kek);
let r = await call('POST', '/register', { email, authKey: pwc.auth, wrappedDek: wrapped, rcAuth: rcc.auth, rcWrappedDek: rcWrapped });
assert.equal(r.status, 201); assert.ok(cookie.startsWith('sid=')); step('register');
r = await call('POST', '/register', { email, authKey: pwc.auth, wrappedDek: wrapped, rcAuth: rcc.auth, rcWrappedDek: rcWrapped });
assert.equal(r.status, 409); step('duplicate email rejected');
r = await call('POST', '/register', { email: 'bad', authKey: pwc.auth }); assert.equal(r.status, 400); step('bad email rejected');

// --- session
r = await call('GET', '/session'); assert.equal(r.status, 200); assert.equal(r.data.email, email); assert.equal(r.data.wrappedDek, wrapped); step('session');

// --- items
const live = await C.unwrapDEK(wrapped, pwc.kek);
const id1 = C.uid();
r = await call('PUT', '/items/' + id1, { data: await C.sealJSON(live, { type: 'totp', issuer: 'GitHub', secret: 'JBSWY3DPEHPK3PXP' }, id1) });
assert.equal(r.status, 200); step('put totp item');
const id2 = C.uid(), bytes = new Uint8Array(randomBytes(1024 * 1024));
r = await call('PUT', '/items/' + id2, { data: await C.sealJSON(live, { type: 'file', title: 'big.bin', size: bytes.length }, id2), file: await C.sealFile(live, bytes, id2) });
assert.equal(r.status, 200); step('put 1 MiB file item');
r = await call('GET', '/items'); assert.equal(r.data.items.length, 2);
const row1 = r.data.items.find(i => i.id === id1), row2 = r.data.items.find(i => i.id === id2);
assert.equal(row1.hasFile, false); assert.equal(row2.hasFile, true);
assert.equal((await C.openJSON(live, row1.data, id1)).issuer, 'GitHub'); step('list + decrypt');
r = await call('GET', `/items/${id2}/file`); const back = await C.openFile(live, r.data.file, id2);
assert.equal(Buffer.compare(Buffer.from(back), Buffer.from(bytes)), 0); step('file round-trip');
// update metadata only: file must be kept
r = await call('PUT', '/items/' + id2, { data: await C.sealJSON(live, { type: 'file', title: 'renamed.bin', size: bytes.length }, id2) });
r = await call('GET', '/items'); assert.equal(r.data.items.find(i => i.id === id2).hasFile, true); step('metadata update keeps file');
// swapping ciphertext between ids must fail (AAD binding)
await assert.rejects(C.openJSON(live, row1.data, id2)); step('ciphertext bound to item id');
r = await call('PUT', '/items/short', { data: 'x' }); assert.equal(r.status, 400); step('bad id rejected');
r = await call('PUT', '/items/' + C.uid(), { data: 'x', file: 'y'.repeat(1_500_000) }); assert.equal(r.status, 413); step('oversize file rejected');
r = await call('DELETE', '/items/' + id2); assert.equal(r.status, 200);
r = await call('GET', '/items'); assert.equal(r.data.items.length, 1); step('delete item');

// --- CSRF guard
r = await call('POST', '/logout-all', {}, { headers: { Origin: 'https://evil.example' } }); assert.equal(r.status, 403); step('cross-origin write blocked');

// --- logout / login
r = await call('POST', '/logout', {}); assert.equal(cookie, ''); 
r = await call('GET', '/items'); assert.equal(r.status, 401); step('logout');
let wrong = await C.passwordCredentials(email, 'not the password');
r = await call('POST', '/login', { email, authKey: wrong.auth }); assert.equal(r.status, 401); assert.equal(r.data.error, 'Incorrect email or password.'); step('wrong password');
r = await call('POST', '/login', { email: 'nobody@example.com', authKey: wrong.auth }); assert.equal(r.status, 401); assert.equal(r.data.error, 'Incorrect email or password.'); step('unknown email gives same error');
r = await call('POST', '/login', { email: email.toUpperCase(), authKey: pwc.auth }); assert.equal(r.status, 200); assert.equal(r.data.wrappedDek, wrapped); step('login (case-insensitive email)');

// --- change password
const npw = 'a brand new passphrase 42';
const npc = await C.passwordCredentials(email, npw);
const dekX = await C.unwrapDEK(wrapped, pwc.kek, true);
const nWrapped = await C.wrapDEK(dekX, npc.kek);
r = await call('POST', '/password', { authKey: wrong.auth, newAuthKey: npc.auth, wrappedDek: nWrapped }); assert.equal(r.status, 401); step('change password needs current password');
r = await call('POST', '/password', { authKey: pwc.auth, newAuthKey: npc.auth, wrappedDek: nWrapped }); assert.equal(r.status, 200); step('change password');
const savedCookie = cookie; cookie = '';
r = await call('POST', '/login', { email, authKey: pwc.auth }); assert.equal(r.status, 401); step('old password no longer works');
r = await call('POST', '/login', { email, authKey: npc.auth }); assert.equal(r.status, 200);
const dek2 = await C.unwrapDEK(r.data.wrappedDek, npc.kek);
r = await call('GET', '/items'); assert.equal((await C.openJSON(dek2, r.data.items[0].data, r.data.items[0].id)).issuer, 'GitHub'); step('data readable after password change');

// --- new recovery key
const rc2 = C.generateRecoveryCode(), rcc2 = await C.recoveryCredentials(email, rc2);
r = await call('POST', '/recovery', { authKey: npc.auth, rcAuth: rcc2.auth, rcWrappedDek: await C.wrapDEK(dekX, rcc2.kek) }); assert.equal(r.status, 200); step('rotate recovery key');
cookie = '';
r = await call('POST', '/recover/start', { email, rcAuth: rcc.auth }); assert.equal(r.status, 401); step('old recovery key rejected');

// --- forgot password via recovery key
r = await call('POST', '/recover/start', { email, rcAuth: rcc2.auth }); assert.equal(r.status, 200);
const dekR = await C.unwrapDEK(r.data.rcWrappedDek, rcc2.kek, true);
const pw3 = 'third password after recovery', pc3 = await C.passwordCredentials(email, pw3);
const rc3 = C.generateRecoveryCode(), rcc3 = await C.recoveryCredentials(email, rc3);
r = await call('POST', '/recover/finish', { email, rcAuth: rcc2.auth, authKey: pc3.auth, wrappedDek: await C.wrapDEK(dekR, pc3.kek), rcAuth2: rcc3.auth, rcWrappedDek2: await C.wrapDEK(dekR, rcc3.kek) });
assert.equal(r.status, 200); assert.ok(cookie.startsWith('sid=')); step('recover with recovery key');
r = await call('GET', '/items'); const dek3 = await C.unwrapDEK((await call('GET', '/session')).data.wrappedDek, pc3.kek);
assert.equal((await C.openJSON(dek3, r.data.items[0].data, r.data.items[0].id)).issuer, 'GitHub'); step('data still readable after recovery');
const oldCookie = savedCookie; cookie = oldCookie; r = await call('GET', '/items'); assert.equal(r.status, 401); step('old sessions revoked');
cookie = ''; await call('POST', '/login', { email, authKey: pc3.auth });

// --- sign out everywhere
r = await call('POST', '/logout-all', {}); assert.equal(r.status, 200); r = await call('GET', '/session'); assert.equal(r.status, 401); step('sign out everywhere');

// --- lockout after repeated failures
for (let i = 0; i < 8; i++) r = await call('POST', '/login', { email, authKey: wrong.auth });
r = await call('POST', '/login', { email, authKey: pc3.auth }); assert.equal(r.status, 429); step('account locks after 8 failures (even with the right password)');

// --- delete account (use a fresh account since the first is locked)
const e2 = `d${Date.now()}@example.com`, c2 = await C.passwordCredentials(e2, pw), rr = await C.recoveryCredentials(e2, rcode), d2 = await C.newDEK();
cookie = '';
r = await call('POST', '/register', { email: e2, authKey: c2.auth, wrappedDek: await C.wrapDEK(d2, c2.kek), rcAuth: rr.auth, rcWrappedDek: await C.wrapDEK(d2, rr.kek) }); assert.equal(r.status, 201);
await call('PUT', '/items/' + C.uid(), { data: 'abc' });
r = await call('DELETE', '/account', { authKey: wrong.auth }); assert.equal(r.status, 401);
r = await call('DELETE', '/account', { authKey: c2.auth }); assert.equal(r.status, 200);
r = await call('POST', '/login', { email: e2, authKey: c2.auth }); assert.equal(r.status, 401); step('delete account');
console.log(`\nAll ${ok} checks passed.`);
