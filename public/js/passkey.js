'use strict';
/*
 * Passkey unlock via the WebAuthn PRF extension. The authenticator derives a secret from a salt we
 * choose; that secret never leaves the authenticator unless the user verifies (biometric / PIN /
 * security-key touch). We use it as a key-wrapping key. Nothing about it is stored on the device,
 * so copying the browser's files doesn't let anyone unlock the vault.
 */
(function (g) {
  const C = g.VaultCrypto;
  const supported = () => !!(g.PublicKeyCredential && g.navigator && navigator.credentials && navigator.credentials.create && g.isSecureContext !== false);
  const fail = e => new Error(e && e.name === 'NotAllowedError'
    ? 'The passkey request was cancelled or timed out.'
    : (e && e.message) || 'Something went wrong with the passkey.');

  async function evaluate(credId, prfSalt) {
    let a;
    try {
      a = await navigator.credentials.get({ publicKey: {
        challenge: C.rand(32), rpId: location.hostname, userVerification: 'required', timeout: 120000,
        allowCredentials: [{ type: 'public-key', id: C.b64.dec(credId) }],
        extensions: { prf: { eval: { first: C.b64.dec(prfSalt) } } }
      } });
    } catch (e) { throw fail(e); }
    const r = a.getClientExtensionResults().prf;
    if (!r || !r.results || !r.results.first) throw new Error('That passkey didn’t return an unlock key. Use your passcode instead.');
    return new Uint8Array(r.results.first);
  }

  async function create(label) {
    const prfSalt = C.rand(32);
    let cred;
    try {
      cred = await navigator.credentials.create({ publicKey: {
        rp: { name: 'Vault', id: location.hostname },
        user: { id: C.rand(16), name: label, displayName: label },
        challenge: C.rand(32), timeout: 120000,
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
        extensions: { prf: { eval: { first: prfSalt } } }
      } });
    } catch (e) { throw fail(e); }
    const ext = cred.getClientExtensionResults(), credId = C.b64.enc(new Uint8Array(cred.rawId));
    let out = ext.prf && ext.prf.results && ext.prf.results.first;
    if (!out) {
      if (!(ext.prf && ext.prf.enabled)) throw new Error('This device or passkey can’t be used to unlock Vault. Try another passkey, or keep using your passcode.');
      out = await evaluate(credId, C.b64.enc(prfSalt));   // some authenticators only evaluate on sign-in
    }
    return { credId, prfSalt: C.b64.enc(prfSalt), prfOut: new Uint8Array(out) };
  }

  g.VaultPasskey = { supported, create, evaluate };
})(globalThis);
