'use strict';
function openAddItemModal() {
  _pendingFile = null;
  document.getElementById('add-item-title').textContent = 'New note';
  document.getElementById('add-note-body-group').style.display = '';
  document.getElementById('add-item-save-btn').onclick = () => addNote();
  clearIds('note-title', 'note-body', 'note-extra-pw');
  document.getElementById('add-note-err').textContent = '';
  document.getElementById('add-note-err').classList.remove('show');
  openModal('add-note');
}

async function handleFileUpload(input) {
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { toast('Files must be under 5 MB.'); return; }
  _pendingFile = file;
  document.getElementById('add-item-title').textContent = 'Upload file';
  document.getElementById('note-title').value = file.name;
  document.getElementById('note-body').value = '';
  document.getElementById('add-note-body-group').style.display = 'none';
  document.getElementById('add-item-save-btn').onclick = () => saveUploadedFile();
  document.getElementById('add-note-err').textContent = '';
  document.getElementById('add-note-err').classList.remove('show');
  clearIds('note-extra-pw');
  openModal('add-note');
}

async function addNote() {
  const title = v('note-title').trim() || 'Untitled';
  const body = v('note-body');
  const extraPw = v('note-extra-pw');
  const err = document.getElementById('add-note-err');
  if (!body.trim()) { showErr(err, 'Content cannot be empty.'); return; }
  const hasExtra = extraPw.length > 0;
  const encBody = await encryptStr(body, itemEffectivePw(extraPw));
  _entries.push({ id: uid(), type: 'note', title, encBody, hasExtra, created: Date.now() });
  await persistEntries();
  closeModal('add-note');
  clearIds('note-title', 'note-body', 'note-extra-pw');
  _pendingFile = null;
  renderItems();
  toast('Note saved.');
}

