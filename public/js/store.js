'use strict';
/* Storage back ends. Both expose the same item interface and only ever see ciphertext.
 *   item row: { id, data: <sealed JSON>, hasFile, updatedAt }   file: <sealed bytes> fetched separately */
(function (g) {
  /* ---------- Cloud (Cloudflare Pages Functions + D1) ---------- */
  class ApiError extends Error {
    constructor(status, message, data) { super(message); this.status = status; this.data = data; }
  }
  async function req(method, path, body) {
    let res;
    try {
      res = await fetch('/api' + path, {
        method, credentials: 'same-origin', cache: 'no-store',
        headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
        body: body !== undefined ? JSON.stringify(body) : undefined
      });
    } catch { throw new ApiError('network', 'Can’t reach the server. Check your connection and try again.'); }
    const json = (res.headers.get('content-type') || '').includes('application/json');
    const data = json ? await res.json().catch(() => null) : null;
    if (!res.ok) throw new ApiError(res.status, (data && data.error) || 'Something went wrong. Please try again.', data);
    if (!json) throw new ApiError('unavailable', 'The sync server isn’t available.');
    return data;
  }
  const items = {
    list: async () => (await req('GET', '/items')).items,
    put: (id, data, file) => req('PUT', '/items/' + encodeURIComponent(id), file === undefined ? { data } : { data, file }),
    remove: async id => { await req('DELETE', '/items/' + encodeURIComponent(id)); },
    getFile: async id => (await req('GET', '/items/' + encodeURIComponent(id) + '/file')).file
  };

  /* ---------- Local (IndexedDB, this browser only) ---------- */
  let dbp = null;
  const open = () => dbp || (dbp = new Promise((res, rej) => {
    if (!g.indexedDB) return rej(new Error('This browser doesn’t allow local storage.'));
    const r = indexedDB.open('vault-local', 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'k' });
      if (!db.objectStoreNames.contains('items')) db.createObjectStore('items', { keyPath: 'id' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => { dbp = null; rej(new Error('This browser doesn’t allow local storage.')); };
  }));
  const wrap = rq => new Promise((res, rej) => { rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); });
  async function tx(names, mode, fn) {
    const db = await open(), t = db.transaction(names, mode);
    const done = new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });
    const out = await fn(...[].concat(names).map(n => t.objectStore(n)));
    await done;
    return out;
  }
  const Local = {
    getProfile: () => tx('meta', 'readonly', s => wrap(s.get('profile'))),
    hasProfile: async () => { try { return !!(await Local.getProfile()); } catch { return false; } },
    setProfile: p => tx('meta', 'readwrite', s => wrap(s.put({ k: 'profile', ...p }))),
    items: {
      async list() {
        const rows = await tx('items', 'readonly', s => wrap(s.getAll()));
        return rows.map(r => ({ id: r.id, data: r.data, hasFile: !!r.file, updatedAt: r.updatedAt }));
      },
      async put(id, data, file) {
        const updatedAt = Date.now();
        await tx('items', 'readwrite', async s => {
          const cur = await wrap(s.get(id));
          await wrap(s.put({ id, data, file: file === undefined ? (cur ? cur.file : null) : file, updatedAt }));
        });
        return { updatedAt };
      },
      remove: id => tx('items', 'readwrite', s => wrap(s.delete(id))),
      async getFile(id) { const r = await tx('items', 'readonly', s => wrap(s.get(id))); return r ? r.file : null; }
    },
    wipe: () => tx(['meta', 'items'], 'readwrite', (m, i) => Promise.all([wrap(m.clear()), wrap(i.clear())]))
  };

  g.VaultApi = { ApiError, req, items };
  g.VaultLocal = Local;
})(globalThis);
