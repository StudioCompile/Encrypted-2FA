import { HttpError, json, readJSON, normalizeEmail, isB64, AUTH_LEN, WRAPPED_LEN, randomToken, newSecretRecord, createSession } from '../_lib.js';

export async function onRequestPost(ctx) {
  const { request, env } = ctx;
  if (String(env.ALLOW_SIGNUPS).toLowerCase() === 'false') throw new HttpError(403, 'New accounts are turned off on this server.');
  const b = await readJSON(request, 10_000);
  const email = normalizeEmail(b.email);
  if (!isB64(b.authKey, AUTH_LEN) || !isB64(b.rcAuth, AUTH_LEN) || !isB64(b.wrappedDek, WRAPPED_LEN) || !isB64(b.rcWrappedDek, WRAPPED_LEN)) {
    throw new HttpError(400, 'Invalid request.');
  }
  const id = randomToken(12);
  const a = await newSecretRecord(b.authKey), r = await newSecretRecord(b.rcAuth);
  try {
    await env.DB.prepare(
      `INSERT INTO users (id, email, auth_salt, auth_hash, wrapped_dek, rc_salt, rc_hash, rc_wrapped_dek, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, email, a.salt, a.hash, b.wrappedDek, r.salt, r.hash, b.rcWrappedDek, Date.now()).run();
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) throw new HttpError(409, 'An account with that email already exists. Try signing in.');
    throw e;
  }
  const cookie = await createSession(env, request, id);
  return json({ email }, 201, { 'Set-Cookie': cookie });
}
