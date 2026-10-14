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

if (_page === 'vaults') {
  renderVaultSelector();
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
}
