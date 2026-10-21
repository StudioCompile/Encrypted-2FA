-- Vault — Cloudflare D1 schema (the Worker also creates this automatically on first request).
-- Everything user-supplied here is ciphertext, a wrapped key, or a salted hash.

CREATE TABLE IF NOT EXISTS vault_accounts (
  id TEXT PRIMARY KEY, google_sub TEXT NOT NULL UNIQUE, email TEXT NOT NULL,
  pc_salt TEXT, pc_auth_salt TEXT, pc_auth_hash TEXT, pc_wrapped_dek TEXT,
  pk_cred_id TEXT, pk_prf_salt TEXT, pk_wrapped_dek TEXT,
  rc_salt TEXT, rc_hash TEXT, rc_wrapped_dek TEXT,
  failed INTEGER NOT NULL DEFAULT 0, locked_until INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS vault_sessions (
  token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES vault_accounts(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);

CREATE INDEX IF NOT EXISTS idx_vault_sessions_account ON vault_sessions(account_id);

CREATE TABLE IF NOT EXISTS vault_items (
  id TEXT NOT NULL, account_id TEXT NOT NULL REFERENCES vault_accounts(id) ON DELETE CASCADE,
  data TEXT NOT NULL, file TEXT, updated_at INTEGER NOT NULL, PRIMARY KEY (account_id, id));