async function saveUploadedFile() {
  if (!_pendingFile) return;
  const title = v('note-title').trim() || _pendingFile.name;
  const extraPw = v('note-extra-pw');
  const err = document.getElementById('add-note-err');
  const btn = document.getElementById('add-item-save-btn');
  btn.disabled = true;
  btn.textContent = 'Uploading…';
  try {
    const buf = await _pendingFile.arrayBuffer();
    const b64 = b64e(buf);
    const hasExtra = extraPw.length > 0;
    const encBody = await encryptStr(b64, itemEffectivePw(extraPw));
    _entries.push({
      id: uid(),
      type: 'file',
      title,
      mimeType: _pendingFile.type || 'application/octet-stream',
      size: _pendingFile.size,
      encBody,
      hasExtra,
      created: Date.now()
    });
    await persistEntries();
    closeModal('add-note');
    clearIds('note-title', 'note-body', 'note-extra-pw');
    _pendingFile = null;
    renderItems();
    toast('File saved.');
  } catch (e) {
    showErr(err, 'Upload failed: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save';
  }
}

function removeItem(id) {
  confirmDelete(async () => {
    _entries = _entries.filter(e => e.id !== id);
    await persistEntries();
    renderItems();
    toast('Item deleted.');
  });
}

async function getItemPreview(item) {
  if (item.hasExtra) return { kind: 'protected', text: 'Extra passcode required to preview' };
  const raw = await decryptStr(item.encBody, _masterPw);
  if (raw === null) return { kind: 'text', text: 'Could not decrypt preview' };
  if (item.type === 'note') return { kind: 'text', text: raw.slice(0, 140) };
  if (item.mimeType?.startsWith('image/')) {
    try {
      const bytes = b64d(raw);
      const blob = new Blob([bytes], { type: item.mimeType });
      const url = URL.createObjectURL(blob);
      _previewUrls.push(url);
      return { kind: 'image', url };
    } catch { /* fall through */ }
  }
  if (isTextLike(item)) {
    try {
      const text = new TextDecoder().decode(b64d(raw));
      return { kind: 'text', text: text.slice(0, 140) };
    } catch { /* fall through */ }
  }
  return { kind: 'text', text: `${formatSize(item.size)} · ${item.mimeType || 'File'}` };
}

function itemKindLabel(item) {
  if (item.type === 'note') return 'Note';
  if (item.mimeType?.startsWith('image/')) return 'Image';
  if (item.mimeType?.startsWith('text/') || isTextLike(item)) return 'Text file';
  return 'File';
}

function itemIconClass(item) {
  if (item.type === 'note') return 'note';
  if (item.mimeType?.startsWith('image/')) return 'image';
  return 'file';
}

function itemIcon(item) {
  if (item.type === 'note') return ICON.note;
  if (item.mimeType?.startsWith('image/')) return ICON.image;
  return ICON.file;
}

async function renderItems() {
  const list = document.getElementById('notes-list');
  clearPreviewUrls();
  const items = _entries.filter(e => e.type === 'note' || e.type === 'file').sort((a, b) => b.created - a.created);
  if (!items.length) {
    list.innerHTML = `<div class="empty-state" style="border:1px dashed var(--border);border-radius:var(--radius-lg)"><div class="empty-state-icon">${ICON.file}</div><div class="empty-state-text">No files or notes yet.<br>Use <span onclick="openAddItemModal()">New Note</span> or upload a file.</div></div>`;
    return;
  }
  let html = '';
  for (const item of items) {
    const preview = await getItemPreview(item);
    const locked = item.hasExtra ? '<span class="file-badge">Extra passcode</span>' : '';
    const metaParts = [itemKindLabel(item)];
    if (item.size) metaParts.push(formatSize(item.size));
    metaParts.push(new Date(item.created).toLocaleDateString());
    const left = preview.kind === 'image'
      ? `<img class="file-thumb" src="${preview.url}" alt="">`
      : `<div class="file-icon ${itemIconClass(item)}">${itemIcon(item)}</div>`;
    const previewHtml = preview.kind === 'protected'
      ? `<div class="file-preview protected">${esc(preview.text)}</div>`
      : preview.kind === 'text' && preview.text
        ? `<div class="file-preview">${esc(preview.text)}</div>`
        : '';
    html += `
    <div class="file-item" onclick="viewItem('${item.id}')">
      ${left}
      <div class="file-body">
        <div class="file-name">${esc(item.title)} ${locked}</div>
        <div class="file-meta">${metaParts.join(' · ')}</div>
        ${previewHtml}
      </div>
      <div class="file-actions" onclick="event.stopPropagation()">
        <button title="Open" onclick="viewItem('${item.id}')">${ICON.view}</button>
        <button class="danger" title="Delete" onclick="removeItem('${item.id}')">${ICON.trash}</button>
      </div>
    </div>`;
  }
  list.innerHTML = html;
}

function viewItem(id) {
  const item = _entries.find(x => x.id === id);
  if (!item) return;
  _viewingItemId = id;
  _viewingItemData = null;
  document.getElementById('view-note-title').textContent = item.title;
  document.getElementById('view-note-pw').value = '';
  const errEl = document.getElementById('view-note-err');
  errEl.textContent = '';
  errEl.classList.remove('show');
  document.getElementById('view-note-body-section').style.display = 'none';
  document.getElementById('view-note-pw-section').style.display = item.hasExtra ? '' : 'none';
  document.getElementById('view-item-content').innerHTML = '';
  openModal('view-note');
  if (!item.hasExtra) decryptAndShowItem();
}

async function decryptAndShowItem() {
  const item = _entries.find(x => x.id === _viewingItemId);
  if (!item) return;
  const extraPw = v('view-note-pw');
  const effectivePw = item.hasExtra ? itemEffectivePw(extraPw) : _masterPw;
  const dec = await decryptStr(item.encBody, effectivePw);
  if (dec === null) {
    showErr(document.getElementById('view-note-err'), 'Wrong passcode — try again.');
    return;
  }
  document.getElementById('view-note-pw-section').style.display = 'none';
  document.getElementById('view-note-body-section').style.display = '';
  const container = document.getElementById('view-item-content');
  const copyBtn = document.getElementById('view-item-copy-btn');
  const dlBtn = document.getElementById('view-item-download-btn');

  if (item.type === 'note') {
    container.innerHTML = `<div class="item-view-body">${esc(dec)}</div>`;
    _viewingItemData = { type: 'text', content: dec };
    copyBtn.style.display = '';
    dlBtn.style.display = 'none';
    return;
  }

  const bytes = b64d(dec);
  if (item.mimeType?.startsWith('image/')) {
    const blob = new Blob([bytes], { type: item.mimeType });
    const url = URL.createObjectURL(blob);
    container.innerHTML = `<img class="item-view-image" src="${url}" alt="${esc(item.title)}">`;
    _viewingItemData = { type: 'blob', blob, filename: item.title, url };
    copyBtn.style.display = 'none';
    dlBtn.style.display = '';
    return;
  }

  if (isTextLike(item)) {
    const text = new TextDecoder().decode(bytes);
    container.innerHTML = `<div class="item-view-body">${esc(text)}</div>`;
    _viewingItemData = { type: 'text', content: text };
    copyBtn.style.display = '';
    dlBtn.style.display = '';
    return;
  }

  container.innerHTML = `<div class="item-view-body" style="text-align:center;padding:32px 16px"><p style="margin-bottom:8px">${esc(item.title)}</p><p style="color:var(--muted);font-size:13px">${formatSize(item.size)} · ${esc(item.mimeType || 'File')}</p><p style="color:var(--muted);font-size:13px;margin-top:8px">Preview not available — download to view.</p></div>`;
  _viewingItemData = { type: 'blob', blob: new Blob([bytes], { type: item.mimeType || 'application/octet-stream' }), filename: item.title };
  copyBtn.style.display = 'none';
  dlBtn.style.display = '';
}

function wipeItemView() {
  const container = document.getElementById('view-item-content');
  if (_viewingItemData?.url) URL.revokeObjectURL(_viewingItemData.url);
  container.innerHTML = '';
  document.getElementById('view-note-pw').value = '';
  _viewingItemId = null;
  _viewingItemData = null;
}

async function copyItemContent() {
  if (!_viewingItemData || _viewingItemData.type !== 'text') return;
  try { await navigator.clipboard.writeText(_viewingItemData.content); toast('Copied to clipboard.'); }
  catch { toast('Could not copy — check browser permissions.'); }
}

function downloadCurrentItem() {
  if (!_viewingItemData?.blob) return;
  const item = _entries.find(x => x.id === _viewingItemId);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(_viewingItemData.blob);
  a.download = item?.title || 'download';
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Download started.');
}

function filterFiles() {
  const q = document.getElementById('files-search').value.toLowerCase();
  document.querySelectorAll('.file-item').forEach(el => {
    const name = el.querySelector('.file-name')?.textContent.toLowerCase() || '';
    const preview = el.querySelector('.file-preview')?.textContent.toLowerCase() || '';
    el.style.display = (name.includes(q) || preview.includes(q)) ? '' : 'none';
  });
}

function estimateCrackTime(pw) {
  if (!pw) return null;
  let cs = 0;
  if (/[a-z]/.test(pw)) cs += 26; if (/[A-Z]/.test(pw)) cs += 26;
  if (/[0-9]/.test(pw)) cs += 10; if (/[^a-zA-Z0-9]/.test(pw)) cs += 32;
  if (!cs) return null;
  const secs = Math.pow(2, pw.length * Math.log2(cs)) / 2 / 150;
  if (secs < 60) return { label: `~${Math.ceil(secs)}s`, color: 'var(--red)' };
  if (secs < 3600) return { label: `~${Math.ceil(secs / 60)}min`, color: 'var(--red)' };
  if (secs < 86400) return { label: `~${Math.ceil(secs / 3600)}hr`, color: 'var(--amber)' };
  if (secs < 2592000) return { label: `~${Math.ceil(secs / 86400)}d`, color: 'var(--amber)' };
  if (secs < 31536000) return { label: `~${Math.ceil(secs / 2592000)}mo`, color: 'var(--amber)' };
  if (secs < 3.15e9) return { label: `~${Math.ceil(secs / 31536000)}yr`, color: 'var(--green)' };
  return { label: 'heat death of universe', color: 'var(--green)' };
}

document.getElementById('new-pw').addEventListener('input', function () {
  const val = this.value, est = estimateCrackTime(val);
  let checks = [val.length >= 8, val.length >= 12, val.length >= 16, /[A-Z]/.test(val) && /[a-z]/.test(val), /[0-9]/.test(val), /[^a-zA-Z0-9]/.test(val)];
  const s = checks.filter(Boolean).length, pct = Math.min(100, (s / 6) * 100), col = !est ? 'var(--red)' : est.color;
  document.getElementById('pw-strength-fill').style.cssText = `width:${pct}%;background:${col}`;
  const lbl = document.getElementById('pw-strength-label');
  if (!val) { lbl.textContent = ''; return; }
  lbl.style.color = col;
  lbl.textContent = est ? (val.length < 8 ? `${est.label} — needs at least 8 characters` : `${est.label} to crack`) : 'Choose a password above';
});

document.getElementById('cred-new-pw').addEventListener('input', function () {
  const val = this.value, est = estimateCrackTime(val);
  const checks = [val.length >= 8, val.length >= 12, val.length >= 16, /[A-Z]/.test(val) && /[a-z]/.test(val), /[0-9]/.test(val), /[^a-zA-Z0-9]/.test(val)];
  const s = checks.filter(Boolean).length, pct = Math.min(100, (s / 6) * 100), col = !est ? 'var(--red)' : est.color;
  document.getElementById('cred-strength-fill').style.cssText = `width:${pct}%;background:${col}`;
  const lbl = document.getElementById('cred-strength-label');
  if (!val) { lbl.textContent = ''; return; }
  lbl.style.color = col;
  lbl.textContent = est ? (val.length < 8 ? `${est.label} — needs at least 8 characters` : `${est.label} to crack`) : 'Choose a password above';
});

const v = id => document.getElementById(id)?.value ?? '';
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function openModal(name) { document.getElementById(`modal-${name}`).classList.add('open'); }
function closeModal(name) {
  document.getElementById(`modal-${name}`).classList.remove('open');
  if (name === 'qr-scanner') stopQRCamera();
}
document.querySelectorAll('.modal-overlay').forEach(ov => ov.addEventListener('click', e => { if (e.target === ov) ov.classList.remove('open'); }));

function clearIds(...ids) { ids.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; }); }
function showErr(el, msg) { el.textContent = msg; el.classList.add('show'); }

