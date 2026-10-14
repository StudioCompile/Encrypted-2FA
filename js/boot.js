'use strict';
setTheme(localStorage.getItem('vault-theme') || 'dark');
const _page = document.body.dataset.page;

function checkImportLink() {
  const enc = getImportData();
  const obj = enc && unpackVault(enc);
  if (!obj || !obj.verifier || !Array.isArray(obj.entries)) return;
  _pendingImport = obj;
  document.getElementById('import-name').value = obj.name || 'Imported Vault';
  openModal('import-vault');
}

function renderVaultStats() {
  const idx = getIndex();
  let items = 0, bytes = 0;
  idx.forEach(v => { items += countItems(v.id); ['verifier', 'entries'].forEach(k => bytes += (localStorage.getItem(vKey(v.id, k)) || '').length); });
  document.getElementById('st-vaults').textContent = idx.length;
  document.getElementById('st-items').textContent = items;
  document.getElementById('st-size').textContent = bytes < 1024 ? bytes + ' B' : bytes < 1048576 ? (bytes / 1024).toFixed(1) + ' KB' : (bytes / 1048576).toFixed(1) + ' MB';
}

if (_page === 'vaults') {
  renderVaultSelector();
  renderVaultStats();
  checkImportLink();
  window.addEventListener('hashchange', checkImportLink);
}
if (_page === 'vault') {
  const id = new URLSearchParams(location.search).get('v');
  if (!getIndex().some(v => v.id === id)) location.replace('vaults.html');
  else {
    _selectedVaultId = id;
    renderLockScreen();
    setTimeout(() => document.getElementById('master-pw').focus(), 50);
  }
  let _lastActive = Date.now();
  ['mousemove', 'keydown', 'mousedown', 'touchstart', 'scroll'].forEach(e => document.addEventListener(e, () => { _lastActive = Date.now(); }, { passive: true }));
  setInterval(() => {
    if (!_masterPw) { _lastActive = Date.now(); return; }
    const left = Math.max(0, 300 - Math.floor((Date.now() - _lastActive) / 1000));
    document.getElementById('ov-lock').textContent = Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0');
    document.getElementById('ov-codes').textContent = _entries.filter(e => e.type === 'totp').length;
    document.getElementById('ov-items').textContent = _entries.filter(e => e.type !== 'totp').length;
  }, 1000);
}
