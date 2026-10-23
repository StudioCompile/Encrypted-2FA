# Vault

Encrypted 2FA codes, notes and files. Sign in with an account to sync across devices, or use it on one device with no account. Everything is encrypted in the browser before it is stored, and the server (a Cloudflare Worker + D1) only ever holds ciphertext.

## Deploy to Cloudflare

Vault is a single Cloudflare **Worker** (static site + API) with a **D1** database. Nothing needs to be created by hand.

**From GitHub (Workers Builds):** push this repo, then in Workers & Pages create/connect the project with
* Build command: *(none)*
* Deploy command: `npx wrangler deploy`
* Root directory: `/`

The Worker name in `wrangler.toml` (`encrypted-2fa`) must match the project name. On the first deploy Wrangler creates the `vault` D1 database, and the Worker creates its tables on the first request. If your Cloudflare account can't auto-create it, run `npx wrangler d1 create vault` once and add `database_id = "<id>"` under `[[d1_databases]]` in `wrangler.toml`.

**From your computer:** `npm install && npx wrangler login && npm run deploy`

Optional: set the variable `ALLOW_SIGNUPS` to `false` (Settings → Variables) to close registration. Add a Cloudflare WAF rate-limiting rule for `/api/login` and `/api/recover/*` as well; the app already locks an account for 15 minutes after 8 failed attempts.

## Run locally

```bash
npm install
npm run dev                           # http://localhost:8788 (local D1 is created automatically)
npm test                              # API + UI tests (start `npm run dev` first)
```

## How it's put together

```
public/            static site (landing, app, security page)
  js/crypto.js     key derivation, AES-GCM, recovery key
  js/totp.js       TOTP + otpauth / Google Authenticator import
  js/store.js      cloud API client and local IndexedDB store
  js/app.js        the UI
src/worker.js      Worker entry and router
src/api/           register, login, items, password, recovery…
src/schema.js      D1 tables (created on first request; schema.sql is the same)
```

* **Account mode:** password → PBKDF2 (600k) → HKDF → a key-wrapping key and a separate sign-in key. A random data key encrypts every item (AES-256-GCM) and is stored wrapped by your password and by your recovery key. Changing your password re-wraps one key; no items are re-encrypted.
* **Local mode:** the same scheme, stored in IndexedDB, no network.
* Limits: files up to 1 MB on a cloud account (D1 row size), 10 MB locally; notes about 80 KB; 2,000 items per account.

## Changes from v1

* One account (or one local store) instead of multiple vaults.
* Removed passkey unlock: the old implementation derived its key from the credential ID, which is stored next to the wrapped secret, so it didn't add protection. Share links and per-item extra passcodes were removed too. Accounts replace sharing.
* Added recovery key, change password, sign out everywhere, search, editable notes, auto-lock setting, encrypted backups, SHA-256/512 and 8-digit codes, and Google Authenticator import.
* Old v1 export files (`vault-export-*.json`) can be imported from Settings → Import (you'll be asked each old vault's password).
* Fonts are the system fonts and QR scanning (jsQR) is bundled, so the page loads nothing from other sites.
