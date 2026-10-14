'use strict';
let _selectedVaultId = null;
let _pendingImport = null;

function renderVaultSelector() {
  const idx = getIndex();
  const grid = document.getElementById('vault-grid');
  if (!idx.length) {
    grid.innerHTML = `<div class="vault-empty"><h2>No vaults on this device yet</h2><p>A vault holds your 2FA codes, notes and files, encrypted with your password or passkey.</p><button class="btn btn-primary" onclick="openModal('create-vault')">Create your first vault</button></div>`;
    return;
  }
  grid.innerHTML = idx.map(v => `<a class="vault-card" href="vault.html?v=${encodeURIComponent(v.id)}"><span class="vault-card-name">${esc(v.name)}</span><span class="vault-card-count">${countItems(v.id)} items</span><span class="vault-card-method">${methodLabel(localStorage.getItem(vKey(v.id, 'method')) || v.method)}</span></a>`).join('') + `<button class="vault-card-new" onclick="openModal('create-vault')">New vault</button>`;
}

function countItems(id) {
  try {
    const raw = localStorage.getItem(vKey(id, 'entries'));
    return raw ? JSON.parse(raw).length : 0;
  } catch { return 0; }
}

function selectVault(id) {
  _selectedVaultId = id;
  document.getElementById('vault-selector').style.display = 'none';
  document.getElementById('lockscreen').style.display = '';
  document.getElementById('master-pw').value = '';
  setLockMsg('', '');
  renderLockScreen();
  setTimeout(() => document.getElementById('master-pw').focus(), 50);
}

function backToVaultSelector() {
  _selectedVaultId = null;
  document.getElementById('master-pw').value = '';
  setLockMsg('', '');
  document.getElementById('lockscreen').style.display = 'none';
  renderVaultSelector();
  document.getElementById('vault-selector').style.display = '';
}

function renderLockScreen() {
  const importEnc = getImportData();
  if (importEnc && !_pendingImport) {
    const obj = unpackVault(importEnc);
    if (obj && obj.verifier && Array.isArray(obj.entries)) {
      _pendingImport = obj;
      document.getElementById('import-name').value = obj.name || 'Imported Vault';
      document.getElementById('import-err').textContent = '';
      document.getElementById('import-err').classList.remove('show');
      setTimeout(() => openModal('import-vault'), 50);
    }
  }

  const idx = getIndex();
  const unlockSec = document.getElementById('unlock-section');
  const backBtn = document.getElementById('lock-back');

  if (idx.length === 0) {
    backBtn.style.display = 'none';
    unlockSec.style.display = 'none';
    document.getElementById('lock-title').textContent = 'No vaults yet';
    document.getElementById('lock-desc').textContent = 'Create a vault from the main screen to get started.';
    _selectedVaultId = null;
    return;
  }

  if (!_selectedVaultId && idx.length === 1) _selectedVaultId = idx[0].id;

  const selected = idx.find(v => v.id === _selectedVaultId);
  backBtn.style.display = '';
  unlockSec.style.display = '';

  if (selected) {
    document.getElementById('lock-title').textContent = selected.name;
    document.getElementById('lock-desc').textContent = 'Enter your password to unlock this vault.';
    configureUnlockUI(selected.id);
  } else {
    document.getElementById('lock-title').textContent = 'Unlock vault';
    document.getElementById('lock-desc').textContent = 'Select a vault from the previous screen.';
    configureUnlockUI(idx[0].id);
  }
}

function configureUnlockUI(id) {
  const method = localStorage.getItem(vKey(id, 'method')) || 'password';
  const pwEl = document.getElementById('master-pw');
  const btnEl = document.getElementById('unlock-btn');
  const pkBtn = document.getElementById('passkey-btn');

  pwEl.style.display = (method === 'passkey') ? 'none' : '';
  btnEl.style.display = (method === 'passkey') ? 'none' : '';
  pkBtn.style.display = (method === 'passkey' || method === 'both') ? '' : 'none';
  pkBtn.textContent = method === 'passkey' ? 'Unlock with passkey' : 'Use passkey instead';
}

async function unlock() {
  const pw = document.getElementById('master-pw').value;
  if (!pw) { setLockMsg('Please enter your password.', true); return; }
  if (!_selectedVaultId) { setLockMsg('Select a vault first.', true); return; }

  setBusy(true, 'Checking…');
  setLockMsg('Checking your password…', false);

  const verifier = localStorage.getItem(vKey(_selectedVaultId, 'verifier'));
  const valid = await checkVerifier(pw, verifier);

  if (!valid) {
    setBusy(false);
    setLockMsg('Wrong password. Try again.', true);
    document.getElementById('master-pw').value = '';
    return;
  }

  setLockMsg('Opening your vault…', false);
  _entries = await loadEntries(_selectedVaultId, pw);
  _masterPw = pw;
  _activeId = _selectedVaultId;
  document.getElementById('master-pw').value = '';
  setBusy(false);
  setLockMsg('', false);
  resetIdleTimer();
  showApp();
}

