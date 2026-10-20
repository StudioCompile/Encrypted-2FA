import { HttpError, json, readJSON, requireUser, checkSecret, isB64, AUTH_LEN, WRAPPED_LEN, newSecretRecord } from '../_lib.js';

// Replace the recovery key (the old one stops working).
export async function onRequestPost(ctx) {
  const { request, env } = ctx;
  const u = await requireUser(ctx);
  const b = await readJSON(request, 10_000);
  if (!isB64(b.authKey, AUTH_LEN) || !isB64(b.rcAuth, AUTH_LEN) || !isB64(b.rcWrappedDek, WRAPPED_LEN)) throw new HttpError(400, 'Invalid request.');
  await checkSecret(env, u, 'auth', b.authKey);
  const r = await newSecretRecord(b.rcAuth);
  await env.DB.prepare('UPDATE users SET rc_salt = ?, rc_hash = ?, rc_wrapped_dek = ? WHERE id = ?').bind(r.salt, r.hash, b.rcWrappedDek, u.id).run();
  return json({ ok: true });
}
