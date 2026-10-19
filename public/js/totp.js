'use strict';
/* TOTP (RFC 6238) with SHA-1/256/512 and 6-8 digits, plus otpauth:// and Google Authenticator export parsing. */
(function (g) {
  const C = g.VaultCrypto;
  const HASH = { SHA1: 'SHA-1', SHA256: 'SHA-256', SHA512: 'SHA-512' };
  const keys = new Map();

  const normAlg = a => {
    const k = String(a || 'SHA1').toUpperCase().replace('-', '');
    return HASH[k] ? k : 'SHA1';
  };
  function hmacKey(secret, alg) {
    const id = alg + ':' + secret;
    if (!keys.has(id)) {
      keys.set(id, g.crypto.subtle.importKey('raw', C.base32Decode(secret), { name: 'HMAC', hash: HASH[alg] }, false, ['sign']));
    }
    return keys.get(id);
  }

  async function code(secret, opts = {}) {
    const period = opts.period || 30, digits = opts.digits || 6, alg = normAlg(opts.algorithm);
    const counter = Math.floor((opts.time ?? Date.now()) / 1000 / period);
    const msg = new Uint8Array(8), dv = new DataView(msg.buffer);
    dv.setUint32(0, Math.floor(counter / 2 ** 32));
    dv.setUint32(4, counter >>> 0);
    const mac = new Uint8Array(await g.crypto.subtle.sign('HMAC', await hmacKey(secret, alg), msg));
    const o = mac[mac.length - 1] & 15;
    const bin = ((mac[o] & 0x7f) << 24) | (mac[o + 1] << 16) | (mac[o + 2] << 8) | mac[o + 3];
    return String(bin % 10 ** digits).padStart(digits, '0');
  }
  const remaining = (period = 30, time = Date.now()) => period - (Math.floor(time / 1000) % period);
  const format = c => c.length === 8 ? c.slice(0, 4) + ' ' + c.slice(4) : c.slice(0, 3) + ' ' + c.slice(3);
  const clearCache = () => keys.clear();

  function parseOtpAuth(uri) {
    let url;
    try { url = new URL(uri.trim()); } catch { throw new Error('That isn’t a valid otpauth:// link.'); }
    if (url.protocol !== 'otpauth:') throw new Error('That isn’t an otpauth:// link.');
    if (url.hostname.toLowerCase() !== 'totp') throw new Error('Only time-based (TOTP) codes are supported.');
    const p = url.searchParams;
    const secret = (p.get('secret') || '').replace(/[\s-]/g, '').toUpperCase();
    if (!secret) throw new Error('The link has no secret.');
    C.base32Decode(secret);
    let label = decodeURIComponent(url.pathname.replace(/^\//, '')), issuer = p.get('issuer') || '';
    if (label.includes(':')) {
      const i = label.indexOf(':');
      if (!issuer) issuer = label.slice(0, i).trim();
      label = label.slice(i + 1).trim();
    }
    const digits = parseInt(p.get('digits'), 10);
    return {
      issuer, name: label, secret,
      period: parseInt(p.get('period'), 10) || 30,
      digits: digits >= 6 && digits <= 8 ? digits : 6,
      algorithm: normAlg(p.get('algorithm'))
    };
  }

  /* Google Authenticator "Export accounts" QR: otpauth-migration://offline?data=<base64 protobuf> */
  function pbFields(buf) {
    const out = []; let i = 0;
    const varint = () => {
      let r = 0, s = 0, b;
      do { b = buf[i++]; if (b === undefined) throw new Error('bad'); r += (b & 0x7f) * 2 ** s; s += 7; } while (b & 0x80);
      return r;
    };
    while (i < buf.length) {
      const tag = varint(), f = tag >>> 3, w = tag & 7;
      if (w === 0) out.push({ f, v: varint() });
      else if (w === 2) { const l = varint(); out.push({ f, v: buf.subarray(i, i + l) }); i += l; }
      else if (w === 1) i += 8;
      else if (w === 5) i += 4;
      else throw new Error('bad');
    }
    return out;
  }
  function parseMigration(uri) {
    try {
      const data = new URL(uri.trim()).searchParams.get('data');
      if (!data) throw new Error('bad');
      const bytes = C.b64.dec(data.replace(/ /g, '+').replace(/-/g, '+').replace(/_/g, '/'));
      const text = b => new TextDecoder().decode(b);
      const items = [];
      for (const top of pbFields(bytes)) {
        if (top.f !== 1) continue;
        const o = {};
        for (const x of pbFields(top.v)) o[x.f] = x.v;
        if (o[6] === 1 || o[4] === 4 || !o[1]) continue; // HOTP / MD5 / no secret
        let name = o[2] ? text(o[2]) : '', issuer = o[3] ? text(o[3]) : '';
        if (!issuer && name.includes(':')) { const i = name.indexOf(':'); issuer = name.slice(0, i).trim(); name = name.slice(i + 1).trim(); }
        items.push({
          issuer, name, secret: C.base32Encode(o[1]), period: 30,
          digits: o[5] === 2 ? 8 : 6, algorithm: o[4] === 2 ? 'SHA256' : o[4] === 3 ? 'SHA512' : 'SHA1'
        });
      }
      if (!items.length) throw new Error('bad');
      return items;
    } catch { throw new Error('Couldn’t read that Google Authenticator export.'); }
  }

  /* Accepts one otpauth:// link, a Google export link, or several links (one per line). Always returns an array. */
  function parseAny(text) {
    const lines = String(text).split(/\s+/).filter(l => /^otpauth(-migration)?:\/\//i.test(l));
    if (!lines.length) throw new Error('No otpauth:// links found.');
    const out = [];
    for (const l of lines) {
      if (/^otpauth-migration:/i.test(l)) out.push(...parseMigration(l));
      else out.push(parseOtpAuth(l));
    }
    return out;
  }

  g.VaultTOTP = { code, remaining, format, clearCache, parseOtpAuth, parseMigration, parseAny, normAlg };
})(globalThis);
