# Vault

Encrypted 2FA codes, notes and files. Sign in with an account to sync across devices, or use it on one device with no account. Everything is encrypted in the browser before it is stored, and the server (Cloudflare Pages Functions + D1) only ever holds ciphertext.

## Deploy to Cloudflare

```bash
npm install
npx wrangler login
npx wrangler d1 create vault          # copy the database_id it prints into wrangler.toml
npm run db:remote                     # creates the tables
npm run deploy                        # first run asks you to create the Pages project
```

You can also connect the repo in the Cloudflare dashboard (build command: none, output directory: `public`). The D1 binding is declared in `wrangler.toml`, so it's applied automatically.

Optional settings (Pages → Settings → Variables):

| Variable | Effect |
|---|---|
| `ALLOW_SIGNUPS=false` | Closes registration (existing accounts keep working). Handy for a private instance. |

Recommended: add a Cloudflare WAF rate-limiting rule for `/api/login` and `/api/recover/*`. The app already locks an account for 15 minutes after 8 failed attempts.

## Run locally

```bash
npm install
npm run db:local
npm run dev                           # http://localhost:8788
npm test                              # API + UI tests (start `npm run dev` first)
```

## How it's put together

```
public/            static site (landing, app, security page)
  js/crypto.js     key derivation, AES-GCM, recovery key
  js/totp.js       TOTP + otpauth / Google Authenticator import
  js/store.js      cloud API client and local IndexedDB store
  js/app.js        the UI
functions/api/     Pages Functions: register, login, items, password, recovery…
schema.sql         D1 tables
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
