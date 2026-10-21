'use strict';
/*
 * Vault crypto. Everything here runs in the browser; the server never sees a passcode, an
 * encryption key, or any plaintext. Nothing secret is ever written to storage.
 *
 *   data key (DEK): random AES-256-GCM key that encrypts every item. It is stored only wrapped:
 *     - by the passcode:  passcode --PBKDF2-SHA256 (600k)--> master --HKDF--> wrapping key + proof key
 *     - by a passkey:     authenticator PRF output (hardware-bound, needs your biometric/PIN) --HKDF--> wrapping key
 *     - by the recovery key (cloud accounts)
 *   every item: AES-GCM under the DEK, with the item id bound in as additional data.
 */
(function (g) {
  const enc = new TextEncoder(), dec = new TextDecoder();
  const KDF_ITERATIONS = 600000;
  const subtle = () => g.crypto.subtle;

  /* ---------- encoding ---------- */
  const b64 = {
    enc(buf) {
      const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
      let s = '';
      for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      return btoa(s);
    },
    dec(str) {
      const bin = atob(str), out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
  };
  const rand = n => g.crypto.getRandomValues(new Uint8Array(n));
  const uid = () => b64.enc(rand(12)).replace(/\+/g, '-').replace(/\//g, '_');
  const concat = (...parts) => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  };

  const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  function base32Decode(str) {
    str = String(str).toUpperCase().replace(/[\s-]/g, '').replace(/=+$/, '');
    if (!str) throw new Error('The secret is empty.');
    let bits = 0, val = 0;
    const out = [];
    for (const c of str) {
      const i = B32.indexOf(c);
      if (i < 0) throw new Error('The secret contains an invalid character (' + c + ').');
      val = (val << 5) | i; bits += 5;
      if (bits >= 8) { bits -= 8; out.push((val >> bits) & 255); }
    }
    return new Uint8Array(out);
  }
  function base32Encode(bytes) {
    let bits = 0, val = 0, out = '';
    for (const b of bytes) {
      val = (val << 8) | b; bits += 8;
      while (bits >= 5) { bits -= 5; out += B32[(val >> bits) & 31]; }
    }
    if (bits > 0) out += B32[(val << (5 - bits)) & 31];
    return out;
  }

  /* ---------- key derivation ---------- */
  async function sha256(...parts) { return new Uint8Array(await subtle().digest('SHA-256', concat(...parts))); }
  async function stretch(password, salt, iterations = KDF_ITERATIONS) {
    const base = await subtle().importKey('raw', enc.encode(String(password).normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
    return new Uint8Array(await subtle().deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, 256));
  }
  const ZERO = new Uint8Array(32);
  async function expand(master, label) {
    const base = await subtle().importKey('raw', master, 'HKDF', false, ['deriveKey', 'deriveBits']);
    const kek = await subtle().deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: ZERO, info: enc.encode('vault/kek/v1/' + label) },
      base, { name: 'AES-GCM', length: 256 }, false, ['wrapKey', 'unwrapKey']);
    const auth = await subtle().deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt: ZERO, info: enc.encode('vault/auth/v1/' + label) }, base, 256);
    return { kek, auth: b64.enc(auth) };
  }

  // passcode -> { kek, auth }. `auth` is a proof the server can check without learning the passcode.
  const passcodeCredentials = async (passcode, salt) => expand(await stretch(passcode, salt), 'passcode');
  // passkey PRF output (32 bytes from the authenticator) -> wrapping key
  const passkeyKey = async prfOut => (await expand(new Uint8Array(prfOut), 'passkey')).kek;

  /* ---------- recovery code: 160 random bits shown as 8 groups of 4 ---------- */
  function generateRecoveryCode() {
    return base32Encode(rand(20)).match(/.{4}/g).join('-');
  }
  function normalizeRecoveryCode(code) {
    const c = String(code).toUpperCase().replace(/[^A-Z2-7]/g, '');
    if (c.length !== 32) throw new Error('That recovery key doesn’t look right. It has 32 letters and numbers.');
    return c;
  }
  const recoveryCredentials = async code => expand(base32Decode(normalizeRecoveryCode(code)), 'recovery');

  /* ---------- data key ---------- */
  const newDEK = () => subtle().generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  async function wrapDEK(dek, kek) {
    const iv = rand(12);
    const w = new Uint8Array(await subtle().wrapKey('raw', dek, kek, { name: 'AES-GCM', iv }));
    return b64.enc(concat(iv, w));
  }
  async function unwrapDEK(wrapped, kek, extractable = false) {
    const buf = b64.dec(wrapped);
    try {
      return await subtle().unwrapKey('raw', buf.subarray(12), kek, { name: 'AES-GCM', iv: buf.subarray(0, 12) },
        { name: 'AES-GCM', length: 256 }, extractable, ['encrypt', 'decrypt']);
    } catch { throw new Error('WRONG_SECRET'); }
  }

  /* ---------- sealing data ---------- */
  async function seal(key, bytes, aad) {
    const iv = rand(12);
    const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(aad) }, key, bytes));
    return b64.enc(concat(iv, ct));
  }
  async function open(key, str, aad) {
    const buf = b64.dec(str);
    return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: buf.subarray(0, 12), additionalData: enc.encode(aad) }, key, buf.subarray(12)));
  }
  const sealJSON = (key, obj, id) => seal(key, enc.encode(JSON.stringify(obj)), 'item:' + id);
  const openJSON = async (key, str, id) => JSON.parse(dec.decode(await open(key, str, 'item:' + id)));
  const sealFile = (key, bytes, id) => seal(key, bytes, 'file:' + id);
  const openFile = (key, str, id) => open(key, str, 'file:' + id);

  /* ---------- password-protected backups ---------- */
  async function backupKey(pass, salt, iterations = KDF_ITERATIONS) {
    return subtle().importKey('raw', await stretch(pass, salt, iterations), 'AES-GCM', false, ['encrypt', 'decrypt']);
  }

  /* ---------- password strength (rough, for guidance only) ---------- */
  function scorePassword(pw) {
    if (!pw) return { level: 0, label: '' };
    let pool = 0;
    if (/[a-z]/.test(pw)) pool += 26;
    if (/[A-Z]/.test(pw)) pool += 26;
    if (/[0-9]/.test(pw)) pool += 10;
    if (/[^a-zA-Z0-9]/.test(pw)) pool += 32;
    let bits = pw.length * Math.log2(pool || 1);
    if (/^(.)\1+$/.test(pw) || /^(0123|1234|abcd|qwer|pass|letmein)/i.test(pw)) bits = Math.min(bits, 20);
    if (bits < 40) return { level: 1, label: 'Weak' };
    if (bits < 60) return { level: 2, label: 'Fair' };
    if (bits < 80) return { level: 3, label: 'Good' };
    return { level: 4, label: 'Strong' };
  }

  g.VaultCrypto = {
    KDF_ITERATIONS, b64, rand, uid, concat, base32Decode, base32Encode, sha256,
    passcodeCredentials, passkeyKey, recoveryCredentials, generateRecoveryCode, normalizeRecoveryCode,
    newDEK, wrapDEK, unwrapDEK, seal, open, sealJSON, openJSON, sealFile, openFile, backupKey, scorePassword, stretch
  };
})(globalThis);
