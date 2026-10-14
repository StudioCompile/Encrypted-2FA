'use strict';
function base32Decode(str) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  str = str.replace(/=+$/, '').toUpperCase().replace(/\s/g, '');
  let bits = 0, val = 0, out = [];
  for (const c of str) { const i = A.indexOf(c); if (i < 0) throw new Error(`Invalid char: ${c}`); val = (val << 5) | i; bits += 5; if (bits >= 8) { bits -= 8; out.push((val >> bits) & 0xff); } }
  return new Uint8Array(out);
}
async function generateTOTP(secret, period = 30) {
  const kb = base32Decode(secret);
  const counter = Math.floor(Math.floor(Date.now() / 1000) / period);
  const msg = new Uint8Array(8); let tmp = counter;
  for (let i = 7; i >= 0; i--) { msg[i] = tmp & 0xff; tmp = Math.floor(tmp / 256); }
  const key = await crypto.subtle.importKey('raw', kb, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const hmac = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg));
  const off = hmac[hmac.length - 1] & 0x0f;
  const code = ((hmac[off] & 0x7f) << 24) | (hmac[off + 1] << 16) | (hmac[off + 2] << 8) | hmac[off + 3];
  return String(code % 1_000_000).padStart(6, '0');
}
const totpRemaining = (p = 30) => p - (Math.floor(Date.now() / 1000) % p);

/* ══ OTP URI PARSING ══ */
function parseOTPUri(uri) {
  try {
    if (!uri.startsWith('otpauth://')) throw new Error('Not an otpauth URI');
    const url = new URL(uri);
    const type = url.hostname; // 'totp' or 'hotp'
    if (type !== 'totp') throw new Error('Only TOTP is supported');
    const params = url.searchParams;
    const secret = params.get('secret');
    if (!secret) throw new Error('No secret in URI');
    // Label is in the path: /ISSUER:ACCOUNT or /ACCOUNT
    let rawLabel = decodeURIComponent(url.pathname.slice(1));
    let issuer = params.get('issuer') || '';
    let label = rawLabel;
    if (rawLabel.includes(':')) {
      const parts = rawLabel.split(':');
      if (!issuer) issuer = parts[0].trim();
      label = parts[1].trim();
    }
    const period = parseInt(params.get('period')) || 30;
    const algorithm = params.get('algorithm') || 'SHA1';
    const digits = parseInt(params.get('digits')) || 6;
    return { label, issuer, secret: secret.replace(/\s/g, '').toUpperCase(), period, algorithm, digits };
  } catch (e) {
    throw new Error(e.message);
  }
}

function fillTOTPFromParsed(parsed) {
  document.getElementById('totp-label').value = parsed.label || '';
  document.getElementById('totp-secret').value = parsed.secret || '';
  document.getElementById('totp-issuer').value = parsed.issuer || '';
  document.getElementById('totp-period').value = parsed.period || 30;
}

/* ══ URI PASTE MODAL ══ */
function openURIEntry() {
  document.getElementById('uri-input').value = '';
  document.getElementById('uri-err').style.display = 'none';
  openModal('uri-entry');
}

function importFromURI() {
  const uri = document.getElementById('uri-input').value.trim();
  const err = document.getElementById('uri-err');
  err.style.display = 'none';
  try {
    const parsed = parseOTPUri(uri);
    fillTOTPFromParsed(parsed);
    closeModal('uri-entry');
    toast('URI imported — review and save.');
  } catch (e) {
    showErr(err, 'Invalid URI: ' + e.message);
  }
}

/* ══ QR SCANNER ══ */
let _qrStream = null, _qrAnimFrame = null, _qrFound = false;

function openQRScanner() {
  _qrFound = false;
  openModal('qr-scanner');
  switchQRTab('camera');
  startQRCamera();
}

function closeQRScanner() {
  stopQRCamera();
  closeModal('qr-scanner');
}

