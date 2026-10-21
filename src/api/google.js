import { HttpError, json, readJSON, randomToken, createSession } from '../_lib.js';
import { verifyGoogleToken } from '../google.js';

export async function onRequestPost({ request, env }) {
  const b = await readJSON(request, 8_000);
  if (typeof b.credential !== 'string' || typeof b.nonce !== 'string' || b.nonce.length < 16) throw new HttpError(400, 'Invalid request.');
  const { sub, email } = await verifyGoogleToken(env, b.credential, b.nonce);
  const allow = String(env.ALLOWED_EMAILS || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
  if (allow.length && !allow.includes(email)) throw new HttpError(403, 'This account isn’t allowed to use this Vault.');
  let acct = await env.DB.prepare('SELECT id, pc_wrapped_dek FROM vault_accounts WHERE google_sub = ?').bind(sub).first();
  if (!acct) {
    if (String(env.ALLOW_SIGNUPS).toLowerCase() === 'false') throw new HttpError(403, 'New accounts are turned off on this server.');
    const id = randomToken(12);
    await env.DB.prepare('INSERT INTO vault_accounts (id, google_sub, email, created_at) VALUES (?, ?, ?, ?)').bind(id, sub, email, Date.now()).run();
    acct = { id, pc_wrapped_dek: null };
  } else {
    await env.DB.prepare('UPDATE vault_accounts SET email = ? WHERE id = ?').bind(email, acct.id).run();
  }
  const cookie = await createSession(env, request, acct.id);
  return json({ email, hasVault: !!acct.pc_wrapped_dek }, 200, { 'Set-Cookie': cookie });
}
