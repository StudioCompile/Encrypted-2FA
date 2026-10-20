import { HttpError, json } from '../_lib.js';

export async function onRequest(ctx) {
  const { request, env } = ctx;
  try {
    if (!env.DB) throw new HttpError(500, 'The server isn’t configured: the D1 database binding “DB” is missing.');
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      const origin = request.headers.get('Origin');
      if (origin && origin !== new URL(request.url).origin) throw new HttpError(403, 'Cross-origin requests are not allowed.');
    }
    const res = await ctx.next();
    res.headers.set('Cache-Control', 'no-store');
    return res;
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: 'The server hit an unexpected error.' }, 500);
  }
}
