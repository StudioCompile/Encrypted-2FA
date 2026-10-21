import { HttpError, json, readJSON, requireAccount, checkSecret, isB64, AUTH_LEN, cookieHeader } from '../_lib.js';

export async function onRequestDelete(ctx) {
  const { request, env } = ctx;
  const a = await requireAccount(ctx);
  const b = await readJSON(request, 2_000);
  if (!isB64(b.pcAuth, AUTH_LEN)) throw new HttpError(400, 'Invalid request.');
  await checkSecret(env, a, 'pc', b.pcAuth);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM vault_items WHERE account_id = ?').bind(a.id),
    env.DB.prepare('DELETE FROM vault_sessions WHERE account_id = ?').bind(a.id),
    env.DB.prepare('DELETE FROM vault_accounts WHERE id = ?').bind(a.id)
  ]);
  return json({ ok: true }, 200, { 'Set-Cookie': cookieHeader(request, '', 0) });
}
