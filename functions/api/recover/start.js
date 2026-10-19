import { HttpError, json, readJSON, normalizeEmail, isB64, AUTH_LEN, findUserByEmail, checkSecret, dummyCheck } from '../../_lib.js';

// Step 1 of "forgot password": prove you hold the recovery key, receive the key-wrapped data key.
export async function onRequestPost({ request, env }) {
  const b = await readJSON(request, 5_000);
  const email = normalizeEmail(b.email);
  if (!isB64(b.rcAuth, AUTH_LEN)) throw new HttpError(400, 'Invalid request.');
  const user = await findUserByEmail(env, email);
  if (!user) await dummyCheck('rc');
  await checkSecret(env, user, 'rc', b.rcAuth);
  return json({ rcWrappedDek: user.rc_wrapped_dek });
}
