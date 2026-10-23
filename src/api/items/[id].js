import { HttpError, json, readJSON, requireUser } from '../../_lib.js';

const ID = /^[A-Za-z0-9_-]{8,40}$/;
const MAX_DATA = 120_000;          // sealed note / code record
const MAX_FILE = 1_450_000;        // sealed file (≈1 MiB of original bytes)
const MAX_ITEMS = 2000;

export async function onRequestPut(ctx) {
  const { request, env, params } = ctx;
  const u = await requireUser(ctx);
  const id = String(params.id);
  if (!ID.test(id)) throw new HttpError(400, 'Invalid item id.');
  const b = await readJSON(request, MAX_DATA + MAX_FILE + 1000);
  if (typeof b.data !== 'string' || !b.data || b.data.length > MAX_DATA) throw new HttpError(413, 'That item is too large.');
  const hasFileKey = Object.prototype.hasOwnProperty.call(b, 'file');
  if (hasFileKey && b.file !== null && (typeof b.file !== 'string' || b.file.length > MAX_FILE)) throw new HttpError(413, 'Files can be up to 1 MB on a cloud account.');

  const existing = await env.DB.prepare('SELECT 1 AS x FROM items WHERE user_id = ? AND id = ?').bind(u.id, id).first();
  if (!existing) {
    const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM items WHERE user_id = ?').bind(u.id).first();
    if (n >= MAX_ITEMS) throw new HttpError(409, 'You’ve reached the limit of ' + MAX_ITEMS + ' items.');
  }
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO items (id, user_id, data, file, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT (user_id, id) DO UPDATE SET
       data = excluded.data,
       file = CASE WHEN ?6 = 1 THEN excluded.file ELSE items.file END,
       updated_at = excluded.updated_at`
  ).bind(id, u.id, b.data, hasFileKey ? b.file : null, now, hasFileKey ? 1 : 0).run();
  return json({ updatedAt: now });
}

export async function onRequestDelete(ctx) {
  const u = await requireUser(ctx);
  const id = String(ctx.params.id);
  if (!ID.test(id)) throw new HttpError(400, 'Invalid item id.');
  await ctx.env.DB.prepare('DELETE FROM items WHERE user_id = ? AND id = ?').bind(u.id, id).run();
  return json({ ok: true });
}
