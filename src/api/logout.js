import { json, readToken, sha256Hex, cookieHeader } from '../_lib.js';

export async function onRequestPost({ request, env }) {
  const token = readToken(request);
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256Hex(token)).run();
  return json({ ok: true }, 200, { 'Set-Cookie': cookieHeader(request, '', 0) });
}
