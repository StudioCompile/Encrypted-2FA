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
export const AUTH_LEN = 44;      // 32 bytes
export const WRAPPED_LEN = 80;   // 12-byte IV + 32-byte key + 16-byte tag

export function normalizeEmail(email) {
  const e = String(email || '').trim().toLowerCase();
  if (e.length < 5 || e.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new HttpError(400, 'Enter a valid email address.');
  return e;
}

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

export async function createSession(env, request, userId) {
  const token = randomToken(32), now = Date.now();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now),
    env.DB.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .bind(await sha256Hex(token), userId, now, now + SESSION_DAYS * 86400_000)
  ]);
  return cookieHeader(request, token);
}

export async function requireUser({ request, env }) {
  const token = readToken(request);
  if (!token) throw new HttpError(401, 'You’re signed out.');
  const tokenHash = await sha256Hex(token);
  const row = await env.DB.prepare(
    `SELECT u.id, u.email, u.wrapped_dek, u.auth_salt, u.auth_hash, u.failed_logins, u.locked_until, s.token_hash
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ?`).bind(tokenHash, Date.now()).first();
  if (!row) throw new HttpError(401, 'Your session expired. Sign in again.');
  return row;
}

/* ---------- credential checks with lockout ---------- */
const MAX_FAILS = 8, LOCK_MS = 15 * 60_000;

export async function checkSecret(env, user, kind, provided) {
  const now = Date.now();
  if (user.locked_until > now) {
    const mins = Math.ceil((user.locked_until - now) / 60_000);
    throw new HttpError(429, `Too many failed attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`);
  }
  const salt = kind === 'rc' ? user.rc_salt : user.auth_salt;
  const hash = kind === 'rc' ? user.rc_hash : user.auth_hash;
  const ok = safeEqual(await sha256Hex(salt + ':' + provided), hash);
  if (ok) {
    if (user.failed_logins) await env.DB.prepare('UPDATE users SET failed_logins = 0, locked_until = 0 WHERE id = ?').bind(user.id).run();
    return;
  }
  const fails = user.failed_logins + 1;
  if (fails >= MAX_FAILS) await env.DB.prepare('UPDATE users SET failed_logins = 0, locked_until = ? WHERE id = ?').bind(now + LOCK_MS, user.id).run();
  else await env.DB.prepare('UPDATE users SET failed_logins = ? WHERE id = ?').bind(fails, user.id).run();
  throw new HttpError(401, kind === 'rc' ? 'The email or recovery key is incorrect.' : 'Incorrect email or password.');
}

// Burn roughly the same time for unknown emails so response timing doesn't reveal which accounts exist.
export async function dummyCheck(kind) {
  await sha256Hex('x:' + kind);
  throw new HttpError(401, kind === 'rc' ? 'The email or recovery key is incorrect.' : 'Incorrect email or password.');
}

export const findUserByEmail = (env, email) =>
  env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();

export async function newSecretRecord(authKey) {
  const salt = randomToken(16);
  return { salt, hash: await sha256Hex(salt + ':' + authKey) };
}