let _activeTab = 'totp';
function switchTab(name, btn) {
  _activeTab = name;
  document.querySelectorAll('.tab-panel').forEach(p => p.style.display = 'none');
  document.querySelectorAll('.app-tab').forEach(b => b.classList.remove('active'));
  document.getElementById(`tab-${name}`).style.display = '';
  if (btn) btn.classList.add('active');

  const toolbar = document.getElementById('tab-toolbar');
  const searchWrap = document.getElementById('toolbar-search-wrap');
  const sortBtn = document.getElementById('toolbar-sort-btn');
  const totpActions = document.getElementById('toolbar-totp-actions');
  const filesActions = document.getElementById('toolbar-files-actions');

  if (name === 'settings') {
    toolbar.classList.add('hidden');
  } else {
    toolbar.classList.remove('hidden');
    const isNotes = name === 'notes';
    searchWrap.style.display = isNotes ? '' : 'none';
    sortBtn.style.display = isNotes ? '' : 'none';
    totpActions.style.display = isNotes ? 'none' : '';
    filesActions.style.display = isNotes ? '' : 'none';
  }

  if (name === 'settings') {
    const info = getIndex().find(v => v.id === _activeId);
    document.getElementById('settings-name').value = info ? info.name : '';
  }
}
function openAddModal() {
  openModal('add-totp');
}