function setLockMsg(msg, isErr) {
  const el = document.getElementById('lock-msg');
  el.textContent = msg;
  el.className = msg ? (isErr ? 'lock-msg err' : 'lock-msg info') : 'lock-msg';
}
function setBusy(on, lbl = 'Unlock vault') {
  const btn = document.getElementById('unlock-btn');
  btn.disabled = on;
  btn.textContent = on ? lbl : 'Unlock vault';
}

let _pendingDeleteVaultId = null;

function deleteVault(id) {
  const idx = getIndex();
  const info = idx.find(v => v.id === id);
  if (!info) return;
  _pendingDeleteVaultId = id;
  document.getElementById('confirm-delete-vault-msg').textContent = `"${info.name}" and all its codes and notes will be permanently deleted.`;
  document.getElementById('confirm-delete-vault-btn').onclick = () => {
    closeModal('confirm-delete-vault');
    deleteVaultData(_pendingDeleteVaultId);
    if (_selectedVaultId === _pendingDeleteVaultId) _selectedVaultId = null;
    _pendingDeleteVaultId = null;
    renderVaultSelector();
    document.getElementById('vault-selector').style.display = '';
    document.getElementById('lockscreen').style.display = 'none';
    toast('Vault deleted.');
  };
  openModal('confirm-delete-vault');
}

function confirmDeleteLockScreenVault() {
  const id = _selectedVaultId;
  if (!id) return;
  const idx = getIndex();
  const info = idx.find(v => v.id === id);
  document.getElementById('confirm-delete-vault-msg').textContent = `"${info?.name || 'this vault'}" and all its data will be permanently deleted from this device.`;
  document.getElementById('confirm-delete-vault-btn').onclick = () => {
    closeModal('confirm-delete-vault');
    deleteVaultData(id);
    location.href = 'vaults.html';
  };
  openModal('confirm-delete-vault');
}

function confirmResetAll() {
  openModal('confirm-reset-all');
}

function doResetAll() {
  closeModal('confirm-reset-all');
  const idx = getIndex();
  idx.forEach(v => deleteVaultData(v.id));
  localStorage.removeItem(IDX_KEY);
  _selectedVaultId = null;
  renderVaultSelector();
  toast('All vault data deleted.');
}

let _cvMethod = null;

function pickMethod(m) {
  _cvMethod = m;
  document.getElementById('cv-step-pick').style.display = 'none';
  document.querySelectorAll('.method-option').forEach(b => b.classList.remove('selected'));
  const map = { password: 'mb-pw', passkey: 'mb-pk', both: 'mb-both' };
  document.getElementById(map[m]).classList.add('selected');
  document.getElementById('cv-step-pw').style.display = (m === 'password' || m === 'both') ? '' : 'none';
  document.getElementById('cv-step-pk').style.display = (m === 'passkey' || m === 'both') ? '' : 'none';
  if (m === 'both') document.getElementById('pk-info-text').textContent = 'After setting your password, a passkey will also be registered on this device.';
  document.getElementById('cv-back-btn').style.display = '';
  document.getElementById('create-btn').style.display = '';
  document.getElementById('create-err').textContent = '';
  document.getElementById('create-err').classList.remove('show');
}

function cvBack() {
  _cvMethod = null;
  document.getElementById('cv-step-pick').style.display = '';
  document.getElementById('cv-step-pw').style.display = 'none';
  document.getElementById('cv-step-pk').style.display = 'none';
  document.getElementById('cv-back-btn').style.display = 'none';
  document.getElementById('create-btn').style.display = 'none';
  document.getElementById('pk-status').textContent = '';
  document.querySelectorAll('.method-option').forEach(b => b.classList.remove('selected'));
}

function cvReset() {
  cvBack();
  document.getElementById('cv-name').value = '';
  document.getElementById('new-pw').value = '';
  document.getElementById('new-pw2').value = '';
}

