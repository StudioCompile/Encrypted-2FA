import { json, requireAccount, cookieHeader } from '../_lib.js';

export async function onRequestPost(ctx) {
  const a = await requireAccount(ctx);
  await ctx.env.DB.prepare('DELETE FROM vault_sessions WHERE account_id = ?').bind(a.id).run();
  return json({ ok: true }, 200, { 'Set-Cookie': cookieHeader(ctx.request, '', 0) });
}
