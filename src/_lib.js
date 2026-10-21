// Shared helpers for the API. Nothing here ever handles plaintext user data.
export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }
  });

export async function readJSON(request, maxChars = 2_000_000) {
  const text = await request.text();
  if (text.length > maxChars) throw new HttpError(413, 'That request is too large.');
  try {
    const v = JSON.parse(text);
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw 0;
    return v;
  } catch { throw new HttpError(400, 'Invalid request.'); }
}

const enc = new TextEncoder();
const toB64 = bytes => btoa(String.fromCharCode(...bytes));
export const randomToken = (n = 32) => toB64(crypto.getRandomValues(new Uint8Array(n))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export async function sha256Hex(text) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text)));
  return [...d].map(b => b.toString(16).padStart(2, '0')).join('');
}
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
export const isB64 = (s, len) => typeof s === 'string' && s.length === len && B64.test(s);
export const isB64Max = (s, max) => typeof s === 'string' && s.length > 0 && s.length <= max && B64.test(s);
export const AUTH_LEN = 44;      // 32 bytes
export const SALT_LEN = 24;      // 16 bytes
export const WRAPPED_LEN = 80;   // 12-byte IV + 32-byte key + 16-byte tag

/* ---------- sessions ---------- */
const SESSION_DAYS = 14;
const cookieName = request => (new URL(request.url).protocol === 'https:' ? '__Host-sid' : 'sid');

export function readToken(request) {
  for (const part of (request.headers.get('Cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (k === '__Host-sid' || k === 'sid') return part.slice(i + 1).trim();
  }
  return null;
}
export function cookieHeader(request, token, maxAge = SESSION_DAYS * 86400) {
  const secure = new URL(request.url).protocol === 'https:';
  return `${cookieName(request)}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

export async function createSession(env, request, accountId) {
  const token = randomToken(32), now = Date.now();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM vault_sessions WHERE expires_at < ?').bind(now),
    env.DB.prepare('INSERT INTO vault_sessions (token_hash, account_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .bind(await sha256Hex(token), accountId, now, now + SESSION_DAYS * 86400_000)
  ]);
  return cookieHeader(request, token);
}

export async function requireAccount({ request, env }) {
  const token = readToken(request);
  if (!token) throw new HttpError(401, 'You’re signed out.');
  const tokenHash = await sha256Hex(token);
  const row = await env.DB.prepare(
    `SELECT a.*, s.token_hash AS token_hash
       FROM vault_sessions s JOIN vault_accounts a ON a.id = s.account_id
      WHERE s.token_hash = ? AND s.expires_at > ?`).bind(tokenHash, Date.now()).first();
  if (!row) throw new HttpError(401, 'Your session expired. Sign in again.');
  return row;
}

/* ---------- proofs (passcode / recovery key) with lockout ---------- */
const MAX_FAILS = 8, LOCK_MS = 15 * 60_000;
const MESSAGES = { pc: 'Incorrect passcode.', rc: 'That recovery key is incorrect.' };

export async function checkSecret(env, acct, kind, provided) {
  const salt = kind === 'rc' ? acct.rc_salt : acct.pc_auth_salt;
  const hash = kind === 'rc' ? acct.rc_hash : acct.pc_auth_hash;
  if (!salt || !hash) throw new HttpError(409, 'Finish setting up your vault first.');
  const now = Date.now();
  if (acct.locked_until > now) {
    const mins = Math.ceil((acct.locked_until - now) / 60_000);
    throw new HttpError(429, `Too many failed attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`);
  }
  if (safeEqual(await sha256Hex(salt + ':' + provided), hash)) {
    if (acct.failed) await env.DB.prepare('UPDATE vault_accounts SET failed = 0, locked_until = 0 WHERE id = ?').bind(acct.id).run();
    return;
  }
  const fails = acct.failed + 1;
  if (fails >= MAX_FAILS) await env.DB.prepare('UPDATE vault_accounts SET failed = 0, locked_until = ? WHERE id = ?').bind(now + LOCK_MS, acct.id).run();
  else await env.DB.prepare('UPDATE vault_accounts SET failed = ? WHERE id = ?').bind(fails, acct.id).run();
  throw new HttpError(401, MESSAGES[kind]);
}

export async function newSecretRecord(authKey) {
  const salt = randomToken(16);
  return { salt, hash: await sha256Hex(salt + ':' + authKey) };
}
