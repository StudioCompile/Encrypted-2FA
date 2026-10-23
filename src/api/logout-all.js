import { json, requireUser, cookieHeader } from '../_lib.js';

export async function onRequestPost(ctx) {
  const u = await requireUser(ctx);
  await ctx.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(u.id).run();
  return json({ ok: true }, 200, { 'Set-Cookie': cookieHeader(ctx.request, '', 0) });
}
