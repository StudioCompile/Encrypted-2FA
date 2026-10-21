// Integration test against `wrangler dev` started with:
//   --var GOOGLE_CLIENT_ID:test-client-id.apps.googleusercontent.com --var GOOGLE_JWKS_URL:http://127.0.0.1:9988/jwks
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import '../public/js/crypto.js';
import '../public/js/totp.js';
import { startJwks, mintToken, CLIENT_ID } from './helpers.mjs';
const C = globalThis.VaultCrypto, T = globalThis.VaultTOTP;
const BASE = process.env.BASE || 'http://localhost:8788';
const jwks = await startJwks();

let cookie = '';
async function call(method, path, body, { headers = {}, keep = true } = {}) {
  const res = await fetch(BASE + '/api' + path, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const sc = res.headers.get('set-cookie');
  if (sc && keep) cookie = /Max-Age=0/i.test(sc) ? '' : sc.split(';')[0];
  return { status: res.status, data: await res.json().catch(() => null) };
}
let ok = 0; const step = n => console.log('  ✓', ++ok, n);
const nonce = () => C.b64.enc(C.rand(18)).replace(/[+/=]/g, 'x');
const sub = 'g-' + Date.now(), email = `tester${Date.now()}@gmail.com`;

// ---- crypto unit checks
assert.equal(await T.code('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', { time: 59000, digits: 8 }), '94287082'); step('RFC 6238 SHA1 vector');
assert.equal(await T.code(C.base32Encode(new TextEncoder().encode('12345678901234567890123456789012')), { time: 59000, digits: 8, algorithm: 'SHA256' }), '46119246'); step('RFC 6238 SHA256 vector');
assert.deepEqual(T.parseOtpAuth('otpauth://totp/GitHub:me@x.com?secret=jbsw y3dp ehpk3pxp&issuer=GitHub&digits=8&period=60'), { issuer: 'GitHub', name: 'me@x.com', secret: 'JBSWY3DPEHPK3PXP', period: 60, digits: 8, algorithm: 'SHA1' }); step('otpauth parse');
{
  const te = new TextEncoder(), secret = new Uint8Array([1,2,3,4,5,6,7,8,9,10]);
  const f = (n, v) => v instanceof Uint8Array ? [n << 3 | 2, v.length, ...v] : [n << 3, v];
  const entry = new Uint8Array([...f(1, secret), ...f(2, te.encode('me@x.com')), ...f(3, te.encode('Acme')), ...f(4, 2), ...f(5, 2), ...f(6, 2)]);
  const [m] = T.parseMigration('otpauth-migration://offline?data=' + encodeURIComponent(C.b64.enc(new Uint8Array([...f(1, entry), ...f(2, 1)]))));
  assert.equal(m.issuer, 'Acme'); assert.equal(m.digits, 8); assert.equal(m.algorithm, 'SHA256'); step('Google Authenticator export parse');
}

// ---- config + Google sign-in
let r = await call('GET', '/config'); assert.equal(r.data.googleClientId, CLIENT_ID); step('config exposes the Google client id');
r = await call('GET', '/session'); assert.equal(r.status, 401); step('no session by default');
const n1 = nonce();
r = await call('POST', '/google', { credential: mintToken({ sub, email, nonce: n1 }), nonce: nonce() }); assert.equal(r.status, 401); step('token with the wrong nonce rejected');
r = await call('POST', '/google', { credential: mintToken({ sub, email, nonce: n1, aud: 'someone-else' }), nonce: n1 }); assert.equal(r.status, 401); step('token for another client id rejected');
r = await call('POST', '/google', { credential: mintToken({ sub, email, nonce: n1, exp: 1000 }), nonce: n1 }); assert.equal(r.status, 401); step('expired token rejected');
r = await call('POST', '/google', { credential: mintToken({ sub, email, nonce: n1, verified: false }), nonce: n1 }); assert.equal(r.status, 401); step('unverified email rejected');
r = await call('POST', '/google', { credential: mintToken({ sub, email, nonce: n1, iss: 'https://evil.example' }), nonce: n1 }); assert.equal(r.status, 401); step('wrong issuer rejected');
{ const t = mintToken({ sub, email, nonce: n1 }).split('.'); t[2] = t[2].slice(0, -4) + 'AAAA'; r = await call('POST', '/google', { credential: t.join('.'), nonce: n1 }); assert.equal(r.status, 401); step('tampered signature rejected'); }
assert.equal(cookie, '');
r = await call('POST', '/google', { credential: mintToken({ sub, email, nonce: n1 }), nonce: n1 });
assert.equal(r.status, 200); assert.equal(r.data.hasVault, false); assert.ok(cookie.startsWith('sid=')); step('valid Google token signs in (new account, no vault yet)');
r = await call('GET', '/session'); assert.equal(r.data.email, email); assert.equal(r.data.hasVault, false); assert.equal(r.data.passkey, null); step('session reports no vault');
r = await call('POST', '/unlock', { method: 'passcode', pcAuth: 'A'.repeat(43) + '=' }); assert.equal(r.status, 409); step('cannot unlock before a vault exists');

// ---- vault setup
const pcSalt = C.rand(16), pc = 'correct horse battery staple';
const pcc = await C.passcodeCredentials(pc, pcSalt);
const rk = C.generateRecoveryCode(), rcc = await C.recoveryCredentials(rk);
const dekX = await C.newDEK();
const pcWrapped = await C.wrapDEK(dekX, pcc.kek), rcWrapped = await C.wrapDEK(dekX, rcc.kek);
const vaultBody = { pcSalt: C.b64.enc(pcSalt), pcAuth: pcc.auth, pcWrappedDek: pcWrapped, rcAuth: rcc.auth, rcWrappedDek: rcWrapped };
r = await call('PUT', '/vault', { ...vaultBody, pcAuth: 'short' }); assert.equal(r.status, 400); step('malformed vault rejected');
r = await call('PUT', '/vault', vaultBody); assert.equal(r.status, 201); step('vault created');
r = await call('PUT', '/vault', vaultBody); assert.equal(r.status, 409); step('vault can only be created once');
r = await call('GET', '/session'); assert.equal(r.data.hasVault, true); assert.equal(r.data.pcSalt, C.b64.enc(pcSalt)); assert.ok(!('wrappedDek' in r.data)); step('session reveals the salt but never the wrapped key');

// ---- unlock
const wrong = await C.passcodeCredentials('not the passcode', pcSalt);
r = await call('POST', '/unlock', { method: 'passcode', pcAuth: wrong.auth }); assert.equal(r.status, 401); assert.equal(r.data.error, 'Incorrect passcode.'); step('wrong passcode refused (no key released)');
r = await call('POST', '/unlock', { method: 'passcode', pcAuth: pcc.auth }); assert.equal(r.status, 200); assert.equal(r.data.wrappedDek, pcWrapped); step('right passcode releases the wrapped key');
const dek = await C.unwrapDEK(pcWrapped, pcc.kek);
r = await call('POST', '/unlock', { method: 'passkey' }); assert.equal(r.status, 404); step('passkey unlock refused when none is set');

// ---- items
const id1 = C.uid();
r = await call('PUT', '/items/' + id1, { data: await C.sealJSON(dek, { type: 'totp', issuer: 'GitHub', secret: 'JBSWY3DPEHPK3PXP' }, id1) }); assert.equal(r.status, 200); step('put item');
const id2 = C.uid(), bytes = new Uint8Array(randomBytes(1024 * 1024));
r = await call('PUT', '/items/' + id2, { data: await C.sealJSON(dek, { type: 'file', title: 'big.bin' }, id2), file: await C.sealFile(dek, bytes, id2) }); assert.equal(r.status, 200); step('put 1 MiB file');
r = await call('GET', '/items'); assert.equal(r.data.items.length, 2);
const row1 = r.data.items.find(i => i.id === id1); assert.equal((await C.openJSON(dek, row1.data, id1)).issuer, 'GitHub'); step('list + decrypt');
r = await call('GET', `/items/${id2}/file`); assert.equal(Buffer.compare(Buffer.from(await C.openFile(dek, r.data.file, id2)), Buffer.from(bytes)), 0); step('file round-trip');
await call('PUT', '/items/' + id2, { data: await C.sealJSON(dek, { type: 'file', title: 'renamed' }, id2) });
r = await call('GET', '/items'); assert.equal(r.data.items.find(i => i.id === id2).hasFile, true); step('metadata update keeps the file');
await assert.rejects(C.openJSON(dek, row1.data, id2)); step('ciphertext is bound to its item id');
r = await call('PUT', '/items/' + C.uid(), { data: 'x', file: 'y'.repeat(1_500_000) }); assert.equal(r.status, 413); step('oversize file rejected');
r = await call('DELETE', '/items/' + id2); r = await call('GET', '/items'); assert.equal(r.data.items.length, 1); step('delete item');
r = await call('POST', '/logout-all', {}, { headers: { Origin: 'https://evil.example' } }); assert.equal(r.status, 403); step('cross-origin write blocked');

// ---- passkey wrapping (server side only stores what the client hands over)
const prf = new Uint8Array(randomBytes(32)), pkKek = await C.passkeyKey(prf);
const dekExt = await C.unwrapDEK(pcWrapped, pcc.kek, true);
const pkBody = { credId: C.b64.enc(randomBytes(32)), prfSalt: C.b64.enc(randomBytes(32)), wrappedDek: await C.wrapDEK(dekExt, pkKek) };
r = await call('POST', '/passkey', { ...pkBody, pcAuth: wrong.auth }); assert.equal(r.status, 401); step('adding a passkey needs the passcode');
r = await call('POST', '/passkey', { ...pkBody, pcAuth: pcc.auth }); assert.equal(r.status, 200);
r = await call('GET', '/session'); assert.equal(r.data.passkey.credId, pkBody.credId); step('passkey registered');
r = await call('POST', '/unlock', { method: 'passkey' }); const dekViaPk = await C.unwrapDEK(r.data.wrappedDek, pkKek);
assert.equal((await C.openJSON(dekViaPk, row1.data, id1)).issuer, 'GitHub'); step('passkey-derived key unlocks the same data');
await assert.rejects(C.unwrapDEK(r.data.wrappedDek, await C.passkeyKey(new Uint8Array(randomBytes(32))))); step('a different authenticator cannot unwrap it');

// ---- change passcode
const newSalt = C.rand(16), npc = 'a brand new passcode 42', npcc = await C.passcodeCredentials(npc, newSalt);
const nWrapped = await C.wrapDEK(dekExt, npcc.kek);
r = await call('POST', '/passcode', { pcAuth: wrong.auth, newPcSalt: C.b64.enc(newSalt), newPcAuth: npcc.auth, newPcWrappedDek: nWrapped }); assert.equal(r.status, 401); step('changing passcode needs the current one');
r = await call('POST', '/passcode', { pcAuth: pcc.auth, newPcSalt: C.b64.enc(newSalt), newPcAuth: npcc.auth, newPcWrappedDek: nWrapped }); assert.equal(r.status, 200); step('passcode changed');
r = await call('POST', '/unlock', { method: 'passcode', pcAuth: pcc.auth }); assert.equal(r.status, 401); step('old passcode no longer works');
r = await call('POST', '/unlock', { method: 'passcode', pcAuth: npcc.auth }); assert.equal(r.status, 200); step('new passcode works');
r = await call('POST', '/unlock', { method: 'passkey' }); assert.equal(r.status, 200); step('passkey still works after a passcode change');

// ---- remove passkey, rotate recovery
r = await call('DELETE', '/passkey', { pcAuth: npcc.auth }); assert.equal(r.status, 200);
r = await call('POST', '/unlock', { method: 'passkey' }); assert.equal(r.status, 404); step('passkey removed');
const rk2 = C.generateRecoveryCode(), rcc2 = await C.recoveryCredentials(rk2);
r = await call('POST', '/recovery', { pcAuth: npcc.auth, rcAuth: rcc2.auth, rcWrappedDek: await C.wrapDEK(dekExt, rcc2.kek) }); assert.equal(r.status, 200);
r = await call('POST', '/recover/start', { rcAuth: rcc.auth }); assert.equal(r.status, 401); step('old recovery key rejected after rotation');

// ---- forgot passcode: Google session + recovery key
r = await call('POST', '/passkey', { ...pkBody, pcAuth: npcc.auth });
r = await call('POST', '/recover/start', { rcAuth: rcc2.auth }); assert.equal(r.status, 200);
const dekRec = await C.unwrapDEK(r.data.rcWrappedDek, rcc2.kek, true);
const s3 = C.rand(16), pc3 = 'recovered passcode 99', c3 = await C.passcodeCredentials(pc3, s3), rk3 = C.generateRecoveryCode(), rcc3 = await C.recoveryCredentials(rk3);
r = await call('POST', '/recover/finish', { rcAuth: rcc2.auth, newPcSalt: C.b64.enc(s3), newPcAuth: c3.auth, newPcWrappedDek: await C.wrapDEK(dekRec, c3.kek), rcAuth2: rcc3.auth, rcWrappedDek2: await C.wrapDEK(dekRec, rcc3.kek) });
assert.equal(r.status, 200); step('recovery key resets the passcode');
r = await call('POST', '/unlock', { method: 'passkey' }); assert.equal(r.status, 404); step('recovery removes the passkey');
r = await call('POST', '/unlock', { method: 'passcode', pcAuth: c3.auth }); const dek3 = await C.unwrapDEK(r.data.wrappedDek, c3.kek);
r = await call('GET', '/items'); assert.equal((await C.openJSON(dek3, r.data.items[0].data, r.data.items[0].id)).issuer, 'GitHub'); step('data still readable after recovery');

// ---- sessions
const savedCookie = cookie;
r = await call('POST', '/logout', {}); r = await call('GET', '/items'); assert.equal(r.status, 401); step('logout');
const n2 = nonce();
r = await call('POST', '/google', { credential: mintToken({ sub, email, nonce: n2 }), nonce: n2 }); assert.equal(r.data.hasVault, true); step('same Google account signs back in to the same vault');
cookie = savedCookie; r = await call('GET', '/items'); assert.equal(r.status, 401); step('old session stays dead');
cookie = ''; r = await call('POST', '/google', { credential: mintToken({ sub, email, nonce: n2 }), nonce: n2 });
r = await call('POST', '/logout-all', {}); r = await call('GET', '/session'); assert.equal(r.status, 401); step('sign out everywhere');

// ---- lockout (passcode guessing is throttled server-side)
const n3 = nonce(); await call('POST', '/google', { credential: mintToken({ sub, email, nonce: n3 }), nonce: n3 });
for (let i = 0; i < 8; i++) r = await call('POST', '/unlock', { method: 'passcode', pcAuth: wrong.auth });
r = await call('POST', '/unlock', { method: 'passcode', pcAuth: c3.auth }); assert.equal(r.status, 429); step('8 wrong passcodes lock unlocking for 15 minutes');

// ---- another account + delete
const sub2 = 'g2-' + Date.now(), n4 = nonce(); cookie = '';
await call('POST', '/google', { credential: mintToken({ sub: sub2, email: 'other' + Date.now() + '@gmail.com', nonce: n4 }), nonce: n4 });
await call('PUT', '/vault', vaultBody);
await call('PUT', '/items/' + C.uid(), { data: 'abc' });
r = await call('DELETE', '/account', { pcAuth: wrong.auth }); assert.equal(r.status, 401);
r = await call('DELETE', '/account', { pcAuth: pcc.auth }); assert.equal(r.status, 200);
const n5 = nonce(); r = await call('POST', '/google', { credential: mintToken({ sub: sub2, email: 'x@gmail.com', nonce: n5 }), nonce: n5 }); assert.equal(r.data.hasVault, false); step('delete account removes the vault');
console.log(`\nAll ${ok} checks passed.`); jwks.close();
