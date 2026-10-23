import { HttpError, json, readJSON, normalizeEmail, isB64, AUTH_LEN, WRAPPED_LEN, findUserByEmail, checkSecret, dummyCheck, newSecretRecord, createSession } from '../../_lib.js';

// Step 2: set a new password and a fresh recovery key. All other sessions are signed out.
export async function onRequestPost({ request, env }) {
  const b = await readJSON(request, 10_000);
  const email = normalizeEmail(b.email);
  if (![b.rcAuth, b.authKey, b.rcAuth2].every(v => isB64(v, AUTH_LEN)) || ![b.wrappedDek, b.rcWrappedDek2].every(v => isB64(v, WRAPPED_LEN))) {
    throw new HttpError(400, 'Invalid request.');
  }
  const user = await findUserByEmail(env, email);
  if (!user) await dummyCheck('rc');
  await checkSecret(env, user, 'rc', b.rcAuth);
  const a = await newSecretRecord(b.authKey), r = await newSecretRecord(b.rcAuth2);
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET auth_salt = ?, auth_hash = ?, wrapped_dek = ?, rc_salt = ?, rc_hash = ?, rc_wrapped_dek = ? WHERE id = ?')
      .bind(a.salt, a.hash, b.wrappedDek, r.salt, r.hash, b.rcWrappedDek2, user.id),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id)
  ]);
  const cookie = await createSession(env, request, user.id);
  return json({ email: user.email }, 200, { 'Set-Cookie': cookie });
}
