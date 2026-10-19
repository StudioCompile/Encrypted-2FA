import { json, requireUser } from '../../_lib.js';

export async function onRequestGet(ctx) {
  const u = await requireUser(ctx);
  const { results } = await ctx.env.DB.prepare(
    'SELECT id, data, updated_at, (file IS NOT NULL) AS has_file FROM items WHERE user_id = ? ORDER BY updated_at DESC'
  ).bind(u.id).all();
  return json({ items: results.map(r => ({ id: r.id, data: r.data, hasFile: !!r.has_file, updatedAt: r.updated_at })) });
}
