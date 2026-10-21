import { HttpError, json, readJSON, requireAccount, checkSecret, isB64, AUTH_LEN } from '../../_lib.js';

// "Forgot passcode" step 1: signed in with Google + prove you hold the recovery key.
export async function onRequestPost(ctx) {
  const a = await requireAccount(ctx);
  const b = await readJSON(ctx.request, 5_000);
  if (!isB64(b.rcAuth, AUTH_LEN)) throw new HttpError(400, 'Invalid request.');
  await checkSecret(ctx.env, a, 'rc', b.rcAuth);
  return json({ rcWrappedDek: a.rc_wrapped_dek });
}
