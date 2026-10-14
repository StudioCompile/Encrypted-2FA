'use strict';
// Pages share these scripts. Elements a page doesn't have resolve to detached stubs so shared code never throws.
const _gid = document.getElementById.bind(document), _stubs = {};
document.getElementById = id => _gid(id) || (_stubs[id] || (_stubs[id] = document.createElement('div')));

const IDX_KEY = 'vlt_index';
const ITER_1 = 500_000;
const ITER_2 = 500_000;
const SALT_LEN = 16;
const IV_LEN = 12;
const VER_LABEL = new TextEncoder().encode('VAULT_VERIFIER_V2::CHAINED_KDF');
const TAG_AES = new TextEncoder().encode('AES_KEY_DERIVATION');
const TAG_HMAC = new TextEncoder().encode('HMAC_KEY_DERIVATION');

let _masterPw = null;
let _activeId = null;
let _entries = [];
let _pendingFile = null;
let _previewUrls = [];
let _viewingItemId = null;
let _viewingItemData = null;

const ICON = {
  note: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
  file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>',
  image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
  key: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>',
  totp: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
  view: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>'
};

function formatSize(bytes) {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

function methodLabel(method) {
  if (method === 'passkey') return 'Passkey';
  if (method === 'both') return 'Password + Passkey';
  return 'Password';
}

function itemEffectivePw(extraPw) {
  return extraPw ? _masterPw + '\x00\xFF\x00' + extraPw : _masterPw;
}

function isTextLike(item, rawText) {
  if (item.mimeType?.startsWith('text/')) return true;
  return /\.(txt|md|json|csv|log|env|yaml|yml|xml|html|css|js|ts|jsx|tsx|py|sh|bat|pem|pub|key)$/i.test(item.title || '');
}

function clearPreviewUrls() {
  _previewUrls.forEach(u => URL.revokeObjectURL(u));
  _previewUrls = [];
}

const rnd = n => crypto.getRandomValues(new Uint8Array(n));
const b64e = b => {
  const bytes = b instanceof ArrayBuffer ? new Uint8Array(b) : (b.buffer ? new Uint8Array(b.buffer, b.byteOffset, b.byteLength) : new Uint8Array(b));
  let str = '';
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str);
};
const b64d = s => {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};
const uid = () => b64e(rnd(9)).replace(/[+/=]/g, c => ({ '+': 'x', '/': 'y', '=': '' }[c]));

async function chainedDerive(password, salt, tag, algo, usages) {
  const enc = new TextEncoder();
  const pwKey = await crypto.subtle.importKey('raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveBits']);
  const s1 = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: ITER_1, hash: 'SHA-512' }, pwKey, 256);
  const mac = await crypto.subtle.importKey('raw', s1, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const ts = new Uint8Array(tag.length + salt.length);
  ts.set(tag, 0); ts.set(salt, tag.length);
  const mid = await crypto.subtle.sign('HMAC', mac, ts);
  const iKey = await crypto.subtle.importKey('raw', mid, { name: 'PBKDF2' }, false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: ITER_2, hash: 'SHA-256' }, iKey, algo, false, usages);
}
const deriveAES = (pw, salt) => chainedDerive(pw, salt, TAG_AES, { name: 'AES-GCM', length: 256 }, ['encrypt', 'decrypt']);
const deriveHMAC = (pw, salt, u) => chainedDerive(pw, salt, TAG_HMAC, { name: 'HMAC', hash: 'SHA-256', length: 256 }, [u]);

async function encryptStr(pt, pw) {
  const salt = rnd(SALT_LEN), iv = rnd(IV_LEN);
  const key = await deriveAES(pw, salt);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(pt));
  const out = new Uint8Array(SALT_LEN + IV_LEN + ct.byteLength);
  out.set(salt, 0); out.set(iv, SALT_LEN); out.set(new Uint8Array(ct), SALT_LEN + IV_LEN);
  return b64e(out);
}
async function decryptStr(b64, pw) {
  try {
    const buf = b64d(b64), salt = buf.slice(0, SALT_LEN), iv = buf.slice(SALT_LEN, SALT_LEN + IV_LEN), ct = buf.slice(SALT_LEN + IV_LEN);
    const key = await deriveAES(pw, salt);
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct));
  } catch { return null; }
}

async function buildVerifier(pw) {
  const salt = rnd(SALT_LEN), key = await deriveHMAC(pw, salt, 'sign');
  const sig = await crypto.subtle.sign('HMAC', key, VER_LABEL);
  return b64e(salt) + ':' + b64e(new Uint8Array(sig));
}
async function checkVerifier(pw, stored) {
  try {
    const [sB64, sigB64] = stored.split(':');
    const salt = b64d(sB64), exp = b64d(sigB64);
    const key = await deriveHMAC(pw, salt, 'verify');
    return crypto.subtle.verify('HMAC', key, exp, VER_LABEL);
  } catch { return false; }
}

function getIndex() {
  try { return JSON.parse(localStorage.getItem(IDX_KEY) || '[]'); } catch { return []; }
}
function saveIndex(idx) { localStorage.setItem(IDX_KEY, JSON.stringify(idx)); }
function vKey(id, k) { return `vlt_${id}_${k}`; }

async function persistEntries() {
  const blobs = await Promise.all(_entries.map(e => encryptStr(JSON.stringify(e), _masterPw)));
  localStorage.setItem(vKey(_activeId, 'entries'), JSON.stringify(blobs));
}
async function loadEntries(id, pw) {
  const raw = localStorage.getItem(vKey(id, 'entries'));
  if (!raw) return [];
  const blobs = JSON.parse(raw);
  const results = await Promise.all(blobs.map(async b => {
    const j = await decryptStr(b, pw); return j ? JSON.parse(j) : null;
  }));
  return results.filter(Boolean);
}
function deleteVaultData(id) {
  ['verifier', 'entries', 'method', 'pkcred'].forEach(k => localStorage.removeItem(vKey(id, k)));
  const idx = getIndex().filter(v => v.id !== id);
  saveIndex(idx);
}

function packVault(verifier, blobs, name) {
  const json = JSON.stringify({ v: 2, verifier, entries: blobs, name: name || 'Imported' });
  const bytes = new TextEncoder().encode(json);
  return b64e(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}
function unpackVault(enc) {
  try {
    const bytes = b64d(enc.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch { return null; }
}
function getImportData() {
  const m = location.hash.match(/^#import=(.+)$/);
  return m ? m[1] : null;
}

