-- Vault — Cloudflare D1 schema. Everything user-supplied here is ciphertext or a salted hash.
CREATE TABLE IF NOT EXISTS users (
  id             TEXT PRIMARY KEY,
  email          TEXT NOT NULL UNIQUE,
  auth_salt      TEXT NOT NULL,
  auth_hash      TEXT NOT NULL,            -- SHA-256(salt + client auth key)
  wrapped_dek    TEXT NOT NULL,            -- data key, wrapped by the password-derived key
  rc_salt        TEXT NOT NULL,
  rc_hash        TEXT NOT NULL,            -- hash of the recovery auth key
  rc_wrapped_dek TEXT NOT NULL,            -- data key, wrapped by the recovery-key-derived key
  failed_logins  INTEGER NOT NULL DEFAULT 0,
  locked_until   INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS items (
  id         TEXT NOT NULL,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  data       TEXT NOT NULL,                -- sealed JSON (type, title, secret, note text, ...)
  file       TEXT,                         -- sealed file bytes (optional)
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, id)
);
