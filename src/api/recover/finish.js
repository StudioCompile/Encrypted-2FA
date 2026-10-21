import { HttpError, json, readJSON, requireAccount, checkSecret, isB64, AUTH_LEN, SALT_LEN, WRAPPED_LEN, newSecretRecord } from '../../_lib.js';

// Step 2: set a new passcode and a fresh recovery key. The passkey is removed (add it again afterwards).
export async function onRequestPost(ctx) {
  const { env } = ctx;
  const a = await requireAccount(ctx);
  const b = await readJSON(ctx.request, 10_000);
  if (![b.rcAuth, b.newPcAuth, b.rcAuth2].every(v => isB64(v, AUTH_LEN)) || !isB64(b.newPcSalt, SALT_LEN) || ![b.newPcWrappedDek, b.rcWrappedDek2].every(v => isB64(v, WRAPPED_LEN))) {
    throw new HttpError(400, 'Invalid request.');
  }
  await checkSecret(env, a, 'rc', b.rcAuth);
  const p = await newSecretRecord(b.newPcAuth), r = await newSecretRecord(b.rcAuth2);
  await env.DB.batch([
    env.DB.prepare(`UPDATE vault_accounts SET pc_salt = ?, pc_auth_salt = ?, pc_auth_hash = ?, pc_wrapped_dek = ?,
      rc_salt = ?, rc_hash = ?, rc_wrapped_dek = ?, pk_cred_id = NULL, pk_prf_salt = NULL, pk_wrapped_dek = NULL WHERE id = ?`)
      .bind(b.newPcSalt, p.salt, p.hash, b.newPcWrappedDek, r.salt, r.hash, b.rcWrappedDek2, a.id),
    env.DB.prepare('DELETE FROM vault_sessions WHERE account_id = ? AND token_hash != ?').bind(a.id, a.token_hash)
  ]);
  return json({ ok: true });
}