function switchQRTab(tab) {
  document.querySelectorAll('.qr-tab').forEach((t, i) => {
    const tabs = ['camera', 'upload'];
    t.classList.toggle('active', tabs[i] === tab);
  });
  document.getElementById('qr-panel-camera').classList.toggle('active', tab === 'camera');
  document.getElementById('qr-panel-upload').classList.toggle('active', tab === 'upload');
  if (tab === 'camera') { startQRCamera(); }
  else { stopQRCamera(); }
}

async function startQRCamera() {
  stopQRCamera();
  _qrFound = false;
  const status = document.getElementById('qr-status-camera');
  status.textContent = 'Starting camera…';
  status.className = 'qr-status';
  try {
    _qrStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 1280 } }
    });
    const video = document.getElementById('qr-video');
    video.srcObject = _qrStream;
    await video.play();
    status.textContent = 'Point your camera at a QR code';
    scanQRFrame();
  } catch (e) {
    status.textContent = 'Camera access denied — use Upload or Paste URI instead.';
    status.className = 'qr-status err';
  }
}

function stopQRCamera() {
  if (_qrAnimFrame) { cancelAnimationFrame(_qrAnimFrame); _qrAnimFrame = null; }
  if (_qrStream) { _qrStream.getTracks().forEach(t => t.stop()); _qrStream = null; }
  const video = document.getElementById('qr-video');
  if (video) video.srcObject = null;
}

function scanQRFrame() {
  if (_qrFound) return;
  const video = document.getElementById('qr-video');
  const canvas = document.getElementById('qr-canvas');
  if (!video || !canvas || video.readyState < 2) {
    _qrAnimFrame = requestAnimationFrame(scanQRFrame); return;
  }
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0);
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const code = jsQR(imgData.data, imgData.width, imgData.height, { inversionAttempts: 'dontInvert' });
  if (code && code.data) {
    onQRDetected(code.data, 'camera');
  } else {
    _qrAnimFrame = requestAnimationFrame(scanQRFrame);
  }
}

function handleQRImage(input) {
  const file = input.files[0];
  input.value = '';
  if (!file) return;
  const status = document.getElementById('qr-status-upload');
  status.textContent = 'Reading image…';
  status.className = 'qr-status';
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = img.width; canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(imgData.data, imgData.width, imgData.height, { inversionAttempts: 'attemptBoth' });
    if (code && code.data) {
      onQRDetected(code.data, 'upload');
    } else {
      status.textContent = 'No QR code found in that image.';
      status.className = 'qr-status err';
    }
  };
  img.onerror = () => {
    status.textContent = 'Could not load image.';
    status.className = 'qr-status err';
  };
  img.src = URL.createObjectURL(file);
}

function onQRDetected(data, source) {
  _qrFound = true;
  stopQRCamera();
  const status = document.getElementById(source === 'camera' ? 'qr-status-camera' : 'qr-status-upload');
  try {
    const parsed = parseOTPUri(data);
    status.textContent = '✓ QR code found!';
    status.className = 'qr-status ok';
    setTimeout(() => {
      closeQRScanner();
      fillTOTPFromParsed(parsed);
      toast('QR scanned — review and save.');
    }, 600);
  } catch (e) {
    // QR found but not an OTP URI — show raw and let user handle it
    status.textContent = 'QR found but not an OTP code: ' + data.slice(0, 60);
    status.className = 'qr-status err';
    _qrFound = false;
    if (source === 'camera') scanQRFrame();
  }
}

async function addTOTP() {
  const label = v('totp-label').trim(), secret = v('totp-secret').trim().replace(/\s/g, '').toUpperCase();
  const issuer = v('totp-issuer').trim(), period = parseInt(v('totp-period')) || 30;
  const err = document.getElementById('add-totp-err');
  if (!label) { showErr(err, 'Give this entry a name.'); return; }
  if (!secret) { showErr(err, 'You need to enter the secret key.'); return; }
  try { base32Decode(secret); } catch (e) { showErr(err, 'That secret key looks wrong: ' + e.message); return; }
  try { await generateTOTP(secret, period); } catch { showErr(err, "Couldn't generate a code — double-check the secret key."); return; }
  _entries.push({ id: uid(), type: 'totp', label, secret, issuer, period, created: Date.now() });
  await persistEntries();
  closeModal('add-totp'); clearIds('totp-label', 'totp-secret', 'totp-issuer');
  document.getElementById('totp-period').value = '30';
  renderTOTP(); toast('2FA code saved!');
}
function removeTOTP(id) { confirmDelete(async () => { _entries = _entries.filter(e => e.id !== id); await persistEntries(); renderTOTP(); toast('Entry deleted.'); }); }

