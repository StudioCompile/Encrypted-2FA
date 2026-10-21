// Test helpers: a fake Google (JWKS server + token minting) so the real verification code path runs.
import http from 'node:http';
import { generateKeyPairSync, sign, randomBytes } from 'node:crypto';

export const CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
export const JWKS_PORT = 9988;
const kid = 'test-' + randomBytes(4).toString('hex');
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' };
const b64u = b => Buffer.from(b).toString('base64url');

export function startJwks() {
  return new Promise(res => {
    const srv = http.createServer((q, r) => { r.setHeader('Content-Type', 'application/json'); r.end(JSON.stringify({ keys: [jwk] })); });
    srv.listen(JWKS_PORT, '127.0.0.1', () => res(srv));
  });
}
export function mintToken({ sub, email, nonce, aud = CLIENT_ID, iss = 'https://accounts.google.com', exp, verified = true }) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' }));
  const body = b64u(JSON.stringify({ iss, aud, sub, email, email_verified: verified, nonce, iat: now, exp: exp ?? now + 3600 }));
  const sig = sign('RSA-SHA256', Buffer.from(head + '.' + body), privateKey);
  return head + '.' + body + '.' + b64u(sig);
}