let _deleteCb = null;
function confirmDelete(cb) { _deleteCb = cb; openModal('confirm-delete'); }
document.getElementById('confirm-delete-btn').addEventListener('click', () => {
  closeModal('confirm-delete'); if (_deleteCb) { _deleteCb(); _deleteCb = null; }
});

let _toastTimer = null;
function toast(msg) {
  const el = document.getElementById('toast'); el.textContent = msg; el.classList.add('show');
  clearTimeout(_toastTimer); _toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

let _idleTimer = null, _hiddenTimer = null;

function resetIdleTimer() {
  if (!_masterPw) return;
  clearTimeout(_idleTimer);
  _idleTimer = setTimeout(() => expireLock('You were inactive for 5 minutes.'), 5 * 60 * 1000);
}

function expireLock(reason) {
  lockVault();
  document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open'));
  document.getElementById('session-expired-msg').textContent = reason;
  openModal('session-expired');
}

['mousemove', 'keydown', 'mousedown', 'touchstart', 'scroll'].forEach(evt => {
  document.addEventListener(evt, resetIdleTimer, { passive: true });
});

document.addEventListener('visibilitychange', () => {
  if (!_masterPw) return;
  if (document.hidden) {
    _hiddenTimer = setTimeout(() => expireLock('The tab was in the background for 2 minutes.'), 2 * 60 * 1000);
  } else {
    clearTimeout(_hiddenTimer);
  }
});

window.addEventListener('pagehide', () => { if (_masterPw) lockVault(); });

function confirmImport() {
  if (!_pendingImport) return;
  const name = document.getElementById('import-name').value.trim() || 'Imported Vault';
  const obj = _pendingImport;
  const idx = getIndex();
  const alreadyExists = idx.some(v => localStorage.getItem(vKey(v.id, 'verifier')) === obj.verifier);
  if (alreadyExists) { showErr(document.getElementById('import-err'), 'This vault is already saved on this device.'); return; }
  const newId = uid();
  localStorage.setItem(vKey(newId, 'verifier'), obj.verifier);
  localStorage.setItem(vKey(newId, 'entries'), JSON.stringify(obj.entries));
  localStorage.setItem(vKey(newId, 'method'), 'password');
  idx.push({ id: newId, name, method: 'password', created: Date.now() });
  saveIndex(idx);
  _pendingImport = null;
  _selectedVaultId = newId;
  history.replaceState(null, '', location.pathname + location.search);
  closeModal('import-vault');
  document.getElementById('lockscreen').style.display = 'none';
  document.getElementById('vault-selector').style.display = '';
  renderVaultSelector();
  toast(`"${name}" imported — enter the password to open it.`);
}

function openVaultSettings() {
  const idx = getIndex();
  const info = idx.find(v => v.id === _activeId);
  document.getElementById('settings-name-modal').value = info ? info.name : '';
  openModal('vault-settings');
}

function saveVaultSettings() {
  const name = document.getElementById('settings-name-modal').value.trim() || 'My Vault';
  applyVaultName(name);
  closeModal('vault-settings');
  toast('Name saved.');
}

function saveVaultNameFromTab() {
  const name = document.getElementById('settings-name').value.trim();
  if (!name) return;
  applyVaultName(name);
}

function applyVaultName(name) {
  const idx = getIndex();
  const info = idx.find(v => v.id === _activeId);
  if (info) { info.name = name; saveIndex(idx); }
  document.getElementById('header-title').textContent = name;
  document.getElementById('settings-name').value = name;
  document.getElementById('settings-name-modal').value = name;
}

function openGlobalSettings() {
  openModal('global-settings');
}

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('vault-theme', theme);
  document.querySelectorAll('.theme-toggle .toggle-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === theme);
  });
}

