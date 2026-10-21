// Cloudflare Worker entry: serves the static site from ./public and the JSON API under /api.
import { onRequest as middleware } from './api/_middleware.js';
import { SCHEMA } from './schema.js';
import * as config from './api/config.js';
import * as google from './api/google.js';
import * as vault from './api/vault.js';
import * as unlock from './api/unlock.js';
import * as passcode from './api/passcode.js';
import * as passkey from './api/passkey.js';
import * as session from './api/session.js';
import * as logout from './api/logout.js';
import * as logoutAll from './api/logout-all.js';
import * as recovery from './api/recovery.js';
import * as recoverStart from './api/recover/start.js';
import * as recoverFinish from './api/recover/finish.js';
import * as account from './api/account.js';
import * as items from './api/items/index.js';
import * as item from './api/items/[id].js';
import * as itemFile from './api/items/[id]/file.js';

const exact = {
  '/api/config': config, '/api/google': google, '/api/session': session, '/api/vault': vault, '/api/unlock': unlock,
  '/api/passcode': passcode, '/api/passkey': passkey, '/api/logout': logout, '/api/logout-all': logoutAll, '/api/recovery': recovery,
  '/api/recover/start': recoverStart, '/api/recover/finish': recoverFinish, '/api/account': account, '/api/items': items
};

function resolve(pathname) {
  const p = pathname.replace(/\/+$/, '');
  if (exact[p]) return { mod: exact[p], params: {} };
  let m = p.match(/^\/api\/items\/([^/]+)$/);
  if (m) return { mod: item, params: { id: decodeURIComponent(m[1]) } };
  m = p.match(/^\/api\/items\/([^/]+)\/file$/);
  if (m) return { mod: itemFile, params: { id: decodeURIComponent(m[1]) } };
  return null;
}

let ready = null;
const ensureSchema = env => ready || (ready = env.DB.batch(SCHEMA.map(s => env.DB.prepare(s))).catch(e => { ready = null; throw e; }));

const jsonRes = (obj, status) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export default {
  async fetch(request, env, execCtx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    const route = resolve(url.pathname);
    const ctx = {
      request, env, params: route ? route.params : {}, waitUntil: p => execCtx.waitUntil(p),
      next: async () => {
        if (!route) return jsonRes({ error: 'Not found.' }, 404);
        const handler = route.mod['onRequest' + request.method[0] + request.method.slice(1).toLowerCase()];
        if (!handler) return jsonRes({ error: 'Method not allowed.' }, 405);
        return handler(ctx);
      }
    };
    if (env.DB) { try { await ensureSchema(env); } catch (e) { console.error('schema', e); } }
    return middleware(ctx);
  }
};
