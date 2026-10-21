import { json, requireAccount } from '../_lib.js';

export async function onRequestGet(ctx) {
  const a = await requireAccount(ctx);
  return json({
    email: a.email,
    hasVault: !!a.pc_wrapped_dek,
    pcSalt: a.pc_salt || null,
    passkey: a.pk_cred_id ? { credId: a.pk_cred_id, prfSalt: a.pk_prf_salt } : null
  });
}