function exportAllData() {
  const idx = getIndex();
  const exportData = {
    v: 1,
    exported: Date.now(),
    theme: localStorage.getItem('vault-theme') || 'dark',
    vaults: idx.map(v => ({
      id: v.id,
      name: v.name,
      method: v.method,
      created: v.created,
      verifier: localStorage.getItem(vKey(v.id, 'verifier')),
      entries: JSON.parse(localStorage.getItem(vKey(v.id, 'entries')) || '[]'),
      pkcred: localStorage.getItem(vKey(v.id, 'pkcred'))
    }))
  };
  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `vault-export-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Export downloaded.');
}

function importAllData(input) {
  const file = input.files[0];
  input.value = '';
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    let data;
    try { data = JSON.parse(e.target.result); } catch {
      toast('Invalid file — could not parse JSON.'); return;
    }
    if (!data || data.v !== 1 || !Array.isArray(data.vaults)) {
      toast('Unrecognized export format.'); return;
    }
    const idx = getIndex();
    const existingIds = new Set(idx.map(v => v.id));
    let added = 0, skipped = 0;
    data.vaults.forEach(v => {
      if (!v.id || !v.name || !v.verifier) { skipped++; return; }
      if (existingIds.has(v.id)) { skipped++; return; }
      // Write vault keys
      localStorage.setItem(vKey(v.id, 'verifier'), v.verifier);
      localStorage.setItem(vKey(v.id, 'method'), v.method || 'password');
      localStorage.setItem(vKey(v.id, 'entries'), JSON.stringify(v.entries || []));
      if (v.pkcred) localStorage.setItem(vKey(v.id, 'pkcred'), v.pkcred);
      // Add to index
      idx.push({ id: v.id, name: v.name, method: v.method || 'password', created: v.created || Date.now() });
      existingIds.add(v.id);
      added++;
    });
    saveIndex(idx);
    if (data.theme) setTheme(data.theme);
    const msg = added > 0
      ? `Imported ${added} vault${added !== 1 ? 's' : ''}${skipped > 0 ? `, ${skipped} skipped` : ''}.`
      : `Nothing new to import — ${skipped} already exist${skipped !== 1 ? '' : 's'}.`;
    toast(msg);
    renderVaultSelector();
  };
  reader.readAsText(file);
}

function openCredentialChange() {
  resetCredFlow();
  openModal('change-credential');
}

let _credVerifiedSecret = null;
let _credNewMethod = null;

function resetCredFlow() {
  const method = localStorage.getItem(vKey(_activeId, 'method')) || 'password';
  const hasPasskey = method === 'passkey' || method === 'both';
  const hasPassword = method === 'password' || method === 'both';

  document.getElementById('cred-step-verify').style.display = '';
  document.getElementById('cred-step-pick').style.display = 'none';
  document.getElementById('cred-step-pw').style.display = 'none';
  document.getElementById('cred-step-pk').style.display = 'none';
  document.getElementById('cred-back-btn').style.display = 'none';
  document.getElementById('cred-apply-btn').style.display = 'none';

  document.getElementById('cred-verify-pw-row').style.display = hasPassword ? '' : 'none';
  document.getElementById('cred-verify-pw-btn').style.display = hasPassword ? '' : 'none';
  document.getElementById('cred-verify-pk-btn').style.display = hasPasskey ? '' : 'none';
  document.getElementById('cred-verify-hint').textContent = hasPassword && hasPasskey
    ? 'Verify your current password or passkey first.'
    : hasPasskey ? 'Verify your passkey first.' : 'Verify your current password first.';

  clearIds('cred-verify-pw', 'cred-new-pw', 'cred-confirm-pw');
  document.getElementById('cred-verify-err').textContent = '';
  document.getElementById('cred-verify-err').classList.remove('show');
  document.getElementById('cred-apply-err').textContent = '';
  document.getElementById('cred-apply-err').classList.remove('show');
  document.getElementById('cred-strength-fill').style.cssText = 'width:0%;background:var(--red)';
  document.getElementById('cred-strength-label').textContent = '';
  document.querySelectorAll('#cred-step-pick .method-option').forEach(b => b.classList.remove('selected'));
  document.getElementById('cred-apply-btn').disabled = false;
  document.getElementById('cred-apply-btn').textContent = 'Save changes';
  _credVerifiedSecret = null;
  _credNewMethod = null;
}

function credBack() {
  const pickVisible = document.getElementById('cred-step-pick').style.display !== 'none';
  if (!pickVisible) {
    document.getElementById('cred-step-pick').style.display = '';
    document.getElementById('cred-step-pw').style.display = 'none';
    document.getElementById('cred-step-pk').style.display = 'none';
    document.getElementById('cred-apply-btn').style.display = 'none';
    document.getElementById('cred-apply-err').textContent = '';
    document.getElementById('cred-apply-err').classList.remove('show');
    document.querySelectorAll('#cred-step-pick .method-option').forEach(b => b.classList.remove('selected'));
    clearIds('cred-new-pw', 'cred-confirm-pw');
    _credNewMethod = null;
    document.getElementById('cred-back-btn').style.display = '';
  } else {
    document.getElementById('cred-step-verify').style.display = '';
    document.getElementById('cred-step-pick').style.display = 'none';
    document.getElementById('cred-back-btn').style.display = 'none';
    document.getElementById('cred-verify-err').textContent = '';
    document.getElementById('cred-verify-err').classList.remove('show');
    clearIds('cred-verify-pw');
    _credVerifiedSecret = null;
    _credNewMethod = null;
  }
}

async function verifyCurrentCredential(via) {
  const err = document.getElementById('cred-verify-err');
  err.textContent = ''; err.classList.remove('show');

  if (via === 'password') {
    const pw = document.getElementById('cred-verify-pw').value;
    if (!pw) { showErr(err, 'Enter your current password.'); return; }
    const verifier = localStorage.getItem(vKey(_activeId, 'verifier'));
    const valid = await checkVerifier(pw, verifier);
    if (!valid) { showErr(err, 'Wrong password. Try again.'); clearIds('cred-verify-pw'); return; }
    _credVerifiedSecret = pw;
  } else {
    if (!location.hostname) { showErr(err, 'Passkeys only work when hosted — use your password instead.'); return; }
    const pkData = JSON.parse(localStorage.getItem(vKey(_activeId, 'pkcred')) || 'null');
    if (!pkData) { showErr(err, 'No passkey data found.'); return; }
    const btn = document.getElementById('cred-verify-pk-btn');
    btn.textContent = 'Waiting…'; btn.disabled = true;
    try {
      const assertion = await navigator.credentials.get({ publicKey: {
        challenge: rnd(32), rpId: rpId(),
        allowCredentials: [{ type: 'public-key', id: b64d(pkData.credId) }],
        userVerification: 'required', timeout: 60000
      } });
      const secret = await unwrapSecretWithCred(pkData.wrappedSecret, b64e(assertion.rawId));
      if (!secret) { showErr(err, 'Could not verify passkey.'); btn.textContent = 'Use passkey instead'; btn.disabled = false; return; }
      _credVerifiedSecret = secret;
    } catch { showErr(err, 'Passkey cancelled.'); btn.textContent = 'Use passkey instead'; btn.disabled = false; return; }
    btn.textContent = 'Use passkey instead'; btn.disabled = false;
  }

  document.getElementById('cred-step-verify').style.display = 'none';
  document.getElementById('cred-step-pick').style.display = '';
  document.getElementById('cred-back-btn').style.display = '';
}

function pickCredMethod(m) {
  _credNewMethod = m;
  document.querySelectorAll('#cred-step-pick .method-option').forEach(b => b.classList.remove('selected'));
  const map = { password: 'cred-mb-pw', passkey: 'cred-mb-pk', both: 'cred-mb-both' };
  document.getElementById(map[m]).classList.add('selected');

  const needsPw = m === 'password' || m === 'both';
  const needsPk = m === 'passkey' || m === 'both';

  document.getElementById('cred-step-pick').style.display = 'none';
  document.getElementById('cred-step-pw').style.display = needsPw ? '' : 'none';
  document.getElementById('cred-step-pk').style.display = needsPk ? '' : 'none';
  document.getElementById('cred-apply-btn').style.display = '';
  document.getElementById('cred-back-btn').style.display = '';

  if (needsPk) {
    document.getElementById('cred-pk-info-text').textContent = m === 'both'
      ? 'After setting your password, a passkey will be registered on this device.'
      : 'Click Apply and your browser will ask you to set up a passkey.';
    document.getElementById('cred-pk-status').textContent = '';
  }

  document.getElementById('cred-apply-err').textContent = '';
  document.getElementById('cred-apply-err').classList.remove('show');
  clearIds('cred-new-pw', 'cred-confirm-pw');
}

async function applyCredChange() {
  if (!_credNewMethod) return;
  const err = document.getElementById('cred-apply-err');
  err.textContent = ''; err.classList.remove('show');
  const btn = document.getElementById('cred-apply-btn');
  btn.disabled = true; btn.textContent = 'Saving…';

  const needsPw = _credNewMethod === 'password' || _credNewMethod === 'both';
  const needsPk = _credNewMethod === 'passkey' || _credNewMethod === 'both';

  let newPw = null;
  if (needsPw) {
    newPw = document.getElementById('cred-new-pw').value;
    const conf = document.getElementById('cred-confirm-pw').value;
    if (newPw.length < 8) { showErr(err, 'Password needs at least 8 characters.'); btn.disabled = false; btn.textContent = 'Save changes'; return; }
    if (newPw !== conf) { showErr(err, "Passwords don't match."); btn.disabled = false; btn.textContent = 'Save changes'; return; }
  } else {
    newPw = b64e(rnd(32));
  }

  try {
    const reencrypted = await Promise.all(_entries.map(e => encryptStr(JSON.stringify(e), newPw)));
    localStorage.setItem(vKey(_activeId, 'entries'), JSON.stringify(reencrypted));
    for (const e of _entries) {
      if ((e.type === 'note' || e.type === 'file') && e.encBody && !e.hasExtra) {
        const plain = await decryptStr(e.encBody, _credVerifiedSecret);
        if (plain) e.encBody = await encryptStr(plain, newPw);
      }
    }
    localStorage.setItem(vKey(_activeId, 'verifier'), await buildVerifier(newPw));
    _masterPw = newPw;
    await persistEntries();

    if (needsPk) {
      document.getElementById('cred-pk-status').textContent = 'Registering passkey…';
      const credData = await registerPasskey();
      if (credData.error) {
        if (_credNewMethod === 'both') {
          document.getElementById('cred-pk-status').textContent = 'Passkey failed — saved as password only.';
          _credNewMethod = 'password';
        } else {
          showErr(err, credData.error); btn.disabled = false; btn.textContent = 'Save changes'; return;
        }
      } else {
        const wrapped = await wrapSecretWithCred(newPw, credData.credId);
        localStorage.setItem(vKey(_activeId, 'pkcred'), JSON.stringify({ credId: credData.credId, wrappedSecret: wrapped }));
      }
    }

    if (!needsPk) localStorage.removeItem(vKey(_activeId, 'pkcred'));

    localStorage.setItem(vKey(_activeId, 'method'), _credNewMethod);
    const idx = getIndex();
    const info = idx.find(v => v.id === _activeId);
    if (info) { info.method = _credNewMethod; saveIndex(idx); }

    _credVerifiedSecret = null;
    _credNewMethod = null;
    closeModal('change-credential');
    toast('Unlock method updated.');
  } catch (e) {
    showErr(err, 'Error: ' + e.message);
    btn.disabled = false; btn.textContent = 'Save changes';
  }
}

function confirmDeleteCurrentVault() {
  const idx = getIndex();
  const info = idx.find(v => v.id === _activeId);
  _pendingDeleteVaultId = _activeId;
  document.getElementById('confirm-delete-vault-msg').textContent = `"${info?.name || 'this vault'}" and all its data will be permanently deleted.`;
  document.getElementById('confirm-delete-vault-btn').onclick = () => {
    closeModal('confirm-delete-vault');
    closeModal('vault-settings');
    const id = _pendingDeleteVaultId;
    _masterPw = null;
    deleteVaultData(id);
    location.href = 'vaults.html';
  };
  openModal('confirm-delete-vault');
}

let _editSecretValue = '';
let _editSecretVisible = false;

function openEditTOTP(id) {
  const e = _entries.find(x => x.id === id);
  if (!e) return;
  _editSecretValue = e.secret;
  _editSecretVisible = false;
  document.getElementById('edit-totp-id').value = id;
  document.getElementById('edit-totp-label').value = e.label;
  const secretInput = document.getElementById('edit-totp-secret');
  secretInput.type = 'password';
  secretInput.value = '••••••••••••';
  secretInput.readOnly = true;
  document.getElementById('edit-secret-view-btn').textContent = 'View';
  document.getElementById('edit-totp-issuer').value = e.issuer || '';
  document.getElementById('edit-totp-period').value = e.period;
  document.getElementById('edit-totp-err').textContent = '';
  document.getElementById('edit-totp-err').classList.remove('show');
  openModal('edit-totp');
}

function toggleEditSecretView() {
  const secretInput = document.getElementById('edit-totp-secret');
  const btn = document.getElementById('edit-secret-view-btn');
  _editSecretVisible = !_editSecretVisible;
  if (_editSecretVisible) {
    secretInput.type = 'text';
    secretInput.readOnly = false;
    secretInput.value = _editSecretValue;
    btn.textContent = 'Hide';
    secretInput.focus();
  } else {
    secretInput.type = 'password';
    secretInput.readOnly = true;
    secretInput.value = '••••••••••••';
    btn.textContent = 'View';
  }
}

async function saveEditTOTP() {
  const id = document.getElementById('edit-totp-id').value;
  const label = document.getElementById('edit-totp-label').value.trim();
  const secretInput = document.getElementById('edit-totp-secret');
  const secret = _editSecretVisible
    ? secretInput.value.trim().replace(/\s/g, '').toUpperCase()
    : _editSecretValue;
  const issuer = document.getElementById('edit-totp-issuer').value.trim();
  const period = parseInt(document.getElementById('edit-totp-period').value) || 30;
  const err = document.getElementById('edit-totp-err');

  if (!label) { showErr(err, 'Name is required.'); return; }
  if (!secret) { showErr(err, 'Secret key is required.'); return; }
  try { base32Decode(secret); } catch (e) { showErr(err, 'Invalid secret: ' + e.message); return; }

  const idx = _entries.findIndex(x => x.id === id);
  if (idx === -1) return;
  _entries[idx] = { ..._entries[idx], label, secret, issuer, period };
  await persistEntries();
  closeModal('edit-totp');
  _editSecretVisible = false;
  _editSecretValue = '';
  renderTOTP();
  toast('2FA code updated.');
}