async function renderTOTP() {
  const list = document.getElementById('totp-list');
  const totps = _entries.filter(e => e.type === 'totp');
  if (!totps.length) {
    list.className = 'totp-grid is-empty';
    list.innerHTML = `<div class="empty-state"><div class="empty-state-icon">${ICON.totp}</div><div class="empty-state-text">No 2FA codes yet.<br><span onclick="openAddModal()">Add your first code</span></div></div>`;
    return;
  }
  list.className = 'totp-grid';
  const circumference = 2 * Math.PI * 16;
  list.innerHTML = totps.map(e => {
    const initial = esc((e.label || e.issuer || '?').charAt(0).toUpperCase());
    return `
    <div class="totp-card" id="card-${e.id}">
      <div class="totp-card-header">
        <div class="totp-card-info-row">
          <div class="totp-avatar">${initial}</div>
          <div class="totp-card-info">
            <div class="totp-card-label">${esc(e.label)}</div>
            <div class="totp-card-issuer">${esc(e.issuer || 'No issuer')}</div>
          </div>
        </div>
        <div class="totp-card-actions">
          <button title="Edit" onclick="openEditTOTP('${e.id}')">${ICON.edit}</button>
          <button class="delete" title="Delete" onclick="removeTOTP('${e.id}')">${ICON.trash}</button>
        </div>
      </div>
      <div class="totp-code-row">
        <div class="totp-code" id="code-${e.id}" onclick="copyCode('${e.id}')" title="Click to copy">——————</div>
        <div class="totp-timer">
          <svg viewBox="0 0 36 36">
            <circle class="totp-timer-bg" cx="18" cy="18" r="16"/>
            <circle class="totp-timer-progress" id="bar-${e.id}" cx="18" cy="18" r="16" stroke-dasharray="${circumference}" stroke-dashoffset="0"/>
          </svg>
          <div class="totp-timer-text" id="rem-${e.id}"></div>
        </div>
      </div>
    </div>`;
  }).join('');
  renderTOTPCodes();
}
async function renderTOTPCodes() {
  const circumference = 2 * Math.PI * 16;
  for (const e of _entries.filter(x => x.type === 'totp')) {
    const ce = document.getElementById(`code-${e.id}`), be = document.getElementById(`bar-${e.id}`), re = document.getElementById(`rem-${e.id}`);
    if (!ce || ce.classList.contains('copy-flash')) continue;
    const rem = totpRemaining(e.period), pct = rem / e.period, warn = rem <= 5;
    try { const c = await generateTOTP(e.secret, e.period); ce.textContent = c.slice(0, 3) + ' ' + c.slice(3); } catch { ce.textContent = 'ERROR'; }
    ce.classList.toggle('warn', warn);
    be.style.strokeDashoffset = circumference * (1 - pct);
    be.classList.toggle('warn', warn);
    re.textContent = `${rem}s`;
  }
}
async function copyCode(id) {
  const e = _entries.find(x => x.id === id); if (!e) return;
  try {
    const c = await generateTOTP(e.secret, e.period); await navigator.clipboard.writeText(c);
    const el = document.getElementById(`code-${id}`); el.classList.add('copy-flash'); el.textContent = 'COPIED!';
    setTimeout(() => { el.classList.remove('copy-flash'); renderTOTPCodes(); }, 1400); toast('Code copied to clipboard!');
  } catch { toast('Could not copy — check browser permissions.'); }
}
let _totpTimer = null;
function startTotpRefresh() { stopTotpRefresh(); _totpTimer = setInterval(renderTOTPCodes, 1000); renderTOTPCodes(); }
function stopTotpRefresh() { clearInterval(_totpTimer); _totpTimer = null; }

