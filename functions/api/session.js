import { json, requireUser } from '../_lib.js';

export async function onRequestGet(ctx) {
  const u = await requireUser(ctx);
  return json({ email: u.email, wrappedDek: u.wrapped_dek });
}
