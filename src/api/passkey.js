import { HttpError, json, readJSON, requireAccount, checkSecret, isB64, isB64Max, AUTH_LEN, WRAPPED_LEN } from '../_lib.js';

export async function onRequestPost(ctx) {
  const a = await requireAccount(ctx);
  const b = await readJSON(ctx.request, 10_000);
  if (!isB64(b.pcAuth, AUTH_LEN) || !isB64Max(b.credId, 1400) || !isB64(b.prfSalt, AUTH_LEN) || !isB64(b.wrappedDek, WRAPPED_LEN)) throw new HttpError(400, 'Invalid request.');
  await checkSecret(ctx.env, a, 'pc', b.pcAuth);
  await ctx.env.DB.prepare('UPDATE vault_accounts SET pk_cred_id = ?, pk_prf_salt = ?, pk_wrapped_dek = ? WHERE id = ?').bind(b.credId, b.prfSalt, b.wrappedDek, a.id).run();
  return json({ ok: true });
}

export async function onRequestDelete(ctx) {
  const a = await requireAccount(ctx);
  const b = await readJSON(ctx.request, 2_000);
  if (!isB64(b.pcAuth, AUTH_LEN)) throw new HttpError(400, 'Invalid request.');
  await checkSecret(ctx.env, a, 'pc', b.pcAuth);
  await ctx.env.DB.prepare('UPDATE vault_accounts SET pk_cred_id = NULL, pk_prf_salt = NULL, pk_wrapped_dek = NULL WHERE id = ?').bind(a.id).run();
  return json({ ok: true });
}
