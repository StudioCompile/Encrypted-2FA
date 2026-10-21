import { json, requireAccount } from '../../_lib.js';

export async function onRequestGet(ctx) {
  const a = await requireAccount(ctx);
  const { results } = await ctx.env.DB.prepare(
    'SELECT id, data, updated_at, (file IS NOT NULL) AS has_file FROM vault_items WHERE account_id = ? ORDER BY updated_at DESC'
  ).bind(a.id).all();
  return json({ items: results.map(r => ({ id: r.id, data: r.data, hasFile: !!r.has_file, updatedAt: r.updated_at })) });
}