async function createVault() {
  const err = document.getElementById('create-err');
  err.textContent = ''; err.classList.remove('show');
  const name = document.getElementById('cv-name').value.trim() || 'My Vault';
  if (!_cvMethod) { showErr(err, 'Please choose an unlock method.'); return; }

  let vaultPw = null;
  if (_cvMethod === 'password' || _cvMethod === 'both') {
    const pw = document.getElementById('new-pw').value, pw2 = document.getElementById('new-pw2').value;
    if (pw.length < 8) { showErr(err, 'Password needs at least 8 characters.'); return; }
    if (pw !== pw2) { showErr(err, "Passwords don't match."); return; }
    vaultPw = pw;
  }

  const btn = document.getElementById('create-btn');
  btn.disabled = true; btn.textContent = 'Setting up…';

  try {
    const newId = uid();

    if (_cvMethod === 'passkey') {
      const secret = b64e(rnd(32));
      const credData = await registerPasskey();
      if (credData.error) { showErr(err, credData.error); btn.disabled = false; btn.textContent = 'Create vault'; return; }
      const wrapped = await wrapSecretWithCred(secret, credData.credId);
      localStorage.setItem(vKey(newId, 'pkcred'), JSON.stringify({ credId: credData.credId, wrappedSecret: wrapped }));
      vaultPw = secret;
    }

    if (_cvMethod === 'both') {
      document.getElementById('pk-status').textContent = 'Registering passkey…';
      const credData = await registerPasskey();
      if (credData.error) {
        document.getElementById('pk-status').textContent = 'Passkey failed: ' + credData.error + ' — saved as password only.';
        _cvMethod = 'password';
      } else {
        const wrapped = await wrapSecretWithCred(vaultPw, credData.credId);
        localStorage.setItem(vKey(newId, 'pkcred'), JSON.stringify({ credId: credData.credId, wrappedSecret: wrapped }));
        document.getElementById('pk-status').textContent = 'Passkey registered.';
      }
    }

    const verifier = await buildVerifier(vaultPw);
    localStorage.setItem(vKey(newId, 'verifier'), verifier);
    localStorage.setItem(vKey(newId, 'method'), _cvMethod);

    const idx = getIndex();
    idx.push({ id: newId, name, method: _cvMethod, created: Date.now() });
    saveIndex(idx);

    _masterPw = vaultPw; _activeId = newId; _entries = [];
    await persistEntries();

    closeModal('create-vault');
    cvReset();
    btn.disabled = false; btn.textContent = 'Create vault';
    _masterPw = null; _entries = [];
    location.href = 'vault.html?v=' + encodeURIComponent(newId);
  } catch (e) {
    btn.disabled = false; btn.textContent = 'Create vault';
    showErr(err, 'Error: ' + e.message);
  }
}

function lockVault(goToSelector = false) {
  const wasOpen = !!_masterPw;
  const prevId = _activeId;
  for (const e of _entries) {
    if (e.secret) e.secret = '';
    if (e.encBody) e.encBody = '';
  }
  _masterPw = null; _entries = []; _activeId = null;
  stopTotpRefresh();
  document.getElementById('totp-list').innerHTML = '';
  document.getElementById('notes-list').innerHTML = '';
  wipeItemView();
  clearPreviewUrls();
  document.getElementById('app').classList.remove('visible');
  document.getElementById('header-title').textContent = 'Vault';
  setLockMsg('', '');
  document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open'));
  _credVerifiedSecret = null;
  _credNewMethod = null;
  if (wasOpen) {
    if (goToSelector) {
      location.href = 'vaults.html';
    } else {
      _selectedVaultId = prevId;
      document.getElementById('vault-selector').style.display = 'none';
      document.getElementById('lockscreen').style.display = '';
      renderLockScreen();
    }
  }
}

function showApp() {
  document.getElementById('lockscreen').style.display = 'none';
  document.getElementById('vault-selector').style.display = 'none';
  document.getElementById('app').classList.add('visible');
  const info = getIndex().find(v => v.id === _activeId);
  document.getElementById('header-title').textContent = info ? info.name : 'Vault';
  document.getElementById('settings-name').value = info ? info.name : '';
  document.getElementById('settings-name-modal').value = info ? info.name : '';
  renderTOTP();
  renderItems();
  startTotpRefresh();
  resetIdleTimer();
}

const pkSupported = () => !!(window.PublicKeyCredential && navigator.credentials);
const rpId = () => location.hostname || 'localhost';

