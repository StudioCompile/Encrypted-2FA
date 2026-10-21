import { HttpError, json, readJSON, requireAccount, checkSecret, isB64, AUTH_LEN } from '../_lib.js';

// Hands back the wrapped data key. A passcode proof is required (and throttled); the passkey path
// needs no proof because its wrapping key lives in the authenticator and can't be guessed offline.
export async function onRequestPost(ctx) {
  const a = await requireAccount(ctx);
  const b = await readJSON(ctx.request, 2_000);
  if (b.method === 'passkey') {
    if (!a.pk_wrapped_dek) throw new HttpError(404, 'No passkey is set up for this account.');
    return json({ wrappedDek: a.pk_wrapped_dek });
  }
  if (b.method !== 'passcode' || !isB64(b.pcAuth, AUTH_LEN)) throw new HttpError(400, 'Invalid request.');
  await checkSecret(ctx.env, a, 'pc', b.pcAuth);
  return json({ wrappedDek: a.pc_wrapped_dek });
}
