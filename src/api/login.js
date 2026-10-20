import { HttpError, json, readJSON, normalizeEmail, isB64, AUTH_LEN, findUserByEmail, checkSecret, dummyCheck, createSession } from '../_lib.js';

export async function onRequestPost(ctx) {
  const { request, env } = ctx;
  const b = await readJSON(request, 5_000);
  const email = normalizeEmail(b.email);
  if (!isB64(b.authKey, AUTH_LEN)) throw new HttpError(400, 'Invalid request.');
  const user = await findUserByEmail(env, email);
  if (!user) await dummyCheck('auth');
  await checkSecret(env, user, 'auth', b.authKey);
  const cookie = await createSession(env, request, user.id);
  return json({ email: user.email, wrappedDek: user.wrapped_dek }, 200, { 'Set-Cookie': cookie });
}
