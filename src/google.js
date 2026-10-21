import { HttpError } from './_lib.js';

// Verifies a "Sign in with Google" ID token (RS256 JWT) against Google's public keys.
const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
let cache = { url: '', at: 0, keys: [] };

async function loadKeys(env, force) {
  const url = env.GOOGLE_JWKS_URL || JWKS_URL;
  if (!force && cache.url === url && cache.keys.length && Date.now() - cache.at < 3600_000) return cache.keys;
  let res;
  try { res = await fetch(url); } catch { throw new HttpError(502, 'Couldn’t reach Google to verify your sign-in. Try again.'); }
  if (!res.ok) throw new HttpError(502, 'Couldn’t reach Google to verify your sign-in. Try again.');
  cache = { url, at: Date.now(), keys: (await res.json()).keys || [] };
  return cache.keys;
}
const bytes = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), c => c.charCodeAt(0));
const parse = s => JSON.parse(new TextDecoder().decode(bytes(s)));

export async function verifyGoogleToken(env, token, nonce) {
  if (!env.GOOGLE_CLIENT_ID) throw new HttpError(503, 'Google sign-in isn’t set up on this server yet.');
  const bad = () => new HttpError(401, 'Google sign-in couldn’t be verified. Try again.');
  const parts = String(token).split('.');
  if (parts.length !== 3) throw bad();
  let header, payload;
  try { header = parse(parts[0]); payload = parse(parts[1]); } catch { throw bad(); }
  if (header.alg !== 'RS256' || !header.kid) throw bad();
  let jwk = (await loadKeys(env, false)).find(k => k.kid === header.kid);
  if (!jwk) jwk = (await loadKeys(env, true)).find(k => k.kid === header.kid);
  if (!jwk) throw bad();
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, bytes(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1]));
  if (!ok) throw bad();
  const now = Math.floor(Date.now() / 1000);
  if (!['https://accounts.google.com', 'accounts.google.com'].includes(payload.iss)) throw bad();
  if (payload.aud !== env.GOOGLE_CLIENT_ID) throw bad();
  if (!payload.exp || payload.exp < now - 30 || (payload.iat && payload.iat > now + 300)) throw bad();
  if (!payload.sub || !payload.email || payload.email_verified !== true) throw bad();
  if (!nonce || payload.nonce !== nonce) throw bad();
  return { sub: String(payload.sub), email: String(payload.email).toLowerCase() };
}
