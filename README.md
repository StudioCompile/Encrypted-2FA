# Vault

2FA codes, notes and files that stay encrypted on your device and are **locked behind a passcode or passkey every time**. Nothing that can open them is ever saved, so someone with access to your computer can't read them while Vault is locked.

Two ways to use it, same encryption:

* **Continue with Google**: Google identifies you so your encrypted data can sync across devices. It never sees your passcode or data.
* **No account**: everything stays in this browser's IndexedDB. Nothing is sent anywhere.

## Set up Google sign-in (one time)

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → **APIs & Services → Credentials → Create credentials → OAuth client ID**.
2. Application type **Web application**.
3. **Authorized JavaScript origins**: add your site (for example `https://encrypted-2fa.dislabed.workers.dev`) and `http://localhost:8788` for local development. No redirect URI is needed.
4. If asked, configure the OAuth consent screen (External; you only need the `email` scope, which is the default).
5. Copy the **Client ID** into `wrangler.toml`:
   ```toml
   [vars]
   GOOGLE_CLIENT_ID = "1234567890-abc.apps.googleusercontent.com"
   ```
   The client ID is public, so it's safe to commit. Without it, the app still works in no-account mode and says Google sign-in isn't set up.

Optional variables in `wrangler.toml`: `ALLOWED_EMAILS = "you@gmail.com"` (only these Google accounts may sign in) and `ALLOW_SIGNUPS = "false"`.

## Deploy to Cloudflare

Vault is one Cloudflare **Worker** (static site + API) with a **D1** database. Nothing needs to be created by hand.

**From GitHub (Workers Builds):** Build command: *(none)*. Deploy command: `npx wrangler deploy`. Root directory: `/`. The Worker name in `wrangler.toml` (`encrypted-2fa`) must match your project. On the first deploy Wrangler creates the `vault` D1 database and the Worker creates its tables on the first request. If your account can't auto-create it, run `npx wrangler d1 create vault` once and add `database_id = "<id>"` under `[[d1_databases]]`.

**From your computer:** `npm install && npx wrangler login && npm run deploy`

## Run locally

```bash
npm install
npm run dev        # http://localhost:8788
```
Add `http://localhost:8788` to the Google authorized origins to try Google sign-in locally. No-account mode works with no setup.

### Tests
The tests use a fake Google (their own signing keys) and a fake passkey authenticator. Start the dev server with the test variables, then run them:
```bash
npx wrangler dev --port 8788 \
  --var GOOGLE_CLIENT_ID:test-client-id.apps.googleusercontent.com \
  --var GOOGLE_JWKS_URL:http://127.0.0.1:9988/jwks
npm test           # 51 API checks + 35 UI checks
```
(`GOOGLE_JWKS_URL` exists only so tests can supply their own keys. Never set it in production.)

## How it works

```
public/            static site (home, app, security)
  js/crypto.js     key derivation, AES-GCM, recovery key
  js/passkey.js    WebAuthn PRF unlock
  js/totp.js       TOTP + otpauth / Google Authenticator import
  js/store.js      cloud API client and local IndexedDB store
  js/app.js        the UI
src/worker.js      Worker entry and router
src/api/           google, session, vault, unlock, passcode, passkey, recovery, items…
src/google.js      Google ID-token verification
src/schema.js      D1 tables (created on first request; schema.sql is the same)
```

* A random 256-bit **data key** encrypts every item (AES-256-GCM). It is only ever stored *wrapped* by: your **passcode** (PBKDF2-SHA256 600k → HKDF), your **passkey** (WebAuthn PRF output, hardware-bound), and for Google accounts a **recovery key**.
* Keys live in memory only. Reloading, locking or auto-lock erases them, and unlocking needs the passcode or passkey again. Passcode inputs are plain text fields drawn as dots so browsers don't offer to save them.
* For Google accounts the server releases the wrapped key only after a passcode proof, and locks unlocking for 15 minutes after 8 wrong tries.
* Limits: files 1 MB on Google accounts (D1 row size), 10 MB locally; notes about 80 KB; 2,000 items.

## Notes and caveats

* **Passkeys need the PRF extension.** Most current phones, Macs and security keys have it; support on Windows and some browsers varies. Vault hides the option when the browser lacks WebAuthn, and shows an error if a passkey can't do PRF. The passcode always works. The passkey flow is tested against a simulated authenticator here, so try it on your own devices.
* A short PIN can be guessed offline by anyone who copies the local files, so passcodes need 10+ characters. In no-account mode, add a passkey for hardware-backed protection.
* While Vault is **unlocked**, anything controlling your computer can see what you can. Use Auto-lock ("When I leave this tab" is the strictest).

## Changes from the previous version

* Google sign-in or no account, replacing email and password accounts.
* A passcode or passkey is required on every visit; nothing is remembered.
* Real passkey unlock (hardware PRF) replaces the earlier approach, which stored its key next to the data.
* Old v1 export files (`vault-export-*.json`) can still be imported from Settings → Import.