async function registerPasskey() {
  if (!pkSupported()) return { error: 'Passkeys are not supported in this browser.' };
  if (!location.hostname) return { error: 'Passkeys only work when hosted — use the Password option instead.' };
  try {
    const cred = await navigator.credentials.create({ publicKey: {
      challenge: rnd(32),
      rp: { name: 'Vault', id: rpId() },
      user: { id: rnd(16), name: 'vault-user', displayName: 'Vault User' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
      timeout: 60000
    } });
    return { credId: b64e(cred.rawId) };
  } catch (e) { return { error: e.message || 'Registration cancelled.' }; }
}

async function wrapSecretWithCred(secret, credId) {
  const salt = new TextEncoder().encode('VAULT_PK_WRAP_SALT_V1');
  const rawKey = b64d(credId).slice(0, 32);
  const km = await crypto.subtle.importKey('raw', rawKey.buffer.slice(rawKey.byteOffset, rawKey.byteOffset + 32), { name: 'PBKDF2' }, false, ['deriveKey']);
  const wk = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' }, km, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const iv = rnd(IV_LEN);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wk, new TextEncoder().encode(secret));
  const out = new Uint8Array(IV_LEN + ct.byteLength);
  out.set(iv, 0); out.set(new Uint8Array(ct), IV_LEN);
  return b64e(out);
}

async function unwrapSecretWithCred(wrappedB64, credId) {
  try {
    const salt = new TextEncoder().encode('VAULT_PK_WRAP_SALT_V1');
    const rawKey = b64d(credId).slice(0, 32);
    const km = await crypto.subtle.importKey('raw', rawKey.buffer.slice(rawKey.byteOffset, rawKey.byteOffset + 32), { name: 'PBKDF2' }, false, ['deriveKey']);
    const wk = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' }, km, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    const buf = b64d(wrappedB64);
    const iv = buf.slice(0, IV_LEN);
    const ct = buf.slice(IV_LEN);
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, wk, ct));
  } catch { return null; }
}

async function unlockWithPasskey() {
  if (!_selectedVaultId) return;
  const pkData = JSON.parse(localStorage.getItem(vKey(_selectedVaultId, 'pkcred')) || 'null');
  if (!pkData) return;
  if (!location.hostname) { setLockMsg('Passkeys only work when hosted — use your password instead.', true); return; }
  setLockMsg('Waiting for passkey…', false);
  setBusy(true, 'Waiting for passkey…');
  try {
    const assertion = await navigator.credentials.get({ publicKey: {
      challenge: rnd(32),
      rpId: rpId(),
      allowCredentials: [{ type: 'public-key', id: b64d(pkData.credId) }],
      userVerification: 'required', timeout: 60000
    } });
    const assertedId = b64e(assertion.rawId);
    const secret = await unwrapSecretWithCred(pkData.wrappedSecret, assertedId);
    if (!secret) { setBusy(false); setLockMsg('Could not unlock with passkey.', true); return; }
    const verifier = localStorage.getItem(vKey(_selectedVaultId, 'verifier'));
    if (!await checkVerifier(secret, verifier)) { setBusy(false); setLockMsg('Passkey mismatch.', true); return; }
    _entries = await loadEntries(_selectedVaultId, secret); _masterPw = secret; _activeId = _selectedVaultId;
    setBusy(false); setLockMsg('', false); resetIdleTimer(); showApp();
  } catch (e) { setBusy(false); setLockMsg('Passkey cancelled or failed: ' + (e.message || ''), true); }
}

function leaveVault() {
  lockVault(true);
}

function startRenameVault() {
  const info = getIndex().find(v => v.id === _activeId);
  const title = document.getElementById('header-title');
  const input = document.getElementById('header-title-input');
  input.value = info?.name || 'Vault';
  title.style.display = 'none';
  input.style.display = '';
  input.focus();
  input.select();
}

function finishRenameVault(save) {
  const title = document.getElementById('header-title');
  const input = document.getElementById('header-title-input');
  title.style.display = '';
  input.style.display = 'none';
  if (!save) return;
  applyVaultName(input.value.trim() || 'My Vault');
  toast('Vault renamed.');
}

function openShareModal() {
  const method = localStorage.getItem(vKey(_activeId, 'method')) || 'password';
  if (method === 'passkey') {
    document.getElementById('share-url').innerHTML = '<span style="color:var(--muted);font-size:13px">Passkey-only vaults cannot be shared by link. Add a password under Vault Settings → Change unlock method.</span>';
    openModal('share-link');
    return;
  }
  const verifier = localStorage.getItem(vKey(_activeId, 'verifier')) || '';
  const entries = localStorage.getItem(vKey(_activeId, 'entries')) || '[]';
  const info = getIndex().find(v => v.id === _activeId);
  const packed = packVault(verifier, JSON.parse(entries), info?.name || 'Vault');
  const fullUrl = new URL('vaults.html', location.href).href + '#import=' + packed;
  document.getElementById('share-url').textContent = fullUrl;
  openModal('share-link');
}
function selectShareUrl() {
  const el = document.getElementById('share-url');
  const r = document.createRange(); r.selectNodeContents(el);
  const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
}
async function copyShareLink() {
  const el = document.getElementById('share-url');
  const url = el.textContent.trim();
  if (!url || url.startsWith('Passkey')) { toast('Nothing to copy.'); return; }
  try { await navigator.clipboard.writeText(url); toast('Vault link copied.'); }
  catch { selectShareUrl(); toast('Select the link and copy manually.'); }
}

