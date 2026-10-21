import { HttpError, json, readJSON, requireAccount, isB64, AUTH_LEN, SALT_LEN, WRAPPED_LEN, newSecretRecord } from '../_lib.js';

// Create the vault (first time only): passcode-wrapped data key + recovery-key-wrapped data key.
export async function onRequestPut(ctx) {
  const { request, env } = ctx;
  const a = await requireAccount(ctx);
  if (a.pc_wrapped_dek) throw new HttpError(409, 'Your vault is already set up.');
  const b = await readJSON(request, 10_000);
  if (!isB64(b.pcSalt, SALT_LEN) || !isB64(b.pcAuth, AUTH_LEN) || !isB64(b.pcWrappedDek, WRAPPED_LEN) || !isB64(b.rcAuth, AUTH_LEN) || !isB64(b.rcWrappedDek, WRAPPED_LEN)) {
    throw new HttpError(400, 'Invalid request.');
  }
  const p = await newSecretRecord(b.pcAuth), r = await newSecretRecord(b.rcAuth);
  await env.DB.prepare(
    `UPDATE vault_accounts SET pc_salt = ?, pc_auth_salt = ?, pc_auth_hash = ?, pc_wrapped_dek = ?, rc_salt = ?, rc_hash = ?, rc_wrapped_dek = ? WHERE id = ?`
  ).bind(b.pcSalt, p.salt, p.hash, b.pcWrappedDek, r.salt, r.hash, b.rcWrappedDek, a.id).run();
  return json({ ok: true }, 201);
}
