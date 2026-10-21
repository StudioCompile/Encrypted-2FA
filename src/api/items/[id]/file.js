import { HttpError, json, requireAccount } from '../../../_lib.js';

export async function onRequestGet(ctx) {
  const a = await requireAccount(ctx);
  const row = await ctx.env.DB.prepare('SELECT file FROM vault_items WHERE account_id = ? AND id = ?').bind(a.id, String(ctx.params.id)).first();
  if (!row) throw new HttpError(404, 'Item not found.');
  return json({ file: row.file });
}
