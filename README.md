# Vault

A private place for your 2FA codes, notes and files. Everything is locked on your device, and you open it with a **passcode** (or a **passkey**) every time.

## The three words you'll see

| Word | What it is |
|---|---|
| **Passcode** | What you type to open Vault. At least 10 characters. |
| **Passkey** | Optional. Lets you open Vault with your fingerprint, face, phone or security key instead of typing. |
| **Recovery key** | Google accounts only. A long code shown once. It's the only way back in if you forget your passcode. |

## Two ways to use it

* **Continue with Google**: your locked data syncs between your devices. Google only confirms who you are. It can't see your data.
* **No account**: everything stays in this one browser. Nothing is sent anywhere. If you forget your passcode, or clear your browser data, it's gone, so export a backup from Settings.

---

## Set it up (about 10 minutes, once)

### 1. Google sign-in

Your Client ID is already in `wrangler.toml`:

```
407397476387-6dmm67mc66n2i3d798cp44pk7oicftqt.apps.googleusercontent.com
```

You only need to tell Google which website may use it:

1. Open [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials) and click that Client ID.
2. Under **Authorized JavaScript origins**, add your site address, for example `https://encrypted-2fa.dislabed.workers.dev`.
3. To test on your own computer, also add `http://localhost:8788`.
4. Click **Save**. Google can take a few minutes to start accepting it.

**If the Google button says "origin_mismatch" or doesn't appear,** the address in step 2 is missing or has a typo. It must match what's in your browser's address bar exactly (no trailing slash).

### 2. Put it online

**From GitHub:** connect the repository in Cloudflare. Deploy command: `npx wrangler deploy`. No build command.

**From your computer:**

```bash
npm install
npx wrangler login
npm run deploy
```

Cloudflare creates the database for you the first time. If it says it can't, run `npx wrangler d1 create vault` once, then paste the `database_id` it prints under `[[d1_databases]]` in `wrangler.toml`.

### 3. Try it

Open your site, choose **Continue with Google**, make a passcode, and save your recovery key.

---

## Optional settings (in `wrangler.toml`)

* `ALLOWED_EMAILS = "you@gmail.com"` lets only these Google accounts sign in. Use this if Vault is just for you.
* `ALLOW_SIGNUPS = "false"` stops new accounts from being created. Existing ones keep working.

## Run it on your computer

```bash
npm install
npm run dev        # opens at http://localhost:8788
```

"No account" mode works with no setup. For Google sign-in, add `http://localhost:8788` as described above.

## Tests

```bash
npx wrangler dev --port 8788 \
  --var GOOGLE_CLIENT_ID:test-client-id.apps.googleusercontent.com \
  --var GOOGLE_JWKS_URL:http://127.0.0.1:9988/jwks
npm test
```

`GOOGLE_JWKS_URL` is only for tests. Never set it on your live site.

## Good to know

* **Passkeys need a device that supports them.** Most current phones, Macs and security keys do. Windows and some browsers vary. If yours doesn't, Vault says so, and your passcode always works.
* **While Vault is unlocked,** anyone controlling your computer can see what you see. In Settings, set Auto-lock to "When I leave this tab" for the strictest option.
* **Limits:** files up to 1 MB with Google or 10 MB with no account, notes about 80 KB, 2,000 items.
* Keep each website's own backup codes too. Vault is another copy, not a replacement.

## For developers

How the encryption works and what the server stores is on the Security page (`public/security.html`). Styling rules are in `DESIGN.md`.

```
public/       the website (home, app, security)
src/          the Cloudflare Worker and its API
tests/        API and UI tests
```
