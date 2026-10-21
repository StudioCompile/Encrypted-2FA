import { HttpError, json, readJSON, requireAccount, checkSecret, isB64, AUTH_LEN, WRAPPED_LEN, newSecretRecord } from '../_lib.js';

// Replace the recovery key (the old one stops working).
export async function onRequestPost(ctx) {
  const a = await requireAccount(ctx);
  const b = await readJSON(ctx.request, 10_000);
  if (!isB64(b.pcAuth, AUTH_LEN) || !isB64(b.rcAuth, AUTH_LEN) || !isB64(b.rcWrappedDek, WRAPPED_LEN)) throw new HttpError(400, 'Invalid request.');
  await checkSecret(ctx.env, a, 'pc', b.pcAuth);
  const r = await newSecretRecord(b.rcAuth);
  await ctx.env.DB.prepare('UPDATE vault_accounts SET rc_salt = ?, rc_hash = ?, rc_wrapped_dek = ? WHERE id = ?').bind(r.salt, r.hash, b.rcWrappedDek, a.id).run();
  return json({ ok: true });
}
