'use strict';
(() => {
  const C = VaultCrypto, T = VaultTOTP, Api = VaultApi, Local = VaultLocal;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = n => `<svg class="i" aria-hidden="true"><use href="assets/icons.svg#i-${n}"></use></svg>`;
  const pref = {
    get: (k, d) => { try { return localStorage.getItem('vault.' + k) ?? d; } catch { return d; } },
    set: (k, v) => { try { localStorage.setItem('vault.' + k, v); } catch { /* storage blocked */ } }
  };

  const S = {
    mode: null,          // 'cloud' | 'local'
    email: null, dek: null, wrappedDek: null,
    items: [], page: 'codes', cloud: true, lastActive: Date.now(), lastSync: 0,
    rk: null, viewing: null, viewUrl: null, confirmRes: null, undecryptable: 0
  };
  const backend = () => (S.mode === 'cloud' ? Api.items : Local.items);
  const byId = id => S.items.find(i => i.id === id);
  const maxFile = () => (S.mode === 'cloud' ? 1024 * 1024 : 10 * 1024 * 1024);
  const MAX_NOTE_BYTES = 80000;
  const fmtSize = n => (n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB');
  const fmtDate = ms => new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  const friendly = e => (e && e.message === 'WRONG_SECRET' ? 'Incorrect password.' : (e && e.message) || 'Something went wrong.');

  /* ================= UI helpers ================= */
  let toastTimer = null;
  function toast(msg, isErr = false) {
    const el = $('#toast');
    el.textContent = msg; el.classList.toggle('err', isErr); el.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), isErr ? 5000 : 2600);
  }
  async function copyText(text, msg) {
    try { await navigator.clipboard.writeText(text); toast(msg); }
    catch { toast('Couldn’t copy. Your browser blocked clipboard access.', true); }
  }
  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  function handleError(e) {
    if (e && e.status === 401 && S.dek && S.mode === 'cloud' && /session|signed out/i.test(e.message)) return authLost();
    toast(friendly(e), true);
  }
  async function run(form, busy, fn) {
    const btn = $('[type=submit]', form), err = $('.form-error', form), label = btn.textContent;
    if (err) err.hidden = true;
    btn.disabled = true; btn.textContent = busy;
    try { await fn(); }
    catch (e) {
      if (e && e.status === 401 && S.dek && S.mode === 'cloud' && /session|signed out/i.test(e.message)) authLost();
      else if (err) { err.textContent = friendly(e); err.hidden = false; }
      else handleError(e);
    } finally { btn.disabled = false; btn.textContent = label; }
  }
  const setErr = (form, msg) => { const el = $('.form-error', form); el.textContent = msg; el.hidden = false; };

  function updateMeter(input) {
    const f = input.closest('.field'), { level, label } = C.scorePassword(input.value), bar = $('.meter i', f);
    bar.style.width = level * 25 + '%';
    bar.style.background = level <= 1 ? 'var(--danger)' : level === 2 ? 'var(--warn)' : 'var(--ok)';
    $('.meter-label', f).textContent = input.value ? label : '';
  }

  /* ---------- confirm / prompt dialogs ---------- */
  function confirmDialog({ title, body, ok = 'Confirm', danger = false }) {
    return new Promise(res => {
      $('#confirm-title').textContent = title; $('#confirm-body').textContent = body;
      const b = $('#confirm-ok'); b.textContent = ok; b.className = 'btn ' + (danger ? 'btn-danger' : 'btn-primary');
      S.confirmRes = res; $('#dlg-confirm').showModal();
    });
  }
  let promptRes = null, promptOptional = false;
  function askSecret({ title, help = '', label = 'Password', ok = 'Continue', danger = false, optional = false }) {
    return new Promise(res => {
      $('#prompt-title').textContent = title; $('#prompt-help').textContent = help; $('#prompt-help').hidden = !help;
      $('#prompt-label').textContent = label;
      const b = $('#prompt-ok'); b.textContent = ok; b.className = 'btn ' + (danger ? 'btn-danger' : 'btn-primary');
      promptRes = res; promptOptional = optional;
      $('#dlg-prompt').showModal(); $('#prompt-input').focus();
    });
  }

  /* ================= Auth screens ================= */
  function setNotice(msg, kind) {
    const n = $('#auth-notice');
    n.hidden = !msg; n.textContent = msg || ''; n.className = 'notice' + (kind ? ' ' + kind : '');
  }
  async function showAuth(view, { notice, kind } = {}) {
    $('#app').hidden = true; $('#auth').hidden = false;
    $$('#auth [data-view]').forEach(s => { s.hidden = s.dataset.view !== view; });
    setNotice(notice, kind);
    if (view === 'signin' || view === 'local-setup' || view === 'local-unlock') {
      $$('#ls-alt, #lu-alt').forEach(el => { el.hidden = !S.cloud; });
    }
    if (view === 'signin') {
      const has = await Local.hasProfile();
      $('#btn-use-local').textContent = has ? 'Open data on this device' : 'Use on this device only';
      const last = pref.get('email', '');
      if (last && !$('#si-email').value) $('#si-email').value = last;
    }
    if (view === 'locked') { $('#locked-email').textContent = S.email; $('#lk-user').value = S.email; }
    const first = $(`#auth [data-view="${view}"] input:not([type=hidden]):not([type=checkbox]):not([hidden])`);
    setTimeout(() => first && first.focus(), 30);
  }

  const mailOk = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
  function checkNewPassword(pw, confirm) {
    if (pw.length < 10) throw new Error('Use at least 10 characters for your password.');
    if (pw !== confirm) throw new Error('The passwords don’t match.');
  }

  async function startCloud(email, wrapped, dek) {
    S.mode = 'cloud'; S.email = email; S.wrappedDek = wrapped; S.dek = dek; S.page = 'codes';
    pref.set('mode', 'cloud'); pref.set('email', email);
    await loadItems();
    enterApp();
  }

  async function signIn(form) {
    const el = form.elements, email = C.normEmail(el.email.value), pw = el.password.value;
    if (!mailOk(email) || !pw) throw new Error('Enter your email and password.');
    const cr = await C.passwordCredentials(email, pw);
    const r = await Api.req('POST', '/login', { email, authKey: cr.auth });
    let dek;
    try { dek = await C.unwrapDEK(r.wrappedDek, cr.kek); } catch { throw new Error('Your account data couldn’t be unlocked.'); }
    form.reset();
    await startCloud(r.email, r.wrappedDek, dek);
  }

  async function signUp(form) {
    const el = form.elements, email = C.normEmail(el.email.value), pw = el.password.value;
    if (!mailOk(email)) throw new Error('Enter a valid email address.');
    checkNewPassword(pw, el.confirm.value);
    const pc = await C.passwordCredentials(email, pw);
    const rk = C.generateRecoveryCode(), rc = await C.recoveryCredentials(email, rk);
    const dek = await C.newDEK();
    const wrapped = await C.wrapDEK(dek, pc.kek), rcWrapped = await C.wrapDEK(dek, rc.kek);
    await Api.req('POST', '/register', { email, authKey: pc.auth, wrappedDek: wrapped, rcAuth: rc.auth, rcWrappedDek: rcWrapped });
    S.mode = 'cloud'; S.email = email; S.wrappedDek = wrapped; S.items = []; S.page = 'codes';
    S.dek = await C.unwrapDEK(wrapped, pc.kek);
    pref.set('mode', 'cloud'); pref.set('email', email);
    form.reset(); $$('.meter i', form).forEach(i => { i.style.width = '0'; }); $$('.meter-label', form).forEach(l => { l.textContent = ''; });
    S.rk = rk; $('#rk-code').textContent = rk; $('#rk-saved').checked = false; $('#rk-continue').disabled = true;
    showAuth('recovery-key');
  }

  async function recoverAccount(form) {
    const el = form.elements, email = C.normEmail(el.email.value), pw = el.password.value;
    if (!mailOk(email)) throw new Error('Enter a valid email address.');
    checkNewPassword(pw, el.confirm.value);
    const rc = await C.recoveryCredentials(email, el.key.value);
    const r = await Api.req('POST', '/recover/start', { email, rcAuth: rc.auth });
    let dek;
    try { dek = await C.unwrapDEK(r.rcWrappedDek, rc.kek, true); } catch { throw new Error('The email or recovery key is incorrect.'); }
    const pc = await C.passwordCredentials(email, pw);
    const rk = C.generateRecoveryCode(), rc2 = await C.recoveryCredentials(email, rk);
    const wrapped = await C.wrapDEK(dek, pc.kek);
    await Api.req('POST', '/recover/finish', {
      email, rcAuth: rc.auth, authKey: pc.auth, wrappedDek: wrapped, rcAuth2: rc2.auth, rcWrappedDek2: await C.wrapDEK(dek, rc2.kek)
    });
    S.mode = 'cloud'; S.email = email; S.wrappedDek = wrapped; S.page = 'codes'; S.dek = await C.unwrapDEK(wrapped, pc.kek);
    pref.set('mode', 'cloud'); pref.set('email', email);
    await loadItems();
    form.reset();
    S.rk = rk; $('#rk-code').textContent = rk; $('#rk-saved').checked = false; $('#rk-continue').disabled = true;
    showAuth('recovery-key', { notice: 'Your password was reset. Here is your new recovery key. The old one no longer works.' });
  }

  async function unlockSession(form) {
    const pw = form.elements.password.value;
    if (!pw) throw new Error('Enter your password.');
    const cr = await C.passwordCredentials(S.email, pw);
    try { S.dek = await C.unwrapDEK(S.wrappedDek, cr.kek); } catch { throw new Error('Incorrect password.'); }
    form.reset();
    await loadItems();
    enterApp();
  }

  async function localSetup(form) {
    const pw = form.elements.password.value;
    checkNewPassword(pw, form.elements.confirm.value);
    const salt = C.rand(16), cr = await C.localCredentials(pw, salt), dek = await C.newDEK();
    const wrapped = await C.wrapDEK(dek, cr.kek);
    await Local.setProfile({ salt: C.b64.enc(salt), wrappedDek: wrapped, created: Date.now() });
    S.mode = 'local'; S.email = null; S.wrappedDek = wrapped; S.items = []; S.page = 'codes';
    S.dek = await C.unwrapDEK(wrapped, cr.kek);
    pref.set('mode', 'local');
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch { /* optional */ }
    form.reset(); $$('.meter i', form).forEach(i => { i.style.width = '0'; }); $$('.meter-label', form).forEach(l => { l.textContent = ''; });
    enterApp();
  }

  async function localUnlock(form) {
    const pw = form.elements.password.value, prof = await Local.getProfile();
    if (!prof) return showAuth('local-setup');
    const cr = await C.localCredentials(pw, C.b64.dec(prof.salt));
    try { S.dek = await C.unwrapDEK(prof.wrappedDek, cr.kek); } catch { throw new Error('Incorrect password.'); }
    S.mode = 'local'; S.email = null; S.wrappedDek = prof.wrappedDek;
    pref.set('mode', 'local');
    form.reset();
    await loadItems();
    enterApp();
  }

  /* ================= Session ================= */
  function wipeMemory() {
    S.dek = null; S.items = []; S.viewing = null; S.rk = null;
    T.clearCache(); stopTicker(); stopScan();
    if (S.viewUrl) { URL.revokeObjectURL(S.viewUrl); S.viewUrl = null; }
    $$('dialog[open]').forEach(d => d.close());
    ['#code-list', '#file-list', '#view-content', '#rk-code', '#rkd-code'].forEach(s => { $(s).innerHTML = ''; });
  }
  function lock(reason) {
    if (!S.dek) return;
    wipeMemory();
    if (S.mode === 'cloud') showAuth('locked', { notice: reason });
    else showAuth('local-unlock', { notice: reason });
  }
  async function signOut() {
    try { if (S.mode === 'cloud') await Api.req('POST', '/logout', {}); } catch { /* already signed out */ }
    wipeMemory(); S.mode = null; S.email = null; S.wrappedDek = null; pref.set('mode', '');
    showAuth('signin');
  }
  function authLost() {
    wipeMemory(); S.email = null; S.wrappedDek = null;
    showAuth('signin', { notice: 'Your session expired. Sign in again.', kind: 'warn' });
  }

  async function loadItems() {
    const rows = await backend().list(), out = [];
    let bad = 0;
    await Promise.all(rows.map(async r => {
      try {
        const m = await C.openJSON(S.dek, r.data, r.id);
        if (['totp', 'note', 'file'].includes(m.type)) out.push({ ...m, id: r.id, hasFile: !!r.hasFile, updatedAt: r.updatedAt });
      } catch { bad++; }
    }));
    S.items = out; S.undecryptable = bad; S.lastSync = Date.now();
  }
  async function refresh() {
    if (!S.dek || S.mode !== 'cloud' || Date.now() - S.lastSync < 15000) return;
    try {
      const rows = await Api.items.list();
      const sig = a => a.map(x => x.id + ':' + x.updatedAt).sort().join('|');
      S.lastSync = Date.now();
      if (sig(rows) !== sig(S.items)) { await loadItems(); render(); }
    } catch (e) { if (e && e.status === 401) authLost(); }
  }

  const toMeta = it => it.type === 'totp'
    ? { type: 'totp', issuer: it.issuer || '', name: it.name || '', secret: it.secret, period: it.period || 30, digits: it.digits || 6, algorithm: it.algorithm || 'SHA1' }
    : it.type === 'note' ? { type: 'note', title: it.title, body: it.body }
    : { type: 'file', title: it.title, mime: it.mime, size: it.size };

  // Encrypts and saves one item. fileBytes: undefined = leave the stored file alone, Uint8Array = replace it.
  async function persist(meta, fileBytes) {
    const id = meta.id || C.uid(), prev = byId(id), clean = toMeta(meta);
    const data = await C.sealJSON(S.dek, clean, id);
    const file = fileBytes === undefined ? undefined : await C.sealFile(S.dek, fileBytes, id);
    const res = await backend().put(id, data, file);
    const rec = { ...clean, id, hasFile: fileBytes === undefined ? !!(prev && prev.hasFile) : true, updatedAt: (res && res.updatedAt) || Date.now() };
    const i = S.items.findIndex(x => x.id === id);
    if (i >= 0) S.items[i] = rec; else S.items.push(rec);
    return rec;
  }
  async function getFileBytes(it) {
    const sealed = await backend().getFile(it.id);
    if (!sealed) throw new Error('This file is empty or missing.');
    return C.openFile(S.dek, sealed, it.id);
  }

  function enterApp() {
    $('#auth').hidden = true; $('#app').hidden = false;
    S.lastActive = Date.now();
    const cloud = S.mode === 'cloud';
    $('#acct-kind').textContent = cloud ? 'Cloud account' : 'Local · not synced';
    $('#acct-name').textContent = cloud ? S.email : 'This device';
    const b = $('#btn-signout');
    b.textContent = cloud ? 'Sign out' : 'Use account'; b.dataset.act = cloud ? 'signout' : 'goto-signin';
    b.hidden = !cloud && !S.cloud;
    $('#set-autolock').value = pref.get('autolock', '5');
    $('#set-theme').value = VaultTheme.get();
    navigate(S.page);
    startTicker();
    if (S.undecryptable) toast(S.undecryptable + ' item' + (S.undecryptable === 1 ? '' : 's') + ' couldn’t be decrypted and ' + (S.undecryptable === 1 ? 'was' : 'were') + ' skipped.', true);
  }

  /* ================= Navigation & rendering ================= */
  function navigate(page) {
    S.page = page;
    $$('[data-act="nav"]').forEach(b => { if (b.dataset.page === page) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    ['codes', 'files', 'settings'].forEach(p => { $('#page-' + p).hidden = p !== page; });
    render();
    window.scrollTo(0, 0);
  }
  function render() {
    $('#count-codes').textContent = S.items.filter(i => i.type === 'totp').length || '';
    $('#count-files').textContent = S.items.filter(i => i.type !== 'totp').length || '';
    if (S.page === 'codes') renderCodes();
    else if (S.page === 'files') renderFiles();
    else renderSettings();
  }

  function renderCodes() {
    const q = $('#q-codes').value.trim().toLowerCase();
    const all = S.items.filter(i => i.type === 'totp');
    const list = all.filter(i => !q || (i.issuer + ' ' + i.name).toLowerCase().includes(q))
      .sort((a, b) => (a.issuer || a.name).localeCompare(b.issuer || b.name, undefined, { sensitivity: 'base' }));
    const el = $('#code-list');
    if (!all.length) {
      el.innerHTML = `<li class="empty">${icon('shield')}<h2>No codes yet</h2><p>Add the 2FA codes for your accounts. Scan the QR code a service shows you, or paste its secret key.</p><button class="btn btn-primary" type="button" data-act="add-code">${icon('plus')}Add your first code</button></li>`;
      return;
    }
    if (!list.length) { el.innerHTML = `<li class="empty"><p>No codes match “${esc(q)}”.</p></li>`; return; }
    el.innerHTML = list.map(it => {
      const title = it.issuer || it.name, sub = it.issuer ? it.name : '';
      return `<li class="code-row" data-id="${esc(it.id)}">
        <div class="avatar" aria-hidden="true">${esc(title.charAt(0).toUpperCase() || '?')}</div>
        <div class="code-text"><div class="code-name truncate">${esc(title)}</div><div class="code-sub truncate">${esc(sub)}</div></div>
        <button class="code-value" type="button" data-act="copy-code" data-id="${esc(it.id)}" aria-label="Copy code for ${esc(title)}" title="Click to copy"><span class="digits">${it._code ? T.format(it._code) : '––– –––'}</span><span class="secs"></span></button>
        <div class="row-actions">
          <button class="icon-btn" type="button" data-act="edit-code" data-id="${esc(it.id)}" aria-label="Edit ${esc(title)}" title="Edit">${icon('edit')}</button>
          <button class="icon-btn danger" type="button" data-act="delete-item" data-id="${esc(it.id)}" aria-label="Delete ${esc(title)}" title="Delete">${icon('trash')}</button>
        </div>
        <div class="bar" aria-hidden="true"><i></i></div></li>`;
    }).join('');
    tick();
  }

  let tickTimer = null, ticking = false;
  const startTicker = () => { stopTicker(); tickTimer = setInterval(tick, 1000); };
  const stopTicker = () => { clearInterval(tickTimer); tickTimer = null; };
  async function tick() {
    if (ticking || !S.dek || S.page !== 'codes') return;
    ticking = true;
    try {
      const now = Date.now();
      for (const row of $$('#code-list .code-row')) {
        const it = byId(row.dataset.id);
        if (!it) continue;
        const period = it.period || 30, counter = Math.floor(now / 1000 / period);
        if (it._counter !== counter || !it._code) {
          try { it._code = await T.code(it.secret, it); } catch { it._code = null; }
          it._counter = counter;
          $('.digits', row).textContent = it._code ? T.format(it._code) : 'Invalid key';
        }
        const rem = T.remaining(period, now), warn = rem <= 5;
        $('.bar', row).style.setProperty('--p', (rem / period).toFixed(3));
        $('.bar', row).classList.toggle('warn', warn);
        $('.secs', row).textContent = rem + 's';
        $('.secs', row).classList.toggle('warn', warn);
      }
    } finally { ticking = false; }
  }

  function renderFiles() {
    const q = $('#q-files').value.trim().toLowerCase();
    const all = S.items.filter(i => i.type !== 'totp');
    const list = all.filter(i => !q || ((i.title || '') + ' ' + (i.body || '')).toLowerCase().includes(q)).sort((a, b) => b.updatedAt - a.updatedAt);
    const el = $('#file-list');
    if (!all.length) {
      el.innerHTML = `<li class="empty">${icon('file')}<h2>No notes or files yet</h2><p>Keep recovery codes, passwords, IDs and documents encrypted alongside your 2FA codes.</p><div class="btn-row center"><button class="btn btn-primary" type="button" data-act="new-note">${icon('plus')}New note</button><button class="btn btn-outline" type="button" data-act="upload">${icon('upload')}Upload file</button></div></li>`;
      return;
    }
    if (!list.length) { el.innerHTML = `<li class="empty"><p>Nothing matches “${esc(q)}”.</p></li>`; return; }
    el.innerHTML = list.map(it => {
      const isNote = it.type === 'note', isImg = !isNote && (it.mime || '').startsWith('image/');
      const meta = [isNote ? 'Note' : isImg ? 'Image' : 'File', !isNote && it.size != null ? fmtSize(it.size) : '', fmtDate(it.updatedAt)].filter(Boolean).join(' · ');
      const prev = isNote ? (it.body || '').trim().split('\n')[0].slice(0, 90) : '';
      return `<li class="item-row">
        <div class="avatar" aria-hidden="true">${icon(isNote ? 'note' : isImg ? 'image' : 'file')}</div>
        <button class="item-main" type="button" data-act="open-item" data-id="${esc(it.id)}"><span class="item-title">${esc(it.title || 'Untitled')}</span><span class="item-meta">${esc(meta)}</span>${prev ? `<span class="item-preview">${esc(prev)}</span>` : ''}</button>
        <div class="row-actions">
          <button class="icon-btn" type="button" data-act="edit-item" data-id="${esc(it.id)}" aria-label="${isNote ? 'Edit' : 'Rename'} ${esc(it.title)}" title="${isNote ? 'Edit' : 'Rename'}">${icon('edit')}</button>
          <button class="icon-btn danger" type="button" data-act="delete-item" data-id="${esc(it.id)}" aria-label="Delete ${esc(it.title)}" title="Delete">${icon('trash')}</button>
        </div></li>`;
    }).join('');
  }

  function renderSettings() {
    $$('[data-only]').forEach(el => { el.hidden = el.dataset.only !== S.mode; });
    $('#set-email').textContent = S.email || '';
  }

  /* ================= Codes ================= */
  function openCodeDialog(id) {
    const it = id ? byId(id) : null;
    $('#code-title').textContent = it ? 'Edit code' : 'Add code';
    $('#code-scan-row').hidden = !!it;
    $('#code-id').value = it ? it.id : '';
    $('#code-issuer').value = it ? it.issuer || '' : '';
    $('#code-name').value = it ? it.name || '' : '';
    $('#code-secret').value = it ? it.secret : '';
    $('#code-period').value = it ? it.period || 30 : 30;
    $('#code-digits').value = String(it ? it.digits || 6 : 6);
    $('#code-algorithm').value = it ? it.algorithm || 'SHA1' : 'SHA1';
    $('#dlg-code').showModal();
    $('#code-issuer').focus();
  }
  function fillCode(p) {
    if (!$('#dlg-code').open) openCodeDialog();
    $('#code-issuer').value = p.issuer || ''; $('#code-name').value = p.name || '';
    $('#code-secret').value = p.secret; $('#code-period').value = p.period || 30;
    $('#code-digits').value = String(p.digits || 6); $('#code-algorithm').value = p.algorithm || 'SHA1';
  }
  async function saveCode(form) {
    let secret = $('#code-secret').value.trim();
    if (/^otpauth/i.test(secret)) { handleScanned(secret); return; }
    secret = secret.replace(/[\s-]/g, '').toUpperCase();
    const issuer = $('#code-issuer').value.trim(), name = $('#code-name').value.trim();
    const period = Math.min(Math.max(parseInt($('#code-period').value, 10) || 30, 10), 120);
    const digits = parseInt($('#code-digits').value, 10) || 6, algorithm = $('#code-algorithm').value;
    if (!issuer && !name) throw new Error('Enter a service or an account name.');
    if (!secret) throw new Error('Enter the secret key.');
    C.base32Decode(secret);
    await T.code(secret, { period, digits, algorithm });
    const id = $('#code-id').value || undefined;
    await persist({ id, type: 'totp', issuer, name, secret, period, digits, algorithm });
    $('#dlg-code').close();
    render(); toast(id ? 'Code updated.' : 'Code added.');
  }
  async function importCodes(list) {
    let n = 0;
    for (const p of list) { await persist({ type: 'totp', ...p }); n++; }
    if ($('#dlg-code').open) $('#dlg-code').close();
    render(); toast(n + ' code' + (n === 1 ? '' : 's') + ' added.');
  }
  async function handleScanned(text) {
    let list;
    try { list = T.parseAny(text); } catch (e) { toast(/otpauth/i.test(text) ? friendly(e) : 'That QR code isn’t a 2FA code.', true); return false; }
    if (list.length === 1) { fillCode(list[0]); toast('Code read. Review it and save.'); return true; }
    if (await confirmDialog({ title: 'Import ' + list.length + ' codes?', body: 'This looks like an export from another authenticator app. All ' + list.length + ' codes will be added to your Vault.', ok: 'Import' })) await importCodes(list);
    return true;
  }

  /* ---------- QR scanning ---------- */
  let scanStream = null, scanRaf = 0;
  async function startScan() {
    const dlg = $('#dlg-scan'), status = $('#scan-status');
    status.textContent = 'Starting camera…';
    dlg.showModal();
    try {
      scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } } });
      const v = $('#scan-video'); v.srcObject = scanStream; await v.play();
      status.textContent = 'Point your camera at the QR code.';
      scanLoop();
    } catch { status.textContent = 'Camera access isn’t available. Use “Use an image” instead.'; }
  }
  function scanLoop() {
    const v = $('#scan-video'), cv = $('#scan-canvas');
    if (!scanStream) return;
    if (v.readyState >= 2 && v.videoWidth) {
      cv.width = v.videoWidth; cv.height = v.videoHeight;
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(v, 0, 0);
      const img = ctx.getImageData(0, 0, cv.width, cv.height), hit = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
      if (hit && hit.data) { $('#dlg-scan').close(); handleScanned(hit.data); return; }
    }
    scanRaf = requestAnimationFrame(scanLoop);
  }
  function stopScan() {
    cancelAnimationFrame(scanRaf);
    if (scanStream) { scanStream.getTracks().forEach(t => t.stop()); scanStream = null; }
    const v = $('#scan-video'); if (v) v.srcObject = null;
  }
  async function readQrImage(file) {
    if (!file) return;
    try {
      const bmp = await createImageBitmap(file), scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
      const cv = document.createElement('canvas'); cv.width = Math.round(bmp.width * scale); cv.height = Math.round(bmp.height * scale);
      const ctx = cv.getContext('2d'); ctx.drawImage(bmp, 0, 0, cv.width, cv.height);
      const img = ctx.getImageData(0, 0, cv.width, cv.height), hit = jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });
      if (!hit) { toast('No QR code found in that image.', true); return; }
      if ($('#dlg-scan').open) $('#dlg-scan').close();
      handleScanned(hit.data);
    } catch { toast('Couldn’t read that image.', true); }
  }

  /* ================= Notes & files ================= */
  function openNoteDialog(id) {
    const it = id ? byId(id) : null, isFile = !!it && it.type === 'file';
    $('#note-heading').textContent = !it ? 'New note' : isFile ? 'Rename file' : 'Edit note';
    $('#note-id').value = it ? it.id : '';
    $('#note-title').value = it ? it.title || '' : '';
    $('#note-body').value = it && !isFile ? it.body || '' : '';
    $('#note-body-field').hidden = isFile;
    $('#dlg-note').showModal();
    (isFile || !it ? $('#note-title') : $('#note-body')).focus();
  }
  async function saveNote() {
    const id = $('#note-id').value || undefined, prev = id ? byId(id) : null;
    const title = $('#note-title').value.trim();
    if (prev && prev.type === 'file') {
      if (!title) throw new Error('Enter a name.');
      await persist({ ...prev, title });
    } else {
      const body = $('#note-body').value;
      if (!title && !body.trim()) throw new Error('Add a title or some text.');
      if (new TextEncoder().encode(body).length > MAX_NOTE_BYTES) throw new Error('Notes can be up to about 80 KB. For longer text, upload it as a file.');
      await persist({ id, type: 'note', title: title || 'Untitled', body });
    }
    $('#dlg-note').close();
    render(); toast('Saved.');
  }
  async function uploadFile(file) {
    if (!file) return;
    if (file.size > maxFile()) { toast('Files can be up to ' + fmtSize(maxFile()) + ' in ' + (S.mode === 'cloud' ? 'a cloud account' : 'local mode') + '.', true); return; }
    toast('Encrypting…');
    await persist({ type: 'file', title: file.name, mime: file.type || 'application/octet-stream', size: file.size }, new Uint8Array(await file.arrayBuffer()));
    render(); toast('File encrypted and saved.');
  }

  const isTextFile = it => (it.mime || '').startsWith('text/') || /\.(txt|md|json|csv|log|ya?ml|xml|ini|conf|env|pem|pub|key)$/i.test(it.title || '');
  async function openItem(id) {
    const it = byId(id); if (!it) return;
    S.viewing = it; S.viewData = null;
    const c = $('#view-content'), isNote = it.type === 'note';
    $('#view-title').textContent = it.title || 'Untitled';
    $('#view-copy').hidden = true; $('#view-download').hidden = true; $('#view-edit').hidden = false;
    $('#view-edit').textContent = isNote ? 'Edit' : 'Rename';
    if (isNote) {
      c.innerHTML = `<div class="note-body">${esc(it.body)}</div>`;
      $('#view-copy').hidden = false;
      $('#dlg-view').showModal(); return;
    }
    c.innerHTML = '<p class="muted">Decrypting…</p>';
    $('#dlg-view').showModal();
    try {
      const bytes = await getFileBytes(it);
      if (S.viewing !== it) return;
      const blob = new Blob([bytes], { type: it.mime || 'application/octet-stream' });
      S.viewData = { blob, text: null };
      $('#view-download').hidden = false;
      if ((it.mime || '').startsWith('image/') && !/svg/i.test(it.mime)) {
        S.viewUrl = URL.createObjectURL(blob);
        c.innerHTML = `<img class="view-image" alt="${esc(it.title)}" src="${S.viewUrl}">`;
      } else if (isTextFile(it)) {
        S.viewData.text = new TextDecoder().decode(bytes);
        c.innerHTML = `<div class="note-body">${esc(S.viewData.text.slice(0, 200000))}</div>`;
        $('#view-copy').hidden = false;
      } else {
        c.innerHTML = `<p><b>${esc(it.title)}</b></p><p class="muted">${esc(fmtSize(it.size || bytes.length))} · ${esc(it.mime || 'File')}</p><p class="muted">No preview for this file type. Download it to open it.</p>`;
      }
    } catch (e) { c.innerHTML = `<div class="form-error">${esc(friendly(e))}</div>`; }
  }

  async function deleteItem(id) {
    const it = byId(id); if (!it) return;
    const label = it.type === 'totp' ? (it.issuer || it.name) : it.title;
    const ok = await confirmDialog({
      title: 'Delete “' + label + '”?',
      body: it.type === 'totp' ? 'You’ll lose this code. Make sure you can still sign in to the service some other way, for example with a backup code.' : 'This can’t be undone.',
      ok: 'Delete', danger: true
    });
    if (!ok) return;
    await backend().remove(id);
    S.items = S.items.filter(x => x.id !== id);
    render(); toast('Deleted.');
  }

  /* ================= Settings ================= */
  async function reauth(title, help, ok = 'Continue', danger = false) {
    const pw = await askSecret({ title, help, ok, danger });
    if (pw === null) return null;
    toast('Checking password…');
    if (S.mode === 'cloud') {
      const cr = await C.passwordCredentials(S.email, pw);
      let dek; try { dek = await C.unwrapDEK(S.wrappedDek, cr.kek, true); } catch { throw new Error('Incorrect password.'); }
      return { cr, dek };
    }
    const prof = await Local.getProfile(), cr = await C.localCredentials(pw, C.b64.dec(prof.salt));
    let dek; try { dek = await C.unwrapDEK(prof.wrappedDek, cr.kek, true); } catch { throw new Error('Incorrect password.'); }
    return { cr, dek };
  }

  async function changePassword(form) {
    const cur = $('#pw-current').value, next = $('#pw-new').value;
    if (!cur) throw new Error('Enter your current password.');
    checkNewPassword(next, $('#pw-confirm').value);
    if (S.mode === 'cloud') {
      const old = await C.passwordCredentials(S.email, cur);
      let dek; try { dek = await C.unwrapDEK(S.wrappedDek, old.kek, true); } catch { throw new Error('Your current password is incorrect.'); }
      const nw = await C.passwordCredentials(S.email, next), wrapped = await C.wrapDEK(dek, nw.kek);
      await Api.req('POST', '/password', { authKey: old.auth, newAuthKey: nw.auth, wrappedDek: wrapped });
      S.wrappedDek = wrapped; S.dek = await C.unwrapDEK(wrapped, nw.kek);
    } else {
      const prof = await Local.getProfile(), old = await C.localCredentials(cur, C.b64.dec(prof.salt));
      let dek; try { dek = await C.unwrapDEK(prof.wrappedDek, old.kek, true); } catch { throw new Error('Your current password is incorrect.'); }
      const salt = C.rand(16), nw = await C.localCredentials(next, salt), wrapped = await C.wrapDEK(dek, nw.kek);
      await Local.setProfile({ ...prof, salt: C.b64.enc(salt), wrappedDek: wrapped });
      S.wrappedDek = wrapped; S.dek = await C.unwrapDEK(wrapped, nw.kek);
    }
    $('#dlg-password').close();
    toast(S.mode === 'cloud' ? 'Password changed. Other devices were signed out.' : 'Password changed.');
  }

  function showRecoveryDialog(rk) {
    S.rk = rk; $('#rkd-code').textContent = rk; $('#rkd-saved').checked = false; $('#rkd-done').disabled = true;
    $('#dlg-recovery').showModal();
  }
  async function newRecoveryKey() {
    const r = await reauth('New recovery key', 'Enter your password to create a new recovery key. Your current one will stop working.');
    if (!r) return;
    const rk = C.generateRecoveryCode(), rc = await C.recoveryCredentials(S.email, rk);
    await Api.req('POST', '/recovery', { authKey: r.cr.auth, rcAuth: rc.auth, rcWrappedDek: await C.wrapDEK(r.dek, rc.kek) });
    showRecoveryDialog(rk);
  }
  async function deleteAccount() {
    const r = await reauth('Delete account', 'This permanently deletes your account and everything in it. Enter your password to confirm.', 'Delete account', true);
    if (!r) return;
    await Api.req('DELETE', '/account', { authKey: r.cr.auth });
    wipeMemory(); S.mode = null; S.email = null; S.wrappedDek = null; pref.set('mode', '');
    showAuth('signup', { notice: 'Your account was deleted.' });
  }
  async function deleteLocal() {
    if (!await confirmDialog({ title: 'Delete local data?', body: 'Everything Vault stores in this browser will be erased. This can’t be undone. Export a backup first if you might need it.', ok: 'Delete everything', danger: true })) return;
    await Local.wipe();
    wipeMemory(); S.mode = null; S.wrappedDek = null; pref.set('mode', '');
    showAuth('local-setup', { notice: 'Local data deleted.' });
  }

  /* ---------- export / import ---------- */
  async function exportBackup() {
    const pass = await askSecret({
      title: 'Export backup', label: 'Backup passphrase (optional)', ok: 'Download', optional: true,
      help: 'Protect the backup with a passphrase. Leave it empty to download a plain, unencrypted file.'
    });
    if (pass === null) return;
    if (pass === '' && !await confirmDialog({ title: 'Download without encryption?', body: 'The file will contain your 2FA secrets and notes in plain text. Anyone who gets it can read them. Store it somewhere safe and delete it when you’re done.', ok: 'Download anyway', danger: true })) return;
    toast('Preparing backup…');
    const items = [];
    for (const it of S.items) {
      const m = toMeta(it);
      if (it.type === 'file' && it.hasFile) m.fileB64 = C.b64.enc(await getFileBytes(it));
      items.push(m);
    }
    const payload = { format: 'vault-export', version: 2, exportedAt: new Date().toISOString(), items };
    let out = payload;
    if (pass) {
      const salt = C.rand(16), key = await C.backupKey(pass, salt);
      out = { format: 'vault-export', version: 2, encrypted: true, kdf: { name: 'PBKDF2-SHA256', iterations: C.KDF_ITERATIONS, salt: C.b64.enc(salt) },
        data: await C.seal(key, new TextEncoder().encode(JSON.stringify(payload)), 'vault-backup') };
    }
    download(new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' }), 'vault-backup-' + new Date().toISOString().slice(0, 10) + '.json');
    toast('Backup downloaded.');
  }

  // Backups made by the first version of Vault (per-vault passwords).
  async function legacyKey(password, salt) {
    const enc = new TextEncoder();
    const pk = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
    const s1 = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 500000, hash: 'SHA-512' }, pk, 256);
    const mac = await crypto.subtle.importKey('raw', s1, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const mid = await crypto.subtle.sign('HMAC', mac, C.concat(enc.encode('AES_KEY_DERIVATION'), salt));
    const ik = await crypto.subtle.importKey('raw', mid, 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 500000, hash: 'SHA-256' }, ik, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  }
  async function legacyDecrypt(b64, pw) {
    const buf = C.b64.dec(b64);
    const key = await legacyKey(pw, buf.slice(0, 16));
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf.slice(16, 28) }, key, buf.slice(28)));
  }
  async function legacyVaultItems(vault) {
    let pw, entries;
    for (;;) {
      pw = await askSecret({ title: 'Import “' + vault.name + '”', help: 'Enter the password for this vault from the previous version of Vault. Leave it blank by cancelling to skip it.', ok: 'Import' });
      if (!pw) return null;
      toast('Decrypting “' + vault.name + '”… this can take a moment.');
      try { entries = [JSON.parse(await legacyDecrypt(vault.entries[0], pw))]; break; }
      catch (e) { if (!vault.entries.length) { entries = []; break; } toast('That password didn’t work. Try again.', true); }
    }
    const rest = vault.entries.slice(1);
    for (let i = 0; i < rest.length; i += 4) {
      const got = await Promise.all(rest.slice(i, i + 4).map(b => legacyDecrypt(b, pw).then(JSON.parse).catch(() => null)));
      entries.push(...got.filter(Boolean));
    }
    const out = []; let skipped = 0;
    for (const e of entries) {
      if (e.type === 'totp') out.push({ type: 'totp', issuer: e.issuer || e.label || '', name: e.issuer ? e.label || '' : '', secret: e.secret, period: e.period || 30 });
      else if ((e.type === 'note' || e.type === 'file') && e.encBody && !e.hasExtra) {
        try {
          const body = await legacyDecrypt(e.encBody, pw);
          out.push(e.type === 'note' ? { type: 'note', title: e.title, body } : { type: 'file', title: e.title, mime: e.mimeType, fileB64: body });
        } catch { skipped++; }
      } else skipped++;
    }
    if (skipped) toast(skipped + ' item' + (skipped === 1 ? '' : 's') + ' (with extra passcodes) couldn’t be imported.', true);
    return out;
  }

  function normalizeImported(x) {
    if (!x || typeof x !== 'object') return null;
    const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
    if (x.type === 'totp') {
      const secret = str(x.secret, 256).replace(/[\s-]/g, '').toUpperCase();
      try { C.base32Decode(secret); } catch { return null; }
      return { meta: { type: 'totp', issuer: str(x.issuer, 100), name: str(x.name, 200), secret,
        period: Math.min(Math.max(parseInt(x.period, 10) || 30, 10), 120), digits: [6, 7, 8].includes(+x.digits) ? +x.digits : 6, algorithm: T.normAlg(x.algorithm) } };
    }
    if (x.type === 'note') {
      const body = str(x.body, 80000);
      return body || x.title ? { meta: { type: 'note', title: str(x.title, 200) || 'Untitled', body } } : null;
    }
    if (x.type === 'file' && typeof x.fileB64 === 'string') {
      let bytes; try { bytes = C.b64.dec(x.fileB64); } catch { return null; }
      return { meta: { type: 'file', title: str(x.title, 255) || 'file', mime: str(x.mime, 100) || 'application/octet-stream', size: bytes.length }, bytes };
    }
    return null;
  }
  const sig = m => m.type === 'totp' ? ['t', m.issuer, m.name, m.secret].join('\0') : m.type === 'note' ? ['n', m.title, m.body].join('\0') : ['f', m.title, m.size].join('\0');

  async function importFile(file) {
    if (!file) return;
    const text = await file.text();
    let data = null, list = [];
    try { data = JSON.parse(text); } catch { /* maybe a list of otpauth links */ }
    if (data && data.format === 'vault-export') {
      if (data.encrypted) {
        const pass = await askSecret({ title: 'Encrypted backup', help: 'Enter the passphrase you set when you exported this backup.', label: 'Backup passphrase', ok: 'Decrypt' });
        if (!pass) return;
        toast('Decrypting…');
        try {
          const it = Math.min(Math.max(parseInt(data.kdf.iterations, 10) || C.KDF_ITERATIONS, 1000), 5000000);
          const key = await C.backupKey(pass, C.b64.dec(data.kdf.salt), it);
          data = JSON.parse(new TextDecoder().decode(await C.open(key, data.data, 'vault-backup')));
        } catch { toast('Wrong passphrase, or the file is damaged.', true); return; }
      }
      list = Array.isArray(data.items) ? data.items : [];
    } else if (data && data.v === 1 && Array.isArray(data.vaults)) {
      for (const v of data.vaults) { const got = await legacyVaultItems(v); if (got) list.push(...got); }
    } else {
      try { list = T.parseAny(text).map(x => ({ type: 'totp', ...x })); }
      catch { toast('That file isn’t a Vault backup, a Google Authenticator export, or a list of otpauth:// links.', true); return; }
    }
    const have = new Set(S.items.map(i => sig(toMeta(i)))), counts = { added: 0, dup: 0, bad: 0, big: 0 };
    toast('Importing…');
    for (const x of list) {
      const n = normalizeImported(x);
      if (!n) { counts.bad++; continue; }
      const s = sig(n.meta);
      if (have.has(s)) { counts.dup++; continue; }
      if (n.bytes && n.bytes.length > maxFile()) { counts.big++; continue; }
      await persist(n.meta, n.bytes);
      have.add(s); counts.added++;
    }
    render();
    const extra = [counts.dup && counts.dup + ' already here', counts.big && counts.big + ' too large', counts.bad && counts.bad + ' unreadable'].filter(Boolean);
    toast('Imported ' + counts.added + ' item' + (counts.added === 1 ? '' : 's') + (extra.length ? ' (' + extra.join(', ') + ')' : '') + '.', counts.added === 0 && list.length > 0);
  }

  /* ================= Event wiring ================= */
  const actions = {
    'show-view': t => showAuth(t.dataset.to),
    'toggle-pw': t => { const i = t.parentElement.querySelector('input'), show = i.type === 'password'; i.type = show ? 'text' : 'password'; t.textContent = show ? 'Hide' : 'Show'; },
    'use-local': async () => showAuth((await Local.hasProfile()) ? 'local-unlock' : 'local-setup'),
    'goto-signin': () => { lock(); showAuth('signin'); },
    'copy-rk': () => copyText(S.rk, 'Recovery key copied.'),
    'download-rk': () => download(new Blob(['Vault recovery key\r\nAccount: ' + (S.email || '') + '\r\n\r\n' + S.rk + '\r\n\r\nKeep this somewhere safe. It is the only way to reset your password.\r\n'], { type: 'text/plain' }), 'vault-recovery-key.txt'),
    'rk-continue': () => { S.rk = null; $('#rk-code').textContent = ''; loadItems().then(enterApp).catch(handleError); },
    'lock': () => lock(),
    'signout': signOut,
    'nav': t => navigate(t.dataset.page),
    'close-dialog': t => t.closest('dialog').close(),
    'add-code': () => openCodeDialog(),
    'edit-code': t => openCodeDialog(t.dataset.id),
    'copy-code': t => { const it = byId(t.dataset.id); if (it && it._code) copyText(it._code, 'Code copied.'); },
    'scan-qr': startScan,
    'pick-qr': () => $('#qr-input').click(),
    'new-note': () => openNoteDialog(),
    'edit-item': t => openNoteDialog(t.dataset.id),
    'open-item': t => openItem(t.dataset.id),
    'delete-item': t => deleteItem(t.dataset.id),
    'upload': () => $('#file-input').click(),
    'view-edit': () => { const id = S.viewing && S.viewing.id; $('#dlg-view').close(); if (id) openNoteDialog(id); },
    'view-copy': () => { const v = S.viewing; copyText(v.type === 'note' ? v.body : S.viewData && S.viewData.text || '', 'Copied.'); },
    'view-download': () => { if (S.viewData) download(S.viewData.blob, S.viewing.title || 'download'); },
    'confirm-yes': () => { const r = S.confirmRes; S.confirmRes = null; $('#dlg-confirm').close(); if (r) r(true); },
    'confirm-no': () => { $('#dlg-confirm').close(); },
    'change-password': () => $('#dlg-password').showModal(),
    'new-recovery': newRecoveryKey,
    'signout-all': async () => {
      if (!await confirmDialog({ title: 'Sign out everywhere?', body: 'Every device, including this one, will be signed out.', ok: 'Sign out everywhere' })) return;
      await Api.req('POST', '/logout-all', {});
      wipeMemory(); S.mode = null; S.email = null; S.wrappedDek = null; showAuth('signin');
    },
    'export': exportBackup,
    'import': () => $('#import-input').click(),
    'delete-account': deleteAccount,
    'delete-local': deleteLocal
  };
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-act]');
    if (!t || t.disabled) return;
    const fn = actions[t.dataset.act];
    if (!fn) return;
    Promise.resolve().then(() => fn(t, e)).catch(handleError);
  });

  const forms = {
    signin: ['Signing in…', signIn], signup: ['Creating account…', signUp], recover: ['Resetting…', recoverAccount],
    unlock: ['Unlocking…', unlockSession], 'local-setup': ['Setting up…', localSetup], 'local-unlock': ['Unlocking…', localUnlock],
    code: ['Saving…', saveCode], note: ['Saving…', saveNote], password: ['Changing…', changePassword],
    prompt: ['…', async () => {
      const v = $('#prompt-input').value;
      if (!v && !promptOptional) return;
      const r = promptRes; promptRes = null; $('#dlg-prompt').close(); if (r) r(v);
    }]
  };
  document.addEventListener('submit', e => {
    const f = e.target.closest('form[data-form]'); if (!f) return;
    e.preventDefault();
    const h = forms[f.dataset.form];
    if (h) run(f, h[0], () => h[1](f));
  });

  document.addEventListener('input', e => {
    const t = e.target;
    if (t.matches('[data-meter]')) updateMeter(t);
    if (t.id === 'q-codes' || t.id === 'q-files') render();
    if (t.id === 'rk-saved') $('#rk-continue').disabled = !t.checked;
    if (t.id === 'rkd-saved') $('#rkd-done').disabled = !t.checked;
    if (t.id === 'code-secret' && /^otpauth/i.test(t.value.trim())) handleScanned(t.value.trim());
  });
  document.addEventListener('change', e => {
    const t = e.target;
    if (t.id === 'set-autolock') pref.set('autolock', t.value);
    if (t.id === 'set-theme') VaultTheme.set(t.value);
    if (t.id === 'file-input') { const f = t.files[0]; t.value = ''; uploadFile(f).catch(handleError); }
    if (t.id === 'qr-input') { const f = t.files[0]; t.value = ''; readQrImage(f); }
    if (t.id === 'import-input') { const f = t.files[0]; t.value = ''; importFile(f).catch(handleError); }
  });

  // Reset sensitive fields whenever a dialog closes, however it was closed.
  document.addEventListener('close', e => {
    const d = e.target;
    if (!(d instanceof HTMLDialogElement)) return;
    $$('form', d).forEach(f => f.reset());
    $$('.form-error', d).forEach(x => { if (x.id !== 'x') x.hidden = true; });
    $$('.pw input', d).forEach(i => { i.type = 'password'; });
    $$('.pw button', d).forEach(b => { b.textContent = 'Show'; });
    $$('.meter i', d).forEach(i => { i.style.width = '0'; });
    $$('.meter-label', d).forEach(l => { l.textContent = ''; });
    if (d.id === 'dlg-view') {
      $('#view-content').innerHTML = ''; S.viewing = null; S.viewData = null;
      if (S.viewUrl) { URL.revokeObjectURL(S.viewUrl); S.viewUrl = null; }
    }
    if (d.id === 'dlg-scan') stopScan();
    if (d.id === 'dlg-prompt' && promptRes) { const r = promptRes; promptRes = null; r(null); }
    if (d.id === 'dlg-confirm' && S.confirmRes) { const r = S.confirmRes; S.confirmRes = null; r(false); }
    if (d.id === 'dlg-recovery') { S.rk = null; $('#rkd-code').textContent = ''; }
  }, true);
  $('#dlg-recovery').addEventListener('cancel', e => { if (!$('#rkd-saved').checked) e.preventDefault(); });
  $('#dlg-view').addEventListener('click', e => { if (e.target === e.currentTarget) e.currentTarget.close(); });

  // Auto-lock and background sync
  ['pointerdown', 'keydown', 'touchstart', 'wheel'].forEach(ev => addEventListener(ev, () => { S.lastActive = Date.now(); }, { passive: true }));
  setInterval(() => {
    if (!S.dek) return;
    const m = parseInt(pref.get('autolock', '5'), 10);
    if (m > 0 && Date.now() - S.lastActive > m * 60000) lock('Locked after ' + m + ' minute' + (m === 1 ? '' : 's') + ' of inactivity.');
  }, 5000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  addEventListener('focus', refresh);

  /* ================= Start ================= */
  async function probeSession() {
    try {
      const r = await fetch('/api/session', { credentials: 'same-origin', cache: 'no-store' });
      if (!(r.headers.get('content-type') || '').includes('application/json')) return { available: false };
      if (r.status === 401) return { available: true, session: null };
      if (!r.ok) return { available: r.status < 500, session: null };
      return { available: true, session: await r.json() };
    } catch { return { available: false }; }
  }
  async function init() {
    const hash = location.hash.slice(1), probe = await probeSession();
    S.cloud = probe.available;
    const hasLocal = await Local.hasProfile();
    if (probe.session) {
      S.mode = 'cloud'; S.email = probe.session.email; S.wrappedDek = probe.session.wrappedDek;
      return showAuth('locked');
    }
    if (!S.cloud) {
      return showAuth(hasLocal ? 'local-unlock' : 'local-setup', { notice: 'Accounts aren’t available right now, so Vault is running in local mode on this device.', kind: 'warn' });
    }
    if (hash === 'local') return showAuth(hasLocal ? 'local-unlock' : 'local-setup');
    if (hash === 'signup') return showAuth('signup');
    if (pref.get('mode', '') === 'local' && hasLocal) return showAuth('local-unlock');
    showAuth('signin');
  }
  init();
})();
