import { HttpError, json, readJSON, requireUser, checkSecret, isB64, AUTH_LEN, cookieHeader } from '../_lib.js';

export async function onRequestDelete(ctx) {
  const { request, env } = ctx;
  const u = await requireUser(ctx);
  const b = await readJSON(request, 2_000);
  if (!isB64(b.authKey, AUTH_LEN)) throw new HttpError(400, 'Invalid request.');
  await checkSecret(env, u, 'auth', b.authKey);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM items WHERE user_id = ?').bind(u.id),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(u.id),
    env.DB.prepare('DELETE FROM users WHERE id = ?').bind(u.id)
  ]);
  return json({ ok: true }, 200, { 'Set-Cookie': cookieHeader(request, '', 0) });
}
