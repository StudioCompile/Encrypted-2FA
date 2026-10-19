import { HttpError, json, readJSON, requireUser, checkSecret, isB64, AUTH_LEN, WRAPPED_LEN, newSecretRecord } from '../_lib.js';

// Change password: the client re-wraps the data key under the new password. Items are not touched.
export async function onRequestPost(ctx) {
  const { request, env } = ctx;
  const u = await requireUser(ctx);
  const b = await readJSON(request, 10_000);
  if (!isB64(b.authKey, AUTH_LEN) || !isB64(b.newAuthKey, AUTH_LEN) || !isB64(b.wrappedDek, WRAPPED_LEN)) throw new HttpError(400, 'Invalid request.');
  await checkSecret(env, u, 'auth', b.authKey);
  const a = await newSecretRecord(b.newAuthKey);
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET auth_salt = ?, auth_hash = ?, wrapped_dek = ? WHERE id = ?').bind(a.salt, a.hash, b.wrappedDek, u.id),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').bind(u.id, u.token_hash)
  ]);
  return json({ ok: true });
}
