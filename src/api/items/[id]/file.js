import { HttpError, json, requireUser } from '../../../_lib.js';

export async function onRequestGet(ctx) {
  const u = await requireUser(ctx);
  const row = await ctx.env.DB.prepare('SELECT file FROM items WHERE user_id = ? AND id = ?').bind(u.id, String(ctx.params.id)).first();
  if (!row) throw new HttpError(404, 'Item not found.');
  return json({ file: row.file });
}
