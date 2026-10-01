CREATE TABLE IF NOT EXISTS notebook_entries (
  kind TEXT NOT NULL CHECK (kind IN ('note', 'wish')),
  entry_key TEXT NOT NULL,
  text TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0, 1)),
  version INTEGER NOT NULL CHECK (version > 0),
  deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),
  PRIMARY KEY (kind, entry_key)
);
CREATE INDEX IF NOT EXISTS notebook_active ON notebook_entries (kind, deleted);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  credential_tag TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions (expires_at);

CREATE TABLE IF NOT EXISTS login_limits (
  client_hash TEXT PRIMARY KEY,
  window_until INTEGER NOT NULL,
  attempts INTEGER NOT NULL CHECK (attempts > 0)
);
CREATE INDEX IF NOT EXISTS login_limits_expiry ON login_limits (window_until);
