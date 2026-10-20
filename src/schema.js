// Tables are created on first request, so a fresh deploy needs no manual database setup.
// (schema.sql in the project root is the same schema, for running by hand if you prefer.)
export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, auth_salt TEXT NOT NULL, auth_hash TEXT NOT NULL,
    wrapped_dek TEXT NOT NULL, rc_salt TEXT NOT NULL, rc_hash TEXT NOT NULL, rc_wrapped_dek TEXT NOT NULL,
    failed_logins INTEGER NOT NULL DEFAULT 0, locked_until INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`,
  `CREATE TABLE IF NOT EXISTS items (
    id TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    data TEXT NOT NULL, file TEXT, updated_at INTEGER NOT NULL, PRIMARY KEY (user_id, id))`
];
