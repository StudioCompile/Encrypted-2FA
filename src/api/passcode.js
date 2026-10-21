import { HttpError, json, readJSON, requireAccount, checkSecret, isB64, AUTH_LEN, SALT_LEN, WRAPPED_LEN, newSecretRecord } from '../_lib.js';

export async function onRequestPost(ctx) {
  const { env } = ctx;
  const a = await requireAccount(ctx);
  const b = await readJSON(ctx.request, 10_000);
  if (!isB64(b.pcAuth, AUTH_LEN) || !isB64(b.newPcSalt, SALT_LEN) || !isB64(b.newPcAuth, AUTH_LEN) || !isB64(b.newPcWrappedDek, WRAPPED_LEN)) throw new HttpError(400, 'Invalid request.');
  await checkSecret(env, a, 'pc', b.pcAuth);
  const p = await newSecretRecord(b.newPcAuth);
  await env.DB.batch([
    env.DB.prepare('UPDATE vault_accounts SET pc_salt = ?, pc_auth_salt = ?, pc_auth_hash = ?, pc_wrapped_dek = ? WHERE id = ?').bind(b.newPcSalt, p.salt, p.hash, b.newPcWrappedDek, a.id),
    env.DB.prepare('DELETE FROM vault_sessions WHERE account_id = ? AND token_hash != ?').bind(a.id, a.token_hash)
  ]);
  return json({ ok: true });
}
