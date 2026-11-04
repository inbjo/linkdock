CREATE TABLE instance_settings (
  id INTEGER PRIMARY KEY CHECK(id=1),
  registration_mode TEXT NOT NULL CHECK(registration_mode IN ('closed','invite','open')),
  turnstile_enabled INTEGER NOT NULL DEFAULT 0,
  max_files INTEGER NOT NULL DEFAULT 100 CHECK(max_files>0),
  max_storage_bytes INTEGER NOT NULL DEFAULT 104857600 CHECK(max_storage_bytes>0),
  max_tokens INTEGER NOT NULL DEFAULT 20 CHECK(max_tokens>0)
);
ALTER TABLE users ADD COLUMN max_files INTEGER;
ALTER TABLE users ADD COLUMN max_storage_bytes INTEGER;
ALTER TABLE users ADD COLUMN max_tokens INTEGER;
CREATE TABLE invitations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  code_hash TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  remaining INTEGER NOT NULL CHECK(remaining>=0),
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE user_usage (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  files INTEGER NOT NULL,
  current_bytes INTEGER NOT NULL,
  history_bytes INTEGER NOT NULL,
  staging_bytes INTEGER NOT NULL,
  stored_bytes INTEGER NOT NULL,
  pending_cleanup INTEGER NOT NULL,
  failures INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE maintenance_state (
  id INTEGER PRIMARY KEY CHECK(id=1),
  cursor INTEGER NOT NULL DEFAULT 0,
  last_run_at TEXT,
  last_success_at TEXT,
  sessions_deleted INTEGER NOT NULL DEFAULT 0,
  users_sampled INTEGER NOT NULL DEFAULT 0,
  error TEXT
);
INSERT INTO maintenance_state(id) VALUES(1);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE INDEX invitations_expiry ON invitations(expires_at);
